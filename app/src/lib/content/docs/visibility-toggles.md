# Description / Inherited Attributes / Reverse Relations Toggles

Three independent eye-icon buttons in the top bar that declutter an [Entity Node](entity-node) by
hiding parts of it you don't need right now. Each is a simple on/off switch, each remembers its own
state per-browser (`localStorage`), and none of them changes what's actually stored in GraphDB —
they only change what's drawn.

## The three toggles

- **Descriptions** — shows or hides each class's/property's `rdfs:comment` text under its name.
- **Inherited attributes** — shows or hides, on a subclass's own node, the attributes it inherits
  from an ancestor via [Inheritance Edge](inheritance-edge) (as opposed to attributes declared
  directly on that class).
- **Reverse relations** — shows or hides auto-generated reverse-direction edges: for a relation
  drawn A → B, this optionally also draws the implied B → A edge. Hidden by default (unlike the
  other two toggles, which default to shown) so the canvas doesn't double every relation as a
  second edge until you ask for it.

## Why toggle these off

A schema with long descriptions, deep inheritance, or many incoming relations can get visually
noisy fast. Turning any of these off doesn't lose information — the underlying triples are
unchanged — it just trims what's rendered on every node at once.

## Related

- [Entity Node](entity-node) — what each toggle actually changes.
- [Inheritance Edge](inheritance-edge) — the source of inherited attributes.
