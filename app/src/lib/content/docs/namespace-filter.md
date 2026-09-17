# Namespace Filter

The funnel icon in the top bar shows or hides canvas content by namespace, without re-querying
GraphDB — everything is already loaded, this just controls what's drawn.

## What you can do

- Click the funnel to open the list of registered namespaces (only ones marked "listed in filter"
  in the [Namespace Form](namespace-form) appear here).
- Toggle any namespace off to hide every node/edge that belongs to it. A badge on the funnel shows
  how many namespaces are currently hidden.
- A namespace can also start **hidden by default** (a [Namespace Form](namespace-form) setting) —
  useful for large or rarely-needed namespaces you don't want cluttering a fresh canvas load.

## Scope

This is a client-side view filter only — it never deletes or unloads data, and it's independent of
the [View Mode Toggle](view-mode-toggle) (Schema vs. Instances is a different dimension from which
namespaces are visible; the two compose together).

## Related

- [Namespace Form](namespace-form) — where a namespace's "listed in filter" and "hidden by default"
  flags are set.
- [The namespace & named-graph model](namespace-model) — what a namespace actually governs.
- [View Mode Toggle](view-mode-toggle) — the other canvas-scoping control.
