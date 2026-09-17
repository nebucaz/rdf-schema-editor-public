# Color Swatch Picker

A small palette of preset colors used by the [Entity Form](entity-form), the [Association Edit
Form](association-form), the [Namespace Form](namespace-form) (a namespace's default node color),
and a [Note Node](note-node)'s own color control, to set a canvas element's color.

## What you can do

- Click a swatch to apply it. The currently-applied color is outlined.
- **Reset to default** clears the override, falling back to the namespace's or theme's default
  color — a Note has no such default, so its picker omits this option (a Note always has *some*
  color, there's nothing to "reset" to).

## Persistence

A custom color is a per-browser display preference, not semantic RDF — see [Layout & color
persistence](layout-color-persistence).

## Related

- [Entity Form](entity-form), [Note Node](note-node) — where this picker appears.
- [Layout & color persistence](layout-color-persistence) — how the choice is stored.
