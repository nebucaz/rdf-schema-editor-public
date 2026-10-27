package handler

import (
	"mime"
	"net/http"
	"net/url"
	"slices"
)

// CSRFGuard rejects cross-site requests a victim's browser could send through the frontend proxy,
// which attaches the service JWT to everything it forwards. It applies to state-changing methods
// only, and only to requests that look browser-originated (any of `Cookie`, `Origin`,
// `Sec-Fetch-Site`); CLI callers send none of those and pass through untouched.
//
// A browser request must be same-origin — `Origin` equal to the request `Host` or listed in
// allowedOrigins (e.g. `https://app.example`) — not flagged `Sec-Fetch-Site: cross-site`, and carry
// `Content-Type: application/json`, which a plain cross-site `<form>` cannot produce.
func CSRFGuard(allowedOrigins []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodGet || r.Method == http.MethodHead || r.Method == http.MethodOptions {
				next.ServeHTTP(w, r)
				return
			}

			origin := r.Header.Get("Origin")
			fetchSite := r.Header.Get("Sec-Fetch-Site")
			if origin == "" && fetchSite == "" && r.Header.Get("Cookie") == "" {
				next.ServeHTTP(w, r)
				return
			}

			if fetchSite == "cross-site" || (origin != "" && !originAllowed(origin, r.Host, allowedOrigins)) {
				rejectRequest(w, r, http.StatusForbidden, "cross-site request rejected")
				return
			}

			if mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mediaType != "application/json" {
				rejectRequest(w, r, http.StatusUnsupportedMediaType, "Content-Type must be application/json")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func originAllowed(origin, host string, allowedOrigins []string) bool {
	if slices.Contains(allowedOrigins, origin) {
		return true
	}
	u, err := url.Parse(origin)
	return err == nil && u.Host != "" && u.Host == host
}

func rejectRequest(w http.ResponseWriter, r *http.Request, status int, message string) {
	auditLog(r, "", status, message)
	writeJSONError(w, status, message)
}
