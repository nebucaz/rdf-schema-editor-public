import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_NAMESPACE_BASE_IRI } from '../config';
import { runGolden, type GoldenInput, type GoldenResult } from './annotation-golden-support';

// Shared with the Go suite (backend/internal/annotations): the fixture records the exact operation
// sequence `addAnnotation`/`deleteAnnotation` issue for scripted graph states, and Go must match it.
const golden = JSON.parse(
	readFileSync(new URL('../../../../backend/testdata/golden/annotations.json', import.meta.url), 'utf8')
) as { defaultNamespaceBaseIri: string; cases: (GoldenInput & { expected: GoldenResult })[] };

describe('annotation golden vectors shared with the Go backend', () => {
	it('were recorded against the default namespace the tests run with', () => {
		expect(DEFAULT_NAMESPACE_BASE_IRI).toBe(golden.defaultNamespaceBaseIri);
	});

	it.each(golden.cases)('$name', async (c) => {
		expect(await runGolden(c)).toEqual(c.expected);
	});
});
