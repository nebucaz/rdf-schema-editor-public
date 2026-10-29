# Individual Node

An **Individual Node** represents one instance ("individual" in OWL terms) of a class — an actual
data point, not the type definition. It only appears on the canvas while you're in **Instances**
view (see [View Mode Toggle](view-mode-toggle)).

## What you see

A pill-shaped node showing the individual's label and, underneath, the name of the class it belongs
to. Hover the label to see the individual's own IRI.

An individual that has a label but no class is shown as **Unclassified** (red italic class line) and
has no [Instance-Of Edge](instance-of-edge). Unclassified individuals appear in Instances view in every
workspace; give them a class with the **Class** selector in the [Member Form](member-form).

If the individual was created by **Backstage catalog sync** rather than by hand, it carries a badge:
- `⇄ backstage` — currently present in the upstream catalog.
- `⚠ backstage` (amber) — was synced before but is no longer seen in the latest sync run ("stale").

## What you can do

- **Edit** (pencil icon, on hover) — opens the [Member Form](member-form) to rename the individual,
  change its class, or change its attribute values and relation assignments. Disabled for synced individuals, since any
  manual edit would just be overwritten on the next sync.
- **Delete** (trash icon, on hover) — deletes the individual after a confirmation. Disabled for synced
  individuals.
- **View triples** — opens the Triples panel scoped to just this individual's own assertions.
- Drag from any side to start a relation to another individual or to a class (see [Is-Master-For
  Edge](is-master-for-edge)).

## Related

- [Instance-Of Edge](instance-of-edge) — the dashed connector from this node back to its class.
- [Member Form](member-form) — the edit dialog behind the pencil icon.
- [Manage Members Modal](manage-members-modal) — the list view an Entity Node's "Manage instances"
  menu entry opens, an alternative to browsing individuals on the canvas.
- [Backstage catalog sync](backstage-catalog-sync) — where synced individuals and the stale badge come
  from.
