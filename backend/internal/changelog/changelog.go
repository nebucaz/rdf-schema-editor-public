// Package changelog records vocabulary and TBox changes: who, when, what, why, for which competency
// question and in which version (ontology-pipeline STORY-331). The server stamps `changedBy` and
// `changedAt`; whatever the client sends for them is never read. A `release` entry additionally
// replaces the namespace's `owl:versionInfo` in the same update (STORY-333).
//
// Entries live in the default namespace's `/schema` graph. ABox changes (the Backstage sync) are not
// logged here.
package changelog

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/sparqlsafe"
)

const (
	owlVersionInfo = "http://www.w3.org/2002/07/owl#versionInfo"
	xsdDateTime    = "http://www.w3.org/2001/XMLSchema#dateTime"
	maxSummary     = 500
	maxRationale   = 2000
	maxNotes       = 8000
	listLimit      = 500
)

// Graph is the slice of the GraphDB client the service uses; *graphdb.Client satisfies it.
type Graph interface {
	Select(ctx context.Context, query string) (graphdb.SelectResult, error)
	Update(ctx context.Context, update string) error
}

// ChangeKinds are what a change did to the model; STORY-333 derives the version bump from them.
var ChangeKinds = []string{"label", "comment", "addition", "removal", "rename", "domain-range", "disjointness", "other"}

var versionPattern = regexp.MustCompile(`^[0-9A-Za-z.+-]{1,40}$`)

// Entry is what a client may send.
type Entry struct {
	Kind       string `json:"kind"` // "change" or "release"
	Summary    string `json:"summary"`
	Rationale  string `json:"rationale"`
	Term       string `json:"term"`     // IRI of the concept, class or property changed
	Question   string `json:"question"` // IRI of the competency question that justifies it
	ChangeKind string `json:"changeKind"`
	Version    string `json:"version"`   // the version the entry belongs to; required for a release
	Namespace  string `json:"namespace"` // the namespace IRI whose version a release sets
}

// Item is a stored entry.
type Item struct {
	IRI        string `json:"iri"`
	Kind       string `json:"kind"`
	Summary    string `json:"summary"`
	Rationale  string `json:"rationale"`
	Term       string `json:"term"`
	Question   string `json:"question"`
	ChangeKind string `json:"changeKind"`
	Version    string `json:"version"`
	ChangedBy  string `json:"changedBy"`
	ChangedAt  string `json:"changedAt"`
}

// Filter narrows List; empty fields do not filter.
type Filter struct{ Term, Question, Version string }

type inputError struct{ msg string }

func (e inputError) Error() string { return e.msg }

func inputErrorf(format string, a ...any) error { return inputError{fmt.Sprintf(format, a...)} }

// IsInputError reports whether err was caused by the request (HTTP 400) rather than by GraphDB (502).
func IsInputError(err error) bool {
	var ie inputError
	return errors.As(err, &ie)
}

// Service reads and writes the change log.
type Service struct {
	graph   Graph
	schema  string // the default namespace's /schema graph
	schemaN string // schema + "#": where the change log vocabulary mints
	mint    func() string
}

var counter atomic.Uint64

// New builds a Service for the namespace rooted at defaultNamespaceBaseIRI.
func New(graph Graph, defaultNamespaceBaseIRI string) *Service {
	g := sparqlsafe.NamespaceGraphs(defaultNamespaceBaseIRI)
	return &Service{graph: graph, schema: g.Schema, schemaN: g.Schema + "#", mint: defaultMint}
}

func defaultMint() string {
	return strconv.FormatInt(time.Now().UnixMilli(), 36) + strconv.FormatUint(counter.Add(1)-1, 36) +
		strconv.FormatUint(rand.Uint64N(36*36*36*36)+36*36*36*36, 36)[1:]
}

func (s *Service) p(name string) string { return "<" + s.schemaN + name + ">" }

func safeOptionalIRI(v, what string) error {
	if v == "" {
		return nil
	}
	if !sparqlsafe.SafeIRI(v) {
		return inputErrorf("Invalid %s", what)
	}
	return nil
}

func validate(e Entry) error {
	if e.Kind != "change" && e.Kind != "release" {
		return inputErrorf(`"kind" must be "change" or "release"`)
	}
	limit := maxSummary
	if e.Kind == "release" {
		limit = maxNotes
	}
	if strings.TrimSpace(e.Summary) == "" {
		return inputErrorf("A summary is required")
	}
	if len(e.Summary) > limit || len(e.Rationale) > maxRationale {
		return inputErrorf("The entry is too long")
	}
	if err := safeOptionalIRI(e.Term, "term IRI"); err != nil {
		return err
	}
	if err := safeOptionalIRI(e.Question, "competency question IRI"); err != nil {
		return err
	}
	if e.ChangeKind != "" {
		ok := false
		for _, k := range ChangeKinds {
			ok = ok || k == e.ChangeKind
		}
		if !ok {
			return inputErrorf("Unknown change kind")
		}
	}
	if e.Version != "" && !versionPattern.MatchString(e.Version) {
		return inputErrorf("Invalid version")
	}
	if e.Kind == "release" {
		if e.Version == "" {
			return inputErrorf("A release needs a version")
		}
		if e.Namespace == "" || !sparqlsafe.SafeIRI(e.Namespace) {
			return inputErrorf("A release needs the namespace IRI")
		}
	}
	return nil
}

func lit(v string) string { return `"` + sparqlsafe.EscapeString(v) + `"` }

