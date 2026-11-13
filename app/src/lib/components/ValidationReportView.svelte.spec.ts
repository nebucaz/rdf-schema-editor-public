import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';

vi.mock('#lib/stores/namespace-store.svelte.js', () => ({
	namespaceStore: {
		namespaces: [{ baseIri: 'http://ns', prefix: 'ns', description: '' }],
		ensureLoaded: vi.fn(async () => {})
	}
}));

vi.mock('#lib/utils/download.js', () => ({ downloadFile: vi.fn(), downloadBlob: vi.fn() }));

import { downloadFile } from '#lib/utils/download.js';
import { APP_VERSION } from '#lib/utils/app-version.js';
import { resetValidationReportSession } from '#lib/stores/validation-report-session.svelte.js';
import ValidationReportView from './ValidationReportView.svelte';
import { validationReportFilterStore } from '#lib/stores/validation-report-filter-store.svelte.js';

const violation = {
	individualIri: 'http://ns#alice',
	individualLabel: 'Alice',
	typeIri: 'http://ns#Person',
	path: 'http://ns#name',
	constraint: 'minCount',
	message: 'needs a name',
	ruleId: '',
	qualityDimension: '',
	shapeIri: ''
};

const notChecked = [
	{ shapeIri: 'http://ns#S1', ruleId: 'AC-ONE', construct: 'sh:in', reason: 'not supported' },
	{ shapeIri: 'http://ns#S1', ruleId: 'AC-TWO', construct: 'sh:select', reason: 'rejected: SERVICE' },
	{ shapeIri: 'http://ns#S2', ruleId: '', construct: 'sh:ask', reason: 'not supported' }
];

function respondWith(body: unknown) {
	vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
}

async function run() {
	render(ValidationReportView);
	await fireEvent.click(screen.getByRole('button', { name: 'Run Validation' }));
	await screen.findByRole('button', { name: 'Run Validation' });
}

afterEach(() => {
	cleanup();
	resetValidationReportSession();
	vi.unstubAllGlobals();
});

describe('ValidationReportView envelope', () => {
	it('renders the violations of the envelope', async () => {
		respondWith({ violations: [violation], notChecked: [] });
		await run();
		expect(await screen.findByText('Alice')).toBeTruthy();
	});

	it('shows no banner when nothing was skipped', async () => {
		respondWith({ violations: [violation], notChecked: [] });
		await run();
		await screen.findByText('Alice');
		expect(screen.queryByText(/not checked by this report/)).toBeNull();
	});

	it('shows a banner with the counts and an expandable list', async () => {
		respondWith({ violations: [violation], notChecked });
		await run();
		const banner = await screen.findByText('3 constraints in 2 shapes are not checked by this report');
		expect(banner).toBeTruthy();
		// the list is in the page twice: in the banner and as the print-only copy
		expect(screen.getAllByText('AC-ONE')).toHaveLength(2);
		expect(screen.getAllByText('sh:select')).toHaveLength(2);
		expect(screen.getAllByText('rejected: SERVICE')).toHaveLength(2);
	});

	it('uses the singular for one constraint', async () => {
		respondWith({ violations: [], notChecked: [notChecked[0]] });
		await run();
		expect(await screen.findByText('1 constraint in 1 shape is not checked by this report')).toBeTruthy();
	});

	it('words the all-clear text as limited to the checked constraints when some were skipped', async () => {
		respondWith({ violations: [], notChecked });
		await run();
		expect(await screen.findByText('No violations found among the checked constraints.')).toBeTruthy();
		expect(screen.queryByText(/every identity conforms/)).toBeNull();
	});

	it('keeps the plain all-clear text when nothing was skipped', async () => {
		respondWith({ violations: [], notChecked: [] });
		await run();
		expect(await screen.findByText(/every identity conforms/)).toBeTruthy();
	});
});

const finding = (over: Partial<typeof violation> & { value?: string }) => ({ ...violation, ...over });

