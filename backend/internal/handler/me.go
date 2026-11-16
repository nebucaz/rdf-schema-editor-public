package handler

import (
	"context"
	"encoding/json"
	"log"
	"net/http"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/issues"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/userjwt"
)

type userContextKey struct{}

// UserIdentity builds middleware that verifies the `Oglala` cookie against secret and, when it
// holds a valid access token, places the user in the request context. An absent, invalid or
// expired cookie — or an unset secret — is not an error: the request just carries no user, so
// browsing keeps working and only identity-requiring routes refuse.
func UserIdentity(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if cookie, err := r.Cookie(userjwt.CookieName); err == nil {
				if user, err := userjwt.Verify(cookie.Value, secret); err == nil {
					r = r.WithContext(context.WithValue(r.Context(), userContextKey{}, user))
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// UserFromRequest returns the verified end user UserIdentity found on r, if any — the author
// identity later handlers (annotations, shared queries) stamp.
func UserFromRequest(r *http.Request) (userjwt.User, bool) {
	user, ok := r.Context().Value(userContextKey{}).(userjwt.User)
	return user, ok
}

// RequireUser refuses, with a JSON 401, any request UserIdentity found no verified user for. Wrap it
// inside UserIdentity on every route that must not be reachable while signed out.
func RequireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := UserFromRequest(r); !ok {
			writeJSONError(w, http.StatusUnauthorized, "Sign in required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// UserDirectory remembers who has been seen, so the assignee pick list can show names of users other
// than the caller. *issues.Directory satisfies it.
type UserDirectory interface {
	Remember(ctx context.Context, u issues.KnownUser) error
}

// MeHandler serves GET /me. Users, when set, learns every verified user that calls it.
type MeHandler struct{ Users UserDirectory }

type meUser struct {
	Sub         string   `json:"sub"`
	DisplayName string   `json:"displayName"`
	Email       string   `json:"email"`
	Department  string   `json:"department"`
	Groups      []string `json:"groups"`
}

// Get replies `{"user": {...}}` for a verified user, else `{"user": null}` — always 200. Only the
// listed claims are exposed; the raw token never appears.
func (h MeHandler) Get(w http.ResponseWriter, r *http.Request) {
	var body struct {
		User *meUser `json:"user"`
	}
	if user, ok := UserFromRequest(r); ok {
		h.remember(r.Context(), user)
		body.User = &meUser{
			Sub:         user.Sub,
			DisplayName: user.DisplayName(),
			Email:       user.Email,
			Department:  user.Department,
			Groups:      user.Groups,
		}
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(body)
}

// remember is best-effort: the identity comes only from the verified cookie, and a failing GraphDB write
// is logged and never changes the response.
func (h MeHandler) remember(ctx context.Context, user userjwt.User) {
	if h.Users == nil {
		return
	}
	if err := h.Users.Remember(ctx, issues.KnownUser{Sub: user.Sub, DisplayName: user.DisplayName(), Email: user.Email}); err != nil {
		log.Printf("remember user %q: %v", user.Sub, err)
	}
}
