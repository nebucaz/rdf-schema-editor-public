// Package sync holds the ingestion-source abstraction every source (Backstage today, a second one
// planned) is built against, plus the pieces shared across sources (the kind→class mapping lookup).
// Discovery (Story 004), the sync/merge engine (Story 007), the scheduler (Story 008), and the CLI
// (Story 011) all depend only on Source and Registry here — never on a specific source package
// directly — so adding a second source is a new Source implementation plus one Registry entry, not
// a rewrite of this plumbing.
package sync

import "context"

// Entity is one upstream record, mapped into this app's vocabulary-neutral shape. Attributes holds
// whatever source-specific fields a future sync/merge engine (Story 007) maps onto local attributes;
// left as a flat string map since only one source's actual shape (Backstage's `spec`) is known today.
type Entity struct {
	UID        string
	Name       string
	Kind       string
	Attributes map[string]string
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
