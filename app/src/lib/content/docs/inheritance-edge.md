# Inheritance Edge

An **Inheritance Edge** declares `rdfs:subClassOf` — "is-a" — between two classes: a `Manager` is a
`Employee`, an `Invoice` is a `Document`.

## What you see

A line with a hollow (unfilled) triangle arrowhead pointing from the subclass to its parent class —
the standard UML generalization arrow. Unlike a Relation Edge, it carries no label; the arrow alone
is the whole assertion.

## What you can do

- **Delete** (available from the edge, or by removing it like any other edge) — removes the
  `subClassOf` triple; the two classes and their own attributes/relations are untouched.
- Drag the ⠿ handle to reposition the (invisible) label anchor point along the edge, if you need to
  nudge the curve.
- Draw a new one by dragging from a class to its intended parent class — including to an [External
  Class Node](external-class-node), to extend a class from an external vocabulary.

## What it affects

- A subclass's canvas node shows its parent's attributes as **inherited attributes** (in italics,
  when the [inherited-attribute visibility toggle](visibility-toggles) is on) — read-only here; edit
  them on the parent class.
- The app's structural validation rejects a cycle of subclass relationships (e.g. `A subClassOf B
  subClassOf A`) and flags conflicting redefinitions.

## Related

- [Entity Node](entity-node) — see its "Inherited attributes" section for how ancestor attributes
  surface.
- [External Class Node](external-class-node) — the other valid target for an inheritance edge.
- [SHACL/structural validation](shacl-validation) — where subclass-cycle checks are described.
