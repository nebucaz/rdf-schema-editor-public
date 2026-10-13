import type { XsdDatatype } from '$lib/utils/iri';
import type { CanvasModel, EntityNodeSpec, ExternalNodeSpec } from './canvas-model';

/**
 * Notation-neutral ERD model for the Export ERD feature (STORY-152) — a pure, schema-only,
 * workspace-scoped projection of a `CanvasModel`. Mapping decisions (generated reverse relations,
 * external classes, inherited-attribute marking, …) are recorded in
 * `spec/export-erd/notation-reference.md`.
 */

export type Cardinality = '0..1' | '1' | '0..*' | '1..*';

/** Cardinality at the relation's target (range) end — `required` is min 0/1, `repeatable` max 1/many. */
export function cardinalityOf(required: boolean, repeatable: boolean): Cardinality {
	if (required) return repeatable ? '1..*' : '1';
	return repeatable ? '0..*' : '0..1';
}

/** Cardinality symbol from the real `sh:minCount`/`sh:maxCount` when the shape has them, else from
 *  the editor's `required`/`repeatable` flags: min ≥ 1 → mandatory; max absent or > 1 → many. */
export function cardinalityFromCounts(
	required: boolean,
	repeatable: boolean,
	minCount?: number,
	maxCount?: number
): Cardinality {
	const mandatory = minCount !== undefined ? minCount >= 1 : required;
	const many = maxCount !== undefined ? maxCount > 1 : repeatable;
	return cardinalityOf(mandatory, many);
}

/** Exact multiplicity text (`2..5`, `1..*`) when the shape's counts say more than the symbol can —
 *  `undefined` when the symbol's own text already is exact. */
export function exactMultiplicity(cardinality: Cardinality, minCount?: number, maxCount?: number): string | undefined {
	if (minCount === undefined && maxCount === undefined) return undefined;
	const text = `${minCount ?? 0}..${maxCount ?? '*'}`;
	const symbolText = cardinality === '1' ? '1..1' : cardinality;
	return text === symbolText ? undefined : text;
}

export interface ErdAttribute {
	name: string;
	datatype: XsdDatatype;
	required: boolean;
	repeatable: boolean;
	inheritedFrom?: { classIri: string; className: string };
}

export interface ErdEntity {
	iri: string;
	name: string;
	namespace: string;
	/** Namespace colour (hex) when one is configured; renderers fall back to the theme header colour. */
	color?: string;
	isAssociationClass: boolean;
	attributes: ErdAttribute[];
}

export interface ErdExternal {
	iri: string;
	prefixedName: string;
}

export interface ErdRelation {
	iri: string;
	name: string;
	sourceIri: string;
	targetIri: string;
	cardinality: Cardinality;
	/** Exact `min..max` text when the shape's counts differ from the symbol's own (UML label). */
	multiplicity?: string;
	relationKind: 'specific' | 'generic';
}

/** A link from an association class to one of the entities it relates. */
export interface ErdAssociationLink {
	iri: string;
	name: string;
	associationIri: string;
	targetIri: string;
	cardinality: Cardinality;
	multiplicity?: string;
}

export interface ErdInheritance {
	subIri: string;
	superIri: string;
}

export interface ErdModel {
	entities: ErdEntity[];
	externals: ErdExternal[];
	relations: ErdRelation[];
	associationLinks: ErdAssociationLink[];
	inheritances: ErdInheritance[];
}

export interface BuildErdModelOptions {
	/** IRIs of the active Workspace's members — the sole source of scope (the temporary namespace
	 *  filter is deliberately not consulted). */
	memberIris: ReadonlySet<string>;
	/** Restricts the export to these node IRIs (STORY-160); ignored when empty or absent. */
	selection?: ReadonlySet<string>;
	/** Namespace base IRI → hex colour. */
	namespaceColors?: ReadonlyMap<string, string>;
	/** Namespaces hidden on the workbench — their entities are left out so the export matches what
	 *  the user sees. */
	hiddenNamespaces?: ReadonlySet<string>;
	/** Workbench "show reverse relations" toggle; when false, generated reverse relations are omitted. */
	showReverseRelations?: boolean;
}

