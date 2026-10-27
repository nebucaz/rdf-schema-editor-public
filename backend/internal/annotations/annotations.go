// Package annotations writes and removes reified fact annotations, ported from
// `addAnnotation`/`deleteAnnotation` in `app/src/lib/services/sparql-connector.ts`. An annotation is
// an `Annotation` node pointing at an `rdf:Statement` that reifies the annotated fact, stored in the
// fact's own namespace's instances graph.
//
// The operations issued, and their order, are pinned by `backend/testdata/golden/annotations.json`,
// which the Vitest suite replays against the TypeScript original.
package annotations

import (
	"context"
	"fmt"
	"math/rand/v2"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/sparqlsafe"
)

// Graph is the slice of the GraphDB client the service uses; *graphdb.Client satisfies it.
type Graph interface {
	Ask(ctx context.Context, query string) (bool, error)
	Select(ctx context.Context, query string) (graphdb.SelectResult, error)
	Update(ctx context.Context, update string) error
}

// seedLabels are the `AnnotationLabel` members declared on first use (SEED_ANNOTATION_LABELS).
var seedLabels = []string{"Verified", "Investigate", "Approved", "Deprecated"}

// Service adds and removes annotations in the default namespace's graphs.
type Service struct {
	graph   Graph
	graphs  sparqlsafe.Graphs // the default namespace's graphs
	schemaN string            // graphs.Schema + "#": where vocabulary IRIs mint

	// Overridable so tests can pin the otherwise time/random-derived IRIs.
	mintStatement  func(namespaceBaseIRI string) string
	mintAnnotation func(statementIRI string) string
}

var statementCounter, annotationCounter atomic.Uint64

// New builds a Service for the namespace rooted at defaultNamespaceBaseIRI.
func New(graph Graph, defaultNamespaceBaseIRI string) *Service {
	g := sparqlsafe.NamespaceGraphs(defaultNamespaceBaseIRI)
	return &Service{
		graph:          graph,
		graphs:         g,
		schemaN:        g.Schema + "#",
		mintStatement:  defaultMintStatement,
		mintAnnotation: defaultMintAnnotation,
	}
}

// defaultMintStatement mirrors `statementIri(ns, ISO-digits + counter)` in iri.ts/ensureReifiedFact.
func defaultMintStatement(namespaceBaseIRI string) string {
	digits := time.Now().UTC().Format("20060102150405.000")
	digits = strings.Replace(digits, ".", "", 1)
	return namespaceBaseIRI + "#Statement" + digits + strconv.FormatUint(statementCounter.Add(1)-1, 36)
}

// defaultMintAnnotation mirrors `annotationIri`: base36 time + counter + six random base36 characters.
func defaultMintAnnotation(statementIRI string) string {
	base := statementIRI
	if i := strings.IndexByte(statementIRI, '#'); i != -1 {
		base = statementIRI[:i]
	}
	token := strconv.FormatInt(time.Now().UnixMilli(), 36) +
		strconv.FormatUint(annotationCounter.Add(1)-1, 36) +
		strconv.FormatUint(rand.Uint64N(36*36*36*36*36*36)+36*36*36*36*36*36, 36)[1:]
	return base + "#Annotation" + token
}

func (s *Service) annotationClass() string      { return s.schemaN + "Annotation" }
func (s *Service) annotationLabelClass() string { return s.schemaN + "AnnotationLabel" }

func inGraph(triples, graph string) string { return fmt.Sprintf("GRAPH <%s> { %s }", graph, triples) }

func assertSafe(value, what string) error {
	if err := sparqlsafe.AssertSafeIRI(value, what); err != nil {
		return inputError{err.Error()}
	}
	return nil
}

// factObjectTerm renders a fact object as a SPARQL term, validating every IRI and language tag and
// escaping the literal's lexical form — the only place a fact's object is interpolated.
func factObjectTerm(o Object) (string, error) {
	if o.Kind == "iri" {
		if err := assertSafe(o.IRI, "object IRI"); err != nil {
			return "", err
		}
		return "<" + o.IRI + ">", nil
	}
	lexical := `"` + sparqlsafe.EscapeString(o.Value) + `"`
	if o.Datatype != nil && o.Lang != nil {
		return "", inputErrorf("A literal cannot have both a datatype and a language tag")
	}
	if o.Datatype != nil {
		if err := assertSafe(*o.Datatype, "datatype IRI"); err != nil {
			return "", err
		}
		return lexical + "^^<" + *o.Datatype + ">", nil
	}
	if o.Lang != nil {
		if !langTag.MatchString(*o.Lang) {
			return "", inputErrorf("Invalid language tag")
		}
		return lexical + "@" + *o.Lang, nil
	}
	return lexical, nil
}

