// Package config loads this service's runtime configuration from the environment (via .env in
// local dev, real env vars in deployment), matching the api sibling project's godotenv convention.
package config

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/sparqlsafe"
)

// defaultSchemaNamespace mirrors `app/src/lib/config.ts`'s own fallback default — the schema
// namespace's `#`-suffixed base IRI every `backstageKind`-shaped annotation predicate is minted
// under (Story 003). Overridable via PUBLIC_SCHEMA_NAMESPACE, same variable name the SvelteKit app
// reads, so one value can be shared across both `.env` files.
const defaultSchemaNamespace = "http://ld.pageagent.com/rdf-schema-editor/schema#"

// defaultBackstageSyncInterval is used when BACKSTAGE_SYNC_INTERVAL is unset (Story 008) — an hour
// is a reasonable default cadence for a catalog that changes at human speed, not machine speed.
const defaultBackstageSyncInterval = "1h"

// Config holds every setting the backend needs to start.
type Config struct {
	Port               string
	GraphDBEndpointURL string
	GraphDBUser        string
	GraphDBPassword    string
	// SchemaNamespace is the `#`-suffixed base IRI local vocabulary predicates (e.g.
	// `backstageKind`) are minted under.
	SchemaNamespace string
	// BackstageBaseURL/BackstageToken configure the Backstage source (Story 003). Both may be
	// empty — the service still starts as a pure SPARQL gateway without them; a Backstage-sourced
	// route simply fails at call time if unconfigured.
	BackstageBaseURL string
	BackstageToken   string
	// BackstageSyncInterval is how often BackstageSyncWorker.Run (Story 008) ticks a real
	// (non-dry-run) sync. Parsed from BACKSTAGE_SYNC_INTERVAL (a Go time.Duration string, e.g.
	// "1h"); defaults to defaultBackstageSyncInterval when unset.
	BackstageSyncInterval time.Duration
	// AuthJWTSecret is the HS256 signing secret shared between the JWT verification middleware
	// (STORY-002) and the minting tool (STORY-003). Required — see Load()'s fail-fast behavior.
	AuthJWTSecret string
	// AllowedOrigins lists extra browser origins (e.g. "https://app.example") CSRFGuard accepts in
	// addition to one matching the request Host. Parsed from comma-separated ALLOWED_ORIGINS.
	AllowedOrigins []string
	// UserJWTSecret verifies the end-user access token in the `Oglala` cookie (HS256). Optional —
	// without it the backend starts and /me always reports no user. Deliberately separate from
	// AuthJWTSecret so a leaked user key cannot mint service tokens.
	UserJWTSecret string
	// DevLoginEnabled exposes the dev-only login routes and is reported by GET /config so the UI
	// can offer its button. Parsed from DEV_LOGIN_ENABLED ("true" enables).
	DevLoginEnabled bool
	// CookieSecure sets the `Secure` attribute on the cookie the dev login issues (COOKIE_SECURE);
	// leave off for plain-HTTP development.
	CookieSecure bool
}

// BackstageKindPredicateIRI is the `backstageKind` annotation-property IRI (Story 003), derived
// from SchemaNamespace exactly like `iri.ts`'s `BACKSTAGE_KIND_PREDICATE_IRI`.
func (c Config) BackstageKindPredicateIRI() string {
	return c.SchemaNamespace + "backstageKind"
}

// SyncSourcePredicateIRI is the `rse:syncSource` marker predicate (Story 010) written on every
// individual a sync worker creates/updates, derived from SchemaNamespace exactly like
// `iri.ts`'s `SYNC_SOURCE_PREDICATE_IRI` on the frontend, so both sides agree on the same IRI.
func (c Config) SyncSourcePredicateIRI() string {
	return c.SchemaNamespace + "syncSource"
}

