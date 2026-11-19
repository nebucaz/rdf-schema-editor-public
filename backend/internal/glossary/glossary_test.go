package glossary

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
)

const (
	defaultNS = "http://example.org/default"
	coreNS    = "http://example.org/core"
	schemaNS  = defaultNS + "/schema#"
)

// fixture mirrors the app's own model (see testdata/golden/glossary.json).
type fixture struct {
	Schemes []struct {
		IRI, Name, Description string
		Metadata               struct{ Title, Creator, Publisher, Rights, Modified string }
	} `json:"schemes"`
	Concepts []struct {
		IRI           string
		PrefLabels    []fixLang
		AltLabels     []fixLang
		HiddenLabels  []fixLang
		Definition    string
		ScopeNote     string
		Notation      []string
		Example       []string
		EditorialNote []string
		SchemeIri     string
		TopConcept    bool
		Status        string
		Created       string
		Modified      string
		Broader       []string
		Related       []string
		Mappings      []struct{ Kind, Target string }
	} `json:"concepts"`
}

type fixLang struct{ Text, Lang string }

func loadFixture(t *testing.T) fixture {
	t.Helper()
	raw, err := os.ReadFile("../../testdata/golden/glossary.json")
	if err != nil {
		t.Fatal(err)
	}
	var f fixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func iri(v string) graphdb.Binding    { return graphdb.Binding{Type: "uri", Value: v} }
func lit(v string) graphdb.Binding    { return graphdb.Binding{Type: "literal", Value: v} }
func tag(v, l string) graphdb.Binding { return graphdb.Binding{Type: "literal", Value: v, Lang: l} }
func typed(v, dt string) graphdb.Binding {
	return graphdb.Binding{Type: "literal", Value: v, Datatype: dt}
}

type fakeGraph struct {
	queries  []string
	ns       string
	schemes  []map[string]graphdb.Binding
	concepts []map[string]graphdb.Binding
}

func (g *fakeGraph) Select(_ context.Context, q string) (graphdb.SelectResult, error) {
	g.queries = append(g.queries, q)
	var r graphdb.SelectResult
	switch {
	case strings.Contains(q, "vocabularyNamespace"):
		if g.ns != "" {
			r.Results.Bindings = []map[string]graphdb.Binding{{"ns": iri(g.ns)}}
		}
	case strings.Contains(q, "ConceptScheme"):
		r.Results.Bindings = g.schemes
	default:
		r.Results.Bindings = g.concepts
	}
	return r, nil
}

func row(s string, p string, o graphdb.Binding) map[string]graphdb.Binding {
	return map[string]graphdb.Binding{"s": iri(s), "p": iri(p), "o": o}
}

// graphFrom turns the fixture into the rows a GraphDB would return, hidden labels and editorial notes included
// (the service must not serve them even if they reach it).
func graphFrom(f fixture) *fakeGraph {
	g := &fakeGraph{ns: coreNS}
	for _, s := range f.Schemes {
		g.schemes = append(g.schemes,
			row(s.IRI, rdfs+"label", lit(s.Name)), row(s.IRI, rdfs+"comment", lit(s.Description)),
			row(s.IRI, dct+"title", lit(s.Metadata.Title)), row(s.IRI, dct+"creator", lit(s.Metadata.Creator)),
			row(s.IRI, dct+"publisher", lit(s.Metadata.Publisher)), row(s.IRI, dct+"rights", lit(s.Metadata.Rights)),
			row(s.IRI, dct+"modified", typed(s.Metadata.Modified, xsd+"dateTime")))
	}
	for _, c := range f.Concepts {
		add := func(p string, o graphdb.Binding) { g.concepts = append(g.concepts, row(c.IRI, p, o)) }
		for _, l := range c.PrefLabels {
			add(skos+"prefLabel", tag(l.Text, l.Lang))
		}
		for _, l := range c.AltLabels {
			add(skos+"altLabel", tag(l.Text, l.Lang))
		}
		for _, l := range c.HiddenLabels {
			add(skos+"hiddenLabel", tag(l.Text, l.Lang))
		}
		for _, e := range c.EditorialNote {
			add(skos+"editorialNote", lit(e))
		}
		if c.Definition != "" {
			add(skos+"definition", lit(c.Definition))
		}
		if c.ScopeNote != "" {
			add(skos+"scopeNote", lit(c.ScopeNote))
		}
		for _, n := range c.Notation {
			add(skos+"notation", lit(n))
		}
		for _, e := range c.Example {
			add(skos+"example", lit(e))
		}
		add(skos+"inScheme", iri(c.SchemeIri))
		if c.TopConcept {
			add(skos+"topConceptOf", iri(c.SchemeIri))
		}
		for _, b := range c.Broader {
			add(skos+"broader", iri(b))
		}
		for _, r := range c.Related {
			add(skos+"related", iri(r))
		}
		for _, m := range c.Mappings {
			add(skos+m.Kind, iri(m.Target))
		}
		add(schemaNS+"status", lit(c.Status))
		add(schemaNS+"disambiguation", lit("internal"))
		add(dct+"created", typed(c.Created, xsd+"date"))
		add(dct+"modified", typed(c.Modified, xsd+"date"))
	}
	return g
}

func newService(g *fakeGraph) *Service { return New(g, defaultNS, schemaNS) }

func TestTurtleMatchesTheGoldenFile(t *testing.T) {
	f := loadFixture(t)
	svc := newService(graphFrom(f))
	v, err := svc.Load(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	got := Turtle(v.Schemes, v.Concepts)
	path := "../../testdata/golden/glossary.ttl"
	if os.Getenv("UPDATE_GOLDEN") != "" {
		if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v (run UPDATE_GOLDEN=1 go test ./internal/glossary to create it)", err)
	}
	if got != string(want) {
		t.Errorf("turtle differs from the golden file:\n%s", got)
	}
	if again := Turtle(v.Schemes, v.Concepts); again != got {
		t.Error("two runs differ")
	}
}

func TestNeitherFormatServesHiddenLabelsEditorialNotesOrInternalFields(t *testing.T) {
	f := loadFixture(t)
	g := graphFrom(f)
	v, err := newService(g).Load(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	asJSON, _ := json.Marshal(v.Concepts)
	text := string(asJSON) + Turtle(v.Schemes, v.Concepts)
	for _, banned := range []string{"Headcount", "Sister", "ask HR", "internal remark", "internal", "hiddenLabel", "editorialNote", "disambiguation"} {
		if strings.Contains(text, banned) {
			t.Errorf("output contains %q", banned)
		}
	}
	for _, q := range g.queries {
		for _, banned := range []string{"hiddenLabel", "editorialNote"} {
			if strings.Contains(q, banned) {
				t.Errorf("query asks for %s:\n%s", banned, q)
			}
		}
	}
}

func TestConceptFieldsAndDerivedRelations(t *testing.T) {
	v, err := newService(graphFrom(loadFixture(t))).Load(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(v.Concepts) != 3 || v.Concepts[0].IRI > v.Concepts[1].IRI {
		t.Fatalf("not three concepts in IRI order: %+v", v.Concepts)
	}
	byID := map[string]Concept{}
	for _, c := range v.Concepts {
		byID[c.ID] = c
	}
	staff := byID["Staff"]
	if staff.PrefLabel["en"] != "Staff" || staff.PrefLabel["de"] != "Personal" {
		t.Errorf("prefLabel = %v", staff.PrefLabel)
	}
	if len(staff.Narrower) != 2 || staff.Narrower[0] != coreNS+"/vocab#Doctor" {
		t.Errorf("narrower = %v", staff.Narrower)
	}
	if len(byID["Doctor"].Related) != 1 || byID["Doctor"].Related[0] != coreNS+"/vocab#Nurse" {
		t.Errorf("related must be symmetric: %v", byID["Doctor"].Related)
	}
	if staff.Status != "active" || staff.ModifiedAt != "2026-10-30" || staff.Scheme != coreNS+"/vocab#Workforce" {
		t.Errorf("staff = %+v", staff)
	}
	if staff.Broader == nil || staff.Mappings == nil || staff.Example == nil {
		t.Error("empty lists must be [] not null")
	}
}

func TestListFiltersAndPaging(t *testing.T) {
	svc := newService(graphFrom(loadFixture(t)))
	ctx := context.Background()

	all, err := svc.Concepts(ctx, Filter{})
	if err != nil || len(all.Items) != 3 || all.HasMore || all.Page != 1 {
		t.Fatalf("all = %+v, %v", all, err)
	}
	p1, _ := svc.Concepts(ctx, Filter{PageSize: 2})
	p2, _ := svc.Concepts(ctx, Filter{PageSize: 2, Page: 2})
	if len(p1.Items) != 2 || !p1.HasMore || len(p2.Items) != 1 || p2.HasMore {
		t.Errorf("paging: %d/%v then %d/%v", len(p1.Items), p1.HasMore, len(p2.Items), p2.HasMore)
	}
	since, _ := svc.Concepts(ctx, Filter{ModifiedSince: "2026-11-01"})
	if len(since.Items) != 1 || since.Items[0].ID != "Nurse" {
		t.Errorf("modifiedSince = %+v", since.Items)
	}
	de, _ := svc.Concepts(ctx, Filter{Lang: "de"})
	if len(de.Items) != 1 || de.Items[0].ID != "Staff" || len(de.Items[0].PrefLabel) != 1 {
		t.Errorf("lang = %+v", de.Items)
	}
	none, _ := svc.Concepts(ctx, Filter{SchemeID: "Missing"})
	if none.Items == nil || len(none.Items) != 0 {
		t.Errorf("an empty result must be [] not nil: %#v", none.Items)
	}
	one, _ := svc.Concepts(ctx, Filter{SchemeID: "Workforce"})
	if len(one.Items) != 3 {
		t.Errorf("scheme filter = %d", len(one.Items))
	}
}

func TestInvalidInputIsRejected(t *testing.T) {
	svc := newService(graphFrom(loadFixture(t)))
	for name, f := range map[string]Filter{
		"scheme id":     {SchemeID: "a b> } DROP"},
		"lang":          {Lang: "e n"},
		"modifiedSince": {ModifiedSince: "yesterday"},
		"page":          {Page: -1},
		"page size":     {PageSize: 100000},
	} {
		if _, err := svc.Concepts(context.Background(), f); !IsInputError(err) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
	if _, err := svc.Concept(context.Background(), "x y"); !IsInputError(err) {
		t.Errorf("bad id: %v", err)
	}
}

func TestOneConceptAndNotFound(t *testing.T) {
	svc := newService(graphFrom(loadFixture(t)))
	c, err := svc.Concept(context.Background(), "Nurse")
	if err != nil || c.ID != "Nurse" {
		t.Fatalf("%+v, %v", c, err)
	}
	if _, err := svc.Concept(context.Background(), "Nobody"); !IsNotFound(err) {
		t.Errorf("err = %v", err)
	}
}

func TestSchemes(t *testing.T) {
	svc := newService(graphFrom(loadFixture(t)))
	s, err := svc.Schemes(context.Background())
	if err != nil || len(s) != 1 {
		t.Fatalf("%v, %v", s, err)
	}
	if s[0].ID != "Workforce" || s[0].Title != "Workforce thesaurus" || s[0].Publisher != `Hospital "Mercy"` {
		t.Errorf("scheme = %+v", s[0])
	}
}

func TestWithoutAVocabularyNamespaceEverythingIsEmpty(t *testing.T) {
	g := graphFrom(loadFixture(t))
	g.ns = ""
	svc := newService(g)
	page, err := svc.Concepts(context.Background(), Filter{})
	if err != nil || page.Items == nil || len(page.Items) != 0 {
		t.Errorf("%+v, %v", page, err)
	}
	schemes, err := svc.Schemes(context.Background())
	if err != nil || schemes == nil || len(schemes) != 0 {
		t.Errorf("%v, %v", schemes, err)
	}
}

func TestTheVocabularyBaseIsCheckedBeforeItIsSplicedIntoAQuery(t *testing.T) {
	g := graphFrom(loadFixture(t))
	g.ns = "http://x/> } DROP ALL {"
	if _, err := newService(g).Load(context.Background()); err == nil {
		t.Error("an unsafe namespace IRI must be refused")
	}
}
