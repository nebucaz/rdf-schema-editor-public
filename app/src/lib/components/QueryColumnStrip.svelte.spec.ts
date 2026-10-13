import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import QueryColumnStrip from './QueryColumnStrip.svelte';
import { QueryBuilderStore } from '$lib/stores/query-builder-store.svelte';
import { buildBuilderSchema } from '$lib/services/query-builder-schema';
import { applyStartClass } from '$lib/services/query-add-column';
import { columnChoices } from '$lib/services/query-add-column';
import { NOTE_PASTEL_COLORS } from '$lib/utils/color-palette';
import type { FetchedSchema } from '$lib/services/sparql-connector';

const NS = 'http://example.org/org';
const o = (n: string) => `${NS}#${n}`;
const schema = buildBuilderSchema({
	classes: [{ iri: o('Org'), label: 'Organisation', comment: null, namespaceBaseIri: NS }],
	datatypeProperties: [
		{ iri: o('orgName'), label: 'name', domain: o('Org'), range: 'http://www.w3.org/2001/XMLSchema#string',
			namespaceBaseIri: NS, required: false, repeatable: false }
	],
	objectProperties: [],
	individuals: [],
	subClassOf: [],
	shapeInConstraints: []
} as unknown as FetchedSchema);

function mount(colors = { getColor: vi.fn(), setColor: vi.fn() }) {
	const store = new QueryBuilderStore();
	store.schema = schema;
	store.load(applyStartClass(o('Org'), [NS], columnChoices(schema.classes.get(o('Org'))!)));
	return render_(store, colors);
}

function render_(store: QueryBuilderStore, colors: { getColor: unknown; setColor: unknown }) {
	render(QueryColumnStrip, {
		props: { model: store.model!, schema, store, onAddColumn: vi.fn(), onFilter: vi.fn(), colors: colors as never }
	});
	return { store, colors };
}

describe('QueryColumnStrip group collapse and colour', () => {
	it('collapses a group to its header with a column count, and re-expands', async () => {
		const { store } = mount();
		const before = JSON.stringify(store.model);
		expect(screen.queryAllByTestId('column-cell').length).toBeGreaterThan(0);
		await fireEvent.click(screen.getByTestId('group-collapse'));
		expect(screen.queryAllByTestId('column-cell')).toHaveLength(0);
		expect(screen.getByTestId('group-column-count')).toHaveTextContent(/column/);
		await fireEvent.click(screen.getByTestId('group-collapse'));
		expect(screen.queryAllByTestId('column-cell').length).toBeGreaterThan(0);
		expect(JSON.stringify(store.model)).toBe(before);
	});

	it('stores a picked tint per group key without touching the model', async () => {
		const { store, colors } = mount();
		const before = JSON.stringify(store.model);
		await fireEvent.click(screen.getAllByTestId('group-tint')[0]);
		expect(colors.setColor).toHaveBeenCalledWith(`root|${o('Org')}`, NOTE_PASTEL_COLORS[0]);
		expect(JSON.stringify(store.model)).toBe(before);
	});
});

describe('QueryColumnStrip column boxes', () => {
	const headers = () => screen.getAllByLabelText('Column header').map((i) => (i as HTMLInputElement).value);

	it('has a header bar per box with a drag handle on the left and remove on the right', () => {
		mount();
		const cell = screen.getAllByTestId('column-cell')[0];
		const bar = cell.querySelector('[data-testid="cell-header"]')!;
		expect(bar.firstElementChild).toHaveAttribute('data-testid', 'cell-handle');
		expect(bar.lastElementChild).toHaveAttribute('aria-label', 'Remove column');
		expect(screen.queryByLabelText('Move up')).toBeNull();
		expect(screen.queryByLabelText('Move down')).toBeNull();
	});

	it('reorders by dragging a box by its handle onto another box', async () => {
		const { store } = mount();
		const before = headers();
		expect(before.length).toBeGreaterThan(1);
		const cells = screen.getAllByTestId('column-cell');
		const handle = cells[0].querySelector('[data-testid="cell-handle"]')!;
		await fireEvent.mouseDown(handle);
		await fireEvent.dragStart(cells[0]);
		await fireEvent.dragOver(cells[1]);
		await fireEvent.drop(cells[1]);
		await fireEvent.dragEnd(cells[0]);
		expect(store.model!.columns.map((c) => c.header)).toEqual([before[1], before[0], ...before.slice(2)]);
	});

	it('does not start a drag from outside the handle', async () => {
		const { store } = mount();
		const order = store.model!.columns.map((c) => c.id);
		const cells = screen.getAllByTestId('column-cell');
		expect(cells[0]).toHaveAttribute('draggable', 'false');
		await fireEvent.dragStart(cells[0]);
		await fireEvent.drop(cells[1]);
		expect(store.model!.columns.map((c) => c.id)).toEqual(order);
	});

	it('moves with the arrow keys on the focused handle', async () => {
		const { store } = mount();
		const first = store.model!.columns[0].id;
		const handle = screen.getAllByTestId('cell-handle')[0];
		await fireEvent.keyDown(handle, { key: 'ArrowRight' });
		expect(store.model!.columns[1].id).toBe(first);
	});
});
