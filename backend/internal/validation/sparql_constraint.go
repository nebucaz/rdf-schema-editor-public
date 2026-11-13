package validation

// Guarded execution of stored `sh:select` queries (spec/shacl-test STORY-355). A stored select is
// untrusted input that runs on every report under the service credential, so it is run only after
// ValidateSelect, with `$this` pre-bound through a validated VALUES clause, a per-query timeout and
// a row cap. Anything that cannot be run safely is reported as NotChecked, never run.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/sparqlsafe"
)

// maxSelectBytes is the size cap of a stored select.
const maxSelectBytes = 16 * 1024

// SelectRunner runs a SPARQL SELECT; *graphdb.Client satisfies it, tests use a fake.
type SelectRunner interface {
	Select(ctx context.Context, query string) (graphdb.SelectResult, error)
}

// SparqlLimits bounds the execution of one sh:sparql constraint.
type SparqlLimits struct {
	BatchSize int           // focus nodes per query
	MaxRows   int           // result rows per constraint over all batches
	Timeout   time.Duration // per query
}

// DefaultSparqlLimits are the limits the report uses.
var DefaultSparqlLimits = SparqlLimits{BatchSize: 200, MaxRows: 10000, Timeout: 30 * time.Second}

// SparqlRow is one result row of a constraint: the focus node, and the optional `?path`/`?value`.
// HasValue tells a bound empty `?value` ("") from an unbound one.
type SparqlRow struct {
	This     string
	Path     string
	Value    string
	HasValue bool
}

type selToken struct {
	kind       byte // w word, v variable, i IRI, s string, n name next to a colon or a number, p punctuation
	text       string
	start, end int
}

// tokenizeSelect splits SPARQL text into tokens, skipping comments and keeping string literals and
// IRIs whole, so keywords and braces inside them are never mistaken for syntax. A `#` inside an IRI
// (`<http://ex#NAME>`) is not a comment. It mirrors the SPARQL lexer where the two could disagree: a
// comment ends at `\n` or `\r`, and a number is a token of its own, so `1SERVICE` is `1` then `SERVICE`.
func tokenizeSelect(text string) ([]selToken, error) {
	var tokens []selToken
	isIdent := func(b byte) bool {
		return b == '_' || b >= '0' && b <= '9' || b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z'
	}
	for i := 0; i < len(text); {
		c := text[i]
		switch {
		case c == ' ' || c == '\t' || c == '\n' || c == '\r':
			i++
		case c == '#':
			for i < len(text) && text[i] != '\n' && text[i] != '\r' {
				i++
			}
		case c == '"' || c == '\'':
			start, quote := i, c
			long := strings.HasPrefix(text[i:], strings.Repeat(string(quote), 3))
			if long {
				i += 3
			} else {
				i++
			}
			closed := false
			for i < len(text) && !closed {
				switch {
				case text[i] == '\\':
					i += 2
				case long && strings.HasPrefix(text[i:], strings.Repeat(string(quote), 3)):
					i += 3
					closed = true
				case !long && text[i] == quote:
					i++
					closed = true
				default:
					i++
				}
			}
			if !closed {
				return nil, errors.New("unterminated string literal")
			}
			tokens = append(tokens, selToken{'s', "", start, i})
		case c == '<':
			j := i + 1
			for j < len(text) && !strings.ContainsRune("<>\"{}|^`\\ \t\r\n", rune(text[j])) {
				j++
			}
			if j < len(text) && text[j] == '>' {
				tokens = append(tokens, selToken{'i', text[i : j+1], i, j + 1})
				i = j + 1
			} else {
				tokens = append(tokens, selToken{'p', "<", i, i + 1})
				i++
			}
		case c == '?' || c == '$':
			j := i + 1
			for j < len(text) && isIdent(text[j]) {
				j++
			}
			tokens = append(tokens, selToken{'v', text[i+1 : j], i, j})
			i = j
		case isIdent(c):
			j := i
			for j < len(text) && isIdent(text[j]) {
				j++
			}
			// A name next to a colon is part of a prefixed name, never a keyword.
			inName := (i > 0 && text[i-1] == ':') || (j < len(text) && text[j] == ':')
			if c >= '0' && c <= '9' && !inName {
				// A number ends where its digits end; what follows is a word of its own.
				k := i
				for k < len(text) && text[k] >= '0' && text[k] <= '9' {
					k++
				}
				tokens = append(tokens, selToken{'n', text[i:k], i, k})
				i = k
				continue
			}
			kind := byte('w')
			if c >= '0' && c <= '9' || inName {
				kind = 'n'
			}
			tokens = append(tokens, selToken{kind, strings.ToUpper(text[i:j]), i, j})
			i = j
		default:
			tokens = append(tokens, selToken{'p', string(c), i, i + 1})
			i++
		}
	}
	return tokens, nil
}

