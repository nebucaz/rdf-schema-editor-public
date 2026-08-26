<script lang="ts">
	import { onMount } from 'svelte';
	import { mode } from 'mode-watcher';
	import {
		SvelteFlow,
		Background,
		Controls,
		MiniMap,
		BackgroundVariant,
		type Edge,
		type Connection,
		type Node,
		type OnConnectEnd
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import EntityNode, {
		type EntityAttributeVM,
		type EntityMemberVM,
		type EntityNodeData,
		type EntityNodeType
	} from '$lib/components/EntityNode.svelte';
	import ExternalClassNode, {
		type ExternalClassNodeData,
		type ExternalClassNodeType
	} from '$lib/components/ExternalClassNode.svelte';
	import RelationEdge, { type RelationEdgeData } from '$lib/components/RelationEdge.svelte';
	import AttributedLinkEdge, { type AttributedLinkEdgeData } from '$lib/components/AttributedLinkEdge.svelte';
	import InheritanceEdge, { type InheritanceEdgeData } from '$lib/components/InheritanceEdge.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import EntityForm from '$lib/components/EntityForm.svelte';
	import AttributeForm from '$lib/components/AttributeForm.svelte';
	import ManageMembersModal from '$lib/components/ManageMembersModal.svelte';
	import RelationForm from '$lib/components/RelationForm.svelte';
	import AssociationForm from '$lib/components/AssociationForm.svelte';
	import AssociationEditForm, { type AssociationEditLinkRow } from '$lib/components/AssociationEditForm.svelte';
	import ExternalClassForm from '$lib/components/ExternalClassForm.svelte';
	import TriplesPanel from '$lib/components/TriplesPanel.svelte';
	import { sparqlConnector, type AssociationLink } from '$lib/services/sparql-connector';
	import { namespaceStore } from '$lib/stores/namespace-store.svelte';
	import { externalVocabStore } from '$lib/stores/external-vocab-store.svelte';
	import { buildCanvasModel } from '$lib/services/canvas-model';
	import { layoutStore, resolvePositions } from '$lib/stores/layout-store';
	import { nodeColorStore } from '$lib/stores/node-color-store';
	import { activeNamespaceStore } from '$lib/stores/active-namespace-store';
	import { namespaceVisibilityStore } from '$lib/stores/namespace-visibility-store';
	import { workbenchActions } from '$lib/stores/workbench-actions.svelte';
	import { DEFAULT_NAMESPACE_BASE_IRI } from '$lib/config';
	import { extractLocalName, type XsdDatatype } from '$lib/utils/iri';
	import { exportCanvasAsSvg } from '$lib/utils/svg-export';

	type CanvasNode = EntityNodeType | ExternalClassNodeType;

	const nodeTypes = { entity: EntityNode, external: ExternalClassNode };
	const edgeTypes = { relation: RelationEdge, attributedLink: AttributedLinkEdge, inheritance: InheritanceEdge };

	let nodes = $state.raw<CanvasNode[]>([]);
	let edges = $state.raw<Edge[]>([]);
	let errorMessage = $state<string | null>(null);
	let loading = $state(false);

	// -- Viewport-aware placement for newly created nodes ------------------------------------------
	// Tracks the live pan/zoom state (bound two-way to <SvelteFlow>) and the canvas container's
	// on-screen size, so new nodes can be centered in whatever's currently visible instead of a grid
	// anchored at flow-space (0,0) — which drifts off-screen the moment the user pans or zooms.
	let viewport = $state({ x: 0, y: 0, zoom: 1 });
	let canvasWidth = $state(0);
	let canvasHeight = $state(0);
	let canvasWrapEl = $state<HTMLDivElement | undefined>();

	/** Converts a screen/client coordinate (e.g. `MouseEvent.clientX/clientY`) into flow-space,
	 *  for placements the user pinpoints directly (STORY-066's Option/Alt-drag-drop position) rather than
	 *  `nextPosition()`'s viewport-centered grid slot. Mirrors `@xyflow/svelte`'s own
	 *  `screenToFlowPosition` math (subtract the pane's screen offset and the viewport's pan, then
	 *  undo its zoom) — reimplemented locally since `useSvelteFlow()` requires a `<SvelteFlowProvider>`
	 *  ancestor this page doesn't have. */
	function screenToFlowPosition(clientX: number, clientY: number) {
		const rect = canvasWrapEl?.getBoundingClientRect();
		return {
			x: (clientX - (rect?.left ?? 0) - viewport.x) / viewport.zoom,
			y: (clientY - (rect?.top ?? 0) - viewport.y) / viewport.zoom
		};
	}

	// -- Export as SVG (STORY-067) ------------------------------------------------------------------

	let exportingSvg = $state(false);

	/** Browser-native download — same Blob+`<a download>` pattern as `TriplesPanel`'s `downloadTurtle`
	 *  (STORY-067 AC: no new download mechanism). */
	function downloadFile(filename: string, text: string, mimeType: string) {
		const blob = new Blob([text], { type: mimeType });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function handleExportSvg() {
		const viewportEl = canvasWrapEl?.querySelector<HTMLElement>('.svelte-flow__viewport');
		if (!viewportEl) return;
		exportingSvg = true;
		errorMessage = null;
		try {
			const selectedNodeIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
			const svg = await exportCanvasAsSvg(viewportEl, nodes, edges, selectedNodeIds);
			const filename = selectedNodeIds.size > 0 ? 'schema-selection.svg' : 'schema-diagram.svg';
			downloadFile(filename, svg, 'image/svg+xml');
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to export SVG';
		} finally {
			exportingSvg = false;
		}
	}

	// -- Namespace assignment on entry forms (STORY-032) ------------------------------------------

	function activeNamespaceBaseIri(): string {
		return activeNamespaceStore.getActive() ?? DEFAULT_NAMESPACE_BASE_IRI;
	}

	// -- Namespace filter in the workbench (STORY-033, persisted per STORY-040) --------------------
	// Client-side view filter only (Decision 6): toggling never re-queries GraphDB, it just flips
	// each already-loaded node/edge's `hidden` flag based on the namespace it was tagged with by
	// `loadSchemaFromGraphDB` below. `nodeNamespaces` records that tag per node id so a later toggle
	// can recompute `hidden` without needing `buildCanvasModel`'s output again.
	// The hidden set itself is backed by `namespaceVisibilityStore` (localStorage), which also seeds
	// the app's own built-in default namespace as hidden on first use.
	//
	// An edge's own `namespace` tag (STORY-061) is deliberately *not* used for edge visibility — it's
	// write-path/graph-selection metadata (Decision 8, the source class's namespace), not a
	// visibility signal. An edge is hidden whenever *either* endpoint's node namespace is hidden,
	// computed via `isEndpointVisible` below against the same `nodeNamespaces` map node visibility
	// already uses — so the two can never drift apart.

	let hiddenNamespaces = $state<Set<string>>(namespaceVisibilityStore.getHidden());
	let nodeNamespaces = new Map<string, string>();

	/** A node id with no `nodeNamespaces` entry is an external stub (`ExternalNodeSpec` carries no
	 *  `namespace` field) — always treated as visible, matching its existing node-visibility
	 *  behavior (STORY-061 AC). */
	function isEndpointVisible(nodeId: string, namespaces: Map<string, string>, hidden: Set<string>): boolean {
		const ns = namespaces.get(nodeId);
		return ns === undefined || !hidden.has(ns);
	}

	function isEdgeHidden(source: string, target: string, namespaces: Map<string, string>, hidden: Set<string>): boolean {
		return !isEndpointVisible(source, namespaces, hidden) || !isEndpointVisible(target, namespaces, hidden);
	}

	function toggleNamespaceVisibility(baseIri: string) {
		const next = new Set(hiddenNamespaces);
		if (next.has(baseIri)) {
			next.delete(baseIri);
			namespaceVisibilityStore.setHidden(baseIri, false);
		} else {
			next.add(baseIri);
			namespaceVisibilityStore.setHidden(baseIri, true);
		}
		hiddenNamespaces = next;
		nodes = nodes.map((n) => {
			const ns = nodeNamespaces.get(n.id);
			return ns === undefined ? n : { ...n, hidden: next.has(ns) };
		});
		edges = edges.map((e) => ({ ...e, hidden: isEdgeHidden(e.source, e.target, nodeNamespaces, next) }));
	}

	// -- Raw triples view (STORY-011/012/013) ----------------------------------------------------

	let showTriplesPanel = $state(false);

	/** STORY-039: the Triples panel's scope is intentionally decoupled from canvas selection — the
	 *  hamburger's "View Triples" always opens to the whole graph (`null`) regardless of what's
	 *  selected on canvas, so a stale canvas selection can't silently filter the panel.
	 *  STORY-043's per-entity Triples icon will set this explicitly instead. */
	let triplesPanelScopeIri = $state<string | null>(null);

	function findNode(id: string | null): CanvasNode | undefined {
		return id ? nodes.find((n) => n.id === id) : undefined;
	}

	function findEntityNode(id: string | null): EntityNodeType | undefined {
		const n = findNode(id);
		return n && n.type === 'entity' ? n : undefined;
	}

	function findEdge(id: string | null): Edge | undefined {
		return id ? edges.find((e) => e.id === id) : undefined;
	}

	function nextPosition() {
		const width = canvasWidth || 800;
		const height = canvasHeight || 600;
		const centerX = (width / 2 - viewport.x) / viewport.zoom;
		const centerY = (height / 2 - viewport.y) / viewport.zoom;
		const i = nodes.length;
		const col = i % 4;
		const row = Math.floor(i / 4) % 4;
		return { x: centerX - 390 + col * 260, y: centerY - 220 + row * 220 };
	}

	const entityOptions = $derived(
		nodes
			.filter((n): n is EntityNodeType => n.type === 'entity')
			.map((n) => ({ iri: n.id, name: n.data.name }))
	);

	// -- Entities (STORY-004) -------------------------------------------------------------------

	let showAddEntity = $state(false);
	/** STORY-066: Option/Alt+drag a connection from an entity's handle onto empty canvas — captures the
	 *  drag's origin node and drop position while the "Create Entity" dialog it opens is pending, so
	 *  the entity created from it can chain straight into `pendingRelationCreate` on submit. */
	let pendingEntityFromConnection = $state<{ sourceNodeId: string; position: { x: number; y: number } } | null>(
		null
	);
	/** Plain (no-modifier) drag-release onto empty canvas: shows a small context menu offering the
	 *  same "Add Entity" fast-path Option/Alt+drag opens, plus "Add External Class". `screenPosition`
	 *  positions the menu itself; `flowPosition` is where the eventual new node lands. */
	let pendingConnectionContextMenu = $state<{
		sourceNodeId: string;
		screenPosition: { x: number; y: number };
		flowPosition: { x: number; y: number };
	} | null>(null);
	/** "Add External Class" chosen from that context menu — mirrors `pendingEntityFromConnection`,
	 *  but the submitted node is an external stub placed at the drop position, linked back to the
	 *  drag's origin with an inheritance edge (matching `handleConnect`'s existing rule that any
	 *  connection landing on an external class node is always "is-a", never a plain relation). */
	let pendingExternalClassFromConnection = $state<{ sourceNodeId: string; position: { x: number; y: number } } | null>(
		null
	);
	let editEntityId = $state<string | null>(null);
	let deleteEntityId = $state<string | null>(null);
	let deleteEntityWarning = $state<{ externalReferences: string[]; subClassReferences: string[] } | null>(
		null
	);
	let deleteEntityBusy = $state(false);

	/** A namespace's default color (STORY-042), the middle tier between a node's own `color`
	 *  override and the static association/plain theme default. */
	function namespaceColorFor(namespaceBaseIri: string | undefined): string | undefined {
		return namespaceStore.namespaces.find((ns) => ns.baseIri === namespaceBaseIri)?.color ?? undefined;
	}

	function makeNodeData(
		classIriValue: string,
		name: string,
		description: string,
		attributes: EntityAttributeVM[],
		namespaceBaseIri: string | undefined,
		color?: string,
		members: EntityMemberVM[] = []
	): EntityNodeData {
		const isAssociationClass = lastAssociationClassIris.has(classIriValue);
		return {
			classIri: classIriValue,
			name,
			description,
			color,
			namespaceColor: namespaceColorFor(namespaceBaseIri),
			attributes,
			members,
			isAssociationClass,
			onEdit: () => {
				if (isAssociationClass) {
					editAssociationId = classIriValue;
				} else {
					editEntityId = classIriValue;
				}
			},
			onDelete: () => {
				deleteEntityId = classIriValue;
				deleteEntityWarning = null;
			},
			onAddAttribute: () => {
				attributeModal = { classIri: classIriValue };
			},
			onEditAttribute: (attribute: EntityAttributeVM) => {
				attributeModal = { classIri: classIriValue, attribute };
			},
			onDeleteAttribute: (attribute: EntityAttributeVM) => {
				deleteAttributeTarget = { classIri: classIriValue, attribute };
			},
			onManageInstances: () => {
				manageMembersClassIri = classIriValue;
			},
			onViewTriples: () => {
				triplesPanelScopeIri = classIriValue;
				showTriplesPanel = true;
			}
		};
	}

	function updateNodeData(classIriValue: string, updater: (data: EntityNodeData) => EntityNodeData) {
		nodes = nodes.map((n) => (n.id === classIriValue && n.type === 'entity' ? { ...n, data: updater(n.data) } : n));
	}

	async function handleCreateEntity(
		name: string,
		description: string,
		color: string | undefined,
		namespaceBaseIri?: string
	) {
		const resolvedNamespaceBaseIri = namespaceBaseIri ?? activeNamespaceBaseIri();
		const { iri } = await sparqlConnector.insertClass(name, description || undefined, resolvedNamespaceBaseIri);
		if (color) nodeColorStore.setColor(iri, color);
		nodeNamespaces.set(iri, resolvedNamespaceBaseIri);
		const newNode: EntityNodeType = {
			id: iri,
			type: 'entity',
			position: nextPosition(),
			data: makeNodeData(iri, name, description, [], resolvedNamespaceBaseIri, color)
		};
		nodes = [...nodes, newNode];
		showAddEntity = false;
	}

	/** STORY-066: submit handler for the "Create Entity" dialog opened by an Option/Alt-drag-to-empty-canvas
	 *  gesture — places the entity at the exact drop position (not `nextPosition()`'s grid slot), then
	 *  immediately chains into the existing "Add Relation" dialog (`pendingRelationCreate`,
	 *  `handleCreateRelationSubmit` unmodified) linking it back to the drag's origin node. Per this
	 *  plan's ADR, cancelling that relation dialog afterwards leaves the entity on canvas unlinked —
	 *  no rollback of the already-committed `insertClass`. */
	async function handleCreateEntityFromConnectionSubmit(
		name: string,
		description: string,
		color: string | undefined,
		namespaceBaseIri?: string
	) {
		if (!pendingEntityFromConnection) return;
		const { sourceNodeId, position } = pendingEntityFromConnection;
		const resolvedNamespaceBaseIri = namespaceBaseIri ?? activeNamespaceBaseIri();
		const { iri } = await sparqlConnector.insertClass(name, description || undefined, resolvedNamespaceBaseIri);
		if (color) nodeColorStore.setColor(iri, color);
		nodeNamespaces.set(iri, resolvedNamespaceBaseIri);
		const newNode: EntityNodeType = {
			id: iri,
			type: 'entity',
			position,
			data: makeNodeData(iri, name, description, [], resolvedNamespaceBaseIri, color)
		};
		nodes = [...nodes, newNode];
		pendingEntityFromConnection = null;
		pendingRelationCreate = { source: sourceNodeId, target: iri, sourceHandle: null, targetHandle: null };
		void loadGenericRelationOptions(sourceNodeId);
	}

	async function handleEditEntitySubmit(name: string, description: string, color: string | undefined) {
		if (!editEntityId) return;
		const node = findEntityNode(editEntityId);
		if (!node) return;

		const entityNamespaceBaseIri = nodeNamespaces.get(node.data.classIri) ?? activeNamespaceBaseIri();
		if (name !== node.data.name) {
			await sparqlConnector.renameClass(node.data.classIri, name, entityNamespaceBaseIri);
		}
		if (description !== node.data.description) {
			await sparqlConnector.updateClassDescription(node.data.classIri, description || null, entityNamespaceBaseIri);
		}
		nodeColorStore.setColor(node.data.classIri, color);
		updateNodeData(editEntityId, (d) =>
			makeNodeData(d.classIri, name, description, d.attributes, nodeNamespaces.get(d.classIri), color, d.members)
		);
		editEntityId = null;
	}

	async function handleDeleteEntityConfirm(force: boolean) {
		if (!deleteEntityId) return;
		const classIriValue = deleteEntityId;
		deleteEntityBusy = true;
		errorMessage = null;
		try {
			const namespaceBaseIri = nodeNamespaces.get(classIriValue) ?? activeNamespaceBaseIri();
			const result = await sparqlConnector.deleteClass(classIriValue, { force }, namespaceBaseIri);
			if (!result.deleted) {
				deleteEntityWarning = {
					externalReferences: result.externalReferences,
					subClassReferences: result.subClassReferences.map((ref) => ref.subIri)
				};
				return;
			}
			nodes = nodes.filter((n) => n.id !== classIriValue);
			edges = edges.filter((e) => e.source !== classIriValue && e.target !== classIriValue);
			deleteEntityId = null;
			deleteEntityWarning = null;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to delete entity';
		} finally {
			deleteEntityBusy = false;
		}
	}

	const editingNode = $derived(findEntityNode(editEntityId));
	const deletingNode = $derived(findEntityNode(deleteEntityId));

	// -- Attributes (STORY-005) -------------------------------------------------------------------

	let attributeModal = $state<{ classIri: string; attribute?: EntityAttributeVM } | null>(null);
	let deleteAttributeTarget = $state<{ classIri: string; attribute: EntityAttributeVM } | null>(null);
	let deleteAttributeBusy = $state(false);

	async function handleAttributeSubmit(
		name: string,
		datatype: XsdDatatype,
		required: boolean,
		repeatable: boolean
	) {
		if (!attributeModal) return;
		const node = findEntityNode(attributeModal.classIri);
		if (!node) return;
		const editingAttribute = attributeModal.attribute;
		const attrNamespaceBaseIri = nodeNamespaces.get(node.data.classIri) ?? activeNamespaceBaseIri();

		if (editingAttribute) {
			await sparqlConnector.updateDatatypeProperty(
				node.data.classIri,
				editingAttribute.iri,
				{
					name,
					datatype,
					required,
					repeatable
				},
				attrNamespaceBaseIri
			);
			updateNodeData(node.id, (d) => ({
				...d,
				attributes: d.attributes.map((a: EntityAttributeVM) =>
					a.iri === editingAttribute.iri ? { ...a, name, datatype, required, repeatable } : a
				)
			}));
		} else {
			const { iri } = await sparqlConnector.insertDatatypeProperty(
				node.data.classIri,
				name,
				datatype,
				required,
				repeatable,
				attrNamespaceBaseIri
			);
			updateNodeData(node.id, (d) => ({
				...d,
				attributes: [...d.attributes, { iri, name, datatype, required, repeatable }]
			}));
		}
		attributeModal = null;
	}

	async function handleDeleteAttributeConfirm() {
		if (!deleteAttributeTarget) return;
		const { classIri: classIriValue, attribute } = deleteAttributeTarget;
		const node = findEntityNode(classIriValue);
		if (!node) return;
		deleteAttributeBusy = true;
		errorMessage = null;
		try {
			const namespaceBaseIri = nodeNamespaces.get(classIriValue) ?? activeNamespaceBaseIri();
			await sparqlConnector.deleteDatatypeProperty(attribute.iri, classIriValue, namespaceBaseIri);
			updateNodeData(classIriValue, (d) => ({
				...d,
				attributes: d.attributes.filter((a: EntityAttributeVM) => a.iri !== attribute.iri)
			}));
			deleteAttributeTarget = null;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to delete attribute';
		} finally {
			deleteAttributeBusy = false;
		}
	}

	// -- Individuals / enumerated class members (STORY-019), managed via a modal (STORY-023) ------

	/** Which class's members are currently being managed — drives the "Manage Instances" modal.
	 *  Not offered for attributed-relationship classes (`EntityNode`'s icon is gated on
	 *  `isAssociationClass`, STORY-020's marker), so this is only ever set for a plain entity. */
	let manageMembersClassIri = $state<string | null>(null);
	const manageMembersNode = $derived(findEntityNode(manageMembersClassIri));

	async function handleAddMember(label: string, namespaceBaseIri?: string) {
		if (!manageMembersClassIri) return;
		const { iri } = await sparqlConnector.insertIndividual(
			manageMembersClassIri,
			label,
			namespaceBaseIri ?? activeNamespaceBaseIri()
		);
		updateNodeData(manageMembersClassIri, (d) => ({ ...d, members: [...d.members, { iri, label }] }));
	}

	async function handleEditMember(member: EntityMemberVM, label: string) {
		if (!manageMembersClassIri) return;
		const namespaceBaseIri = nodeNamespaces.get(manageMembersClassIri) ?? activeNamespaceBaseIri();
		await sparqlConnector.renameIndividual(member.iri, label, namespaceBaseIri);
		updateNodeData(manageMembersClassIri, (d) => ({
			...d,
			members: d.members.map((m) => (m.iri === member.iri ? { ...m, label } : m))
		}));
	}

	async function handleDeleteMember(member: EntityMemberVM) {
		if (!manageMembersClassIri) return;
		const namespaceBaseIri = nodeNamespaces.get(manageMembersClassIri) ?? activeNamespaceBaseIri();
		await sparqlConnector.deleteIndividual(member.iri, namespaceBaseIri);
		updateNodeData(manageMembersClassIri, (d) => ({
			...d,
			members: d.members.filter((m) => m.iri !== member.iri)
		}));
	}

	/** Classes currently carrying the `AttributedRelationship` marker (STORY-020) — read directly
	 *  off `buildCanvasModel`'s output, itself derived from the persisted `rdfs:subClassOf` triple. */
	let lastAssociationClassIris = $state<Set<string>>(new Set());

	// -- Relations (STORY-006) + edge-kind choice on connect -------------------------------------

	let pendingConnectionChoice = $state<Connection | null>(null);
	let pendingRelationCreate = $state<Connection | null>(null);
	let editRelationEdgeId = $state<string | null>(null);
	let deleteRelationEdgeId = $state<string | null>(null);
	let deleteRelationBusy = $state(false);
	let deleteInheritanceEdgeId = $state<string | null>(null);
	let deleteInheritanceBusy = $state(false);

	/** Whether the pending drag-connection starts from a node currently treated as an association
	 *  class — if so, the "what kind of connection?" modal offers "Attributed Link" as a third
	 *  choice alongside plain relation / is-a. */
	const pendingConnectionIsFromAssociation = $derived(
		!!pendingConnectionChoice?.source && lastAssociationClassIris.has(pendingConnectionChoice.source)
	);
	let pendingLinkCreate = $state<Connection | null>(null);
	let editLinkEdgeId = $state<string | null>(null);
	let deleteLinkEdgeId = $state<string | null>(null);
	let deleteLinkBusy = $state(false);

	/** Existing generic relations (STORY-051/053) in the source class's namespace, refreshed
	 *  whenever the "Add/Edit Relation" dialog opens — feeds `RelationForm`'s "reuse an existing
	 *  generic relation" autocomplete. */
	let genericRelationOptions = $state<{ iri: string; label: string }[]>([]);

	async function loadGenericRelationOptions(sourceClassIri: string) {
		const namespaceBaseIri = nodeNamespaces.get(sourceClassIri) ?? activeNamespaceBaseIri();
		try {
			genericRelationOptions = await sparqlConnector.listGenericObjectProperties(namespaceBaseIri);
		} catch (err) {
			// Every call site fires this with `void` (fire-and-forget, so the dialog can open without
			// waiting on the network round-trip) — without a catch here, a failed fetch would silently
			// leave `genericRelationOptions` at its last value with no user-visible sign anything went
			// wrong, indistinguishable from "this namespace genuinely has no generic relations yet".
			genericRelationOptions = [];
			errorMessage =
				err instanceof Error ? `Failed to load existing generic relations: ${err.message}` : 'Failed to load existing generic relations';
		}
	}

	/**
	 * The Svelte Flow edge `id` for a relation edge (STORY-054). A *specific* relation's property
	 * IRI is already unique per source class (`propertyIri()`'s owner-class-scoped scheme), but a
	 * *generic* relation's property IRI (STORY-051/052) is shared across every source class reusing
	 * it — so `propIri` alone can't serve as the id once two edges reuse the same generic relation
	 * from different source classes (drawing a second one, or reloading from GraphDB, would produce
	 * two edges with the same id). A generic relation can also fan out to *several* targets from the
	 * *same* source class (merged into one `sh:or`-constrained `sh:property` entry rather than
	 * rejected as a duplicate — see `sparql-connector.ts`'s `rewriteGenericPropertyShapeTargets`),
	 * so `sourceClassIri` alone isn't enough either once two edges share both `propIri` and source.
	 * Composing with `targetClassIri` too keeps it unique in every case; a space is a safe separator
	 * since `assertSafeSparqlIri` rejects whitespace in any IRI.
	 */
	function relationEdgeId(propIri: string, sourceClassIri: string, targetClassIri: string): string {
		return `${propIri} ${sourceClassIri} ${targetClassIri}`;
	}

	function makeRelationEdgeData(
		edgeId: string,
		propIri: string,
		sourceClassIri: string,
		name: string,
		required: boolean,
		repeatable: boolean,
		kind: 'specific' | 'generic' = 'specific'
	): RelationEdgeData {
		return {
			name,
			required,
			repeatable,
			kind,
			propIri,
			onEdit: () => {
				editRelationEdgeId = edgeId;
				void loadGenericRelationOptions(sourceClassIri);
			},
			onDelete: () => {
				deleteRelationEdgeId = edgeId;
			}
		};
	}

	function handleConnect(connection: Connection) {
		if (!connection.source || !connection.target) return;
		// @xyflow/svelte auto-inserts a plain untyped edge into `edges` on every successful drag
		// connection (see `onConnectExtended` in its Handle.svelte), before this callback runs. This
		// app always creates edges with an explicit `type` ('relation'/'attributedLink'/'inheritance')
		// via the modal flow below, so that auto-inserted edge is always a ghost — strip it here,
		// otherwise it lingers on the canvas with no label and no way to delete it if the user
		// cancels the modal.
		edges = edges.filter((e) => e.type !== undefined);
		const targetNode = findNode(connection.target);
		if (targetNode?.type === 'external') {
			void createInheritanceEdge(connection.source, connection.target);
		} else {
			pendingConnectionChoice = connection;
		}
	}

	/** STORY-066: Option/Alt+drag a connection from an entity's handle onto empty canvas space to
	 *  create a new entity there and chain straight into relation creation. `toNode === null` is
	 *  Svelte Flow's own signal for "dropped on the pane, not on a handle" — no heuristic needed —
	 *  and this is mouse-only (`event instanceof MouseEvent`) since touch drags carry no modifier
	 *  keys. `altKey` (not `ctrlKey`) so the gesture doesn't collide with macOS's Ctrl+click ->
	 *  context-menu behavior. A plain (no-modifier) drop on empty canvas opens a small context menu
	 *  instead (`pendingConnectionContextMenu`) offering the same "Add Entity" fast-path plus "Add
	 *  External Class" — Option/Alt+drag remains a shortcut straight to the former. Dropping onto an
	 *  existing node falls through untouched, leaving `handleConnect`'s modal-choice flow as-is. */
	const handleConnectEnd: OnConnectEnd = (event, connectionState) => {
		if (connectionState.toNode !== null) return;
		if (!connectionState.fromNode) return;
		if (!(event instanceof MouseEvent)) return;
		const sourceNodeId = connectionState.fromNode.id;
		const flowPosition = screenToFlowPosition(event.clientX, event.clientY);
		if (event.altKey) {
			pendingEntityFromConnection = { sourceNodeId, position: flowPosition };
			return;
		}
		pendingConnectionContextMenu = {
			sourceNodeId,
			screenPosition: { x: event.clientX, y: event.clientY },
			flowPosition
		};
	};

	/** "Add Entity" chosen from the plain-drop context menu — same destination state as the
	 *  Option/Alt+drag fast-path, so `EntityForm`'s existing chained-into-`RelationForm` submit
	 *  handler (`handleCreateEntityFromConnectionSubmit`) needs no changes. */
	function chooseAddEntityFromContextMenu() {
		if (!pendingConnectionContextMenu) return;
		pendingEntityFromConnection = {
			sourceNodeId: pendingConnectionContextMenu.sourceNodeId,
			position: pendingConnectionContextMenu.flowPosition
		};
		pendingConnectionContextMenu = null;
	}

	/** "Add External Class" chosen from the plain-drop context menu. */
	function chooseAddExternalClassFromContextMenu() {
		if (!pendingConnectionContextMenu) return;
		pendingExternalClassFromConnection = {
			sourceNodeId: pendingConnectionContextMenu.sourceNodeId,
			position: pendingConnectionContextMenu.flowPosition
		};
		pendingConnectionContextMenu = null;
	}

	/** Submit handler for `pendingExternalClassFromConnection`'s `ExternalClassForm`: places the
	 *  external stub at the drag's drop position (mirroring `handleCreateEntityFromConnectionSubmit`,
	 *  unlike the stand-alone "+ Add External Class" flow's `nextPosition()`), then immediately links
	 *  it back to the drag's origin with an inheritance edge — no relation-kind dialog, matching
	 *  `handleConnect`'s existing rule that any connection landing on an external class is "is-a". */
	function handleAddExternalClassFromConnectionSubmit(prefixedName: string, iri: string) {
		if (!pendingExternalClassFromConnection) return;
		const { sourceNodeId, position } = pendingExternalClassFromConnection;
		if (nodes.some((n) => n.id === iri)) {
			errorMessage = `${prefixedName} is already on the canvas`;
			pendingExternalClassFromConnection = null;
			return;
		}
		const newNode: ExternalClassNodeType = {
			id: iri,
			type: 'external',
			position,
			data: {
				prefixedName,
				onRemove: () => {
					void handleRemoveExternalStub(iri);
				}
			} satisfies ExternalClassNodeData
		};
		nodes = [...nodes, newNode];
		pendingExternalClassFromConnection = null;
		void createInheritanceEdge(sourceNodeId, iri);
	}

	function chooseRelation() {
		if (!pendingConnectionChoice?.source) return;
		pendingRelationCreate = pendingConnectionChoice;
		pendingConnectionChoice = null;
		void loadGenericRelationOptions(pendingRelationCreate.source);
	}

	function chooseAttributedLink() {
		if (!pendingConnectionChoice) return;
		pendingLinkCreate = pendingConnectionChoice;
		pendingConnectionChoice = null;
	}

	function chooseInheritance() {
		if (!pendingConnectionChoice?.source || !pendingConnectionChoice?.target) return;
		const { source, target } = pendingConnectionChoice;
		pendingConnectionChoice = null;
		void createInheritanceEdge(source, target);
	}

	async function createInheritanceEdge(source: string, target: string) {
		errorMessage = null;
		try {
			const namespaceBaseIri = nodeNamespaces.get(source) ?? activeNamespaceBaseIri();
			const result = await sparqlConnector.insertSubClassOf(source, target, namespaceBaseIri);
			if (result.cycleRejected) {
				errorMessage = 'That would create a cycle among local classes — inheritance edge rejected.';
				return;
			}
			const edgeId = `subclassof-${source}-${target}`;
			edges = [
				...edges,
				{
					id: edgeId,
					source,
					target,
					type: 'inheritance',
					data: {
						onDelete: () => {
							deleteInheritanceEdgeId = edgeId;
						}
					} satisfies InheritanceEdgeData
				}
			];
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to create inheritance edge';
		}
	}

	async function handleCreateRelationSubmit(
		name: string,
		targetIri: string,
		required: boolean,
		repeatable: boolean,
		kind: 'specific' | 'generic'
	) {
		if (!pendingRelationCreate?.source || !pendingRelationCreate?.target) return;
		const { source, target } = pendingRelationCreate;
		const { iri } = await sparqlConnector.insertObjectProperty(source, target, name, required, repeatable, {
			kind
		});
		const edgeId = relationEdgeId(iri, source, target);
		edges = [
			...edges,
			{
				id: edgeId,
				source,
				target,
				type: 'relation',
				data: makeRelationEdgeData(edgeId, iri, source, name, required, repeatable, kind)
			}
		];
		pendingRelationCreate = null;
	}

	async function handleEditRelationSubmit(
		name: string,
		targetIri: string,
		required: boolean,
		repeatable: boolean,
		kind: 'specific' | 'generic'
	) {
		if (!editRelationEdgeId) return;
		const edge = findEdge(editRelationEdgeId) as (Edge & { data: RelationEdgeData }) | undefined;
		if (!edge) return;
		const propIri = edge.data.propIri;
		const oldTargetClassIri = edge.target;
		await sparqlConnector.updateObjectProperty(
			edge.source,
			propIri,
			{ name, targetClassIri: targetIri, required, repeatable },
			{ kind, oldTargetClassIri }
		);
		const newEdgeId = relationEdgeId(propIri, edge.source, targetIri);
		edges = edges.map((e) =>
			e.id === editRelationEdgeId
				? {
						...e,
						id: newEdgeId,
						target: targetIri,
						data: makeRelationEdgeData(newEdgeId, propIri, edge.source, name, required, repeatable, kind)
					}
				: e
		);
		editRelationEdgeId = null;
	}

	async function handleDeleteRelationConfirm() {
		if (!deleteRelationEdgeId) return;
		const edge = findEdge(deleteRelationEdgeId) as (Edge & { data: RelationEdgeData }) | undefined;
		if (!edge) return;
		deleteRelationBusy = true;
		errorMessage = null;
		try {
			await sparqlConnector.deleteObjectProperty(edge.data.propIri, edge.source, edge.target);
			edges = edges.filter((e) => e.id !== deleteRelationEdgeId);
			deleteRelationEdgeId = null;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to delete relation';
		} finally {
			deleteRelationBusy = false;
		}
	}

	async function handleDeleteInheritanceConfirm() {
		if (!deleteInheritanceEdgeId) return;
		const edge = findEdge(deleteInheritanceEdgeId);
		if (!edge) return;
		deleteInheritanceBusy = true;
		errorMessage = null;
		try {
			const namespaceBaseIri = nodeNamespaces.get(edge.source) ?? activeNamespaceBaseIri();
			await sparqlConnector.deleteSubClassOf(edge.source, edge.target, namespaceBaseIri);
			edges = edges.filter((e) => e.id !== deleteInheritanceEdgeId);
			deleteInheritanceEdgeId = null;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to delete inheritance edge';
		} finally {
			deleteInheritanceBusy = false;
		}
	}

	const editingRelationEdge = $derived(findEdge(editRelationEdgeId) as (Edge & { data: RelationEdgeData }) | undefined);

	// -- Attributed relationships (STORY-007) ----------------------------------------------------

	let showAddAssociation = $state(false);
	let editAssociationId = $state<string | null>(null);

	function makeAttributedLinkEdgeData(
		edgeId: string,
		propName: string,
		required: boolean,
		repeatable: boolean
	): AttributedLinkEdgeData {
		return {
			propName,
			required,
			repeatable,
			onEdit: () => {
				editLinkEdgeId = edgeId;
			},
			onDelete: () => {
				deleteLinkEdgeId = edgeId;
			}
		};
	}

	async function handleCreateAssociation(
		name: string,
		description: string,
		links: AssociationLink[],
		namespaceBaseIri: string
	) {
		const result = await sparqlConnector.insertAssociationClass(name, description || undefined, links, namespaceBaseIri);
		nodeNamespaces.set(result.iri, namespaceBaseIri);
		const newNode: EntityNodeType = {
			id: result.iri,
			type: 'entity',
			position: nextPosition(),
			data: makeNodeData(result.iri, name, description, [], namespaceBaseIri, nodeColorStore.getColor(result.iri))
		};
		const newEdges: Edge[] = result.links.map((link) => ({
			id: link.iri,
			source: result.iri,
			target: link.targetClassIri,
			type: 'attributedLink',
			data: makeAttributedLinkEdgeData(link.iri, link.propName, link.required, link.repeatable)
		}));
		nodes = [...nodes, newNode];
		edges = [...edges, ...newEdges];
		// Makes the new association class immediately eligible for the "Attributed Link" choice on
		// connect, without waiting for a full `loadSchemaFromGraphDB` reload to repopulate this set.
		lastAssociationClassIris = new Set([...lastAssociationClassIris, result.iri]);
		showAddAssociation = false;
	}

	const editingAssociationNode = $derived(findEntityNode(editAssociationId));

	/** The class's current attributed-relationship links, reshaped into the edit form's row shape
	 *  (STORY-021) — recomputed from `edges` so the form always opens pre-populated with what's
	 *  actually on the canvas right now. */
	const editingAssociationLinks = $derived<AssociationEditLinkRow[]>(
		editAssociationId
			? edges
					.filter(
						(e): e is Edge & { data: AttributedLinkEdgeData } =>
							e.type === 'attributedLink' && e.source === editAssociationId
					)
					.map((e) => ({
						iri: e.id,
						propName: e.data.propName,
						targetClassIri: e.target,
						required: e.data.required,
						maxOne: !e.data.repeatable
					}))
			: []
	);

	/**
	 * Persists a combined class-fields + links edit for an association class (STORY-021) in one
	 * user action: diffs the submitted `links` against the class's current `attributedLink` edges by
	 * `iri` (present -> possibly-updated existing link, absent -> new link) to issue exactly the
	 * insert/update/delete calls needed, mirroring `handleEditEntitySubmit`'s per-field-changed
	 * pattern for the class-level fields.
	 */
	async function handleEditAssociationSubmit(
		name: string,
		description: string,
		color: string | undefined,
		links: AssociationEditLinkRow[]
	) {
		if (!editAssociationId) return;
		const node = findEntityNode(editAssociationId);
		if (!node) return;
		const classIriValue = node.data.classIri;
		const namespaceBaseIri = nodeNamespaces.get(classIriValue) ?? activeNamespaceBaseIri();

		if (name !== node.data.name) {
			await sparqlConnector.renameClass(classIriValue, name, namespaceBaseIri);
		}
		if (description !== node.data.description) {
			await sparqlConnector.updateClassDescription(classIriValue, description || null, namespaceBaseIri);
		}
		nodeColorStore.setColor(classIriValue, color);

		const existingLinks = edges.filter(
			(e): e is Edge & { data: AttributedLinkEdgeData } => e.type === 'attributedLink' && e.source === classIriValue
		);
		const submittedIris = new Set(links.filter((l) => l.iri).map((l) => l.iri));

		for (const existing of existingLinks) {
			if (!submittedIris.has(existing.id)) {
				await sparqlConnector.deleteObjectProperty(existing.id, classIriValue);
			}
		}

		const resultingEdges: Edge[] = [];
		for (const link of links) {
			const existing = link.iri ? existingLinks.find((e) => e.id === link.iri) : undefined;
			if (existing) {
				const changed =
					existing.data.propName !== link.propName ||
					existing.target !== link.targetClassIri ||
					existing.data.required !== link.required ||
					existing.data.repeatable !== !link.maxOne;
				if (changed) {
					await sparqlConnector.updateObjectProperty(classIriValue, existing.id, {
						name: link.propName,
						targetClassIri: link.targetClassIri,
						required: link.required,
						repeatable: !link.maxOne
					});
				}
				resultingEdges.push({
					id: existing.id,
					source: classIriValue,
					target: link.targetClassIri,
					type: 'attributedLink',
					data: makeAttributedLinkEdgeData(existing.id, link.propName, link.required, !link.maxOne)
				});
			} else {
				const { iri } = await sparqlConnector.insertObjectProperty(
					classIriValue,
					link.targetClassIri,
					link.propName,
					link.required,
					!link.maxOne
				);
				resultingEdges.push({
					id: iri,
					source: classIriValue,
					target: link.targetClassIri,
					type: 'attributedLink',
					data: makeAttributedLinkEdgeData(iri, link.propName, link.required, !link.maxOne)
				});
			}
		}

		edges = [
			...edges.filter((e) => !(e.type === 'attributedLink' && e.source === classIriValue)),
			...resultingEdges
		];
		updateNodeData(classIriValue, (d) =>
			makeNodeData(d.classIri, name, description, d.attributes, nodeNamespaces.get(d.classIri), color, d.members)
		);
		editAssociationId = null;
	}

	async function handleCreateLinkSubmit(name: string, targetIri: string, required: boolean, repeatable: boolean) {
		if (!pendingLinkCreate?.source || !pendingLinkCreate?.target) return;
		const { source, target } = pendingLinkCreate;
		const { iri } = await sparqlConnector.insertObjectProperty(source, target, name, required, repeatable);
		edges = [
			...edges,
			{ id: iri, source, target, type: 'attributedLink', data: makeAttributedLinkEdgeData(iri, name, required, repeatable) }
		];
		pendingLinkCreate = null;
	}

	async function handleEditLinkSubmit(name: string, targetIri: string, required: boolean, repeatable: boolean) {
		if (!editLinkEdgeId) return;
		const edge = findEdge(editLinkEdgeId);
		if (!edge) return;
		const propIri = edge.id;
		await sparqlConnector.updateObjectProperty(edge.source, propIri, {
			name,
			targetClassIri: targetIri,
			required,
			repeatable
		});
		edges = edges.map((e) =>
			e.id === editLinkEdgeId
				? { ...e, target: targetIri, data: makeAttributedLinkEdgeData(propIri, name, required, repeatable) }
				: e
		);
		editLinkEdgeId = null;
	}

	async function handleDeleteLinkConfirm() {
		if (!deleteLinkEdgeId) return;
		const edge = findEdge(deleteLinkEdgeId);
		if (!edge) return;
		const remainingLinks = edges.filter(
			(e) => e.type === 'attributedLink' && e.source === edge.source && e.id !== deleteLinkEdgeId
		);
		if (remainingLinks.length < 2) {
			errorMessage = 'An attributed relationship needs at least two links — delete the whole class instead.';
			deleteLinkEdgeId = null;
			return;
		}
		deleteLinkBusy = true;
		errorMessage = null;
		try {
			await sparqlConnector.deleteObjectProperty(edge.id, edge.source);
			edges = edges.filter((e) => e.id !== deleteLinkEdgeId);
			deleteLinkEdgeId = null;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to delete link';
		} finally {
			deleteLinkBusy = false;
		}
	}

	const editingLinkEdge = $derived(findEdge(editLinkEdgeId) as (Edge & { data: AttributedLinkEdgeData }) | undefined);

	// -- External vocabulary stubs (STORY-008) ---------------------------------------------------

	let showAddExternalClass = $state(false);

	function handleAddExternalClass(prefixedName: string, iri: string) {
		if (nodes.some((n) => n.id === iri)) {
			errorMessage = `${prefixedName} is already on the canvas`;
			showAddExternalClass = false;
			return;
		}
		const newNode: ExternalClassNodeType = {
			id: iri,
			type: 'external',
			position: nextPosition(),
			data: {
				prefixedName,
				onRemove: () => {
					void handleRemoveExternalStub(iri);
				}
			} satisfies ExternalClassNodeData
		};
		nodes = [...nodes, newNode];
		showAddExternalClass = false;
	}

	async function handleRemoveExternalStub(nodeId: string) {
		errorMessage = null;
		try {
			const touching = edges.filter((e) => e.source === nodeId || e.target === nodeId);
			for (const e of touching) {
				const namespaceBaseIri = nodeNamespaces.get(e.source) ?? activeNamespaceBaseIri();
				await sparqlConnector.deleteSubClassOf(e.source, e.target, namespaceBaseIri);
			}
			nodes = nodes.filter((n) => n.id !== nodeId);
			edges = edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to remove external class reference';
		}
	}

	// -- Load/reload from GraphDB (STORY-009) + layout persistence (STORY-010) -------------------

	async function loadSchemaFromGraphDB() {
		loading = true;
		errorMessage = null;
		try {
			await namespaceStore.refresh();
			await externalVocabStore.refresh();
			await sparqlConnector.ensureDefaultNamespaceMigrated();
			await sparqlConnector.ensureAttributedRelationshipClass();
			const schema = await sparqlConnector.fetchFullSchemaForAllNamespaces();
			const model = buildCanvasModel(schema, externalVocabStore.asPrefixMap());
			lastAssociationClassIris = model.associationClassIris;

			const positions = resolvePositions(
				model.nodes.map((n) => n.iri),
				layoutStore
			);

			const newNodeNamespaces = new Map<string, string>();

			const newNodes: CanvasNode[] = model.nodes.map((spec) => {
				const position = positions.get(spec.iri)!;
				if (spec.kind === 'entity') {
					newNodeNamespaces.set(spec.iri, spec.namespace);
					return {
						id: spec.iri,
						type: 'entity',
						position,
						hidden: hiddenNamespaces.has(spec.namespace),
						data: makeNodeData(
							spec.iri,
							spec.name,
							spec.description,
							spec.attributes,
							spec.namespace,
							nodeColorStore.getColor(spec.iri),
							spec.members
						)
					} satisfies EntityNodeType;
				}
				return {
					id: spec.iri,
					type: 'external',
					position,
					data: {
						prefixedName: spec.prefixedName,
						onRemove: () => {
							void handleRemoveExternalStub(spec.iri);
						}
					} satisfies ExternalClassNodeData
				} satisfies ExternalClassNodeType;
			});

			const newEdges: Edge[] = model.edges.map((spec) => {
				if (spec.kind === 'relation') {
					const edgeId = relationEdgeId(spec.iri, spec.source, spec.target);
					return {
						id: edgeId,
						source: spec.source,
						target: spec.target,
						type: 'relation',
						hidden: isEdgeHidden(spec.source, spec.target, newNodeNamespaces, hiddenNamespaces),
						data: makeRelationEdgeData(
							edgeId,
							spec.iri,
							spec.source,
							spec.name,
							spec.required,
							spec.repeatable,
							spec.relationKind
						)
					};
				}
				if (spec.kind === 'attributedLink') {
					return {
						id: spec.iri,
						source: spec.source,
						target: spec.target,
						type: 'attributedLink',
						hidden: isEdgeHidden(spec.source, spec.target, newNodeNamespaces, hiddenNamespaces),
						data: makeAttributedLinkEdgeData(spec.iri, spec.propName, spec.required, spec.repeatable)
					};
				}
				const edgeId = `subclassof-${spec.source}-${spec.target}`;
				return {
					id: edgeId,
					source: spec.source,
					target: spec.target,
					type: 'inheritance',
					hidden: isEdgeHidden(spec.source, spec.target, newNodeNamespaces, hiddenNamespaces),
					data: {
						onDelete: () => {
							deleteInheritanceEdgeId = edgeId;
						}
					} satisfies InheritanceEdgeData
				};
			});

			nodeNamespaces = newNodeNamespaces;
			nodes = newNodes;
			edges = newEdges;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to load schema from GraphDB';
		} finally {
			loading = false;
		}
	}

	async function handleToggleAssociation(classIriValue: string, isAssociation: boolean) {
		errorMessage = null;
		try {
			const namespaceBaseIri = nodeNamespaces.get(classIriValue) ?? activeNamespaceBaseIri();
			await sparqlConnector.setAssociationClass(classIriValue, isAssociation, namespaceBaseIri);
			await loadSchemaFromGraphDB();
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to update association-class status';
		}
	}

	/** Persists dragged nodes' new positions (debounced inside `layoutStore`) — fires once per drag
	 *  gesture (`onnodedragstop`), not on every animation frame. */
	function handleNodeDragStop({ nodes: draggedNodes }: { nodes: Node[] }) {
		for (const n of draggedNodes) {
			layoutStore.setPosition(n.id, n.position.x, n.position.y);
		}
	}

	// -- Move Reload/View Triples to the hamburger menu (STORY-034) ------------------------------
	// The menu lives in `+layout.svelte`, a sibling of this page's rendered content rather than an
	// ancestor of it, so it can't reach these handlers via props/context. `workbenchActions` bridges
	// them across instead — see that store's doc comment.

	$effect(() => {
		workbenchActions.loading = loading;
	});
	$effect(() => {
		workbenchActions.triplesOpen = showTriplesPanel;
	});
	$effect(() => {
		workbenchActions.exportingSvg = exportingSvg;
	});
	$effect(() => {
		workbenchActions.hiddenNamespaces = hiddenNamespaces;
	});

	onMount(() => {
		workbenchActions.registerReload(() => void loadSchemaFromGraphDB());
		workbenchActions.registerToggleTriples(() => {
			if (!showTriplesPanel) {
				triplesPanelScopeIri = null;
			}
			showTriplesPanel = !showTriplesPanel;
		});
		workbenchActions.registerExportSvg(() => void handleExportSvg());
		workbenchActions.registerToggleNamespaceVisibility(toggleNamespaceVisibility);
		void loadSchemaFromGraphDB();
	});
</script>

<svg style="position: absolute; width: 0; height: 0" aria-hidden="true">
	<defs>
		<marker
			id="inheritance-arrow"
			viewBox="0 0 20 20"
			refX="18"
			refY="10"
			markerWidth="14"
			markerHeight="14"
			orient="auto-start-reverse"
		>
			<path
				d="M2,2 L18,10 L2,18 Z"
				style="fill: var(--color-bg-secondary, #fff); stroke: var(--color-text, #333); stroke-width: 1.5;"
			/>
		</marker>
		<!-- Open arrowhead marking a relation's direction (source -> target), distinct from the
			closed/hollow triangle used for is-a above. -->
		<marker
			id="relation-arrow"
			viewBox="0 0 12 12"
			refX="10"
			refY="6"
			markerWidth="10"
			markerHeight="10"
			orient="auto-start-reverse"
		>
			<path
				id="relation-arrow-path"
				d="M1,1 L10,6 L1,11"
				style="fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round;"
			/>
		</marker>
	</defs>
</svg>

<div class="editor">
	<div class="toolbar">
		<button class="add-entity" onclick={() => (showAddEntity = true)}>+ Add Entity</button>
		<button class="add-entity secondary-action" onclick={() => (showAddAssociation = true)}>
			+ Add Attributed Relationship
		</button>
		<button class="add-entity secondary-action" onclick={() => (showAddExternalClass = true)}>
			+ Add External Class
		</button>
		{#if errorMessage}
			<span class="error-banner">{errorMessage}</span>
		{/if}
	</div>
	<div class="canvas-wrap" bind:this={canvasWrapEl} bind:clientWidth={canvasWidth} bind:clientHeight={canvasHeight}>
		<SvelteFlow
			bind:nodes
			bind:edges
			bind:viewport
			{nodeTypes}
			{edgeTypes}
			deleteKey={null}
			onconnect={handleConnect}
			onconnectend={handleConnectEnd}
			onnodedragstop={handleNodeDragStop}
			fitView
			colorMode={mode.current}
		>
			<Background variant={BackgroundVariant.Dots} />
			<Controls />
			<MiniMap />
		</SvelteFlow>
	</div>
	{#if showTriplesPanel}
		<TriplesPanel
			selectedIri={triplesPanelScopeIri}
			namespaces={namespaceStore.namespaces}
			initialNamespaceBaseIri={activeNamespaceBaseIri()}
			onClose={() => (showTriplesPanel = false)}
			onSaved={() => void loadSchemaFromGraphDB()}
		/>
	{/if}
</div>

{#if pendingConnectionContextMenu}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="connection-context-menu-backdrop"
		onclick={() => (pendingConnectionContextMenu = null)}
		role="presentation"
		tabindex="-1"
	></div>
	<div
		class="connection-context-menu"
		role="menu"
		style="left: {pendingConnectionContextMenu.screenPosition.x}px; top: {pendingConnectionContextMenu.screenPosition.y}px;"
	>
		<button type="button" class="menu-item" onclick={chooseAddEntityFromContextMenu}>+ Add Entity</button>
		<button type="button" class="menu-item" onclick={chooseAddExternalClassFromContextMenu}>
			+ Add External Class
		</button>
	</div>
{/if}

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape' && pendingConnectionContextMenu) pendingConnectionContextMenu = null;
	}}
/>

<Modal isOpen={showAddEntity} title="Add Entity" onClose={() => (showAddEntity = false)}>
	<EntityForm
		mode="create"
		namespaceOptions={namespaceStore.namespaces}
		initialNamespaceBaseIri={activeNamespaceBaseIri()}
		submitLabel="Create"
		onCancel={() => (showAddEntity = false)}
		onSubmit={handleCreateEntity}
	/>
</Modal>

<Modal
	isOpen={pendingEntityFromConnection !== null}
	title="Create Entity"
	onClose={() => (pendingEntityFromConnection = null)}
>
	<EntityForm
		mode="create"
		namespaceOptions={namespaceStore.namespaces}
		initialNamespaceBaseIri={activeNamespaceBaseIri()}
		submitLabel="Create"
		onCancel={() => (pendingEntityFromConnection = null)}
		onSubmit={handleCreateEntityFromConnectionSubmit}
	/>
</Modal>

<Modal
	isOpen={pendingExternalClassFromConnection !== null}
	title="Add External Class"
	onClose={() => (pendingExternalClassFromConnection = null)}
>
	<ExternalClassForm
		prefixes={externalVocabStore.asPrefixMap()}
		onManageVocabularies={() => workbenchActions.openExternalVocabManagement()}
		onCancel={() => (pendingExternalClassFromConnection = null)}
		onSubmit={handleAddExternalClassFromConnectionSubmit}
	/>
</Modal>

<Modal isOpen={editEntityId !== null} title="Edit Entity" onClose={() => (editEntityId = null)}>
	{#if editingNode}
		<EntityForm
			mode="edit"
			iri={editingNode.data.classIri}
			initialName={editingNode.data.name}
			initialDescription={editingNode.data.description}
			initialColor={editingNode.data.color}
			submitLabel="Save"
			onCancel={() => (editEntityId = null)}
			onSubmit={handleEditEntitySubmit}
		/>
	{/if}
</Modal>

<Modal
	isOpen={deleteEntityId !== null}
	title="Delete Entity"
	onClose={() => {
		deleteEntityId = null;
		deleteEntityWarning = null;
	}}
>
	{#if deletingNode}
		{#if deleteEntityWarning && (deleteEntityWarning.externalReferences.length > 0 || deleteEntityWarning.subClassReferences.length > 0)}
			{#if deleteEntityWarning.externalReferences.length > 0}
				<p>
					Deleting <strong>{deletingNode.data.name}</strong> would leave these properties (owned by other
					entities) pointing at a class that no longer exists:
				</p>
				<ul class="warning-list">
					{#each deleteEntityWarning.externalReferences as ref (ref)}
						<li>{extractLocalName(ref)}</li>
					{/each}
				</ul>
			{/if}
			{#if deleteEntityWarning.subClassReferences.length > 0}
				<p>
					These classes are declared as subclasses of <strong>{deletingNode.data.name}</strong> and would
					lose their superclass:
				</p>
				<ul class="warning-list">
					{#each deleteEntityWarning.subClassReferences as ref (ref)}
						<li>{extractLocalName(ref)}</li>
					{/each}
				</ul>
			{/if}
			<div class="confirm-actions">
				<button
					class="secondary"
					onclick={() => {
						deleteEntityId = null;
						deleteEntityWarning = null;
					}}>Cancel</button
				>
				<button class="danger" onclick={() => handleDeleteEntityConfirm(true)} disabled={deleteEntityBusy}>
					{deleteEntityBusy ? 'Deleting…' : 'Delete Anyway'}
				</button>
			</div>
		{:else}
			<p>
				Delete <strong>{deletingNode.data.name}</strong> and its {deletingNode.data.attributes.length}
				attribute(s)? This removes the corresponding triples from GraphDB and cannot be undone.
			</p>
			<div class="confirm-actions">
				<button
					class="secondary"
					onclick={() => {
						deleteEntityId = null;
						deleteEntityWarning = null;
					}}>Cancel</button
				>
				<button class="danger" onclick={() => handleDeleteEntityConfirm(false)} disabled={deleteEntityBusy}>
					{deleteEntityBusy ? 'Deleting…' : 'Delete'}
				</button>
			</div>
		{/if}
	{/if}
</Modal>

<Modal
	isOpen={attributeModal !== null}
	title={attributeModal?.attribute ? 'Edit Attribute' : 'Add Attribute'}
	onClose={() => (attributeModal = null)}
>
	{#if attributeModal}
		<AttributeForm
			initialName={attributeModal.attribute?.name}
			initialDatatype={attributeModal.attribute?.datatype}
			initialRequired={attributeModal.attribute?.required}
			initialRepeatable={attributeModal.attribute?.repeatable}
			submitLabel={attributeModal.attribute ? 'Save' : 'Add'}
			onCancel={() => (attributeModal = null)}
			onSubmit={handleAttributeSubmit}
		/>
	{/if}
</Modal>

<Modal isOpen={deleteAttributeTarget !== null} title="Delete Attribute" onClose={() => (deleteAttributeTarget = null)}>
	{#if deleteAttributeTarget}
		<p>Delete attribute <strong>{deleteAttributeTarget.attribute.name}</strong>? This cannot be undone.</p>
		<div class="confirm-actions">
			<button class="secondary" onclick={() => (deleteAttributeTarget = null)}>Cancel</button>
			<button class="danger" onclick={handleDeleteAttributeConfirm} disabled={deleteAttributeBusy}>
				{deleteAttributeBusy ? 'Deleting…' : 'Delete'}
			</button>
		</div>
	{/if}
</Modal>

<Modal
	isOpen={manageMembersClassIri !== null}
	title="Manage Instances"
	onClose={() => (manageMembersClassIri = null)}
>
	{#if manageMembersNode}
		<ManageMembersModal
			members={manageMembersNode.data.members}
			namespaceOptions={namespaceStore.namespaces}
			initialNamespaceBaseIri={activeNamespaceBaseIri()}
			onAdd={handleAddMember}
			onEdit={handleEditMember}
			onDelete={handleDeleteMember}
		/>
	{/if}
</Modal>

<Modal isOpen={pendingConnectionChoice !== null} title="What kind of connection?" onClose={() => (pendingConnectionChoice = null)}>
	{#if pendingConnectionChoice}
		<p>Choose what this connection represents:</p>
		<div class="choice-actions">
			<button class="primary" onclick={chooseRelation}>Plain Relation</button>
			{#if pendingConnectionIsFromAssociation}
				<button class="secondary" onclick={chooseAttributedLink}>Attributed Link</button>
			{/if}
			<button class="secondary" onclick={chooseInheritance}>Is-a (Inheritance)</button>
		</div>
	{/if}
</Modal>

<Modal isOpen={pendingRelationCreate !== null} title="Add Relation" onClose={() => (pendingRelationCreate = null)}>
	{#if pendingRelationCreate?.target}
		<RelationForm
			targetIri={pendingRelationCreate.target}
			targetOptions={entityOptions}
			allowRetarget={false}
			submitLabel="Create"
			allowGeneric={true}
			{genericRelationOptions}
			onCancel={() => (pendingRelationCreate = null)}
			onSubmit={handleCreateRelationSubmit}
		/>
	{/if}
</Modal>

<Modal isOpen={editRelationEdgeId !== null} title="Edit Relation" onClose={() => (editRelationEdgeId = null)}>
	{#if editingRelationEdge}
		<RelationForm
			initialName={editingRelationEdge.data.name}
			initialRequired={editingRelationEdge.data.required}
			initialRepeatable={editingRelationEdge.data.repeatable}
			targetIri={editingRelationEdge.target}
			targetOptions={entityOptions}
			allowRetarget={true}
			submitLabel="Save"
			allowGeneric={true}
			{genericRelationOptions}
			initialKind={editingRelationEdge.data.kind}
			onCancel={() => (editRelationEdgeId = null)}
			onSubmit={handleEditRelationSubmit}
		/>
	{/if}
</Modal>

<Modal isOpen={deleteRelationEdgeId !== null} title="Delete Relation" onClose={() => (deleteRelationEdgeId = null)}>
	{#if deleteRelationEdgeId}
		<p>Delete this relation? This cannot be undone.</p>
		<div class="confirm-actions">
			<button class="secondary" onclick={() => (deleteRelationEdgeId = null)}>Cancel</button>
			<button class="danger" onclick={handleDeleteRelationConfirm} disabled={deleteRelationBusy}>
				{deleteRelationBusy ? 'Deleting…' : 'Delete'}
			</button>
		</div>
	{/if}
</Modal>

<Modal isOpen={pendingLinkCreate !== null} title="Add Attributed Link" onClose={() => (pendingLinkCreate = null)}>
	{#if pendingLinkCreate?.target}
		<RelationForm
			targetIri={pendingLinkCreate.target}
			targetOptions={entityOptions}
			allowRetarget={false}
			submitLabel="Create"
			onCancel={() => (pendingLinkCreate = null)}
			onSubmit={handleCreateLinkSubmit}
		/>
	{/if}
</Modal>

<Modal isOpen={editLinkEdgeId !== null} title="Edit Attributed Link" onClose={() => (editLinkEdgeId = null)}>
	{#if editingLinkEdge}
		<RelationForm
			initialName={editingLinkEdge.data.propName}
			initialRequired={editingLinkEdge.data.required}
			initialRepeatable={editingLinkEdge.data.repeatable}
			targetIri={editingLinkEdge.target}
			targetOptions={entityOptions}
			allowRetarget={true}
			submitLabel="Save"
			onCancel={() => (editLinkEdgeId = null)}
			onSubmit={handleEditLinkSubmit}
		/>
	{/if}
</Modal>

<Modal isOpen={deleteLinkEdgeId !== null} title="Delete Attributed Link" onClose={() => (deleteLinkEdgeId = null)}>
	{#if deleteLinkEdgeId}
		<p>Delete this link? This cannot be undone.</p>
		<div class="confirm-actions">
			<button class="secondary" onclick={() => (deleteLinkEdgeId = null)}>Cancel</button>
			<button class="danger" onclick={handleDeleteLinkConfirm} disabled={deleteLinkBusy}>
				{deleteLinkBusy ? 'Deleting…' : 'Delete'}
			</button>
		</div>
	{/if}
</Modal>

<Modal isOpen={deleteInheritanceEdgeId !== null} title="Delete Inheritance Edge" onClose={() => (deleteInheritanceEdgeId = null)}>
	{#if deleteInheritanceEdgeId}
		<p>Delete this "is-a" relationship? Only the <code>rdfs:subClassOf</code> triple is removed — neither class is affected.</p>
		<div class="confirm-actions">
			<button class="secondary" onclick={() => (deleteInheritanceEdgeId = null)}>Cancel</button>
			<button class="danger" onclick={handleDeleteInheritanceConfirm} disabled={deleteInheritanceBusy}>
				{deleteInheritanceBusy ? 'Deleting…' : 'Delete'}
			</button>
		</div>
	{/if}
</Modal>

<Modal isOpen={showAddAssociation} title="Add Attributed Relationship" onClose={() => (showAddAssociation = false)}>
	<AssociationForm
		{entityOptions}
		namespaceOptions={namespaceStore.namespaces}
		initialNamespaceBaseIri={activeNamespaceBaseIri()}
		onCancel={() => (showAddAssociation = false)}
		onSubmit={handleCreateAssociation}
	/>
</Modal>

<Modal
	isOpen={editAssociationId !== null}
	title="Edit Attributed Relationship"
	onClose={() => (editAssociationId = null)}
>
	{#if editingAssociationNode}
		<AssociationEditForm
			initialName={editingAssociationNode.data.name}
			initialDescription={editingAssociationNode.data.description}
			initialColor={editingAssociationNode.data.color}
			initialLinks={editingAssociationLinks}
			{entityOptions}
			onCancel={() => (editAssociationId = null)}
			onSubmit={handleEditAssociationSubmit}
		/>
		<button
			type="button"
			class="demote-association"
			onclick={() => {
				const classIriValue = editingAssociationNode.data.classIri;
				editAssociationId = null;
				void handleToggleAssociation(classIriValue, false);
			}}
		>
			Convert to a plain entity (remove the AttributedRelationship marker)
		</button>
	{/if}
</Modal>

<Modal isOpen={showAddExternalClass} title="Add External Class Reference" onClose={() => (showAddExternalClass = false)}>
	<ExternalClassForm
		prefixes={externalVocabStore.asPrefixMap()}
		onManageVocabularies={() => workbenchActions.openExternalVocabManagement()}
		onCancel={() => (showAddExternalClass = false)}
		onSubmit={handleAddExternalClass}
	/>
</Modal>

<style>
	/* Matches xyflow's default edge line color (--xy-edge-stroke-default, scoped to .svelte-flow)
		so the relation arrowhead isn't hardcoded to a different, unrelated color. */
	:global(#relation-arrow-path) {
		stroke: #b1b1b7;
	}

	:global(:root.dark #relation-arrow-path) {
		stroke: #3e3e3e;
	}

	.editor {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 1rem;
		border-bottom: 1px solid var(--color-border);
	}

	.add-entity {
		padding: 0.4rem 0.9rem;
		border-radius: 6px;
		background: var(--color-accent);
		color: #fff;
		font-size: 0.85rem;
		white-space: nowrap;
	}

	.add-entity:hover {
		background: var(--color-accent-hover);
	}

	.add-entity.secondary-action {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text);
	}

	.add-entity.secondary-action:hover {
		background: var(--color-hover);
	}

	.error-banner {
		color: var(--color-error);
		font-size: 0.85rem;
	}

	.canvas-wrap {
		flex: 1;
		position: relative;
	}

	.warning-list {
		margin: 0.5rem 0;
		padding-left: 1.25rem;
		color: var(--color-error);
		font-size: 0.9rem;
	}

	.demote-association {
		display: block;
		margin-top: 1rem;
		font-size: 0.8rem;
		color: var(--color-text-muted);
		background: transparent;
		border: none;
		padding: 0;
	}

	.demote-association:hover {
		color: var(--color-error);
		text-decoration: underline;
	}

	.confirm-actions,
	.choice-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	.confirm-actions button,
	.choice-actions button {
		padding: 0.5rem 1rem;
		border-radius: 6px;
		font-size: 0.9rem;
	}

	.connection-context-menu-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: transparent;
		z-index: 1000;
	}

	.connection-context-menu {
		position: fixed;
		min-width: 180px;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
		padding: 0.5rem;
		z-index: 1001;
	}

	.connection-context-menu .menu-item {
		display: block;
		width: 100%;
		text-align: left;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		background: transparent;
		border: none;
		color: var(--color-text);
		font-size: 0.875rem;
		white-space: nowrap;
		cursor: pointer;
	}

	.connection-context-menu .menu-item:hover {
		background: var(--color-hover);
	}

	.primary {
		background: var(--color-accent);
		color: #fff;
	}

	.primary:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}

	.secondary {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text);
	}

	.secondary:hover:not(:disabled) {
		background: var(--color-hover);
	}

	.danger {
		background: var(--color-error);
		color: #fff;
	}

	.danger:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.danger:disabled {
		opacity: 0.6;
	}
</style>
