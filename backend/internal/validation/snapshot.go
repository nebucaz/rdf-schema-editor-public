package validation

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
)

// AssertedValue is one asserted `<individual> <Predicate> ?o` triple's object, typed so the checker
// (STORY-129) can tell an IRI value's type-membership check apart from a literal value's datatype
// check. Datatype is only meaningful when IsIRI is false, and defaults to `xsd:string` (RDF's own
// implicit default) when GraphDB's SPARQL-JSON binding omits an explicit `datatype` field.
type AssertedValue struct {
	Predicate string
	IsIRI     bool
	IsBlank   bool
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
	// SparqlConstraints are the runnable `sh:sparql` constraints of the shapes (story 354).
	SparqlConstraints []SparqlConstraint
	// NotChecked lists shape constructs the engine knows it does not run, found while loading.
	NotChecked []NotChecked
}

// SparqlConstraint is one `sh:sparql` blank node of a NodeShape with its `sh:select` text, the
// target class whose instances are its focus nodes, and the shape's rule id and dimension.
type SparqlConstraint struct {
	ShapeIri         string
	TargetClass      string
	Select           string
	Message          string
	RuleId           string
	QualityDimension string
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

	sparqlConstraints, notChecked, err := fetchSparqlConstraints(ctx, gdb)
	if err != nil {
		return ValidationSnapshot{}, fmt.Errorf("fetch sh:sparql constraints: %w", err)
	}
	ignoredKeys, err := fetchIgnoredPropertyKeys(ctx, gdb)
	if err != nil {
		return ValidationSnapshot{}, fmt.Errorf("fetch ignored property shape keys: %w", err)
	}

	return ValidationSnapshot{
		SubClassOf:        subClassOf,
		OwnConstraints:    ownConstraints,
		IndividualTypes:   individualTypes,
		IndividualValues:  individualValues,
		SparqlConstraints: sparqlConstraints,
		NotChecked:        append(notChecked, ignoredKeys...),
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
// Two queries: one for the common fields (shape/path/minCount/maxCount/datatype/a plain sh:class and
// the shape's rule id, quality dimension and the property shape's sh:message), one for `sh:or`
// unions (`sh:or/rdf:rest*/rdf:first/sh:class`, unwound to one row per union member via GraphDB's
// native RDF-list property path rather than reconstructing the list in Go). Results are merged per
// (class, shape, path), so two shapes on one class and path stay two constraints.
//
// The rule id and dimension are read from any graph (`GRAPH ?g2`): a shape imported before the
// annotations were kept with the shape may have them in the schema graph.
func fetchOwnConstraints(ctx context.Context, gdb *graphdb.Client) (map[string][]PropertyConstraint, error) {
	generalQuery := fmt.Sprintf(`
		SELECT ?class ?shape ?path ?minCount ?maxCount ?datatype ?targetClass ?ruleId ?dimension ?message ?pattern ?flags ?minLength WHERE {
			GRAPH ?g {
				?shape a <%s> ; <%s> ?class ; <%s> ?ps .
				?ps <%s> ?path .
				OPTIONAL { ?ps <%s> ?minCount }
				OPTIONAL { ?ps <%s> ?maxCount }
				OPTIONAL { ?ps <%s> ?datatype }
				OPTIONAL { ?ps <%s> ?targetClass }
				OPTIONAL { ?ps <%s> ?message }
				OPTIONAL { ?ps <%s> ?pattern }
				OPTIONAL { ?ps <%s> ?flags }
				OPTIONAL { ?ps <%s> ?minLength }
			}
			OPTIONAL { GRAPH ?g2 { ?shape <%s> ?ruleId } }
			OPTIONAL { GRAPH ?g3 { ?shape <%s> ?dimension } }
		}`,
		shNodeShape, shTargetClass, shProperty, shPath, shMinCount, shMaxCount, shDatatype, shClass, shMessage,
		shPattern, shFlags, shMinLength,
		armID, armQualityDimension,
	)
	generalResult, err := gdb.Select(ctx, generalQuery)
	if err != nil {
		return nil, err
	}

	orQuery := fmt.Sprintf(`
		SELECT ?class ?shape ?path ?targetClass WHERE {
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

	type key struct{ class, shape, path string }
	constraints := make(map[key]*PropertyConstraint)
	messages := make(map[key][]langString)
	order := make(map[string][]key) // class -> keys, in first-seen order

	get := func(classIri, shape, path string) (*PropertyConstraint, key) {
		k := key{classIri, shape, path}
		c, ok := constraints[k]
		if !ok {
			c = &PropertyConstraint{ShapeIri: shape, Path: path}
			constraints[k] = c
			order[classIri] = append(order[classIri], k)
		}
		return c, k
	}

	for _, binding := range generalResult.Results.Bindings {
		classIri, hasClass := binding["class"]
		path, hasPath := binding["path"]
		if !hasClass || !hasPath {
			continue
		}
		c, k := get(classIri.Value, binding["shape"].Value, path.Value)
		if ruleId, ok := binding["ruleId"]; ok && c.RuleId == "" {
			c.RuleId = ruleId.Value
		}
		if dimension, ok := binding["dimension"]; ok && c.QualityDimension == "" {
			c.QualityDimension = dimension.Value
		}
		if message, ok := binding["message"]; ok {
			messages[k] = appendLangString(messages[k], langString{message.Lang, message.Value})
		}
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
		if pattern, ok := binding["pattern"]; ok {
			c.Pattern = pattern.Value
		}
		if flags, ok := binding["flags"]; ok {
			c.Flags = flags.Value
		}
		if minLength, ok := binding["minLength"]; ok {
			n := parseIntBinding(minLength.Value)
			c.MinLength = &n
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
		c, _ := get(classIri.Value, binding["shape"].Value, path.Value)
		c.TargetClasses = appendUnique(c.TargetClasses, targetClass.Value)
	}

	own := make(map[string][]PropertyConstraint, len(order))
	for classIri, keys := range order {
		list := make([]PropertyConstraint, 0, len(keys))
		for _, k := range keys {
			c := *constraints[k]
			c.Message = pickMessage(messages[k])
			list = append(list, c)
		}
		own[classIri] = list
	}
	return own, nil
}

// langString is one `sh:message` value with its language tag ("" when untagged).
type langString struct{ Lang, Value string }

func appendLangString(list []langString, v langString) []langString {
	for _, e := range list {
		if e == v {
			return list
		}
	}
	return append(list, v)
}

// pickMessage prefers a German message (the ITAM shapes' language), then an untagged one, then the
// first of any other language; "" when there is none.
func pickMessage(messages []langString) string {
	for _, want := range []func(langString) bool{
		func(m langString) bool { return strings.EqualFold(m.Lang, "de") },
		func(m langString) bool { return m.Lang == "" },
		func(m langString) bool { return true },
	} {
		for _, m := range messages {
			if want(m) {
				return m.Value
			}
		}
	}
	return ""
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

		value := AssertedValue{Predicate: predicate.Value, IsIRI: object.Type == "uri", IsBlank: object.Type == "bnode", Value: object.Value}
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

// fetchSparqlConstraints loads every `sh:sparql` blank node of every NodeShape with a target class.
// A constraint the engine does not run (deactivated, `sh:ask`, `sh:prefixes`, no `sh:select`) is
// returned as NotChecked with the reason instead.
func fetchSparqlConstraints(ctx context.Context, gdb *graphdb.Client) ([]SparqlConstraint, []NotChecked, error) {
	query := fmt.Sprintf(`
		SELECT ?shape ?class ?sc ?select ?ask ?message ?deactivated ?prefixes ?ruleId ?dimension WHERE {
			GRAPH ?g {
				?shape a <%s> ; <%s> ?class ; <%s> ?sc .
				OPTIONAL { ?sc <%s> ?select }
				OPTIONAL { ?sc <%s> ?ask }
				OPTIONAL { ?sc <%s> ?message }
				OPTIONAL { ?sc <%s> ?deactivated }
				OPTIONAL { ?sc <%s> ?prefixes }
			}
			OPTIONAL { GRAPH ?g2 { ?shape <%s> ?ruleId } }
			OPTIONAL { GRAPH ?g3 { ?shape <%s> ?dimension } }
		}`,
		shNodeShape, shTargetClass, shSparql, shSelect, shAsk, shMessage, shDeactivated, shPrefixes, armID, armQualityDimension,
	)
	result, err := gdb.Select(ctx, query)
	if err != nil {
		return nil, nil, err
	}

	type key struct{ shape, class, sc string }
	var order []key
	rows := map[key]*SparqlConstraint{}
	extra := map[key]*struct {
		ask, deactivated, prefixes bool
		messages                   []langString
	}{}
	for _, b := range result.Results.Bindings {
		shape, hasShape := b["shape"]
		class, hasClass := b["class"]
		sc, hasSc := b["sc"]
		if !hasShape || !hasClass || !hasSc {
			continue
		}
		k := key{shape.Value, class.Value, sc.Value}
		c, ok := rows[k]
		if !ok {
			c = &SparqlConstraint{ShapeIri: shape.Value, TargetClass: class.Value}
			rows[k] = c
			extra[k] = &struct {
				ask, deactivated, prefixes bool
				messages                   []langString
			}{}
			order = append(order, k)
		}
		if v, ok := b["select"]; ok {
			c.Select = v.Value
		}
		if v, ok := b["ruleId"]; ok && c.RuleId == "" {
			c.RuleId = v.Value
		}
		if v, ok := b["dimension"]; ok && c.QualityDimension == "" {
			c.QualityDimension = v.Value
		}
		e := extra[k]
		if v, ok := b["message"]; ok {
			e.messages = appendLangString(e.messages, langString{v.Lang, v.Value})
		}
		if _, ok := b["ask"]; ok {
			e.ask = true
		}
		if v, ok := b["deactivated"]; ok && strings.EqualFold(v.Value, "true") {
			e.deactivated = true
		}
		if _, ok := b["prefixes"]; ok {
			e.prefixes = true
		}
	}

	var constraints []SparqlConstraint
	var notChecked []NotChecked
	for _, k := range order {
		c, e := rows[k], extra[k]
		c.Message = pickMessage(e.messages)
		skip := func(reason string) {
			notChecked = append(notChecked, NotChecked{ShapeIri: c.ShapeIri, RuleId: c.RuleId, Construct: "sh:sparql", Reason: reason})
		}
		switch {
		case e.deactivated:
			skip("sh:deactivated true")
		case e.ask:
			skip("sh:ask constraints are not supported, only sh:select")
		case e.prefixes:
			skip("sh:prefixes is not supported; write the select with full IRIs")
		case c.Select == "":
			skip("no sh:select")
		default:
			constraints = append(constraints, *c)
		}
	}
	return constraints, notChecked, nil
}

// ignoredPropertyKeys are the predicates of a `sh:property` node the engine evaluates or that only
// annotate (names, grouping); any other key is reported as not checked.
var ignoredPropertyKeys = map[string]bool{
	rdfType: true, rdfsLabel: true, rdfsComment: true,
	shPath: true, shMinCount: true, shMaxCount: true, shDatatype: true, shClass: true, shOr: true,
	shPattern: true, shFlags: true, shMinLength: true, shMessage: true,
	shNS + "name": true, shNS + "description": true, shNS + "order": true, shNS + "group": true, shNS + "severity": true,
}

// fetchIgnoredPropertyKeys lists, once per shape and key, the property-shape keys the engine does
// not evaluate (for example `sh:in`), so the report can say they were not checked.
func fetchIgnoredPropertyKeys(ctx context.Context, gdb *graphdb.Client) ([]NotChecked, error) {
	query := fmt.Sprintf(`
		SELECT DISTINCT ?shape ?key ?ruleId WHERE {
			GRAPH ?g { ?shape a <%s> ; <%s> ?ps . ?ps ?key ?value }
			OPTIONAL { GRAPH ?g2 { ?shape <%s> ?ruleId } }
		}`,
		shNodeShape, shProperty, armID,
	)
	result, err := gdb.Select(ctx, query)
	if err != nil {
		return nil, err
	}

	seen := map[[2]string]bool{}
	var out []NotChecked
	for _, b := range result.Results.Bindings {
		shape, hasShape := b["shape"]
		key, hasKey := b["key"]
		if !hasShape || !hasKey || ignoredPropertyKeys[key.Value] || seen[[2]string{shape.Value, key.Value}] {
			continue
		}
		seen[[2]string{shape.Value, key.Value}] = true
		construct := key.Value
		if strings.HasPrefix(construct, shNS) {
			construct = "sh:" + strings.TrimPrefix(construct, shNS)
		}
		out = append(out, NotChecked{ShapeIri: shape.Value, RuleId: b["ruleId"].Value, Construct: construct, Reason: "not evaluated by the validation engine"})
	}
	return out, nil
}
