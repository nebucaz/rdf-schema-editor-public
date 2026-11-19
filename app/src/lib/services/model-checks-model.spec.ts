import { describe, expect, it } from 'vitest';
import type { GateFinding } from './gates/index.js';
import {
	DEFAULT_MODEL_CHECKS_STATE,
	MODEL_CHECKS_PAGE_SIZE,
	filterProblems,
	pageOfProblems,
	parseModelChecksState,
	patchModelChecksState,
	withModelChecksState
} from './model-checks-model.js';

const f = (over: Partial<GateFinding>): GateFinding => ({
	gateId: 'g',
	stage: 'ontology',
	severity: 'info',
	elementIri: 'http://e#A',
	message: 'm',
	...over
});

const problems = [
	f({ message: 'Alpha has no description', severity: 'info' }),
	f({ stage: 'vocabulary', message: 'Customer has no definition', severity: 'warning' }),
	f({ stage: 'taxonomy', message: 'Cloud is an orphan', severity: 'info' }),
	f({ message: 'Beta is not linked', severity: 'warning' })
];

describe('filterProblems', () => {
	it('keeps everything without a filter, warnings first and the gates own order otherwise', () => {
		const out = filterProblems(problems, DEFAULT_MODEL_CHECKS_STATE);
		expect(out.map((p) => p.message)).toEqual([
			'Customer has no definition',
			'Beta is not linked',
			'Alpha has no description',
			'Cloud is an orphan'
		]);
	});

	it('narrows by stage, severity and search text (message or stage name, any case)', () => {
		const base = DEFAULT_MODEL_CHECKS_STATE;
		expect(filterProblems(problems, { ...base, stage: 'vocabulary' })).toHaveLength(1);
		expect(filterProblems(problems, { ...base, severity: 'warning' })).toHaveLength(2);
		expect(filterProblems(problems, { ...base, q: 'ALPHA' })).toHaveLength(1);
		expect(filterProblems(problems, { ...base, q: 'taxonomy' })).toHaveLength(1);
		expect(filterProblems(problems, { ...base, stage: 'ontology', severity: 'warning' }).map((p) => p.message)).toEqual(['Beta is not linked']);
	});
});

describe('pageOfProblems', () => {
	const many = Array.from({ length: MODEL_CHECKS_PAGE_SIZE + 3 }, (_, i) => f({ message: `p${i}` }));
	it('slices the page and clamps one past the end', () => {
		expect(pageOfProblems(many, 1)).toHaveLength(MODEL_CHECKS_PAGE_SIZE);
		expect(pageOfProblems(many, 2).map((p) => p.message)).toEqual(['p25', 'p26', 'p27']);
		expect(pageOfProblems(many, 9)).toHaveLength(3);
	});
});

describe('URL state', () => {
	it('reads known values and falls back to the default for unknown ones', () => {
		expect(parseModelChecksState(new URLSearchParams('stage=taxonomy&severity=warning&q=cloud&page=2'))).toEqual({
			stage: 'taxonomy',
			severity: 'warning',
			q: 'cloud',
			page: 2
		});
		expect(parseModelChecksState(new URLSearchParams('stage=nope&severity=loud&page=0'))).toEqual(DEFAULT_MODEL_CHECKS_STATE);
	});

	it('writes only non-default values and keeps other parameters such as tab', () => {
		const params = withModelChecksState(new URLSearchParams('tab=checks&stage=old'), { stage: '', severity: 'info', q: 'x', page: 3 });
		expect(params.toString()).toBe('tab=checks&severity=info&q=x&page=3');
		expect(withModelChecksState(new URLSearchParams('tab=checks'), DEFAULT_MODEL_CHECKS_STATE).toString()).toBe('tab=checks');
	});

	it('goes back to page 1 when a filter changes unless the patch names a page', () => {
		const state = { ...DEFAULT_MODEL_CHECKS_STATE, page: 4 };
		expect(patchModelChecksState(state, { severity: 'warning' }).page).toBe(1);
		expect(patchModelChecksState(state, { page: 5 }).page).toBe(5);
	});
});
