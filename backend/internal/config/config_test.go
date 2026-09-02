package config

import (
	"testing"
	"time"
)

func TestLoad_RequiredVarPresent(t *testing.T) {
	t.Setenv("GRAPHDB_ENDPOINT_URL", "http://localhost:7201/repositories/rdfschema")
	t.Setenv("PORT", "")
	t.Setenv("GRAPHDB_USER", "")
	t.Setenv("GRAPHDB_PASSWORD", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error with required var set: %v", err)
	}
	if cfg.GraphDBEndpointURL != "http://localhost:7201/repositories/rdfschema" {
		t.Errorf("GraphDBEndpointURL = %q, want the configured endpoint", cfg.GraphDBEndpointURL)
	}
	if cfg.Port != "8090" {
		t.Errorf("Port = %q, want default 8090", cfg.Port)
	}
}

func TestLoad_RequiredVarMissing(t *testing.T) {
	t.Setenv("GRAPHDB_ENDPOINT_URL", "")

	_, err := Load()
	if err == nil {
		t.Fatal("Load() returned no error with GRAPHDB_ENDPOINT_URL unset, want a fail-fast error")
	}
}

func TestLoad_PortOverride(t *testing.T) {
	t.Setenv("GRAPHDB_ENDPOINT_URL", "http://localhost:7201/repositories/rdfschema")
	t.Setenv("PORT", "9999")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}
	if cfg.Port != "9999" {
		t.Errorf("Port = %q, want 9999", cfg.Port)
	}
}

func TestLoad_SchemaNamespaceDefault(t *testing.T) {
	t.Setenv("GRAPHDB_ENDPOINT_URL", "http://localhost:7201/repositories/rdfschema")
	t.Setenv("PUBLIC_SCHEMA_NAMESPACE", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}
	if cfg.SchemaNamespace != defaultSchemaNamespace {
		t.Errorf("SchemaNamespace = %q, want default %q", cfg.SchemaNamespace, defaultSchemaNamespace)
	}
	if cfg.BackstageKindPredicateIRI() != defaultSchemaNamespace+"backstageKind" {
		t.Errorf("BackstageKindPredicateIRI() = %q", cfg.BackstageKindPredicateIRI())
	}
}

func TestLoad_SchemaNamespaceOverride(t *testing.T) {
	t.Setenv("GRAPHDB_ENDPOINT_URL", "http://localhost:7201/repositories/rdfschema")
	t.Setenv("PUBLIC_SCHEMA_NAMESPACE", "http://example.org/schema#")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}
	if cfg.SchemaNamespace != "http://example.org/schema#" {
		t.Errorf("SchemaNamespace = %q, want override", cfg.SchemaNamespace)
	}
}

func TestLoad_BackstageSettings(t *testing.T) {
	t.Setenv("GRAPHDB_ENDPOINT_URL", "http://localhost:7201/repositories/rdfschema")
	t.Setenv("BACKSTAGE_BASE_URL", "https://backstage.example.com/api/catalog")
	t.Setenv("BACKSTAGE_TOKEN", "s3cret")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}
	if cfg.BackstageBaseURL != "https://backstage.example.com/api/catalog" {
		t.Errorf("BackstageBaseURL = %q", cfg.BackstageBaseURL)
	}
	if cfg.BackstageToken != "s3cret" {
		t.Errorf("BackstageToken = %q", cfg.BackstageToken)
	}
}

func TestLoad_BackstageSettingsOptional(t *testing.T) {
	t.Setenv("GRAPHDB_ENDPOINT_URL", "http://localhost:7201/repositories/rdfschema")
	t.Setenv("BACKSTAGE_BASE_URL", "")
	t.Setenv("BACKSTAGE_TOKEN", "")

	if _, err := Load(); err != nil {
		t.Fatalf("Load() returned error with Backstage settings unset: %v", err)
	}
}

func TestLoad_BackstageSyncIntervalDefault(t *testing.T) {
	t.Setenv("GRAPHDB_ENDPOINT_URL", "http://localhost:7201/repositories/rdfschema")
	t.Setenv("BACKSTAGE_SYNC_INTERVAL", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}
	if cfg.BackstageSyncInterval != time.Hour {
		t.Errorf("BackstageSyncInterval = %v, want 1h default", cfg.BackstageSyncInterval)
	}
}

func TestLoad_BackstageSyncIntervalOverride(t *testing.T) {
	t.Setenv("GRAPHDB_ENDPOINT_URL", "http://localhost:7201/repositories/rdfschema")
	t.Setenv("BACKSTAGE_SYNC_INTERVAL", "30m")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}
	if cfg.BackstageSyncInterval != 30*time.Minute {
		t.Errorf("BackstageSyncInterval = %v, want 30m", cfg.BackstageSyncInterval)
	}
}

func TestLoad_BackstageSyncIntervalInvalid(t *testing.T) {
	t.Setenv("GRAPHDB_ENDPOINT_URL", "http://localhost:7201/repositories/rdfschema")
	t.Setenv("BACKSTAGE_SYNC_INTERVAL", "not-a-duration")

	if _, err := Load(); err == nil {
		t.Fatal("Load() returned no error with malformed BACKSTAGE_SYNC_INTERVAL")
	}
}

func TestConfig_DerivedVocabularyIRIs(t *testing.T) {
	cfg := Config{SchemaNamespace: "http://ld.pageagent.com/rdf-schema-editor/schema#"}

	if got, want := cfg.SyncSourcePredicateIRI(), "http://ld.pageagent.com/rdf-schema-editor/schema#syncSource"; got != want {
		t.Errorf("SyncSourcePredicateIRI() = %q, want %q", got, want)
	}
	if got, want := cfg.SyncStatusPredicateIRI(), "http://ld.pageagent.com/rdf-schema-editor/schema#syncStatus"; got != want {
		t.Errorf("SyncStatusPredicateIRI() = %q, want %q", got, want)
	}
	if got, want := cfg.NamespaceClassIRI(), "http://ld.pageagent.com/rdf-schema-editor/schema#Namespace"; got != want {
		t.Errorf("NamespaceClassIRI() = %q, want %q", got, want)
	}
	if got, want := cfg.NamespacePrefixPredicateIRI(), "http://ld.pageagent.com/rdf-schema-editor/schema#prefix"; got != want {
		t.Errorf("NamespacePrefixPredicateIRI() = %q, want %q", got, want)
	}
	if got, want := cfg.DefaultNamespaceBaseIRI(), "http://ld.pageagent.com/rdf-schema-editor"; got != want {
		t.Errorf("DefaultNamespaceBaseIRI() = %q, want %q", got, want)
	}
}
