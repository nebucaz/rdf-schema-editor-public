/**
 * LinkML (https://linkml.io/) schema export (STORY-068/STORY-069) — a second, widely-used
 * schema-modeling format alongside Turtle. Consumes `CanvasModel` (`canvas-model.ts`'s pure
 * `buildCanvasModel` output), not raw Turtle/`Quad[]`, per the relation-plus ADR: `CanvasModel` is
 * already class-scoped with denormalized attributes/relations, a much closer structural match to
 * LinkML than quad-level Turtle, and matches what the canvas itself already renders from.
 *
 * No YAML library is installed in this app, and LinkML's `.yaml` format is simple enough here for
 * a hand-rolled string writer in the style of `turtle.ts`'s existing writer functions — see
 * `YamlWriter` below.
 */
import type {
	CanvasModel,
	EntityNodeSpec,
	NodeSpec,
	RelationEdgeSpec,
	AttributedLinkEdgeSpec
} from './canvas-model';
import { namespaceGraphs } from '$lib/config';
import type { XsdDatatype } from '$lib/utils/iri';

export interface LinkMLNamespace {
	prefix: string;
	baseIri: string;
}

/** XSD -> LinkML built-in type rename table (`research.md`'s mapping table): `dateTime`->`datetime`,
 *  `anyURI`->`uri`, every other `XsdDatatype` is already a valid LinkML built-in type name as-is. */
const XSD_TO_LINKML_TYPE: Record<XsdDatatype, string> = {
	string: 'string',
	integer: 'integer',
	decimal: 'decimal',
	date: 'date',
	dateTime: 'datetime',
	boolean: 'boolean',
	anyURI: 'uri'
};

/** The `AttributedRelationship` marker (STORY-020/STORY-069) has no native LinkML counterpart, so
 *  it's surfaced as this `annotations:` key on the association class itself — chosen so the
 *  distinction (this is an association/reified-relationship class, not an ordinary entity) survives
 *  a round-trip instead of being silently lost. */
const ASSOCIATION_CLASS_ANNOTATION_KEY = 'attributed_relationship';

// -- Minimal hand-rolled YAML writer --------------------------------------------------------------

/** Plain YAML scalars this writer will emit unquoted — anything else (leading YAML indicator
 *  characters, `key: value`-shaped text, a trailing colon, a mid-string ` #` comment opener,
 *  leading/trailing whitespace, or an empty string) is double-quoted via `JSON.stringify`, whose
 *  escaping is a valid subset of YAML's own double-quoted scalar syntax. Deliberately permissive
 *  about interior `:` (e.g. `http://...`, `linkml:types`) since only *colon-space* is actually
 *  ambiguous with YAML's own mapping syntax. */
const YAML_UNSAFE_LEADING_CHARS = new Set([
	'#',
	'?',
	':',
	',',
	'[',
	']',
	'{',
	'}',
	'&',
	'*',
	'!',
	'|',
	'>',
	"'",
	'"',
	'%',
	'@',
	'`'
]);

function isYamlSafePlain(value: string): boolean {
	if (value.length === 0) return false;
	if (value.trim() !== value) return false;
	if (value.includes(': ') || value.endsWith(':')) return false;
	if (value.includes(' #')) return false;
	const first = value[0];
	if (YAML_UNSAFE_LEADING_CHARS.has(first)) return false;
	if (first === '-' && (value.length === 1 || value[1] === ' ')) return false;
	return true;
}

function yamlScalar(value: string): string {
	return isYamlSafePlain(value) ? value : JSON.stringify(value);
}

class YamlWriter {
	private lines: string[] = [];

	/** Emits `key: value` (or a bare `key:` when `value` is omitted, e.g. to open a nested block). */
	kv(indent: number, key: string, value?: string | number | boolean) {
		const line = value === undefined ? `${yamlScalar(key)}:` : `${yamlScalar(key)}: ${this.scalarize(value)}`;
		this.lines.push('  '.repeat(indent) + line);
	}

	/** Emits a `- value` list item. */
	item(indent: number, value: string) {
		this.lines.push(`${'  '.repeat(indent)}- ${yamlScalar(value)}`);
	}

	/** Emits a bare `- key:` list item, e.g. opening a mapping inside a sequence. */
	itemKey(indent: number, key: string) {
		this.lines.push(`${'  '.repeat(indent)}- ${yamlScalar(key)}:`);
	}

	blank() {
		this.lines.push('');
	}

	private scalarize(value: string | number | boolean): string {
		if (typeof value === 'boolean' || typeof value === 'number') return String(value);
		return yamlScalar(value);
	}

	toString(): string {
		return this.lines.join('\n') + '\n';
	}
}

// -- Internal draft model (built up across both classes/attributes and generic/enum/association passes) --

interface AttributeDraft {
	range: string;
	required: boolean;
	multivalued: boolean;
}

