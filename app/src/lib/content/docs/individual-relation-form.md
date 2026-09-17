# Individual Relation Form

Asserts a relation from an individual to a class or another individual — a plain ground triple, not a
schema-level `owl:ObjectProperty` declaration. Opened by dragging a connection from an [Individual
Node](individual-node) to a target.

## Fields

- **Relation name** — the predicate to assert. Typing a name matching an existing declared relation
  (specific or generic, from any namespace) reuses its real IRI instead of minting a new one — offered
  as suggestions while you type.
- **Target** — shown read-only; it's whatever node you dragged the connection to.

## Notes

Because this asserts a fact about one specific individual rather than declaring a schema shape, there
are no Required/Repeatable cardinality fields — those only make sense on a `sh:property` shape
attached to a class, not on a ground triple.

## Related

- [Is-Master-For Edge](is-master-for-edge) — the canvas edge this form creates.
- [Relation Form](relation-form) — the equivalent form for a class-to-class schema relation.
