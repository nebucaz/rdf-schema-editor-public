# Node Menu

The **⋮** button in a node's header — the shared per-node action menu used across [Entity
Node](entity-node), [External Class Node](external-class-node), and [Individual
Node](individual-node). Which entries appear depends on the node type and its current state; hidden
entries are simply omitted rather than shown disabled.

## Possible entries

- **Manage instances** — opens the [Manage Members Modal](manage-members-modal) for this class's
  individuals.
- **View triples** — opens the [Triples Panel](triples-panel) scoped to this node.
- **View catalog** — opens the Triples Panel's Catalog tab (catalog-authoritative classes only).
- **Provenance** — opens the [Provenance Report View](provenance-report-view) for this class.
- **Edit** — opens the node's own form ([Entity Form](entity-form), [External Class
  Form](external-class-form), [Member Form](member-form), …).
- **Remove from workspace** — removes the node from the active Workspace's canvas without deleting
  the underlying class/individual from GraphDB.
- **Delete** — removes the class/individual (subject to the same refuse-then-force rule as the
  [Namespace Management View](namespace-management-view)'s delete: references that would be
  orphaned block a plain delete).

An [Entity Node](entity-node)'s **+ Add attribute** button lives directly on the node itself, not
in this menu.

## Related

- [Entity Node](entity-node), [Individual Node](individual-node) — the node types this menu appears
  on.
- [Triples Panel](triples-panel) — reached via "View Triples"/"View Catalog".
