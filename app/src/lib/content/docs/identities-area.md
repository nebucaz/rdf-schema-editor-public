# The /identities Area

A dedicated, off-canvas way to search, browse, and inspect individuals — reachable from the **Identities** link in
the navigation strip or the `/identities` route directly. Unlike the canvas's Instances view,
it isn't scoped to a Workspace and doesn't require selecting a class first.

## Search & browse

A search box plus facet filters (**class**, **namespace**, **Backstage sync source**, **sync status**)
narrow a paginated results list. Every search state is reflected in the URL, so a search (or a
specific individual) can be bookmarked or shared as a link.

The class filter's **Unclassified (no class)** option lists only individuals that have a label but no
class; they are grouped under "Unclassified" and are not included in **All classes**. Open one and use
**Edit** to give it a class — it then leaves the Unclassified list. See [Member Form](member-form).

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

## Giving many Unclassified individuals a class

With **Unclassified (no class)** selected, every row has a checkbox and a bar above the list offers:

- **Select this page** — ticks the rows on screen. If more individuals match, **Select all N matching**
  selects everything matching the current search text and namespace, not just the rows loaded.
- **Set class…** — pick a class. The dialog shows how many individuals will be changed; above 1,000 you
  must type that number to confirm. **Cancel** changes nothing.
- A large run is done in chunks with a progress bar and a **Cancel run** button. If it stops, run it
  again: individuals that already got the class are no longer Unclassified, so only the rest is touched.
- **Undo** is offered after assigning a hand-picked selection of up to 5,000 individuals; it removes the
  class again where it is still that class. There is no undo for "all matching".

Synced individuals are never changed. Typed individuals are not bulk-edited.

## Related

- [Individual Node](individual-node) — the canvas-based alternative for browsing individuals, scoped
  to Instances view and the active Workspace.
- [Member Form](member-form) — the edit dialog reached from a resource page.
