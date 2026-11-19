// Package preferences stores small per-user UI settings (spec/ontology-dashboard STORY-468), such as the arrangement
// of the Ontology dashboard tiles. The owner is always the verified cookie user, never a client value. They live in
// one dedicated graph, `<default base>/preferences`, which is not one of `sparqlsafe.NamespaceGraphs`, so no
// namespace view, export or sync reads it.
package preferences

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/sparqlsafe"
)

const (
	// MaxValueBytes caps one stored value.
	MaxValueBytes = 8 * 1024
	xsdDateTime   = "http://www.w3.org/2001/XMLSchema#dateTime"
)

// allowedKeys are the preferences a client may read and write.
var allowedKeys = map[string]bool{"ontology-dashboard": true}

// IsAllowedKey reports whether key names a known preference.
func IsAllowedKey(key string) bool { return allowedKeys[key] }

// Graph is the slice of the GraphDB client the service uses; *graphdb.Client satisfies it.
type Graph interface {
	Select(ctx context.Context, query string) (graphdb.SelectResult, error)
	Update(ctx context.Context, update string) error
}

type inputError struct{ msg string }

func (e inputError) Error() string { return e.msg }

// IsInputError reports whether err was caused by the request (HTTP 4xx) rather than by GraphDB (502).
func IsInputError(err error) bool {
	var ie inputError
	return errors.As(err, &ie)
}

// IsTooLarge reports whether err is the size-cap error, which the handler answers with 413.
func IsTooLarge(err error) bool {
	var ie inputError
	return errors.As(err, &ie) && ie.msg == errTooLarge.msg
}

var errTooLarge = inputError{fmt.Sprintf("The preference is larger than %d KiB", MaxValueBytes/1024)}

// Service reads and writes preferences.
type Service struct {
	graph Graph
	g     string // the preferences graph IRI
}

// New builds a Service for the namespace rooted at defaultNamespaceBaseIRI.
func New(graph Graph, defaultNamespaceBaseIRI string) *Service {
	return &Service{graph: graph, g: sparqlsafe.NamespaceGraphs(defaultNamespaceBaseIRI).Instances + "/preferences"}
}

// node mints the IRI of one (user, key) pair from a hash, so neither value is ever put into an IRI.
func (s *Service) node(user, key string) string {
	sum := sha256.Sum256([]byte(user + "\x00" + key))
	return s.g + "#" + hex.EncodeToString(sum[:])
}

func (s *Service) p(name string) string { return "<" + s.g + "#" + name + ">" }

func lit(v string) string { return `"` + sparqlsafe.EscapeString(v) + `"` }

// Get returns the user's stored value as compact JSON, or nil when none is stored.
func (s *Service) Get(ctx context.Context, user, key string) (json.RawMessage, error) {
	if !IsAllowedKey(key) {
		return nil, inputError{"Unknown preference"}
	}
	q := "SELECT ?value WHERE { GRAPH <" + s.g + "> { <" + s.node(user, key) + "> " + s.p("value") + " ?value } } LIMIT 1"
	res, err := s.graph.Select(ctx, q)
	if err != nil {
		return nil, err
	}
	if len(res.Results.Bindings) == 0 {
		return nil, nil
	}
	return json.RawMessage(res.Results.Bindings[0]["value"].Value), nil
}

// Put replaces the user's value in one update. The value must be valid JSON within MaxValueBytes.
func (s *Service) Put(ctx context.Context, user, key string, value []byte, updatedAt string) error {
	if !IsAllowedKey(key) {
		return inputError{"Unknown preference"}
	}
	var compact bytes.Buffer
	if len(value) == 0 || json.Compact(&compact, value) != nil {
		return inputError{"The preference is not valid JSON"}
	}
	if compact.Len() > MaxValueBytes {
		return errTooLarge
	}
	n := "<" + s.node(user, key) + ">"
	update := "WITH <" + s.g + "> DELETE { " + n + " ?p ?o } WHERE { " + n + " ?p ?o } ;\n" +
		"INSERT DATA { GRAPH <" + s.g + "> { " + n + " a " + s.p("Preference") + " ; " +
		s.p("user") + " " + lit(user) + " ; " +
		s.p("key") + " " + lit(key) + " ; " +
		s.p("value") + " " + lit(compact.String()) + " ; " +
		s.p("updatedAt") + ` "` + updatedAt + `"^^<` + xsdDateTime + `> . } }`
	return s.graph.Update(ctx, update)
}
