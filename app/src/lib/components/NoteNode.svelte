<script module lang="ts">
	import type { Node } from '@xyflow/svelte';

	export interface NoteNodeData extends Record<string, unknown> {
		text: string;
		color: string;
		/** The linked element's IRI, or `null` when unlinked — mirrors `FetchedNote.linkedElementIri`.
		 *  Set by dragging a connection between this note's handles and an entity/individual node's
		 *  (see `handleConnect`'s note branch in +page.svelte) — there is no dropdown/typeahead path. */
		linkedElementIri: string | null;
		/** Display name for `linkedElementIri`, resolved by the page from the canvas's own nodes —
		 *  `null` whenever `linkedElementIri` is `null`. */
		linkedElementLabel: string | null;
		/** Debounced by this component (300ms, matching `GraphDbLayoutStore`'s position debounce) —
		 *  the caller wires this straight to `updateNoteText`. */
		onTextChange: (text: string) => void;
		onColorChange: (color: string) => void;
		onUnlink: () => void;
		onDelete: () => void;
	}

	export type NoteNodeType = Node<NoteNodeData, 'note'>;
</script>

<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import { mode } from 'mode-watcher';
	import NodeMenu, { type NodeMenuEntry } from './NodeMenu.svelte';
	import ColorSwatchPicker from './ColorSwatchPicker.svelte';
	import { NOTE_PASTEL_COLORS, NOTE_PASTEL_COLORS_DARK } from '$lib/utils/color-palette';
	import { debounce } from '$lib/stores/layout-store';

	let { data }: NodeProps<NoteNodeType> = $props();

	let text = $state(data.text);
	$effect(() => {
		text = data.text;
	});

	const debouncedTextChange = debounce((value: string) => data.onTextChange(value), 300);

	function handleInput(event: Event) {
		text = (event.target as HTMLTextAreaElement).value;
		debouncedTextChange(text);
	}

	let showColorPicker = $state(false);

	/** The stored `noteColor` is always a `NOTE_PASTEL_COLORS` light value; look up its index-aligned
	 *  dark counterpart for `:root.dark` rendering below. Falls back to the light color itself for any
	 *  value outside the fixed palette (shouldn't happen via the picker, but keeps this robust). */
	const darkColor = $derived(
		NOTE_PASTEL_COLORS_DARK[NOTE_PASTEL_COLORS.indexOf(data.color)] ?? data.color
	);

	/** `mode.current` (`mode-watcher`, the same reactive getter `ThemeToggle` reads) drives which
	 *  palette the swatch picker itself displays — otherwise a dark-mode user would pick from swatches
	 *  that don't match what the note actually renders as (per-note rendering already swaps via CSS,
	 *  `:root.dark .note-node` above; the picker needs the same swap done in JS since it renders literal
	 *  swatch colors, not CSS vars). */
	const isDark = $derived(mode.current === 'dark');
	const pickerColors = $derived(isDark ? NOTE_PASTEL_COLORS_DARK : NOTE_PASTEL_COLORS);
	const pickerSelectedColor = $derived(isDark ? darkColor : data.color);

	/** The clicked swatch is whichever palette `pickerColors` is currently showing (light or dark) —
	 *  translate back to its `NOTE_PASTEL_COLORS` (light, canonical) index-aligned counterpart before
	 *  persisting, so `noteColor` in GraphDB always stays one of the fixed light values regardless of
	 *  which theme was active when it was picked. */
	function handleColorChange(color: string | undefined) {
		if (color) {
			const index = pickerColors.indexOf(color);
			data.onColorChange(index >= 0 ? NOTE_PASTEL_COLORS[index] : color);
		}
		showColorPicker = false;
	}

	const menuEntries: NodeMenuEntry[] = $derived([
		{
			label: 'Change color',
			icon: colorIcon,
			onClick: () => {
				showColorPicker = true;
			}
		},
		{
			label: 'Unlink',
			icon: unlinkIcon,
			onClick: () => {
				showColorPicker = false;
				data.onUnlink();
			},
			hidden: data.linkedElementIri === null
		},
		{ label: 'Delete', icon: deleteIcon, onClick: data.onDelete }
	]);
</script>

