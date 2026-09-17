# Entity Node

An **Entity Node** represents an `owl:Class` in your schema — an "entity type" like `Customer` or
`Invoice`. It's the most common shape on the canvas.

## What you see

- **Header** — the class's name, colored by its namespace (or a custom color you've picked). Hover
  the name to see its full IRI.
- **Attributes list** — the class's own `owl:DatatypeProperty` attributes, each shown as
  `name: datatype!` / `datatype?` / `datatype[]`:
  - `!` means required (`sh:minCount 1`), `?` means optional.
  - `[]` means repeatable (multiple values allowed).
- **Inherited attributes** *(when the toggle is on)* — attributes pulled in from an ancestor class via
  an Inheritance edge, shown in italics with a "from `ParentClass`" label. These are read-only here;
  edit them on the ancestor.
- **Description** *(when the toggle is on)* — the class's `rdfs:comment`, shown under the header.

## What you can do

- **+ Add attribute** — opens the Attribute form to add a new `owl:DatatypeProperty` to this class.
- Click the pencil/trash icons next to an attribute to edit or delete it.
- Drag from any edge of the box to start a Relation or Inheritance edge to another node.
- The **⋮ menu** (top-right of the header) offers, depending on the class:
  - **Manage instances** — open the members list for this class (hidden for association classes).
  - **View triples** — open the raw Turtle for just this class in the Triples panel.
  - **View catalog** / **Provenance** — only shown for classes marked as catalog-authoritative.
  - **Edit** — open the Entity form to rename, re-describe, or re-color this class.
  - **Remove from workspace** — unlink the class from the current Workspace view without deleting it.
  - **Delete** — remove the class itself.

## Related

- [Entity Form](entity-form) — the create/edit dialog behind "Edit".
- [Attribute Form](attribute-form) — the create/edit dialog behind "+ Add attribute".
- [Relation Edge](relation-edge) and [Inheritance Edge](inheritance-edge) — what dragging from this
  node's border can create.
