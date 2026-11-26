import { describe, it, expect, vi } from 'vitest';
import {
	createIdentity,
	editIdentity,
	addRelation,
	removeRelation,
	resolveDefaultNamespace,
	type IdentityMutationConnector,
	type IdentityMutationHooks
} from './identity-mutations';
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

describe('host hooks', () => {
	const subject = 'http://ex.org/instances#new';

	it('createIdentity fires onCreated then onRelationAdded/Removed after the matching writes, in order', async () => {
		const order: string[] = [];
		const connector = fakeConnector({
			insertIndividual: vi.fn(async () => {
				order.push('write:create');
				return { iri: subject };
			}),
			insertAssertion: vi.fn(async () => {
				order.push('write:add');
				return { predicateIri: 'http://ex.org/schema#rel' };
			}),
			deleteAssertion: vi.fn(async () => {
				order.push('write:remove');
			})
		});
		const hooks: IdentityMutationHooks = {
			onCreated: vi.fn(() => void order.push('hook:created')),
			onRelationAdded: vi.fn(() => void order.push('hook:added')),
			onRelationRemoved: vi.fn(() => void order.push('hook:removed'))
		};
		await createIdentity('c', 'Alice', 'http://ex.org', [], undefined, [relationAdd, relationRemove], connector, hooks);

		expect(order).toEqual(['write:create', 'hook:created', 'write:add', 'hook:added', 'write:remove', 'hook:removed']);
		expect(hooks.onCreated).toHaveBeenCalledWith(subject, 'Alice');
		expect(hooks.onRelationAdded).toHaveBeenCalledWith(subject, 'http://ex.org/schema#rel', 'http://ex.org/instances#acme', relationAdd.predicateLabel);
		expect(hooks.onRelationRemoved).toHaveBeenCalledWith(subject, relationRemove.predicateIri, 'http://ex.org/instances#acme');
	});

	it('editIdentity fires onRenamed only when the label changed, then relation hooks', async () => {
		const hooks: IdentityMutationHooks = { onRenamed: vi.fn(), onRelationAdded: vi.fn() };
		const connector = fakeConnector();
		await editIdentity(subject, 'Bob', 'Alice', [], [relationAdd], connector, hooks);
		expect(hooks.onRenamed).toHaveBeenCalledWith(subject, 'Bob');
		expect(hooks.onRelationAdded).toHaveBeenCalledTimes(1);

		const hooks2: IdentityMutationHooks = { onRenamed: vi.fn() };
		const connector2 = fakeConnector();
		await editIdentity(subject, 'Alice', 'Alice', [], [], connector2, hooks2);
		expect(connector2.renameIndividual).not.toHaveBeenCalled();
		expect(hooks2.onRenamed).not.toHaveBeenCalled();
	});

	it('a throwing hook does not undo or abort the write (sync and async)', async () => {
		const connector = fakeConnector();
		const hooks: IdentityMutationHooks = {
			onCreated: vi.fn(() => {
				throw new Error('boom');
			}),
			onRelationAdded: vi.fn(async () => {
				throw new Error('async boom');
			})
		};
		const { iri } = await createIdentity('c', 'Alice', 'http://ex.org', [], undefined, [relationAdd], connector, hooks);
		expect(iri).toBe(subject);
		expect(connector.insertAssertion).toHaveBeenCalledTimes(1);
		expect(hooks.onRelationAdded).toHaveBeenCalled();
	});

	it('without hooks behaviour is unchanged', async () => {
		const connector = fakeConnector();
		await expect(createIdentity('c', 'A', 'http://ex.org', [], undefined, [relationAdd], connector)).resolves.toEqual({ iri: subject });
	});
});

describe('addRelation / removeRelation', () => {
	const subject = 'http://ex.org/instances#p';
	const obj = 'http://ex.org/instances#acme';

	it('addRelation writes one triple through insertAssertion and fires onRelationAdded with the resolved predicate IRI', async () => {
		const connector = fakeConnector();
		const hooks: IdentityMutationHooks = { onRelationAdded: vi.fn() };
		const result = await addRelation(subject, 'works for', obj, connector, hooks);
		expect(connector.insertAssertion).toHaveBeenCalledWith(subject, 'works for', obj);
		expect(result).toEqual({ predicateIri: 'http://ex.org/schema#rel' });
		expect(hooks.onRelationAdded).toHaveBeenCalledWith(subject, 'http://ex.org/schema#rel', obj, 'works for');
	});

	it('removeRelation writes one deleteAssertion and fires onRelationRemoved', async () => {
		const connector = fakeConnector();
		const hooks: IdentityMutationHooks = { onRelationRemoved: vi.fn() };
		await removeRelation(subject, 'http://ex.org/schema#rel', obj, connector, hooks);
		expect(connector.deleteAssertion).toHaveBeenCalledWith(subject, 'http://ex.org/schema#rel', obj);
		expect(hooks.onRelationRemoved).toHaveBeenCalledWith(subject, 'http://ex.org/schema#rel', obj);
	});

	it('a failing write throws and fires no hook', async () => {
		const connector = fakeConnector({ deleteAssertion: vi.fn(async () => { throw new Error('nope'); }) });
		const hooks: IdentityMutationHooks = { onRelationRemoved: vi.fn() };
		await expect(removeRelation(subject, 'p', obj, connector, hooks)).rejects.toThrow('nope');
		expect(hooks.onRelationRemoved).not.toHaveBeenCalled();
	});
});