interface ClassDraft {
	name: string;
	description: string;
	isA?: string;
	/** Class-scoped slots (own attributes + specific relations + STORY-069's association-class
	 *  participant links) — LinkML `attributes:`, never referenced by any other class. */
	attributes: Map<string, AttributeDraft>;
	/** Names of schema-top-level `slots:` this class uses (STORY-069's generic relations) —
	 *  LinkML `slots:` list, distinct from `attributes:`. */
	slots: Set<string>;
	isAssociationClass: boolean;
}

interface GenericSlotDraft {
	name: string;
	range?: string;
	required: boolean;
	multivalued: boolean;
	/** Every distinct target class name this generic relation was drawn to across the canvas — used
	 *  only to flag ambiguity in `description` when more than one is seen; the top-level LinkML slot
	 *  can only carry a single `range:`. */
	observedTargets: Set<string>;
}

interface EnumDraft {
	name: string;
	members: string[];
}

function nodeDisplayName(node: NodeSpec): string {
	return node.kind === 'entity' ? node.name : node.prefixedName;
}

/** A class is enum-backing (STORY-069) iff it has at least one enumerated member, no attributes of
 *  its own, isn't itself an association class, and nothing else references it structurally (no
 *  inheritance edge, specific relation, or association-class link in or out) — i.e. its only role
 *  in the schema is "a closed set of named values". This is a judgment call (`research.md` doesn't
 *  fully specify it): a class also used structurally stays a `classes:` entry even if it happens to
 *  carry enumerated members, since collapsing it to an `enums:` entry would drop those structural
 *  relationships from the export entirely. */
function isEnumBackingClass(node: EntityNodeSpec, model: CanvasModel): boolean {
	if (node.members.length === 0) return false;
	if (node.attributes.length > 0) return false;
	if (model.associationClassIris.has(node.iri)) return false;
	return !model.edges.some((edge) => {
		if (edge.kind === 'inheritance') return edge.source === node.iri || edge.target === node.iri;
		if (edge.kind === 'relation') {
			return edge.relationKind === 'specific' && (edge.source === node.iri || edge.target === node.iri);
		}
		return edge.source === node.iri || edge.target === node.iri; // attributedLink
	});
}

/**
 * Produces a LinkML YAML schema string from a `CanvasModel`.
 *
 * Direct/near-1:1 mappings (STORY-068): `classes:` per `EntityNodeSpec`, class-scoped `attributes:`
 * per `CanvasAttributeSpec` and per *specific* `RelationEdgeSpec`, `is_a:` per `InheritanceEdgeSpec`,
 * a `prefixes:` block per namespace.
 *
 * Impedance-mismatch mappings (STORY-069): enum-backing classes become top-level `enums:` entries
 * instead of `classes:` entries; *generic* `RelationEdgeSpec`s become schema-top-level `slots:`
 * entries referenced by name (never redefined) from each using class's `slots:` list; association
 * classes (`AttributedLinkEdgeSpec` pairs) get their two participant links as class-scoped
 * `attributes:` plus an `annotations:` entry marking the `AttributedRelationship` pattern.
 */
export function canvasModelToLinkML(
	model: CanvasModel,
	namespaces: LinkMLNamespace[] = [],
	schemaName: string = 'Schema'
): string {
	const iriToDisplayName = new Map<string, string>(model.nodes.map((n) => [n.iri, nodeDisplayName(n)]));
	const displayName = (iri: string) => iriToDisplayName.get(iri) ?? iri;

	const entityNodes = model.nodes.filter((n): n is EntityNodeSpec => n.kind === 'entity');
	const enumBackingIris = new Set(entityNodes.filter((n) => isEnumBackingClass(n, model)).map((n) => n.iri));

	// -- classes: (STORY-068 base + STORY-069 association-class extensions) ---------------------
	const classDrafts = new Map<string, ClassDraft>();
	for (const node of entityNodes) {
		if (enumBackingIris.has(node.iri)) continue;
		const attributes = new Map<string, AttributeDraft>();
		for (const attr of node.attributes) {
			attributes.set(attr.name, {
				range: XSD_TO_LINKML_TYPE[attr.datatype],
				required: attr.required,
				multivalued: attr.repeatable
			});
		}
		classDrafts.set(node.iri, {
			name: node.name,
			description: node.description,
			attributes,
			slots: new Set(),
			isAssociationClass: model.associationClassIris.has(node.iri)
		});
	}

	for (const edge of model.edges) {
		if (edge.kind === 'inheritance') {
			const draft = classDrafts.get(edge.source);
			if (draft) draft.isA = displayName(edge.target);
		}
	}

	// -- specific relations: class-scoped attributes: (STORY-068) --------------------------------
	const specificRelations = model.edges.filter(
		(e): e is RelationEdgeSpec => e.kind === 'relation' && e.relationKind === 'specific'
	);
	for (const rel of specificRelations) {
		const draft = classDrafts.get(rel.source);
		if (!draft) continue;
		draft.attributes.set(rel.name, {
			range: displayName(rel.target),
			required: rel.required,
			multivalued: rel.repeatable
		});
	}

	// -- generic relations: schema-top-level slots: (STORY-069) ----------------------------------
	const genericRelations = model.edges.filter(
		(e): e is RelationEdgeSpec => e.kind === 'relation' && e.relationKind === 'generic'
	);
	const genericSlots = new Map<string, GenericSlotDraft>();
	for (const rel of genericRelations) {
		const sourceDraft = classDrafts.get(rel.source);
		if (!sourceDraft) continue;
		let slot = genericSlots.get(rel.iri);
		if (!slot) {
			slot = {
				name: rel.name,
				range: displayName(rel.target),
				required: rel.required,
				multivalued: rel.repeatable,
				observedTargets: new Set()
			};
			genericSlots.set(rel.iri, slot);
		}
		slot.observedTargets.add(displayName(rel.target));
		sourceDraft.slots.add(slot.name);
	}

	// -- association classes: participant links + annotations: (STORY-069) -----------------------
	const associationLinks = model.edges.filter((e): e is AttributedLinkEdgeSpec => e.kind === 'attributedLink');
	for (const link of associationLinks) {
		const draft = classDrafts.get(link.source);
		if (!draft) continue;
		draft.attributes.set(link.propName, {
			range: displayName(link.target),
			required: link.required,
			multivalued: link.repeatable
		});
	}

	// -- enums: (STORY-069) ------------------------------------------------------------------------
	const enumDrafts: EnumDraft[] = entityNodes
		.filter((n) => enumBackingIris.has(n.iri))
		.map((n) => ({ name: n.name, members: n.members.map((m) => m.label) }));

	return renderLinkML(schemaName, namespaces, classDrafts, genericSlots, enumDrafts);
}

