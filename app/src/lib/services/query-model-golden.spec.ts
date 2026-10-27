import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseQueryModel, serializeQueryModel } from './query-model';
import { MAX_SHARED_MODEL_BYTES, isShortId, newShortId } from './short-links';

// Shared with the Go suite (backend/internal/querymodel, backend/internal/shortlinks): the fixtures
// are what keeps the two parsers in agreement.
const golden = JSON.parse(
	readFileSync(new URL('../../../../backend/testdata/golden/query-model.json', import.meta.url), 'utf8')
) as {
	maxSharedModelBytes: number;
	queryModels: ({ name: string; text: string } & (
		| { ok: true; canonical: string }
		| { ok: false; error: string }
	))[];
	isShortId: { input: string; valid: boolean }[];
	newShortId: { name: string; batches: number[][]; id: string }[];
};

describe('golden vectors shared with the Go backend', () => {
	it.each(golden.queryModels)('parseQueryModel: $name', (c) => {
		const result = parseQueryModel(c.text);
		if (c.ok) {
			expect(result.ok).toBe(true);
			if (result.ok) expect(serializeQueryModel(result.model)).toBe(c.canonical);
		} else {
			expect(result).toEqual({ ok: false, error: c.error });
		}
	});

	it('MAX_SHARED_MODEL_BYTES', () => {
		expect(MAX_SHARED_MODEL_BYTES).toBe(golden.maxSharedModelBytes);
	});

	it.each(golden.isShortId)('isShortId: $input', ({ input, valid }) => {
		expect(isShortId(input)).toBe(valid);
	});

	it.each(golden.newShortId)('newShortId: $name', ({ batches, id }) => {
		let i = 0;
		expect(newShortId(() => Uint8Array.from(batches[i++]))).toBe(id);
	});
});