// Add annotates a fact and returns the new Annotation node's IRI. Everything is validated before
// the first update; annotatedBy and annotatedAt are the server's stamp, never a client value.
func (s *Service) Add(ctx context.Context, fact Fact, annotation Annotation, annotatedBy, annotatedAt string) (string, error) {
	if err := assertSafe(fact.SubjectIRI, "subject IRI"); err != nil {
		return "", err
	}
	if err := assertSafe(fact.PredicateIRI, "predicate IRI"); err != nil {
		return "", err
	}
	if strings.TrimSpace(annotatedBy) == "" {
		return "", inputErrorf("annotatedBy must not be empty")
	}
	if _, err := time.Parse(time.RFC3339Nano, annotatedAt); err != nil {
		return "", inputErrorf("annotatedAt must be an ISO timestamp")
	}

	var valueTerm string
	if annotation.Type == "text" {
		text := strings.TrimSpace(annotation.Text)
		if text == "" {
			return "", inputErrorf("Annotation text must not be empty")
		}
		if sparqlsafe.UTF16Len(text) > MaxTextLength {
			return "", inputErrorf("Annotation text must be at most %d characters", MaxTextLength)
		}
		valueTerm = `"` + sparqlsafe.EscapeString(text) + `"`
	} else {
		if err := assertSafe(annotation.LabelIRI, "annotation label IRI"); err != nil {
			return "", err
		}
		valueTerm = "<" + annotation.LabelIRI + ">"
	}
	if _, err := factObjectTerm(fact.Object); err != nil {
		return "", err
	}

	if err := s.ensureClasses(ctx); err != nil {
		return "", err
	}
	if annotation.Type == "label" {
		isMember, err := s.graph.Ask(ctx, fmt.Sprintf("%s ASK { GRAPH ?g { <%s> a <%s> } }",
			sparqlsafe.Prefixes, annotation.LabelIRI, s.annotationLabelClass()))
		if err != nil {
			return "", err
		}
		if !isMember {
			return "", inputErrorf("The given IRI is not an annotation label")
		}
	}

	statement, err := s.ensureReifiedFact(ctx, fact)
	if err != nil {
		return "", err
	}
	namespaceBase, err := s.namespaceOfIndividual(ctx, fact.SubjectIRI)
	if err != nil {
		return "", err
	}
	iri := s.mintAnnotation(statement)
	if err := assertSafe(iri, "annotation IRI"); err != nil {
		return "", err
	}
	triples := fmt.Sprintf(`<%s> a <%s> ; <%sannotates> <%s> ; <%sannotationType> "%s" ; <%sannotationValue> %s ; <%sannotatedBy> "%s" ; <%sannotatedAt> "%s"^^xsd:dateTime .`,
		iri, s.annotationClass(),
		s.schemaN, statement,
		s.schemaN, annotation.Type,
		s.schemaN, valueTerm,
		s.schemaN, sparqlsafe.EscapeString(annotatedBy),
		s.schemaN, sparqlsafe.EscapeString(annotatedAt))
	err = s.graph.Update(ctx, fmt.Sprintf("%s INSERT DATA { %s }", sparqlsafe.Prefixes,
		inGraph(triples, sparqlsafe.NamespaceGraphs(namespaceBase).Instances)))
	if err != nil {
		return "", err
	}
	return iri, nil
}

// Delete removes exactly one Annotation node's triples. The reified statement and the ground triple
// are untouched; an IRI that is not an Annotation matches nothing, so nothing else can be deleted.
func (s *Service) Delete(ctx context.Context, annotationIRI string) error {
	if err := assertSafe(annotationIRI, "annotation IRI"); err != nil {
		return err
	}
	return s.graph.Update(ctx, fmt.Sprintf(
		"%s DELETE { GRAPH ?g { <%s> ?p ?o } } WHERE { GRAPH ?g { <%s> a <%s> ; ?p ?o } }",
		sparqlsafe.Prefixes, annotationIRI, annotationIRI, s.annotationClass()))
}

