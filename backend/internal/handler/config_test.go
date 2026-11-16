package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/config"
)

func TestConfigHandler_Get(t *testing.T) {
	cases := []struct {
		name      string
		namespace string
		devLogin  bool
		wantBase  string
	}{
		{"built-in default", "http://ld.pageagent.com/rdf-schema-editor/schema#", false, "http://ld.pageagent.com/rdf-schema-editor"},
		{"trailing hash", "http://example.org/ns#", true, "http://example.org/ns"},
		{"trailing /schema", "http://example.org/ns/schema", false, "http://example.org/ns"},
		{"trailing /schema#", "http://example.org/ns/schema#", true, "http://example.org/ns"},
		{"plain base", "http://example.org/ns", false, "http://example.org/ns"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := NewConfigHandler(config.Config{SchemaNamespace: tc.namespace, DevLoginEnabled: tc.devLogin, AuthJWTSecret: "s3", UserJWTSecret: "s4", GraphDBPassword: "pw"})
			w := httptest.NewRecorder()
			h.Get(w, httptest.NewRequest(http.MethodGet, "/config", nil))

			if w.Code != http.StatusOK {
				t.Fatalf("status = %d", w.Code)
			}
			var body map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body["defaultNamespaceBaseIri"] != tc.wantBase {
				t.Errorf("defaultNamespaceBaseIri = %v, want %q", body["defaultNamespaceBaseIri"], tc.wantBase)
			}
			if body["devLoginEnabled"] != tc.devLogin {
				t.Errorf("devLoginEnabled = %v, want %v", body["devLoginEnabled"], tc.devLogin)
			}
			if len(body) != 4 {
				t.Errorf("body = %v, want exactly four fields (no secrets)", body)
			}
		})
	}
}

func TestConfigHandler_IssueTrackerExposesNameAndFlagNotTheTemplate(t *testing.T) {
	cases := []struct {
		name     string
		cfg      config.Config
		wantName string
		want     bool
	}{
		{"configured", config.Config{IssueTrackerName: "ServiceNow", IssueTrackerURLTemplate: "https://secret.example/?n={id}"}, "ServiceNow", true},
		{"unset", config.Config{}, "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			NewConfigHandler(tc.cfg).Get(w, httptest.NewRequest(http.MethodGet, "/config", nil))
			var body struct {
				IssueTracker struct {
					Name    string `json:"name"`
					Enabled bool   `json:"enabled"`
				} `json:"issueTracker"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.IssueTracker.Name != tc.wantName || body.IssueTracker.Enabled != tc.want {
				t.Errorf("issueTracker = %+v", body.IssueTracker)
			}
			if strings.Contains(w.Body.String(), "secret.example") {
				t.Error("the URL template leaked into /config")
			}
		})
	}
}

func TestConfigHandler_ServiceNowExposesOnlyThePublicSettings(t *testing.T) {
	w := httptest.NewRecorder()
	NewConfigHandler(config.Config{}).WithServiceNow(ServiceNowPublic{Enabled: true, Name: "ServiceNow", BulkCap: 25, SyncEnabled: false}).
		Get(w, httptest.NewRequest(http.MethodGet, "/config", nil))
	var body struct {
		ServiceNow map[string]any `json:"serviceNow"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"enabled": true, "name": "ServiceNow", "bulkCap": float64(25), "syncEnabled": false}
	if len(body.ServiceNow) != len(want) {
		t.Fatalf("serviceNow = %v", body.ServiceNow)
	}
	for k, v := range want {
		if body.ServiceNow[k] != v {
			t.Errorf("serviceNow.%s = %v, want %v", k, body.ServiceNow[k], v)
		}
	}

	off := httptest.NewRecorder()
	NewConfigHandler(config.Config{}).Get(off, httptest.NewRequest(http.MethodGet, "/config", nil))
	if !strings.Contains(off.Body.String(), `"serviceNow":{"enabled":false`) {
		t.Errorf("the integration should read as off by default: %s", off.Body.String())
	}
}