describe('ValidationReportView rules and grouping', () => {
	it('shows the rule id with the shape IRI as title and the German message unmodified', async () => {
		respondWith({
			violations: [
				finding({ ruleId: 'AC-TECHID-EXIST', shapeIri: 'http://ns#ShapeA', message: 'Die technische ID fehlt: Müller & Söhne' })
			],
			notChecked: []
		});
		await run();
		expect(await screen.findByRole('columnheader', { name: 'Rule' })).toBeTruthy();
		expect(screen.getByText('AC-TECHID-EXIST').getAttribute('title')).toBe('http://ns#ShapeA');
		expect(screen.getByText('Die technische ID fehlt: Müller & Söhne')).toBeTruthy();
	});

	it('renders findings without a rule id as before', async () => {
		respondWith({ violations: [violation], notChecked: [] });
		await run();
		expect(await screen.findByText('needs a name')).toBeTruthy();
		expect(screen.getByText('minCount')).toBeTruthy();
	});

	it('renders two rules with the same individual, path and constraint', async () => {
		respondWith({
			violations: [
				finding({ constraint: 'sparql', path: '', ruleId: 'AC-ONE', message: 'first rule' }),
				finding({ constraint: 'sparql', path: '', ruleId: 'AC-TWO', message: 'second rule' })
			],
			notChecked: []
		});
		await run();
		expect(await screen.findByText('first rule')).toBeTruthy();
		expect(screen.getByText('second rule')).toBeTruthy();
	});

	it('opens grouped by identity', async () => {
		respondWith({ violations: [finding({ qualityDimension: 'Vollständigkeit' })], notChecked: [] });
		await run();
		await screen.findByText('Alice');
		expect((screen.getByRole('radio', { name: 'Identity' }) as HTMLInputElement).checked).toBe(true);
		expect(screen.queryByRole('heading', { name: /Vollständigkeit/ })).toBeNull();
	});

	it('groups by quality dimension with counts and Unspecified last', async () => {
		respondWith({
			violations: [
				finding({ individualIri: 'http://ns#a', individualLabel: 'A', qualityDimension: '' }),
				finding({ individualIri: 'http://ns#b', individualLabel: 'B', qualityDimension: 'Vollständigkeit' }),
				finding({ individualIri: 'http://ns#c', individualLabel: 'C', qualityDimension: 'Vollständigkeit' }),
				finding({ individualIri: 'http://ns#d', individualLabel: 'D', qualityDimension: 'Konsistenz' })
			],
			notChecked: []
		});
		await run();
		await screen.findByText('A');
		await fireEvent.click(screen.getByRole('radio', { name: 'Quality dimension' }));
		const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent?.replace(/\s+/g, ' ').trim());
		expect(headings).toEqual(['Konsistenz (1)', 'Vollständigkeit (2)', 'Unspecified (1)']);
	});

	it('respects the namespace filter inside groups', async () => {
		respondWith({
			violations: [
				finding({ individualIri: 'http://ns#a', individualLabel: 'A', qualityDimension: 'Konsistenz' }),
				finding({ individualIri: 'http://other#b', individualLabel: 'B', qualityDimension: 'Konsistenz' })
			],
			notChecked: []
		});
		await run();
		await screen.findByText('A');
		await fireEvent.click(screen.getByRole('radio', { name: 'Quality dimension' }));
		validationReportFilterStore.toggle('http://ns');
		try {
			expect(await screen.findByRole('heading', { level: 3, name: /Konsistenz/ })).toBeTruthy();
			expect(screen.queryByText('A')).toBeNull();
			expect(screen.getByText('B')).toBeTruthy();
		} finally {
			validationReportFilterStore.toggle('http://ns');
		}
	});
});

const many = [
	finding({ individualIri: 'http://ns#a', individualLabel: 'Anna', ruleId: 'R-1', constraint: 'pattern', value: 'A-77', qualityDimension: 'Format' }),
	finding({ individualIri: 'http://ns#b', individualLabel: 'Bob', ruleId: 'R-1', constraint: 'minLength', value: '', qualityDimension: 'Format' }),
	finding({ individualIri: 'http://ns#b', individualLabel: 'Bob', ruleId: 'R-2', constraint: 'pattern', value: '  ', qualityDimension: 'Format' }),
	finding({ individualIri: 'http://ns#b', individualLabel: 'Bob', ruleId: 'R-3', constraint: 'minCount', qualityDimension: 'Completeness' }),
	finding({ individualIri: 'http://ns#c', individualLabel: 'Cy', ruleId: 'R-4', constraint: 'datatype', value: 'http://ns#Int', qualityDimension: 'Completeness' }),
	finding({ individualIri: 'http://ns#c', individualLabel: 'Cy', ruleId: 'R-5', constraint: 'class', value: 'http://ns#Thing', qualityDimension: 'Completeness' })
];

