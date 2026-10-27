package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
			if len(body) != 2 {
				t.Errorf("body = %v, want exactly two fields (no secrets)", body)
			}
		})
	}
}
