package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/userjwt"
)

const (
	devLoginTTL     = 8 * time.Hour
	defaultDevLogin = "dev-user"
)

// DevLoginHandler stands in for the corporate SSO in development: it mints an access token with the
// same claims and signing as a production one and sets it as the `Oglala` cookie. It is only
// routed when DEV_LOGIN_ENABLED=true (config.Load refuses that under APP_ENV=production).
type DevLoginHandler struct {
	secret string
	secure bool
}

// NewDevLoginHandler builds a handler signing with secret (USER_JWT_SECRET); secure sets the
// cookie's `Secure` attribute.
func NewDevLoginHandler(secret string, secure bool) *DevLoginHandler {
	return &DevLoginHandler{secret: secret, secure: secure}
}

// Login handles POST /auth/dev-login. The JSON body is optional: `{"sub"?: string}`.
func (h *DevLoginHandler) Login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Sub string `json:"sub"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
		writeJSONError(w, http.StatusBadRequest, "malformed request body")
		return
	}
	sub := body.Sub
	if sub == "" {
		sub = defaultDevLogin
	}

	token, err := userjwt.Mint(h.secret, userjwt.User{
		Sub:               sub,
		Email:             sub + "@dev.example",
		PreferredUsername: sub,
		GivenName:         "Dev",
		FamilyName:        "User",
		Name:              "Dev User",
		Department:        "Development",
		Groups:            []string{},
	}, devLoginTTL)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to mint token")
		return
	}

	http.SetCookie(w, h.cookie(token, int(devLoginTTL.Seconds())))
	auditLog(r, "dev-login "+sub, http.StatusOK, "")
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// Logout handles POST /auth/logout by expiring the cookie.
func (h *DevLoginHandler) Logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, h.cookie("", -1))
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func (h *DevLoginHandler) cookie(value string, maxAge int) *http.Cookie {
	return &http.Cookie{
		Name:     userjwt.CookieName,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   h.secure,
		SameSite: http.SameSiteLaxMode,
	}
}
