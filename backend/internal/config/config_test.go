package config

import (
	"testing"
	"time"
)

func TestLoad_RequiredVarPresent(t *testing.T) {
	t.Setenv("GRAPHDB_ENDPOINT_URL", "http://localhost:7201/repositories/rdfschema")
	t.Setenv("AUTH_JWT_SECRET", "test-secret")
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
	if cfg.AuthJWTSecret != "test-secret" {
		t.Errorf("AuthJWTSecret = %q, want the configured secret", cfg.AuthJWTSecret)
	}
}

func TestLoad_RequiredVarMissing(t *testing.T) {
	t.Setenv("GRAPHDB_ENDPOINT_URL", "")
	t.Setenv("AUTH_JWT_SECRET", "test-secret")

	_, err := Load()
	if err == nil {
		t.Fatal("Load() returned no error with GRAPHDB_ENDPOINT_URL unset, want a fail-fast error")
	}
}

func TestLoad_AuthJWTSecretMissing(t *testing.T) {
	t.Setenv("GRAPHDB_ENDPOINT_URL", "http://localhost:7201/repositories/rdfschema")
	t.Setenv("AUTH_JWT_SECRET", "")

	_, err := Load()
	if err == nil {
		t.Fatal("Load() returned no error with AUTH_JWT_SECRET unset, want a fail-fast error")
	}
}

func TestLoad_AuthJWTSecretPresent(t *testing.T) {
	t.Setenv("GRAPHDB_ENDPOINT_URL", "http://localhost:7201/repositories/rdfschema")
	t.Setenv("AUTH_JWT_SECRET", "s3cret-signing-key")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}
	if cfg.AuthJWTSecret != "s3cret-signing-key" {
		t.Errorf("AuthJWTSecret = %q, want the configured secret", cfg.AuthJWTSecret)
	}
}

func TestLoad_PortOverride(t *testing.T) {
	t.Setenv("GRAPHDB_ENDPOINT_URL", "http://localhost:7201/repositories/rdfschema")
	t.Setenv("AUTH_JWT_SECRET", "test-secret")
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
	t.Setenv("AUTH_JWT_SECRET", "test-secret")
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
	t.Setenv("AUTH_JWT_SECRET", "test-secret")
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
	t.Setenv("AUTH_JWT_SECRET", "test-secret")
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
	t.Setenv("AUTH_JWT_SECRET", "test-secret")
	t.Setenv("BACKSTAGE_BASE_URL", "")
	t.Setenv("BACKSTAGE_TOKEN", "")

	if _, err := Load(); err != nil {
		t.Fatalf("Load() returned error with Backstage settings unset: %v", err)
	}
}

func TestLoad_BackstageSyncIntervalDefault(t *testing.T) {
	t.Setenv("GRAPHDB_ENDPOINT_URL", "http://localhost:7201/repositories/rdfschema")
	t.Setenv("AUTH_JWT_SECRET", "test-secret")
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
	t.Setenv("AUTH_JWT_SECRET", "test-secret")
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
	t.Setenv("AUTH_JWT_SECRET", "test-secret")
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
	if got, want := cfg.NamespacePredicateIRI(), "http://ld.pageagent.com/rdf-schema-editor/schema#namespace"; got != want {
		t.Errorf("NamespacePredicateIRI() = %q, want %q", got, want)
	}
	if got, want := cfg.SourceFieldPredicateIRI(), "http://ld.pageagent.com/rdf-schema-editor/schema#sourceField"; got != want {
		t.Errorf("SourceFieldPredicateIRI() = %q, want %q", got, want)
	}
	if got, want := cfg.AppSettingsIRI(), "http://ld.pageagent.com/rdf-schema-editor/schema#AppSettings"; got != want {
		t.Errorf("AppSettingsIRI() = %q, want %q", got, want)
	}
	if got, want := cfg.RepresentsPredicateSettingIRI(), "http://ld.pageagent.com/rdf-schema-editor/schema#representsPredicate"; got != want {
		t.Errorf("RepresentsPredicateSettingIRI() = %q, want %q", got, want)
	}
	if got, want := cfg.SourceRelationPredicateIRI(), "http://ld.pageagent.com/rdf-schema-editor/schema#sourceRelation"; got != want {
		t.Errorf("SourceRelationPredicateIRI() = %q, want %q", got, want)
	}
	if got, want := cfg.SyncSourceRefPredicateIRI(), "http://ld.pageagent.com/rdf-schema-editor/schema#syncSourceRef"; got != want {
		t.Errorf("SyncSourceRefPredicateIRI() = %q, want %q", got, want)
	}
	if got, want := cfg.DefaultNamespaceBaseIRI(), "http://ld.pageagent.com/rdf-schema-editor"; got != want {
		t.Errorf("DefaultNamespaceBaseIRI() = %q, want %q", got, want)
	}
}

