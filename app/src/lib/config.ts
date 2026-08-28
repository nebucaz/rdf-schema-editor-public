/**
 * Namespace + named-graph configuration (spec/named-graphs/research.md §12 Decisions 1-3):
 * every namespace (this app's pre-existing default one included) is derived from a single base
 * IRI via `namespaceGraphs()`/`iri.ts`'s minting functions, rather than three independently
 * configured constants. Overridable via `.env` (`PUBLIC_SCHEMA_NAMESPACE`), falling back to this
 * app's own default when unset. Read via `$env/dynamic/public` (not `/static/public`) so an unset
 * var doesn't fail the build/tests — this is an optional override, not required configuration.
 */
import { env } from '$env/dynamic/public';

function deriveDefaultNamespaceBaseIri(): string {
	const raw = env.PUBLIC_SCHEMA_NAMESPACE || 'http://ld.pageagent.com/rdf-schema-editor/schema#';
	const withoutFragment = raw.endsWith('#') ? raw.slice(0, -1) : raw;
	return withoutFragment.endsWith('/schema')
		? withoutFragment.slice(0, -'/schema'.length)
		: withoutFragment;
}

/**
 * The default (pre-existing, `.env`-seeded) namespace's base IRI — the single seed value every
 * namespace-aware feature derives its three storage graphs (`namespaceGraphs()`) and IRI-minting
 * prefix (`iri.ts`) from (STORY-025). Replaces the old independent `SCHEMA_NAMESPACE`/
 * `SHAPES_NAMESPACE`/`SCHEMA_GRAPH` constants.
 */
export const DEFAULT_NAMESPACE_BASE_IRI = deriveDefaultNamespaceBaseIri();

export interface NamespaceGraphs {
	/** Graph individuals/instance data lives in — the namespace's base IRI itself. */
	instances: string;
	/** Graph classes and properties (TBox) live in. */
	schema: string;
	/** Graph SHACL shapes live in. */
	shapes: string;
	/** Graph generated DCAT/PROV catalog triples live in (data-catalog Story 002). */
	catalog: string;
}

/**
 * Derive a namespace's four storage graphs from its base IRI alone (research.md §12 Decision 1;
 * `catalog` added by data-catalog Story 002). Path-segment suffixes (`/schema`, `/shapes`,
 * `/catalog`), not fragment suffixes (`#schema`, `#shapes`, `#catalog`) — reserves `#` exclusively
 * for a resource's local name within the namespace, so e.g. a class literally named "catalog" can
 * never mint an IRI textually identical to the catalog graph's own identifier. Normalizes away a
 * trailing slash on `baseIri` so callers can pass either form without producing a `//schema`
 * double-slash.
 */
export function namespaceGraphs(baseIri: string): NamespaceGraphs {
	const base = baseIri.endsWith('/') ? baseIri.slice(0, -1) : baseIri;
	return {
		instances: base,
		schema: `${base}/schema`,
		shapes: `${base}/shapes`,
		catalog: `${base}/catalog`
	};
}

const DEFAULT_GRAPHS = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);

/**
 * The default namespace's IRI-minting prefixes — `<base>#LocalName` per resource kind (research.md
 * §12 Decision 2). Equivalent to the old `SCHEMA_NAMESPACE`/`SHAPES_NAMESPACE` constants' values,
 * now derived from `DEFAULT_NAMESPACE_BASE_IRI` instead of being read from `.env` independently.
 */
export const SCHEMA_NAMESPACE = `${DEFAULT_GRAPHS.schema}#`;
export const SHAPES_NAMESPACE = `${DEFAULT_GRAPHS.shapes}#`;

/**
 * The named graph the default namespace's pre-migration mixed schema+shapes triples still live in
 * (issue #1) — every query in `sparql-connector.ts` is scoped to this graph via `FROM`/`WITH`/
 * `GRAPH`, until STORY-028 migrates the default namespace onto the three-graph layout above.
 */
export const SCHEMA_GRAPH = `${DEFAULT_NAMESPACE_BASE_IRI}/graph`;
