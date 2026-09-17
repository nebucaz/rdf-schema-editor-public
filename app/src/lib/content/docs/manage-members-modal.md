# Manage Members Modal

Lists, adds, edits, and removes the individuals ("members") of one class. Opened from an Entity
Node's **Manage instances** menu entry (hidden for association classes, which can't have members).

## What you see

Every individual currently belonging to this class, by label.

## What you can do

- **Add** — opens a [Member Form](member-form) (inline, not a second stacked dialog) to create a new
  individual of this class.
- **Edit** — opens the same form pre-filled, to rename the individual or change its attribute values
  and relation assignments.
- **Delete** — removes the individual.

Since every member here belongs to the same class, the form always shows that class's own+inherited
attributes and relation fields — you don't pick a class per member the way you would on the canvas.

## Related

- [Member Form](member-form) — the add/edit dialog this modal wraps.
- [Individual Node](individual-node) — the canvas-visible alternative for browsing/editing individuals
  (Instances view), scoped to any class rather than just one.
