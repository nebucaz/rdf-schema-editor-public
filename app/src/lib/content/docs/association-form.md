# Association Form / Association Edit Form

Creates (Association Form) or edits (Association Edit Form) an **attributed relationship** —
also called an association class — a relationship modeled as its own `owl:Class` (marked with the
`AttributedRelationship` marker) so it can carry attributes of its own, plus two or more links to the
classes it relates. Example: `EmploymentAssignment` linking `Employee` and `Company`, itself carrying
a `startDate` attribute.

## Fields

- **Name** — the association class's `rdfs:label` (e.g. `EmploymentAssignment`).
- **Description** — optional `rdfs:comment`.
- **Color** *(edit only)* — custom header color for the resulting Entity Node.
- **Namespace** *(create only, when offered)* — which registered namespace mints the association
  class's IRI.
- **Links to related entities** — at least two rows, each:
  - the link's property name (e.g. `employee`, `company`)
  - the target entity/class this link points to
  - **req** — required (`sh:minCount 1`)
  - **single** — capped at one value (`sh:maxCount 1`)

  Add more rows with the **+** control; remove one with its row's remove control. Editing removes or
  adds [Attributed Link Edges](attributed-link-edge) to match on save.

## After creating

The association class appears on the canvas as an Entity Node (visually distinguished by color),
connected to each linked class by a diamond-marker Attributed Link Edge. You can then add ordinary
attributes to it via [Attribute Form](attribute-form), exactly like any other class.

## Related

- [Attributed Link Edge](attributed-link-edge) — the edges these links create.
- [Entity Node](entity-node) — the association class renders as one.
