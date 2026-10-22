/**
 * Pure helpers behind the add-column dialog: which start classes the first pane offers and which
 * properties a class offers as columns (workbench-columns, STORY-238). Relationship steps and how a
 * selection changes the model live in `query-object-browser.ts` (object-browser). No UI, store or
 * GraphDB access.
 */
import type { BuilderClass, BuilderSchema } from './query-builder-schema';
import type { ColumnSource, QueryModel } from './query-model';
import { addColumn, startQueryFromClass } from './query-model-edit';
import { classOptions, type ClassOption } from '../utils/query-class-picker';

/** Options for the first step: every class (`prefix:Name`), or only those of one namespace. */
export function startClassOptions(
	schema: BuilderSchema,
	namespaces: { baseIri: string; prefix: string }[],
	namespaceBaseIri: string | null
): ClassOption[] {
	return classOptions(schema, namespaces, namespaceBaseIri);
}

/** One thing the modal lets the analyst tick: an identity column or a property of the chosen class. */
export interface ColumnChoice {
	source: ColumnSource;
	/** Default header of the column the choice creates. */
	header: string;
	/** What the choice reads from (`Label`, `IRI` or the property's label). */
	name: string;
	/** Property datatype IRI; absent for the identity columns. */
	datatype?: string;
	/** The property is restricted to a fixed list of values. */
	enumeration?: boolean;
}

/** Label and IRI identity columns first, then the class' properties, in schema order. */
export function columnChoices(cls: BuilderClass): ColumnChoice[] {
	return [
		{ source: 'label', header: cls.label, name: 'Label' },
		{ source: 'iri', header: `${cls.label} IRI`, name: 'IRI' },
		...cls.properties.map((p) => ({
			source: { propertyIri: p.iri } as ColumnSource,
			header: p.label,
			name: p.label,
			datatype: p.datatype,
			enumeration: (p.allowedValues?.length ?? 0) > 0
		}))
	];
}

/** Adds the picked columns, in the given order, to `hopId` (`null` = root) of `model`. */
function withColumns(
	model: QueryModel,
	hopId: string | null,
	picks: readonly Pick<ColumnChoice, 'source' | 'header'>[]
): QueryModel {
	return picks.reduce((m, c) => addColumn(m, { hopId, source: c.source, header: c.header }), model);
}

/** First step: a new query rooted at `classIri` carrying the picked columns, as one model value. */
export function applyStartClass(
	classIri: string,
	namespaces: string[],
	picks: readonly Pick<ColumnChoice, 'source' | 'header'>[]
): QueryModel {
	return withColumns(startQueryFromClass(classIri, namespaces), null, picks);
}

