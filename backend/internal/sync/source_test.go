package sync

import (
	"context"
	"testing"
)

type fakeSource struct {
	name  string
	kinds []string
}

func (f *fakeSource) Name() string { return f.name }

func (f *fakeSource) DiscoverKinds(ctx context.Context) ([]string, error) {
	return f.kinds, nil
}

func (f *fakeSource) FetchEntities(ctx context.Context, kind string) ([]Entity, error) {
	return []Entity{{UID: "1", Name: "example", Kind: kind}}, nil
}

func TestRegistry_RegisterAndGet(t *testing.T) {
	r := NewRegistry()
	r.Register(&fakeSource{name: "backstage", kinds: []string{"Component"}})

	src, ok := r.Get("backstage")
	if !ok {
		t.Fatal("Get(\"backstage\") ok = false, want true")
	}
	kinds, err := src.DiscoverKinds(context.Background())
	if err != nil {
		t.Fatalf("DiscoverKinds() error = %v", err)
	}
	if len(kinds) != 1 || kinds[0] != "Component" {
		t.Errorf("kinds = %v", kinds)
	}
}

func TestRegistry_GetUnknown(t *testing.T) {
	r := NewRegistry()
	if _, ok := r.Get("nope"); ok {
		t.Error("Get(\"nope\") ok = true, want false for unregistered source")
	}
}
