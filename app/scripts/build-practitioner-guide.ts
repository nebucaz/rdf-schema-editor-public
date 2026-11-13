/** Writes `docs/ontology-pipeline-practitioner-guide.md` from the in-app documentation (process-description STORY-347).
 *  Run from `app/`: `bun run docs:guide`. A Vitest spec fails when the committed file is out of date. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildPractitionerGuide, PRACTITIONER_GUIDE_PATH } from '../src/lib/content/docs/practitioner-guide.ts';

const docsDir = resolve(import.meta.dirname, '../src/lib/content/docs');
const target = resolve(import.meta.dirname, '../..', PRACTITIONER_GUIDE_PATH);

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, buildPractitionerGuide((file) => readFileSync(resolve(docsDir, file), 'utf8')));
console.log(`Wrote ${PRACTITIONER_GUIDE_PATH}`);
