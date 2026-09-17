# Member Form

Creates or edits an individual (a "member" of a class) — opened from an [Individual
Node](individual-node)'s edit action, or from the [Manage Members Modal](manage-members-modal)'s
add/edit controls.

## Sections

- **Name & namespace** — the individual's `rdfs:label` and, in create mode, which registered namespace
  mints its IRI into. A create-mode-only **Identifier** field lets you pin the individual's local IRI
  name yourself instead of deriving one from the label.
- **Attributes** — one input per attribute declared on the individual's class (own + inherited),
  matching that attribute's datatype/cardinality from the [Attribute Form](attribute-form) that
  defined it. Repeatable attributes render add/remove controls per row. Required attributes are
  flagged if left empty on save.
- **Relations** — one typeahead field per schema-declared object-property relation the class defines
  ([Relation Form](relation-form)/[Individual Relation Form](individual-relation-form) output),
  letting you pick target individuals directly here instead of drawing edges on the canvas. Repeatable
  relations support multiple rows.
- **Assertions** *(edit mode only)* — a free-form list of predicate→object triples on this individual
  not already covered by the Relations section above: add one by picking (or typing) a predicate and
  an object, or remove an existing one. Existing relation-field predicates are excluded here, since
  they're already editable in the Relations section.

## Notes

- A synced individual ([Individual Node](individual-node)'s sync badge) can't be edited through this
  form — its edit button is disabled, since the next sync run would overwrite any change.
- This same component also powers the pencil-icon edit form on an [Is-Master-For
  Edge](is-master-for-edge)'s reified statement — there it shows only the Assertions section (no
  name/namespace/attributes), since a reified statement has no label of its own.

## Related

- [Individual Node](individual-node), [Manage Members Modal](manage-members-modal) — where this form
  is opened from.
- [Attribute Form](attribute-form), [Relation Form](relation-form) — define the fields this form
  renders.
