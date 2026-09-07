package sync

import (
	"context"
	"fmt"
)

// PropertyShapeConstraint is what classIRI's own `sh:NodeShape` declares for one property path
// (STORY-101/105): whether the property is actually `sh:property`'d onto that shape at all
// (`Exists`), and if so, whether it's constrained to at most one value (`sh:maxCount 1`,
// `Repeatable` false) or left repeatable (no `sh:maxCount`, `Repeatable` true), plus its `sh:class`
// range constraint if any (`Class`, "" when the shape entry declares none — STORY-105 reads this to
// validate a `represents` annotation's target against the predicate's required range).
type PropertyShapeConstraint struct {
	Exists     bool
	Repeatable bool
	Class      string
}

// fetchPropertyShapeConstraint is the shared SHACL-shape-reading helper this plan's "must already
// exist" checks are built on (STORY-101's `rse:sourceField` check here; STORY-105's `represents`
// shape check reuses it too) — an unrestricted cross-graph search for a `sh:NodeShape` whose
// `sh:targetClass` is classIRI and which `sh:property`'s a blank node whose `sh:path` is propIRI,
// mirroring `sparql-connector.ts`'s own `sh:targetClass`-scoped shape lookups (e.g.
// `fetchGenericPropertyShapeDetails`). `Exists` is false (not an error) when no such shape entry is
// found — "not sh:property'd onto this class's shape" is a config fact, not a query failure.
func (e *Engine) fetchPropertyShapeConstraint(ctx context.Context, classIRI, propIRI string) (PropertyShapeConstraint, error) {
	query := fmt.Sprintf(`SELECT ?maxCount ?class WHERE { GRAPH ?g { ?shape <%s> <%s> ; <%s> ?propShape . ?propShape <%s> <%s> . OPTIONAL { ?propShape <%s> ?maxCount } OPTIONAL { ?propShape <%s> ?class } } } LIMIT 1`,
		shTargetClass, classIRI, shProperty, shPath, propIRI, shMaxCount, shClass,
	)
	result, err := e.gdb.Select(ctx, query)
	if err != nil {
		return PropertyShapeConstraint{}, fmt.Errorf("fetch property shape constraint: %w", err)
	}
	if len(result.Results.Bindings) == 0 {
		return PropertyShapeConstraint{}, nil
	}
	constraint := PropertyShapeConstraint{Exists: true, Repeatable: true}
	binding := result.Results.Bindings[0]
	if maxCount, ok := binding["maxCount"]; ok && maxCount.Value == "1" {
		constraint.Repeatable = false
	}
	if class, ok := binding["class"]; ok {
		constraint.Class = class.Value
	}
	return constraint, nil
}

// SourceFieldMapping is one resolved `rse:sourceField` mapping (STORY-101): propIRI's own
// free-form mapping information (the map key in resolveSourceFieldMapping's return value is the
// property IRI), matched verbatim against a key in entity.Fields/FieldLists — Backstage's own
// ingestor happens to key those maps by a dotted field path, but a future ingestor is free to key
// them however its own source data demands — plus whether propIRI is repeatable on classIRI's
// shape.
type SourceFieldMapping struct {
	Path       string
	Repeatable bool
}

// resolveSourceFieldMapping returns, for classIRI, every `owl:DatatypeProperty -> sourceField
// path` pair whose property is actually `sh:property`'d onto classIRI's own shape (STORY-101's
// "must already exist" enforcement) — a property with `rse:sourceField` set but not attached to
// classIRI's shape is simply absent from the returned map, not an error, since it may legitimately
// be scoped to a different class entirely. Fetches the full (unscoped) `rse:sourceField` triple
// set once, then checks each candidate against classIRI's shape via the shared
// fetchPropertyShapeConstraint helper — mirrors FetchKindMapping's own unrestricted-scan shape.
func (e *Engine) resolveSourceFieldMapping(ctx context.Context, classIRI string) (map[string]SourceFieldMapping, error) {
	query := fmt.Sprintf(`SELECT ?prop ?path WHERE { GRAPH ?g { ?prop <%s> ?path } }`, e.vocab.SourceFieldPredicateIRI)
	result, err := e.gdb.Select(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("fetch sourceField predicates: %w", err)
	}

	mapping := make(map[string]SourceFieldMapping)
	for _, binding := range result.Results.Bindings {
		prop, hasProp := binding["prop"]
		path, hasPath := binding["path"]
		if !hasProp || !hasPath {
			continue
		}
		constraint, err := e.fetchPropertyShapeConstraint(ctx, classIRI, prop.Value)
		if err != nil {
			return nil, err
		}
		if !constraint.Exists {
			continue
		}
		mapping[prop.Value] = SourceFieldMapping{Path: path.Value, Repeatable: constraint.Repeatable}
	}
	return mapping, nil
}

// enterpriseCatalogIRIAnnotationKey (STORY-105) is the one fixed annotation key a `represents` link
// is named by, for every entity regardless of kind/shadow class (plan.md's confirmed decision,
// superseding `backstage-dev-guide.md`'s older per-concept-coded example keys). Matches the exact
// dotted key `backstage.Client`'s own `flattenFields` produces for a Backstage entity's
// `metadata.annotations["enterprise.catalog.iri"]` value.
const enterpriseCatalogIRIAnnotationKey = "metadata.annotations.enterprise.catalog.iri"

// resolveRepresentsTarget resolves one entity's `represents` link target on classIRI (STORY-105,
// steps 2-4 of plan.md's five-step resolution — step 1, resolving representsPredicateIRI itself
// once per run, and step 5, the merge-write, both live in `Engine.RunSync`/`representsOps`).
//
// Returns "" targetIRI with an empty failure for every "not applicable, nothing to report" case (no
// annotation set at all) — only a *present-but-invalid* annotation produces a reportable failure,
// mirroring `mappedAttributeOps`' own "absent is normal, present-but-wrong is a failure" split. Never
// returns a non-nil err for a data/config problem — only for an actual query failure — since a
// resolution failure must never abort the entity's own shadow-individual/attribute sync (plan.md's
// "skip the link, sync the rest" ADR).
func (e *Engine) resolveRepresentsTarget(ctx context.Context, classIRI, representsPredicateIRI string, entity Entity) (targetIRI, failure string, err error) {
	annotationIRI, ok := entity.Fields[enterpriseCatalogIRIAnnotationKey]
	if !ok || annotationIRI == "" {
		return "", "", nil
	}
	if !isSafeSparqlIRI(annotationIRI) {
		return "", fmt.Sprintf("%s: represents annotation %q is not a well-formed IRI — link skipped", entity.UID, annotationIRI), nil
	}

	constraint, err := e.fetchPropertyShapeConstraint(ctx, classIRI, representsPredicateIRI)
	if err != nil {
		return "", "", err
	}
	if !constraint.Exists || constraint.Class == "" {
		return "", fmt.Sprintf(
			"%s: represents annotation %q set, but <%s> has no sh:property/sh:class shape entry for <%s> — link skipped",
			entity.UID, annotationIRI, classIRI, representsPredicateIRI,
		), nil
	}

	typeMatches, err := e.gdb.Ask(ctx, askCrossGraphTripleExistsIRI(annotationIRI, rdfType, constraint.Class))
	if err != nil {
		return "", "", fmt.Errorf("check represents target type: %w", err)
	}
	if !typeMatches {
		return "", fmt.Sprintf(
			"%s: represents target <%s> does not have rdf:type <%s> (or does not exist) — link skipped",
			entity.UID, annotationIRI, constraint.Class,
		), nil
	}

	return annotationIRI, "", nil
}
