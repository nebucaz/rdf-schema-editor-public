package issues

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
)

func (s *Store) userIRI(sub string) string {
	sum := sha256.Sum256([]byte(sub))
	return "<" + s.ns + "user-" + hex.EncodeToString(sum[:8]) + ">"
}

// UpsertKnownUser replaces the user's node in the issues graph.
func (s *Store) UpsertKnownUser(ctx context.Context, u KnownUser, at string) error {
	if u.Sub == "" || len(u.Sub) > MaxSub || len(u.DisplayName) > MaxSub || len(u.Email) > MaxSub {
		return inputErrorf("Invalid user")
	}
	node := s.userIRI(u.Sub)
	triples := fmt.Sprintf("%s a %s ; %s %s ; %s %s ; %s %s ; %s %s .", node, s.p("KnownUser"),
		s.p("sub"), lit(u.Sub), s.p("displayName"), lit(u.DisplayName), s.p("email"), lit(u.Email), s.p("lastSeenAt"), dt(at))
	return s.graph.Update(ctx, fmt.Sprintf("DELETE WHERE { GRAPH <%[1]s> { %[2]s ?p ?o } } ;\nINSERT DATA { GRAPH <%[1]s> { %[3]s } }", s.g, node, triples))
}

// KnownUsers returns the remembered users.
func (s *Store) KnownUsers(ctx context.Context) ([]KnownUser, error) {
	q := fmt.Sprintf("SELECT ?sub ?name ?email FROM <%s> WHERE { ?u a %s ; %s ?sub . OPTIONAL { ?u %s ?name } OPTIONAL { ?u %s ?email } }",
		s.g, s.p("KnownUser"), s.p("sub"), s.p("displayName"), s.p("email"))
	res, err := s.graph.Select(ctx, q)
	if err != nil {
		return nil, err
	}
	out := make([]KnownUser, 0, len(res.Results.Bindings))
	for _, b := range res.Results.Bindings {
		out = append(out, KnownUser{Sub: b["sub"].Value, DisplayName: b["name"].Value, Email: b["email"].Value})
	}
	return out, nil
}

// seenSubs lists the distinct authors found in the change log, annotations, shared queries and issues.
func (s *Store) seenSubs(ctx context.Context, schemaGraph, schemaN string) ([]string, error) {
	q := fmt.Sprintf(`SELECT DISTINCT ?sub WHERE {
	{ GRAPH <%[1]s> { ?x <%[2]schangedBy> ?sub } }
	UNION { GRAPH <%[1]s> { ?x <%[2]screatedBy> ?sub } }
	UNION { GRAPH ?ig { ?x <%[2]sannotatedBy> ?sub } }
	UNION { GRAPH <%[3]s> { ?x %[4]s ?sub } }
	UNION { GRAPH <%[3]s> { ?x %[5]s ?sub } }
}`, schemaGraph, schemaN, s.g, s.p("updatedBy"), s.p("assignee"))
	res, err := s.graph.Select(ctx, q)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, b := range res.Results.Bindings {
		out = append(out, b["sub"].Value)
	}
	sort.Strings(out)
	return out, nil
}
