# Member Form

Creates or edits an individual (a "member" of a class). There is one create dialog and one edit dialog
for the whole app: the [Identities area](identities-area) and the canvas ([Individual
Node](individual-node)'s edit action, the [Manage Members Modal](manage-members-modal)'s add/edit
controls) open the same two dialogs, so the fields, the load order and the rules are identical
everywhere. The dialog shows "Loading…" until the individual's values have been read, then the form.

## Sections

- **Name & namespace** — the individual's `rdfs:label` and, in create mode, which registered namespace
  mints its IRI into. A create-mode-only **Identifier** field lets you pin the individual's local IRI
  name yourself instead of deriving one from the label.
- **Class** *(edit mode, Individual Node and Identities edit dialogs)* — the individual's class. It is
  empty for an **Unclassified** individual (one with a label but no `rdf:type`); pick a class and save
  to assign one. To change an existing class, pick another and save: values the new class also defines
  are kept, and if some would be lost a confirmation lists them — **Change class** applies it, **Back**
  changes nothing. The attribute and relation fields below show the *current* class's fields and switch
  to the new class's after the change. An Unclassified individual can still be saved without a class
  (for example just to rename it). The selector is hidden for an identity with several types, disabled for synced individuals, and
  **hidden when the dialog is opened from the canvas** (Individual Node, Manage instances): change an
  individual's class from the Identities area.
- **Attributes** — one input per attribute declared on the individual's class (own + inherited),
  matching that attribute's datatype/cardinality from the [Attribute Form](attribute-form) that
  defined it. Repeatable attributes render add/remove controls per row. Required attributes are
  flagged if left empty on save.
- **Relations** — one typeahead field per schema-declared object-property relation the class defines
  ([Relation Form](relation-form)/[Individual Relation Form](individual-relation-form) output),
  letting you pick target individuals directly here instead of drawing edges on the canvas. A value
  already set is a **read-only row** (label, class, and a link to its identity) with a **Remove**
  button; to add a value, pick a target in the field and press **Add**. In edit mode both **Add** and
  **Remove** are written **at once**, not when you press Save (the canvas edge appears or disappears
  immediately). A required relation keeps its last value: add another before removing it. In create mode
  the values you add are saved with the new individual.
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
