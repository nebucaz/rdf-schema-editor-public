/**
 * Pure model behind the object browser (object-browser, STORY-251): what each pane lists and which
 * links may be followed. A browse path is an anchor (an existing group, or a start class while no query
 * exists) plus the relationship steps drilled through so far. Validity is decided only by
 * `canExtendPath`, evaluated against the saved hops *plus the hops earlier in the path that do not
 * exist yet* (virtual hops), so the cycle rule applies to deep paths. A step that equals an existing
 * hop is reused, never duplicated. No UI, store or GraphDB access.
 */
import type { BuilderSchema } from './query-builder-schema';
import { buildColumnGroups } from './query-column-groups';
import { columnChoices, startClassOptions, type ColumnChoice } from './query-add-column';
import {
	canExtendPath,
	emptyQueryModel,
	type ColumnSource,
	type Hop,
	type QueryModel
} from './query-model';
import { addColumn, addHop, findColumn, removeColumn, startQueryFromClass } from './query-model-edit';
import { extractLocalName } from '../utils/iri';
import type { ClassOption } from '../utils/query-class-picker';

/** One relationship followed from a class: forward to its range, or inverse to its declaring class. */
export interface BrowseStep {
	relationshipIri: string;
	direction: Hop['direction'];
	targetClassIri: string;
}

export interface BrowsePath {
	/** An existing group (`hopId: null` = the root), or the start class while there is no query yet. */
	anchor: { hopId: string | null } | { startClassIri: string };
	steps: BrowseStep[];
}

/** Hops past which the browser shows a soft warning (Q7); nothing is blocked by depth. */
export const DEEP_PATH_THRESHOLD = 4;

export type RootPane =
	| { mode: 'start'; options: ClassOption[] }
	| {
			mode: 'groups';
			groups: { hopId: string | null; classIri: string; label: string; viaLabel: string | null; depth: number }[];
	  };

/** Pane 1: every class (namespace-filterable) without a query, otherwise the query's own groups. */
export function rootPane(
	model: QueryModel | null,
	schema: BuilderSchema,
	namespaces: { baseIri: string; prefix: string }[],
	namespaceBaseIri: string | null
): RootPane {
	if (!model) return { mode: 'start', options: startClassOptions(schema, namespaces, namespaceBaseIri) };
	return {
		mode: 'groups',
		groups: buildColumnGroups(model, schema).map((g) => ({
			hopId: g.hopId,
			classIri: g.classIri,
			label: g.label,
			viaLabel: g.viaLabel,
			depth: g.depth
		}))
	};
}

/** A property row of a class pane, with the id of the column that already shows it (if any). */
export interface PaneColumn extends ColumnChoice {
	existingColumnId: string | null;
}

/** A relationship row of a class pane: opens the pane of its target class. */
export interface PaneLink {
	step: BrowseStep;
	label: string;
	targetLabel: string;
	/** Why the link cannot be followed; `null` = openable. */
	disabledReason: string | null;
	/** The hop this step already is, so the browser reuses it instead of adding a duplicate. */
	existingHopId: string | null;
}

export interface ClassPane {
	classIri: string;
	label: string;
	columns: PaneColumn[];
	links: PaneLink[];
	/** `Referenced by` section: relationships of other classes that point at this one. */
	inbound: PaneLink[];
	/** Hops between the root and this class, including the ones the path would add. */
	depth: number;
	/** More than `DEEP_PATH_THRESHOLD` hops: long paths slow queries and lengthen share links. */
	deep: boolean;
}

export interface ResolvedPath {
	/** The input model with the path's missing hops added. */
	model: QueryModel;
	/** Hop the path ends on (`null` = the root). */
	hopId: string | null;
	classIri: string;
	/** Ids of hops the path created; the rest already existed. */
	createdHopIds: string[];
}

/**
 * Walks `path`, reusing an existing hop for each step or adding one. `null` when a step is rejected
 * by `canExtendPath` (or the anchor hop does not exist), so a caller can leave the model untouched.
 */
