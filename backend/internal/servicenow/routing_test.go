package servicenow

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
)

const (
	pred    = "https://example.org/schema#authoritativeEntity"
	finance = "https://example.org/org#Finance"
	hr      = "https://example.org/org#HR"
	ind     = "https://example.org/data#app1"
)

type fakeGraph struct {
	values  []string
	err     error
	queries []string
}

func (g *fakeGraph) Select(_ context.Context, q string) (graphdb.SelectResult, error) {
	g.queries = append(g.queries, q)
	var r graphdb.SelectResult
	for _, v := range g.values {
		r.Results.Bindings = append(r.Results.Bindings, map[string]graphdb.Binding{"v": {Value: v}})
	}
	return r, g.err
}

func testSettings() RoutingSettings {
	return RoutingSettings{
		PredicateIRI: pred, FallbackGroup: "Data Stewardship", Unrouted: UnroutedBlock,
		Map: map[string]RouteEntry{
			finance:   {AssignmentGroup: "Finance Apps", Contact: "jdoe", Category: "software", Impact: "2", Urgency: "2"},
			hr:        {AssignmentGroup: "HR Apps"},
			"default": {Category: "inquiry", Impact: "3", Urgency: "3"},
		},
	}
}

func TestAnEntityRoutesToTheMappedGroupContactAndPriority(t *testing.T) {
	g := &fakeGraph{values: []string{finance}}
	r, err := NewRouter(testSettings(), g).Route(context.Background(), ind)
	if err != nil {
		t.Fatal(err)
	}
	want := Routing{AssignmentGroup: "Finance Apps", Contact: "jdoe", Category: "software", Impact: "2", Urgency: "2"}
	if r.Unrouted != nil || r.AssignmentGroup != want.AssignmentGroup || r.Contact != want.Contact || r.Category != want.Category || r.Impact != want.Impact || r.Urgency != want.Urgency {
		t.Errorf("routing = %+v", r)
	}
	if !strings.Contains(g.queries[0], "<"+ind+">") || !strings.Contains(g.queries[0], "<"+pred+">") {
		t.Errorf("query = %s", g.queries[0])
	}
}

func TestEntityWithoutOwnCategoryTakesTheDefaultEntry(t *testing.T) {
	r, _ := NewRouter(testSettings(), &fakeGraph{values: []string{hr}}).Route(context.Background(), ind)
	if r.AssignmentGroup != "HR Apps" || r.Category != "inquiry" || r.Impact != "3" || r.Urgency != "3" || r.Unrouted != nil {
		t.Errorf("routing = %+v", r)
	}
}

func TestUnroutedFindingsGetTheFallbackGroupAndAReason(t *testing.T) {
	cases := map[string]struct {
		s      RoutingSettings
		values []string
	}{
		"no predicate":      {func() RoutingSettings { s := testSettings(); s.PredicateIRI = ""; return s }(), []string{finance}},
		"no value":          {testSettings(), nil},
		"entity not mapped": {testSettings(), []string{"https://example.org/org#Unknown"}},
	}
	for name, c := range cases {
		g := &fakeGraph{values: c.values}
		r, err := NewRouter(c.s, g).Route(context.Background(), ind)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if r.Unrouted == nil || r.Unrouted.Reason == "" || r.AssignmentGroup != "Data Stewardship" || !r.Blocked {
			t.Errorf("%s: routing = %+v", name, r)
		}
		if r.Category != "inquiry" || r.Impact != "3" {
			t.Errorf("%s: unrouted still needs category and priority: %+v", name, r)
		}
		if name == "no predicate" && len(g.queries) != 0 {
			t.Error("no predicate must not query the graph")
		}
	}
	s := testSettings()
	s.Unrouted = UnroutedFallback
	r, _ := NewRouter(s, &fakeGraph{}).Route(context.Background(), ind)
	if r.Unrouted == nil || r.Blocked {
		t.Errorf("fallback mode must not block: %+v", r)
	}
}

func TestMultipleValuesRouteByTheFirstSortedAndWarn(t *testing.T) {
	r, err := NewRouter(testSettings(), &fakeGraph{values: []string{hr, finance}}).Route(context.Background(), ind)
	if err != nil {
		t.Fatal(err)
	}
	if r.AssignmentGroup != "Finance Apps" || len(r.Warnings) != 1 || !strings.Contains(r.Warnings[0], "2") {
		t.Errorf("routing = %+v", r)
	}
}

func TestRouteRefusesAnUnsafeIndividualAndReportsGraphErrors(t *testing.T) {
	if _, err := NewRouter(testSettings(), &fakeGraph{}).Route(context.Background(), "a>b"); err == nil {
		t.Error("unsafe IRI must be refused")
	}
	boom := errors.New("graphdb down")
	if _, err := NewRouter(testSettings(), &fakeGraph{err: boom}).Route(context.Background(), ind); !errors.Is(err, boom) {
		t.Errorf("err = %v", err)
	}
}

func TestBadRoutingConfigIsRefused(t *testing.T) {
	bad := map[string]func(*RoutingSettings){
		"unsafe predicate":   func(s *RoutingSettings) { s.PredicateIRI = "https://x/a>b" },
		"unsafe map key":     func(s *RoutingSettings) { s.Map["https://x/<y"] = RouteEntry{} },
		"unknown mode":       func(s *RoutingSettings) { s.Unrouted = "shrug" },
		"fallback no group":  func(s *RoutingSettings) { s.Unrouted, s.FallbackGroup = UnroutedFallback, "" },
		"bad impact":         func(s *RoutingSettings) { s.Map[finance] = RouteEntry{Impact: "high"} },
		"relative predicate": func(s *RoutingSettings) { s.PredicateIRI = "authoritativeEntity" },
	}
	for name, mutate := range bad {
		s := testSettings()
		mutate(&s)
		if err := s.Validate(); err == nil {
			t.Errorf("%s: want an error", name)
		}
	}
	if err := testSettings().Validate(); err != nil {
		t.Errorf("good config refused: %v", err)
	}
	if err := (RoutingSettings{}).Validate(); err != nil {
		t.Errorf("empty routing must be valid (fallback only): %v", err)
	}
}

func TestRoutingComesFromTheConfigFileAndABadOneRefusesStartup(t *testing.T) {
	file := `{"routing":{"predicateIri":"` + pred + `","fallbackGroup":"G","map":{"` + finance + `":{"assignmentGroup":"Finance Apps"}}}}`
	s, err := LoadSettings(env(map[string]string{
		"SERVICENOW_BASE_URL": "https://x.service-now.com", "SERVICENOW_AUTH": "basic", "SERVICENOW_USER": "u", "SERVICENOW_PASSWORD": "p", "SERVICENOW_CONFIG_FILE": "f",
	}), func(string) ([]byte, error) { return []byte(file), nil })
	if err != nil || s.File.Routing.Map[finance].AssignmentGroup != "Finance Apps" || s.File.Routing.Unrouted != UnroutedBlock {
		t.Fatalf("settings = %+v, err = %v", s.File.Routing, err)
	}
	bad := `{"routing":{"predicateIri":"https://x/a b"}}`
	if _, err := LoadSettings(env(map[string]string{
		"SERVICENOW_BASE_URL": "https://x.service-now.com", "SERVICENOW_AUTH": "basic", "SERVICENOW_USER": "u", "SERVICENOW_PASSWORD": "p", "SERVICENOW_CONFIG_FILE": "f",
	}), func(string) ([]byte, error) { return []byte(bad), nil }); err == nil {
		t.Error("an unsafe routing IRI must refuse startup")
	}
}
