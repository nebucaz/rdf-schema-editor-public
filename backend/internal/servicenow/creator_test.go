package servicenow

import (
	"context"
	"strings"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/issues"
)

type staticGraph struct{ values []string }

func (g staticGraph) Select(context.Context, string) (graphdb.SelectResult, error) {
	var r graphdb.SelectResult
	for _, v := range g.values {
		r.Results.Bindings = append(r.Results.Bindings, map[string]graphdb.Binding{"v": {Value: v}})
	}
	return r, nil
}

const findingID = "abcdefghij234567"

func creatorFor(t *testing.T, g staticGraph, routing RoutingSettings) (*Creator, func(string) (map[string]string, bool)) {
	t.Helper()
	c, fake := basicClient(t)
	s := Settings{BaseURL: fake.URL, File: FileSettings{StateMap: defaultStateMap(), Routing: routing}}
	return NewCreator(c, NewRouter(routing, g), s), fake.Record
}

func sampleIssue() issues.Issue {
	v := "no-owner"
	return issues.Issue{
		ID: findingID, IndividualIri: "http://example.org/o#app1", IndividualLabel: "App One", RuleId: "arm-s:7", ShapeIri: "http://example.org/o/shapes#S",
		Message: "owner missing", Value: &v, Path: "http://example.org/o#owner", Constraint: "minCount", QualityDimension: "completeness",
	}
}

func TestCreatorOpensAnIncidentWithRoutingSnapshotAndDeepLink(t *testing.T) {
	routing := RoutingSettings{PredicateIRI: "http://example.org/o#owner", FallbackGroup: "Fallback", Map: map[string]RouteEntry{
		"http://example.org/o#team": {AssignmentGroup: "Data Team", Contact: "jdoe", Category: "software", Impact: "2", Urgency: "2"},
	}}
	cr, record := creatorFor(t, staticGraph{values: []string{"http://example.org/o#team"}}, routing)
	rt, err := cr.Route(context.Background(), sampleIssue())
	if err != nil || rt.Blocked || rt.AssignmentGroup != "Data Team" {
		t.Fatalf("route = %+v err %v", rt, err)
	}
	tk, err := cr.CreateTicket(context.Background(), issues.TicketRequest{
		Issue: sampleIssue(), CorrelationID: findingID + "-2", PreviousNumber: "INC0000009", Routing: rt,
		DeepLink: "https://rse.example/workbench/validation?finding=" + findingID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if tk.CorrelationID != findingID+"-2" || !strings.HasPrefix(tk.Number, "INC") || tk.SysID == "" || tk.State != "1" || tk.URL == "" || tk.CreatedAt == "" {
		t.Errorf("ticket = %+v", tk)
	}
	rec, ok := record(tk.SysID)
	if !ok {
		t.Fatal("no record")
	}
	for field, want := range map[string]string{
		"correlation_id": findingID + "-2", "assignment_group": "Data Team", "caller_id": "jdoe", "category": "software", "impact": "2", "urgency": "2",
	} {
		if rec[field] != want {
			t.Errorf("%s = %q, want %q", field, rec[field], want)
		}
	}
	if !strings.Contains(rec["short_description"], "arm-s:7") || !strings.Contains(rec["short_description"], "App One") {
		t.Errorf("short_description = %q", rec["short_description"])
	}
	for _, want := range []string{"owner missing", "no-owner", "http://example.org/o/shapes#S", "https://rse.example/workbench/validation?finding=" + findingID, "INC0000009"} {
		if !strings.Contains(rec["description"], want) {
			t.Errorf("description lacks %q:\n%s", want, rec["description"])
		}
	}
}

func TestCreatorFindsByCorrelationPrefixAndKnowsClosedStates(t *testing.T) {
	cr, _ := creatorFor(t, staticGraph{}, RoutingSettings{FallbackGroup: "F", Unrouted: UnroutedFallback})
	rt, err := cr.Route(context.Background(), sampleIssue())
	if err != nil || rt.Blocked || rt.AssignmentGroup != "F" || rt.UnroutedReason == "" {
		t.Fatalf("fallback route = %+v err %v", rt, err)
	}
	if _, err := cr.CreateTicket(context.Background(), issues.TicketRequest{Issue: sampleIssue(), CorrelationID: findingID, Routing: rt}); err != nil {
		t.Fatal(err)
	}
	found, err := cr.FindTickets(context.Background(), findingID)
	if err != nil || len(found) != 1 || found[0].CorrelationID != findingID || found[0].Number == "" {
		t.Errorf("found = %+v err %v", found, err)
	}
	if cr.TicketClosed("1") || cr.TicketClosed("2") || !cr.TicketClosed("6") || !cr.TicketClosed("7") || !cr.TicketClosed("8") {
		t.Error("closed states must be the ones mapped to resolved or wontfix")
	}
	blocked := NewCreator(nil, NewRouter(RoutingSettings{}, staticGraph{}), Settings{File: FileSettings{StateMap: defaultStateMap()}})
	if rt, _ := blocked.Route(context.Background(), sampleIssue()); !rt.Blocked {
		t.Errorf("an unrouted finding must be blocked by default: %+v", rt)
	}
}
