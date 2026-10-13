/**
 * Pure view-model helpers for the workbench's saved-query list (STORY-195): classifying stored
 * queries (builder vs. legacy raw SPARQL), the "Created by me" filter, the Save gate, and turning a
 * stored query back into something the workbench can open. No GraphDB access.
 */
import type { FetchedSavedQuery } from './sparql-connector';
import { parseQueryModel, type QueryModel } from './query-model';

export interface WorkbenchUser {
	sub: string;
	displayName: string;
}

export interface SavedQueryItem {
	iri: string;
	label: string;
	description: string;
	/** `builder` = has a stored model; `sparql` = legacy raw SPARQL (spec/sparql STORY-088). */
	kind: 'builder' | 'sparql';
	/** Display name for the current user, the raw `createdBy` sub for anyone else, '' for legacy. */
	creator: string;
	mine: boolean;
	queryModel?: string;
	sparqlText: string;
}

export type OpenedSavedQuery =
	| { kind: 'builder'; model: QueryModel }
	| { kind: 'sparql'; text: string }
	| { kind: 'error'; message: string };

export function toSavedQueryItem(sq: FetchedSavedQuery, user: WorkbenchUser | null): SavedQueryItem {
	const mine = !!user && !!sq.createdBy && sq.createdBy === user.sub;
	return {
		iri: sq.iri,
		label: sq.label,
		description: sq.description,
		kind: sq.queryModel ? 'builder' : 'sparql',
		creator: mine ? user!.displayName : (sq.createdBy ?? ''),
		mine,
		queryModel: sq.queryModel,
		sparqlText: sq.sparqlText
	};
}

export function filterCreatedByMe(items: SavedQueryItem[], onlyMine: boolean): SavedQueryItem[] {
	return onlyMine ? items.filter((i) => i.mine) : items;
}

/** Why Save must be disabled, or `null` when it may proceed. */
export function saveDisabledReason(user: WorkbenchUser | null, runnable: boolean): string | null {
	if (!user) return 'Saving needs a user identity — sign in (no user token is configured).';
	if (!runnable) return 'Complete the query so it can run before saving it.';
	return null;
}

export function openSavedQuery(item: SavedQueryItem): OpenedSavedQuery {
	if (item.kind === 'sparql') return { kind: 'sparql', text: item.sparqlText };
	const parsed = parseQueryModel(item.queryModel ?? '');
	return parsed.ok
		? { kind: 'builder', model: parsed.model }
		: { kind: 'error', message: `Cannot open "${item.label}": ${parsed.error}` };
}
