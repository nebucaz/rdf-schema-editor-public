# Relation Edge

A **Relation Edge** is a plain (non-attributed) `owl:ObjectProperty` connecting two classes — the
schema-level declaration behind statements like "a `Customer` has an `Order`".

## What you see

A solid line with an open arrowhead pointing from the source class to the target class, labeled with
the relation's name and cardinality markers:
- `!` required, `?` optional
- `[]` repeatable (multiple values allowed)
- `⇄` prefix — a **generic** relation: shared, with no `rdfs:domain`/`rdfs:range` tying it to this
  specific class pair, as opposed to a **specific** relation defined just for this source/target.

## What you can do

- **Edit** (pencil icon on the label) — reopens the [Relation Form](relation-form) to rename,
  retarget, or change the cardinality/generic-vs-specific kind.
- **Delete** (trash icon) — removes the relation.
- Drag the ⠿ handle on the label to reposition it anywhere along the edge — the position is
  remembered per-edge.
- Draw a new one by dragging from any side of an Entity Node to another Entity Node — this opens the
  Relation Form to name and configure it before it's created.

## Related

- [Relation Form](relation-form) — the create/edit dialog behind this edge.
- [Attributed Link Edge](attributed-link-edge) — the alternative when the relationship itself needs
  its own attributes.
- [Reverse relation visibility toggle](visibility-toggles) — an auto-generated reverse relation is
  hidden by default; this toggle reveals it.
