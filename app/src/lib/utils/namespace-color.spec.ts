import { describe, expect, it } from 'vitest';
import { buildClassHierarchyIndex, resolveClassColor, resolveNodeColor } from './namespace-color';

const NS_COLORED = 'urn:ns:colored';
const NS_PLAIN = 'urn:ns:plain';
const NS_OTHER_COLORED = 'urn:ns:other-colored';

const Animal = 'urn:class:Animal'; // NS_COLORED
const Mammal = 'urn:class:Mammal'; // NS_PLAIN, subClassOf Animal
const Pet = 'urn:class:Pet'; // NS_PLAIN, subClassOf Mammal
const Robot = 'urn:class:Robot'; // NS_PLAIN, no parents
const Cyborg = 'urn:class:Cyborg'; // NS_PLAIN, subClassOf both Mammal and Robot (multiple inheritance)

const classes = [
	{ iri: Animal, namespaceBaseIri: NS_COLORED },
	{ iri: Mammal, namespaceBaseIri: NS_PLAIN },
	{ iri: Pet, namespaceBaseIri: NS_PLAIN },
	{ iri: Robot, namespaceBaseIri: NS_PLAIN },
	{ iri: Cyborg, namespaceBaseIri: NS_PLAIN }
];

const subClassOf = [
	{ sub: Mammal, super: Animal },
	{ sub: Pet, super: Mammal },
	{ sub: Cyborg, super: Mammal },
	{ sub: Cyborg, super: Robot }
];

const namespaceColors = new Map([
	[NS_COLORED, '#ff0000'],
	[NS_OTHER_COLORED, '#00ff00']
	// NS_PLAIN deliberately has no color
]);

const index = buildClassHierarchyIndex(classes, subClassOf);

describe('resolveClassColor', () => {
	it("returns the class's own namespace color when it has one", () => {
		expect(resolveClassColor(Animal, index, namespaceColors)).toBe('#ff0000');
	});

	it('walks up a single subClassOf chain to find a colored ancestor', () => {
		expect(resolveClassColor(Pet, index, namespaceColors)).toBe('#ff0000'); // Pet -> Mammal -> Animal
	});

	it('returns undefined when no ancestor namespace has a color', () => {
		expect(resolveClassColor(Robot, index, namespaceColors)).toBeUndefined();
	});

	it('tries multiple parents deterministically (alphabetical) until one resolves a color', () => {
		// Cyborg's parents are Mammal (-> Animal, colored) and Robot (uncolored, no further parents).
		expect(resolveClassColor(Cyborg, index, namespaceColors)).toBe('#ff0000');
	});

	it('is not fooled by a cycle in subClassOf (defensive, even though the app validates against this)', () => {
		const cyclicIndex = buildClassHierarchyIndex(
			[
				{ iri: 'urn:a', namespaceBaseIri: NS_PLAIN },
				{ iri: 'urn:b', namespaceBaseIri: NS_PLAIN }
			],
			[
				{ sub: 'urn:a', super: 'urn:b' },
				{ sub: 'urn:b', super: 'urn:a' }
			]
		);
		expect(resolveClassColor('urn:a', cyclicIndex, namespaceColors)).toBeUndefined();
	});

	it('returns undefined for a class with no known namespace at all', () => {
		expect(resolveClassColor('urn:class:Unknown', index, namespaceColors)).toBeUndefined();
	});
});

describe('resolveNodeColor', () => {
	it("prefers the individual's own namespace color over its class's", () => {
		const node = { namespaceBaseIri: NS_OTHER_COLORED, classIri: Robot };
		expect(resolveNodeColor(node, index, namespaceColors)).toBe('#00ff00');
	});

	it("falls back to the class's resolved color when the individual's own namespace has none", () => {
		const node = { namespaceBaseIri: NS_PLAIN, classIri: Pet };
		expect(resolveNodeColor(node, index, namespaceColors)).toBe('#ff0000');
	});

	it('returns undefined when neither the individual nor any class ancestor has a colored namespace', () => {
		const node = { namespaceBaseIri: NS_PLAIN, classIri: Robot };
		expect(resolveNodeColor(node, index, namespaceColors)).toBeUndefined();
	});
});
