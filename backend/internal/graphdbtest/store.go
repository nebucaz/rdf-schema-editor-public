// Package graphdbtest is a minimal in-memory SPARQL store good enough to test internal/sync's
// engine against real request/response shapes, without a live GraphDB instance (per this repo's
// "no live-system spin-up" convention). It is not a general SPARQL engine — it understands exactly
// the small, fixed set of query/update shapes this backend's own Go code emits (see
// internal/sync/ops.go and internal/sync/mapping.go), matched by their known literal structure
// rather than a real grammar. Exported (not `_test.go`) so both internal/sync's and
// internal/handler's tests can import it.
package graphdbtest

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
)

// Triple is one stored (graph, subject, predicate, object) quad. Object is either an IRI
// (ObjectIsIRI true) or a literal string (its `^^datatype` suffix, if any, is kept verbatim but
// never inspected by this package's own matchers).
type Triple struct {
	Graph, S, P, O string
	ObjectIsIRI    bool
}

// Store is the in-memory quad set. Safe for concurrent use (Engine's own concurrency guard is
// tested against it).
type Store struct {
	mu      sync.Mutex
	triples []Triple
}

// NewServer starts an httptest.Server backed by a fresh, empty Store.
func NewServer() (*httptest.Server, *Store) {
	store := &Store{}
	server := httptest.NewServer(http.HandlerFunc(store.handle))
	return server, store
}

// Seed adds triples directly, bypassing SPARQL Update parsing — used to set up a test's starting
// graph state (e.g. "a human-added triple already exists on this subject").
func (s *Store) Seed(triples ...Triple) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.triples = append(s.triples, triples...)
}

// Snapshot returns a copy of every stored triple — used by dry-run-is-side-effect-free tests to
// diff the full triple set before/after a call.
func (s *Store) Snapshot() []Triple {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Triple, len(s.triples))
	copy(out, s.triples)
	return out
}

// Has reports whether a specific (graph, s, p, o) triple is currently stored.
func (s *Store) Has(graph, subject, predicate, object string, objectIsIRI bool) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, t := range s.triples {
		if t.Graph == graph && t.S == subject && t.P == predicate && t.O == object && t.ObjectIsIRI == objectIsIRI {
			return true
		}
	}
	return false
}

// CountMatching returns how many stored triples match (graph, subject, predicate) with any object
// — used to assert "exactly one Activity was minted" style checks.
func (s *Store) CountMatching(graph, subject, predicate string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, t := range s.triples {
		if t.Graph == graph && t.S == subject && t.P == predicate {
			n++
		}
	}
	return n
}

func (s *Store) handle(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/statements" {
		body, _ := io.ReadAll(r.Body)
		if err := s.applyUpdate(string(body)); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusOK)
		return
	}

	if err := r.ParseForm(); err != nil {
		http.Error(w, "malformed request", http.StatusBadRequest)
		return
	}
	query := strings.TrimSpace(r.FormValue("query"))
	w.Header().Set("Content-Type", "application/sparql-results+json")

	if strings.HasPrefix(query, "ASK") {
		result, err := s.evalAsk(query)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		fmt.Fprintf(w, `{"boolean":%v}`, result)
		return
	}

	bindings, err := s.evalSelect(query)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Write([]byte(bindings))
}

var askPattern = regexp.MustCompile(`^ASK \{ GRAPH <([^>]+)> \{ <([^>]+)> <([^>]+)> (?:<([^>]+)>|"([^"]*)") \} \}$`)

func (s *Store) evalAsk(query string) (bool, error) {
	m := askPattern.FindStringSubmatch(query)
	if m == nil {
		return false, fmt.Errorf("graphdbtest: unrecognized ASK query: %s", query)
	}
	graph, subject, predicate := m[1], m[2], m[3]
	if m[4] != "" {
		return s.Has(graph, subject, predicate, m[4], true), nil
	}
	return s.Has(graph, subject, predicate, unescape(m[5]), false), nil
}

var (
	kindMappingPattern    = regexp.MustCompile(`^SELECT \?class \?kind WHERE \{ GRAPH \?g \{ \?class <([^>]+)> \?kind \} \}$`)
	existingSyncedPattern = regexp.MustCompile(`^SELECT \?i WHERE \{ GRAPH <([^>]+)> \{ \?i <([^>]+)> <([^>]+)> ; <([^>]+)> "([^"]*)" \} \}$`)
	isMasterForPattern    = regexp.MustCompile(`^SELECT \?p WHERE \{ GRAPH \?g \{ \?p <([^>]+)> <([^>]+)> ; <([^>]+)> "([^"]*)" \} \} LIMIT 1$`)
)