// SyncStatusPredicateIRI is the `rse:syncStatus` staleness marker predicate (Story 009), mirrored
// on the frontend as `iri.ts`'s `SYNC_STATUS_PREDICATE_IRI`.
func (c Config) SyncStatusPredicateIRI() string {
	return c.SchemaNamespace + "syncStatus"
}

// NamespaceClassIRI/NamespacePrefixPredicateIRI mirror `iri.ts`'s `NAMESPACE_CLASS_IRI`/
// `NAMESPACE_PREFIX_PREDICATE_IRI` — the sync engine bootstraps a "backstage" (or a future
// second source's) Namespace declaration the same way the app's own `insertNamespace` does.
func (c Config) NamespaceClassIRI() string {
	return c.SchemaNamespace + "Namespace"
}

func (c Config) NamespacePrefixPredicateIRI() string {
	return c.SchemaNamespace + "prefix"
}

// NamespacePredicateIRI is `rse:namespace` (STORY-099) — declared on a shadow concept class (own or
// inherited via `rdfs:subClassOf*` from `backstage:CoreConcept`), pointing at the `Namespace` base
// IRI its synced individuals mint under. Mirrored on the frontend as `iri.ts`'s
// `NAMESPACE_PREDICATE_IRI`.
func (c Config) NamespacePredicateIRI() string {
	return c.SchemaNamespace + "namespace"
}

// SourceFieldPredicateIRI is `rse:sourceField` (STORY-101) — declared on an already-existing
// `owl:DatatypeProperty`, mapping it onto free-form mapping information (a field path, a JSON
// pointer, a query, ...) an ingestion source interprets in its own way at sync time.
// Source-agnostic: Backstage is the first ingestor to read it, not the only one it's meant for.
// Mirrored on the frontend as `iri.ts`'s `SOURCE_FIELD_PREDICATE_IRI`.
func (c Config) SourceFieldPredicateIRI() string {
	return c.SchemaNamespace + "sourceField"
}

// SourceRelationPredicateIRI is `rse:sourceRelation` (STORY-106) — declared on an already-existing
// `owl:ObjectProperty`, mapping it onto free-form relation-type mapping information an ingestion
// source interprets in its own way at sync time, mirrored as an edge between two synced shadow
// individuals when it resolves. Source-agnostic like `SourceFieldPredicateIRI` above: Backstage is
// the first ingestor to read it (its own `relations[].type`, e.g. `ownedBy`/`partOf`/`dependsOn`),
// not the only one it's meant for. Mirrored on the frontend as `iri.ts`'s
// `SOURCE_RELATION_PREDICATE_IRI`.
func (c Config) SourceRelationPredicateIRI() string {
	return c.SchemaNamespace + "sourceRelation"
}

// SyncSourceRefPredicateIRI is `rse:syncSourceRef` (STORY-106) — a generator-owned marker predicate,
// alongside `SyncSourcePredicateIRI`, written on every synced shadow individual holding its own
// upstream target-reference identity (Backstage: `kind:namespace/name`) — the join key a relation's
// `targetRef` is resolved against, since a target's `uid` (what individual IRIs actually mint from)
// is never present in an upstream `relations[]` entry.
func (c Config) SyncSourceRefPredicateIRI() string {
	return c.SchemaNamespace + "syncSourceRef"
}

// AppSettingsIRI is the single, fixed, well-known settings subject (STORY-103) — mirrored on the
// frontend as `iri.ts`'s `APP_SETTINGS_IRI` (Sprint 5 Story 014). The Go side had no reason to know
// this IRI until STORY-103's `representsPredicate` setting became the first app-settings value the
// sync engine itself must read.
func (c Config) AppSettingsIRI() string {
	return c.SchemaNamespace + "AppSettings"
}

