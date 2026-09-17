# Namespace Management View

CRUD for registered namespaces — opened from the hamburger menu's **Namespaces** entry.

## What you see

A list of every registered namespace, each showing its prefix, base IRI, and description.

## What you can do

- **Add** — opens the [Namespace Form](namespace-form) to register a new namespace.
- **Edit** — change a namespace's description, default color, publisher/license defaults, and its
  locked/default-hidden/listed-in-filter flags (prefix and base IRI are fixed after creation).
- **Delete** — removes a namespace. If anything still references it (classes, individuals, other
  data), the app refuses and reports how many entries block the deletion, offering a **force**
  option to delete anyway. A namespace marked **Locked** can't be deleted at all, even forced, until
  unlocked.

## Related

- [Namespace Form](namespace-form) — the add/edit dialog.
- [The namespace & named-graph model](namespace-model) — what a namespace actually governs.
