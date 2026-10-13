/**
 * Query Workbench builder schema: what the visual builder can offer, derived purely from a
 * `FetchedSchema` (same pattern as `buildCanvasModel`). Nothing here names a class — a class added
 * to the graph shows up with no code change.
 *
 * Own (non-inherited) properties/relationships only; inherited ones are reachable by choosing the
 * superclass as root with subclass-inclusive matching.
 */
import type { FetchedSchema } from './sparql-connector';
import { extractLocalName } from '../utils/iri';

export interface BuilderValue {
	/** IRI (when `isIri`) or the literal's lexical value. */
	value: string;
	label: string;
	isIri: boolean;
}

export interface BuilderProperty {
	iri: string;
	label: string;
	/** XSD datatype IRI (`FetchedProperty.range`). */
	datatype: string;
	required: boolean;
	repeatable: boolean;
	minCount?: number;
	maxCount?: number;
	/** From an `sh:in` list, when present. */
	allowedValues?: BuilderValue[];
}

export interface BuilderRelationship {
	iri: string;
	label: string;
	targetClassIri: string;
	targetLabel: string;
	required: boolean;
	repeatable: boolean;
	minCount?: number;
	maxCount?: number;
}

/** A relationship declared on another class that points at this one (or at a superclass of it). */
export interface BuilderInboundRelationship {
	iri: string;
	label: string;
	/** Class that declares the relationship — the target of an inverse hop. */
	sourceClassIri: string;
	sourceLabel: string;
	/** `label`, or `label (SourceLabel)` when another inbound entry on this class shares the label. */
	displayLabel: string;
	required: boolean;
	repeatable: boolean;
	minCount?: number;
	maxCount?: number;
}

export interface BuilderClass {
	iri: string;
	label: string;
	namespaceBaseIri: string;
	properties: BuilderProperty[];
	relationships: BuilderRelationship[];
	/** Relationships of other classes that point at this class or inherit into it via a superclass. */
	inboundRelationships: BuilderInboundRelationship[];
	/** Transitive closure of `rdfs:subClassOf` (inference is off, so the compiler needs this). */
	subclasses: string[];
	/** Individuals typed with this class — the app's enumerated-member convention. */
	members: BuilderValue[];
	/** Has members and declares no properties or relationships of its own. */
	isEnumeration: boolean;
}

export interface BuilderSchema {
	classes: Map<string, BuilderClass>;
}

const labelOr = (label: string | null | undefined, iri: string) =>
	label && label.trim() ? label : extractLocalName(iri);

export function buildBuilderSchema(schema: FetchedSchema): BuilderSchema {
	const classLabel = new Map(schema.classes.map((c) => [c.iri, labelOr(c.label, c.iri)]));
	const individualLabel = new Map(schema.individuals.map((i) => [i.iri, labelOr(i.label, i.iri)]));

	const directSubs = new Map<string, Set<string>>();
	for (const { sub, super: sup } of schema.subClassOf) {
		if (!directSubs.has(sup)) directSubs.set(sup, new Set());
		directSubs.get(sup)!.add(sub);
	}
	const closure = (iri: string): string[] => {
		const seen = new Set<string>();
		const stack = [...(directSubs.get(iri) ?? [])];
		while (stack.length) {
			const next = stack.pop()!;
			if (seen.has(next) || next === iri) continue;
			seen.add(next);
			stack.push(...(directSubs.get(next) ?? []));
		}
		return [...seen];
	};

	const inByProperty = new Map<string, BuilderValue[]>();
	for (const c of schema.shapeInConstraints ?? []) {
		inByProperty.set(
			`${c.classIri}\u0000${c.propertyIri}`,
			c.values.map((v) => ({
				value: v.value,
				isIri: v.isIri,
				label: v.isIri ? individualLabel.get(v.value) ?? classLabel.get(v.value) ?? extractLocalName(v.value) : v.value
			}))
		);
	}

	const outbound = new Map<string, BuilderRelationship[]>();
	for (const c of schema.classes) {
		// A generic relation can appear once per (domain, range) row; keep one entry per property+target.
		const seenRel = new Set<string>();
		const list: BuilderRelationship[] = [];
		for (const r of schema.objectProperties) {
			if (r.domain !== c.iri) continue;
			const key = `${r.iri}\u0000${r.range}`;
			if (seenRel.has(key)) continue;
			seenRel.add(key);
			list.push({
				iri: r.iri,
				label: labelOr(r.label, r.iri),
				targetClassIri: r.range,
				targetLabel: classLabel.get(r.range) ?? extractLocalName(r.range),
				required: r.required,
				repeatable: r.repeatable,
				minCount: r.minCount,
				maxCount: r.maxCount
			});
		}
		outbound.set(c.iri, list);
	}

	/** Classes whose relationships are inbound for `iri`: itself and every superclass. */
	const superclassesOf = new Map<string, Set<string>>();
	for (const c of schema.classes) {
		for (const sub of closure(c.iri)) {
			if (!superclassesOf.has(sub)) superclassesOf.set(sub, new Set([sub]));
			superclassesOf.get(sub)!.add(c.iri);
		}
	}

	const classes = new Map<string, BuilderClass>();
	for (const c of schema.classes) {
		const properties: BuilderProperty[] = schema.datatypeProperties
			.filter((p) => p.domain === c.iri)
			.map((p) => ({
				iri: p.iri,
				label: labelOr(p.label, p.iri),
				datatype: p.range,
				required: p.required,
				repeatable: p.repeatable,
				minCount: p.minCount,
				maxCount: p.maxCount,
				allowedValues: inByProperty.get(`${c.iri}\u0000${p.iri}`)
			}));
		const relationships = outbound.get(c.iri) ?? [];
		const targets = superclassesOf.get(c.iri) ?? new Set([c.iri]);
		const inboundRaw: Omit<BuilderInboundRelationship, 'displayLabel'>[] = [];
		for (const source of schema.classes) {
			for (const r of outbound.get(source.iri) ?? []) {
				if (!targets.has(r.targetClassIri)) continue;
				if (inboundRaw.some((x) => x.iri === r.iri && x.sourceClassIri === source.iri)) continue;
				inboundRaw.push({
					iri: r.iri,
					label: r.label,
					sourceClassIri: source.iri,
					sourceLabel: labelOr(source.label, source.iri),
					required: r.required,
					repeatable: r.repeatable,
					minCount: r.minCount,
					maxCount: r.maxCount
				});
			}
		}
		const inboundRelationships: BuilderInboundRelationship[] = inboundRaw.map((x) => ({
			...x,
			displayLabel: inboundRaw.some((o) => o !== x && o.label === x.label) ? `${x.label} (${x.sourceLabel})` : x.label
		}));
		const members = schema.individuals
			.filter((i) => i.classIri === c.iri)
			.map((i) => ({ value: i.iri, label: labelOr(i.label, i.iri), isIri: true }));
		classes.set(c.iri, {
			iri: c.iri,
			label: labelOr(c.label, c.iri),
			namespaceBaseIri: c.namespaceBaseIri,
			properties,
			relationships,
			inboundRelationships,
			subclasses: closure(c.iri),
			members,
			isEnumeration: members.length > 0 && properties.length === 0 && relationships.length === 0
		});
	}
	return { classes };
}
