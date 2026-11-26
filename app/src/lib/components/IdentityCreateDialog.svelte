<script lang="ts">
	/**
	 * The one create dialog for an individual (spec/unify-instance-forms, STORY-004), extracted from the
	 * Identities page. It resolves the default namespace and relation options itself and mounts
	 * `MemberForm` only once they have arrived. Workspace-agnostic: hosts add side effects via `hooks`
	 * and their own `onCreated`.
	 */
	import { sparqlConnector } from '#lib/services/sparql-connector.js';
	import Modal from '#lib/components/Modal.svelte';
	import MemberForm from '#lib/components/MemberForm.svelte';
	import type { CanvasRelationFieldSpec, EntityNodeSpec } from '#lib/services/canvas-model.js';
	import { schemaStore } from '#lib/stores/schema-store.js';
	import { namespaceStore } from '#lib/stores/namespace-store.svelte.js';
	import { conceptOptionEntries, memberFormFields } from '#lib/services/concept-value-options.js';
	import { buildEntityNodeIndex } from '#lib/utils/identity-schema-index.js';
	import { createIdentity, resolveDefaultNamespace, type IdentityMutationHooks } from '#lib/utils/identity-mutations.js';
	import { DEFAULT_NAMESPACE_BASE_IRI } from '#lib/config.js';
	import type { AttributeValueSubmission } from '#lib/utils/attribute-values.js';
	import {
		relationTargetOptionsFromIndividuals,
		type RelationTargetOption,
		type RelationValueSubmission
	} from '#lib/utils/relation-values.js';

	interface Props {
		classIri: string;
		onClose: () => void;
		/** Fired after the identity was written (and `hooks.onCreated` ran), before the dialog closes. */
		onCreated?: (iri: string, label: string) => void | Promise<void>;
		hooks?: IdentityMutationHooks;
		/** Skips the lookup when the host already knows the namespace. */
		defaultNamespaceBaseIri?: string;
	}

	let { classIri, onClose, onCreated, hooks = {}, defaultNamespaceBaseIri }: Props = $props();

	let ready = $state(false);
	let loadError = $state<string | null>(null);
	let entityNodeByClassIri = $state<Map<string, EntityNodeSpec>>(new Map());
	let namespaceBaseIri = $state<string>(DEFAULT_NAMESPACE_BASE_IRI);
	let relationTargetOptions = $state<Record<string, RelationTargetOption[]>>({});

	const node = $derived(entityNodeByClassIri.get(classIri));
	const prefixFor = (base: string) => namespaceStore.namespaces.find((ns) => ns.baseIri === base)?.prefix ?? base;
	const title = $derived(node ? `Add ${prefixFor(node.namespace)}:${node.name} Identity` : 'Add Identity');

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

	$effect(() => {
		const target = classIri;
		let cancelled = false;
		ready = false;
		loadError = null;
		void (async () => {
			try {
				await namespaceStore.ensureLoaded();
				const index = buildEntityNodeIndex(await schemaStore.ensureLoaded('schema'));
				const fields = memberFormFields(index.get(target));
				const [ns, options] = await Promise.all([
					defaultNamespaceBaseIri ?? resolveDefaultNamespace(target, index, sparqlConnector),
					loadRelationTargetOptions(fields)
				]);
				if (cancelled) return;
				entityNodeByClassIri = index;
				namespaceBaseIri = ns ?? DEFAULT_NAMESPACE_BASE_IRI;
				relationTargetOptions = options;
				ready = true;
			} catch (err) {
				if (!cancelled) loadError = err instanceof Error ? err.message : 'Failed to load the form';
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	/** A thrown error (e.g. a duplicate label) propagates to `MemberForm`, which shows it inline. */
	async function handleSubmit(
		label: string,
		chosenNamespaceBaseIri?: string,
		attributeSubmissions: AttributeValueSubmission[] = [],
		identifier?: string,
		relationSubmissions: RelationValueSubmission[] = []
	) {
		const { iri } = await createIdentity(
			classIri,
			label,
			chosenNamespaceBaseIri ?? namespaceBaseIri,
			attributeSubmissions,
			identifier,
			relationSubmissions,
			sparqlConnector,
			hooks
		);
		onClose();
		await onCreated?.(iri, label);
	}
</script>

<Modal isOpen={true} {title} {onClose} dismissible={false}>
	{#if loadError}
		<p class="muted" role="alert">{loadError}</p>
	{:else if ready}
		<MemberForm
			mode="create"
			namespaceOptions={namespaceStore.namespaces}
			initialNamespaceBaseIri={namespaceBaseIri}
			submitLabel="Add"
			onCancel={onClose}
			onSubmit={handleSubmit}
			attributes={node?.attributes ?? []}
			labelRequired={node?.labelRequired ?? false}
			relationFields={memberFormFields(node)}
			{relationTargetOptions}
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