function renderLinkML(
	schemaName: string,
	namespaces: LinkMLNamespace[],
	classDrafts: Map<string, ClassDraft>,
	genericSlots: Map<string, GenericSlotDraft>,
	enumDrafts: EnumDraft[]
): string {
	const w = new YamlWriter();
	const schemaId = namespaces[0] ? namespaceGraphs(namespaces[0].baseIri).schema : 'https://example.org/schema';

	w.kv(0, 'id', schemaId);
	w.kv(0, 'name', schemaName);
	w.kv(0, 'default_range', 'string');
	w.kv(0, 'imports');
	w.item(1, 'linkml:types');

	const prefixEntries: [string, string][] = [['linkml', 'https://w3id.org/linkml/']];
	for (const ns of [...namespaces].sort((a, b) => a.prefix.localeCompare(b.prefix))) {
		if (!ns.prefix) continue;
		prefixEntries.push([ns.prefix, `${namespaceGraphs(ns.baseIri).schema}#`]);
	}
	w.kv(0, 'prefixes');
	for (const [prefix, uri] of prefixEntries) {
		w.kv(1, prefix, uri);
	}

	const sortedClasses = [...classDrafts.values()].sort((a, b) => a.name.localeCompare(b.name));
	if (sortedClasses.length > 0) {
		w.kv(0, 'classes');
		for (const cls of sortedClasses) {
			w.kv(1, cls.name);
			if (cls.description) w.kv(2, 'description', cls.description);
			if (cls.isA) w.kv(2, 'is_a', cls.isA);
			if (cls.slots.size > 0) {
				w.kv(2, 'slots');
				for (const slotName of [...cls.slots].sort()) w.item(3, slotName);
			}
			if (cls.attributes.size > 0) {
				w.kv(2, 'attributes');
				for (const [name, attr] of [...cls.attributes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
					w.kv(3, name);
					w.kv(4, 'range', attr.range);
					w.kv(4, 'required', attr.required);
					w.kv(4, 'multivalued', attr.multivalued);
				}
			}
			if (cls.isAssociationClass) {
				w.kv(2, 'annotations');
				w.kv(3, ASSOCIATION_CLASS_ANNOTATION_KEY, true);
			}
		}
	}

	const sortedSlots = [...genericSlots.values()].sort((a, b) => a.name.localeCompare(b.name));
	if (sortedSlots.length > 0) {
		w.kv(0, 'slots');
		for (const slot of sortedSlots) {
			w.kv(1, slot.name);
			if (slot.range) w.kv(2, 'range', slot.range);
			w.kv(2, 'required', slot.required);
			w.kv(2, 'multivalued', slot.multivalued);
			if (slot.observedTargets.size > 1) {
				w.kv(
					2,
					'description',
					`Generic relation used with varying ranges across classes: ${[...slot.observedTargets].sort().join(', ')}`
				);
			}
		}
	}

	if (enumDrafts.length > 0) {
		w.kv(0, 'enums');
		for (const en of [...enumDrafts].sort((a, b) => a.name.localeCompare(b.name))) {
			w.kv(1, en.name);
			w.kv(2, 'permissible_values');
			for (const member of [...en.members].sort()) w.kv(3, member);
		}
	}

	return w.toString();
}
