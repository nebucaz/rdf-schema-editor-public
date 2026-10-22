import { sparqlConnector } from '$lib/services/sparql-connector';
import { buildBuilderSchema, type BuilderSchema } from '$lib/services/query-builder-schema';
import type { QueryModel, ColumnSource, Filter, Having, Measure } from '$lib/services/query-model';
import type { ColumnRule } from '$lib/services/column-rules';
import { addRule, removeRule, moveRuleWithinColumn, updateRule } from '$lib/services/column-rules-editor';
import {
	applyBrowserSelection as foldBrowserSelection,
	type BrowserPick
} from '$lib/services/query-object-browser';
import {
	startQueryFromClass,
	startQueryFromSearchHit,
	setIncludeSubclasses,
	addColumn,
	addHop,
	upsertFilter,
	removeFilter,
	groupFilters,
	ungroupFilters,
	removeFromGroup,
	moveColumn,
	setColumnHeader,
	setSort,
	removeSort,
	cycleSort,
	moveSort,
	enableAggregation,
	disableAggregation,
	toggleGroupBy,
	addMeasure,
	removeMeasure,
	addHaving,
	removeHaving,
	setLimit,
	removeHop,
	removeColumn,
	hasColumn,
	findColumn
} from '$lib/services/query-model-edit';

/**
 * Query Workbench builder state (STORY-188): the `BuilderSchema` discovered from the graph and the
 * `QueryModel` being edited. Every model change goes through the pure helpers in
 * `query-model-edit.ts`; this class only holds the current value and the loading lifecycle.
 */
export class QueryBuilderStore {
	schema = $state<BuilderSchema | null>(null);
	schemaLoading = $state(false);
	schemaError = $state<string | null>(null);
	model = $state<QueryModel | null>(null);

	async loadSchema(): Promise<void> {
		this.schemaLoading = true;
		this.schemaError = null;
		try {
			this.schema = buildBuilderSchema(await sparqlConnector.fetchFullSchemaForAllNamespaces());
		} catch (e) {
			this.schemaError = e instanceof Error ? e.message : 'Failed to load the schema';
		} finally {
			this.schemaLoading = false;
		}
	}

	startFromClass(classIri: string, namespaces: string[]): void {
		this.model = startQueryFromClass(classIri, namespaces);
	}

	/**
	 * Add/Edit-column dialog: folds the object browser's whole selection (new hops, ticked columns and
	 * unticked existing ones) into the model as one assignment. `false` — and the model untouched — when a
	 * picked path is rejected. `namespaces` scope a query started from a start-class pick.
	 */
	applyBrowserSelection(
		picks: readonly BrowserPick[],
		removeColumnIds: readonly string[],
		namespaces: string[]
	): boolean {
		const result = foldBrowserSelection(this.model, picks, removeColumnIds, { namespaces });
		if (!result.ok) return false;
		this.model = result.model;
		return true;
	}

	startFromSearchHit(
		hit: { classIri: string; iri: string; label: string },
		namespaces: string[]
	): void {
		this.model = startQueryFromSearchHit(hit, namespaces);
	}

	/** Replaces the model with one restored from a saved query (STORY-195). */
	load(model: QueryModel): void {
		this.model = model;
	}

	close(): void {
		this.model = null;
	}

	setIncludeSubclasses(include: boolean): void {
		if (this.model) this.model = setIncludeSubclasses(this.model, include);
	}

	hasColumn(hopId: string | null, source: ColumnSource): boolean {
		return this.model ? hasColumn(this.model, hopId, source) : false;
	}

	/**
	 * `parentHopId` null = from the root. A relationship `canExtendPath` rejects is ignored. For an
	 * `inverse` expansion `targetClassIri` is the class that declares the relationship.
	 */
	expand(
		parentHopId: string | null,
		relationship: { iri: string; targetClassIri: string },
		direction: 'forward' | 'inverse' = 'forward'
	): void {
		if (this.model) this.model = addHop(this.model, parentHopId, relationship, direction);
	}

