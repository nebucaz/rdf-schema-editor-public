# Attributed Link Edge

An **Attributed Link Edge** connects an *attributed relationship* — also called an association class
(e.g. `EmploymentAssignment` linking `Employee` and `Company`) — to one of the plain classes it
relates. Unlike a [Relation Edge](relation-edge), the relationship itself can carry its own
attributes, because it's modeled as a class in its own right, not just a property.

## What you see

A line with a small rotated square ("diamond") marker at its midpoint — the classic UML
association-class notation — labeled with the link's property name and cardinality (`!`/`?`/`[]`,
same meaning as a Relation Edge's label).

An attributed relationship class typically has **two or more** of these edges radiating out to the
classes it connects.

## What you can do

- **Edit** (pencil icon on the label) — opens the [Association Edit Form](association-form) to change
  this link's name or cardinality, or manage the association class's other links.
- **Delete** (trash icon) — removes just this one link.
- Drag the ⠿ handle to reposition the label along the edge.

## How it's created

You don't draw these directly — creating or editing an [Association Form](association-form) /
[Association Edit Form](association-form) generates the attributed relationship's node and all of its
Attributed Link Edges together.

## Related

- [Association Form](association-form) / Association Edit Form — where these links are defined.
- [Entity Node](entity-node) — an attributed relationship renders as an Entity Node with a distinct
  header color, since it's still an `owl:Class` under the hood.