const blockTitles = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent?.replace(/\s+/g, ' ').trim());
const valueCells = () => [...document.querySelectorAll('td.value')].map((td) => td.textContent);

describe('ValidationReportView by identity', () => {
	it('shows one block per identity, most findings first, with type and count', async () => {
		respondWith({ violations: many, notChecked: [] });
		await run();
		await screen.findByText('Bob');
		expect(blockTitles()).toEqual(['Bob ns:Person 3 findings', 'Cy ns:Person 2 findings', 'Anna ns:Person 1 finding']);
	});

	it('keeps the identity link to the identities route', async () => {
		respondWith({ violations: many, notChecked: [] });
		await run();
		const link = (await screen.findByRole('link', { name: 'Bob' })) as HTMLAnchorElement;
		expect(link.getAttribute('href')).toContain(encodeURIComponent('http://ns#b'));
		expect(link.getAttribute('title')).toBe('http://ns#b');
	});

	it('does not repeat the identity in each row', async () => {
		respondWith({ violations: many, notChecked: [] });
		await run();
		await screen.findByText('Bob');
		expect(screen.queryByRole('columnheader', { name: 'Identity' })).toBeNull();
		expect(screen.getAllByRole('link', { name: 'Bob' })).toHaveLength(1);
	});

	it('quotes literal values, shows nothing for minCount and a CURIE for datatype and class', async () => {
		respondWith({ violations: many, notChecked: [] });
		await run();
		await screen.findByText('Bob');
		expect(valueCells()).toEqual(['""', '"  "', '', 'ns:Int', 'ns:Thing', '"A-77"']);
	});

	it('shows the same findings in the other three views', async () => {
		respondWith({ violations: many, notChecked: [] });
		await run();
		await screen.findByText('Bob');
		for (const name of ['Rule', 'Quality dimension', 'None']) {
			await fireEvent.click(screen.getByRole('radio', { name }));
			expect(document.querySelectorAll('tbody tr')).toHaveLength(6);
		}
	});

	it('headlines the rule view with the rule id and its count', async () => {
		respondWith({ violations: many, notChecked: [] });
		await run();
		await screen.findByText('Bob');
		await fireEvent.click(screen.getByRole('radio', { name: 'Rule' }));
		expect(blockTitles()).toEqual(['R-1 (2)', 'R-2 (1)', 'R-3 (1)', 'R-4 (1)', 'R-5 (1)']);
	});

	it('shows the identity column in the flat view', async () => {
		respondWith({ violations: many, notChecked: [] });
		await run();
		await screen.findByText('Bob');
		await fireEvent.click(screen.getByRole('radio', { name: 'None' }));
		expect(screen.getByRole('columnheader', { name: 'Identity' })).toBeTruthy();
	});
});

describe('ValidationReportView summary line', () => {
	it('counts findings and identities', async () => {
		respondWith({ violations: many, notChecked: [] });
		await run();
		expect(await screen.findByText('6 findings in 3 identities')).toBeTruthy();
	});

	it('uses the singular', async () => {
		respondWith({ violations: [violation], notChecked: [] });
		await run();
		expect(await screen.findByText('1 finding in 1 identity')).toBeTruthy();
	});

	it('counts only what the namespace filter leaves visible', async () => {
		respondWith({
			violations: [finding({}), finding({ individualIri: 'http://other#b', individualLabel: 'B' })],
			notChecked: []
		});
		await run();
		await screen.findByText('2 findings in 2 identities');
		validationReportFilterStore.toggle('http://ns');
		try {
			expect(await screen.findByText('1 finding in 1 identity')).toBeTruthy();
		} finally {
			validationReportFilterStore.toggle('http://ns');
		}
	});

	it('lists the count per rule in the rule view and per dimension in the dimension view', async () => {
		respondWith({ violations: many, notChecked: [] });
		await run();
		await screen.findByText('Bob');
		await fireEvent.click(screen.getByRole('radio', { name: 'Rule' }));
		expect(screen.getByText('R-1: 2')).toBeTruthy();
		await fireEvent.click(screen.getByRole('radio', { name: 'Quality dimension' }));
		expect(screen.getByText('Completeness: 3')).toBeTruthy();
		expect(screen.getByText('Format: 3')).toBeTruthy();
	});
});

