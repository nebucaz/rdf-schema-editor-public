import { sparqlConnector, type FetchedSavedQuery } from '$lib/services/sparql-connector';
import type { BuilderSchema } from '$lib/services/query-builder-schema';
import { compileUnpagedQuery } from '$lib/services/query-compiler';
import { serializeQueryModel, validateRunnableQueryModel, type QueryModel } from '$lib/services/query-model';
import {
	saveDisabledReason,
	toSavedQueryItem,
	type SavedQueryItem,
	type WorkbenchUser
} from '$lib/services/saved-queries';

/** The slice of `SparqlConnector` this store needs — keeps it testable without GraphDB. */
export interface SavedQueryStorage {
	fetchSavedQueries(): Promise<FetchedSavedQuery[]>;
	insertSavedQuery(
		name: string,
		sparqlText: string,
		description?: string,
		workbench?: { queryModelJson: string; createdBy: string }
	): Promise<string>;
	renameSavedQuery(iri: string, newName: string): Promise<void>;
	deleteSavedQuery(iri: string): Promise<void>;
}

/**
 * Saved-query list for the Query Workbench landing page (STORY-195). Storage is the same
 * SavedQuery resources the SPARQL console uses (STORY-088), so legacy queries show up here too.
 */
export class SavedQueriesStore {
	items = $state<SavedQueryItem[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);

	private user: WorkbenchUser | null = null;
	private readonly storage: SavedQueryStorage;

	constructor(storage: SavedQueryStorage = sparqlConnector) {
		this.storage = storage;
	}

	async load(user: WorkbenchUser | null = this.user): Promise<void> {
		this.user = user;
		this.loading = true;
		try {
			const all = await this.storage.fetchSavedQueries();
			this.items = all
				.map((sq) => toSavedQueryItem(sq, user))
				.sort((a, b) => a.label.localeCompare(b.label));
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Failed to load saved queries';
		} finally {
			this.loading = false;
		}
	}

	/** Returns whether the query was stored; on failure `error` says why. */
	async save(args: {
		name: string;
		description?: string;
		model: QueryModel;
		schema: BuilderSchema;
		user: WorkbenchUser | null;
	}): Promise<boolean> {
		this.error = null;
		const runnable =
			validateRunnableQueryModel(args.model, new Set(args.schema.classes.keys())).length === 0;
		const reason = saveDisabledReason(args.user, runnable);
		if (reason || !args.user) {
			this.error = reason ?? 'Saving needs a user identity';
			return false;
		}
		try {
			await this.storage.insertSavedQuery(
				args.name,
				// A snapshot of the SPARQL at save time; the model JSON (which keeps any relative time) is
				// what a saved query re-runs from.
				compileUnpagedQuery(args.model, args.schema, { now: new Date() }),
				args.description?.trim() || undefined,
				{ queryModelJson: serializeQueryModel(args.model), createdBy: args.user.sub }
			);
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Failed to save the query';
			return false;
		}
		await this.load(args.user);
		return true;
	}

	async rename(iri: string, newName: string): Promise<boolean> {
		this.error = null;
		try {
			await this.storage.renameSavedQuery(iri, newName);
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Failed to rename the query';
			return false;
		}
		await this.load();
		return true;
	}

	async remove(iri: string): Promise<boolean> {
		this.error = null;
		try {
			await this.storage.deleteSavedQuery(iri);
		} catch (e) {
			this.error = e instanceof Error ? e.message : 'Failed to delete the query';
			return false;
		}
		await this.load();
		return true;
	}
}

export const savedQueriesStore = new SavedQueriesStore();
