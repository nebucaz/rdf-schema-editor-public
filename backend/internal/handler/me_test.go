package handler

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/userjwt"
)

const userSecret = "user-secret"

func userToken(t *testing.T, claims jwt.MapClaims, key string) string {
	t.Helper()
	if _, ok := claims["exp"]; !ok {
		claims["exp"] = time.Now().Add(time.Hour).Unix()
	}
	s, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(key))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func callMe(t *testing.T, secret, cookie string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	h := UserIdentity(secret)(http.HandlerFunc(MeHandler{}.Get))
	req := httptest.NewRequest(http.MethodGet, "/me", nil)
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: userjwt.CookieName, Value: cookie})
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %q: %v", w.Body.String(), err)
	}
	return w, body
}

func TestMe_ValidCookie(t *testing.T) {
	tok := userToken(t, jwt.MapClaims{
		"sub": "u1", "loginid": "u1", "email": "a@x.example", "department": "R&D", "name": "Alice Example",
		"preferred_username": "alice", "groups": []string{"g1"}, "secretish": "leak-me",
	}, userSecret)

	w, body := callMe(t, userSecret, tok)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	user, _ := body["user"].(map[string]any)
	if user["sub"] != "u1" || user["displayName"] != "Alice Example" || user["email"] != "a@x.example" || user["department"] != "R&D" {
		t.Errorf("user = %v", user)
	}
	if groups, _ := user["groups"].([]any); len(groups) != 1 || groups[0] != "g1" {
		t.Errorf("groups = %v", user["groups"])
	}
	if len(user) != 5 {
		t.Errorf("user has keys %v, want exactly sub/displayName/email/department/groups", user)
	}
	if strings.Contains(w.Body.String(), tok) || strings.Contains(w.Body.String(), "leak-me") {
		t.Error("response leaks the raw token or an unlisted claim")
	}
}

func TestMe_NullUser(t *testing.T) {
	cases := map[string]struct{ secret, cookie string }{
		"no cookie":        {userSecret, ""},
		"bad signature":    {userSecret, userToken(t, jwt.MapClaims{"sub": "u"}, "other")},
		"expired":          {userSecret, userToken(t, jwt.MapClaims{"sub": "u", "exp": time.Now().Add(-time.Hour).Unix()}, userSecret)},
		"malformed":        {userSecret, "garbage"},
		"secret not set":   {"", userToken(t, jwt.MapClaims{"sub": "u"}, "")},
		"secret not set 2": {"", userToken(t, jwt.MapClaims{"sub": "u"}, userSecret)},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			w, body := callMe(t, tc.secret, tc.cookie)
			if w.Code != http.StatusOK {
				t.Errorf("status = %d, want 200", w.Code)
			}
			if v, ok := body["user"]; !ok || v != nil {
				t.Errorf("body = %v, want {\"user\": null}", body)
			}
		})
	}
}

func TestUserFromRequest(t *testing.T) {
	var got userjwt.User
	var ok bool
	h := UserIdentity(userSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, ok = UserFromRequest(r)
	}))

	req := httptest.NewRequest(http.MethodPost, "/x", nil)
	req.AddCookie(&http.Cookie{Name: userjwt.CookieName, Value: userToken(t, jwt.MapClaims{"sub": "u1"}, userSecret)})
	h.ServeHTTP(httptest.NewRecorder(), req)
	if !ok || got.Sub != "u1" {
		t.Errorf("UserFromRequest = %+v, %v", got, ok)
	}

	ok = true
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/x", nil))
	if ok {
		t.Error("UserFromRequest reported a user for a cookie-less request")
	}
	if _, found := UserFromRequest(httptest.NewRequest(http.MethodGet, "/", nil)); found {
		t.Error("UserFromRequest found a user without the middleware")
	}
}

func decodePayload(t *testing.T, token string) string {
	t.Helper()
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("token %q has %d parts", token, len(parts))
	}
	b, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestRequireUser(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) })
	h := UserIdentity(userSecret)(RequireUser(next))

	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/sparql", nil))
	if w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), `"message"`) {
		t.Errorf("no cookie: %d %q, want 401 with a JSON message", w.Code, w.Body.String())
	}

	tok := userToken(t, jwt.MapClaims{"sub": "alice"}, userSecret)
	req := httptest.NewRequest(http.MethodPost, "/sparql", nil)
	req.AddCookie(&http.Cookie{Name: userjwt.CookieName, Value: tok})
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusNoContent {
		t.Errorf("valid cookie: %d, want the request to pass through", w.Code)
	}
}
