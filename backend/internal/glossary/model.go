// Package glossary serves the vocabulary of the core namespace to other tools (skos-support STORY-428): schemes and
// concepts as JSON or Turtle, read only. It reads the `<base>/vocab` graph of the namespace flagged
// `rse:vocabularyNamespace`, and only the predicates listed in `servedPredicates`: hidden labels, editorial notes and
// the project's own `rse:` fields are never selected, so they cannot reach either format.
package glossary

import "errors"

// Concept is one served concept. Lists are never nil, so they encode as [] and not null; the per-language maps
// (labels, definition, scopeNote) are keyed by language tag, with "und" for text without a language, and encode as {}.
type Concept struct {
	ID         string              `json:"id"`
	IRI        string              `json:"iri"`
	PrefLabel  map[string]string   `json:"prefLabel"`
	AltLabels  map[string][]string `json:"altLabels"`
	Definition map[string]string   `json:"definition"`
	ScopeNote  map[string]string   `json:"scopeNote"`
	Example    []string            `json:"example"`
	Notation   []string            `json:"notation"`
	Broader    []string            `json:"broader"`
	Narrower   []string            `json:"narrower"`
	Related    []string            `json:"related"`
	Mappings   []Mapping           `json:"mappings"`
	Scheme     string              `json:"scheme"`
	TopConcept bool                `json:"topConcept"`
	Status     string              `json:"status"`
	CreatedAt  string              `json:"createdAt"`
	ModifiedAt string              `json:"modifiedAt"`
}

// Mapping links a concept to a concept of another scheme.
type Mapping struct {
	Kind   string `json:"kind"`
	Target string `json:"target"`
}

// Scheme is one served concept scheme.
type Scheme struct {
	ID          string `json:"id"`
	IRI         string `json:"iri"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Title       string `json:"title"`
	Creator     string `json:"creator"`
	Publisher   string `json:"publisher"`
	Rights      string `json:"rights"`
	ModifiedAt  string `json:"modifiedAt"`
}

// Page is one page of concepts.
type Page struct {
	Items   []Concept `json:"items"`
	Page    int       `json:"page"`
	HasMore bool      `json:"hasMore"`
}

// Vocabulary is everything the service serves, sorted by IRI.
type Vocabulary struct {
	Schemes  []Scheme
	Concepts []Concept
}

// Filter narrows and pages a concept listing. The zero value lists the first page of everything.
type Filter struct {
	SchemeID      string
	Lang          string
	ModifiedSince string
	Page          int
	PageSize      int
}

const (
	DefaultPageSize = 100
	MaxPageSize     = 500
	maxPage         = 10000
)

type inputError struct{ msg string }

func (e *inputError) Error() string { return e.msg }

type notFoundError struct{ msg string }

func (e *notFoundError) Error() string { return e.msg }

func badInput(msg string) error { return &inputError{msg} }

// IsInputError reports whether err is a bad parameter (HTTP 400).
func IsInputError(err error) bool { var e *inputError; return errors.As(err, &e) }

// IsNotFound reports whether err names something that does not exist (HTTP 404).
func IsNotFound(err error) bool { var e *notFoundError; return errors.As(err, &e) }