export function resolvePath(model: QueryModel | null, path: BrowsePath): ResolvedPath | null {
	let working: QueryModel;
	let hopId: string | null;
	let classIri: string;
	if ('startClassIri' in path.anchor) {
		working = model ?? emptyQueryModel(path.anchor.startClassIri, []);
		hopId = null;
		classIri = working.root.classIri;
	} else {
		if (!model) return null;
		working = model;
		hopId = path.anchor.hopId;
		const anchorHop = hopId === null ? null : model.hops.find((h) => h.id === hopId);
		if (hopId !== null && !anchorHop) return null;
		classIri = anchorHop ? anchorHop.targetClassIri : model.root.classIri;
	}
	const createdHopIds: string[] = [];
	for (const step of path.steps) {
		const existing = findHop(working, hopId, step);
		if (existing) {
			hopId = existing.id;
		} else {
			const next = addHop(
				working,
				hopId,
				{ iri: step.relationshipIri, targetClassIri: step.targetClassIri },
				step.direction
			);
			if (next === working) return null;
			working = next;
			hopId = working.hops[working.hops.length - 1].id;
			createdHopIds.push(hopId);
		}
		classIri = step.targetClassIri;
	}
	return { model: working, hopId, classIri, createdHopIds };
}

/**
 * Steps from group `hopId` (`null` = root) down to its deepest descendant that already has columns, so a
 * reopened browser shows existing columns expanded instead of hiding them behind chevrons. Ties go to the
 * first hop in model order; no such descendant yields no steps.
 */
export function revealSteps(model: QueryModel, hopId: string | null): BrowseStep[] {
	const withColumns = new Set(model.columns.map((c) => c.hopId));
	let best: BrowseStep[] = [];
	const walk = (parent: string | null, trail: BrowseStep[]) => {
		for (const h of model.hops) {
			if (h.parentHopId !== parent) continue;
			const next = [...trail, { relationshipIri: h.propertyIri, direction: h.direction, targetClassIri: h.targetClassIri }];
			if (withColumns.has(h.id) && next.length > best.length) best = next;
			walk(h.id, next);
		}
	};
	walk(hopId, []);
	return best;
}

function findHop(model: QueryModel, parentHopId: string | null, step: BrowseStep): Hop | undefined {
	return model.hops.find(
		(h) =>
			h.parentHopId === parentHopId &&
			h.propertyIri === step.relationshipIri &&
			h.direction === step.direction &&
			h.targetClassIri === step.targetClassIri
	);
}

function hopDepth(model: QueryModel, hopId: string | null): number {
	const byId = new Map(model.hops.map((h) => [h.id, h]));
	let depth = 0;
	for (let id = hopId; id !== null && depth <= model.hops.length; depth++) id = byId.get(id)?.parentHopId ?? null;
	return depth;
}

/**
 * Contents of the pane for the class `path` ends on. A path that cannot be resolved (or a class the
 * schema no longer declares) yields an empty pane, never an error.
 */
export function classPane(model: QueryModel | null, schema: BuilderSchema, path: BrowsePath): ClassPane {
	const resolved = resolvePath(model, path);
	if (!resolved) return emptyPane(path.steps.at(-1)?.targetClassIri ?? '');
	const { classIri } = resolved;
	const cls = schema.classes.get(classIri);
	if (!cls) return emptyPane(classIri);

	const work = resolved.model;
	const hopId = resolved.hopId;
	const depth = hopDepth(work, hopId);
	const link = (step: BrowseStep, label: string, targetLabel: string, reason: string): PaneLink => {
		const existing = findHop(work, hopId, step);
		const ok = existing || canExtendPath(work, hopId, step.relationshipIri, step.direction, step.targetClassIri);
		return {
			step,
			label,
			targetLabel,
			disabledReason: ok ? null : reason,
			existingHopId: existing?.id ?? null
		};
	};
	const byLabel = (a: PaneLink, b: PaneLink) => a.label.localeCompare(b.label);

	return {
		classIri,
		label: cls.label,
		columns: columnChoices(cls).map((c) => ({
			...c,
			existingColumnId: hopId !== null && resolved.createdHopIds.includes(hopId)
				? null
				: (findColumn(work, hopId, c.source)?.id ?? null)
		})),
		links: cls.relationships
			.map((r) =>
				link(
					{ relationshipIri: r.iri, direction: 'forward', targetClassIri: r.targetClassIri },
					r.label,
					r.targetLabel || extractLocalName(r.targetClassIri),
					`Already expanded here or on this path (${r.label})`
				)
			)
			.sort(byLabel),
		inbound: cls.inboundRelationships
			.map((r) =>
				link(
					{ relationshipIri: r.iri, direction: 'inverse', targetClassIri: r.sourceClassIri },
					r.displayLabel,
					r.sourceLabel,
					`Already expanded here, or on this path, or would undo the previous step (${r.label})`
				)
			)
			.sort(byLabel),
		depth,
		deep: depth > DEEP_PATH_THRESHOLD
	};
}

