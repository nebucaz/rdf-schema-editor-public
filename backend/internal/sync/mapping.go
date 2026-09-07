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

// FetchRepresentsPredicateIri resolves the configured `rse:representsPredicate` setting (STORY-103)
// — `SELECT ?p WHERE { GRAPH ?g { <appSettingsIRI> <representsPredicateSettingIRI> ?p } } LIMIT 1`,
// mirroring FetchKindMapping's "one SELECT, absence is not an error" shape. Returns "" (not an
// error) when the setting is unset — `Engine.RunSync` reads this once per run to decide whether to
// attempt the `represents` mechanism at all this run (STORY-105).
func FetchRepresentsPredicateIri(ctx context.Context, gdb *graphdb.Client, appSettingsIRI, representsPredicateSettingIRI string) (string, error) {
	query := fmt.Sprintf(
		`SELECT ?p WHERE { GRAPH ?g { <%s> <%s> ?p } } LIMIT 1`,
		appSettingsIRI, representsPredicateSettingIRI,
	)
	result, err := gdb.Select(ctx, query)
	if err != nil {
		return "", fmt.Errorf("fetch representsPredicate setting: %w", err)
	}
	if len(result.Results.Bindings) == 0 {
		return "", nil
	}
	p, ok := result.Results.Bindings[0]["p"]
	if !ok {
		return "", nil
	}
	return p.Value, nil
}
