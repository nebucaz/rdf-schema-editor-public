# Relation Form

Draws a relation (`owl:ObjectProperty`) between two classes — opened by dragging a connection from one
Entity Node to another, or by editing an existing [Relation Edge](relation-edge)'s label.

## Fields

- **Relation kind** *(create only, when offered)*:
  - **Specific** — a new `owl:ObjectProperty` scoped to this exact source/target pair
    (`rdfs:domain`/`rdfs:range` set).
  - **Generic** — a reusable relation with no fixed domain/range, shareable across any pair of
    classes. Typing a name matching an existing generic relation reuses it instead of minting a new
    one — the field offers existing generic relations (from any namespace) as suggestions.
- **Name** — the relation's `rdfs:label`.
- **Target** — read-only unless retargeting is allowed for this flow.
- **Required** / **Repeatable** — the same `sh:minCount`/multi-value semantics as an attribute's
  cardinality, shown as `!`/`?`/`[]` on the edge label. Hidden for relations between individuals,
  which have no SHACL shape to constrain.
- **Mapping information** *(where offered)* — same purpose as an attribute's, for the plain
  class→class relation flow only.
- **Define reverse relation** *(where offered)* — adds a second, opposite-direction relation
  automatically (e.g. `hasManager` ⇄ `managerOf`), with its own name and optional mapping
  information. Only available for specific relations; hidden once the relation already exists (its
  kind can't switch after creation). An auto-generated reverse relation is hidden on the canvas by
  default — see [visibility toggles](visibility-toggles).

## Related

- [Relation Edge](relation-edge) — the canvas edge this form creates/edits.
- [Individual Relation Form](individual-relation-form) — the equivalent form when one side is an
  individual rather than a class.
- [Reverse-relation visibility toggle](visibility-toggles).