function emptyPane(classIri: string): ClassPane {
	return {
		classIri,
		label: classIri ? extractLocalName(classIri) : '',
		columns: [],
		links: [],
		inbound: [],
		depth: 0,
		deep: false
	};
}

/** One ticked property (or Label/IRI) at the end of a browse path. */
export interface BrowserPick {
	path: BrowsePath;
	source: ColumnSource;
	/** Default header of the column the pick creates. */
	header: string;
}

export type SelectionResult =
	| { ok: true; model: QueryModel }
	/** `model` is the untouched input; `failedPick` indexes the pick whose path `canExtendPath` rejects. */
	| { ok: false; model: QueryModel | null; failedPick: number };

/**
 * Folds a whole browser selection into one model value: every pick adds its missing hops (existing
 * equal hops are reused, hops without a column stay as join paths) and its column, then `removeColumnIds`
 * are dropped with their sort/rule/measure ties. All or nothing: a rejected path leaves the input as it was.
 * With no `model`, the picks' shared `startClassIri` becomes the root of a new query.
 */
export function applyBrowserSelection(
	model: QueryModel | null,
	picks: readonly BrowserPick[],
	removeColumnIds: readonly string[] = [],
	opts: { namespaces?: string[] } = {}
): SelectionResult {
	if (picks.length === 0 && removeColumnIds.length === 0 && model) return { ok: true, model };
	let working = model;
	for (const [i, pick] of picks.entries()) {
		if (!working) {
			if (!('startClassIri' in pick.path.anchor)) return { ok: false, model, failedPick: i };
			working = startQueryFromClass(pick.path.anchor.startClassIri, opts.namespaces ?? []);
		} else if ('startClassIri' in pick.path.anchor && pick.path.anchor.startClassIri !== working.root.classIri) {
			return { ok: false, model, failedPick: i };
		}
		const resolved = resolvePath(working, pick.path);
		if (!resolved) return { ok: false, model, failedPick: i };
		working = addColumn(resolved.model, { hopId: resolved.hopId, source: pick.source, header: pick.header });
	}
	if (!working) return { ok: false, model, failedPick: 0 };
	return { ok: true, model: removeColumnIds.reduce((m, id) => removeColumn(m, id), working) };
}

export interface BrowserSearchResult {
	kind: 'property' | 'link';
	/** Path to the class whose pane holds the match. */
	path: BrowsePath;
	/** The matching link (`kind: 'link'`); open `path` plus this step to land on its target class. */
	step: BrowseStep | null;
	/** The matching property (`kind: 'property'`). */
	propertyIri: string | null;
	/** Class and relationship labels along the path, ending in the matched property or link. */
	breadcrumb: string[];
	/** Set when the cycle rule rejects the matched link; shown, not choosable. */
	disabledReason: string | null;
}

export interface BrowserSearchOptions {
	/** Relationship steps searched below each group; default 4. Ignored (0) without a query. */
	maxDepth?: number;
	/** Results returned; default 50. */
	limit?: number;
}

/** Upper bound on panes visited, so a large, densely linked schema stays responsive. */
const SEARCH_NODE_CAP = 3000;

/**
 * Case-insensitive search over property labels and link labels / target class labels, breadth first from
 * the query's groups (each group is its own anchor, so a path equal to an existing hop is found from that
 * hop, not twice). Without a query every class is a start class and only its own panes are searched.
 * Cycle-safe: only links `canExtendPath` allows are followed, and `maxDepth` bounds the rest.
 * Ordered by path length, then breadcrumb; `more` says the limit cut results off.
 */
