package glossary

import (
	"sort"
	"strings"
)

var turtleEscaper = strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`, "\r", `\r`, "\t", `\t`)

func quote(s string) string { return `"` + turtleEscaper.Replace(s) + `"` }

func langLit(text, lang string) string {
	if lang == "und" {
		return quote(text)
	}
	return quote(text) + "@" + lang
}

func dateLit(v string) string {
	if len(v) == 10 {
		return quote(v) + "^^xsd:date"
	}
	return quote(v) + "^^xsd:dateTime"
}

func ref(iri string) string { return "<" + iri + ">" }

// agent is an IRI when it looks like one (`scheme://…` or `urn:`), else a plain literal.
func agent(v string) string {
	isIRI := strings.Contains(v, "://") || strings.HasPrefix(v, "urn:")
	if isIRI && !strings.ContainsAny(v, " <>\"{}|\\^`\n") {
		return ref(v)
	}
	return quote(v)
}

type entry struct{ p, o string }

func writeSubject(b *strings.Builder, subject string, entries []entry) {
	b.WriteString(ref(subject))
	for i, e := range entries {
		sep := " ;"
		if i == len(entries)-1 {
			sep = " ."
		}
		b.WriteString("\n    " + e.p + " " + e.o + sep)
	}
	b.WriteString("\n\n")
}

// Turtle serialises schemes and concepts. The output is sorted, so two runs on the same input are byte-identical.
// It states every `broader`/`narrower` and `related` pair both ways and writes the same triples the app's own
// export does by default, minus hidden labels (never served) and collections.
func Turtle(schemes []Scheme, concepts []Concept) string {
	var b strings.Builder
	b.WriteString("@prefix skos: <http://www.w3.org/2004/02/skos/core#> .\n")
	b.WriteString("@prefix dct: <http://purl.org/dc/terms/> .\n")
	b.WriteString("@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n")
	b.WriteString("@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n")

	tops := map[string][]string{}
	for _, c := range concepts {
		if c.TopConcept && c.Scheme != "" {
			tops[c.Scheme] = append(tops[c.Scheme], c.IRI)
		}
	}
	ss := append([]Scheme{}, schemes...)
	sort.Slice(ss, func(i, j int) bool { return ss[i].IRI < ss[j].IRI })
	for _, s := range ss {
		e := []entry{{"a", "skos:ConceptScheme"}}
		if s.Label != "" {
			e = append(e, entry{"rdfs:label", quote(s.Label)})
		}
		if s.Description != "" {
			e = append(e, entry{"rdfs:comment", quote(s.Description)})
		}
		if s.Title != "" {
			e = append(e, entry{"dct:title", quote(s.Title)})
		}
		if s.Creator != "" {
			e = append(e, entry{"dct:creator", agent(s.Creator)})
		}
		if s.Publisher != "" {
			e = append(e, entry{"dct:publisher", agent(s.Publisher)})
		}
		if s.Rights != "" {
			e = append(e, entry{"dct:rights", quote(s.Rights)})
		}
		if s.ModifiedAt != "" {
			e = append(e, entry{"dct:modified", quote(s.ModifiedAt) + "^^xsd:dateTime"})
		}
		for _, t := range sortedUnique(tops[s.IRI]) {
			e = append(e, entry{"skos:hasTopConcept", ref(t)})
		}
		writeSubject(&b, s.IRI, e)
	}

	cs := append([]Concept{}, concepts...)
	sort.Slice(cs, func(i, j int) bool { return cs[i].IRI < cs[j].IRI })
	for _, c := range cs {
		e := []entry{{"a", "skos:Concept"}}
		langs := make([]string, 0, len(c.PrefLabel))
		for l := range c.PrefLabel {
			langs = append(langs, l)
		}
		sort.Strings(langs)
		for _, l := range langs {
			e = append(e, entry{"skos:prefLabel", langLit(c.PrefLabel[l], l)})
		}
		langs = langs[:0]
		for l := range c.AltLabels {
			langs = append(langs, l)
		}
		sort.Strings(langs)
		for _, l := range langs {
			for _, t := range c.AltLabels[l] {
				e = append(e, entry{"skos:altLabel", langLit(t, l)})
			}
		}
		text := func(p, v string) {
			if strings.TrimSpace(v) != "" {
				e = append(e, entry{p, quote(v)})
			}
		}
		perLanguage := func(p string, m map[string]string) {
			ls := make([]string, 0, len(m))
			for l := range m {
				ls = append(ls, l)
			}
			sort.Strings(ls)
			for _, l := range ls {
				if strings.TrimSpace(m[l]) != "" {
					e = append(e, entry{p, langLit(m[l], l)})
				}
			}
		}
		perLanguage("skos:definition", c.Definition)
		perLanguage("skos:scopeNote", c.ScopeNote)
		for _, v := range c.Notation {
			text("skos:notation", v)
		}
		for _, v := range c.Example {
			text("skos:example", v)
		}
		if c.CreatedAt != "" {
			e = append(e, entry{"dct:created", dateLit(c.CreatedAt)})
		}
		if c.ModifiedAt != "" {
			e = append(e, entry{"dct:modified", dateLit(c.ModifiedAt)})
		}
		if c.Scheme != "" {
			e = append(e, entry{"skos:inScheme", ref(c.Scheme)})
			if c.TopConcept {
				e = append(e, entry{"skos:topConceptOf", ref(c.Scheme)})
			}
		}
		for _, p := range []struct {
			name string
			iris []string
		}{{"skos:broader", c.Broader}, {"skos:narrower", c.Narrower}, {"skos:related", c.Related}} {
			for _, v := range p.iris {
				e = append(e, entry{p.name, ref(v)})
			}
		}
		for _, m := range c.Mappings {
			e = append(e, entry{"skos:" + m.Kind, ref(m.Target)})
		}
		writeSubject(&b, c.IRI, e)
	}
	return b.String()
}