var forbiddenSelectKeywords = map[string]bool{
	"SERVICE": true, "INSERT": true, "DELETE": true, "LOAD": true, "CLEAR": true, "DROP": true,
	"CREATE": true, "COPY": true, "MOVE": true, "ADD": true,
}

// ValidateSelect accepts only a single, bounded SELECT query that projects `$this`: no federation
// (SERVICE), no update keywords, no second query, balanced braces, no use of `$this` inside a
// subquery (the pre-binding cannot reach it). Comments, string literals and IRIs are skipped.
func ValidateSelect(text string) error {
	if len(text) > maxSelectBytes {
		return fmt.Errorf("select exceeds the size cap of %d bytes", maxSelectBytes)
	}
	// SPARQL processes \uXXXX escapes before parsing, anywhere in the text (even inside a string, where
	// \u0022 would close it), so a keyword or quote could be smuggled past this scan. Refuse them.
	if strings.Contains(text, `\u`) || strings.Contains(text, `\U`) {
		return errors.New("unicode escapes (\\u) are not allowed")
	}
	tokens, err := tokenizeSelect(text)
	if err != nil {
		return err
	}
	for _, t := range tokens {
		if t.kind == 'w' && forbiddenSelectKeywords[t.text] {
			return fmt.Errorf("select contains %s, which is not allowed", t.text)
		}
	}

	// The first keyword, after PREFIX/BASE declarations, must be SELECT.
	first := ""
	for i := 0; i < len(tokens) && first == ""; i++ {
		switch t := tokens[i]; {
		case t.kind == 'w' && t.text == "PREFIX":
			for i+1 < len(tokens) && tokens[i].kind != 'i' {
				i++
			}
		case t.kind == 'w' && t.text == "BASE":
			i++
		case t.kind == 'w':
			first = t.text
		}
	}
	if first != "SELECT" {
		return errors.New("only a SELECT query is allowed")
	}

	depth, seenSelect, usesThis := 0, false, false
	var isSub []bool
	for _, t := range tokens {
		switch {
		case t.kind == 'p' && t.text == "{":
			depth++
			isSub = append(isSub, false)
		case t.kind == 'p' && t.text == "}":
			depth--
			if depth < 0 {
				return errors.New("unbalanced brace")
			}
			isSub = isSub[:len(isSub)-1]
		case t.kind == 'p' && t.text == ";" && depth == 0:
			return errors.New("query sequences (;) are not allowed")
		case t.kind == 'w' && t.text == "SELECT":
			if depth == 0 && seenSelect {
				return errors.New("a second query in one text is not allowed")
			}
			if depth > 0 {
				isSub[len(isSub)-1] = true
			}
			seenSelect = true
		case t.kind == 'w' && (t.text == "CONSTRUCT" || t.text == "DESCRIBE" || t.text == "ASK"):
			return errors.New("only a SELECT query is allowed")
		case t.kind == 'v' && t.text == "this":
			usesThis = true
			for _, sub := range isSub {
				if sub {
					return errors.New("$this is used inside a subquery, where the pre-binding cannot reach it")
				}
			}
		}
	}
	if depth != 0 {
		return errors.New("unbalanced brace")
	}
	if !usesThis {
		return errors.New("select does not use $this")
	}
	return nil
}

