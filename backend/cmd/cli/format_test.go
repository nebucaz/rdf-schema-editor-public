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
