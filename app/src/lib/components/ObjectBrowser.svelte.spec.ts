import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import ObjectBrowser from './ObjectBrowser.svelte';
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
	datatypeProperties: [dp('orgName', 'Org', XSD_STRING, 'name'), dp('teamName', 'Team', XSD_STRING, 'title')],
	objectProperties: [
		rel('hasTeam', 'Org', 'Team', 'has team'),
		rel('sponsors', 'Org', 'Team', 'sponsors'),
		rel('hasMember', 'Team', 'Person', 'has member'),
		rel('leadBy', 'Team', 'Person', 'led by'),
		rel('owns', 'Person', 'Org', 'owns')
	],
	individuals: [],
	subClassOf: [],
	shapeInConstraints: []
} as unknown as FetchedSchema);
const namespaces = [{ baseIri: NS, prefix: 'org', description: '' }] as unknown as FetchedNamespace[];
const root = () => startQueryFromClass(o('Org'), [NS]);

function mount(over: Record<string, unknown> = {}) {
	const p = { schema, namespaces, model: root(), onChange: vi.fn(), ...over };
	render(ObjectBrowser, { props: p });
	return p;
}
const panes = () => screen.getAllByTestId('browser-pane');
const rowNames = (pane: HTMLElement) =>
	within(pane).getAllByTestId('browser-property').map((e) => e.querySelector('.name')!.textContent!.trim());
const openRoot = () => fireEvent.click(within(screen.getAllByTestId('browser-pane')[0]).getByRole('button', { name: /Organisation/ }));
const link = (pane: HTMLElement, name: RegExp) => within(pane).getByRole('button', { name });
const lastChange = (p: { onChange: ReturnType<typeof vi.fn> }) => p.onChange.mock.calls.at(-1)![0];

describe('ObjectBrowser panes', () => {
	it('opens a class pane from the first pane, with Label and IRI as its first rows', async () => {
		mount();
		expect(panes()).toHaveLength(1);
		await openRoot();
		expect(panes()).toHaveLength(2);
		expect(rowNames(panes()[1]).slice(0, 3)).toEqual(['Label', 'IRI', 'name']);
	});

	it('opens the next pane from a link row or its chevron and closes deeper panes of the old path', async () => {
		mount();
		await openRoot();
		await fireEvent.click(link(panes()[1], /has team/));
		expect(panes()).toHaveLength(3);
		await fireEvent.click(link(panes()[2], /has member/));
		expect(panes()).toHaveLength(4);
		// choosing another link in an earlier pane drops the deeper panes
		await fireEvent.click(link(panes()[1], /sponsors/));
		expect(panes()).toHaveLength(3);
		expect(within(panes()[2]).queryByRole('button', { name: /has member/ })).not.toBeNull();
		// the chevron is part of the row and opens the same pane
		await fireEvent.click(within(panes()[1]).getAllByTestId('browser-chevron')[0]);
		expect(panes()).toHaveLength(3);
	});

	it('lists inbound links under a Referenced by heading', async () => {
		mount();
		await openRoot();
		const pane = panes()[1];
		expect(within(pane).getByText('Referenced by')).toBeInTheDocument();
		expect(within(pane).getByRole('button', { name: /owns/ })).toBeInTheDocument();
	});

	it('shows a disabled link with its reason and does not open it', async () => {
		mount();
		await openRoot();
		await fireEvent.click(link(panes()[1], /has team/));
		const back = link(panes()[2], /has team/);
		expect(back).toHaveAttribute('aria-disabled', 'true');
		expect(within(panes()[2]).getByText(/undo the previous step/)).toBeInTheDocument();
		await fireEvent.click(back);
		expect(panes()).toHaveLength(3);
	});

	it('in new-query mode lists classes, filterable by namespace, and starts from the chosen one', async () => {
		mount({ model: null });
		expect(screen.getByRole('button', { name: /org:Organisation/ })).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: /org:Team/ }));
		expect(rowNames(panes()[1])).toEqual(['Label', 'IRI', 'title']);
	});
});

