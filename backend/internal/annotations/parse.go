package annotations

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/sparqlsafe"
)

// MaxTextLength caps annotation text so a report cell stays readable (ANNOTATION_MAX_TEXT_LENGTH).
const MaxTextLength = 2000

// Object is the object of a fact: an IRI (a relation) or a literal (an attribute value).
type Object struct {
	Kind     string  `json:"kind"` // "iri" | "literal"
	IRI      string  `json:"iri"`
	Value    string  `json:"value"`
	Datatype *string `json:"datatype"`
	Lang     *string `json:"lang"`
}

// Fact is one fact to annotate: <subject> <predicate> <object>.
type Fact struct {
	SubjectIRI   string `json:"subjectIri"`
	PredicateIRI string `json:"predicateIri"`
	Object       Object `json:"object"`
}

// Annotation is what to attach to a fact: free text or an `AnnotationLabel` member.
type Annotation struct {
	Type     string `json:"type"` // "text" | "label"
	Text     string `json:"text"`
	LabelIRI string `json:"labelIri"`
}

// inputError marks a failure caused by what the caller sent, as opposed to the graph failing.
type inputError struct{ msg string }

func (e inputError) Error() string { return e.msg }

func inputErrorf(format string, args ...any) error { return inputError{fmt.Sprintf(format, args...)} }

// IsInputError reports whether err was caused by the request's content (HTTP 400) rather than by
// GraphDB being unreachable or failing (HTTP 502).
func IsInputError(err error) bool {
	var ie inputError
	return errors.As(err, &ie)
}

var langTag = regexp.MustCompile(`^[A-Za-z]+(-[A-Za-z0-9]+)*$`)

func safeIRI(v any, what string) (string, error) {
	s, ok := v.(string)
	if !ok || s == "" || !sparqlsafe.SafeIRI(s) {
		return "", inputErrorf("Invalid %s", what)
	}
	return s, nil
}

func asObject(v any) (map[string]any, bool) {
	m, ok := v.(map[string]any)
	return m, ok
}

// ParseFact validates the request's `fact` exactly as `parseFact` in the SvelteKit route did. raw
// is the decoded JSON value, so an absent key and an explicit null stay distinguishable.
func ParseFact(raw any) (Fact, error) {
	m, ok := asObject(raw)
	if !ok {
		return Fact{}, inputErrorf(`Missing or invalid "fact"`)
	}
	subject, err := safeIRI(m["subjectIri"], "subject IRI")
	if err != nil {
		return Fact{}, err
	}
	predicate, err := safeIRI(m["predicateIri"], "predicate IRI")
	if err != nil {
		return Fact{}, err
	}
	o, ok := asObject(m["object"])
	if !ok {
		return Fact{}, inputErrorf(`Missing or invalid "fact.object"`)
	}
	fact := Fact{SubjectIRI: subject, PredicateIRI: predicate}
	switch o["kind"] {
	case "iri":
		iri, err := safeIRI(o["iri"], "object IRI")
		if err != nil {
			return Fact{}, err
		}
		fact.Object = Object{Kind: "iri", IRI: iri}
	case "literal":
		value, ok := o["value"].(string)
		if !ok {
			return Fact{}, inputErrorf("Invalid literal value")
		}
		fact.Object = Object{Kind: "literal", Value: value}
		if dt, present := o["datatype"]; present {
			iri, err := safeIRI(dt, "datatype IRI")
			if err != nil {
				return Fact{}, err
			}
			fact.Object.Datatype = &iri
		}
		if l, present := o["lang"]; present {
			tag, ok := l.(string)
			if !ok || !langTag.MatchString(tag) {
				return Fact{}, inputErrorf("Invalid language tag")
			}
			fact.Object.Lang = &tag
		}
		if fact.Object.Datatype != nil && fact.Object.Lang != nil {
			return Fact{}, inputErrorf("A literal cannot have both a datatype and a language tag")
		}
	default:
		return Fact{}, inputErrorf(`fact.object.kind must be "iri" or "literal"`)
	}
	return fact, nil
}

// ParseAnnotation validates the request's `annotation` exactly as `parseAnnotation` in the
// SvelteKit route did. Text is returned as sent; Add trims it.
func ParseAnnotation(raw any) (Annotation, error) {
	m, ok := asObject(raw)
	if !ok {
		return Annotation{}, inputErrorf(`Missing or invalid "annotation"`)
	}
	switch m["type"] {
	case "text":
		text, ok := m["text"].(string)
		trimmed := strings.TrimSpace(text)
		if !ok || trimmed == "" {
			return Annotation{}, inputErrorf("Annotation text must not be empty")
		}
		if sparqlsafe.UTF16Len(trimmed) > MaxTextLength {
			return Annotation{}, inputErrorf("Annotation text must be at most %d characters", MaxTextLength)
		}
		return Annotation{Type: "text", Text: text}, nil
	case "label":
		iri, err := safeIRI(m["labelIri"], "label IRI")
		if err != nil {
			return Annotation{}, err
		}
		return Annotation{Type: "label", LabelIRI: iri}, nil
	}
	return Annotation{}, inputErrorf(`annotation.type must be "text" or "label"`)
}
