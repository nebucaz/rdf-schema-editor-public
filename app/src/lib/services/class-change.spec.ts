import { describe, expect, it } from 'vitest';
import { planClassChange } from './class-change';

const f = (iri: string, name = iri) => ({ iri, name });

describe('planClassChange', () => {
	it('keeps values whose predicate exists on the new class and drops the rest', () => {
		const plan = planClassChange(
			[f('p:a'), f('p:b'), f('p:c')],
			[f('p:a'), f('p:c'), f('p:d')],
			{ 'p:a': 'x', 'p:b': 'y', 'p:c': ['z'] }
		);
		expect(plan.kept.map((k) => k.iri)).toEqual(['p:a', 'p:c']);
		expect(plan.dropped.map((d) => d.iri)).toEqual(['p:b']);
	});

	it('ignores fields without a current value', () => {
		const plan = planClassChange([f('p:a'), f('p:b')], [f('p:a')], { 'p:a': 'x' });
		expect(plan.dropped).toEqual([]);
		expect(plan.kept.map((k) => k.iri)).toEqual(['p:a']);
	});

	it('treats empty strings and empty arrays as no value', () => {
		const plan = planClassChange([f('p:a'), f('p:b')], [], { 'p:a': '', 'p:b': [] });
		expect(plan).toEqual({ kept: [], dropped: [] });
	});

	it('works when the old class is absent (untyped individual)', () => {
		const plan = planClassChange([], [f('p:a')], {});
		expect(plan).toEqual({ kept: [], dropped: [] });
	});

	it('keeps an inherited field that the new class also has', () => {
		const plan = planClassChange([f('p:inherited')], [f('p:inherited'), f('p:own')], { 'p:inherited': 'v' });
		expect(plan.dropped).toEqual([]);
	});
});
