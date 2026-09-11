import { describe, it, expect, vi } from 'vitest';
import { createIdentity, editIdentity, resolveDefaultNamespace, type IdentityMutationConnector } from './identity-mutations';
import type { AttributeValueSubmission } from './attribute-values';
import type { RelationValueSubmission } from './relation-values';

function fakeConnector(overrides: Partial<IdentityMutationConnector> = {}): IdentityMutationConnector {
	return {
		insertIndividual: vi.fn(async () => ({ iri: 'http://ex.org/instances#new' })),
		renameIndividual: vi.fn(async () => {}),
		applyAttributeSubmissions: vi.fn(async () => {}),
		insertAssertion: vi.fn(async () => ({ predicateIri: 'http://ex.org/schema#rel' })),
		deleteAssertion: vi.fn(async () => {}),
		resolveEffectiveClassNamespace: vi.fn(async () => null),
		...overrides
	};
}

const attr: AttributeValueSubmission = { attributeIri: 'http://ex.org/schema#name', datatype: 'string', repeatable: false, value: 'Alice' };
const relationAdd: RelationValueSubmission = {
	predicateIri: 'http://ex.org/schema#worksFor',
	predicateLabel: 'works for',
	added: ['http://ex.org/instances#acme'],
	removed: []
};
const relationRemove: RelationValueSubmission = {
	predicateIri: 'http://ex.org/schema#worksFor',
	predicateLabel: 'works for',
	added: [],
	removed: ['http://ex.org/instances#acme']
};

describe('createIdentity', () => {
	it('happy path with no attributes/relations calls only insertIndividual', async () => {
		const connector = fakeConnector();
		const { iri } = await createIdentity('http://ex.org/schema#Person', 'Alice', 'http://ex.org', [], undefined, [], connector);

		expect(iri).toBe('http://ex.org/instances#new');
		expect(connector.insertIndividual).toHaveBeenCalledWith('http://ex.org/schema#Person', 'Alice', 'http://ex.org', undefined);
		expect(connector.applyAttributeSubmissions).not.toHaveBeenCalled();
		expect(connector.insertAssertion).not.toHaveBeenCalled();
		expect(connector.deleteAssertion).not.toHaveBeenCalled();
	});

	it('applies attribute submissions when present', async () => {
		const connector = fakeConnector();
		const { iri } = await createIdentity('http://ex.org/schema#Person', 'Alice', 'http://ex.org', [attr], undefined, [], connector);

		expect(connector.applyAttributeSubmissions).toHaveBeenCalledWith(iri, [attr]);
	});

	it('applies relation submissions via insertAssertion/deleteAssertion', async () => {
		const connector = fakeConnector();
		const { iri } = await createIdentity(
			'http://ex.org/schema#Person',
			'Alice',
			'http://ex.org',
			[],
			undefined,
			[relationAdd, relationRemove],
			connector
		);

		expect(connector.insertAssertion).toHaveBeenCalledWith(iri, 'works for', 'http://ex.org/instances#acme');
		expect(connector.deleteAssertion).toHaveBeenCalledWith(iri, 'http://ex.org/schema#worksFor', 'http://ex.org/instances#acme');
	});

	it('never calls addWorkspaceMember or any Workspace-related method', async () => {
		const connector = fakeConnector();
		await createIdentity('http://ex.org/schema#Person', 'Alice', 'http://ex.org', [attr], undefined, [relationAdd], connector);

		expect(Object.keys(connector)).not.toContain('addWorkspaceMember');
	});

	it('passes a hand-typed identifier through, agreeing with a pre-resolved Concept Namespace', async () => {
		const connector = fakeConnector({
			resolveEffectiveClassNamespace: vi.fn(async () => ({ baseIri: 'http://concept.ex.org', own: true }))
		});
		const classNamespaceLookup = new Map([['http://ex.org/schema#Person', { namespace: 'http://ex.org' }]]);
		const namespaceBaseIri = await resolveDefaultNamespace('http://ex.org/schema#Person', classNamespaceLookup, connector);

		await createIdentity('http://ex.org/schema#Person', 'Alice', namespaceBaseIri!, [], 'alice-01', [], connector);

		// insertIndividual's own identifier-triggered override (sparql-connector.ts) would also
		// resolve to the same Concept Namespace here — this asserts the two never disagree.
		expect(namespaceBaseIri).toBe('http://concept.ex.org');
		expect(connector.insertIndividual).toHaveBeenCalledWith(
			'http://ex.org/schema#Person',
			'Alice',
			'http://concept.ex.org',
			'alice-01'
		);
	});
});

describe('editIdentity', () => {
	it('renames when the label changed', async () => {
		const connector = fakeConnector();
		await editIdentity('http://ex.org/instances#alice', 'Alicia', 'Alice', [], [], connector);

		expect(connector.renameIndividual).toHaveBeenCalledWith('http://ex.org/instances#alice', 'Alicia');
	});

	it('skips renameIndividual when the label is unchanged', async () => {
		const connector = fakeConnector();
		await editIdentity('http://ex.org/instances#alice', 'Alice', 'Alice', [], [], connector);

		expect(connector.renameIndividual).not.toHaveBeenCalled();
	});

	it('applies attribute-only changes', async () => {
		const connector = fakeConnector();
		await editIdentity('http://ex.org/instances#alice', 'Alice', 'Alice', [attr], [], connector);

		expect(connector.applyAttributeSubmissions).toHaveBeenCalledWith('http://ex.org/instances#alice', [attr]);
		expect(connector.renameIndividual).not.toHaveBeenCalled();
	});

	it('applies a relation add and a relation remove in one call', async () => {
		const connector = fakeConnector();
		await editIdentity('http://ex.org/instances#alice', 'Alice', 'Alice', [], [relationAdd, relationRemove], connector);

		expect(connector.insertAssertion).toHaveBeenCalledWith('http://ex.org/instances#alice', 'works for', 'http://ex.org/instances#acme');
		expect(connector.deleteAssertion).toHaveBeenCalledWith(
			'http://ex.org/instances#alice',
			'http://ex.org/schema#worksFor',
			'http://ex.org/instances#acme'
		);
	});
});

describe('resolveDefaultNamespace', () => {
	const classIri = 'http://ex.org/schema#Person';

	it('uses the Concept Namespace when the class declares its own', async () => {
		const connector = { resolveEffectiveClassNamespace: vi.fn(async () => ({ baseIri: 'http://concept.ex.org', own: true })) };
		const lookup = new Map([[classIri, { namespace: 'http://ex.org' }]]);

		expect(await resolveDefaultNamespace(classIri, lookup, connector)).toBe('http://concept.ex.org');
	});

	it('uses an inherited Concept Namespace the same way as an own one', async () => {
		const connector = { resolveEffectiveClassNamespace: vi.fn(async () => ({ baseIri: 'http://concept.ex.org', own: false })) };
		const lookup = new Map([[classIri, { namespace: 'http://ex.org' }]]);

		expect(await resolveDefaultNamespace(classIri, lookup, connector)).toBe('http://concept.ex.org');
	});

	it('falls back to the class own declaring namespace when no Concept Namespace exists anywhere', async () => {
		const connector = { resolveEffectiveClassNamespace: vi.fn(async () => null) };
		const lookup = new Map([[classIri, { namespace: 'http://ex.org' }]]);

		expect(await resolveDefaultNamespace(classIri, lookup, connector)).toBe('http://ex.org');
	});
});
