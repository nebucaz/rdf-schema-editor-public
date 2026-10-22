import { describe, expect, it } from 'vitest';
import { MAX_SHARE_PARAM_LENGTH, decodeModelFromUrl, encodeModelForUrl } from './query-model';
import { deepModel } from './query-share-deep.fixture';
import { shareLinkFor } from './short-links';

// Measured with these fixtures (see STORY-259): 4 levels / 5 columns ≈ 2.5k, 6 levels / 6 columns ≈ 3.4k and
// 6 levels / 10 columns ≈ 4.2k characters against the 4000-character cap.
describe('share links for deep object-browser queries', () => {
	it('a 6-level path with 6 columns still fits one share link and round-trips', () => {
		const r = encodeModelForUrl(deepModel(6));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.param.length).toBeLessThan(MAX_SHARE_PARAM_LENGTH);
		expect(decodeModelFromUrl(r.param)).toMatchObject({ ok: true });
	});

	it('a 6-level path with 10 long-IRI columns no longer fits ?m=, so a short link is requested (STORY-261)', () => {
		const model = deepModel(10);
		expect(encodeModelForUrl(model)).toEqual({ ok: false, error: expect.stringContaining('save it first') });
		expect(shareLinkFor('https://app.test', model)).toEqual({ kind: 'short' });
		// Creating and resolving the short link is covered in routes/api/shared-queries/shared-queries.spec.ts.
	});
});
