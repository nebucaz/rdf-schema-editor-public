import type { ErdAttribute, ErdEntity, ErdModel } from './erd-model';

/** Shared fixtures/assertions for the ERD renderer specs. Test-only. */
export const iri = (n: string) => `http://example.org/a#${n}`;

export function ent(name: string, attrs: Partial<ErdAttribute>[] = [], extra: Partial<ErdEntity> = {}): ErdEntity {
	return {
		iri: iri(name),
		name,
		namespace: 'http://example.org/a',
		isAssociationClass: false,
		attributes: attrs.map((a, i) => ({ name: `attr${i}`, datatype: 'string', required: false, repeatable: false, ...a })),
		...extra
	};
}

/** Person / Employee(sub of Person) / Company / Employment(assoc class → Person, Company) / foaf:Agent. */
export function fixtureModel(): ErdModel {
	return {
		entities: [
			ent('Person', [{ name: 'name', required: true }], { color: '#3366cc' }),
			ent('Employee', [
				{ name: 'badge' },
				{ name: 'name', required: true, inheritedFrom: { classIri: iri('Person'), className: 'Person' } }
			]),
			ent('Company', [{ name: 'tags', repeatable: true }]),
			ent('Employment', [{ name: 'since' }], { isAssociationClass: true })
		],
		externals: [{ iri: 'http://xmlns.com/foaf/0.1/Agent', prefixedName: 'foaf:Agent' }],
		relations: (['0..1', '1', '0..*', '1..*'] as const).map((c, i) => ({
			iri: iri(`rel${i}`),
			name: `rel${i}`,
			sourceIri: iri('Person'),
			targetIri: iri('Company'),
			cardinality: c,
			relationKind: 'specific' as const
		})),
		associationLinks: [
			{ iri: iri('forPerson'), name: 'forPerson', associationIri: iri('Employment'), targetIri: iri('Person'), cardinality: '1' },
			{ iri: iri('forCompany'), name: 'forCompany', associationIri: iri('Employment'), targetIri: iri('Company'), cardinality: '0..*' }
		],
		inheritances: [
			{ subIri: iri('Employee'), superIri: iri('Person') },
			{ subIri: iri('Person'), superIri: 'http://xmlns.com/foaf/0.1/Agent' }
		]
	};
}

export const fixturePositions = {
	[iri('Person')]: { x: 0, y: 0 },
	[iri('Employee')]: { x: 0, y: 400 },
	[iri('Company')]: { x: 500, y: 0 },
	[iri('Employment')]: { x: 500, y: 400 },
	'http://xmlns.com/foaf/0.1/Agent': { x: 0, y: -200 }
};

/** Minimal well-formedness check: balanced/matching tags, quoted attributes, no stray `<`/`&`. */
export function assertWellFormedXml(xml: string): void {
	const stack: string[] = [];
	const tagRe = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/y;
	let i = 0;
	while (i < xml.length) {
		if (xml[i] === '<') {
			tagRe.lastIndex = i;
			const m = tagRe.exec(xml);
			if (!m) throw new Error(`malformed tag at ${i}: ${xml.slice(i, i + 60)}`);
			const [whole, close, name, , selfClose] = m;
			if (close) {
				if (stack.pop() !== name) throw new Error(`mismatched </${name}> at ${i}`);
			} else if (!selfClose) stack.push(name);
			i += whole.length;
		} else {
			const next = xml.indexOf('<', i);
			const text = xml.slice(i, next === -1 ? undefined : next);
			if (/&(?!(amp|lt|gt|quot|apos);)/.test(text) || text.includes('>')) throw new Error(`bad text: ${text.slice(0, 40)}`);
			i = next === -1 ? xml.length : next;
		}
	}
	if (stack.length > 0) throw new Error(`unclosed: ${stack.join(',')}`);
}
