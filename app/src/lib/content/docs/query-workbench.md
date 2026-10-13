# Query Workbench

A visual way to ask questions of your data without writing SPARQL — reachable from the hamburger menu's
**Query Workbench** entry or the `/workbench` route. The [Query Console View](query-console-view) stays
available as the advanced, free-form alternative.

## Building a query

The builder is **column-first**: the columns you will see in the result are the main content, grouped by the
class they come from.

1. **Add column.** Click **+ Add column**. The first time, choose the class the query starts from and tick its
   properties (or search for something and start from the hit). Later, the dialog lists the relationships you
   can follow — outbound or inbound — from *any* class already in the query, grouped by the class they start
   from and searchable; tick the properties of the class you reach to add them. A step that is not available
   stays visible with the reason (for example it would loop back to a class already on the path), and the
   dialog suggests the nearest path when what you search for is not one step away.
2. **Groups.** Each class in the query is a coloured group: the start class first, then one group per followed
   relationship, indented by depth. Collapse a group to its header (the column count stays visible) and give it
   a colour from the palette — both are only for your eyes, kept in this browser, and never saved with a query.
   Removing a group also drops what hung off it, and you are shown what that is before it happens.
3. **Edit a group's columns.** **✎ Columns** on a group opens its property list with the current columns
   ticked: tick to add, untick to remove. Each column box has a header bar: drag its handle (left) to reorder within the group — or focus it and use the arrow keys — and use × (right) to remove it. The title of a box is editable. Include-subclasses is a switch on the start class.
4. **Sort.** Click the sort marker on a column header to cycle ascending, descending, none; the number shows the
   order when several columns sort. An aggregated query can only sort by its grouped columns and its measures.
5. **Filter.** The funnel on a column opens the filter dialog for that property (operator and value, a range
   for numbers and dates, a pick-list for enumerations); a group's **Entity** button filters on a specific
   entity. Use **Add filter** to filter on a property that is not a column. Active filters are listed in the
   **Filter** group above the columns (a filter on a property that is not a column is tagged *hidden column*),
   and a column with a filter shows the funnel highlighted.
6. **Aggregate & limit.** The collapsed **Aggregate & limit** group holds aggregation (group by, count, sum,
   average, min/max), thresholds on aggregated values ("keep only groups where…") and the row limit. It opens
   by itself for a query that already aggregates or limits.
7. **Scope namespaces.** The workbench has its own namespace selection, saved with the query.

**Run** and **Save** sit at the top of the query box. Once a result is on screen it follows the builder: adding
a column, filter or relationship re-runs it automatically.

**Show query** displays what will actually run, as an SPL-style pipeline or as SPARQL, and can open the
SPARQL in the console. The SPL view is read-only; to *type* SPL instead of clicking, switch the search region
to **SPL** mode (see [SPL in the Workbench](spl-unsupported)). The text becomes the same query the builder
edits, and any query — typed, saved or shared — shows up as groups and columns. Not yet available: OR between
filters in the builder and relative time.

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
follow-up. Until then the only programmatic route is the backend's SPARQL endpoint:

1. Open **Show query → SPARQL** and copy the generated query (remove its `LIMIT`/`OFFSET` to fetch everything).
2. `POST` it to `<backend>/sparql` as a form field `query=...`, with an
   `Authorization: Bearer <token>` header. The response is standard SPARQL-results JSON
   (`results.bindings[]`, one object per row).
3. In Power BI, use **Get data → Blank query** and, in the Advanced Editor, call `Web.Contents` with a
   `Headers` record (the bearer token) and a `Content` body (`Text.ToBinary("query=" & Uri.EscapeDataString(sparql))`),
   parse with `Json.Document`, and expand `results.bindings` into columns.

**Caution:** the token is the app's service credential, which can also write to the repository. Do not
distribute it to report consumers; use it only for a gateway or scheduled refresh you control.

## Annotations

Cells that stand for a single fact (a relation or a literal attribute) can be annotated in place, in the
workbench or on a report. A badge shows existing annotations; open it to add or remove one. Each annotation
has a label, text, author and time. The author is taken from the signed-in user, so annotating requires a
user identity to be configured; without one you can still browse and query.

Aggregated and multi-valued cells cannot be annotated yet. Annotations follow their fact: editing the
fact moves them, and deleting it deletes them.

## Related

- [Query Console View](query-console-view) — free-form SPARQL.
- [The /identities Area](identities-area) — browse individuals one at a time.