export function buildErdModel(canvas: CanvasModel, options: BuildErdModelOptions): ErdModel {
	const { memberIris, selection, namespaceColors, hiddenNamespaces, showReverseRelations } = options;
	const restrict = selection !== undefined && selection.size > 0;

	const entityNodes = canvas.nodes.filter(
		(n): n is EntityNodeSpec =>
			n.kind === 'entity' &&
			memberIris.has(n.iri) &&
			!hiddenNamespaces?.has(n.namespace) &&
			(!restrict || selection.has(n.iri))
	);
	const keptIris = new Set(entityNodes.map((n) => n.iri));

	const entities: ErdEntity[] = entityNodes.map((n) => ({
		iri: n.iri,
		name: n.name,
		namespace: n.namespace,
		...(namespaceColors?.has(n.namespace) ? { color: namespaceColors.get(n.namespace) } : {}),
		isAssociationClass: canvas.associationClassIris.has(n.iri),
		attributes: n.attributes.map((a) => ({
			name: a.name,
			datatype: a.datatype,
			required: a.required,
			repeatable: a.repeatable,
			...(a.inheritedFrom ? { inheritedFrom: a.inheritedFrom } : {})
		}))
	}));

	const keptRelations = canvas.edges.flatMap((e) =>
		e.kind === 'relation' && keptIris.has(e.source) && keptIris.has(e.target) ? [e] : []
	);
	const forwardIris = new Set(keptRelations.map((e) => e.iri));
	const relations: ErdRelation[] = keptRelations
		// A generated reverse is redundant when its forward relation is drawn (reference §impedance).
		.filter((e) => !(e.generatedReverseOf !== undefined && showReverseRelations === false))
		.filter((e) => !(e.generatedReverseOf !== undefined && forwardIris.has(e.generatedReverseOf)))
		.map((e) => ({
			iri: e.iri,
			name: e.name,
			sourceIri: e.source,
			targetIri: e.target,
			cardinality: cardinalityFromCounts(e.required, e.repeatable, e.minCount, e.maxCount),
			multiplicity: exactMultiplicity(
				cardinalityFromCounts(e.required, e.repeatable, e.minCount, e.maxCount),
				e.minCount,
				e.maxCount
			),
			relationKind: e.relationKind
		}));

	const associationLinks: ErdAssociationLink[] = canvas.edges.flatMap((e) =>
		e.kind === 'attributedLink' && keptIris.has(e.source) && keptIris.has(e.target)
			? [
					{
						iri: e.iri,
						name: e.propName,
						associationIri: e.source,
						targetIri: e.target,
						cardinality: cardinalityFromCounts(e.required, e.repeatable, e.minCount, e.maxCount),
						multiplicity: exactMultiplicity(
							cardinalityFromCounts(e.required, e.repeatable, e.minCount, e.maxCount),
							e.minCount,
							e.maxCount
						)
					}
				]
			: []
	);

	const externalByIri = new Map(
		canvas.nodes
			.filter((n): n is ExternalNodeSpec => n.kind === 'external')
			.map((n) => [n.iri, n])
	);
	const usedExternals = new Set<string>();
	const inheritances: ErdInheritance[] = [];
	for (const e of canvas.edges) {
		if (e.kind !== 'inheritance' || !keptIris.has(e.source)) continue;
		if (keptIris.has(e.target)) {
			inheritances.push({ subIri: e.source, superIri: e.target });
		} else if (externalByIri.has(e.target)) {
			usedExternals.add(e.target);
			inheritances.push({ subIri: e.source, superIri: e.target });
		}
	}
	const externals: ErdExternal[] = [...usedExternals].map((iri) => ({
		iri,
		prefixedName: externalByIri.get(iri)!.prefixedName
	}));

	return { entities, externals, relations, associationLinks, inheritances };
}
