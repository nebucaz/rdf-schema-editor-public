# Instance-Of Edge

An **Instance-Of Edge** is a small, muted dashed connector shown only in **Instances** view, drawn
automatically from every [Individual Node](individual-node) to the Entity Node for its class —
visualizing `rdf:type`.

## What you see

A thin dashed line with a small open arrowhead, deliberately understated (low opacity, muted color)
so it reads as background structure rather than a meaningful assertion you might confuse with a
relation you actually authored.

## What you can do

Nothing — this edge is **derived**, not stored as its own triple you manage. It's computed directly
from each individual's class membership, so there's no edit or delete action on it; it simply appears
and disappears as individuals are added, removed, or reclassified. To change which class an
individual belongs to, edit the individual itself via the [Member Form](member-form).

## Related

- [Individual Node](individual-node) — always the source of one of these edges.
- [View Mode Toggle](view-mode-toggle) — switches the canvas into Instances view, where this edge
  type appears.
