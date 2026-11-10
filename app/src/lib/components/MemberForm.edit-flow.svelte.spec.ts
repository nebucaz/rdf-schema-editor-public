import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import MemberForm from './MemberForm.svelte';
import { SparqlConnector } from '#lib/services/sparql-connector.js';
import {
	FIXTURE_CLASS,
	FIXTURE_INDIVIDUAL,
	FIXTURE_OBJECT,
	FIXTURE_PREDICATE,
	twoGraphFetch
} from '#lib/services/two-graph-fixture.js';

afterEach(() => vi.unstubAllGlobals());

/** The Edit flow's reads: what the identity page fetches before mounting the form. */
async function loadEditData() {
	const { fetchImpl, calls } = twoGraphFetch();
	vi.stubGlobal('fetch', vi.fn(fetchImpl));
	const connector = new SparqlConnector('/api/sparql');
	const assertions = await connector.fetchAssertionsForIndividual(FIXTURE_INDIVIDUAL);
	const targets = await connector.fetchIndividualsOfClass(FIXTURE_CLASS);
	return { assertions, targets, calls };
}

function mount(assertions: Awaited<ReturnType<typeof loadEditData>>['assertions'], targets: { iri: string; label: string }[]) {
	return render(MemberForm, {
		props: {
			mode: 'edit',
			initialLabel: 'Thing',
			submitLabel: 'Save',
			individualIri: FIXTURE_INDIVIDUAL,
			onSubmit: async () => {},
			onCancel: () => {},
			assertions,
			objectOptions: [],
			relationFields: [
				{ iri: 'urn:rel', name: 'Related', targetClassIri: FIXTURE_CLASS, targetClassName: 'Widget', repeatable: false, required: false }
			],
			relationTargetOptions: { 'urn:rel': targets }
		}
	});
}

describe('MemberForm Edit flow with rows repeated across two graphs', () => {
	it('renders one assertion and one option per individual, with no key error, warning or loop', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { assertions, targets } = await loadEditData();

		expect(() => mount(assertions, targets)).not.toThrow();

		expect(assertions).toHaveLength(1);
		expect(targets.map((t) => t.iri)).toEqual(['urn:fixture#a', 'urn:fixture#b']);
		expect(screen.getAllByText('Freigegeben')).toHaveLength(1);
		expect(warn).not.toHaveBeenCalled();
		const logged = [...warn.mock.calls, ...error.mock.calls].flat().join(' ');
		expect(logged).not.toMatch(/each_key_duplicate|effect_update_depth_exceeded/);
		warn.mockRestore();
		error.mockRestore();
	});

	it('sends a bounded number of requests for the reads', async () => {
		const { calls } = await loadEditData();
		// namespace lookup + assertions + individuals of class; mounting the form adds none.
		expect(calls).toHaveLength(3);
	});

	it('would fail on the raw, ungrouped rows (the pre-fix connector output)', async () => {
		const { ASSERTION_ROWS } = await import('#lib/services/two-graph-fixture.js');
		const raw = ASSERTION_ROWS.map((b) => ({
			individualIri: FIXTURE_INDIVIDUAL,
			predicateIri: b.p.value,
			predicateLabel: b.plabel.value,
			objectIri: b.o.value,
			objectLabel: b.olabel.value
		}));
		expect(raw.map((a) => a.predicateIri + a.objectIri)).toEqual(Array(3).fill(FIXTURE_PREDICATE + FIXTURE_OBJECT));
		expect(() => mount(raw, [])).toThrow(/each_key_duplicate/);
	});
});