func (s *Store) evalSelect(query string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	switch {
	case kindMappingPattern.MatchString(query):
		m := kindMappingPattern.FindStringSubmatch(query)
		predicate := m[1]
		var rows []string
		for _, t := range s.triples {
			if t.P == predicate && !t.ObjectIsIRI {
				rows = append(rows, fmt.Sprintf(
					`{"class":{"type":"uri","value":%q},"kind":{"type":"literal","value":%q}}`,
					t.S, unescape(t.O),
				))
			}
		}
		return wrapBindings(rows), nil

	case existingSyncedPattern.MatchString(query):
		m := existingSyncedPattern.FindStringSubmatch(query)
		graph, typePred, classIRI, sourcePred, sourceVal := m[1], m[2], m[3], m[4], unescape(m[5])
		var subjects []string
		for _, t := range s.triples {
			if t.Graph == graph && t.P == typePred && t.ObjectIsIRI && t.O == classIRI {
				if s.hasLocked(graph, t.S, sourcePred, sourceVal, false) {
					subjects = append(subjects, t.S)
				}
			}
		}
		var rows []string
		for _, subj := range subjects {
			rows = append(rows, fmt.Sprintf(`{"i":{"type":"uri","value":%q}}`, subj))
		}
		return wrapBindings(rows), nil

	case isMasterForPattern.MatchString(query):
		m := isMasterForPattern.FindStringSubmatch(query)
		typePred, classIRI, labelPred, labelVal := m[1], m[2], m[3], unescape(m[4])
		for _, t := range s.triples {
			if t.P == typePred && t.ObjectIsIRI && t.O == classIRI {
				if s.hasLocked(t.Graph, t.S, labelPred, labelVal, false) {
					return wrapBindings([]string{fmt.Sprintf(`{"p":{"type":"uri","value":%q}}`, t.S)}), nil
				}
			}
		}
		return wrapBindings(nil), nil
	}

	return "", fmt.Errorf("graphdbtest: unrecognized SELECT query: %s", query)
}

// hasLocked is Has without re-acquiring the mutex, for callers already holding it.
func (s *Store) hasLocked(graph, subject, predicate, object string, objectIsIRI bool) bool {
	for _, t := range s.triples {
		if t.Graph == graph && t.S == subject && t.P == predicate && t.O == object && t.ObjectIsIRI == objectIsIRI {
			return true
		}
	}
	return false
}

func wrapBindings(rows []string) string {
	return fmt.Sprintf(`{"results":{"bindings":[%s]}}`, strings.Join(rows, ","))
}

// applyUpdate parses a `;`-separated sequence of `DELETE WHERE { GRAPH <g> { <s> <p> ?o } }` /
// `INSERT DATA { GRAPH <g> { <s> <p> o . ... } }` operations (the only two shapes internal/sync/
// ops.go ever emits) and applies them in order against the store.
func (s *Store) applyUpdate(body string) error {
	ops := splitOps(body)
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, op := range ops {
		op = strings.TrimSpace(op)
		if op == "" {
			continue
		}
		switch {
		case strings.HasPrefix(op, "DELETE WHERE"):
			if err := s.applyDeleteWhere(op); err != nil {
				return err
			}
		case strings.HasPrefix(op, "INSERT DATA"):
			if err := s.applyInsertData(op); err != nil {
				return err
			}
		default:
			return fmt.Errorf("graphdbtest: unrecognized update op: %s", op)
		}
	}
	return nil
}

var opBoundary = regexp.MustCompile(`(DELETE WHERE|INSERT DATA)`)

// splitOps splits a `" ;\n"`-joined op sequence back into individual op strings, tolerant of the
// exact separator since it re-anchors on each op's own leading keyword rather than the separator
// text itself.
func splitOps(body string) []string {
	locs := opBoundary.FindAllStringIndex(body, -1)
	if locs == nil {
		return nil
	}
	var ops []string
	for i, loc := range locs {
		end := len(body)
		if i+1 < len(locs) {
			end = locs[i+1][0]
		}
		ops = append(ops, strings.TrimRight(strings.TrimSpace(body[loc[0]:end]), "; \n\t"))
	}
	return ops
}

var deleteWherePattern = regexp.MustCompile(`^DELETE WHERE \{ GRAPH <([^>]+)> \{ <([^>]+)> <([^>]+)> \?o \} \}$`)