	removeHop(hopId: string): void {
		if (this.model) this.model = removeHop(this.model, hopId);
	}

	/** Adds a filter, or edits the existing one for the same hop+property. */
	setFilter(draft: Omit<Filter, 'id'>): void {
		if (this.model) this.model = upsertFilter(this.model, draft);
	}

	removeFilter(filterId: string): void {
		if (this.model) this.model = removeFilter(this.model, filterId);
	}

	/** Makes the filters one "any of" group (STORY-232). */
	groupFilters(filterIds: string[]): void {
		if (this.model) this.model = groupFilters(this.model, filterIds);
	}

	ungroupFilters(groupId: string): void {
		if (this.model) this.model = ungroupFilters(this.model, groupId);
	}

	removeFromGroup(filterId: string): void {
		if (this.model) this.model = removeFromGroup(this.model, filterId);
	}

	// Thin wrappers so components never reassign `model` themselves (STORY-191).
	private edit(fn: (m: QueryModel) => QueryModel): void {
		if (this.model) this.model = fn(this.model);
	}
	removeColumn(columnId: string): void {
		this.edit((m) => removeColumn(m, columnId));
	}
	moveColumn(columnId: string, delta: -1 | 1): void {
		this.edit((m) => moveColumn(m, columnId, delta));
	}
	setColumnHeader(columnId: string, header: string): void {
		this.edit((m) => setColumnHeader(m, columnId, header));
	}
	setSort(columnId: string, direction: 'asc' | 'desc'): void {
		this.edit((m) => setSort(m, columnId, direction));
	}
	cycleSort(columnId: string): void {
		this.edit((m) => cycleSort(m, columnId));
	}
	removeSort(columnId: string): void {
		this.edit((m) => removeSort(m, columnId));
	}
	moveSort(columnId: string, delta: -1 | 1): void {
		this.edit((m) => moveSort(m, columnId, delta));
	}
	setAggregated(on: boolean): void {
		this.edit((m) => (on ? enableAggregation(m) : disableAggregation(m)));
	}
	toggleGroupBy(columnId: string): void {
		this.edit((m) => toggleGroupBy(m, columnId));
	}
	addMeasure(fn: Measure['fn'], of: string): void {
		this.edit((m) => addMeasure(m, fn, of));
	}
	removeMeasure(alias: string): void {
		this.edit((m) => removeMeasure(m, alias));
	}
	addHaving(having: Having): void {
		this.edit((m) => addHaving(m, having));
	}
	removeHaving(index: number): void {
		this.edit((m) => removeHaving(m, index));
	}
	/** `null` clears the row cap. */
	setLimit(limit: number | null): void {
		this.edit((m) => setLimit(m, limit));
	}

	// Column colour rules (STORY-197); order is meaningful (first match wins).
	addRule(rule: ColumnRule): void {
		this.edit((m) => ({ ...m, columnRules: addRule(m.columnRules, rule) }));
	}
	updateRule(index: number, rule: ColumnRule): void {
		this.edit((m) => ({ ...m, columnRules: updateRule(m.columnRules, index, rule) }));
	}
	removeRule(index: number): void {
		this.edit((m) => ({ ...m, columnRules: removeRule(m.columnRules, index) }));
	}
	moveRule(index: number, delta: -1 | 1): void {
		this.edit((m) => ({ ...m, columnRules: moveRuleWithinColumn(m.columnRules, index, delta) }));
	}

	/** Ticking a property adds its column; unticking removes it. */
	toggleColumn(hopId: string | null, source: ColumnSource, header: string): void {
		if (!this.model) return;
		const existing = findColumn(this.model, hopId, source);
		this.model = existing
			? removeColumn(this.model, existing.id)
			: addColumn(this.model, { hopId, source, header });
	}
}

export const queryBuilderStore = new QueryBuilderStore();
