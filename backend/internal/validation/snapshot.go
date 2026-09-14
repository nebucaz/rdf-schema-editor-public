package validation

import (
	"context"
	"fmt"
	"strconv"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
)

// AssertedValue is one asserted `<individual> <Predicate> ?o` triple's object, typed so the checker
// (STORY-129) can tell an IRI value's type-membership check apart from a literal value's datatype
// check. Datatype is only meaningful when IsIRI is false, and defaults to `xsd:string` (RDF's own
// implicit default) when GraphDB's SPARQL-JSON binding omits an explicit `datatype` field.
type AssertedValue struct {
	Predicate string
	IsIRI     bool
	Value     string
	Datatype  string
}

// ValidationSnapshot bundles everything STORY-129's CheckSnapshot needs to check every identity in
// the graph in one pass: the class hierarchy (STORY-127's EffectiveShape input), each class's own
// `sh:property` constraints (STORY-127's other input), and each individual's declared types plus
// every asserted triple.
type ValidationSnapshot struct {
	// SubClassOf maps a class to its direct `rdfs:subClassOf` superclasses.
	SubClassOf map[string][]string
	// OwnConstraints maps a class to its own (non-inherited) sh:property constraints.
	OwnConstraints map[string][]PropertyConstraint
	// IndividualTypes maps an individual to every one of its asserted `rdf:type` values (an
	// individual may be multi-typed — never collapsed to one "governing" type).
	IndividualTypes map[string][]string
	// IndividualValues maps an individual to every one of its asserted (non-`rdf:type`) triples.
	IndividualValues map[string][]AssertedValue
}

// LoadValidationSnapshot runs the small, fixed set of bulk SPARQL SELECT queries needed to check
// every identity in the graph, and assembles their results into one ValidationSnapshot. Every query
// runs unscoped (a `GRAPH ?var` pattern, never `FROM`/a fixed `GRAPH <iri>`) — the same "no FROM ⇒
// every graph is both default and named" GraphDB behavior internal/sync's own bulk reads
// (FetchKindMapping et al.) already rely on, so this needs no per-namespace loop regardless of how
// many namespaces exist.
func LoadValidationSnapshot(ctx context.Context, gdb *graphdb.Client) (ValidationSnapshot, error) {
	subClassOf, err := fetchSubClassOf(ctx, gdb)
	if err != nil {
		return ValidationSnapshot{}, fmt.Errorf("fetch subClassOf edges: %w", err)
	}

	ownConstraints, err := fetchOwnConstraints(ctx, gdb)
	if err != nil {
		return ValidationSnapshot{}, fmt.Errorf("fetch own shape constraints: %w", err)
	}

	individualTypes, err := fetchIndividualTypes(ctx, gdb)
	if err != nil {
		return ValidationSnapshot{}, fmt.Errorf("fetch individual types: %w", err)
	}

	individualValues, err := fetchIndividualValues(ctx, gdb)
	if err != nil {
		return ValidationSnapshot{}, fmt.Errorf("fetch individual asserted triples: %w", err)
	}

	return ValidationSnapshot{
		SubClassOf:       subClassOf,
		OwnConstraints:   ownConstraints,
		IndividualTypes:  individualTypes,
		IndividualValues: individualValues,
	}, nil
}

// fetchSubClassOf loads every `rdfs:subClassOf` edge in the graph — query responsibility 1.
func fetchSubClassOf(ctx context.Context, gdb *graphdb.Client) (map[string][]string, error) {
	query := fmt.Sprintf(
		`SELECT ?sub ?super WHERE { GRAPH ?g { ?sub <%s> ?super } }`,
		rdfsSubClassOf,
	)
	result, err := gdb.Select(ctx, query)
	if err != nil {
		return nil, err
	}

	edges := make(map[string][]string)
	for _, binding := range result.Results.Bindings {
		sub, hasSub := binding["sub"]
		super, hasSuper := binding["super"]
		if !hasSub || !hasSuper {
			continue
		}
		edges[sub.Value] = append(edges[sub.Value], super.Value)
	}
	return edges, nil
}