describe('ValidationReportView folding identity blocks', () => {
	const blockBody = (label: string) => {
		const body = screen.getByRole('button', { name: new RegExp(label) }).closest('section')!.querySelector('.block-body')!;
		return body;
	};

	async function open() {
		respondWith({ violations: many, notChecked: [] });
		await run();
		await screen.findByText('Bob');
	}

	it('starts expanded', async () => {
		await open();
		for (const label of ['Bob', 'Cy', 'Anna']) {
			expect(screen.getByRole('button', { name: new RegExp(label) }).getAttribute('aria-expanded')).toBe('true');
			expect(blockBody(label).classList.contains('folded')).toBe(false);
		}
	});

	it('folds and unfolds a block by its header button, reflected in aria-expanded', async () => {
		await open();
		const button = screen.getByRole('button', { name: /Bob/ });
		await fireEvent.click(button);
		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(blockBody('Bob').classList.contains('folded')).toBe(true);
		expect(blockBody('Cy').classList.contains('folded')).toBe(false);
		await fireEvent.click(button);
		expect(button.getAttribute('aria-expanded')).toBe('true');
		expect(blockBody('Bob').classList.contains('folded')).toBe(false);
	});

	it('collapse all folds every block and a folded header still shows label, type and count', async () => {
		await open();
		await fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
		for (const label of ['Bob', 'Cy', 'Anna']) expect(blockBody(label).classList.contains('folded')).toBe(true);
		expect(blockTitles()[0]).toBe('Bob ns:Person 3 findings');
	});

	it('expand all opens every block', async () => {
		await open();
		await fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
		for (const label of ['Bob', 'Cy', 'Anna']) expect(blockBody(label).classList.contains('folded')).toBe(false);
	});

	it('does not change the summary line or the findings in the DOM', async () => {
		await open();
		await fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
		expect(screen.getByText('6 findings in 3 identities')).toBeTruthy();
		expect(document.querySelectorAll('tbody tr')).toHaveLength(6);
	});

	it('resets when the view changes', async () => {
		await open();
		await fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
		await fireEvent.click(screen.getByRole('radio', { name: 'Rule' }));
		await fireEvent.click(screen.getByRole('radio', { name: 'Identity' }));
		expect(blockBody('Bob').classList.contains('folded')).toBe(false);
	});

	it('resets when the report is run again', async () => {
		await open();
		await fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Run Validation' }));
		await screen.findByRole('button', { name: 'Run Validation' });
		await screen.findByText('Bob');
		expect(blockBody('Bob').classList.contains('folded')).toBe(false);
	});

	it('shows the buttons only in the identity view', async () => {
		await open();
		await fireEvent.click(screen.getByRole('radio', { name: 'Rule' }));
		expect(screen.queryByRole('button', { name: 'Collapse all' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Expand all' })).toBeNull();
	});
});

describe('ValidationReportView export menu', () => {
	const exportButton = () => screen.getByRole('button', { name: 'Export' }) as HTMLButtonElement;

	async function openMenu() {
		await fireEvent.click(exportButton());
	}

	async function runWith(violations = many, nc: typeof notChecked = []) {
		respondWith({ violations, notChecked: nc });
		await run();
		await screen.findByText('6 findings in 3 identities').catch(() => {});
	}

	it('is disabled before the first run', () => {
		render(ValidationReportView);
		expect(exportButton().disabled).toBe(true);
	});

	it('is disabled after a failed run', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500, statusText: 'boom' })));
		await run();
		await screen.findByText(/Validation report failed/);
		expect(exportButton().disabled).toBe(true);
	});

	it('offers CSV, JSON, Markdown and PDF after a run', async () => {
		await runWith();
		expect(exportButton().disabled).toBe(false);
		await openMenu();
		for (const name of ['CSV', 'JSON', 'Markdown', 'PDF']) expect(screen.getByRole('menuitem', { name })).toBeTruthy();
	});

	it('downloads the CSV of the visible findings with name and MIME type', async () => {
		vi.mocked(downloadFile).mockClear();
		await runWith();
		await openMenu();
		await fireEvent.click(screen.getByRole('menuitem', { name: 'CSV' }));
		expect(downloadFile).toHaveBeenCalledTimes(1);
		const [name, text, mime] = vi.mocked(downloadFile).mock.calls[0];
		expect(name).toMatch(/^validation-report-\d{4}-\d{2}-\d{2}\.csv$/);
		expect(mime).toContain('text/csv');
		expect(text.split('\r\n').filter((l) => l.startsWith('finding,'))).toHaveLength(6);
	});

	it('downloads JSON with notChecked and the app version', async () => {
		vi.mocked(downloadFile).mockClear();
		await runWith(many, notChecked);
		await openMenu();
		await fireEvent.click(screen.getByRole('menuitem', { name: 'JSON' }));
		const [name, text, mime] = vi.mocked(downloadFile).mock.calls[0];
		expect(name).toMatch(/\.json$/);
		expect(mime).toContain('application/json');
		const parsed = JSON.parse(text);
		expect(parsed.appVersion).toBe(APP_VERSION);
		expect(parsed.violations).toHaveLength(6);
		expect(parsed.notChecked).toHaveLength(3);
	});

	it('downloads Markdown in the chosen view', async () => {
		vi.mocked(downloadFile).mockClear();
		await runWith();
		await fireEvent.click(screen.getByRole('radio', { name: 'Rule' }));
		await openMenu();
		await fireEvent.click(screen.getByRole('menuitem', { name: 'Markdown' }));
		const [name, text, mime] = vi.mocked(downloadFile).mock.calls[0];
		expect(name).toMatch(/\.md$/);
		expect(mime).toContain('text/markdown');
		expect(text).toContain('### R-1 (2)');
	});

	it('exports what the namespace filter leaves visible', async () => {
		vi.mocked(downloadFile).mockClear();
		await runWith([finding({}), finding({ individualIri: 'http://other#b', individualLabel: 'B' })]);
		validationReportFilterStore.toggle('http://ns');
		try {
			await screen.findByText('1 finding in 1 identity');
			await openMenu();
			await fireEvent.click(screen.getByRole('menuitem', { name: 'JSON' }));
			const parsed = JSON.parse(vi.mocked(downloadFile).mock.calls[0][1]);
			expect(parsed.violations.map((v: { individualIri: string }) => v.individualIri)).toEqual(['http://other#b']);
			expect(parsed.filter.hiddenNamespaces).toEqual(['http://ns']);
		} finally {
			validationReportFilterStore.toggle('http://ns');
		}
	});

	it('exports a clean run', async () => {
		vi.mocked(downloadFile).mockClear();
		await runWith([], notChecked);
		await openMenu();
		await fireEvent.click(screen.getByRole('menuitem', { name: 'Markdown' }));
		expect(vi.mocked(downloadFile).mock.calls[0][1]).toContain('AC-ONE');
	});

	it('prints for the PDF entry', async () => {
		const print = vi.fn();
		vi.stubGlobal('print', print);
		await runWith();
		await openMenu();
		await fireEvent.click(screen.getByRole('menuitem', { name: 'PDF' }));
		expect(print).toHaveBeenCalledTimes(1);
	});

	it('marks the export controls no-print', async () => {
		await runWith();
		expect(exportButton().closest('.no-print')).not.toBeNull();
	});
});