func (s *Store) applyDeleteWhere(op string) error {
	m := deleteWherePattern.FindStringSubmatch(op)
	if m == nil {
		return fmt.Errorf("graphdbtest: unrecognized DELETE WHERE op: %s", op)
	}
	graph, subject, predicate := m[1], m[2], m[3]
	kept := s.triples[:0]
	for _, t := range s.triples {
		if t.Graph == graph && t.S == subject && t.P == predicate {
			continue
		}
		kept = append(kept, t)
	}
	s.triples = kept
	return nil
}

var insertDataPattern = regexp.MustCompile(`^INSERT DATA \{ GRAPH <([^>]+)> \{ (.*) \} \}$`)

func (s *Store) applyInsertData(op string) error {
	m := insertDataPattern.FindStringSubmatch(op)
	if m == nil {
		return fmt.Errorf("graphdbtest: unrecognized INSERT DATA op: %s", op)
	}
	graph, body := m[1], m[2]
	triples, err := parseTriples(body)
	if err != nil {
		return err
	}
	for _, t := range triples {
		t.Graph = graph
		s.triples = append(s.triples, t)
	}
	return nil
}

// parseTriples tokenizes a sequence of `<s> <p> <o|"literal"[^^<datatype>]> .` triples — a tiny
// hand-rolled tokenizer (not a real Turtle parser) sufficient for exactly what
// internal/sync/ops.go's INSERT DATA bodies ever contain.
func parseTriples(body string) ([]Triple, error) {
	tokens, err := tokenize(body)
	if err != nil {
		return nil, err
	}
	var triples []Triple
	for i := 0; i+4 <= len(tokens); {
		if tokens[i+3] != "." {
			return nil, fmt.Errorf("graphdbtest: malformed triple near token %d in %q", i, body)
		}
		s, sIRI := unwrapTerm(tokens[i])
		p, _ := unwrapTerm(tokens[i+1])
		o, oIRI := unwrapTerm(tokens[i+2])
		if !sIRI {
			return nil, fmt.Errorf("graphdbtest: subject must be an IRI: %s", tokens[i])
		}
		triples = append(triples, Triple{S: s, P: p, O: o, ObjectIsIRI: oIRI})
		i += 4
	}
	return triples, nil
}

// unwrapTerm strips `<...>` (IRI) or `"..."[^^<...>]` (literal, datatype suffix discarded) from one
// token, unescaping `\"`/`\\` for literals.
func unwrapTerm(tok string) (value string, isIRI bool) {
	if strings.HasPrefix(tok, "<") {
		return strings.TrimSuffix(strings.TrimPrefix(tok, "<"), ">"), true
	}
	// "literal" or "literal"^^<datatype>
	end := strings.LastIndex(tok, `"`)
	if strings.HasPrefix(tok, `"`) && end > 0 {
		return unescape(tok[1:end]), false
	}
	return tok, false
}

func tokenize(s string) ([]string, error) {
	var tokens []string
	i := 0
	for i < len(s) {
		c := s[i]
		switch {
		case c == ' ' || c == '\t' || c == '\n' || c == '\r':
			i++
		case c == '<':
			j := strings.IndexByte(s[i:], '>')
			if j < 0 {
				return nil, fmt.Errorf("graphdbtest: unterminated IRI in %q", s)
			}
			tokens = append(tokens, s[i:i+j+1])
			i += j + 1
		case c == '"':
			j := i + 1
			for j < len(s) {
				if s[j] == '\\' {
					j += 2
					continue
				}
				if s[j] == '"' {
					break
				}
				j++
			}
			if j >= len(s) {
				return nil, fmt.Errorf("graphdbtest: unterminated string in %q", s)
			}
			end := j + 1
			if end+1 < len(s) && s[end] == '^' && s[end+1] == '^' {
				k := strings.IndexByte(s[end:], '>')
				if k < 0 {
					return nil, fmt.Errorf("graphdbtest: unterminated datatype IRI in %q", s)
				}
				end = end + k + 1
			}
			tokens = append(tokens, s[i:end])
			i = end
		case c == '.':
			tokens = append(tokens, ".")
			i++
		default:
			return nil, fmt.Errorf("graphdbtest: unexpected character %q in %q", c, s)
		}
	}
	return tokens, nil
}

func unescape(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+1 < len(s) {
			i++
			b.WriteByte(s[i])
			continue
		}
		b.WriteByte(s[i])
	}
	return b.String()
}
