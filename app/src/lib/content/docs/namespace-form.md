# Namespace Form

Creates or edits a registered namespace — opened from the [Namespace Management
View](namespace-management-view).

## Fields

- **Prefix** / **Base IRI** — set once at creation and read-only afterward; every class, property, and
  individual minted under this namespace derives its IRI from the base IRI.
- **Description** — optional free text.
- **Default color** — the default header color for Entity Nodes in this namespace, used whenever a
  node has no per-node color override of its own.
- **Default publisher** (`dct:publisher`) — seeds a class's catalog metadata when it's first generated,
  if not overridden per-class via the [Catalog Metadata Form](catalog-metadata-form).
- **Default license** (`dct:license`) — same idea, must be a well-formed IRI if set.
- **Locked** *(edit only)* — blocks deletion of this namespace entirely, even with the force option.
- **Starts hidden by default** *(edit only)* — a browser that has never toggled this namespace's
  visibility sees it hidden on first load, via the [Namespace Filter](namespace-filter).
- **Show in namespace filter** *(edit only)* — whether this namespace appears as a row in the
  Namespace Filter at all.

## Related

- [Namespace Management View](namespace-management-view) — the CRUD list this form is opened from.
- [The namespace & named-graph model](namespace-model) — what a namespace actually is and how it maps
  to graphs.
- [Catalog Metadata Form](catalog-metadata-form) — per-class overrides of the publisher/license
  defaults set here.