describe('ValidationReportView print layout', () => {
	async function runWith(violations = many, nc: typeof notChecked = []) {
		respondWith({ violations, notChecked: nc });
		await run();
		await screen.findByText('Bob');
	}

	it('has a print-only header with title, run time, app version and the summary line', async () => {
		await runWith();
		const header = document.querySelector('.print-header')!;
		expect(header).not.toBeNull();
		expect(header.textContent).toContain('Validation report');
		expect(header.textContent).toMatch(/\d{4}-\d{2}-\d{2}T/);
		expect(header.textContent).toContain(APP_VERSION);
		expect(header.textContent).toContain('6 findings in 3 identities');
	});

	it('has no print header before a report has run', () => {
		render(ValidationReportView);
		expect(document.querySelector('.print-header')).toBeNull();
	});

	it('marks the toolbar, view control, fold buttons and fold-all as no-print', async () => {
		await runWith();
		expect(screen.getByRole('button', { name: 'Run Validation' }).closest('.no-print')).not.toBeNull();
		expect(screen.getByRole('radiogroup', { name: 'Group by' }).closest('.no-print')).not.toBeNull();
		expect(screen.getByRole('button', { name: 'Collapse all' }).closest('.no-print')).not.toBeNull();
		for (const b of document.querySelectorAll('.fold-btn')) expect(b.closest('.no-print')).not.toBeNull();
	});

	it('keeps folded blocks in the page, so print can open them', async () => {
		await runWith();
		await fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
		expect(document.querySelectorAll('.block-body.folded')).toHaveLength(3);
		expect(document.querySelectorAll('.block-body tbody tr')).toHaveLength(6);
	});

	it('has a print copy of the not-checked list outside the collapsed banner', async () => {
		await runWith(many, notChecked);
		const printCopy = document.querySelector('.print-only .not-checked')!;
		expect(printCopy).not.toBeNull();
		expect(printCopy.closest('details')).toBeNull();
		expect(printCopy.textContent).toContain('AC-ONE');
		expect(document.querySelector('details.banner')!.closest('.no-print')).not.toBeNull();
	});
});

