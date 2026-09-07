// Package sync holds the ingestion-source abstraction every source (Backstage today, a second one
// planned) is built against, plus the pieces shared across sources (the kind→class mapping lookup).
// Discovery (Story 004), the sync/merge engine (Story 007), the scheduler (Story 008), and the CLI
// (Story 011) all depend only on Source and Registry here — never on a specific source package
// directly — so adding a second source is a new Source implementation plus one Registry entry, not
// a rewrite of this plumbing.
package sync

import "context"

// Entity is one upstream record, mapped into this app's vocabulary-neutral shape. Fields/FieldLists
// hold every source field a mapping predicate might reference, keyed however that Source
// implementation's own fetch chooses to key them — Backstage's client (Story 098) flattens its
// `metadata`/`spec` payload into dotted keys (`"metadata.description"`, `"spec.lifecycle"`, ...),
// but a future Source is free to key these maps however its own data demands, as long as its keys
// match what its own entities' `rse:sourceField` mapping information names. Fields is for
// single-valued keys, FieldLists for array-valued ones, so Story 101's merge-write can read either
// without re-parsing the source payload. Relations holds the source's own relation graph
// (`ownedBy`, `partOf`, ...), consumed by Story 106.
type Entity struct {
	UID        string
	Name       string
	Kind       string
	Fields     map[string]string
	FieldLists map[string][]string
	Relations  []Relation
	// SourceRef is this entity's own identity in the source's own target-reference scheme (STORY-106)
	// — Backstage: `kind:namespace/name`, lowercase kind, e.g. `component:default/payments-service` —
	// distinct from UID (what individual IRIs actually mint from). Written as the `rse:syncSourceRef`
	// marker on this entity's synced individual, so a *different* entity's `Relations[].TargetRef`
	// naming this one can be resolved back to its minted IRI without an extra upstream fetch. Empty
	// is valid (a Source that never populates Relations has no reason to populate this either) — an
	// empty SourceRef simply never matches any TargetRef lookup.
	SourceRef string
}

// Relation is one upstream relation edge from this Entity to another upstream entity, named by the
// source's own target-reference scheme (Backstage: `kind:namespace/name`) — resolved to a local
// individual IRI only at relation-write time (Story 106), never here.
type Relation struct {
	Type      string
	TargetRef string
}

// Source is the small interface every ingestion source implements. DiscoverKinds returns the
// distinct kinds currently present upstream (cheap — no full entity fetch required); FetchEntities
// returns every entity of one specific kind.
type Source interface {
	Name() string
	DiscoverKinds(ctx context.Context) ([]string, error)
	FetchEntities(ctx context.Context, kind string) ([]Entity, error)
}

// Registry resolves a source by its Name() — the seam Story 004's discovery endpoint, Story 007's
// sync engine, and Story 011's CLI all use instead of importing a source package directly.
type Registry struct {
	sources map[string]Source
}

// NewRegistry returns an empty Registry ready for Register calls.
func NewRegistry() *Registry {
	return &Registry{sources: make(map[string]Source)}
}

// Register adds a Source under its own Name(), overwriting any previous registration of that name.
func (r *Registry) Register(s Source) {
	r.sources[s.Name()] = s
}

// Get resolves a source by name. ok is false for an unregistered name.
func (r *Registry) Get(name string) (Source, bool) {
	s, ok := r.sources[name]
	return s, ok
}
