# Is-Master-For Edge

An **Is-Master-For Edge** asserts a relation from an **individual** to a **class** — most commonly
"this individual is the master-data record for that class" (`isMasterFor`), but the same edge type is
reused for any individual→class relation you assert via the [Individual Relation
Form](individual-relation-form), with that relation's own name as the label instead.

## What you see

A solid line with a filled (solid) arrowhead — visually distinct from both the hollow is-a triangle
([Inheritance Edge](inheritance-edge)) and the open relation arrow ([Relation
Edge](relation-edge)) — labeled with the relation name (defaults to "isMasterFor").

## What you can do

- **Edit** (pencil icon on the label) — opens the relation-edit dialog to rename or retarget the
  relation, and to author, list, or delete the underlying reified-statement assertions carried by
  this specific edge.
- **Delete** (trash icon) — removes the relation.
- Draw a new one from an [Individual Node](individual-node) to an Entity Node using the [Individual
  Relation Form](individual-relation-form).

## Related

- [Individual Relation Form](individual-relation-form) — where these relations are created/edited.
- [Individual Node](individual-node) — the only valid source for this edge type.
