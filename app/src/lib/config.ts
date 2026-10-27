/**
 * Namespace + named-graph configuration (spec/named-graphs/research.md §12 Decisions 1-3):
 * every namespace (this app's pre-existing default one included) is derived from a single base
 * IRI via `namespaceGraphs()`/`iri.ts`'s minting functions, rather than three independently
 * configured constants. The default namespace's base IRI is runtime configuration served by the
 * backend (`GET /api/config`, spec/static-frontend STORY-004/011) — a static build has no server
 * environment to read it from. It is fetched once, with a top-level await, so every module-level
 * constant derived from it (`iri.ts`, `turtle.ts`) sees the real value; tests and builds (no
 * browser) use the fallback below.
 */

const FALLBACK_SCHEMA_NAMESPACE = 'http://ld.pageagent.com/rdf-schema-editor/schema#';

/** Drops a trailing `#`, then a trailing `/schema`, from a raw namespace value. */
export function defaultNamespaceBaseIriFrom(raw: string): string {
	const withoutFragment = raw.endsWith('#') ? raw.slice(0, -1) : raw;
	return withoutFragment.endsWith('/schema')
		? withoutFragment.slice(0, -'/schema'.length)
		: withoutFragment;
}

export type RuntimeConfigResult =
	| { ok: true; defaultNamespaceBaseIri: string; devLoginEnabled: boolean }
	| { ok: false; message: string };

/** Fetches and validates `/api/config`; never throws — a failure comes back as `{ ok: false }`. */
export async function loadRuntimeConfig(fetchFn: typeof fetch): Promise<RuntimeConfigResult> {
	try {
		const response = await fetchFn('/api/config');
		if (!response.ok) return { ok: false, message: `GET /api/config returned ${response.status}` };
		const body = (await response.json()) as { defaultNamespaceBaseIri?: unknown; devLoginEnabled?: unknown };
		if (typeof body.defaultNamespaceBaseIri !== 'string' || !body.defaultNamespaceBaseIri) {
			return { ok: false, message: 'GET /api/config returned no defaultNamespaceBaseIri' };
		}
		return {
			ok: true,
			defaultNamespaceBaseIri: defaultNamespaceBaseIriFrom(body.defaultNamespaceBaseIri),
			devLoginEnabled: body.devLoginEnabled === true
		};
	} catch (e) {
		return { ok: false, message: e instanceof Error ? e.message : String(e) };
	}
}

const inBrowser = typeof window !== 'undefined' && import.meta.env.MODE !== 'test';
const loaded: RuntimeConfigResult | null = inBrowser ? await loadRuntimeConfig(fetch) : null;

/** Set when the browser could not load `/api/config`; the root layout turns it into a blocking error. */
export const runtimeConfigError: string | null = loaded && !loaded.ok ? loaded.message : null;

/** Whether the backend offers the dev login (`POST /api/auth/dev-login`); false until loaded. */
export const DEV_LOGIN_ENABLED: boolean = loaded?.ok ? loaded.devLoginEnabled : false;

/**
 * The default (pre-existing, backend-configured) namespace's base IRI — the single seed value every
 * namespace-aware feature derives its three storage graphs (`namespaceGraphs()`) and IRI-minting
 * prefix (`iri.ts`) from (STORY-025). Replaces the old independent `SCHEMA_NAMESPACE`/
 * `SHAPES_NAMESPACE`/`SCHEMA_GRAPH` constants.
 */
export const DEFAULT_NAMESPACE_BASE_IRI = loaded?.ok
	? loaded.defaultNamespaceBaseIri
	: defaultNamespaceBaseIriFrom(FALLBACK_SCHEMA_NAMESPACE);

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