// bindThis pre-binds `$this` to the focus nodes by inserting `VALUES $this { <iri> ... }` as the
// first element of the outermost WHERE group. Every IRI goes through sparqlsafe; an unsafe IRI is an
// error and nothing is interpolated.
func bindThis(text string, focusNodes []string) (string, error) {
	var values strings.Builder
	for _, iri := range focusNodes {
		if err := sparqlsafe.AssertSafeIRI(iri, "focus node"); err != nil {
			return "", err
		}
		values.WriteString(" <" + iri + ">")
	}
	tokens, err := tokenizeSelect(text)
	if err != nil {
		return "", err
	}
	for _, t := range tokens {
		if t.kind == 'p' && t.text == "{" {
			return text[:t.end] + " VALUES $this {" + values.String() + " }" + text[t.end:], nil
		}
	}
	return "", errors.New("select has no WHERE group")
}

// RunSparqlConstraint runs one constraint for the given focus nodes in batches and returns its result
// rows. Any problem (rejected select, unsafe focus node, timeout, runner error, row cap) returns no
// rows and a NotChecked entry carrying the constraint's rule id; it never panics or errors the run.
func RunSparqlConstraint(ctx context.Context, runner SelectRunner, c SparqlConstraint, focusNodes []string, limits SparqlLimits) ([]SparqlRow, *NotChecked) {
	notChecked := func(reason string) *NotChecked {
		return &NotChecked{ShapeIri: c.ShapeIri, RuleId: c.RuleId, Construct: "sh:sparql", Reason: reason}
	}
	if err := ValidateSelect(c.Select); err != nil {
		return nil, notChecked("select rejected: " + err.Error())
	}
	for _, iri := range focusNodes {
		if err := sparqlsafe.AssertSafeIRI(iri, "focus node"); err != nil {
			return nil, notChecked("unsafe focus node: " + err.Error())
		}
	}

	var rows []SparqlRow
	total := 0
	for start := 0; start < len(focusNodes); start += limits.BatchSize {
		end := min(start+limits.BatchSize, len(focusNodes))
		query, err := bindThis(c.Select, focusNodes[start:end])
		if err != nil {
			return nil, notChecked(err.Error())
		}
		queryCtx, cancel := context.WithTimeout(ctx, limits.Timeout)
		result, err := runner.Select(queryCtx, query)
		cancel()
		if err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				return nil, notChecked(fmt.Sprintf("timed out after %s", limits.Timeout))
			}
			return nil, notChecked("query failed: " + err.Error())
		}
		total += len(result.Results.Bindings)
		if total > limits.MaxRows {
			return nil, notChecked(fmt.Sprintf("more than %d result rows", limits.MaxRows))
		}
		for _, b := range result.Results.Bindings {
			this, ok := b["this"]
			if !ok {
				continue
			}
			value, hasValue := b["value"]
			rows = append(rows, SparqlRow{This: this.Value, Path: b["path"].Value, Value: value.Value, HasValue: hasValue})
		}
	}
	return rows, nil
}

// newSparqlViolation turns a result row into a Violation of the constraint, filling the
// `{$this}`, `{?value}` and `{?path}` placeholders of its message (missing bindings stay empty).
func newSparqlViolation(c SparqlConstraint, row SparqlRow, typeIri, label string) Violation {
	message := c.Message
	if message == "" {
		rule := c.RuleId
		if rule == "" {
			rule = c.ShapeIri
		}
		message = fmt.Sprintf("sh:sparql constraint %s failed for %s", rule, row.This)
	}
	message = strings.NewReplacer(
		"{$this}", row.This, "{?this}", row.This,
		"{?value}", row.Value, "{$value}", row.Value,
		"{?path}", row.Path, "{$path}", row.Path,
	).Replace(message)
	v := Violation{
		IndividualIri: row.This, IndividualLabel: label, TypeIri: typeIri, Path: row.Path,
		Constraint: "sparql", Message: message,
		RuleId: c.RuleId, QualityDimension: c.QualityDimension, ShapeIri: c.ShapeIri,
	}
	if row.HasValue {
		v.Value = &row.Value
	}
	return v
}
