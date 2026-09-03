package handler

import (
	"context"
	"net/http"
	"strings"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/jwtauth"
)

// subjectContextKey is an unexported type so no other package can collide with this context key —
// the standard Go pattern for typed context values.
type subjectContextKey struct{}

// SubjectFromContext reads the verified caller identity (the JWT's `sub` claim) JWTAuth placed in
// the request context, for downstream handlers/the audit logger (STORY-006) to read.
func SubjectFromContext(ctx context.Context) (string, bool) {
	sub, ok := ctx.Value(subjectContextKey{}).(string)
	return sub, ok
}

// JWTAuth builds a chi-compatible middleware that requires a validly-signed, unexpired
// `Authorization: Bearer <jwt>` header on every request it wraps, verified against secret. A
// missing header, malformed header, bad signature, or expired token all get an identical 401 —
// deliberately no detail on *why*, so a caller can't use the response to probe token format/
// signature validity (STORY-002's AC). On success, the verified `sub` is placed in the request
// context for downstream handlers to read via SubjectFromContext.
func JWTAuth(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			token, ok := strings.CutPrefix(authHeader, "Bearer ")
			if !ok || token == "" {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}

			sub, err := jwtauth.Verify(token, secret)
			if err != nil {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), subjectContextKey{}, sub)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
