# Entity Form

Creates or edits a class (`owl:Class`) — the dialog behind adding a new Entity Node to the canvas, or
choosing **Edit** from an existing one's menu.

## Fields

- **Name** — the class's `rdfs:label`. In create mode, typing a name that matches an existing
  class/individual offers to add the existing element to the canvas instead of creating a duplicate.
- **Description** — free-text `rdfs:comment`, shown on the node when descriptions are visible.
- **Color** — a custom header color for this node, overriding the namespace default.
- **Backstage kind** — optional annotation used by [Backstage catalog sync](backstage-catalog-sync) to
  map this class to a Backstage entity kind (e.g. `Component`).
- **Concept namespace** — the target namespace Backstage sync should mint individuals of this class
  into. Only becomes *required* when the class is a direct subclass of the app's configured Catalog
  marker class (Settings). Shows whether the effective value is set directly on this class or
  inherited from an ancestor.
- **Required-for-subclass attributes** *(edit mode only, when applicable)* — one input per attribute
  an ancestor class marked "required for direct subclasses"; must be filled in regardless of that
  attribute's own Required checkbox.
- **Namespace** *(create mode only)* — which registered namespace mints this class's IRI.

## Notes

- The class's IRI is derived once from its name at creation and never changes; renaming here only
  updates the label.
- **Save** either creates the class, or — if the typed name matched an existing element — adds that
  existing element to the canvas instead.

## Related

- [Entity Node](entity-node) — the canvas node this form creates/edits.
- [Attribute Form](attribute-form) — for adding attributes once the class exists.
- [The namespace & named-graph model](namespace-model) — what "namespace" and "concept namespace" mean.
- [Backstage catalog sync](backstage-catalog-sync) — how "Backstage kind" is used.
