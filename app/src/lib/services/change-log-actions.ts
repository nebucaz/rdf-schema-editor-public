/**
 * Writing a change log entry after an edit (ontology-pipeline STORY-331). The edit has already happened, so a
 * failing log write must not look like a failed edit: it comes back as a message for the caller to show.
 */
import type { ChangeLogEntryInput } from './change-log';
import { postChangeLogEntry } from './changelog-client';

/** `null` when the entry was recorded, else the message to show. */
export async function recordChange(
	entry: ChangeLogEntryInput,
	fetchFn: typeof fetch = (...args) => fetch(...args)
): Promise<string | null> {
	const rationale = entry.rationale?.trim();
	try {
		await postChangeLogEntry(fetchFn, { ...entry, rationale: rationale || undefined });
		return null;
	} catch (e) {
		return `Saved, but the change log entry failed: ${e instanceof Error ? e.message : 'unknown error'}`;
	}
}
