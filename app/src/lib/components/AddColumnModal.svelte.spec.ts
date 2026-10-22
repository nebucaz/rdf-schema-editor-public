import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import AddColumnModal from './AddColumnModal.svelte';
import { buildBuilderSchema } from '$lib/services/query-builder-schema';
import { addHop, startQueryFromClass } from '$lib/services/query-model-edit';
import type { FetchedNamespace, FetchedSchema } from '$lib/services/sparql-connector';

const NS = 'http://example.org/org';
const o = (n: string) => `${NS}#${n}`;
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
const cls = (n: string, label = n) => ({ iri: o(n), label, comment: null, namespaceBaseIri: NS });
const dp = (n: string, domain: string, range: string, label = n) => ({
	iri: o(n), label, domain: o(domain), range, namespaceBaseIri: NS, required: false, repeatable: false
});
const rel = (n: string, domain: string, range: string, label = n) => ({
	...dp(n, domain, o(range), label), relationKind: 'specific' as const
});

const schema = buildBuilderSchema({
	classes: [cls('Org', 'Organisation'), cls('Team'), cls('Person')],
	datatypeProperties: [dp('orgName', 'Org', XSD_STRING, 'name'), dp('personName', 'Person', XSD_STRING, 'full name')],
	objectProperties: [rel('hasTeam', 'Org', 'Team', 'has team'), rel('hasMember', 'Team', 'Person', 'has member')],
	individuals: [],
	subClassOf: [],
	shapeInConstraints: []
} as unknown as FetchedSchema);
const namespaces = [{ baseIri: NS, prefix: 'org', description: '' }] as unknown as FetchedNamespace[];
const root = () => startQueryFromClass(o('Org'), [NS]);

function props(over: Record<string, unknown> = {}) {
	return { isOpen: true, schema, namespaces, model: null, onSave: vi.fn(), onClose: vi.fn(), ...over };
}
const panes = () => screen.getAllByTestId('browser-pane');
const link = (pane: HTMLElement, name: RegExp) => within(pane).getByRole('button', { name });
const boxes = (pane: HTMLElement) => within(pane).getAllByRole('checkbox') as HTMLInputElement[];
const save = () => screen.getByTestId('add-column-save');

describe('AddColumnModal — object browser', () => {
	it('hosts the browser and no longer has the step list, start-class selects or group list', () => {
		render(AddColumnModal, props());
		expect(screen.getByTestId('object-browser')).toBeInTheDocument();
		for (const id of ['add-column-steps', 'add-column-class', 'add-column-namespace', 'add-column-existing']) {
			expect(screen.queryByTestId(id)).toBeNull();
		}
	});

	it('starts a new query: browse classes, tick a deep property, Save', async () => {
		const p = props();
		render(AddColumnModal, p);
		expect(save()).toBeDisabled();
		await fireEvent.click(screen.getByRole('button', { name: /org:Organisation/ }));
		await fireEvent.click(link(panes()[1], /has team/));
		await fireEvent.click(link(panes()[2], /has member/));
		await fireEvent.click(boxes(panes()[3])[2]);
		expect(save()).toBeEnabled();
		await fireEvent.click(save());
		expect(p.onSave).toHaveBeenCalledTimes(1);
		const { picks, removeColumnIds } = p.onSave.mock.calls[0][0];
		expect(removeColumnIds).toEqual([]);
		expect(picks).toHaveLength(1);
		expect(picks[0].path.anchor).toEqual({ startClassIri: o('Org') });
		expect(picks[0].path.steps.map((s: { relationshipIri: string }) => s.relationshipIri)).toEqual([
			o('hasTeam'),
			o('hasMember')
		]);
		expect(picks[0].source).toEqual({ propertyIri: o('personName') });
	});

	it('extends an existing query from its own classes with a deep pick in one Save', async () => {
		const p = props({ model: root() });
		render(AddColumnModal, p);
		await fireEvent.click(screen.getByRole('button', { name: /Organisation/ }));
		await fireEvent.click(link(panes()[1], /has team/));
		await fireEvent.click(link(panes()[2], /has member/));
		await fireEvent.click(boxes(panes()[3])[0]);
		await fireEvent.click(save());
		const { picks } = p.onSave.mock.calls[0][0];
		expect(picks[0].path.anchor).toEqual({ hopId: null });
		expect(picks[0].path.steps).toHaveLength(2);
	});

	it('edit mode opens on the group with its columns ticked and saves additions and removals', async () => {
		const model = { ...root(), columns: [{ id: 'c1', hopId: null, source: 'iri' as const, header: 'IRI' }] };
		const p = props({ model, initialTarget: 'group:root' });
		render(AddColumnModal, p);
		expect(screen.getByText('Columns')).toBeInTheDocument();
		const b = boxes(panes()[1]);
		expect(b.filter((x) => x.checked)).toHaveLength(1);
		expect(save()).toBeDisabled();
		await fireEvent.click(b[1]); // untick the existing IRI column
		await fireEvent.click(b[0]); // tick Label
		await fireEvent.click(save());
		const { picks, removeColumnIds } = p.onSave.mock.calls[0][0];
		expect(removeColumnIds).toEqual(['c1']);
		expect(picks.map((x: { source: unknown }) => x.source)).toEqual(['label']);
	});

	it('opens on a hop group when asked to edit it', () => {
		const model = addHop(root(), null, { iri: o('hasTeam'), targetClassIri: o('Team') });
		render(AddColumnModal, props({ model, initialTarget: 'group:h1' }));
		expect(within(panes()[1]).getByRole('heading', { name: 'Team' })).toBeInTheDocument();
	});

	it('Cancel closes without saving, and Save stays disabled until something changes', async () => {
		const p = props({ model: root() });
		render(AddColumnModal, p);
		expect(save()).toBeDisabled();
		await fireEvent.click(screen.getByRole('button', { name: /Organisation/ }));
		await fireEvent.click(boxes(panes()[1])[0]);
		await fireEvent.click(boxes(panes()[1])[0]);
		expect(save()).toBeDisabled();
		await fireEvent.click(boxes(panes()[1])[0]);
		await fireEvent.click(screen.getByTestId('add-column-cancel'));
		expect(p.onClose).toHaveBeenCalledTimes(1);
		expect(p.onSave).not.toHaveBeenCalled();
	});
});
