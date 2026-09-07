package sync

import (
	"strings"
	"testing"
)

func TestMappedAttributeOps_ScalarFieldWritesSingleTriple(t *testing.T) {
	prop := "http://ld.example.org/schema#componentType"
	mapping := map[string]SourceFieldMapping{prop: {Path: "spec.type", Repeatable: false}}
	entity := Entity{UID: "abc-1", Fields: map[string]string{"spec.type": "service"}}

	ops, failures := mappedAttributeOps("http://ld.example.org/backstage", "http://ld.example.org/backstage#backstage-abc-1", mapping, entity)
	if len(failures) != 0 {
		t.Fatalf("failures = %v, want none", failures)
	}
	wantDelete := `DELETE WHERE { GRAPH <http://ld.example.org/backstage> { <http://ld.example.org/backstage#backstage-abc-1> <http://ld.example.org/schema#componentType> ?o } }`
	wantInsert := `INSERT DATA { GRAPH <http://ld.example.org/backstage> { <http://ld.example.org/backstage#backstage-abc-1> <http://ld.example.org/schema#componentType> "service" . } }`
	if len(ops) != 2 || ops[0] != wantDelete || ops[1] != wantInsert {
		t.Errorf("ops = %v, want [%q, %q]", ops, wantDelete, wantInsert)
	}
}

func TestMappedAttributeOps_ArrayFieldAgainstRepeatablePropertyWritesOnePerElement(t *testing.T) {
	prop := "http://ld.example.org/schema#tags"
	mapping := map[string]SourceFieldMapping{prop: {Path: "spec.tags", Repeatable: true}}
	entity := Entity{UID: "abc-1", FieldLists: map[string][]string{"spec.tags": {"payments", "critical"}}}

	ops, failures := mappedAttributeOps("http://ld.example.org/backstage", "http://ld.example.org/backstage#backstage-abc-1", mapping, entity)
	if len(failures) != 0 {
		t.Fatalf("failures = %v, want none", failures)
	}
	// 1 DELETE + 2 INSERTs (one per array element).
	if len(ops) != 3 {
		t.Fatalf("ops = %v, want 3 ops (1 delete + 2 inserts)", ops)
	}
	wantFirst := `INSERT DATA { GRAPH <http://ld.example.org/backstage> { <http://ld.example.org/backstage#backstage-abc-1> <http://ld.example.org/schema#tags> "payments" . } }`
	wantSecond := `INSERT DATA { GRAPH <http://ld.example.org/backstage> { <http://ld.example.org/backstage#backstage-abc-1> <http://ld.example.org/schema#tags> "critical" . } }`
	if ops[1] != wantFirst || ops[2] != wantSecond {
		t.Errorf("ops[1:] = %v, want [%q, %q]", ops[1:], wantFirst, wantSecond)
	}
}

func TestMappedAttributeOps_ArrayAgainstNonRepeatablePropertyWritesNothingAndReportsFailure(t *testing.T) {
	prop := "http://ld.example.org/schema#tags"
	mapping := map[string]SourceFieldMapping{prop: {Path: "spec.tags", Repeatable: false}}
	entity := Entity{UID: "abc-1", FieldLists: map[string][]string{"spec.tags": {"payments", "critical"}}}

	ops, failures := mappedAttributeOps("http://ld.example.org/backstage", "http://ld.example.org/backstage#backstage-abc-1", mapping, entity)
	// The predicate is still cleared (DELETE WHERE) — no INSERT is issued.
	if len(ops) != 1 {
		t.Errorf("ops = %v, want exactly 1 op (the DELETE WHERE clear, no INSERT)", ops)
	}
	if len(failures) != 1 {
		t.Fatalf("failures = %v, want exactly 1 mapping failure", failures)
	}
}

func TestMappedAttributeOps_AbsentOrEmptyFieldWritesNoTriple(t *testing.T) {
	prop := "http://ld.example.org/schema#componentType"
	mapping := map[string]SourceFieldMapping{prop: {Path: "spec.type", Repeatable: false}}

	absent := Entity{UID: "abc-1", Fields: map[string]string{}}
	ops, failures := mappedAttributeOps("http://ld.example.org/backstage", "http://ld.example.org/backstage#backstage-abc-1", mapping, absent)
	if len(failures) != 0 {
		t.Errorf("failures = %v, want none for an absent field", failures)
	}
	if len(ops) != 1 {
		t.Errorf("ops = %v, want exactly 1 op (the DELETE WHERE clear, no INSERT) for an absent field", ops)
	}

	empty := Entity{UID: "abc-1", Fields: map[string]string{"spec.type": ""}}
	ops, failures = mappedAttributeOps("http://ld.example.org/backstage", "http://ld.example.org/backstage#backstage-abc-1", mapping, empty)
	if len(failures) != 0 {
		t.Errorf("failures = %v, want none for an empty field", failures)
	}
	if len(ops) != 1 {
		t.Errorf("ops = %v, want exactly 1 op (the DELETE WHERE clear, no INSERT) for an empty field", ops)
	}
}

