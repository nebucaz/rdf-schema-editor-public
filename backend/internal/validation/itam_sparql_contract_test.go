package validation

// Contract test of the SPARQL-based ITAM findings (spec/shacl-test STORY-357).
//
// What it proves: for the five real `sh:select` texts of the ITAM shapes (from the golden snapshot),
// the engine sends every Applikationskomponente to the runner exactly once per constraint (in a
// VALUES batch, nothing skipped, no other class), and canned rows built from the `engine: sparql`
// entries of examples/itam-shapes/itam-expected.json come out as exactly those findings, with rule
// id, path and the shape's message.
//
// What it does NOT prove: that the SPARQL texts themselves return the right rows (regex escaping,
// joins, FILTER semantics). There is no SPARQL engine in the test setup. That is checked by the
// human against GraphDB with the runbook (story 360), and the result decides the shape-defect
// questions.

import (
	"context"
	"regexp"
	"strings"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
)

const itamAppClass = "https://lida.pnet.ch/arm/schema#Applikationskomponente"

var valuesClause = regexp.MustCompile(`\s*VALUES \$this \{([^}]*)\}`)

// itamCannedRunner answers each batch with the rows the expected table lists for that constraint,
// restricted to the batch's focus nodes, and records the batches per rule id.
type itamCannedRunner struct {
	t       *testing.T
	rules   map[string]string // select text -> rule id
	want    map[string][]expectedFinding
	batches map[string][][]string
}

func (r *itamCannedRunner) Select(ctx context.Context, query string) (graphdb.SelectResult, error) {
	m := valuesClause.FindStringSubmatchIndex(query)
	if m == nil {
		r.t.Fatalf("query without a VALUES $this clause: %s", query)
	}
	var focus []string
	for _, iri := range regexp.MustCompile(`<([^>]*)>`).FindAllStringSubmatch(query[m[2]:m[3]], -1) {
		focus = append(focus, iri[1])
	}
	original := query[:m[0]] + query[m[1]:]
	rule, ok := r.rules[original]
	if !ok {
		r.t.Fatalf("query is not one of the stored selects (with the VALUES clause removed): %s", original)
	}
	r.batches[rule] = append(r.batches[rule], focus)

	inBatch := map[string]bool{}
	for _, f := range focus {
		inBatch[f] = true
	}
	var rows []map[string]graphdb.Binding
	for _, f := range r.want[rule] {
		if inBatch[f.Individual] {
			row := map[string]graphdb.Binding{"this": uri(f.Individual), "path": uri(f.Path)}
			if f.Value != nil {
				row["value"] = literal(*f.Value)
				if strings.HasPrefix(*f.Value, "https://lida.pnet.ch/") {
					row["value"] = uri(*f.Value)
				}
			}
			rows = append(rows, row)
		}
	}
	return rowsResult(rows...), nil
}

func newItamCannedRunner(t *testing.T, snapshot ValidationSnapshot) *itamCannedRunner {
	r := &itamCannedRunner{t: t, rules: map[string]string{}, want: map[string][]expectedFinding{}, batches: map[string][][]string{}}
	for _, c := range snapshot.SparqlConstraints {
		r.rules[c.Select] = c.RuleId
	}
	for _, f := range loadItamExpected(t, "sparql") {
		r.want[f.RuleId] = append(r.want[f.RuleId], f)
	}
	return r
}

func TestItamSparql_CannedRowsGiveExactlyTheExpectedSparqlFindings(t *testing.T) {
	snapshot := loadItamSnapshot(t)
	if len(snapshot.SparqlConstraints) != 5 {
		t.Fatalf("snapshot has %d sh:sparql constraints, want 5", len(snapshot.SparqlConstraints))
	}
	want := loadItamExpected(t, "sparql")
	if len(want) != 15 {
		t.Fatalf("expected file lists %d sparql findings, want 15", len(want))
	}
	runner := newItamCannedRunner(t, snapshot)

	violations, notChecked := CheckSparql(context.Background(), runner, snapshot)
	if len(notChecked) != 0 {
		t.Fatalf("notChecked = %+v, want none: all five ITAM selects pass the guard", notChecked)
	}
	missing, extra := diffFindings(want, violations)
	if len(missing) > 0 || len(extra) > 0 {
		t.Errorf("missing findings:\n  %s\nextra findings:\n  %s", strings.Join(missing, "\n  "), strings.Join(extra, "\n  "))
	}
	for _, v := range violations {
		if v.Message == "" || v.QualityDimension == "" || v.TypeIri != itamAppClass {
			t.Errorf("violation lacks message, dimension or type: %+v", v)
		}
	}
}