// fetchOwnConstraints loads every class's own `sh:property` constraints — query responsibility 2.
// Two queries: one for the common fields (path/minCount/maxCount/datatype/a plain sh:class), one
// for `sh:or` unions (`sh:or/rdf:rest*/rdf:first/sh:class`, unwound to one row per union member via
// GraphDB's native RDF-list property path rather than reconstructing the list in Go). Results are
// merged per (class, path).
func fetchOwnConstraints(ctx context.Context, gdb *graphdb.Client) (map[string][]PropertyConstraint, error) {
	generalQuery := fmt.Sprintf(`
		SELECT ?class ?path ?minCount ?maxCount ?datatype ?targetClass WHERE {
			GRAPH ?g {
				?shape a <%s> ; <%s> ?class ; <%s> ?ps .
				?ps <%s> ?path .
				OPTIONAL { ?ps <%s> ?minCount }
				OPTIONAL { ?ps <%s> ?maxCount }
				OPTIONAL { ?ps <%s> ?datatype }
				OPTIONAL { ?ps <%s> ?targetClass }
			}
		}`,
		shNodeShape, shTargetClass, shProperty, shPath, shMinCount, shMaxCount, shDatatype, shClass,
	)
	generalResult, err := gdb.Select(ctx, generalQuery)
	if err != nil {
		return nil, err
	}

	orQuery := fmt.Sprintf(`
		SELECT ?class ?path ?targetClass WHERE {
			GRAPH ?g {
				?shape a <%s> ; <%s> ?class ; <%s> ?ps .
				?ps <%s> ?path ; <%s>/<%s>*/<%s>/<%s> ?targetClass .
			}
		}`,
		shNodeShape, shTargetClass, shProperty, shPath, shOr, rdfRest, rdfFirst, shClass,
	)
	orResult, err := gdb.Select(ctx, orQuery)
	if err != nil {
		return nil, err
	}

	type key struct{ class, path string }
	constraints := make(map[key]*PropertyConstraint)
	order := make(map[string][]string) // class -> paths, in first-seen order

	get := func(classIri, path string) *PropertyConstraint {
		k := key{classIri, path}
		c, ok := constraints[k]
		if !ok {
			c = &PropertyConstraint{Path: path}
			constraints[k] = c
			order[classIri] = append(order[classIri], path)
		}
		return c
	}

	for _, binding := range generalResult.Results.Bindings {
		classIri, hasClass := binding["class"]
		path, hasPath := binding["path"]
		if !hasClass || !hasPath {
			continue
		}
		c := get(classIri.Value, path.Value)
		if minCount, ok := binding["minCount"]; ok {
			n := parseIntBinding(minCount.Value)
			c.MinCount = &n
		}
		if maxCount, ok := binding["maxCount"]; ok {
			n := parseIntBinding(maxCount.Value)
			c.MaxCount = &n
		}
		if datatype, ok := binding["datatype"]; ok {
			c.Datatype = datatype.Value
		}
		if targetClass, ok := binding["targetClass"]; ok {
			c.TargetClasses = appendUnique(c.TargetClasses, targetClass.Value)
		}
	}

	for _, binding := range orResult.Results.Bindings {
		classIri, hasClass := binding["class"]
		path, hasPath := binding["path"]
		targetClass, hasTarget := binding["targetClass"]
		if !hasClass || !hasPath || !hasTarget {
			continue
		}
		c := get(classIri.Value, path.Value)
		c.TargetClasses = appendUnique(c.TargetClasses, targetClass.Value)
	}

	own := make(map[string][]PropertyConstraint, len(order))
	for classIri, paths := range order {
		list := make([]PropertyConstraint, 0, len(paths))
		for _, path := range paths {
			list = append(list, *constraints[key{classIri, path}])
		}
		own[classIri] = list
	}
	return own, nil
}

// fetchIndividualTypes loads every individual's every `rdf:type` triple — query responsibility 3.
// "Individual" means: typed by a class that is itself declared `a owl:Class` — the same join
// `fetchAllIndividuals` (app/src/lib/services/sparql-connector.ts) uses to keep classes/properties
// themselves (which are never typed by another declared `owl:Class`) out of the result.
func fetchIndividualTypes(ctx context.Context, gdb *graphdb.Client) (map[string][]string, error) {
	query := fmt.Sprintf(`
		SELECT ?individual ?type WHERE {
			GRAPH ?g1 { ?individual <%s> ?type }
			GRAPH ?g2 { ?type <%s> <%s> }
		}`,
		rdfType, rdfType, owlClass,
	)
	result, err := gdb.Select(ctx, query)
	if err != nil {
		return nil, err
	}

	types := make(map[string][]string)
	for _, binding := range result.Results.Bindings {
		individual, hasIndividual := binding["individual"]
		typeIri, hasType := binding["type"]
		if !hasIndividual || !hasType {
			continue
		}
		types[individual.Value] = appendUnique(types[individual.Value], typeIri.Value)
	}
	return types, nil
}

// fetchIndividualValues loads every individual's every asserted `<p, o>` triple — query
// responsibility 4. Scoped to the same "typed by a declared owl:Class" individual definition
// fetchIndividualTypes uses (via the same two-graph join) so this never pulls in classes'/
// properties' own schema triples, only ABox data. `DISTINCT` because a multi-typed individual's
// `?individual a ?type` join above would otherwise duplicate every one of its non-type triples once
// per declared type.
func fetchIndividualValues(ctx context.Context, gdb *graphdb.Client) (map[string][]AssertedValue, error) {
	query := fmt.Sprintf(`
		SELECT DISTINCT ?individual ?p ?o WHERE {
			GRAPH ?g1 { ?individual <%s> ?type . ?individual ?p ?o }
			GRAPH ?g2 { ?type <%s> <%s> }
		}`,
		rdfType, rdfType, owlClass,
	)
	result, err := gdb.Select(ctx, query)
	if err != nil {
		return nil, err
	}

	values := make(map[string][]AssertedValue)
	for _, binding := range result.Results.Bindings {
		individual, hasIndividual := binding["individual"]
		predicate, hasPredicate := binding["p"]
		object, hasObject := binding["o"]
		if !hasIndividual || !hasPredicate || !hasObject {
			continue
		}
		if predicate.Value == rdfType {
			continue
		}

		value := AssertedValue{Predicate: predicate.Value, IsIRI: object.Type == "uri", Value: object.Value}
		if !value.IsIRI {
			value.Datatype = object.Datatype
			if value.Datatype == "" {
				value.Datatype = xsdString
			}
		}
		values[individual.Value] = append(values[individual.Value], value)
	}
	return values, nil
}

func appendUnique(list []string, value string) []string {
	for _, v := range list {
		if v == value {
			return list
		}
	}
	return append(list, value)
}

// parseIntBinding parses a SPARQL-JSON literal's lexical integer value, defaulting to 0 on a
// malformed binding rather than erroring the whole snapshot load over one bad cardinality value —
// GraphDB itself only ever writes well-formed `xsd:integer` cardinalities via this app's own
// SHACL-authoring paths, so a parse failure here would indicate corrupt/hand-edited data, not a
// bug this function should surface as a hard failure.
func parseIntBinding(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return n
}
