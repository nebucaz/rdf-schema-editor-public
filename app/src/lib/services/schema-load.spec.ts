import { describe, expect, it, vi } from 'vitest';
import { loadWorkspaceSchema, type SchemaLoadDeps } from './schema-load';
import { DEFAULT_NAMESPACE_BASE_IRI } from '../config';
import type { FetchedNamespace, FetchedNote, FetchedSchema } from './sparql-connector';

const ns = (baseIri: string) => ({ baseIri }) as unknown as FetchedNamespace;
const SCHEMA = { classes: [] } as unknown as FetchedSchema;
const NOTES = [{ iri: 'urn:n' }] as unknown as FetchedNote[];

/** Counting fakes: every network-shaped dep bumps `calls[name]` and logs start/end into `events`. */
function setup(over: Partial<{ namespaces: FetchedNamespace[]; workspaceKnown: boolean; failSchema: boolean }> = {}) {
	const calls: Record<string, number> = {};
	const events: string[] = [];
	const state = { members: false, applied: null as null | { schema: FetchedSchema; notes: FetchedNote[] } };
	let namespaces = over.namespaces ?? [ns(DEFAULT_NAMESPACE_BASE_IRI)];
	let workspaceKnown = over.workspaceKnown ?? true;
	const net = <T>(name: string, value: () => T, delay = 0) =>
		vi.fn(async () => {
			calls[name] = (calls[name] ?? 0) + 1;
			events.push(`${name}:start`);
			await new Promise((r) => setTimeout(r, delay));
			events.push(`${name}:end`);
			return value();
		});
	const deps: SchemaLoadDeps = {
		timed: (_label, fn) => fn(),
		loadNamespaces: net('namespaces', () => namespaces, 5),
		loadExternalVocabularies: net('vocabs', () => undefined, 5),
		loadSettings: net('settings', () => undefined, 5),
		onNamespacesLoaded: () => void events.push('onNamespacesLoaded'),
		migrateDefaultNamespace: net('migrate', () => undefined),
		ensureAttributedRelationship: net('attributed', () => undefined),
		ensureDefaultWorkspace: net('ensureWorkspace', () => 'urn:ws:default'),
		loadWorkspaces: net('workspaces', () => undefined),
		hasWorkspace: () => workspaceKnown,
		activate: () => void events.push('activate'),
		reloadLayout: net('layout', () => undefined, 5),
		fetchSchema: vi.fn(async () => {
			calls.schema = (calls.schema ?? 0) + 1;
			events.push('schema:start');
			await new Promise((r) => setTimeout(r, 20));
			events.push('schema:end');
			if (over.failSchema) throw new Error('schema boom');
			return SCHEMA;
		}),
		fetchNotes: net('notes', () => NOTES, 5),
		apply: (schema, notes) => {
			events.push('apply');
			state.applied = { schema, notes };
		}
	};
	return {
		deps,
		calls,
		events,
		state,
		setNamespaces: (n: FetchedNamespace[]) => (namespaces = n),
		setWorkspaceKnown: (v: boolean) => (workspaceKnown = v)
	};
}

describe('loadWorkspaceSchema', () => {
	it('sends each shared request once on a normal load', async () => {
		const { deps, calls } = setup();
		await loadWorkspaceSchema(deps, { force: false });
		expect(calls).toMatchObject({ namespaces: 1, vocabs: 1, settings: 1, workspaces: 1, schema: 1, layout: 1, notes: 1 });
	});

	it('passes the namespace list once fetched to both consumers', async () => {
		const { deps } = setup();
		await loadWorkspaceSchema(deps, { force: false });
		expect(deps.migrateDefaultNamespace).toHaveBeenCalledWith([ns(DEFAULT_NAMESPACE_BASE_IRI)]);
		expect(deps.fetchSchema).toHaveBeenCalledWith([ns(DEFAULT_NAMESPACE_BASE_IRI)]);
	});

	it('forwards `force` so Reload refetches', async () => {
		const { deps } = setup();
		await loadWorkspaceSchema(deps, { force: true });
		expect(deps.loadNamespaces).toHaveBeenCalledWith(true);
		expect(deps.loadWorkspaces).toHaveBeenCalledWith(true);
		expect(deps.loadExternalVocabularies).toHaveBeenCalledWith(true);
		expect(deps.loadSettings).toHaveBeenCalledWith(true);
	});

	it('starts independent steps concurrently', async () => {
		const { deps, events } = setup();
		await loadWorkspaceSchema(deps, { force: false });
		const firstEnd = Math.min(...['namespaces:end', 'vocabs:end', 'settings:end', 'workspaces:end'].map((e) => events.indexOf(e)));
		for (const e of ['namespaces:start', 'vocabs:start', 'settings:start', 'workspaces:start']) expect(events.indexOf(e)).toBeLessThan(firstEnd);
		// the schema fetch overlaps the workspace chain and the notes fetch
		expect(events.indexOf('schema:start')).toBeLessThan(events.indexOf('layout:end'));
		expect(events.indexOf('notes:start')).toBeLessThan(events.indexOf('schema:end'));
	});

	it('keeps dependent steps in order and applies last', async () => {
		const { deps, events } = setup();
		await loadWorkspaceSchema(deps, { force: false });
		const order = ['workspaces:start', 'onNamespacesLoaded', 'migrate:start', 'attributed:start', 'ensureWorkspace:start', 'activate', 'layout:start', 'apply'];
		const idx = order.map((e) => events.indexOf(e));
		expect(idx.every((i) => i >= 0)).toBe(true);
		expect([...idx].sort((a, b) => a - b)).toEqual(idx);
		expect(events.at(-1)).toBe('apply');
		expect(events.indexOf('migrate:end')).toBeLessThan(events.indexOf('schema:start'));
	});

	it('applies the fetched schema and notes', async () => {
		const { deps, state } = setup();
		await loadWorkspaceSchema(deps, { force: false });
		expect(state.applied).toEqual({ schema: SCHEMA, notes: NOTES });
	});

	it('refetches namespaces only if the default was missing before migration', async () => {
		const t = setup({ namespaces: [ns('urn:other')] });
		t.deps.migrateDefaultNamespace = vi.fn(async () => {
			t.setNamespaces([ns('urn:other'), ns(DEFAULT_NAMESPACE_BASE_IRI)]);
		});
		await loadWorkspaceSchema(t.deps, { force: false });
		expect(t.deps.loadNamespaces).toHaveBeenCalledTimes(2);
		expect(t.deps.loadNamespaces).toHaveBeenLastCalledWith(true);
		expect(t.deps.fetchSchema).toHaveBeenCalledWith([ns('urn:other'), ns(DEFAULT_NAMESPACE_BASE_IRI)]);
	});

	it('refetches workspaces only if the default workspace was not in the loaded list', async () => {
		const { deps, setWorkspaceKnown } = setup({ workspaceKnown: false });
		deps.loadWorkspaces = vi.fn(async (force: boolean) => {
			if (force) setWorkspaceKnown(true);
		});
		await loadWorkspaceSchema(deps, { force: false });
		expect(deps.loadWorkspaces).toHaveBeenCalledTimes(2);
		expect(deps.loadWorkspaces).toHaveBeenNthCalledWith(1, false);
		expect(deps.loadWorkspaces).toHaveBeenNthCalledWith(2, true);
	});

	it('surfaces a failing step and does not apply', async () => {
		const { deps, state } = setup({ failSchema: true });
		await expect(loadWorkspaceSchema(deps, { force: false })).rejects.toThrow('schema boom');
		expect(state.applied).toBeNull();
	});
});