// ensureClasses idempotently declares `Annotation` and `AnnotationLabel` (schema graph) and seeds
// the label members that are not there yet (instances graph) with one INSERT DATA.
func (s *Service) ensureClasses(ctx context.Context) error {
	hasAnnotation, err := s.classExists(ctx, s.annotationClass())
	if err != nil {
		return err
	}
	hasLabel, err := s.classExists(ctx, s.annotationLabelClass())
	if err != nil {
		return err
	}
	res, err := s.graph.Select(ctx, fmt.Sprintf("%s SELECT ?m FROM <%s> WHERE { ?m a <%s> }",
		sparqlsafe.Prefixes, s.graphs.Instances, s.annotationLabelClass()))
	if err != nil {
		return err
	}
	existing := map[string]bool{}
	for _, b := range res.Results.Bindings {
		existing[b["m"].Value] = true
	}

	var triples []string
	if !hasAnnotation {
		triples = append(triples, inGraph(fmt.Sprintf(`<%s> a owl:Class ; rdfs:label "Annotation" .`, s.annotationClass()), s.graphs.Schema))
	}
	if !hasLabel {
		triples = append(triples, inGraph(fmt.Sprintf(`<%s> a owl:Class ; rdfs:label "AnnotationLabel" .`, s.annotationLabelClass()), s.graphs.Schema))
	}
	var members []string
	for _, name := range seedLabels {
		// individualIri(AnnotationLabel, name): camelCase(owner local name) + capitalize(camelCase(name)).
		iri := s.graphs.Instances + "#annotationLabel" + name
		if !existing[iri] {
			members = append(members, fmt.Sprintf(`<%s> a <%s> ; rdfs:label "%s" .`, iri, s.annotationLabelClass(), sparqlsafe.EscapeString(name)))
		}
	}
	if len(members) > 0 {
		triples = append(triples, inGraph(strings.Join(members, " "), s.graphs.Instances))
	}
	if len(triples) == 0 {
		return nil
	}
	return s.graph.Update(ctx, fmt.Sprintf("%s INSERT DATA { %s }", sparqlsafe.Prefixes, strings.Join(triples, " ")))
}

func (s *Service) classExists(ctx context.Context, iri string) (bool, error) {
	return s.graph.Ask(ctx, fmt.Sprintf("%s ASK FROM <%s> { <%s> a owl:Class }", sparqlsafe.Prefixes, s.graphs.Schema, iri))
}

// namespaceOfIndividual finds the graph an individual's own rdf:type triple lives in and maps it
// back to the namespace base IRI.
func (s *Service) namespaceOfIndividual(ctx context.Context, individualIRI string) (string, error) {
	if err := assertSafe(individualIRI, "individual IRI"); err != nil {
		return "", err
	}
	res, err := s.graph.Select(ctx, fmt.Sprintf("%s SELECT ?g WHERE { GRAPH ?g { <%s> a ?type } } LIMIT 1", sparqlsafe.Prefixes, individualIRI))
	if err != nil {
		return "", err
	}
	if len(res.Results.Bindings) == 0 || res.Results.Bindings[0]["g"].Value == "" {
		return "", inputErrorf("Cannot determine namespace: individual not found (%s)", individualIRI)
	}
	graph := res.Results.Bindings[0]["g"].Value
	if strings.HasSuffix(graph, "/schema") {
		return strings.TrimSuffix(graph, "/schema"), nil
	}
	return strings.TrimSuffix(graph, "/shapes"), nil
}

// ensureReifiedFact returns the fact's reifying rdf:Statement, minting and writing one into the
// subject's namespace when none exists. It never invents the ground triple itself.
func (s *Service) ensureReifiedFact(ctx context.Context, fact Fact) (string, error) {
	term, err := factObjectTerm(fact.Object)
	if err != nil {
		return "", err
	}
	namespaceBase, err := s.namespaceOfIndividual(ctx, fact.SubjectIRI)
	if err != nil {
		return "", err
	}
	graphs := sparqlsafe.NamespaceGraphs(namespaceBase)
	res, err := s.graph.Select(ctx, fmt.Sprintf(
		"%s SELECT ?stmt WHERE { GRAPH <%s> { ?stmt rdf:subject <%s> ; rdf:predicate <%s> ; rdf:object %s . } } LIMIT 1",
		sparqlsafe.Prefixes, graphs.Instances, fact.SubjectIRI, fact.PredicateIRI, term))
	if err != nil {
		return "", err
	}
	if len(res.Results.Bindings) > 0 && res.Results.Bindings[0]["stmt"].Value != "" {
		return res.Results.Bindings[0]["stmt"].Value, nil
	}
	stmt := s.mintStatement(namespaceBase)
	err = s.graph.Update(ctx, fmt.Sprintf("%s INSERT DATA { %s }", sparqlsafe.Prefixes, inGraph(
		fmt.Sprintf("<%s> a rdf:Statement ; rdf:subject <%s> ; rdf:predicate <%s> ; rdf:object %s .", stmt, fact.SubjectIRI, fact.PredicateIRI, term),
		graphs.Instances)))
	if err != nil {
		return "", err
	}
	return stmt, nil
}