describe('ObjectBrowser selection', () => {
	it('accumulates ticks across panes with their breadcrumb, and unticks from the summary', async () => {
		const p = mount();
		await openRoot();
		await fireEvent.click(within(panes()[1]).getAllByRole('checkbox')[0]);
		await fireEvent.click(link(panes()[1], /has team/));
		await fireEvent.click(within(panes()[2]).getAllByRole('checkbox')[2]);
		const summary = screen.getByTestId('browser-selected');
		const items = within(summary).getAllByRole('listitem').map((e) => e.textContent!.replace(/\s+/g, ' '));
		expect(items[0]).toContain('Organisation › Label');
		expect(items[1]).toContain('Organisation › has team › Team › title');
		expect(lastChange(p).picks).toHaveLength(2);
		expect(lastChange(p).picks[1].path.steps).toHaveLength(1);
		await fireEvent.click(within(summary).getAllByRole('button', { name: /Remove/ })[0]);
		expect(within(summary).getAllByRole('listitem')).toHaveLength(1);
		expect(lastChange(p).picks).toHaveLength(1);
		expect((within(panes()[1]).getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(false);
	});

	it('shows existing columns ticked and reports their removal when unticked', async () => {
		const m = { ...root(), columns: [{ id: 'c1', hopId: null, source: 'label' as const, header: 'Organisation' }] };
		const p = mount({ model: m });
		await openRoot();
		const box = within(panes()[1]).getAllByRole('checkbox')[0] as HTMLInputElement;
		expect(box.checked).toBe(true);
		await fireEvent.click(box);
		expect(lastChange(p)).toMatchObject({ picks: [], removeColumnIds: ['c1'] });
		await fireEvent.click(box);
		expect(lastChange(p)).toMatchObject({ removeColumnIds: [] });
	});

	it('counts and lists existing columns in the footer, and removes them from there', async () => {
		const m = { ...root(), columns: [{ id: 'c1', hopId: null, source: 'label' as const, header: 'Organisation' }] };
		const p = mount({ model: m, initialHopId: null });
		expect(screen.getByTestId('browser-selected-toggle')).toHaveTextContent('Selected columns (1)');
		await fireEvent.click(within(screen.getByTestId('browser-selected')).getByRole('button', { name: /Remove/ }));
		expect(lastChange(p)).toMatchObject({ removeColumnIds: ['c1'] });
		expect(screen.getByTestId('browser-selected-toggle')).toHaveTextContent('Selected columns (0)');
	});

	it('reopens expanded down to the deepest group that already has columns', () => {
		let m = addHop(root(), null, { iri: o('hasTeam'), targetClassIri: o('Team') });
		m = {
			...m,
			columns: [
				{ id: 'c1', hopId: null, source: 'label' as const, header: 'Organisation' },
				{ id: 'c2', hopId: 'h1', source: 'label' as const, header: 'Team' }
			]
		};
		mount({ model: m, initialHopId: null });
		expect(panes()).toHaveLength(3);
		expect((within(panes()[2]).getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(true);
		expect(screen.getByTestId('browser-selected-toggle')).toHaveTextContent('Selected columns (2)');
	});

	it('opens straight on a group when given an initial hop', () => {
		const m = addHop(root(), null, { iri: o('hasTeam'), targetClassIri: o('Team') });
		mount({ model: m, initialHopId: 'h1' });
		expect(rowNames(panes()[1]).slice(0, 3)).toEqual(['Label', 'IRI', 'title']);
	});
});

describe('ObjectBrowser depth warning', () => {
	it('warns from the fifth level on without blocking', async () => {
		mount();
		await openRoot();
		for (const name of [/has team/, /has member/, /owns/, /sponsors/]) {
			await fireEvent.click(link(panes().at(-1)!, name));
			expect(screen.queryByTestId('browser-depth-warning')).toBeNull();
		}
		await fireEvent.click(link(panes().at(-1)!, /led by/));
		expect(screen.getByTestId('browser-depth-warning')).toBeInTheDocument();
		expect(within(panes().at(-1)!).getAllByRole('checkbox').length).toBeGreaterThan(0);
	});
});

describe('ObjectBrowser search', () => {
	const type = async (value: string) => {
		await fireEvent.input(screen.getByRole('searchbox', { name: /Search/ }), { target: { value } });
		await vi.advanceTimersByTimeAsync(300);
	};
	const results = () => screen.queryAllByTestId('browser-search-result');
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('shows matching paths with breadcrumbs and opens every pane on the chosen one, highlighting the property', async () => {
		mount();
		await type('title');
		expect(results()[0]).toHaveTextContent('Organisation › has team › Team › title');
		await fireEvent.click(results()[0]);
		expect(panes()).toHaveLength(3);
		const found = within(panes()[2]).getAllByTestId('browser-property').filter((e) => e.dataset.found === 'true');
		expect(found.map((e) => e.querySelector('.name')!.textContent)).toEqual(['title']);
	});

	it('opens the target class of a matched link', async () => {
		mount();
		await type('owns');
		await fireEvent.click(results()[0]);
		expect(panes()).toHaveLength(3);
		expect(within(panes()[2]).getByRole('heading', { name: 'Person' })).toBeInTheDocument();
	});

	it('shows a result the cycle rule rejects with its reason and does not choose it', async () => {
		mount();
		await type('has team');
		const disabled = results().filter((r) => r.getAttribute('aria-disabled') === 'true');
		expect(disabled.length).toBeGreaterThan(0);
		expect(disabled[0].closest('li')).toHaveTextContent(/Already expanded/);
		await fireEvent.click(disabled[0]);
		expect(panes()).toHaveLength(1);
	});

	it('restores the previous pane state when the box is cleared', async () => {
		mount();
		await openRoot();
		await type('title');
		await fireEvent.click(results()[0]);
		expect(panes()).toHaveLength(3);
		await type('');
		expect(results()).toHaveLength(0);
		expect(panes()).toHaveLength(2);
	});

	it('hints when more results exist than shown, and when nothing matches', async () => {
		mount({ searchLimit: 1 });
		await type('e');
		expect(results()).toHaveLength(1);
		expect(screen.getByTestId('browser-search-more')).toBeInTheDocument();
		await type('zzzz');
		expect(screen.getByText('No matches')).toBeInTheDocument();
	});

	it('never changes the selection', async () => {
		const p = mount();
		await type('title');
		await fireEvent.click(results()[0]);
		expect(p.onChange).not.toHaveBeenCalled();
	});
});

describe('ObjectBrowser keyboard navigation', () => {
	const active = () => document.activeElement as HTMLElement;
	const key = (k: string) => fireEvent.keyDown(active(), { key: k });
	const items = (pane: HTMLElement) => [...pane.querySelectorAll<HTMLElement>('[data-nav]')];
	const focusRoot = () => screen.getByRole('button', { name: /Organisation/ }).focus();

	it('moves between rows with Up/Down and jumps with Home/End, without wrapping', async () => {
		mount();
		await openRoot();
		const rows = items(panes()[1]);
		rows[0].focus();
		await key('ArrowDown');
		expect(active()).toBe(rows[1]);
		await key('End');
		expect(active()).toBe(rows.at(-1));
		await key('ArrowDown');
		expect(active()).toBe(rows.at(-1));
		await key('Home');
		expect(active()).toBe(rows[0]);
		await key('ArrowUp');
		expect(active()).toBe(rows[0]);
	});

	it('opens the next pane with Right or Enter and moves focus into it', async () => {
		mount();
		focusRoot();
		await key('ArrowRight');
		expect(panes()).toHaveLength(2);
		expect(panes()[1]).toContainElement(active());
		link(panes()[1], /has team/).focus();
		await key('Enter');
		expect(panes()).toHaveLength(3);
		expect(active()).toBe(items(panes()[2])[0]);
		// Right on a property row (an end node) does nothing
		await key('ArrowRight');
		expect(panes()).toHaveLength(3);
		expect(active()).toBe(items(panes()[2])[0]);
	});

	it('returns to the open row of the previous pane with Left and keeps the panes open', async () => {
		mount();
		await openRoot();
		await fireEvent.click(link(panes()[1], /has team/));
		items(panes()[2])[1].focus();
		await key('ArrowLeft');
		expect(active()).toBe(link(panes()[1], /has team/));
		expect(panes()).toHaveLength(3);
		await key('ArrowLeft');
		expect(active()).toBe(within(panes()[0]).getByRole('button', { name: /Organisation/ }));
		await key('ArrowLeft');
		expect(active()).toBe(within(panes()[0]).getByRole('button', { name: /Organisation/ }));
	});

	it('toggles a property with Space', async () => {
		const p = mount();
		await openRoot();
		items(panes()[1])[0].focus();
		await key(' ');
		expect(lastChange(p).picks).toHaveLength(1);
		await key(' ');
		expect(lastChange(p).picks).toHaveLength(0);
	});

	it('keeps one tab stop per pane (roving tabindex) that follows focus', async () => {
		mount();
		await openRoot();
		const stops = (pane: HTMLElement) => items(pane).filter((e) => e.tabIndex === 0);
		expect(stops(panes()[0])).toHaveLength(1);
		expect(stops(panes()[1])).toHaveLength(1);
		expect(stops(panes()[1])[0]).toBe(items(panes()[1])[0]);
		items(panes()[1])[0].focus();
		await key('ArrowDown');
		expect(stops(panes()[1])).toEqual([items(panes()[1])[1]]);
	});

	it('does not lose focus when a row in an earlier pane replaces the deeper panes', async () => {
		mount();
		await openRoot();
		await fireEvent.click(link(panes()[1], /has team/));
		await fireEvent.click(link(panes()[2], /has member/));
		link(panes()[1], /sponsors/).focus();
		await key('Enter');
		expect(panes()).toHaveLength(3);
		expect(document.body).not.toBe(active());
		expect(panes()[2]).toContainElement(active());
	});

	it('exposes a disabled link as focusable, not actionable, with its reason described', async () => {
		mount();
		await openRoot();
		await fireEvent.click(link(panes()[1], /has team/));
		const back = link(panes()[2], /has team/);
		expect(back).not.toBeDisabled();
		back.focus();
		expect(active()).toBe(back);
		await key('Enter');
		expect(panes()).toHaveLength(3);
		const reason = document.getElementById(back.getAttribute('aria-describedby')!);
		expect(reason).toHaveTextContent(/undo the previous step/);
	});

	it('announces the open path and marks the open row expanded', async () => {
		mount();
		await openRoot();
		await fireEvent.click(link(panes()[1], /has team/));
		expect(link(panes()[1], /has team/)).toHaveAttribute('aria-expanded', 'true');
		expect(link(panes()[1], /sponsors/)).toHaveAttribute('aria-expanded', 'false');
		expect(screen.getByTestId('browser-announce')).toHaveTextContent('Organisation › has team › Team, level 1');
	});
});

describe('ObjectBrowser keyboard search', () => {
	const search = () => screen.getByRole('searchbox', { name: /Search/ });
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('Escape clears a non-empty box without reaching the dialog, and passes through when empty', async () => {
		mount();
		const seen = vi.fn();
		window.addEventListener('keydown', seen);
		await fireEvent.input(search(), { target: { value: 'title' } });
		await fireEvent.keyDown(search(), { key: 'Escape' });
		expect((search() as HTMLInputElement).value).toBe('');
		expect(seen).not.toHaveBeenCalled();
		await fireEvent.keyDown(search(), { key: 'Escape' });
		expect(seen).toHaveBeenCalledTimes(1);
		window.removeEventListener('keydown', seen);
	});

	it('Down from the box enters the results, and choosing one focuses the found property', async () => {
		mount();
		await fireEvent.input(search(), { target: { value: 'title' } });
		await vi.advanceTimersByTimeAsync(300);
		search().focus();
		await fireEvent.keyDown(search(), { key: 'ArrowDown' });
		const first = screen.getAllByTestId('browser-search-result')[0];
		expect(document.activeElement).toBe(first);
		await fireEvent.keyDown(first, { key: 'Enter' });
		const target = document.activeElement as HTMLElement;
		expect(target.closest('[data-found="true"]')).not.toBeNull();
	});
});

describe('ObjectBrowser collapsible summary', () => {
	const toggle = () => screen.getByTestId('browser-selected-toggle');
	async function tickTwo() {
		await openRoot();
		await fireEvent.click(within(panes()[1]).getAllByRole('checkbox')[0]);
		await fireEvent.click(within(panes()[1]).getAllByRole('checkbox')[1]);
	}

	it('shows the count on the header and toggles the list', async () => {
		mount();
		await tickTwo();
		expect(toggle()).toHaveTextContent('Selected columns (2)');
		expect(toggle()).toHaveAttribute('aria-expanded', 'true');
		const list = document.getElementById(toggle().getAttribute('aria-controls')!)!;
		expect(within(list).getAllByRole('listitem')).toHaveLength(2);
		await fireEvent.click(toggle());
		expect(toggle()).toHaveAttribute('aria-expanded', 'false');
		expect(list).not.toBeVisible();
		expect(toggle()).toHaveTextContent('Selected columns (2)');
		await fireEvent.click(toggle());
		expect(list).toBeVisible();
	});

	it('keeps removal notices visible while collapsed and counts kept columns plus picks', async () => {
		const m = { ...root(), columns: [{ id: 'c1', hopId: null, source: 'label' as const, header: 'Organisation' }] };
		mount({ model: m });
		await openRoot();
		await fireEvent.click(within(panes()[1]).getAllByRole('checkbox')[0]); // untick existing
		await fireEvent.click(within(panes()[1]).getAllByRole('checkbox')[1]); // tick IRI
		await fireEvent.click(toggle());
		expect(toggle()).toHaveTextContent('Selected columns (1)'); // IRI only: Organisation was unticked
		expect(screen.getByText(/Will be removed: Organisation/)).toBeVisible();
	});

	it('keeps list actions working after a collapse and expand', async () => {
		const p = mount();
		await tickTwo();
		await fireEvent.click(toggle());
		await fireEvent.click(toggle());
		await fireEvent.click(within(screen.getByTestId('browser-selected')).getAllByRole('button', { name: /Remove/ })[0]);
		expect(lastChange(p).picks).toHaveLength(1);
		expect(toggle()).toHaveTextContent('Selected columns (1)');
	});
});

describe('ObjectBrowser selection markers', () => {
	const badges = (el: HTMLElement) => within(el).queryAllByTestId('browser-selected-badge').map((b) => b.textContent);

	it('marks a link row that has picks below it even while another branch is open', async () => {
		mount();
		await openRoot();
		await fireEvent.click(link(panes()[1], /has team/));
		await fireEvent.click(within(panes()[2]).getAllByRole('checkbox')[0]); // a Team column
		await fireEvent.click(link(panes()[1], /sponsors/)); // open the sibling branch
		const hasTeam = link(panes()[1], /has team/);
		expect(badges(hasTeam)).toEqual(['1']);
		expect(hasTeam).toHaveAccessibleName(/\(1 selected column\)/);
		expect(badges(link(panes()[1], /sponsors/))).toEqual([]);
	});

	it('counts deeper picks on every link row along the path', async () => {
		mount();
		await openRoot();
		await fireEvent.click(link(panes()[1], /has team/));
		await fireEvent.click(link(panes()[2], /has member/));
		await fireEvent.click(within(panes()[3]).getAllByRole('checkbox')[0]);
		expect(badges(link(panes()[1], /has team/))).toEqual(['1']);
		expect(badges(link(panes()[2], /has member/))).toEqual(['1']);
	});

	it('marks groups of the first pane that already have columns', () => {
		let m = addHop(root(), null, { iri: o('hasTeam'), targetClassIri: o('Team') });
		m = { ...m, columns: [{ id: 'c2', hopId: 'h1', source: 'label' as const, header: 'Team' }] };
		mount({ model: m, initialHopId: null });
		const groups = within(panes()[0]).getAllByRole('button');
		expect(badges(groups[0])).toEqual([]); // root has none
		expect(badges(groups[1])).toEqual(['1']); // Team group
		expect(badges(link(panes()[1], /has team/))).toEqual(['1']);
	});

	it('drops the marker when the column is unticked', async () => {
		mount();
		await openRoot();
		await fireEvent.click(link(panes()[1], /has team/));
		const box = within(panes()[2]).getAllByRole('checkbox')[0];
		await fireEvent.click(box);
		await fireEvent.click(box);
		expect(badges(link(panes()[1], /has team/))).toEqual([]);
	});
});
