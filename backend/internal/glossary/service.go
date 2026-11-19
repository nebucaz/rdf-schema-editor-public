package glossary

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/sparqlsafe"
)

const (
	skos = "http://www.w3.org/2004/02/skos/core#"
	dct  = "http://purl.org/dc/terms/"
	rdfs = "http://www.w3.org/2000/01/rdf-schema#"
	xsd  = "http://www.w3.org/2001/XMLSchema#"
)

var mappingKinds = []string{"exactMatch", "closeMatch", "relatedMatch", "broadMatch", "narrowMatch"}

var (
	idPattern   = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	langPattern = regexp.MustCompile(`^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$`)
)

// Graph is what the service needs from GraphDB; *graphdb.Client satisfies it. There is no update method on purpose.
type Graph interface {
	Select(ctx context.Context, query string) (graphdb.SelectResult, error)
}

// Service reads the vocabulary of the namespace flagged `rse:vocabularyNamespace`.
type Service struct {
	g                Graph
	defaultNamespace string
	rse              string // the project's own namespace, `<default>/schema#`
}

// New builds a Service. `rse` is the project schema namespace (the one `rse:status` lives in).
func New(g Graph, defaultNamespaceBaseIRI, rse string) *Service {
	return &Service{g: g, defaultNamespace: defaultNamespaceBaseIRI, rse: rse}
}

func (s *Service) vocabularyBase(ctx context.Context) (string, error) {
	graph := sparqlsafe.NamespaceGraphs(s.defaultNamespace).Schema
	res, err := s.g.Select(ctx, fmt.Sprintf(`SELECT ?ns FROM <%s> WHERE { ?ns <%svocabularyNamespace> true } LIMIT 1`, graph, s.rse))
	if err != nil {
		return "", err
	}
	if len(res.Results.Bindings) == 0 {
		return "", nil
	}
	base := res.Results.Bindings[0]["ns"].Value
	if err := sparqlsafe.AssertSafeIRI(base, "vocabulary namespace"); err != nil {
		return "", err
	}
	return base, nil
}

func iriList(iris []string) string {
	parts := make([]string, len(iris))
	for i, v := range iris {
		parts[i] = "<" + v + ">"
	}
	return strings.Join(parts, ", ")
}

func (s *Service) conceptPredicates() []string {
	p := []string{
		skos + "prefLabel", skos + "altLabel", skos + "definition", skos + "scopeNote", skos + "notation", skos + "example",
		skos + "inScheme", skos + "topConceptOf", skos + "broader", skos + "related",
		dct + "created", dct + "modified", s.rse + "status",
	}
	for _, k := range mappingKinds {
		p = append(p, skos+k)
	}
	return p
}

func schemePredicates() []string {
	return []string{rdfs + "label", rdfs + "comment", dct + "title", dct + "creator", dct + "publisher", dct + "rights", dct + "modified"}
}

func localName(iri, vocab string) string {
	prefix := vocab + "#"
	if strings.HasPrefix(iri, prefix) && idPattern.MatchString(iri[len(prefix):]) {
		return iri[len(prefix):]
	}
	return ""
}

func sortedUnique(v []string) []string {
	out := append([]string{}, v...)
	sort.Strings(out)
	n := 0
	for i, x := range out {
		if i == 0 || x != out[i-1] {
			out[n] = x
			n++
		}
	}
	return out[:n]
}

func langKey(l string) string {
	if l == "" {
		return "und"
	}
	return strings.ToLower(l)
}

