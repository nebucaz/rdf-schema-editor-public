import { describe, it, expect } from 'vitest';
import {
	emptyRelationFormValues,
	mergeRelationFormValues,
	resolveRelationTargetIri,
	disambiguateOptionLabels,
	relationTargetOptionsFromIndividuals,
	validateRelationSelections,
	reconcileRelationValues,
	type RelationFieldSpecLike,
	type RelationTargetOption
} from './relation-values';

function rel(iri: string, overrides: Partial<RelationFieldSpecLike> = {}): RelationFieldSpecLike {
	return { iri, name: iri, required: false, repeatable: false, ...overrides };
}

function opt(iri: string, label: string): RelationTargetOption {
	return { iri, label };
}

describe('emptyRelationFormValues', () => {
	it('seeds an empty string for single-valued fields and an empty array for repeatable ones', () => {
		const values = emptyRelationFormValues([rel('a'), rel('b', { repeatable: true })]);
		expect(values).toEqual({ a: '', b: [] });
	});
});

describe('mergeRelationFormValues', () => {
	it('fills in defaults for fields with no asserted labels', () => {
		const values = mergeRelationFormValues([rel('a'), rel('b', { repeatable: true })], {});
		expect(values).toEqual({ a: '', b: [] });
	});

	it('seeds a single-valued field from its one asserted label', () => {
		const values = mergeRelationFormValues([rel('a')], { a: ['BusinessProcess1'] });
		expect(values).toEqual({ a: 'BusinessProcess1' });
	});

	it('seeds a repeatable field from all of its asserted labels', () => {
		const values = mergeRelationFormValues([rel('a', { repeatable: true })], { a: ['BP1', 'BP2'] });
		expect(values).toEqual({ a: ['BP1', 'BP2'] });
	});
});

describe('resolveRelationTargetIri', () => {
	it('finds the exact-label match', () => {
		expect(resolveRelationTargetIri([opt('iri1', 'BP1'), opt('iri2', 'BP2')], 'BP2')).toBe('iri2');
	});

	it('returns undefined when nothing matches', () => {
		expect(resolveRelationTargetIri([opt('iri1', 'BP1')], 'Unknown')).toBeUndefined();
	});

	it('returns undefined when two options share the label (never the first match)', () => {
		expect(resolveRelationTargetIri([opt('iri1', 'BP'), opt('iri2', 'BP')], 'BP')).toBeUndefined();
	});

	it('still resolves a unique label next to an ambiguous pair', () => {
		expect(resolveRelationTargetIri([opt('iri1', 'BP'), opt('iri2', 'BP'), opt('iri3', 'Other')], 'Other')).toBe('iri3');
	});
});

describe('validateRelationSelections — ambiguous label', () => {
	it('reports a required field with an ambiguous label as invalid, not missing', () => {
		const result = validateRelationSelections(
			[rel('a', { required: true })],
			{ a: 'BP' },
			{ a: [opt('iri1', 'BP'), opt('iri2', 'BP')] }
		);
		expect(result).toEqual({ missing: [], invalid: ['a'] });
	});
});

describe('validateRelationSelections', () => {
	const options = { a: [opt('iri1', 'BP1')] };

	it('reports a required single-valued field left blank', () => {
		const { missing, invalid } = validateRelationSelections([rel('a', { required: true })], { a: '' }, options);
		expect(missing).toEqual(['a']);
		expect(invalid).toEqual([]);
	});

	it('reports a non-blank value that does not match any target option', () => {
		const { missing, invalid } = validateRelationSelections([rel('a', { required: true })], { a: 'NotInList' }, options);
		expect(missing).toEqual([]);
		expect(invalid).toEqual(['a']);
	});

	it('passes a required field with a value matching a target option', () => {
		const { missing, invalid } = validateRelationSelections([rel('a', { required: true })], { a: 'BP1' }, options);
		expect(missing).toEqual([]);
		expect(invalid).toEqual([]);
	});

	it('ignores non-required fields left blank', () => {
		const { missing, invalid } = validateRelationSelections([rel('a')], { a: '' }, options);
		expect(missing).toEqual([]);
		expect(invalid).toEqual([]);
	});

	it('reports a required repeatable field with no non-blank rows', () => {
		const { missing } = validateRelationSelections([rel('a', { required: true, repeatable: true })], { a: ['', '  '] }, options);
		expect(missing).toEqual(['a']);
	});

	it('reports a repeatable field with one row that fails to resolve', () => {
		const { invalid } = validateRelationSelections([rel('a', { repeatable: true })], { a: ['BP1', 'NotInList'] }, options);
		expect(invalid).toEqual(['a']);
	});
});