// RepresentsPredicateSettingIRI is `rse:representsPredicate` (STORY-103) — the *setting* predicate
// on `AppSettingsIRI` holding the user-configured `owl:ObjectProperty` IRI a synced shadow
// individual's `represents` link is written with (STORY-105). Never a fixed/app-reserved predicate
// name itself — that value is resolved at sync time via `FetchRepresentsPredicateIri`. Mirrored on
// the frontend as `iri.ts`'s `REPRESENTS_PREDICATE_SETTING_IRI`.
func (c Config) RepresentsPredicateSettingIRI() string {
	return c.SchemaNamespace + "representsPredicate"
}

// DefaultNamespaceBaseIRI is the app's default namespace's base IRI (no trailing `#`/`/schema`),
// mirroring `app/src/lib/config.ts`'s `deriveDefaultNamespaceBaseIri` exactly — the seed value
// every ingestion source's own namespace mints under (e.g. `<DefaultNamespaceBaseIRI>/backstage`).
func (c Config) DefaultNamespaceBaseIRI() string {
	return sparqlsafe.DefaultNamespaceBaseIRI(c.SchemaNamespace)
}

// Load reads Config from the environment. GraphDBEndpointURL is required and fails fast if unset;
// GraphDBUser/GraphDBPassword are optional (unauthenticated GraphDB repositories are valid), matching
// the SvelteKit gateway's own `if (SPARQL_USER && SPARQL_PASSWORD)` behavior it replaces. Port falls
// back to 8090 when unset.
func Load() (Config, error) {
	endpoint := os.Getenv("GRAPHDB_ENDPOINT_URL")
	if endpoint == "" {
		return Config{}, fmt.Errorf("GRAPHDB_ENDPOINT_URL is required but not set")
	}

	authJWTSecret := os.Getenv("AUTH_JWT_SECRET")
	if authJWTSecret == "" {
		return Config{}, fmt.Errorf("AUTH_JWT_SECRET is required but not set")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8090"
	}

	schemaNamespace := os.Getenv("PUBLIC_SCHEMA_NAMESPACE")
	if schemaNamespace == "" {
		schemaNamespace = defaultSchemaNamespace
	}

	syncIntervalRaw := os.Getenv("BACKSTAGE_SYNC_INTERVAL")
	if syncIntervalRaw == "" {
		syncIntervalRaw = defaultBackstageSyncInterval
	}
	syncInterval, err := time.ParseDuration(syncIntervalRaw)
	if err != nil {
		return Config{}, fmt.Errorf("BACKSTAGE_SYNC_INTERVAL: %w", err)
	}

	devLoginEnabled := os.Getenv("DEV_LOGIN_ENABLED") == "true"
	if devLoginEnabled {
		if os.Getenv("APP_ENV") == "production" {
			return Config{}, fmt.Errorf("DEV_LOGIN_ENABLED=true is refused when APP_ENV=production")
		}
		if os.Getenv("USER_JWT_SECRET") == "" {
			return Config{}, fmt.Errorf("DEV_LOGIN_ENABLED=true requires USER_JWT_SECRET")
		}
	}

	var allowedOrigins []string
	for _, origin := range strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			allowedOrigins = append(allowedOrigins, origin)
		}
	}

	return Config{
		Port:                  port,
		GraphDBEndpointURL:    endpoint,
		GraphDBUser:           os.Getenv("GRAPHDB_USER"),
		GraphDBPassword:       os.Getenv("GRAPHDB_PASSWORD"),
		SchemaNamespace:       schemaNamespace,
		BackstageBaseURL:      os.Getenv("BACKSTAGE_BASE_URL"),
		BackstageToken:        os.Getenv("BACKSTAGE_TOKEN"),
		BackstageSyncInterval: syncInterval,
		AuthJWTSecret:         authJWTSecret,
		AllowedOrigins:        allowedOrigins,
		UserJWTSecret:         os.Getenv("USER_JWT_SECRET"),
		DevLoginEnabled:       devLoginEnabled,
		CookieSecure:          os.Getenv("COOKIE_SECURE") == "true",
	}, nil
}