// Add stores the entry and returns its IRI. A release also replaces the namespace's version, in the
// same update. Everything is validated before the update is sent.
func (s *Service) Add(ctx context.Context, e Entry, changedBy, changedAt string) (string, error) {
	if err := validate(e); err != nil {
		return "", err
	}
	if e.Kind == "change" && e.Version == "" {
		v, err := s.currentVersion(ctx)
		if err != nil {
			return "", err
		}
		e.Version = v
	}
	iri := s.schemaN + "ChangeLogEntry" + s.mint()
	parts := []string{
		"a " + s.p("ChangeLogEntry"),
		s.p("entryKind") + " " + lit(e.Kind),
		s.p("changeSummary") + " " + lit(strings.TrimSpace(e.Summary)),
		s.p("changedBy") + " " + lit(changedBy),
		s.p("changedAt") + ` "` + changedAt + `"^^<` + xsdDateTime + `>`,
	}
	if e.Rationale != "" {
		parts = append(parts, s.p("changeRationale")+" "+lit(e.Rationale))
	}
	if e.Term != "" {
		parts = append(parts, s.p("changeTerm")+" <"+e.Term+">")
	}
	if e.Question != "" {
		parts = append(parts, s.p("changeQuestion")+" <"+e.Question+">")
	}
	if e.ChangeKind != "" {
		parts = append(parts, s.p("changeKind")+" "+lit(e.ChangeKind))
	}
	if e.Version != "" {
		parts = append(parts, s.p("changeVersion")+" "+lit(e.Version))
	}
	triples := "<" + iri + "> " + strings.Join(parts, " ; ") + " ."
	update := ""
	if e.Kind == "release" {
		ns := "<" + e.Namespace + ">"
		update += fmt.Sprintf("DELETE WHERE { GRAPH <%s> { %s <%s> ?old } } ;\n", s.schema, ns, owlVersionInfo)
		triples += fmt.Sprintf(" %s <%s> %s .", ns, owlVersionInfo, lit(e.Version))
	}
	update += fmt.Sprintf("INSERT DATA { GRAPH <%s> { %s } }", s.schema, triples)
	if err := s.graph.Update(ctx, update); err != nil {
		return "", err
	}
	return iri, nil
}

// List returns the entries, newest first, narrowed by the filter.
func (s *Service) List(ctx context.Context, f Filter) ([]Item, error) {
	var where []string
	if f.Term != "" {
		if !sparqlsafe.SafeIRI(f.Term) {
			return nil, inputErrorf("Invalid term IRI")
		}
		where = append(where, "?e "+s.p("changeTerm")+" <"+f.Term+"> .")
	}
	if f.Question != "" {
		if !sparqlsafe.SafeIRI(f.Question) {
			return nil, inputErrorf("Invalid competency question IRI")
		}
		where = append(where, "?e "+s.p("changeQuestion")+" <"+f.Question+"> .")
	}
	if f.Version != "" {
		if !versionPattern.MatchString(f.Version) {
			return nil, inputErrorf("Invalid version")
		}
		where = append(where, "?e "+s.p("changeVersion")+" "+lit(f.Version)+" .")
	}
	opt := func(v, pred string) string { return "OPTIONAL { ?e " + s.p(pred) + " ?" + v + " } " }
	q := fmt.Sprintf(`SELECT ?e ?kind ?summary ?by ?at ?rationale ?term ?question ?changeKind ?version FROM <%s> WHERE {
		?e a %s ; %s ?kind ; %s ?summary ; %s ?by ; %s ?at .
		%s %s%s%s%s%s
	} ORDER BY DESC(?at) LIMIT %d`,
		s.schema, s.p("ChangeLogEntry"), s.p("entryKind"), s.p("changeSummary"), s.p("changedBy"), s.p("changedAt"),
		strings.Join(where, " "),
		opt("rationale", "changeRationale"), opt("term", "changeTerm"), opt("question", "changeQuestion"),
		opt("changeKind", "changeKind"), opt("version", "changeVersion"), listLimit)
	res, err := s.graph.Select(ctx, q)
	if err != nil {
		return nil, err
	}
	items := make([]Item, 0, len(res.Results.Bindings))
	for _, b := range res.Results.Bindings {
		items = append(items, Item{
			IRI: b["e"].Value, Kind: b["kind"].Value, Summary: b["summary"].Value, ChangedBy: b["by"].Value,
			ChangedAt: b["at"].Value, Rationale: b["rationale"].Value, Term: b["term"].Value,
			Question: b["question"].Value, ChangeKind: b["changeKind"].Value, Version: b["version"].Value,
		})
	}
	return items, nil
}

// currentVersion is the `owl:versionInfo` of the namespace marked as the vocabulary namespace, or "" when
// there is none, so that every change is filed under the version it was made in.
func (s *Service) currentVersion(ctx context.Context) (string, error) {
	q := fmt.Sprintf("SELECT ?v FROM <%s> WHERE { ?ns %s true ; <%s> ?v } LIMIT 1", s.schema, s.p("vocabularyNamespace"), owlVersionInfo)
	res, err := s.graph.Select(ctx, q)
	if err != nil {
		return "", err
	}
	if len(res.Results.Bindings) == 0 {
		return "", nil
	}
	v := res.Results.Bindings[0]["v"].Value
	if !versionPattern.MatchString(v) {
		return "", nil
	}
	return v, nil
}
