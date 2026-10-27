package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/userjwt"
)

func TestDevLogin_SetsVerifiableCookie(t *testing.T) {
	h := NewDevLoginHandler(userSecret, false)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/auth/dev-login", nil)
	h.Login(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	cookies := w.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("cookies = %v", cookies)
	}
	c := cookies[0]
	if c.Name != "Oglala" || !c.HttpOnly || c.SameSite != http.SameSiteLaxMode || c.Path != "/" || c.Secure || c.MaxAge <= 0 {
		t.Errorf("cookie = %+v", c)
	}
	u, err := userjwt.Verify(c.Value, userSecret)
	if err != nil {
		t.Fatalf("minted token does not verify: %v", err)
	}
	if u.Sub == "" || u.Email == "" || u.Name == "" || u.Department == "" || u.GivenName == "" || u.FamilyName == "" || u.PreferredUsername == "" {
		t.Errorf("claims incomplete: %+v", u)
	}
	if u.Groups == nil || len(u.Groups) != 0 {
		t.Errorf("Groups = %#v, want empty", u.Groups)
	}
	if strings.Contains(w.Body.String(), c.Value) {
		t.Error("response body leaks the token")
	}
}

func TestDevLogin_ClaimsAndLoginIDEqualSub(t *testing.T) {
	h := NewDevLoginHandler(userSecret, false)
	w := httptest.NewRecorder()
	h.Login(w, jsonReq("/auth/dev-login", `{"sub":"carol"}`))

	u, err := userjwt.Verify(w.Result().Cookies()[0].Value, userSecret)
	if err != nil || u.Sub != "carol" {
		t.Fatalf("user = %+v, err %v; want sub carol", u, err)
	}
	// loginid is not part of userjwt.User; check the raw payload.
	if !strings.Contains(decodePayload(t, w.Result().Cookies()[0].Value), `"loginid":"carol"`) {
		t.Error("loginid claim != sub")
	}
}

func TestDevLogin_BadBodyFallsBackOrRejects(t *testing.T) {
	h := NewDevLoginHandler(userSecret, false)

	w := httptest.NewRecorder()
	h.Login(w, jsonReq("/auth/dev-login", `{}`))
	if w.Code != http.StatusOK {
		t.Errorf("empty object status = %d, want 200", w.Code)
	}

	w = httptest.NewRecorder()
	h.Login(w, jsonReq("/auth/dev-login", `{not json`))
	assertJSONMessage(t, w, http.StatusBadRequest)
}

func TestDevLogin_SecureFlag(t *testing.T) {
	w := httptest.NewRecorder()
	NewDevLoginHandler(userSecret, true).Login(w, httptest.NewRequest(http.MethodPost, "/auth/dev-login", nil))
	if !w.Result().Cookies()[0].Secure {
		t.Error("cookie not Secure when configured")
	}
}

func TestDevLogin_LogoutClearsCookie(t *testing.T) {
	w := httptest.NewRecorder()
	NewDevLoginHandler(userSecret, false).Logout(w, httptest.NewRequest(http.MethodPost, "/auth/logout", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d", w.Code)
	}
	c := w.Result().Cookies()[0]
	if c.Name != "Oglala" || c.Value != "" || c.MaxAge >= 0 || c.Path != "/" || !c.HttpOnly {
		t.Errorf("cookie = %+v, want an expiring empty Oglala", c)
	}
}

func TestDevLogin_ThenMe(t *testing.T) {
	login := httptest.NewRecorder()
	NewDevLoginHandler(userSecret, false).Login(login, httptest.NewRequest(http.MethodPost, "/auth/dev-login", nil))

	req := httptest.NewRequest(http.MethodGet, "/me", nil)
	req.AddCookie(login.Result().Cookies()[0])
	w := httptest.NewRecorder()
	UserIdentity(userSecret)(http.HandlerFunc(MeHandler{}.Get)).ServeHTTP(w, req)

	if !strings.Contains(w.Body.String(), `"sub":"dev-user"`) || !strings.Contains(w.Body.String(), `"groups":[]`) {
		t.Errorf("/me body = %s", w.Body.String())
	}
}
