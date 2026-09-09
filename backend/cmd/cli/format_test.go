package main

import (
	"bytes"
	"strings"
	"testing"
)

// TestPrintSync_ReportsRepresentsAndRelationCounts proves `sync`'s console output surfaces the
// represents-link/relation-edge activity the backend already computes (SyncSummary's
// RepresentsSynced/RepresentsFailures/RelationsSynced/SkippedRelations) — previously silently
// dropped since syncResponse didn't declare these fields at all.
func TestPrintSync_ReportsRepresentsAndRelationCounts(t *testing.T) {
	resp := syncResponse{
		Source:             "backstage",
		DryRun:             true,
		SyncedPerKind:      map[string]int{"Component": 3},
		Mapping:            map[string]string{"Component": "core:Application"},
		RepresentsSynced:   2,
		RepresentsFailures: []string{"abc-1: enterprise.catalog.iri does not resolve to any known individual"},
		RelationsSynced:    5,
		SkippedRelations:   []string{"abc-1: relation type \"ownedBy\" has no rse:sourceRelation mapping on <core:Application> — skipped"},
	}

	var out bytes.Buffer
	printSync(&out, "backstage", resp)
	got := out.String()

	if !strings.Contains(got, "Represents links: 2 written, 1 failed") {
		t.Errorf("stdout missing represents-links summary line: %s", got)
	}
	if !strings.Contains(got, "enterprise.catalog.iri does not resolve") {
		t.Errorf("stdout missing represents-failure detail: %s", got)
	}
	if !strings.Contains(got, "Relation edges: 5 written, 1 skipped") {
		t.Errorf("stdout missing relation-edges summary line: %s", got)
	}
	if !strings.Contains(got, `relation type "ownedBy" has no rse:sourceRelation mapping`) {
		t.Errorf("stdout missing skipped-relation detail: %s", got)
	}
}

// TestPrintSync_FallbackNamespaceKindReportedDistinctlyFromUnmapped proves a kind that's mapped to a
// class with no Concept Namespace (1) still shows its real class and its *actual* synced count in the
// main table, annotated as having used the class's own namespace as a fallback, (2) is never listed
// among the "unmapped: kind has no local class" rows, and (3) gets its own distinct summary line —
// guards against the bug where the same kind appeared as both mapped and unmapped in one run, and
// against a fallback silently looking identical to a real Concept Namespace resolution.
func TestPrintSync_FallbackNamespaceKindReportedDistinctlyFromUnmapped(t *testing.T) {
	resp := syncResponse{
		Source:                 "backstage",
		DryRun:                 true,
		SyncedPerKind:          map[string]int{"System": 1, "Component": 3},
		Mapping:                map[string]string{"System": "core:System", "Component": "core:Application"},
		FallbackNamespaceKinds: []string{"Component"},
	}

	var out bytes.Buffer
	printSync(&out, "backstage", resp)
	got := out.String()

	if !strings.Contains(got, "core:Application") || !strings.Contains(got, "3 individuals   (no Concept Namespace — used the class's own namespace)") {
		t.Errorf("stdout missing Component's fallback-namespace row with its real synced count: %s", got)
	}
	if strings.Contains(got, "unmapped: kind has no local class") {
		t.Errorf("stdout wrongly lists Component as unmapped (it has a class, just no Concept Namespace): %s", got)
	}
	if !strings.Contains(got, "1 kind(s) used their class's own namespace (no Concept Namespace configured): Component") {
		t.Errorf("stdout missing the fallback-namespace summary line: %s", got)
	}
	if !strings.Contains(got, "2 kinds mapped, 0 kinds unmapped") {
		t.Errorf("stdout should still count Component among mapped kinds: %s", got)
	}
}

// TestPrintSync_ZeroRepresentsAndRelationsStillReported proves a source that never uses
// represents-links or upstream relations still gets an explicit "0 written, 0 failed/skipped" line
// rather than silence — the whole point being that "nothing happened" is itself information the
// user shouldn't have to infer from an absent section.
func TestPrintSync_ZeroRepresentsAndRelationsStillReported(t *testing.T) {
	resp := syncResponse{
		Source:        "backstage",
		DryRun:        true,
		SyncedPerKind: map[string]int{"Component": 3},
		Mapping:       map[string]string{"Component": "core:Application"},
	}

	var out bytes.Buffer
	printSync(&out, "backstage", resp)
	got := out.String()

	if !strings.Contains(got, "Represents links: 0 written, 0 failed") {
		t.Errorf("stdout missing zero represents-links line: %s", got)
	}
	if !strings.Contains(got, "Relation edges: 0 written, 0 skipped") {
		t.Errorf("stdout missing zero relation-edges line: %s", got)
	}
}