describe('reconcileRelationValues — single-valued', () => {
	const options = { a: [opt('iri1', 'BP1'), opt('iri2', 'BP2')] };

	it('produces no submission when the resolved selection is unchanged', () => {
		const submissions = reconcileRelationValues([rel('a', { name: 'supports' })], { a: ['iri1'] }, { a: 'BP1' }, options);
		expect(submissions).toEqual([]);
	});

	it('produces an add+remove submission when the selection changed', () => {
		const submissions = reconcileRelationValues([rel('a', { name: 'supports' })], { a: ['iri1'] }, { a: 'BP2' }, options);
		expect(submissions).toEqual([{ predicateIri: 'a', predicateLabel: 'supports', added: ['iri2'], removed: ['iri1'] }]);
	});

	it('produces a remove-only submission when the field is cleared', () => {
		const submissions = reconcileRelationValues([rel('a', { name: 'supports' })], { a: ['iri1'] }, { a: '' }, options);
		expect(submissions).toEqual([{ predicateIri: 'a', predicateLabel: 'supports', added: [], removed: ['iri1'] }]);
	});

	it('produces an add-only submission when set from empty (create mode)', () => {
		const submissions = reconcileRelationValues([rel('a', { name: 'supports' })], {}, { a: 'BP1' }, options);
		expect(submissions).toEqual([{ predicateIri: 'a', predicateLabel: 'supports', added: ['iri1'], removed: [] }]);
	});

	it('drops unmatched typed text from the diff entirely (validation is expected to have blocked it)', () => {
		const submissions = reconcileRelationValues([rel('a', { name: 'supports' })], {}, { a: 'NotInList' }, options);
		expect(submissions).toEqual([]);
	});
});

describe('reconcileRelationValues — repeatable', () => {
	const repeatableRel = rel('a', { name: 'supports', repeatable: true });
	const options = { a: [opt('iri1', 'BP1'), opt('iri2', 'BP2'), opt('iri3', 'BP3')] };

	it('produces no submission when the resolved set is unchanged (order-independent)', () => {
		const submissions = reconcileRelationValues([repeatableRel], { a: ['iri1', 'iri2'] }, { a: ['BP2', 'BP1'] }, options);
		expect(submissions).toEqual([]);
	});

	it('diffs added and removed targets', () => {
		const submissions = reconcileRelationValues([repeatableRel], { a: ['iri1', 'iri2'] }, { a: ['BP1', 'BP3'] }, options);
		expect(submissions).toEqual([{ predicateIri: 'a', predicateLabel: 'supports', added: ['iri3'], removed: ['iri2'] }]);
	});

	it('dedupes the same target typed into two rows (set diff, not multiset)', () => {
		const submissions = reconcileRelationValues([repeatableRel], {}, { a: ['BP1', 'BP1'] }, options);
		expect(submissions).toEqual([{ predicateIri: 'a', predicateLabel: 'supports', added: ['iri1'], removed: [] }]);
	});

	it('drops blank in-progress rows', () => {
		const submissions = reconcileRelationValues([repeatableRel], {}, { a: ['', 'BP1', ''] }, options);
		expect(submissions).toEqual([{ predicateIri: 'a', predicateLabel: 'supports', added: ['iri1'], removed: [] }]);
	});
});

