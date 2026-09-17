# The /identities Area

A dedicated, off-canvas way to search, browse, and inspect individuals — reachable from the hamburger
menu's **Identities** entry or the `/identities` route directly. Unlike the canvas's Instances view,
it isn't scoped to a Workspace and doesn't require selecting a class first.

## Search & browse

A search box plus facet filters (**class**, **namespace**, **Backstage sync source**, **sync status**)
narrow a paginated results list. Every search state is reflected in the URL, so a search (or a
specific individual) can be bookmarked or shared as a link.

## Resource page

Selecting an individual opens a read-only resource page: its label, type(s), and every outgoing
property grouped into a readable table — repeatable attributes respect the [Attribute
Form](attribute-form)'s "group on one line"/"display as chips" display markers. A breadcrumb trail
tracks how you navigated between individuals. An **Edit** action opens the same [Member
Form](member-form) used elsewhere in the app.

## Neighborhood graph

From a resource page, open the **neighborhood graph** to see that individual's immediate connections
as an interactive force-directed graph:

- **Click** a node to open a read-only side panel with its details.
- **Double-click** a node to expand its own 1-hop neighborhood into the current view.
- The side panel's **View full page** jumps to that individual's own resource page.

This view is read-only and ephemeral — it always starts fresh from the seed individual's neighborhood
and never persists layout or the expanded set.

## Related

- [Individual Node](individual-node) — the canvas-based alternative for browsing individuals, scoped
  to Instances view and the active Workspace.
- [Member Form](member-form) — the edit dialog reached from a resource page.
