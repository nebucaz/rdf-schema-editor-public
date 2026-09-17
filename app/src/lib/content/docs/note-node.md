# Note Node

A **Note Node** is a free-text sticky note you pin to the canvas — for reminders, TODOs, or context
that doesn't belong in the RDF schema itself. Notes aren't part of your ontology; they're a canvas
annotation layer.

## What you see

A colored card with a text area. If the note is linked to another element (an Entity or Individual
Node), a small "↳ *Linked element name*" label appears in its header.

## What you can do

- Type directly into the note — changes save automatically (debounced) as you type.
- **Change color** (⋮ menu) — pick from a preset pastel palette; the note renders a muted counterpart
  of the same color automatically in dark mode.
- **Link to an element** — drag a connection from the note's edge to an Entity or Individual Node,
  the same way you'd draw a relation. This draws a dashed [Note Link Edge](note-link-edge) pointing at
  whatever the note is about.
- **Unlink** (⋮ menu, only shown once linked) — removes the link without deleting the note.
- **Delete** (⋮ menu) — removes the note entirely.

## Related

- [Note Link Edge](note-link-edge) — the dashed pointer connecting a note to the element it annotates.
- [Color Swatch Picker](color-swatch-picker) — the palette picker used by "Change color".
