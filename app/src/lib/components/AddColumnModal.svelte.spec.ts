import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import AddColumnModal from './AddColumnModal.svelte';
import { buildBuilderSchema } from '$lib/services/query-builder-schema';
import { applyStartClass } from '$lib/services/query-add-column';
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
	datatypeProperties: [dp('orgName', 'Org', XSD_STRING, 'name')],
	objectProperties: [rel('hasTeam', 'Org', 'Team', 'has team'), rel('hasMember', 'Team', 'Person', 'has member')],
	individuals: [],
	subClassOf: [],
	shapeInConstraints: []
} as unknown as FetchedSchema);
const namespaces = [{ baseIri: NS, prefix: 'org', description: '' }] as unknown as FetchedNamespace[];

function props(over: Record<string, unknown> = {}) {
	return {
		isOpen: true,
		schema,
		namespaces,
		onStart: vi.fn(),
		onStep: vi.fn(),
		onGroup: vi.fn(),
		onClose: vi.fn(),
		...over
	};
}

describe('AddColumnModal — first class', () => {
	it('saves the start class with the ticked columns', async () => {
		const p = props();
		render(AddColumnModal, p);
		expect(screen.getByTestId('add-column-save')).toBeDisabled();
		await fireEvent.change(screen.getByTestId('add-column-class'), { target: { value: o('Org') } });
		const boxes = screen.getAllByRole('checkbox');
		await fireEvent.click(boxes[0]);
		await fireEvent.click(screen.getByTestId('add-column-save'));
		expect(p.onStart).toHaveBeenCalledTimes(1);
		const [classIri, picks] = p.onStart.mock.calls[0];
		expect(classIri).toBe(o('Org'));
		expect(picks).toHaveLength(1);
	});

	it('cancel closes without starting a query', async () => {
		const p = props();
		render(AddColumnModal, p);
		await fireEvent.click(screen.getByTestId('add-column-cancel'));
		expect(p.onClose).toHaveBeenCalled();
		expect(p.onStart).not.toHaveBeenCalled();
		expect(p.onStep).not.toHaveBeenCalled();
		expect(p.onGroup).not.toHaveBeenCalled();
	});
});

describe('AddColumnModal — extend mode', () => {
	const model = startQueryFromClass(o('Org'), [NS]);

	it('lists only steps reachable from the classes already in the query', () => {
		render(AddColumnModal, props({ model }));
		const steps = screen.getByTestId('add-column-steps');
		expect(steps).toHaveTextContent('has team');
		expect(steps).not.toHaveTextContent('has member');
	});

	it('applies the chosen step with its ticked columns', async () => {
		const p = props({ model });
		render(AddColumnModal, p);
		await fireEvent.click(screen.getByRole('radio', { name: /has team/ }));
		await fireEvent.click(screen.getAllByRole('checkbox')[0]);
		await fireEvent.click(screen.getByTestId('add-column-save'));
		expect(p.onStep).toHaveBeenCalledTimes(1);
		expect(p.onStep.mock.calls[0][0]).toMatchObject({ relationshipIri: o('hasTeam'), targetClassIri: o('Team') });
		expect(p.onStart).not.toHaveBeenCalled();
	});

	it('shows the not-offered hint when a search matches nothing reachable', async () => {
		render(AddColumnModal, props({ model }));
		await fireEvent.input(screen.getByTestId('add-column-search'), { target: { value: 'Person' } });
		expect(screen.getByTestId('add-column-hint')).toHaveTextContent('one relationship away');
		expect(screen.getByTestId('add-column-hint')).toHaveTextContent('Nearest path to Person');
	});

	it('shows the reason beside a disabled step and does not let it be picked', () => {
		// The same relationship from the same class twice is the sibling-duplicate rule.
		const withHop = addHop(model, null, { iri: o('hasTeam'), targetClassIri: o('Team') }, 'forward');
		render(AddColumnModal, props({ model: withHop }));
		const steps = within(screen.getByTestId('add-column-steps'));
		const disabled = steps.getAllByRole('radio').filter((r) => (r as HTMLInputElement).disabled);
		expect(disabled.length).toBeGreaterThan(0);
		const item = disabled[0].closest('li')!;
		expect(item.querySelector('.meta')?.textContent?.trim()).toBeTruthy();
	});
});

describe('AddColumnModal — edit a group\'s columns', () => {
	const model = applyStartClass(o('Org'), [NS], [{ source: 'iri', header: 'IRI' }]);

	it('opens ticked with the group\'s current columns and saves only what changed', async () => {
		const p = props({ model, initialTarget: 'group:root' });
		render(AddColumnModal, p);
		const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
		const checkedBefore = boxes.filter((b) => b.checked);
		expect(checkedBefore).toHaveLength(1);
		expect(screen.getByTestId('add-column-save')).toBeDisabled();

		// Untick the existing IRI column and tick another one.
		await fireEvent.click(checkedBefore[0]);
		await fireEvent.click(boxes.find((b) => !b.checked)!);
		await fireEvent.click(screen.getByTestId('add-column-save'));

		expect(p.onGroup).toHaveBeenCalledTimes(1);
		const [hopId, picks, removeIds] = p.onGroup.mock.calls[0];
		expect(hopId).toBeNull();
		expect(picks).toHaveLength(1);
		expect(removeIds).toEqual([model.columns[0].id]);
	});
});
