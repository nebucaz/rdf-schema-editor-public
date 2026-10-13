import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import FilterModal from './FilterModal.svelte';
import { QueryBuilderStore } from '$lib/stores/query-builder-store.svelte';
import { buildBuilderSchema } from '$lib/services/query-builder-schema';
import { startQueryFromClass } from '$lib/services/query-model-edit';
import type { FetchedSchema } from '$lib/services/sparql-connector';

const NS = 'http://example.org/org';
const o = (n: string) => `${NS}#${n}`;
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
const XSD_INT = 'http://www.w3.org/2001/XMLSchema#integer';
const dp = (n: string, range: string, label = n) => ({
	iri: o(n), label, domain: o('Org'), range, namespaceBaseIri: NS, required: false, repeatable: false
});

const schema = buildBuilderSchema({
	classes: [{ iri: o('Org'), label: 'Organisation', comment: null, namespaceBaseIri: NS }],
	datatypeProperties: [dp('orgName', XSD_STRING, 'name'), dp('headcount', XSD_INT, 'headcount')],
	objectProperties: [],
	individuals: [],
	subClassOf: [],
	shapeInConstraints: []
} as unknown as FetchedSchema);

function setup() {
	const store = new QueryBuilderStore();
	store.schema = schema;
	store.load(startQueryFromClass(o('Org'), [NS]));
	const onClose = vi.fn();
	const target = { kind: 'property' as const, hopId: null, propertyIri: o('orgName') };
	render(FilterModal, { props: { isOpen: true, target, model: store.model!, schema, store, onClose } });
	return { store, onClose };
}

const apply = () => screen.getByRole('button', { name: 'Apply' });

describe('FilterModal', () => {
	it('applies a filter to the model and closes', async () => {
		const { store, onClose } = setup();
		await fireEvent.input(screen.getByLabelText('Value'), { target: { value: 'acme' } });
		await fireEvent.click(apply());
		expect(store.model!.filters).toHaveLength(1);
		expect(store.model!.filters[0]).toMatchObject({ propertyIri: o('orgName'), value: 'acme' });
		expect(onClose).toHaveBeenCalled();
	});

	it('shows a validation message and writes nothing for an empty value', async () => {
		const { store, onClose } = setup();
		await fireEvent.click(apply());
		expect(screen.getByRole('alert')).toBeInTheDocument();
		expect(store.model!.filters).toHaveLength(0);
		expect(onClose).not.toHaveBeenCalled();
	});

	it('pre-fills an existing filter and replaces it on apply', async () => {
		const { store } = setup();
		store.setFilter({ hopId: null, propertyIri: o('orgName'), op: 'eq', value: 'acme' });
		// Re-render against the updated model, as the workbench page does.
		cleanupAndRender(store);
		expect(screen.getByLabelText('Value')).toHaveValue('acme');
		await fireEvent.input(screen.getByLabelText('Value'), { target: { value: 'globex' } });
		await fireEvent.click(apply());
		expect(store.model!.filters).toHaveLength(1);
		expect(store.model!.filters[0].value).toBe('globex');
	});

	it('removes the existing filter', async () => {
		const { store, onClose } = setup();
		store.setFilter({ hopId: null, propertyIri: o('orgName'), op: 'eq', value: 'acme' });
		cleanupAndRender(store, onClose);
		await fireEvent.click(screen.getByTestId('filter-remove'));
		expect(store.model!.filters).toHaveLength(0);
		expect(onClose).toHaveBeenCalled();
	});

	it('cancel writes nothing', async () => {
		const { store, onClose } = setup();
		await fireEvent.input(screen.getByLabelText('Value'), { target: { value: 'acme' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(onClose).toHaveBeenCalled();
		expect(store.model!.filters).toHaveLength(0);
	});
});

function cleanupAndRender(store: QueryBuilderStore, onClose = vi.fn()) {
	document.body.innerHTML = '';
	render(FilterModal, {
		props: {
			isOpen: true,
			target: { kind: 'property', hopId: null, propertyIri: o('orgName') },
			model: store.model!,
			schema,
			store,
			onClose
		}
	});
}