func TestLoad_AllowedOrigins(t *testing.T) {
	t.Setenv("GRAPHDB_ENDPOINT_URL", "http://localhost:7201/repositories/rdfschema")
	t.Setenv("AUTH_JWT_SECRET", "test-secret")
	t.Setenv("ALLOWED_ORIGINS", " https://a.example, ,https://b.example ")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if len(cfg.AllowedOrigins) != 2 || cfg.AllowedOrigins[0] != "https://a.example" || cfg.AllowedOrigins[1] != "https://b.example" {
		t.Errorf("AllowedOrigins = %v, want the two trimmed origins", cfg.AllowedOrigins)
	}
}

func TestLoad_UserJWTSecretOptional(t *testing.T) {
	t.Setenv("GRAPHDB_ENDPOINT_URL", "http://localhost:7201/repositories/rdfschema")
	t.Setenv("AUTH_JWT_SECRET", "test-secret")
	t.Setenv("USER_JWT_SECRET", "")
	cfg, err := Load()
	if err != nil || cfg.UserJWTSecret != "" {
		t.Fatalf("Load() = %q, %v; want empty secret and no error", cfg.UserJWTSecret, err)
	}
	t.Setenv("USER_JWT_SECRET", "user-secret")
	if cfg, _ = Load(); cfg.UserJWTSecret != "user-secret" {
		t.Errorf("UserJWTSecret = %q", cfg.UserJWTSecret)
	}
}

func TestLoad_DevLoginEnabled(t *testing.T) {
	t.Setenv("GRAPHDB_ENDPOINT_URL", "http://localhost:7201/repositories/rdfschema")
	t.Setenv("AUTH_JWT_SECRET", "test-secret")
	t.Setenv("USER_JWT_SECRET", "user-secret") // required when the dev login is on
	for value, want := range map[string]bool{"": false, "false": false, "true": true} {
		t.Setenv("DEV_LOGIN_ENABLED", value)
		cfg, err := Load()
		if err != nil || cfg.DevLoginEnabled != want {
			t.Errorf("DEV_LOGIN_ENABLED=%q: DevLoginEnabled = %v, err %v; want %v", value, cfg.DevLoginEnabled, err, want)
		}
	}
}

func TestLoad_DevLoginRefusals(t *testing.T) {
	t.Setenv("GRAPHDB_ENDPOINT_URL", "http://localhost:7201/repositories/rdfschema")
	t.Setenv("AUTH_JWT_SECRET", "test-secret")
	t.Setenv("DEV_LOGIN_ENABLED", "true")
	t.Setenv("USER_JWT_SECRET", "user-secret")

	t.Setenv("APP_ENV", "production")
	if _, err := Load(); err == nil {
		t.Error("Load() accepted DEV_LOGIN_ENABLED=true with APP_ENV=production")
	}

	t.Setenv("APP_ENV", "development")
	if _, err := Load(); err != nil {
		t.Errorf("Load() with APP_ENV=development: %v", err)
	}

	t.Setenv("USER_JWT_SECRET", "")
	if _, err := Load(); err == nil {
		t.Error("Load() accepted DEV_LOGIN_ENABLED=true without USER_JWT_SECRET")
	}

	t.Setenv("DEV_LOGIN_ENABLED", "false")
	t.Setenv("APP_ENV", "production")
	if _, err := Load(); err != nil {
		t.Errorf("production without dev login must start: %v", err)
	}
}

func TestLoad_CookieSecure(t *testing.T) {
	t.Setenv("GRAPHDB_ENDPOINT_URL", "http://localhost:7201/repositories/rdfschema")
	t.Setenv("AUTH_JWT_SECRET", "test-secret")
	t.Setenv("COOKIE_SECURE", "true")
	if cfg, _ := Load(); !cfg.CookieSecure {
		t.Error("COOKIE_SECURE=true not parsed")
	}
}
