import { describe, expect, it, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import DashboardGrid from './DashboardGrid.svelte';
import { DEFAULT_LAYOUT, TILE_IDS, hideTile, type DashboardLayout, type TileId } from '#lib/services/dashboard-layout.js';

const TITLES = Object.fromEntries(TILE_IDS.map((id) => [id, `Title ${id}`])) as Record<TileId, string>;
const tile = createRawSnippet((id: () => TileId) => ({ render: () => `<p>content of ${id()}</p>` }));

function setup(layout: DashboardLayout = DEFAULT_LAYOUT, extra: Record<string, unknown> = {}) {
	const onchange = vi.fn();
	render(DashboardGrid, { props: { layout, titles: TITLES, tile, onchange, ...extra } });
	return onchange;
}

const headings = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.trim());

describe('DashboardGrid (STORY-470)', () => {
	it('renders the visible tiles in layout order with their content', () => {
		setup(hideTile({ ...DEFAULT_LAYOUT, order: [...TILE_IDS].reverse() }, TILE_IDS[0]));
		expect(headings()).toEqual([...TILE_IDS].reverse().filter((id) => id !== TILE_IDS[0]).map((id) => `Title ${id}`));
		expect(screen.getByText('content of guides')).toBeInTheDocument();
		expect(screen.queryByText(`content of ${TILE_IDS[0]}`)).toBeNull();
	});

	const handle = (id: TileId) => screen.getByRole('button', { name: new RegExp(`^Move Title ${id} \\(`) });
	const column = (n: number, c: number) => screen.getByTestId(`column-${n}-${c}`);
	const idsIn = (el: HTMLElement) => [...el.querySelectorAll('section.tile')].map((t) => t.getAttribute('data-testid')!.replace('tile-', ''));
	// With the default layout and three columns, the run after the two full-row tiles is segment 2:
	// column 0: getting-started, governance; column 1: model-checks, recent-changes; column 2: questions, guides.
	const three = { columns: 3 };

	it('has no up and down buttons, only a handle and Hide on each tile', () => {
		setup();
		expect(screen.queryByRole('button', { name: /earlier|later/ })).toBeNull();
		expect(screen.getAllByRole('button', { name: /^Move Title/ })).toHaveLength(TILE_IDS.length);
	});

	it('stacks each narrow tile in its own column and renders every column', () => {
		setup(DEFAULT_LAYOUT, three);
		expect(idsIn(column(2, 0))).toEqual(['getting-started', 'governance']);
		expect(idsIn(column(2, 1))).toEqual(['model-checks', 'recent-changes']);
		expect(idsIn(column(2, 2))).toEqual(['questions', 'guides']);
	});

	it('moves a tile up and down within its column with the arrow keys, one place per press', async () => {
		const onchange = setup(DEFAULT_LAYOUT, three);
		await fireEvent.keyDown(handle('getting-started'), { key: 'ArrowDown' });
		const next = onchange.mock.calls.at(-1)![0] as DashboardLayout;
		expect(next.order.indexOf('getting-started')).toBe(next.order.indexOf('governance') + 1);
		expect(next.columns).toEqual(expect.objectContaining({ 'model-checks': 1, questions: 2, 'recent-changes': 1, guides: 2 }));
		onchange.mockClear();
		await fireEvent.keyDown(handle('getting-started'), { key: 'ArrowUp' });
		await fireEvent.keyDown(handle('getting-started'), { key: 'Enter' });
		expect(onchange).not.toHaveBeenCalled();
	});

	it('moves a tile to the next column with the left and right arrow keys without shifting the others', async () => {
		const onchange = setup(DEFAULT_LAYOUT, three);
		await fireEvent.keyDown(handle('governance'), { key: 'ArrowRight' });
		const next = onchange.mock.calls.at(-1)![0] as DashboardLayout;
		expect(next.columns).toEqual({ 'getting-started': 0, 'model-checks': 1, questions: 2, governance: 1, 'recent-changes': 1, guides: 2 });
		onchange.mockClear();
		await fireEvent.keyDown(handle('getting-started'), { key: 'ArrowLeft' });
		expect(onchange).not.toHaveBeenCalled();
	});

	it('announces the move in a live region', async () => {
		setup(DEFAULT_LAYOUT, three);
		await fireEvent.keyDown(handle('governance'), { key: 'ArrowRight' });
		expect(screen.getByRole('status')).toHaveTextContent('Title governance moved to column 2 of 3.');
	});

	it('is draggable only while its handle is held', async () => {
		setup();
		const tile = screen.getByTestId(`tile-${TILE_IDS[0]}`);
		expect(tile).not.toHaveAttribute('draggable', 'true');
		await fireEvent.pointerDown(handle(TILE_IDS[0]));
		expect(tile).toHaveAttribute('draggable', 'true');
		await fireEvent.pointerUp(handle(TILE_IDS[0]));
		expect(tile).not.toHaveAttribute('draggable', 'true');
	});

	async function drag(from: TileId, to: HTMLElement) {
		const dataTransfer = { setData: vi.fn(), getData: () => from, effectAllowed: '', dropEffect: '' };
		await fireEvent.pointerDown(handle(from));
		await fireEvent.dragStart(screen.getByTestId(`tile-${from}`), { dataTransfer });
		await fireEvent.dragOver(to, { dataTransfer });
		await fireEvent.drop(to, { dataTransfer });
	}

	it('drops a tile on a tile of another column into that column, before it, leaving the other tiles in place', async () => {
		const onchange = setup(DEFAULT_LAYOUT, three);
		await drag('guides', screen.getByTestId('tile-model-checks'));
		const next = onchange.mock.calls.at(-1)![0] as DashboardLayout;
		expect(next.columns).toEqual({ 'getting-started': 0, 'model-checks': 1, questions: 2, governance: 0, 'recent-changes': 1, guides: 1 });
		expect(next.order.indexOf('guides')).toBe(next.order.indexOf('model-checks') - 1);
	});

	it('drops a tile on a column, even an empty one, at its end without a switch', async () => {
		const layout = { ...DEFAULT_LAYOUT, columns: { 'getting-started': 0, 'model-checks': 0, questions: 0, governance: 0, 'recent-changes': 0, guides: 0 } };
		const onchange = setup(layout, three);
		expect(idsIn(column(2, 1))).toEqual([]);
		await drag('guides', column(2, 1));
		const next = onchange.mock.calls.at(-1)![0] as DashboardLayout;
		expect(next.columns).toEqual({ ...layout.columns, guides: 1 });
		onchange.mockClear();
		await drag('getting-started', column(2, 0));
		expect((onchange.mock.calls.at(-1)![0] as DashboardLayout).order.at(-1)).toBe('getting-started');
	});

	it('drops a tile at the end of a column that has tiles when the column background is the target', async () => {
		const onchange = setup(DEFAULT_LAYOUT, three);
		await drag('getting-started', column(2, 2));
		const next = onchange.mock.calls.at(-1)![0] as DashboardLayout;
		expect(next.columns?.['getting-started']).toBe(2);
		expect(next.order.indexOf('getting-started')).toBe(next.order.indexOf('guides') + 1);
	});

	it('does not start a drag from the body when the handle is not held', async () => {
		const onchange = setup(DEFAULT_LAYOUT, three);
		const dataTransfer = { setData: vi.fn(), getData: () => TILE_IDS[2], effectAllowed: '', dropEffect: '' };
		await fireEvent.dragStart(screen.getByTestId(`tile-${TILE_IDS[2]}`), { dataTransfer });
		await fireEvent.drop(column(2, 1), { dataTransfer });
		expect(onchange).not.toHaveBeenCalled();
	});

	it('ignores a drop onto itself or with nothing dragged', async () => {
		const onchange = setup(DEFAULT_LAYOUT, three);
		const target = screen.getByTestId('tile-questions');
		await fireEvent.drop(target, { dataTransfer: { getData: () => '' } });
		await fireEvent.drop(column(2, 1), { dataTransfer: { getData: () => '' } });
		await drag('questions', target);
		expect(onchange).not.toHaveBeenCalled();
	});

	it('hides a tile and lists it under Hidden tiles, from where Show restores it', async () => {
		const onchange = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Hide Title guides' }));
		expect(onchange).toHaveBeenLastCalledWith(expect.objectContaining({ hidden: ['guides'] }));
	});

	it('lists hidden tiles with Show buttons', async () => {
		const onchange = setup(hideTile(DEFAULT_LAYOUT, 'guides'));
		expect(screen.queryByTestId('tile-guides')).toBeNull();
		const hidden = screen.getByTestId('hidden-tiles');
		expect(within(hidden).getByText('Hidden tiles (1)')).toBeInTheDocument();
		await fireEvent.click(within(hidden).getByRole('button', { name: 'Show Title guides' }));
		expect(onchange).toHaveBeenLastCalledWith(expect.objectContaining({ hidden: [] }));
	});

	it('shows no hidden-tiles control when nothing is hidden', () => {
		setup();
		expect(screen.queryByTestId('hidden-tiles')).toBeNull();
	});

	it('resets to the default layout', async () => {
		const onchange = setup(hideTile({ ...DEFAULT_LAYOUT, order: [...TILE_IDS].reverse() }, 'guides'));
		await fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }));
		expect(onchange).toHaveBeenLastCalledWith(DEFAULT_LAYOUT);
	});

	it('read-only mode renders the tiles without any control', () => {
		setup(DEFAULT_LAYOUT, { readonly: true });
		expect(headings()).toHaveLength(TILE_IDS.length);
		expect(screen.queryAllByRole('button')).toHaveLength(0);
		expect(screen.getByTestId(`tile-${TILE_IDS[0]}`)).not.toHaveAttribute('draggable', 'true');
	});

	it('keeps every control a real button, which is what makes it keyboard operable', () => {
		setup();
		for (const b of screen.getAllByRole('button')) expect(b.tagName).toBe('BUTTON');
	});
});

describe('wide tiles (spec/ontology-dashboard)', () => {
	it('marks Stages and Scheme health as full-row tiles and leaves the others narrow', () => {
		const { container } = render(DashboardGrid, { props: { layout: DEFAULT_LAYOUT, titles: TITLES, tile } });
		const wide = [...container.querySelectorAll('.tile.wide')].map((el) => el.getAttribute('data-testid'));
		expect(wide).toEqual(['tile-stages', 'tile-scheme-health']);
	});
});
