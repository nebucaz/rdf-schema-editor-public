package sync

import (
	"context"
	"fmt"
)

// resolveSourceRelationMapping returns, for classIRI, every `type -> owl:ObjectProperty` pair
// (STORY-106) whose property is actually `sh:property`'d onto classIRI's own shape — the same
// "must already exist" enforcement `resolveSourceFieldMapping` (STORY-101) applies to
// `rse:sourceField`, reused verbatim via `fetchPropertyShapeConstraint` since a `sh:property` shape
// entry already carries the `sh:class` range constraint that (for both a "specific" relation's own
// `rdfs:domain`/`rdfs:range` and a "generic" relation's per-source-class shape, see
// `insertObjectProperty`'s two branches on the TS side) is exactly what scopes a mapped property to
// "connects the two right shadow classes." A property with `rse:sourceRelation` set but not attached
// to classIRI's shape is simply absent from the returned map, not an error — it may legitimately be
// scoped to a different class entirely.
func (e *Engine) resolveSourceRelationMapping(ctx context.Context, classIRI string) (map[string]string, error) {
	query := fmt.Sprintf(`SELECT ?prop ?type WHERE { GRAPH ?g { ?prop <%s> ?type } }`, e.vocab.SourceRelationPredicateIRI)
	result, err := e.gdb.Select(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("fetch sourceRelation predicates: %w", err)
	}

	mapping := make(map[string]string)
	for _, binding := range result.Results.Bindings {
		prop, hasProp := binding["prop"]
		relType, hasType := binding["type"]
		if !hasProp || !hasType {
			continue
		}
		constraint, err := e.fetchPropertyShapeConstraint(ctx, classIRI, prop.Value)
		if err != nil {
			return nil, err
		}
		if !constraint.Exists {
			continue
		}
		mapping[relType.Value] = prop.Value
	}
	return mapping, nil
}

// resolveSyncSourceRefTarget resolves targetRef (an upstream `relations[].targetRef`-shaped string,
// e.g. `group:default/payments-team`) to whichever individual, in any namespace/graph, carries that
// exact value as its `rse:syncSourceRef` marker (STORY-106) — a plain cross-graph SPARQL lookup,
// Concept/Namespace-agnostic by construction. Returns "" (not an error) when no such individual
// exists yet — a normal "not synced this run or any prior run" outcome, retried automatically on a
// later run once the target is actually synced. Callers should check `Engine.RunSync`'s in-memory
// `sourceRefToIndividualIRI` map first (this run's own newly-minted individuals, not yet committed to
// GraphDB when this lookup would run) before falling back to this GraphDB round-trip for a target
// synced in a prior run.
func (e *Engine) resolveSyncSourceRefTarget(ctx context.Context, targetRef string) (string, error) {
	query := fmt.Sprintf(
		`SELECT ?i WHERE { GRAPH ?g { ?i <%s> "%s" } } LIMIT 1`,
		e.vocab.SyncSourceRefPredicateIRI, escapeString(targetRef),
	)
	result, err := e.gdb.Select(ctx, query)
	if err != nil {
		return "", fmt.Errorf("resolve sync source ref target: %w", err)
	}
	if len(result.Results.Bindings) == 0 {
		return "", nil
	}
	i, ok := result.Results.Bindings[0]["i"]
	if !ok {
		return "", nil
	}
	return i.Value, nil
}
