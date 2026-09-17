# Layout & Color Persistence

Two visual preferences persist automatically as you work, but not the same way.

## Node positions

A node's canvas position is saved per active Workspace, written into that Workspace's own
`WorkspaceMembership` data in GraphDB (debounced while dragging). Because it's stored in GraphDB
rather than the browser, rearranging a diagram on one machine is reflected wherever that same
Workspace is opened — it follows you across browsers and devices.

## Custom colors

A node's or Note's custom color (set via the [Color Swatch Picker](color-swatch-picker)) is a
purely visual preference, not semantic RDF, so it's saved to `localStorage` instead — per-browser,
and it does **not** follow you to another browser or device. Clearing site data or opening a private
window loses it.

## Related

- [Color Swatch Picker](color-swatch-picker) — where a custom color is set.
- [Theme Toggle](theme-toggle) — another per-browser preference stored the same way as colors.