describe('reconcileRelationValues — multiple fields', () => {
	it('only includes submissions for fields that actually changed', () => {
		const submissions = reconcileRelationValues(
			[rel('a', { name: 'supports' }), rel('b', { name: 'blockedBy' })],
			{ a: ['iri1'], b: ['iriX'] },
			{ a: 'BP1', b: 'BPY' },
			{ a: [opt('iri1', 'BP1')], b: [opt('iriX', 'BPX'), opt('iriY', 'BPY')] }
		);
		expect(submissions).toEqual([{ predicateIri: 'b', predicateLabel: 'blockedBy', added: ['iriY'], removed: ['iriX'] }]);
	});
});

describe('disambiguateOptionLabels', () => {
	const NS = 'https://example.org/api#';

	it('returns an empty list unchanged', () => {
		expect(disambiguateOptionLabels([])).toEqual([]);
	});

	it('leaves unique labels byte-identical', () => {
		const input = [opt(`${NS}A`, '[api] A'), opt(`${NS}B`, '[api] B')];
		expect(disambiguateOptionLabels(input)).toEqual(input);
	});

	it('appends the local name to colliding labels only', () => {
		const out = disambiguateOptionLabels([
			opt(`${NS}One`, '[api] Meter'),
			opt(`${NS}Solo`, '[api] Solo'),
			opt(`${NS}Two`, '[api] Meter')
		]);
		expect(out).toEqual([
			{ iri: `${NS}One`, label: '[api] Meter (One)' },
			{ iri: `${NS}Solo`, label: '[api] Solo' },
			{ iri: `${NS}Two`, label: '[api] Meter (Two)' }
		]);
	});

	it('adds a stable counter when local names collide too', () => {
		const out = disambiguateOptionLabels([
			opt('https://a.org/x#Same', 'L'),
			opt('https://b.org/y#Same', 'L'),
			opt('https://c.org/z#Same', 'L')
		]);
		expect(out.map((o) => o.label)).toEqual(['L (Same)', 'L (Same 2)', 'L (Same 3)']);
		expect(new Set(out.map((o) => o.label)).size).toBe(3);
		expect(out.map((o) => o.iri)).toEqual(['https://a.org/x#Same', 'https://b.org/y#Same', 'https://c.org/z#Same']);
	});

	it('does not mutate its input', () => {
		const input = [opt(`${NS}One`, 'M'), opt(`${NS}Two`, 'M')];
		const copy = JSON.parse(JSON.stringify(input));
		disambiguateOptionLabels(input);
		expect(input).toEqual(copy);
	});

	it('never collides with an existing unique label that equals a suffixed one', () => {
		const out = disambiguateOptionLabels([opt(`${NS}One`, 'M'), opt(`${NS}Two`, 'M'), opt(`${NS}Three`, 'M (One)')]);
		expect(new Set(out.map((o) => o.label)).size).toBe(3);
	});
});

describe('relationTargetOptionsFromIndividuals', () => {
	const prefixFor = (ns: string) => (ns === 'https://e.org/api' ? 'api' : 'core');

	it('prefixes the namespace prefix to each label', () => {
		const out = relationTargetOptionsFromIndividuals(
			[{ iri: 'https://e.org/api#A', label: 'A', namespaceBaseIri: 'https://e.org/api' }],
			prefixFor
		);
		expect(out).toEqual([{ iri: 'https://e.org/api#A', label: '[api] A' }]);
	});

	it('keeps two same-label individuals of one namespace distinct, each resolving to its own IRI', () => {
		const ns = 'https://e.org/api';
		const out = relationTargetOptionsFromIndividuals(
			[
				{ iri: `${ns}#X1`, label: 'DelayMeter Public API', namespaceBaseIri: ns },
				{ iri: `${ns}#X2`, label: 'DelayMeter Public API', namespaceBaseIri: ns }
			],
			prefixFor
		);
		expect(new Set(out.map((o) => o.label)).size).toBe(2);
		expect(resolveRelationTargetIri(out, out[0].label)).toBe(`${ns}#X1`);
		expect(resolveRelationTargetIri(out, out[1].label)).toBe(`${ns}#X2`);
	});
});
