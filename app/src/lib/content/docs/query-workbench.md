# Query Workbench

A visual way to ask questions of your data without writing SPARQL — reachable from the **Report** tab in the
navigation strip or the `/workbench` route. The [Query Console View](query-console-view) stays
available as the advanced, free-form alternative.

## Building a query

1. **Search, or start with Columns.** Searching looks across every text value and shows which property
   matched, with facet counts. Or click **Columns** to open the object browser (below).
2. **Add columns with the object browser.** The **Columns** button (always shown beside Saved queries) or a group header's *Columns* button opens a multi-pane browser, like a file manager's
   column view. The first pane lists the classes in your query (or every class, filterable by namespace, when
   you are starting). Click a class, or its `›` chevron, to open the next pane: its **Label** and **IRI**, its
   properties, its relationships, and under **Referenced by** the relationships pointing at it. Click a
   relationship to open the class it leads to, as deep as you like. Tick the properties you want in any pane;
   the **Selected columns** list shows each one with its path (`Employee › worksFor › Organization › name`).
   **Save** adds all of them at once, creating the relationship hops along each path (a hop you already
   have is reused). A hop whose properties you did not tick stays in the query as a join path. Relationships
   that would loop back on themselves are greyed out with the reason. Past four relationships the browser
   warns that long paths slow the query and lengthen share links.
   - **Selection markers:** a class or relationship row with a number badge has that many ticked columns on it or
     further down its path, so a selection in a branch you are not looking at stays visible.
   - **Search** box: type a class or property name and pick a result to open the panes straight to it.
   - **Keyboard:** Up/Down move within a pane, Home/End jump, Right or Enter opens the next pane, Left goes back,
     Space ticks a property, Escape clears the search box (and closes the dialog when it is empty).
   - The group's **Columns** button opens the same browser on that group with its columns ticked; unticking a
     column removes it. Relations can be followed forward or backwards (`← hostedOn`, written `^hostedOn` in
     SPL), e.g. from a server back to the alerts that touched it.
3. **Filter.** Add filters on properties, enumeration members or related entities. Select two or more filter
   chips and choose **Group as “any of”** to OR them: `(a OR b) AND c`. A date or dateTime filter can be
   relative (`-24h`, `now`), resolved each time the query runs.
4. **Sort and aggregate.** Sort by one or more columns, or group by columns and count (or count distinct).
5. **Scope namespaces.** The workbench has its own namespace selection, saved with the query.

**Copy link** puts the whole query in the link while it is small enough. A query with many columns on a long path
is too large for that, so the workbench stores it on the server and copies a short link instead
(`/workbench?q=<id>`). Short links never expire and open the query in the builder; an unknown or damaged link shows
a message and leaves the builder empty. Saved queries keep their own `?query=` and report links.

**Show query** displays what will actually run, as an SPL-style pipeline or as SPARQL, and can open the
SPARQL in the console. The SPL view is read-only; to *type* SPL instead of clicking, switch the search region
to **SPL** mode (see [SPL in the Workbench](spl-unsupported)). The text becomes the same query the builder
edits, and any query — typed, saved or shared — shows up as groups and columns. Not expressible: `(a AND b) OR c`,
nested groups and `NOT`.

## Results

Results are paged on the server, so large result sets stay responsive. Click a header to sort, and click a
cell to drill into that entity. **Export CSV** downloads the whole result (not just the current page), capped
at a maximum row count — you are told when the cap truncates it.

## Saved queries and sharing

Click **Save** next to **Run** to open the save dialog (name, optional description). Saving needs a user
identity (see *Annotations* below); without one the dialog explains why. Saved queries are shared with
everyone using the app and record who created them.

**Saved queries**, beside the class dropdowns under the search bar, opens the list: choose **Open** to load
a query into the builder, or **Delete** (with confirmation) to remove it.

Two kinds of link are offered, for saved and unsaved queries alike:

- **Editor link** — opens the query in the builder, ready to change.
- **Result link (read-only)** — opens a page with only the title and the live result table.
  A saved query's result link is its report (`/reports/<id>`); an unsaved query's embeds its definition in
  the URL, so no saving is needed.

## Column colours, chips and row colours

Under **Formatting**, add rules per column that style a value (**equals**, **contains**, **is empty**) from a
fixed palette. A rule can:

- colour the **cell** (the default),
- draw the value as a **chip** — a saturated pill, good for statuses or service classes — and/or
- **colour the whole row** whenever that column's value matches.

The first matching rule of a column wins for its cell; row colours use the first matching row rule. Rules are
saved with the query and apply identically in the table and in reports.

## Reports

Every saved query has a live report at `/reports/<id>`: the title, description and table, with the data
as of when the page loaded, your colour rules, and print-friendly styling. Share the link — for example in
Confluence — rather than exporting.

## Using results in Power BI or other tools

There is **no dedicated results API yet** — a read-only endpoint with its own scoped credential is a planned
follow-up. The backend's SPARQL endpoint is not an option for other tools in the meantime: it accepts only calls
from the app itself, which carry both the service credential and a signed-in user's session cookie, and neither
should be handed to report consumers.

What works today: use **Export CSV** and load the file into your tool, or share a report link
(`/reports/<id>`) with people who can sign in to the app.

## Annotations

Cells that stand for a single fact (a relation or a literal attribute) can be annotated in place, in the
workbench or on a report. A badge shows existing annotations; open it to add or remove one. Each annotation
has a label, text, author and time. The author is taken from your signed-in user and stamped by the server. Signing in is required to use
the app at all; without it you see a "Sign in required" screen.

Aggregated and multi-valued cells cannot be annotated yet. Annotations follow their fact: editing the
fact moves them, and deleting it deletes them.

## Related

- [Query Console View](query-console-view) — free-form SPARQL.
- [The /identities Area](identities-area) — browse individuals one at a time.