func TestRepresentsOps_TargetSetWritesDeleteAndInsert(t *testing.T) {
	ops := representsOps(
		"http://ld.example.org/backstage",
		"http://ld.example.org/backstage#backstage-abc-1",
		"http://ld.example.org/schema#represents",
		"http://ld.example.org/core#App-123",
	)
	wantDelete := `DELETE WHERE { GRAPH <http://ld.example.org/backstage> { <http://ld.example.org/backstage#backstage-abc-1> <http://ld.example.org/schema#represents> ?o } }`
	wantInsert := `INSERT DATA { GRAPH <http://ld.example.org/backstage> { <http://ld.example.org/backstage#backstage-abc-1> <http://ld.example.org/schema#represents> <http://ld.example.org/core#App-123> . } }`
	if len(ops) != 2 || ops[0] != wantDelete || ops[1] != wantInsert {
		t.Errorf("ops = %v, want [%q, %q]", ops, wantDelete, wantInsert)
	}
}

func TestRepresentsOps_EmptyTargetOnlyClears(t *testing.T) {
	ops := representsOps(
		"http://ld.example.org/backstage",
		"http://ld.example.org/backstage#backstage-abc-1",
		"http://ld.example.org/schema#represents",
		"",
	)
	if len(ops) != 1 {
		t.Errorf("ops = %v, want exactly 1 op (the DELETE WHERE clear, no INSERT)", ops)
	}
}

func TestMergeWriteOps_WritesSyncSourceRefMarkerWhenSet(t *testing.T) {
	vocab := Vocabulary{
		SyncSourcePredicateIRI:    "http://ld.example.org/schema#syncSource",
		SyncSourceRefPredicateIRI: "http://ld.example.org/schema#syncSourceRef",
		SyncStatusPredicateIRI:    "http://ld.example.org/schema#syncStatus",
	}
	ops := mergeWriteOps(vocab, "http://ld.example.org/backstage", "http://ld.example.org/backstage#backstage-team-1",
		"http://ld.example.org/schema#Group", "Payments Team", "backstage", "group:default/payments-team", "http://ld.example.org/backstage#Activity1")

	wantDelete := `DELETE WHERE { GRAPH <http://ld.example.org/backstage> { <http://ld.example.org/backstage#backstage-team-1> <http://ld.example.org/schema#syncSourceRef> ?o } }`
	found := false
	for _, op := range ops {
		if op == wantDelete {
			found = true
		}
	}
	if !found {
		t.Errorf("ops = %v, want a DELETE WHERE clearing rse:syncSourceRef", ops)
	}

	wantInsert := `INSERT DATA { GRAPH <http://ld.example.org/backstage> { <http://ld.example.org/backstage#backstage-team-1> <http://ld.example.org/schema#syncSourceRef> "group:default/payments-team" . } }`
	if ops[len(ops)-1] != wantInsert {
		t.Errorf("ops[last] = %q, want %q", ops[len(ops)-1], wantInsert)
	}
}

func TestMergeWriteOps_EmptySourceRefOnlyClears(t *testing.T) {
	vocab := Vocabulary{
		SyncSourcePredicateIRI:    "http://ld.example.org/schema#syncSource",
		SyncSourceRefPredicateIRI: "http://ld.example.org/schema#syncSourceRef",
		SyncStatusPredicateIRI:    "http://ld.example.org/schema#syncStatus",
	}
	ops := mergeWriteOps(vocab, "http://ld.example.org/backstage", "http://ld.example.org/backstage#backstage-abc-1",
		"http://ld.example.org/schema#Component", "Payments API", "backstage", "", "http://ld.example.org/backstage#Activity1")

	for _, op := range ops {
		if strings.Contains(op, "syncSourceRef") && strings.HasPrefix(op, "INSERT") {
			t.Errorf("ops = %v, expected no INSERT for rse:syncSourceRef when sourceRef is empty", ops)
		}
	}
}

func TestMappedAttributeOps_DeterministicOrderAcrossMultipleProperties(t *testing.T) {
	mapping := map[string]SourceFieldMapping{
		"http://ld.example.org/schema#zField": {Path: "spec.z", Repeatable: false},
		"http://ld.example.org/schema#aField": {Path: "spec.a", Repeatable: false},
	}
	entity := Entity{UID: "abc-1", Fields: map[string]string{"spec.z": "z", "spec.a": "a"}}

	ops1, _ := mappedAttributeOps("g", "i", mapping, entity)
	ops2, _ := mappedAttributeOps("g", "i", mapping, entity)
	if len(ops1) != 4 {
		t.Fatalf("ops1 = %v, want 4 ops", ops1)
	}
	for i := range ops1 {
		if ops1[i] != ops2[i] {
			t.Fatalf("op order not deterministic across calls: %v vs %v", ops1, ops2)
		}
	}
	// aField sorts before zField.
	if ops1[0] != `DELETE WHERE { GRAPH <g> { <i> <http://ld.example.org/schema#aField> ?o } }` {
		t.Errorf("ops1[0] = %q, want the aField delete first (alphabetical)", ops1[0])
	}
}
