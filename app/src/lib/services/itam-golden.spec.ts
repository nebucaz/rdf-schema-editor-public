import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ITAM_GOLDEN_PATH, buildValidationSnapshot, loadItamQuads, serializeGolden } from './itam-golden-support';

/** The committed snapshot the Go engine test runs over (`backend/internal/validation/itam_golden_test.go`). */
describe('ITAM golden snapshot (STORY-353)', () => {
	const file = fileURLToPath(new URL(`../../../../${ITAM_GOLDEN_PATH}`, import.meta.url));

	// `bun run shacl:golden` sets this to rewrite the committed file (bun cannot resolve the `#lib/*` imports, so no script).
	if (process.env.UPDATE_ITAM_GOLDEN) {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, serializeGolden(buildValidationSnapshot(loadItamQuads())));
	}

	it('is up to date with the example Turtle (run `bun run shacl:golden` when this fails)', () => {
		expect(readFileSync(file, 'utf8')).toBe(serializeGolden(buildValidationSnapshot(loadItamQuads())));
	});

	it('carries the six rules, their rule ids and the 23 records', () => {
		const snap = buildValidationSnapshot(loadItamQuads());
		const app = 'https://lida.pnet.ch/arm/schema#Applikationskomponente';
		expect(new Set(snap.ownConstraints[app].map((c) => c.ruleId))).toEqual(
			new Set(['AC-TECHID-EXIST', 'AC-TECHID-FORMAT'])
		);
		expect(Object.keys(snap.individualTypes)).toHaveLength(23);
		const exists = snap.ownConstraints[app].find((c) => c.ruleId === 'AC-TECHID-EXIST')!;
		expect(snap.sparqlConstraints).toHaveLength(5);
		expect(snap.sparqlConstraints.every((c) => c.targetClass === app && c.select.includes('$this') && c.message !== '')).toBe(true);
		expect(exists).toMatchObject({ minCount: 1, minLength: 1, message: 'Technische ID fehlt.' });
	});
});
