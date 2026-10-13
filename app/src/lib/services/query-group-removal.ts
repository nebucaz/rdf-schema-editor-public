/**
 * What removing a column group takes with it (workbench-columns, STORY-241). Pure: the counts are the
 * difference between the model and `removeHop(model, hopId)`, so the confirmation shown to the analyst
 * can never disagree with what the edit actually drops.
 */
import { removeHop } from './query-model-edit';
import type { QueryModel } from './query-model';

export interface GroupRemovalSummary {
	/** Why the group cannot be removed (the root while child groups exist); `null` = allowed. */
	blockedReason: string | null;
	/** Groups removed: the group itself plus its descendants. */
	groups: number;
	columns: number;
	filters: number;
	sortKeys: number;
	/** Measures dropped (sum/avg/min/max over a removed column; count measures fall back to the entity). */
	measures: number;
}

/** `hopId` `null` = the root group. */
export function groupRemovalSummary(model: QueryModel, hopId: string | null): GroupRemovalSummary {
	if (hopId === null) {
		return {
			blockedReason:
				model.hops.length > 0
					? 'The first class cannot be removed while other groups depend on it — remove the groups below it first.'
					: null,
			groups: 1,
			columns: 0,
			filters: 0,
			sortKeys: 0,
			measures: 0
		};
	}
	const after = removeHop(model, hopId);
	return {
		blockedReason: null,
		groups: model.hops.length - after.hops.length,
		columns: model.columns.length - after.columns.length,
		filters: model.filters.length - after.filters.length,
		sortKeys: model.sort.length - after.sort.length,
		measures: (model.aggregation?.measures.length ?? 0) - (after.aggregation?.measures.length ?? 0)
	};
}

/** Whether removal drops anything beyond the group's (and its descendants') bare columns. */
export function isDestructive(s: GroupRemovalSummary): boolean {
	return s.groups > 1 || s.columns > 0 || s.filters > 0 || s.sortKeys > 0 || s.measures > 0;
}
