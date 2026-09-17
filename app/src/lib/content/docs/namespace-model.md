# The Namespace & Named-Graph Model

Every registered namespace (prefix, base IRI, description) owns **three** named graphs in GraphDB,
derived from its base IRI:

- `<base>` — instances (individuals/enumerated members).
- `<base>/schema` — the TBox (classes, properties).
- `<base>/shapes` — SHACL shapes.

These are path-segment suffixes, so a resource literally named "schema" can never collide with the
graph's own identifier.

## Why it matters day to day

- A class, property, or individual's IRI is minted as `<base>#LocalName` under its *owning*
  namespace's base IRI — not a single app-wide constant. Two namespaces can each have their own
  `Person` class without colliding, because their IRIs differ by base.
- An IRI is minted once at creation and never changes — renaming a class only updates its
  `rdfs:label`, not its IRI.
- A relation can cross namespaces: which graph it's written into is derived automatically from the
  relation's *source* class's own namespace, so there's no namespace field to set by hand when
  drawing a cross-namespace edge.
- The [Namespace Filter](namespace-filter) and [View Mode Toggle](view-mode-toggle) both operate on
  top of this model — filtering by namespace, or by which of the three graph "layers" (schema vs.
  shapes vs. instances) is showing.

## Related

- [Namespace Management View](namespace-management-view) — where namespaces are created and edited.
- [Namespace Form](namespace-form) — the add/edit dialog.
- [Namespace Filter](namespace-filter) — the canvas-visibility control built on this model.