describe('ValidationReportView coming back', () => {
	it('shows the last report again after the view was left and re-opened', async () => {
		respondWith({ violations: many, notChecked });
		await run();
		await screen.findByText('Bob');
		await fireEvent.click(screen.getByRole('radio', { name: 'Rule' }));
		cleanup();

		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		render(ValidationReportView);
		expect(await screen.findByText('6 findings in 3 identities')).toBeTruthy();
		expect((screen.getByRole('radio', { name: 'Rule' }) as HTMLInputElement).checked).toBe(true);
		expect(screen.getByText('3 constraints in 2 shapes are not checked by this report')).toBeTruthy();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('keeps folded blocks folded', async () => {
		respondWith({ violations: many, notChecked: [] });
		await run();
		await screen.findByText('Bob');
		await fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
		cleanup();
		render(ValidationReportView);
		expect(document.querySelectorAll('.block-body.folded')).toHaveLength(3);
	});

	it('starts empty once the session is reset (a reload)', () => {
		resetValidationReportSession();
		render(ValidationReportView);
		expect(screen.getByText(/Click "Run Validation"/)).toBeTruthy();
	});
});

describe('ValidationReportView column layout', () => {
	const headers = (table: Element) => [...table.querySelectorAll('th')].map((th) => th.textContent?.trim());

	it('puts the message first and uses the same columns in every identity block', async () => {
		respondWith({ violations: many, notChecked: [] });
		await run();
		await screen.findByText('Bob');
		const tables = [...document.querySelectorAll('.identity-block table.findings')];
		expect(tables).toHaveLength(3);
		for (const t of tables) expect(headers(t)).toEqual(['Message', 'Rule', 'Path', 'Constraint', 'Value']);
	});

	it('uses a fixed layout so the columns line up across the blocks', async () => {
		respondWith({ violations: many, notChecked: [] });
		await run();
		await screen.findByText('Bob');
		for (const t of document.querySelectorAll('.identity-block table.findings')) {
			expect(t.classList.contains('findings')).toBe(true);
			expect(t.querySelectorAll('th[class^="col-"]')).toHaveLength(5);
		}
	});

	it('keeps identity and type in front of the message in the other views', async () => {
		respondWith({ violations: many, notChecked: [] });
		await run();
		await screen.findByText('Bob');
		await fireEvent.click(screen.getByRole('radio', { name: 'None' }));
		expect(headers(document.querySelector('table.findings')!)).toEqual(['Identity', 'Type', 'Message', 'Rule', 'Path', 'Constraint', 'Value']);
	});
});
