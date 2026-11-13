package validation

// Tests for the guarded execution of stored `sh:select` queries (spec/shacl-test STORY-355). The
// guard cases are Go-only vectors: nothing in the TypeScript app executes a stored select, so there
// is no twin to keep in agreement (unlike backend/testdata/golden/sparql-safe.json).

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
)

func TestValidateSelect_AcceptsAndRejects(t *testing.T) {
	cases := []struct {
		name   string
		text   string
		reject string // "" = accepted, else a word the reason must contain
	}{
		{"plain select", `SELECT $this WHERE { $this ?p ?o }`, ""},
		{"lower case select", `select $this where { $this ?p ?o }`, ""},
		{"prefix and base declarations", `BASE <http://x/> PREFIX ex: <http://ex#> SELECT $this WHERE { $this ex:p ?o }`, ""},
		{"hash inside an IRI is not a comment", `SELECT $this WHERE { $this <http://ex#NAME> ?v . FILTER(?v != "a") }`, ""},
		{"service in a string literal", `SELECT $this WHERE { $this ?p "service insert delete" }`, ""},
		{"service in a long string literal", "SELECT $this WHERE { $this ?p '''SERVICE\n DROP''' }", ""},
		{"update words in a comment", "SELECT $this WHERE { # DELETE everything, SERVICE too\n $this ?p ?o }", ""},
		{"words as variables and local names", `PREFIX ex: <http://ex#> SELECT $this ?delete WHERE { $this ex:insert ?delete . ?x ex:service ?y }`, ""},
		{"subquery not using this", `SELECT $this WHERE { $this ?p ?o { SELECT (COUNT(*) AS ?n) WHERE { ?a ?b ?c } } }`, ""},
		{"unicode escape hides a keyword", `SELECT $this WHERE { \u0053ERVICE <http://evil/> { ?s ?p ?o } }`, "unicode"},
		{"unicode escape closes a string", `SELECT $this WHERE { $this ?p "\u0022 . SERVICE <http://evil/> { ?s ?p ?o } #" }`, "unicode"},
		{"carriage return ends a comment", "SELECT $this WHERE { $this ?p ?o # x\r SERVICE <http://evil/> { ?s ?p ?o }\n }", "SERVICE"},
		{"carriage return ends a comment, insert", "SELECT $this WHERE { $this ?p ?o # x\rINSERT { ?s ?p ?o } }", "INSERT"},
		{"comment hides nothing after a crlf", "SELECT $this WHERE { # SERVICE\r\n $this ?p ?o }", ""},
		{"service glued to a number", `SELECT $this WHERE { $this ?p 1SERVICE <http://evil/> { ?s ?p ?o } }`, "SERVICE"},
		{"service glued to a decimal", `SELECT $this WHERE { $this ?p 1.5SERVICE <http://evil/> { ?s ?p ?o } }`, "SERVICE"},
		{"second select glued to a number", `SELECT $this WHERE { $this ?p ?o } 2SELECT ?x WHERE { ?x ?y ?z }`, "second query"},
		{"digit-led local name is not a keyword", `PREFIX ex: <http://ex#> SELECT $this WHERE { $this ex:1SERVICE ?o . $this ex:p 5 }`, ""},
		{"exponent is not a keyword", `SELECT $this WHERE { $this ?p ?o . FILTER(?o > 1E5 && ?o < 2.5e3) }`, ""},
		{"service", `SELECT $this WHERE { SERVICE <http://evil/sparql> { $this ?p ?o } }`, "SERVICE"},
		{"service silent mixed case", `SELECT $this WHERE { SeRvIcE   sIlEnT <http://evil/> { ?s ?p ?o } }`, "SERVICE"},
		{"insert", `INSERT DATA { <a> <b> <c> }`, "INSERT"},
		{"delete after select", `SELECT $this WHERE { $this ?p ?o } ; DELETE WHERE { ?s ?p ?o }`, "DELETE"},
		{"load", `LOAD <http://x/> `, "LOAD"},
		{"clear", `CLEAR ALL`, "CLEAR"},
		{"drop", `DROP GRAPH <http://g>`, "DROP"},
		{"create", `CREATE GRAPH <http://g>`, "CREATE"},
		{"copy move add", `SELECT $this WHERE { $this ?p ?o } MOVE <a> TO <b>`, "MOVE"},
		{"two queries in one text", `SELECT $this WHERE { $this ?p ?o } SELECT $this WHERE { $this ?q ?o }`, "second"},
		{"sequence with semicolon", `SELECT $this WHERE { $this ?p ?o } ; SELECT $this WHERE { $this ?q ?o }`, ";"},
		{"construct", `CONSTRUCT { $this ?p ?o } WHERE { $this ?p ?o }`, "SELECT"},
		{"ask", `ASK { ?s ?p ?o }`, "SELECT"},
		{"empty", ``, "SELECT"},
		{"unbalanced braces", `SELECT $this WHERE { $this ?p ?o `, "brace"},
		{"does not use this", `SELECT ?s WHERE { ?s ?p ?o }`, "$this"},
		{"over the size cap", `SELECT $this WHERE { $this ?p "` + strings.Repeat("a", maxSelectBytes) + `" }`, "size"},
		{"this inside a subquery", `SELECT $this WHERE { $this ?p ?o { SELECT ?x WHERE { $this ?q ?x } } }`, "subquery"},
	}
	for _, c := range cases {
		err := ValidateSelect(c.text)
		switch {
		case c.reject == "" && err != nil:
			t.Errorf("%s: rejected: %v", c.name, err)
		case c.reject != "" && err == nil:
			t.Errorf("%s: accepted, want rejection mentioning %q", c.name, c.reject)
		case c.reject != "" && !strings.Contains(strings.ToLower(err.Error()), strings.ToLower(c.reject)):
			t.Errorf("%s: error %q does not mention %q", c.name, err, c.reject)
		}
	}
}

