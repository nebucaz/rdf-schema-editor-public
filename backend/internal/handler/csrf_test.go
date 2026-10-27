package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCSRFGuard(t *testing.T) {
	const json, form = "application/json", "application/x-www-form-urlencoded"

	tests := []struct {
		name        string
		method      string
		host        string
		headers     map[string]string
		allowed     []string
		wantStatus  int
		wantMessage bool
	}{
		{name: "CLI-style POST, no browser headers, form body", method: "POST", headers: map[string]string{"Content-Type": form}, wantStatus: 200},
		{name: "CLI-style POST, no headers at all", method: "POST", wantStatus: 200},
		{name: "same-origin JSON POST", method: "POST", host: "app.example", headers: map[string]string{"Origin": "https://app.example", "Content-Type": json, "Sec-Fetch-Site": "same-origin"}, wantStatus: 200},
		{name: "cookie + JSON, no Origin", method: "POST", headers: map[string]string{"Cookie": "Oglala=x", "Content-Type": json}, wantStatus: 200},
		{name: "cross-site form POST", method: "POST", host: "app.example", headers: map[string]string{"Origin": "https://evil.example", "Content-Type": form, "Cookie": "Oglala=x", "Sec-Fetch-Site": "cross-site"}, wantStatus: 403, wantMessage: true},
		{name: "Sec-Fetch-Site cross-site with JSON", method: "POST", headers: map[string]string{"Sec-Fetch-Site": "cross-site", "Content-Type": json}, wantStatus: 403, wantMessage: true},
		{name: "Origin mismatch with JSON", method: "POST", host: "app.example", headers: map[string]string{"Origin": "https://evil.example", "Content-Type": json}, wantStatus: 403, wantMessage: true},
		{name: "Origin in allow-list", method: "POST", host: "backend:8090", allowed: []string{"https://app.example"}, headers: map[string]string{"Origin": "https://app.example", "Content-Type": json}, wantStatus: 200},
		{name: "Origin not in allow-list", method: "POST", host: "backend:8090", allowed: []string{"https://app.example"}, headers: map[string]string{"Origin": "https://other.example", "Content-Type": json}, wantStatus: 403, wantMessage: true},
		{name: "same-origin but form content type", method: "POST", host: "app.example", headers: map[string]string{"Origin": "https://app.example", "Content-Type": form}, wantStatus: 415, wantMessage: true},
		{name: "cookie with no content type", method: "POST", headers: map[string]string{"Cookie": "Oglala=x"}, wantStatus: 415, wantMessage: true},
		{name: "json with charset accepted", method: "POST", headers: map[string]string{"Cookie": "a=b", "Content-Type": "application/json; charset=utf-8"}, wantStatus: 200},
		{name: "GET cross-site is untouched", method: "GET", headers: map[string]string{"Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example"}, wantStatus: 200},
		{name: "opaque Origin null rejected", method: "POST", host: "app.example", headers: map[string]string{"Origin": "null", "Content-Type": json}, wantStatus: 403, wantMessage: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			reached := false
			h := CSRFGuard(tc.allowed)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reached = true }))

			req := httptest.NewRequest(tc.method, "/sparql/update", strings.NewReader("x"))
			if tc.host != "" {
				req.Host = tc.host
			}
			for k, v := range tc.headers {
				req.Header.Set(k, v)
			}
			req = withSubject(req, "frontend-app")
			var sb strings.Builder
			orig := auditOut
			auditOut = &sb
			defer func() { auditOut = orig }()

			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)

			if w.Code != tc.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tc.wantStatus)
			}
			if reached != (tc.wantStatus == 200) {
				t.Errorf("handler reached = %v, want %v", reached, tc.wantStatus == 200)
			}
			if tc.wantMessage {
				assertJSONMessage(t, w, tc.wantStatus)
				if !strings.Contains(sb.String(), `"caller":"frontend-app"`) || !strings.Contains(sb.String(), `"status":`) {
					t.Errorf("rejection not audit-logged: %q", sb.String())
				}
			}
		})
	}
}
