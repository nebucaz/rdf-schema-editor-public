import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The finding id is derived only by the backend (`validation.FindingID`, checked by `go test`); the
 * frontend never recomputes it. This spec keeps the shared vectors well-formed so that a hand edit
 * of the fixture cannot drift unnoticed (spec/validation-issues-tracker STORY-381).
 */
const raw = readFileSync(fileURLToPath(new URL('../../../../backend/testdata/golden/finding-id.json', import.meta.url)), 'utf8');
const vectors: { name: string; id: string; violation: { id: string } }[] = JSON.parse(raw).vectors;

describe('finding-id golden vectors', () => {
	it('has vectors', () => {
		expect(vectors.length).toBeGreaterThanOrEqual(3);
	});

	it('uses 16 lowercase base32 characters', () => {
		for (const v of vectors) expect(v.id, v.name).toMatch(/^[a-z2-7]{16}$/);
	});

	it('is unique per vector and repeated on the violation', () => {
		expect(new Set(vectors.map((v) => v.id)).size).toBe(vectors.length);
		for (const v of vectors) expect(v.violation.id).toBe(v.id);
	});
});
