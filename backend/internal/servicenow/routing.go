package servicenow

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/sparqlsafe"
)

// What to do with a finding whose identity has no authoritative entity (research Q10).
const (
	// UnroutedBlock refuses to create the ticket (default); UnroutedFallback sends it to the fallback group.
	UnroutedBlock    = "block"
	UnroutedFallback = "fallback"
)

// defaultEntryKey is the map entry that supplies category, impact and urgency when an entity has none.
const defaultEntryKey = "default"

// Last-resort ticket values when neither the entity nor the `default` entry says: ServiceNow's own
// defaults for a new incident.
const (
	fallbackCategory = "inquiry"
	fallbackImpact   = "3"
	fallbackUrgency  = "3"
)

var priorityPattern = regexp.MustCompile(`^[1-9]$`)

// RouteEntry is what one authoritative entity (or `default`) contributes to a ticket. Contact is a
// ServiceNow `user_name`, Impact and Urgency the stored values 1..3.
type RouteEntry struct {
	AssignmentGroup string `json:"assignmentGroup"`
	Contact         string `json:"contact"`
	Category        string `json:"category"`
	Impact          string `json:"impact"`
	Urgency         string `json:"urgency"`
}

// RoutingSettings is the `routing` section of the config file. The authoritative-entity predicate is not
// decided yet (research Q10): with PredicateIRI empty every finding is unrouted and goes to FallbackGroup.
type RoutingSettings struct {
	PredicateIRI  string                `json:"predicateIri"`
	FallbackGroup string                `json:"fallbackGroup"`
	Unrouted      string                `json:"unrouted"` // UnroutedBlock (default) | UnroutedFallback
	Map           map[string]RouteEntry `json:"map"`      // keyed by entity IRI, plus "default"
}

// Validate checks every IRI with the SPARQL IRI guard (they are spliced into a query) and the shape of
// the rest; a bad routing configuration refuses startup.
func (s RoutingSettings) Validate() error {
	absolute := func(what, iri string) error {
		if err := sparqlsafe.AssertSafeIRI(iri, what); err != nil {
			return err
		}
		if u, err := url.Parse(iri); err != nil || u.Scheme == "" {
			return fmt.Errorf("Invalid %s: not an absolute IRI", what)
		}
		return nil
	}
	if s.PredicateIRI != "" {
		if err := absolute("routing predicateIri", s.PredicateIRI); err != nil {
			return err
		}
	}
	switch s.Unrouted {
	case "", UnroutedBlock:
	case UnroutedFallback:
		if s.FallbackGroup == "" {
			return fmt.Errorf("routing.unrouted=fallback requires routing.fallbackGroup")
		}
	default:
		return fmt.Errorf("routing.unrouted must be %q or %q", UnroutedBlock, UnroutedFallback)
	}
	for key, e := range s.Map {
		if key != defaultEntryKey {
			if err := absolute("routing map key", key); err != nil {
				return err
			}
		}
		for _, v := range []string{e.AssignmentGroup, e.Contact, e.Category} {
			if len(v) > 200 || strings.ContainsAny(v, "\n\r") {
				return fmt.Errorf("routing map entry %q has an invalid value", key)
			}
		}
		for _, v := range []string{e.Impact, e.Urgency} {
			if v != "" && !priorityPattern.MatchString(v) {
				return fmt.Errorf("routing map entry %q: impact and urgency are ServiceNow values such as 1, 2 or 3", key)
			}
		}
	}
	return nil
}

// Routing is where a ticket goes. Unrouted is set when the finding's identity gave no authoritative
// entity; AssignmentGroup is then the fallback group and Blocked says whether creation must be refused.
type Routing struct {
	AssignmentGroup, Contact, Category, Impact, Urgency string
	Unrouted                                            *Unrouted
	Blocked                                             bool
	Warnings                                            []string
}

// Unrouted explains why no authoritative entity was found.
type Unrouted struct{ Reason string }

// RoutingGraph is the slice of the GraphDB client the router reads with; *graphdb.Client satisfies it.
type RoutingGraph interface {
	Select(ctx context.Context, query string) (graphdb.SelectResult, error)
}

// Router derives a ticket's routing from the individual a finding is about.
type Router struct {
	settings RoutingSettings
	graph    RoutingGraph
}

// NewRouter builds a Router; settings must have passed Validate.
func NewRouter(s RoutingSettings, g RoutingGraph) *Router { return &Router{settings: s, graph: g} }

// Route reads the configured predicate of the individual (from any instances graph) and maps the first
// authoritative entity, in sorted order, through the routing map. Resolved at ticket-creation time and for
// the dry-run, never stored as authoritative.
func (r *Router) Route(ctx context.Context, individualIri string) (Routing, error) {
	if err := sparqlsafe.AssertSafeIRI(individualIri, "individual IRI"); err != nil || individualIri == "" {
		return Routing{}, fmt.Errorf("Invalid individual IRI")
	}
	if r.settings.PredicateIRI == "" {
		return r.unrouted("no authoritative-entity predicate is configured"), nil
	}
	q := fmt.Sprintf("SELECT DISTINCT ?v WHERE { GRAPH ?g { <%s> <%s> ?v } }", individualIri, r.settings.PredicateIRI)
	res, err := r.graph.Select(ctx, q)
	if err != nil {
		return Routing{}, err
	}
	var entities []string
	for _, b := range res.Results.Bindings {
		if v := b["v"].Value; v != "" {
			entities = append(entities, v)
		}
	}
	if len(entities) == 0 {
		return r.unrouted("the individual has no authoritative entity"), nil
	}
	sort.Strings(entities)
	entry, ok := r.settings.Map[entities[0]]
	if !ok {
		return r.unrouted(fmt.Sprintf("the authoritative entity %s is not in the routing map", entities[0])), nil
	}
	out := r.withDefaults(Routing{
		AssignmentGroup: entry.AssignmentGroup, Contact: entry.Contact, Category: entry.Category, Impact: entry.Impact, Urgency: entry.Urgency,
	})
	if out.AssignmentGroup == "" {
		out.AssignmentGroup = r.settings.FallbackGroup
	}
	if len(entities) > 1 {
		out.Warnings = append(out.Warnings, fmt.Sprintf("the individual has %d authoritative entities; routed by %s", len(entities), entities[0]))
	}
	return out, nil
}

func (r *Router) unrouted(reason string) Routing {
	out := r.withDefaults(Routing{AssignmentGroup: r.settings.FallbackGroup})
	out.Unrouted = &Unrouted{Reason: reason}
	out.Blocked = r.settings.Unrouted != UnroutedFallback
	return out
}

// withDefaults fills category, impact and urgency from the `default` entry, then from ServiceNow's own.
func (r *Router) withDefaults(out Routing) Routing {
	def := r.settings.Map[defaultEntryKey]
	pick := func(v ...string) string {
		for _, s := range v {
			if s != "" {
				return s
			}
		}
		return ""
	}
	out.Category = pick(out.Category, def.Category, fallbackCategory)
	out.Impact = pick(out.Impact, def.Impact, fallbackImpact)
	out.Urgency = pick(out.Urgency, def.Urgency, fallbackUrgency)
	return out
}