{#snippet colorIcon()}
	<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C22 6.012 17.461 2 12 2z"/></svg>
{/snippet}

{#snippet unlinkIcon()}
	<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.84 12.25 20.5 10.6a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M5.17 11.75 3.5 13.4a5 5 0 0 0 7.07 7.07l1.71-1.71"/><line x1="8" y1="2" x2="8" y2="5"/><line x1="2" y1="8" x2="5" y2="8"/><line x1="16" y1="19" x2="16" y2="22"/><line x1="19" y1="16" x2="22" y2="16"/></svg>
{/snippet}

{#snippet deleteIcon()}
	<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
{/snippet}

<div class="note-node" style={`--note-bg-light: ${data.color}; --note-bg-dark: ${darkColor};`}>
	<!-- Drag from/to any side to link this note to an entity/individual on the canvas (see
		`handleConnect`'s note branch in +page.svelte), same square-handle-per-side pattern as
		EntityNode — replaces the old typeahead as the primary way to set `linkedElementIri`. -->
	<Handle type="target" position={Position.Top} id="top-target" />
	<Handle type="source" position={Position.Top} id="top-source" />
	<Handle type="target" position={Position.Right} id="right-target" />
	<Handle type="source" position={Position.Right} id="right-source" />
	<Handle type="target" position={Position.Bottom} id="bottom-target" />
	<Handle type="source" position={Position.Bottom} id="bottom-source" />
	<Handle type="target" position={Position.Left} id="left-target" />
	<Handle type="source" position={Position.Left} id="left-source" />
	<div class="note-header">
		{#if data.linkedElementLabel}
			<span class="linked-label" title={`Linked to ${data.linkedElementLabel}`}>↳ {data.linkedElementLabel}</span>
		{/if}
		<div class="note-actions">
			<NodeMenu entries={menuEntries} />
		</div>
	</div>
	<textarea
		class="note-text"
		value={text}
		oninput={handleInput}
		placeholder="Type a note…"
		rows="4"
	></textarea>

	{#if showColorPicker}
		<div class="popover">
			<ColorSwatchPicker color={pickerSelectedColor} onChange={handleColorChange} colors={pickerColors} allowReset={false} />
		</div>
	{/if}
</div>

<style>
	.note-node {
		position: relative;
		width: 200px;
		min-height: 140px;
		border-radius: 4px;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
		padding: 6px 8px;
		font-size: 12px;
		background-color: var(--note-bg-light);
		color: #33312e;
	}

	/* Dark mode swaps in the muted counterpart of the note's picked pastel (`NOTE_PASTEL_COLORS_DARK`)
	   instead of rendering the raw light pastel against a dark canvas — same light/dark-swap pattern
	   as `--color-accent-association` in app.css, just resolved per-note via the CSS vars above rather
	   than a single global toggle. Text flips to a light color for contrast against the darker bg. */
	:global(:root.dark .note-node) {
		background-color: var(--note-bg-dark);
		color: #f0ece0;
	}

	/* Square, hollow connection handles matching EntityNode's (STORY-065's pattern) — hidden until
		the note is hovered or a connection is actively being dragged from/to it. */
	:global(.note-node .svelte-flow__handle) {
		width: 9px;
		height: 9px;
		min-width: 9px;
		min-height: 9px;
		background: transparent;
		border: 1px solid var(--color-text-muted, #888);
		border-radius: 2px;
		opacity: 0;
		transition: opacity 0.1s ease;
	}

	:global(.note-node:hover .svelte-flow__handle),
	:global(.note-node .svelte-flow__handle.connectingfrom),
	:global(.note-node .svelte-flow__handle.connectingto) {
		opacity: 1;
	}

	.note-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 4px;
	}

	.linked-label {
		font-size: 10px;
		color: #6b6559;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(:root.dark .note-node .linked-label) {
		color: #c9c3b4;
	}

	.note-actions {
		margin-left: auto;
	}

	.note-text {
		width: 100%;
		height: 100px;
		margin-top: 4px;
		border: none;
		background: transparent;
		color: inherit;
		font: inherit;
		resize: none;
		outline: none;
	}

	.popover {
		position: absolute;
		top: 100%;
		left: 0;
		margin-top: 4px;
		min-width: 200px;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
		padding: 0.5rem;
		z-index: 1001;
		color: var(--color-text);
	}

</style>
