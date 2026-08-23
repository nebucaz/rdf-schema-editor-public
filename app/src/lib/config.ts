/**
 * Schema/shapes namespace + named-graph configuration (spec/ui-refinement/issues.md "New Issues"
 * #1/#2): overridable via `.env` (`PUBLIC_SCHEMA_NAMESPACE`, `PUBLIC_SHAPES_NAMESPACE`,
 * `PUBLIC_SCHEMA_GRAPH`), falling back to this app's own defaults when unset. Read via
 * `$env/dynamic/public` (not `/static/public`) so an unset var doesn't fail the build/tests — these
 * are optional overrides, not required configuration.
 */
import { env } from '$env/dynamic/public';

export const SCHEMA_NAMESPACE =
	env.PUBLIC_SCHEMA_NAMESPACE || 'http://ld.pageagent.com/rdf-schema-editor/schema#';
export const SHAPES_NAMESPACE =
	env.PUBLIC_SHAPES_NAMESPACE || 'http://ld.pageagent.com/rdf-schema-editor/shapes#';

/** The named graph all schema + shapes triples are read from and written to (issue #1) — every
 *  query in `sparql-connector.ts` is scoped to this graph via `FROM`/`WITH`/`GRAPH`. */
export const SCHEMA_GRAPH =
	env.PUBLIC_SCHEMA_GRAPH || 'http://ld.pageagent.com/rdf-schema-editor/graph';
