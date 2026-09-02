// Package config loads this service's runtime configuration from the environment (via .env in
// local dev, real env vars in deployment), matching the api sibling project's godotenv convention.
package config

import (
	"fmt"
	"os"
	"strings"
	"time"
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

// DefaultNamespaceBaseIRI is the app's default namespace's base IRI (no trailing `#`/`/schema`),
// mirroring `app/src/lib/config.ts`'s `deriveDefaultNamespaceBaseIri` exactly — the seed value
// every ingestion source's own namespace mints under (e.g. `<DefaultNamespaceBaseIRI>/backstage`).
func (c Config) DefaultNamespaceBaseIRI() string {
	withoutFragment := strings.TrimSuffix(c.SchemaNamespace, "#")
	return strings.TrimSuffix(withoutFragment, "/schema")
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

	return Config{
		Port:                  port,
		GraphDBEndpointURL:    endpoint,
		GraphDBUser:           os.Getenv("GRAPHDB_USER"),
		GraphDBPassword:       os.Getenv("GRAPHDB_PASSWORD"),
		SchemaNamespace:       schemaNamespace,
		BackstageBaseURL:      os.Getenv("BACKSTAGE_BASE_URL"),
		BackstageToken:        os.Getenv("BACKSTAGE_TOKEN"),
		BackstageSyncInterval: syncInterval,
	}, nil
}
