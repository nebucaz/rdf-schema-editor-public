/**
 * Staging of the workspace load (loading-spinner STORY-268), extracted from `+page.svelte` so the request
 * order is testable. Independent steps run concurrently and a request already answered is reused:
 *
 *  1. namespaces, external vocabularies, settings, workspaces and one combined probe of the one-time
 *     migration markers, all at once (the browser allows ~6 connections per host, so every request counts);
 *  2. the schema fetch, started as soon as the namespace list shows the default namespace (a first-run
 *     migration, which copies legacy data into the graphs the schema reads, is then impossible), in parallel
 *     with the migration checks (no-ops once the probe found the markers) and the default-workspace chain
 *     (ensure → activate → layout + notes). Without the default namespace the migrations run first.
 *
 * Nothing is applied until every step has succeeded, and a failing step rejects the whole load, as the
 * serial version did.
 */
import { DEFAULT_NAMESPACE_BASE_IRI } from '../config';
import type { FetchedNamespace, FetchedNote, FetchedSchema } from './sparql-connector';

export interface SchemaLoadDeps {
	/** Wraps a step for the dev timing log (`createLoadTiming().timed`). */
	timed<T>(label: string, fn: () => Promise<T>): Promise<T>;
	/** `force` refetches; otherwise a store that already has (or is fetching) its data is reused. */
	loadNamespaces(force: boolean): Promise<FetchedNamespace[]>;
	loadExternalVocabularies(force: boolean): Promise<void>;
	loadSettings(force: boolean): Promise<void>;
	loadWorkspaces(force: boolean): Promise<void>;
	/** One request telling whether the one-time migrations are already done, so the two checks below send nothing. */
	probeMigrations(): Promise<void>;
	onNamespacesLoaded(): void;
	migrateDefaultNamespace(namespaces: FetchedNamespace[]): Promise<void>;
	ensureAttributedRelationship(): Promise<void>;
	ensureDefaultWorkspace(): Promise<string>;
	/** Whether the loaded workspace list already contains `iri`. */
	hasWorkspace(iri: string): boolean;
	/** Resolves and sets the active workspace/namespace in page state. */
	activate(defaultWorkspaceIri: string): void;
	reloadLayout(): Promise<void>;
	fetchSchema(namespaces: FetchedNamespace[]): Promise<FetchedSchema>;
	fetchNotes(): Promise<FetchedNote[]>;
	apply(schema: FetchedSchema, notes: FetchedNote[]): void;
}

export async function loadWorkspaceSchema(deps: SchemaLoadDeps, options: { force: boolean }): Promise<void> {
	const { force } = options;
	const { timed } = deps;

	let [namespaces] = await Promise.all([
		timed('namespaces', () => deps.loadNamespaces(force)),
		timed('externalVocabularies', () => deps.loadExternalVocabularies(force)),
		timed('settings', () => deps.loadSettings(force)),
		timed('workspaces', () => deps.loadWorkspaces(force)),
		timed('probeMigrations', () => deps.probeMigrations())
	]);
	deps.onNamespacesLoaded();

	const migrate = async () => {
		await timed('migrateDefaultNamespace', () => deps.migrateDefaultNamespace(namespaces));
		await timed('ensureAttributedRelationship', () => deps.ensureAttributedRelationship());
	};
	const workspaceChain = async () => {
		const defaultWorkspaceIri = await timed('ensureDefaultWorkspace', () => deps.ensureDefaultWorkspace());
		// First run: the workspace was created after the list was fetched.
		if (!deps.hasWorkspace(defaultWorkspaceIri)) {
			await timed('workspaces (after backfill)', () => deps.loadWorkspaces(true));
		}
		deps.activate(defaultWorkspaceIri);
		const [, fetchedNotes] = await Promise.all([
			timed('layout', () => deps.reloadLayout()),
			timed('notes', () => deps.fetchNotes())
		]);
		return fetchedNotes;
	};

	let schema: FetchedSchema;
	let notes: FetchedNote[];
	if (namespaces.some((ns) => ns.baseIri === DEFAULT_NAMESPACE_BASE_IRI)) {
		const knownNamespaces = namespaces;
		[schema, notes] = await Promise.all([
			timed('fullSchema', () => deps.fetchSchema(knownNamespaces)),
			(async () => {
				await migrate();
				return workspaceChain();
			})()
		]);
	} else {
		await migrate();
		// A first-run migration registers the default namespace after the list was fetched.
		namespaces = await timed('namespaces (after migration)', () => deps.loadNamespaces(true));
		const knownNamespaces = namespaces;
		[schema, notes] = await Promise.all([
			timed('fullSchema', () => deps.fetchSchema(knownNamespaces)),
			workspaceChain()
		]);
	}

	deps.apply(schema, notes);
}