export function searchBrowserTree(
	model: QueryModel | null,
	schema: BuilderSchema,
	query: string,
	opts: BrowserSearchOptions = {}
): { results: BrowserSearchResult[]; more: boolean } {
	const needle = query.trim().toLowerCase();
	if (!needle) return { results: [], more: false };
	const maxDepth = model ? (opts.maxDepth ?? 4) : 0;
	const limit = opts.limit ?? 50;
	const hit = (text: string) => text.toLowerCase().includes(needle);

	interface Node {
		path: BrowsePath;
		crumbs: string[];
	}
	let queue: Node[] = model
		? [null, ...model.hops.map((h) => h.id)].flatMap((hopId) => {
				const classIri = hopId === null ? model.root.classIri : model.hops.find((h) => h.id === hopId)!.targetClassIri;
				const label = schema.classes.get(classIri)?.label ?? extractLocalName(classIri);
				return [{ path: { anchor: { hopId }, steps: [] } as BrowsePath, crumbs: [label] }];
			})
		: [...schema.classes.values()]
				.sort((a, b) => a.label.localeCompare(b.label))
				.map((c) => ({ path: { anchor: { startClassIri: c.iri }, steps: [] } as BrowsePath, crumbs: [c.label] }));

	const results: BrowserSearchResult[] = [];
	let visited = 0;
	while (queue.length > 0 && visited < SEARCH_NODE_CAP) {
		const next: Node[] = [];
		for (const { path, crumbs } of queue) {
			if (visited++ >= SEARCH_NODE_CAP) break;
			const pane = classPane(model, schema, path);
			for (const c of pane.columns) {
				if (typeof c.source !== 'object' || !hit(c.name)) continue;
				results.push({
					kind: 'property',
					path,
					step: null,
					propertyIri: c.source.propertyIri,
					breadcrumb: [...crumbs, c.name],
					disabledReason: null
				});
			}
			for (const l of [...pane.links, ...pane.inbound]) {
				if (hit(l.label) || hit(l.targetLabel)) {
					results.push({
						kind: 'link',
						path,
						step: l.step,
						propertyIri: null,
						breadcrumb: [...crumbs, l.label, l.targetLabel],
						disabledReason: l.disabledReason
					});
				}
				// An existing hop is its own anchor, so it is searched from there rather than twice.
				if (l.disabledReason !== null || l.existingHopId !== null || path.steps.length >= maxDepth) continue;
				next.push({
					path: { anchor: path.anchor, steps: [...path.steps, l.step] },
					crumbs: [...crumbs, l.label, l.targetLabel]
				});
			}
		}
		queue = next;
	}
	results.sort(
		(a, b) => a.path.steps.length - b.path.steps.length || a.breadcrumb.join(' ').localeCompare(b.breadcrumb.join(' '))
	);
	return { results: results.slice(0, limit), more: results.length > limit };
}

/**
 * Class and link labels along `path` (`Employee › worksFor › Organization`), for the selected-columns
 * summary and search results. Unknown ids fall back to local names, never throw.
 */
export function pathBreadcrumb(model: QueryModel | null, schema: BuilderSchema, path: BrowsePath): string[] {
	const label = (iri: string) => schema.classes.get(iri)?.label ?? extractLocalName(iri);
	let classIri: string;
	if ('startClassIri' in path.anchor) classIri = path.anchor.startClassIri;
	else {
		const hopId = path.anchor.hopId;
		classIri = hopId === null ? (model?.root.classIri ?? '') : (model?.hops.find((h) => h.id === hopId)?.targetClassIri ?? '');
	}
	const crumbs = [label(classIri)];
	for (const step of path.steps) {
		const cls = schema.classes.get(classIri);
		const linkLabel =
			step.direction === 'forward'
				? cls?.relationships.find((r) => r.iri === step.relationshipIri && r.targetClassIri === step.targetClassIri)?.label
				: cls?.inboundRelationships.find((r) => r.iri === step.relationshipIri && r.sourceClassIri === step.targetClassIri)
						?.displayLabel;
		crumbs.push(linkLabel ?? extractLocalName(step.relationshipIri), label(step.targetClassIri));
		classIri = step.targetClassIri;
	}
	return crumbs;
}
