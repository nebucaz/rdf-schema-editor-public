# Query Workbench

A visual way to ask questions of your data without writing SPARQL — reachable from the hamburger menu's
**Query Workbench** entry or the `/workbench` route. The [Query Console View](query-console-view) stays
available as the advanced, free-form alternative.

## Building a query

1. **Search or pick a class.** Searching looks across every text value and shows which property matched,
   with facet counts; or choose a class directly from the schema panel.
2. **Expand relationships.** Follow a relation to a related entity to add a *hop*; removing a hop removes
   everything that hung off it. Relations can be followed forward or backwards (`← hostedOn`, written
   `^hostedOn` in SPL), e.g. from a server back to the alerts that touched it.
3. **Filter.** Add filters on properties, enumeration members or related entities. Select two or more filter
   chips and choose **Group as “any of”** to OR them: `(a OR b) AND c`. A date or dateTime filter can be
   relative (`-24h`, `now`), resolved each time the query runs.
4. **Choose columns, sort and aggregate.** Pick the columns to show, sort by one or more of them, or group
   by columns and count (or count distinct).
5. **Scope namespaces.** The workbench has its own namespace selection, saved with the query.

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
