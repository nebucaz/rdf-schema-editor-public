# App Header

One row: the title, the **navigation strip** that switches between the main areas, then the canvas
selectors and toggles (on the Schema Editor), the **Settings menu** (cog) and the **user menu**.

## Navigation strip

Four tabs: **Identities**, **Schema** (the Schema Editor), **Report** (the Query Workbench) and
**Validation** (the Validation Report). The tab for the area you are in is underlined and does nothing when
clicked. On a saved query's report page no tab is highlighted. When the row is too crowded, only the
current tab stays visible and the others move into the menu button next to it.

## Settings menu (cog)

Everything that is not an area link: **Manage** (Namespaces, Workspaces, External Vocabularies),
**Import / Export**, Reload from GraphDB, triples, Queries, Missing Concepts, **Catalog settings…**
(see [Catalog Settings](settings-view)), Documentation and the light/dark mode switch. Entries that only
make sense on the canvas are hidden on the other areas.

## User menu

The user icon at the far right, with your display name beside it (icon only on narrow windows).

- **Profile** — a read-only view of your display name, email, department and groups, as provided by the
  sign-in. Missing values show "—".
- **Logout** — only in development, when dev login is enabled. In production the menu holds just Profile.
