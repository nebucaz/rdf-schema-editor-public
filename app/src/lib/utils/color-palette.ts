/**
 * DawnBringer's DB32 — a widely recognized 32-color standard palette (ships as a built-in preset in
 * Aseprite) — used as the fixed set of node-color choices instead of an unconstrained native color
 * picker (STORY-022). See spec/ui-refinement/research.md §3.2.
 */
export const PRESET_COLORS = [
	'#000000', '#222034', '#45283c', '#663931', '#8f563b', '#df7126', '#d9a066', '#eec39a',
	'#fbf236', '#99e550', '#6abe30', '#37946e', '#4b692f', '#524b24', '#323c39', '#3f3f74',
	'#306082', '#5b6ee1', '#639bff', '#5fcde4', '#cbdbfc', '#ffffff', '#9badb7', '#847e87',
	'#696a6a', '#595652', '#76428a', '#ac3232', '#d95763', '#d77bba', '#8f974a', '#8a6f30'
];

/**
 * A small, separate pastel palette for Workspace Notes (STORY-083) — DB32 above is a
 * general-purpose 32-color set, not remotely pastel, and a post-it should read as a post-it, not
 * as a coincidentally-light entity color.
 */
export const NOTE_PASTEL_COLORS = [
	'#fff9b1', // pale yellow
	'#ffd6e8', // pale pink
	'#d5f4e6', // pale mint
	'#d6e8ff', // pale blue
	'#ffe4c4', // pale orange
	'#e6d9ff' // pale lavender
];

/**
 * Dark-mode counterparts of `NOTE_PASTEL_COLORS`, index-aligned one-for-one. A note's *stored*
 * `noteColor` is always one of the light values above (no schema/migration impact) — `NoteNode`
 * looks up the matching dark tone here purely for rendering when `:root.dark` is active, the same
 * way `--color-accent-association` swaps between a light and dark definition in `app.css` rather
 * than storing two colors. Muted/desaturated rather than a straight brightness-inversion, so a note
 * still reads as tinted paper instead of a random dark rectangle.
 */
export const NOTE_PASTEL_COLORS_DARK = [
	'#5c5424', // muted dark yellow
	'#5c3346', // muted dark pink
	'#264a3c', // muted dark mint
	'#26364a', // muted dark blue
	'#5c4224', // muted dark orange
	'#3c2e5c' // muted dark lavender
];