// Load reads every scheme and concept of the vocabulary graph. It returns an empty Vocabulary when no namespace is
// flagged as the vocabulary namespace.
func (s *Service) Load(ctx context.Context) (Vocabulary, error) {
	empty := Vocabulary{Schemes: []Scheme{}, Concepts: []Concept{}}
	base, err := s.vocabularyBase(ctx)
	if err != nil || base == "" {
		return empty, err
	}
	graph := strings.TrimSuffix(base, "/") + "/vocab"
	schemeRows, err := s.g.Select(ctx, fmt.Sprintf(
		`SELECT ?s ?p ?o FROM <%s> WHERE { ?s a <%sConceptScheme> . ?s ?p ?o . FILTER(?p IN (%s)) }`, graph, skos, iriList(schemePredicates())))
	if err != nil {
		return empty, err
	}
	conceptRows, err := s.g.Select(ctx, fmt.Sprintf(
		`SELECT ?s ?p ?o FROM <%s> WHERE { ?s a <%sConcept> . ?s ?p ?o . FILTER(?p IN (%s)) }`, graph, skos, iriList(s.conceptPredicates())))
	if err != nil {
		return empty, err
	}

	schemes := map[string]*Scheme{}
	for _, b := range schemeRows.Results.Bindings {
		iri, p, o := b["s"].Value, b["p"].Value, b["o"].Value
		sc := schemes[iri]
		if sc == nil {
			sc = &Scheme{ID: localName(iri, graph), IRI: iri}
			schemes[iri] = sc
		}
		switch p {
		case rdfs + "label":
			sc.Label = o
		case rdfs + "comment":
			sc.Description = o
		case dct + "title":
			sc.Title = o
		case dct + "creator":
			sc.Creator = o
		case dct + "publisher":
			sc.Publisher = o
		case dct + "rights":
			sc.Rights = o
		case dct + "modified":
			sc.ModifiedAt = o
		}
	}

	concepts := map[string]*Concept{}
	for _, b := range conceptRows.Results.Bindings {
		iri, p, o := b["s"].Value, b["p"].Value, b["o"]
		c := concepts[iri]
		if c == nil {
			c = &Concept{ID: localName(iri, graph), IRI: iri, PrefLabel: map[string]string{}, AltLabels: map[string][]string{}, Status: "proposed"}
			concepts[iri] = c
		}
		switch p {
		case skos + "prefLabel":
			c.PrefLabel[langKey(o.Lang)] = o.Value
		case skos + "altLabel":
			c.AltLabels[langKey(o.Lang)] = append(c.AltLabels[langKey(o.Lang)], o.Value)
		case skos + "definition":
			c.Definition = o.Value
		case skos + "scopeNote":
			c.ScopeNote = o.Value
		case skos + "notation":
			c.Notation = append(c.Notation, o.Value)
		case skos + "example":
			c.Example = append(c.Example, o.Value)
		case skos + "inScheme":
			c.Scheme = o.Value
		case skos + "topConceptOf":
			c.TopConcept = true
			if c.Scheme == "" {
				c.Scheme = o.Value
			}
		case skos + "broader":
			c.Broader = append(c.Broader, o.Value)
		case skos + "related":
			c.Related = append(c.Related, o.Value)
		case dct + "created":
			c.CreatedAt = o.Value
		case dct + "modified":
			c.ModifiedAt = o.Value
		case s.rse + "status":
			c.Status = o.Value
		default:
			for _, k := range mappingKinds {
				if p == skos+k {
					c.Mappings = append(c.Mappings, Mapping{Kind: k, Target: o.Value})
				}
			}
		}
	}

	// `narrower` and the other half of `related` are derived: the app states each pair once.
	for iri, c := range concepts {
		for _, b := range c.Broader {
			if parent := concepts[b]; parent != nil {
				parent.Narrower = append(parent.Narrower, iri)
			}
		}
		for _, r := range c.Related {
			if other := concepts[r]; other != nil {
				other.Related = append(other.Related, iri)
			}
		}
	}

	v := Vocabulary{Schemes: make([]Scheme, 0, len(schemes)), Concepts: make([]Concept, 0, len(concepts))}
	for _, sc := range schemes {
		v.Schemes = append(v.Schemes, *sc)
	}
	sort.Slice(v.Schemes, func(i, j int) bool { return v.Schemes[i].IRI < v.Schemes[j].IRI })
	for _, c := range concepts {
		c.Broader, c.Narrower, c.Related = sortedUnique(c.Broader), sortedUnique(c.Narrower), sortedUnique(c.Related)
		c.Notation, c.Example = sortedUnique(c.Notation), sortedUnique(c.Example)
		for k := range c.AltLabels {
			c.AltLabels[k] = sortedUnique(c.AltLabels[k])
		}
		sort.Slice(c.Mappings, func(i, j int) bool {
			if c.Mappings[i].Kind != c.Mappings[j].Kind {
				return c.Mappings[i].Kind < c.Mappings[j].Kind
			}
			return c.Mappings[i].Target < c.Mappings[j].Target
		})
		if c.Mappings == nil {
			c.Mappings = []Mapping{}
		}
		v.Concepts = append(v.Concepts, *c)
	}
	sort.Slice(v.Concepts, func(i, j int) bool { return v.Concepts[i].IRI < v.Concepts[j].IRI })
	return v, nil
}

