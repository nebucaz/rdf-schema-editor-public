package annotations

import (
	"encoding/json"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

func regexpMatch(pattern, s string) bool { return regexp.MustCompile(pattern).MatchString(s) }

func decode(t *testing.T, s string) any {
	t.Helper()
	var v any
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestParseFact(t *testing.T) {
	str := func(s string) *string { return &s }
	ok := []struct {
		name, in string
		want     Fact
	}{
		{"iri object", `{"subjectIri":"s","predicateIri":"p","object":{"kind":"iri","iri":"o"}}`,
			Fact{"s", "p", Object{Kind: "iri", IRI: "o"}}},
		{"plain literal", `{"subjectIri":"s","predicateIri":"p","object":{"kind":"literal","value":"v"}}`,
			Fact{"s", "p", Object{Kind: "literal", Value: "v"}}},
		{"empty literal value", `{"subjectIri":"s","predicateIri":"p","object":{"kind":"literal","value":""}}`,
			Fact{"s", "p", Object{Kind: "literal", Value: ""}}},
		{"typed literal", `{"subjectIri":"s","predicateIri":"p","object":{"kind":"literal","value":"1","datatype":"http://www.w3.org/2001/XMLSchema#integer"}}`,
			Fact{"s", "p", Object{Kind: "literal", Value: "1", Datatype: str("http://www.w3.org/2001/XMLSchema#integer")}}},
		{"language literal", `{"subjectIri":"s","predicateIri":"p","object":{"kind":"literal","value":"x","lang":"de-CH"}}`,
			Fact{"s", "p", Object{Kind: "literal", Value: "x", Lang: str("de-CH")}}},
		{"unknown fields ignored", `{"subjectIri":"s","predicateIri":"p","extra":1,"object":{"kind":"iri","iri":"o","x":2}}`,
			Fact{"s", "p", Object{Kind: "iri", IRI: "o"}}},
	}
	for _, c := range ok {
		t.Run(c.name, func(t *testing.T) {
			got, err := ParseFact(decode(t, c.in))
			if err != nil {
				t.Fatalf("err = %v", err)
			}
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("got %+v, want %+v", got, c.want)
			}
		})
	}

	bad := []struct{ name, in, msg string }{
		{"not an object", `[]`, `Missing or invalid "fact"`},
		{"null", `null`, `Missing or invalid "fact"`},
		{"string", `"x"`, `Missing or invalid "fact"`},
		{"subject missing", `{"predicateIri":"p","object":{"kind":"iri","iri":"o"}}`, "Invalid subject IRI"},
		{"subject empty", `{"subjectIri":"","predicateIri":"p","object":{"kind":"iri","iri":"o"}}`, "Invalid subject IRI"},
		{"subject unsafe", `{"subjectIri":"a b","predicateIri":"p","object":{"kind":"iri","iri":"o"}}`, "Invalid subject IRI"},
		{"subject a number", `{"subjectIri":5,"predicateIri":"p","object":{"kind":"iri","iri":"o"}}`, "Invalid subject IRI"},
		{"predicate unsafe", `{"subjectIri":"s","predicateIri":"p>","object":{"kind":"iri","iri":"o"}}`, "Invalid predicate IRI"},
		{"object missing", `{"subjectIri":"s","predicateIri":"p"}`, `Missing or invalid "fact.object"`},
		{"object an array", `{"subjectIri":"s","predicateIri":"p","object":[]}`, `Missing or invalid "fact.object"`},
		{"object kind unknown", `{"subjectIri":"s","predicateIri":"p","object":{"kind":"bnode"}}`, `fact.object.kind must be "iri" or "literal"`},
		{"object kind missing", `{"subjectIri":"s","predicateIri":"p","object":{}}`, `fact.object.kind must be "iri" or "literal"`},
		{"object iri unsafe", `{"subjectIri":"s","predicateIri":"p","object":{"kind":"iri","iri":"o\"x"}}`, "Invalid object IRI"},
		{"object iri missing", `{"subjectIri":"s","predicateIri":"p","object":{"kind":"iri"}}`, "Invalid object IRI"},
		{"literal value missing", `{"subjectIri":"s","predicateIri":"p","object":{"kind":"literal"}}`, "Invalid literal value"},
		{"literal value a number", `{"subjectIri":"s","predicateIri":"p","object":{"kind":"literal","value":1}}`, "Invalid literal value"},
		{"datatype unsafe", `{"subjectIri":"s","predicateIri":"p","object":{"kind":"literal","value":"v","datatype":"a b"}}`, "Invalid datatype IRI"},
		{"datatype null", `{"subjectIri":"s","predicateIri":"p","object":{"kind":"literal","value":"v","datatype":null}}`, "Invalid datatype IRI"},
		{"lang invalid", `{"subjectIri":"s","predicateIri":"p","object":{"kind":"literal","value":"v","lang":"en_US"}}`, "Invalid language tag"},
		{"lang empty", `{"subjectIri":"s","predicateIri":"p","object":{"kind":"literal","value":"v","lang":""}}`, "Invalid language tag"},
		{"lang a number", `{"subjectIri":"s","predicateIri":"p","object":{"kind":"literal","value":"v","lang":5}}`, "Invalid language tag"},
		{"lang trailing newline", "{\"subjectIri\":\"s\",\"predicateIri\":\"p\",\"object\":{\"kind\":\"literal\",\"value\":\"v\",\"lang\":\"en\\n\"}}", "Invalid language tag"},
		{"datatype and lang", `{"subjectIri":"s","predicateIri":"p","object":{"kind":"literal","value":"v","datatype":"d","lang":"en"}}`, "A literal cannot have both a datatype and a language tag"},
	}
	for _, c := range bad {
		t.Run(c.name, func(t *testing.T) {
			_, err := ParseFact(decode(t, c.in))
			if err == nil || err.Error() != c.msg {
				t.Errorf("err = %v, want %q", err, c.msg)
			}
			if !IsInputError(err) {
				t.Error("a parse failure must be an input error")
			}
		})
	}
}

func TestParseAnnotation(t *testing.T) {
	ok := []struct {
		name, in string
		want     Annotation
	}{
		{"text", `{"type":"text","text":"hello"}`, Annotation{Type: "text", Text: "hello"}},
		{"text keeps its padding (Add trims)", `{"type":"text","text":"  hi  "}`, Annotation{Type: "text", Text: "  hi  "}},
		{"label", `{"type":"label","labelIri":"https://x/l"}`, Annotation{Type: "label", LabelIRI: "https://x/l"}},
		{"text at the cap", `{"type":"text","text":"` + strings.Repeat("a", 2000) + `"}`, Annotation{Type: "text", Text: strings.Repeat("a", 2000)}},
		{"cap counts after trim", `{"type":"text","text":"  ` + strings.Repeat("a", 2000) + `  "}`, Annotation{Type: "text", Text: "  " + strings.Repeat("a", 2000) + "  "}},
	}
	for _, c := range ok {
		t.Run(c.name, func(t *testing.T) {
			got, err := ParseAnnotation(decode(t, c.in))
			if err != nil || got != c.want {
				t.Errorf("got %+v, %v; want %+v", got, err, c.want)
			}
		})
	}

	bad := []struct{ name, in, msg string }{
		{"not an object", `[]`, `Missing or invalid "annotation"`},
		{"null", `null`, `Missing or invalid "annotation"`},
		{"type missing", `{}`, `annotation.type must be "text" or "label"`},
		{"type unknown", `{"type":"emoji"}`, `annotation.type must be "text" or "label"`},
		{"text missing", `{"type":"text"}`, "Annotation text must not be empty"},
		{"text blank", `{"type":"text","text":"  \n "}`, "Annotation text must not be empty"},
		{"text a number", `{"type":"text","text":5}`, "Annotation text must not be empty"},
		{"text too long", `{"type":"text","text":"` + strings.Repeat("a", 2001) + `"}`, "Annotation text must be at most 2000 characters"},
		{"astral characters count twice", `{"type":"text","text":"` + strings.Repeat("😀", 1001) + `"}`, "Annotation text must be at most 2000 characters"},
		{"label iri missing", `{"type":"label"}`, "Invalid label IRI"},
		{"label iri unsafe", `{"type":"label","labelIri":"a>b"}`, "Invalid label IRI"},
	}
	for _, c := range bad {
		t.Run(c.name, func(t *testing.T) {
			_, err := ParseAnnotation(decode(t, c.in))
			if err == nil || err.Error() != c.msg {
				t.Errorf("err = %v, want %q", err, c.msg)
			}
			if !IsInputError(err) {
				t.Error("a parse failure must be an input error")
			}
		})
	}
}
