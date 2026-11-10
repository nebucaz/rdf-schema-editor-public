import { describe, expect, it } from 'vitest';
import { EMPTY_GOVERNANCE, missingGovernance, validateGovernance } from './governance';

describe('governance (STORY-331)', () => {
	it('accepts empty settings and a complete set', () => {
		expect(validateGovernance(EMPTY_GOVERNANCE)).toEqual([]);
		expect(validateGovernance({ steward: 'Ann', authority: 'Data Office', maturity: 'pilot', version: '1.2.0' })).toEqual([]);
	});

	it('wants a three-part version and a known maturity', () => {
		expect(validateGovernance({ ...EMPTY_GOVERNANCE, version: '1.2' })).toHaveLength(1);
		expect(validateGovernance({ ...EMPTY_GOVERNANCE, maturity: 'alpha' as never })).toHaveLength(1);
	});

	it('lists what a core namespace still lacks', () => {
		expect(missingGovernance(EMPTY_GOVERNANCE)).toEqual(['steward', 'authority', 'version']);
		expect(missingGovernance({ steward: ' ', authority: 'x', maturity: '', version: '1.0.0' })).toEqual(['steward']);
		expect(missingGovernance({ steward: 'a', authority: 'b', maturity: '', version: '0.1.0' })).toEqual([]);
	});
});
