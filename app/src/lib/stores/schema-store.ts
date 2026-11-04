/**
 * Shared, cached schema (reduce-requests STORY-296). Opening the identity browser used to run the full
 * per-namespace schema load several times (page, Explore graph, edit form), each costing 8-14 requests per
 * namespace. Consumers now ask this store, which loads once and hands the same `FetchedSchema` to everyone.
 *
 * Two variants: `schema` (no instance data, see `FetchFullSchemaOptions.includeInstances`) and `full`. A
 * loaded `full` satisfies a `schema` request, never the other way round.
 *
 * Invalidation: `SparqlConnector.writeCount` moves on every update. A cached copy (or an in-flight load)
 * is only reused while the count equals the one it started with, so any write — including one that
 * overlapped the load — makes the next `ensureLoaded` refetch. That is conservative (an identity edit also
 * invalidates) but needs no hook in each schema-writing method. Writes made elsewhere (another tab, the
 * Backstage sync worker) are not seen; the canvas Reload and `refresh()` cover those.
 *
 * Not a runes store: consumers `await` the result, nothing here is rendered reactively. The dependencies are
 * injected so the rules are testable without a connector.
 */
import { sparqlConnector, type FetchedNamespace, type FetchedSchema } from '#lib/services/sparql-connector.js';
import { namespaceStore } from '#lib/stores/namespace-store.svelte.js';

export type SchemaVariant = 'schema' | 'full';

export interface SchemaStoreDeps {
	loadNamespaces(): Promise<FetchedNamespace[]>;
	fetchSchema(namespaces: FetchedNamespace[], variant: SchemaVariant): Promise<FetchedSchema>;
	/** Number of updates sent so far; a different value than at load time means the cache is stale. */
	writeCount(): number;
}

interface Slot {
	promise: Promise<FetchedSchema>;
	/** Write count when the load started. */
	writes: number;
}

export function createSchemaStore(deps: SchemaStoreDeps) {
	const slots: Partial<Record<SchemaVariant, Slot>> = {};

	function reusable(variant: SchemaVariant, writes: number): Slot | undefined {
		// `full` is a superset of `schema`, so it can answer either request.
		const candidates: SchemaVariant[] = variant === 'schema' ? ['full', 'schema'] : ['full'];
		for (const v of candidates) {
			const slot = slots[v];
			if (slot && slot.writes === writes) return slot;
		}
		return undefined;
	}

	function load(variant: SchemaVariant): Promise<FetchedSchema> {
		const writes = deps.writeCount();
		const promise = deps.loadNamespaces().then((namespaces) => deps.fetchSchema(namespaces, variant));
		const slot: Slot = { promise, writes };
		slots[variant] = slot;
		// A failed load must not be remembered, or every later caller would get the same rejection.
		promise.catch(() => {
			if (slots[variant] === slot) delete slots[variant];
		});
		return promise;
	}

	return {
		/** The cached schema, loading it if there is none, or if a write happened since it was loaded. */
		ensureLoaded(variant: SchemaVariant = 'schema'): Promise<FetchedSchema> {
			// Compared at call time too, so a load that overlapped a write is refetched by the next caller.
			const slot = reusable(variant, deps.writeCount());
			return slot ? slot.promise : load(variant);
		},
		/** Drops every cached copy without fetching, so the next `ensureLoaded` refetches. For the canvas Reload,
		 *  which exists precisely to pick up writes the client cannot see; nothing is fetched until someone asks. */
		invalidate(): void {
			delete slots.schema;
			delete slots.full;
		},
		/** Forces a refetch now. */
		refresh(variant: SchemaVariant = 'schema'): Promise<FetchedSchema> {
			return load(variant);
		}
	};
}

export const schemaStore = createSchemaStore({
	loadNamespaces: async () => {
		await namespaceStore.ensureLoaded();
		return namespaceStore.namespaces;
	},
	// Both variants are constant-cost batched loads whatever the number of namespaces: `schema` 7 requests, `full`
	// 12 (it adds individuals, untyped list/count and the two relation queries).
	fetchSchema: (namespaces, variant) =>
		sparqlConnector.fetchSchemaBatched(namespaces, { includeInstances: variant === 'full' }),
	writeCount: () => sparqlConnector.writeCount
});
