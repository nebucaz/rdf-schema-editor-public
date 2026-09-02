package sync

import (
	"context"
	"fmt"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
)

// FetchKindMapping runs `SELECT ?class ?kind WHERE { GRAPH ?g { ?class <backstageKindIRI> ?kind } }`
// across every namespace's `/schema` graph — an unrestricted cross-graph scan, mirroring the app's
// own `findNamespaceOfClass` shape, not scoped to one namespace — returning a `kind -> classIri` map.
// A class with no `backstageKind` triple is simply absent from the map, never an error. Shared by
// Story 004's discovery endpoint and Story 007's sync engine so both read the exact same mapping.
//
// backstageKindPredicateIRI stays a plain parameter (not a package-level constant) per Story 003's
// deliberately-not-generalized-yet note: only Backstage's mapping predicate exists today, so this
// function is Backstage-predicate-specific, not abstracted per-Source.
func FetchKindMapping(ctx context.Context, gdb *graphdb.Client, backstageKindPredicateIRI string) (map[string]string, error) {
	query := fmt.Sprintf(
		`SELECT ?class ?kind WHERE { GRAPH ?g { ?class <%s> ?kind } }`,
		backstageKindPredicateIRI,
	)
	result, err := gdb.Select(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("fetch backstageKind mapping: %w", err)
	}

	mapping := make(map[string]string, len(result.Results.Bindings))
	for _, binding := range result.Results.Bindings {
		class, hasClass := binding["class"]
		kind, hasKind := binding["kind"]
		if !hasClass || !hasKind {
			continue
		}
		mapping[kind.Value] = class.Value
	}
	return mapping, nil
}