// itamSelects extracts the five sh:select texts from the shipped ITAM shape files.
func itamSelects(t *testing.T) []string {
	t.Helper()
	files, err := filepath.Glob("../../../examples/itam-shapes/AC-*.ttl")
	if err != nil || len(files) != 6 {
		t.Fatalf("ITAM shape files: %v, %v", files, err)
	}
	re := regexp.MustCompile(`(?s)sh:select """(.*?)"""`)
	var out []string
	for _, f := range files {
		raw, _ := os.ReadFile(f)
		for _, m := range re.FindAllStringSubmatch(string(raw), -1) {
			out = append(out, strings.ReplaceAll(m[1], `\\`, `\`))
		}
	}
	return out
}

func TestValidateSelect_AllFiveItamSelectsPass(t *testing.T) {
	selects := itamSelects(t)
	if len(selects) != 5 {
		t.Fatalf("found %d selects, want 5", len(selects))
	}
	for i, s := range selects {
		if err := ValidateSelect(s); err != nil {
			t.Errorf("select %d rejected: %v", i, err)
		}
	}
}

func TestBindThis_InsertsValuesAsFirstElementOfOutermostGroup(t *testing.T) {
	got, err := bindThis("SELECT $this ?v WHERE {\n  $this ?p ?v . { SELECT ?x WHERE { ?x ?y ?z } }\n}", []string{"http://ex#a", "http://ex#b"})
	if err != nil {
		t.Fatal(err)
	}
	want := "SELECT $this ?v WHERE { VALUES $this { <http://ex#a> <http://ex#b> }\n  $this ?p ?v . { SELECT ?x WHERE { ?x ?y ?z } }\n}"
	if got != want {
		t.Errorf("bindThis() =\n%s\nwant\n%s", got, want)
	}
}

func TestBindThis_IgnoresBracesInLiteralsAndIRIsBeforeTheGroup(t *testing.T) {
	got, err := bindThis(`SELECT $this (" { " AS ?x) WHERE { $this ?p ?o }`, []string{"http://ex#a"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, `WHERE { VALUES $this { <http://ex#a> }`) || !strings.HasPrefix(got, `SELECT $this (" { " AS ?x)`) {
		t.Errorf("bindThis() = %s", got)
	}
}

func TestBindThis_CommentEndedByCarriageReturnDoesNotHideTheGroup(t *testing.T) {
	got, err := bindThis("SELECT $this # {\rWHERE { $this ?p ?o }", []string{"http://ex#a"})
	want := "SELECT $this # {\rWHERE { VALUES $this { <http://ex#a> } $this ?p ?o }"
	if err != nil || got != want {
		t.Errorf("bindThis() = %q, %v, want %q", got, err, want)
	}
}

func TestBindThis_UnsafeIRIIsAnErrorNeverInterpolated(t *testing.T) {
	for _, bad := range []string{"http://ex#a> } DROP ALL #", "http://ex/a b", "http://ex/<x>", "http://ex/\"q\""} {
		out, err := bindThis(`SELECT $this WHERE { $this ?p ?o }`, []string{"http://ex#ok", bad})
		if err == nil {
			t.Errorf("bindThis(%q) = %s, want an error", bad, out)
		}
		if strings.Contains(out, "DROP") || strings.Contains(out, "http://ex/a b") {
			t.Errorf("unsafe IRI leaked into %s", out)
		}
	}
}

// fakeRunner records every query and answers with canned results.
type fakeRunner struct {
	queries []string
	answer  func(query string) (graphdb.SelectResult, error)
}

func (f *fakeRunner) Select(ctx context.Context, query string) (graphdb.SelectResult, error) {
	f.queries = append(f.queries, query)
	return f.answer(query)
}

func rowsResult(rows ...map[string]graphdb.Binding) graphdb.SelectResult {
	var r graphdb.SelectResult
	r.Results.Bindings = rows
	return r
}

func uri(v string) graphdb.Binding { return graphdb.Binding{Type: "uri", Value: v} }
func literal(v string) graphdb.Binding {
	return graphdb.Binding{Type: "literal", Value: v}
}

var testConstraint = SparqlConstraint{
	ShapeIri: "http://ns#S", TargetClass: "http://ns#App", RuleId: "AC-X", QualityDimension: "Uniqueness",
	Select:  `SELECT $this ?value (<http://ns#id> AS ?path) WHERE { $this <http://ns#id> ?value }`,
	Message: "Wert {?value} bei {$this} ({?path}) ungueltig.",
}

func focusNodes(n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = fmt.Sprintf("http://ex#n%03d", i)
	}
	return out
}

func TestRunSparqlConstraint_BatchesOf200(t *testing.T) {
	runner := &fakeRunner{answer: func(string) (graphdb.SelectResult, error) { return rowsResult(), nil }}
	rows, notChecked := RunSparqlConstraint(context.Background(), runner, testConstraint, focusNodes(450), DefaultSparqlLimits)
	if len(rows) != 0 || notChecked != nil {
		t.Fatalf("rows = %v, notChecked = %+v", rows, notChecked)
	}
	if len(runner.queries) != 3 {
		t.Fatalf("queries = %d, want 3 batches (200+200+50)", len(runner.queries))
	}
	if strings.Count(runner.queries[0], "<http://ex#n") != 200 || strings.Count(runner.queries[2], "<http://ex#n") != 50 {
		t.Errorf("batch sizes wrong")
	}
	if strings.Contains(runner.queries[0], "FROM") {
		t.Errorf("query is scoped: %s", runner.queries[0])
	}
}

func TestRunSparqlConstraint_MapsRows(t *testing.T) {
	runner := &fakeRunner{answer: func(string) (graphdb.SelectResult, error) {
		return rowsResult(
			map[string]graphdb.Binding{"this": uri("http://ex#n001"), "value": literal("A"), "path": uri("http://ns#id")},
			map[string]graphdb.Binding{"this": uri("http://ex#n002")},
			map[string]graphdb.Binding{"value": literal("orphan row without this")},
		), nil
	}}
	rows, notChecked := RunSparqlConstraint(context.Background(), runner, testConstraint, focusNodes(3), DefaultSparqlLimits)
	if notChecked != nil || len(rows) != 2 {
		t.Fatalf("rows = %+v, notChecked = %+v, want 2 rows", rows, notChecked)
	}
	if rows[0] != (SparqlRow{This: "http://ex#n001", Path: "http://ns#id", Value: "A", HasValue: true}) || rows[1] != (SparqlRow{This: "http://ex#n002"}) {
		t.Errorf("rows = %+v", rows)
	}
}

func TestRunSparqlConstraint_HasValueTellsEmptyFromUnbound(t *testing.T) {
	runner := &fakeRunner{answer: func(string) (graphdb.SelectResult, error) {
		return rowsResult(
			map[string]graphdb.Binding{"this": uri("http://ex#n001"), "value": literal("")},
			map[string]graphdb.Binding{"this": uri("http://ex#n002")},
		), nil
	}}
	rows, _ := RunSparqlConstraint(context.Background(), runner, testConstraint, focusNodes(2), DefaultSparqlLimits)
	if len(rows) != 2 || !rows[0].HasValue || rows[1].HasValue {
		t.Fatalf("rows = %+v, want an empty binding to have a value and an unbound ?value not to", rows)
	}
}

func TestNewSparqlViolation_ValueIsNilWithoutABindingAndEmptyWithAnEmptyOne(t *testing.T) {
	none := newSparqlViolation(testConstraint, SparqlRow{This: "http://ex#n1"}, "t", "l")
	if none.Value != nil {
		t.Errorf("Value = %q, want nil for a row without ?value", *none.Value)
	}
	empty := newSparqlViolation(testConstraint, SparqlRow{This: "http://ex#n1", HasValue: true}, "t", "l")
	if empty.Value == nil || *empty.Value != "" {
		t.Errorf("Value = %v, want a pointer to the empty string", empty.Value)
	}
	some := newSparqlViolation(testConstraint, SparqlRow{This: "http://ex#n1", Value: "x", HasValue: true}, "t", "l")
	if some.Value == nil || *some.Value != "x" {
		t.Errorf("Value = %v, want x", some.Value)
	}
}

func TestNewSparqlViolation_FillsPlaceholdersAndLeavesMissingBindingsEmpty(t *testing.T) {
	v := newSparqlViolation(testConstraint, SparqlRow{This: "http://ex#n1", Path: "http://ns#id", Value: "A"}, "http://ns#App", "n1")
	if v.Message != "Wert A bei http://ex#n1 (http://ns#id) ungueltig." {
		t.Errorf("Message = %q", v.Message)
	}
	if v.Constraint != "sparql" || v.RuleId != "AC-X" || v.QualityDimension != "Uniqueness" || v.ShapeIri != "http://ns#S" || v.TypeIri != "http://ns#App" || v.IndividualLabel != "n1" {
		t.Errorf("violation = %+v", v)
	}
	empty := newSparqlViolation(testConstraint, SparqlRow{This: "http://ex#n1"}, "t", "l")
	if empty.Message != "Wert  bei http://ex#n1 () ungueltig." || empty.Path != "" {
		t.Errorf("Message = %q, Path = %q", empty.Message, empty.Path)
	}
	noMessage := newSparqlViolation(SparqlConstraint{RuleId: "R"}, SparqlRow{This: "http://ex#n1"}, "t", "l")
	if noMessage.Message == "" {
		t.Errorf("a constraint without sh:message needs a generated message")
	}
}

func TestRunSparqlConstraint_RejectedSelectIsNotRunAndNamesTheRule(t *testing.T) {
	runner := &fakeRunner{answer: func(string) (graphdb.SelectResult, error) { return rowsResult(), nil }}
	c := testConstraint
	c.Select = `SELECT $this WHERE { SERVICE <http://evil/> { $this ?p ?o } }`
	rows, notChecked := RunSparqlConstraint(context.Background(), runner, c, focusNodes(3), DefaultSparqlLimits)
	if len(runner.queries) != 0 || len(rows) != 0 {
		t.Errorf("a rejected select must not run: queries = %d", len(runner.queries))
	}
	if notChecked == nil || notChecked.RuleId != "AC-X" || notChecked.ShapeIri != "http://ns#S" || notChecked.Construct != "sh:sparql" || !strings.Contains(notChecked.Reason, "SERVICE") {
		t.Errorf("notChecked = %+v", notChecked)
	}
}

func TestRunSparqlConstraint_UnsafeFocusNodeIsNotCheckedNotRun(t *testing.T) {
	runner := &fakeRunner{answer: func(string) (graphdb.SelectResult, error) { return rowsResult(), nil }}
	_, notChecked := RunSparqlConstraint(context.Background(), runner, testConstraint, []string{"http://ex#ok", "http://ex/a b"}, DefaultSparqlLimits)
	if len(runner.queries) != 0 || notChecked == nil {
		t.Errorf("queries = %d, notChecked = %+v", len(runner.queries), notChecked)
	}
}

func TestRunSparqlConstraint_TimeoutReportsNotCheckedWithRuleId(t *testing.T) {
	runner := &fakeRunner{answer: nil}
	runner.answer = func(string) (graphdb.SelectResult, error) { return graphdb.SelectResult{}, context.DeadlineExceeded }
	limits := DefaultSparqlLimits
	limits.Timeout = 10 * time.Millisecond
	rows, notChecked := RunSparqlConstraint(context.Background(), runner, testConstraint, focusNodes(1), limits)
	if len(rows) != 0 || notChecked == nil || notChecked.RuleId != "AC-X" || !strings.Contains(notChecked.Reason, "timed out") {
		t.Errorf("rows = %+v, notChecked = %+v", rows, notChecked)
	}
}

func TestRunSparqlConstraint_RealDeadlineStopsABlockingRunner(t *testing.T) {
	blocking := blockingRunner{}
	limits := DefaultSparqlLimits
	limits.Timeout = 20 * time.Millisecond
	start := time.Now()
	_, notChecked := RunSparqlConstraint(context.Background(), blocking, testConstraint, focusNodes(1), limits)
	if time.Since(start) > 2*time.Second || notChecked == nil || !strings.Contains(notChecked.Reason, "timed out") {
		t.Errorf("elapsed = %v, notChecked = %+v", time.Since(start), notChecked)
	}
}

type blockingRunner struct{}

func (blockingRunner) Select(ctx context.Context, query string) (graphdb.SelectResult, error) {
	<-ctx.Done()
	return graphdb.SelectResult{}, fmt.Errorf("GraphDB unreachable: %w", ctx.Err())
}

func TestRunSparqlConstraint_OtherRunnerErrorIsNotChecked(t *testing.T) {
	runner := &fakeRunner{answer: func(string) (graphdb.SelectResult, error) {
		return graphdb.SelectResult{}, errors.New("GraphDB SELECT failed: status 500")
	}}
	rows, notChecked := RunSparqlConstraint(context.Background(), runner, testConstraint, focusNodes(1), DefaultSparqlLimits)
	if len(rows) != 0 || notChecked == nil || !strings.Contains(notChecked.Reason, "status 500") {
		t.Errorf("rows = %+v, notChecked = %+v", rows, notChecked)
	}
}

func TestRunSparqlConstraint_RowCapGivesNoFindingsAndOneNotChecked(t *testing.T) {
	runner := &fakeRunner{answer: func(string) (graphdb.SelectResult, error) {
		var rows []map[string]graphdb.Binding
		for i := 0; i < 30; i++ {
			rows = append(rows, map[string]graphdb.Binding{"this": uri(fmt.Sprintf("http://ex#n%03d", i))})
		}
		return rowsResult(rows...), nil
	}}
	limits := DefaultSparqlLimits
	limits.MaxRows = 50
	rows, notChecked := RunSparqlConstraint(context.Background(), runner, testConstraint, focusNodes(300), limits)
	if len(rows) != 0 || notChecked == nil || !strings.Contains(notChecked.Reason, "50") {
		t.Errorf("rows = %d, notChecked = %+v, want no findings and the cap in the reason", len(rows), notChecked)
	}
	if len(runner.queries) != 2 {
		t.Errorf("queries = %d, want to stop after the batch that crossed the cap (2)", len(runner.queries))
	}
}
