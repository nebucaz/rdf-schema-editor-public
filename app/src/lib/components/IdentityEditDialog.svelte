<script lang="ts">
	/**
	 * The one edit dialog for an individual (spec/unify-instance-forms, STORY-003), extracted from
	 * `IdentityResourcePage`. Self-contained: it loads everything the form needs and mounts `MemberForm`
	 * only once that has arrived, because the form seeds its fields once at mount (the 1.14.2 bug was a
	 * host mounting it before its data). Hosts supply side effects through `hooks` and know nothing of it.
	 */
	import {
		sparqlConnector,
		type FetchedAssertion,
		type NameableEntity
	} from '#lib/services/sparql-connector.js';
	import Modal from '#lib/components/Modal.svelte';
	import MemberForm from '#lib/components/MemberForm.svelte';
	import type { CanvasRelationFieldSpec, EntityNodeSpec } from '#lib/services/canvas-model.js';
	import { schemaStore } from '#lib/stores/schema-store.js';
	import { namespaceStore } from '#lib/stores/namespace-store.svelte.js';
	import {
		buildEntityNodeIndex,
		resolveEditFormSpec,
		resolveGoverningClass
	} from '#lib/utils/identity-schema-index.js';
	import {
		addRelation,
		editIdentity,
		removeRelation,
		type IdentityMutationHooks
	} from '#lib/utils/identity-mutations.js';
	import { deriveResourceHeader } from '#lib/utils/resource-page-format.js';
	import { SYNC_SOURCE_PREDICATE_IRI } from '#lib/utils/iri.js';
	import type { AttributeValueSubmission } from '#lib/utils/attribute-values.js';
	import {
		relationTargetOptionsFromIndividuals,
		type RelationTargetOption,
		type RelationValueSubmission
	} from '#lib/utils/relation-values.js';
	import { conceptOptionEntries } from '#lib/services/concept-value-options.js';

	interface Props {
		iri: string;
		onClose: () => void;
		/** Fired after a successful save, before the dialog's host closes it; `classIri` is set when the class changed. */
		onSaved?: (result: { label: string; classIri?: string }) => void | Promise<void>;
		/** false (canvas): no class selector, never a `classChange`. */
		allowClassChange?: boolean;
		hooks?: IdentityMutationHooks;
		/** The Identities view's active class facet, preferred as governing class when the identity has it. */
		activeClassFacet?: string | null;
		title?: string;
	}

	let { iri, onClose, onSaved, allowClassChange = true, hooks = {}, activeClassFacet = null, title = 'Edit identity' }: Props =
		$props();

	let ready = $state(false);
	let loadError = $state<string | null>(null);
	let label = $state('');
	let typeIris = $state<string[]>([]);
	let synced = $state(false);
	let entityNodeByClassIri = $state<Map<string, EntityNodeSpec>>(new Map());
	let governingClassIri = $state<string | null>(null);
	let attributeValues = $state<Record<string, string | string[]>>({});
	let assertions = $state<FetchedAssertion[]>([]);
	let relationTargetOptions = $state<Record<string, RelationTargetOption[]>>({});

	const formSpec = $derived(resolveEditFormSpec(entityNodeByClassIri, governingClassIri));
	const prefixByBaseIri = $derived(new Map(namespaceStore.namespaces.map((ns) => [ns.baseIri, ns.prefix])));
	const prefixFor = (base: string) => prefixByBaseIri.get(base) ?? base;

	// Assertions typeahead options: lazy, after the form's own reads (loop-issues STORY-315/297).
	let assertionPredicateOptions = $state<{ iri: string; label: string }[]>([]);
	let assertionObjectOptions = $state<NameableEntity[]>([]);
	let assertionOptionsStatus = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');

	function ensureAssertionOptionsLoaded() {
		if (assertionOptionsStatus === 'loading' || assertionOptionsStatus === 'ready') return;
		assertionOptionsStatus = 'loading';
		void (async () => {
			try {
				const schema = await schemaStore.ensureLoaded('full');
				const [predicateOptions, objectOptions] = await Promise.all([
					sparqlConnector.fetchRelationPredicateOptions(schema),
					sparqlConnector.fetchNameableEntities(schema)
				]);
				assertionPredicateOptions = predicateOptions;
				assertionObjectOptions = objectOptions;
				assertionOptionsStatus = 'ready';
			} catch {
				assertionOptionsStatus = 'error';
			}
		})();
	}

	async function loadRelationTargetOptions(
		relationFields: CanvasRelationFieldSpec[]
	): Promise<Record<string, RelationTargetOption[]>> {
		const entries = await Promise.all(
			relationFields.map(async (rel): Promise<[string, RelationTargetOption[]][]> => {
				if (rel.valueSchemeIri) return conceptOptionEntries(sparqlConnector, rel);
				const options = await sparqlConnector.fetchIndividualsOfClass(rel.targetClassIri);
				return [[rel.iri, relationTargetOptionsFromIndividuals(options, prefixFor)]];
			})
		);
		return Object.fromEntries(entries.flat());
	}

	async function reloadAssertions() {
		assertions = await sparqlConnector.fetchAssertionsForIndividual(iri);
	}

	$effect(() => {
		const target = iri;
		let cancelled = false;
		ready = false;
		loadError = null;
		void (async () => {
			try {
				await namespaceStore.ensureLoaded();
				const [page, schema] = await Promise.all([
					sparqlConnector.fetchResourcePage(target),
					schemaStore.ensureLoaded('schema')
				]);
				const header = deriveResourceHeader(target, page.outgoing);
				const index = buildEntityNodeIndex(schema);
				const governing = resolveGoverningClass(header.typeIris, activeClassFacet);
				const spec = resolveEditFormSpec(index, governing);
				const [loadedAssertions, loadedValues, loadedOptions] = await Promise.all([
					sparqlConnector.fetchAssertionsForIndividual(target),
					spec.attributes.length > 0
						? sparqlConnector.fetchIndividualAttributeValues(target, spec.attributes)
						: Promise.resolve({} as Record<string, string | string[]>),
					spec.relationFields.length > 0 ? loadRelationTargetOptions(spec.relationFields) : Promise.resolve({})
				]);
				if (cancelled) return;
				label = header.label;
				typeIris = header.typeIris;
				synced = page.outgoing.some((t) => t.predicateIri === SYNC_SOURCE_PREDICATE_IRI);
				entityNodeByClassIri = index;
				governingClassIri = governing;
				assertions = loadedAssertions;
				attributeValues = loadedValues;
				relationTargetOptions = loadedOptions;
				ready = true;
				// After the form's own reads, so the 12-request schema load does not queue them.
				ensureAssertionOptionsLoaded();
			} catch (err) {
				if (!cancelled) loadError = err instanceof Error ? err.message : 'Failed to load identity';
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	const classOptions = $derived(
		[...entityNodeByClassIri.values()]
			.map((c) => ({ iri: c.iri, label: `[${prefixByBaseIri.get(c.namespace) ?? c.namespace}] ${c.name}` }))
			.sort((a, b) => a.label.localeCompare(b.label))
	);

	function fieldsOfClass(classIriValue: string): { iri: string; name: string }[] {
		const spec = entityNodeByClassIri.get(classIriValue);
		return [...(spec?.attributes ?? []), ...(spec?.relationFields ?? [])].map((f) => ({ iri: f.iri, name: f.name }));
	}

	async function handleSubmit(
		newLabel: string,
		_namespaceBaseIri?: string,
		attributeSubmissions: AttributeValueSubmission[] = [],
		_identifier?: string,
		relationSubmissions: RelationValueSubmission[] = [],
		classChange?: { classIri: string; dropPredicateIris: string[] }
	) {
		if (!allowClassChange) classChange = undefined;
		if (classChange) {
			// retype first, so the writes below land on the new class; dropped values were just deleted
			await sparqlConnector.changeIndividualClass(iri, classChange.classIri, {
				dropPredicateIris: classChange.dropPredicateIris
			});
			const dropped = new Set(classChange.dropPredicateIris);
			attributeSubmissions = attributeSubmissions.filter((a) => !dropped.has(a.attributeIri));
			relationSubmissions = relationSubmissions.filter((r) => !dropped.has(r.predicateIri));
		}
		await editIdentity(iri, newLabel, label, attributeSubmissions, relationSubmissions, sparqlConnector, hooks);
		await onSaved?.({ label: newLabel, classIri: classChange?.classIri });
		onClose();
	}
</script>

<Modal isOpen={true} {title} {onClose} dismissible={false}>
	{#if loadError}
		<p class="muted" role="alert">{loadError}</p>
	{:else if ready}
		<MemberForm
			mode="edit"
			initialLabel={label}
			submitLabel="Save"
			onCancel={onClose}
			onSubmit={handleSubmit}
			individualIri={iri}
			{assertions}
			predicateOptions={assertionPredicateOptions}
			objectOptions={assertionObjectOptions}
			optionsStatus={assertionOptionsStatus === 'idle' ? 'loading' : assertionOptionsStatus}
			attributes={formSpec.attributes}
			{attributeValues}
			labelRequired={formSpec.labelRequired}
			relationFields={formSpec.relationFields}
			{relationTargetOptions}
			classOptions={allowClassChange && typeIris.length <= 1 ? classOptions : undefined}
			classIri={typeIris[0] ?? ''}
			classLocked={synced}
			onPlanClassChange={fieldsOfClass}
			onAddAssertion={async (predicateLabel, objectIri) => {
				await addRelation(iri, predicateLabel, objectIri, sparqlConnector, hooks);
				await reloadAssertions();
			}}
			onDeleteAssertion={async (predicateIri, objectIri) => {
				await removeRelation(iri, predicateIri, objectIri, sparqlConnector, hooks);
				await reloadAssertions();
			}}
			onAddRelation={(predicateLabel, objectIri) => addRelation(iri, predicateLabel, objectIri, sparqlConnector, hooks).then(() => {})}
			onRemoveRelation={(predicateIri, objectIri) => removeRelation(iri, predicateIri, objectIri, sparqlConnector, hooks)}
		/>
	{:else}
		<p class="muted">Loading…</p>
	{/if}
</Modal>

<style>
	.muted {
		color: var(--color-text-muted);
	}
</style>