// Schemes lists every scheme.
func (s *Service) Schemes(ctx context.Context) ([]Scheme, error) {
	v, err := s.Load(ctx)
	return v.Schemes, err
}

func parseSince(raw string) (time.Time, error) {
	for _, layout := range []string{time.RFC3339, "2006-01-02"} {
		if t, err := time.Parse(layout, raw); err == nil {
			return t, nil
		}
	}
	return time.Time{}, badInput("modifiedSince must be an ISO date or date-time")
}

// Concepts lists the concepts matching f, one page at a time, in IRI order.
func (s *Service) Concepts(ctx context.Context, f Filter) (Page, error) {
	if f.SchemeID != "" && !idPattern.MatchString(f.SchemeID) {
		return Page{}, badInput("invalid scheme id")
	}
	if f.Lang != "" && !langPattern.MatchString(f.Lang) {
		return Page{}, badInput("invalid language tag")
	}
	var since time.Time
	if f.ModifiedSince != "" {
		t, err := parseSince(f.ModifiedSince)
		if err != nil {
			return Page{}, err
		}
		since = t
	}
	if f.Page < 0 || f.Page > maxPage {
		return Page{}, badInput("invalid page")
	}
	if f.PageSize < 0 || f.PageSize > MaxPageSize {
		return Page{}, badInput("pageSize must be at most " + strconv.Itoa(MaxPageSize))
	}
	page, size := f.Page, f.PageSize
	if page == 0 {
		page = 1
	}
	if size == 0 {
		size = DefaultPageSize
	}

	v, err := s.Load(ctx)
	if err != nil {
		return Page{}, err
	}
	schemeIRI := ""
	if f.SchemeID != "" {
		for _, sc := range v.Schemes {
			if sc.ID == f.SchemeID {
				schemeIRI = sc.IRI
			}
		}
		if schemeIRI == "" {
			return Page{Items: []Concept{}, Page: page}, nil
		}
	}
	lang := strings.ToLower(f.Lang)
	matched := []Concept{}
	for _, c := range v.Concepts {
		if schemeIRI != "" && c.Scheme != schemeIRI {
			continue
		}
		if !since.IsZero() {
			m, err := parseSince(c.ModifiedAt)
			if err != nil || m.Before(since) {
				continue
			}
		}
		if lang != "" {
			if _, ok := c.PrefLabel[lang]; !ok {
				continue
			}
			c = inLanguage(c, lang)
		}
		matched = append(matched, c)
	}
	start := (page - 1) * size
	if start > len(matched) {
		start = len(matched)
	}
	end := start + size
	if end > len(matched) {
		end = len(matched)
	}
	return Page{Items: matched[start:end], Page: page, HasMore: end < len(matched)}, nil
}

func inLanguage(c Concept, lang string) Concept {
	c.PrefLabel = map[string]string{lang: c.PrefLabel[lang]}
	alt := map[string][]string{}
	if v, ok := c.AltLabels[lang]; ok {
		alt[lang] = v
	}
	c.AltLabels = alt
	return c
}

// Concept returns one concept by its id (the local name in the vocabulary graph).
func (s *Service) Concept(ctx context.Context, id string) (Concept, error) {
	if !idPattern.MatchString(id) {
		return Concept{}, badInput("invalid concept id")
	}
	v, err := s.Load(ctx)
	if err != nil {
		return Concept{}, err
	}
	for _, c := range v.Concepts {
		if c.ID == id {
			return c, nil
		}
	}
	return Concept{}, &notFoundError{"unknown concept"}
}