func TestItamSparql_EveryApplikationskomponenteIsInExactlyOneBatchPerConstraint(t *testing.T) {
	snapshot := loadItamSnapshot(t)
	runner := newItamCannedRunner(t, snapshot)
	CheckSparql(context.Background(), runner, snapshot)

	var components []string
	for individual, types := range snapshot.IndividualTypes {
		for _, typ := range types {
			if typ == itamAppClass {
				components = append(components, individual)
			}
		}
	}
	if len(components) != 22 {
		t.Fatalf("snapshot has %d application components, want 22", len(components))
	}
	if len(runner.batches) != 5 {
		t.Fatalf("batches for %d rules, want 5", len(runner.batches))
	}
	for rule, batches := range runner.batches {
		count := map[string]int{}
		for _, batch := range batches {
			for _, f := range batch {
				count[f]++
			}
		}
		if len(count) != len(components) {
			t.Errorf("%s: %d distinct focus nodes, want %d", rule, len(count), len(components))
		}
		for _, c := range components {
			if count[c] != 1 {
				t.Errorf("%s: %s is in %d batches, want exactly 1", rule, c, count[c])
			}
		}
	}
}

func TestItamSparql_AnEmptyAnswerGivesNoFindings(t *testing.T) {
	snapshot := loadItamSnapshot(t)
	runner := newItamCannedRunner(t, snapshot)
	runner.want = map[string][]expectedFinding{}
	violations, notChecked := CheckSparql(context.Background(), runner, snapshot)
	if len(violations) != 0 || len(notChecked) != 0 {
		t.Errorf("violations = %+v, notChecked = %+v", violations, notChecked)
	}
}

func TestItam_InMemoryAndSparqlFindingsPartitionTheExpectedTable(t *testing.T) {
	inMemory, sparql := loadItamExpected(t, "inMemory"), loadItamExpected(t, "sparql")
	if len(inMemory) != 7 || len(sparql) != 15 {
		t.Fatalf("in-memory = %d, sparql = %d, want 7 and 15", len(inMemory), len(sparql))
	}
	seen := map[string]bool{}
	for _, f := range append(inMemory, sparql...) {
		if seen[f.key()] {
			t.Errorf("finding listed twice or under both engines: %s", f.key())
		}
		seen[f.key()] = true
	}
	if len(seen) != 22 {
		t.Errorf("distinct findings = %d, want 22", len(seen))
	}
}

func TestItam_WholeReportEqualsTheExpectedTable(t *testing.T) {
	snapshot := loadItamSnapshot(t)
	result := CheckAll(context.Background(), newItamCannedRunner(t, snapshot), snapshot)
	var all []expectedFinding
	all = append(all, loadItamExpected(t, "inMemory")...)
	all = append(all, loadItamExpected(t, "sparql")...)
	missing, extra := diffFindings(all, result.Violations)
	if len(missing) > 0 || len(extra) > 0 {
		t.Errorf("missing findings:\n  %s\nextra findings:\n  %s", strings.Join(missing, "\n  "), strings.Join(extra, "\n  "))
	}
}

func TestItam_WholeReportCarriesTheExpectedValueOfEveryFinding(t *testing.T) {
	snapshot := loadItamSnapshot(t)
	result := CheckAll(context.Background(), newItamCannedRunner(t, snapshot), snapshot)
	var all []expectedFinding
	all = append(all, loadItamExpected(t, "inMemory")...)
	all = append(all, loadItamExpected(t, "sparql")...)
	if differs := diffValues(all, result.Violations); len(differs) > 0 {
		t.Errorf("values differ:\n  %s", strings.Join(differs, "\n  "))
	}
}
