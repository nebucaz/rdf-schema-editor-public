# Validation Issues

Every validation finding has a stable **finding id** and one persistent **issue**. Issues survive reloads, can be
assigned and linked to a ticket in a workflow tool, and are listed on the dedicated **Issues** page
(`/issues`, the **Issues** tab in the navigation strip).

## Finding id and lifecycle

The finding id is a short hash of the identity, its type, the shape (or rule id), the path and the constraint. The
offending value and the message are not part of it, so the same defect keeps its id across runs and edits of the
wording. Each **Run Validation** reconciles the issues with the findings:

- A finding without an issue gets one: **open**, tagged "new issue created" on that run only.
- An issue whose finding is gone becomes **resolved** by `system` (auto-resolved). If that finding comes back the
  issue is **re-opened**.
- **wontfix** and issues a person resolved are never changed by a run, whether the finding stays or returns.
- An issue whose rule or shape could not be checked in the run (see the not-checked banner) is never auto-resolved.
- Each run refreshes the finding text on the issue (label, message, value); status, assignee, note and ticket stay.

## The Issues page

A table of the stored issues, available without running a validation. Filter by status, assignee (including
**Mine**), rule and identity; the list is paged by 50 and **Group by identity** is only a view. Each row links to
its finding and to the ticket (when set). **Edit** changes the status, the assignee (a pick list of known users),
a note and the ticket id. The ticket link itself is built by the server and is read-only. Setting an issue to
resolved or wontfix means it will not be re-opened automatically.

## Linking to a ticket

When the backend has `ISSUE_TRACKER_URL_TEMPLATE` (https, containing `{id}`) and `ISSUE_TRACKER_NAME`, the edit
form shows the ticket fields and the link is `template` with `{id}` replaced by the ticket id. Without them the
fields are hidden. An id typed by hand is only a link: such an issue is never ticketed or synced.

## ServiceNow tickets

When the backend is connected to ServiceNow, an issue can get a real ticket (an `incident`) instead of a typed id.
Nothing is created by itself: a person starts every ticket.

- **One ticket.** In an issue's edit form choose **Create ticket**. The ticket carries the finding text, a link back
  to the finding and the assignment group, contact, category, impact and urgency derived from the entity the finding
  is about. A finding whose entity has no routing and no fallback group is blocked and says so.
- **Many tickets.** On the Issues page choose **Create tickets…** for the selected issues. A dry run always comes
  first and lists, per issue, whether a ticket would be created, a follow-up opened, the issue skipped or blocked.
  Only after you confirm does it create, and never more than the per-run cap; the rest is shown as deferred and
  can be created in a later run.
- **A lost answer is safe.** Each ticket is looked up by its finding id before it is created, so a retry after a
  failed response never makes a second ticket.

### Who owns what

No field has two writers.

| Field | Owner |
|-------|-------|
| The finding, its text, the rule and the value | this app |
| Creating the ticket, and **wontfix** | this app |
| Ticket number, state | ServiceNow |
| Assignment and assignee | ServiceNow (a person only matched by user name becomes the assignee; otherwise the name is shown as text) |
| Resolution notes | ServiceNow |
| Your free-text note | this app, never sent |

### Keeping both sides current

- **From ServiceNow.** A background pass pulls changes of the tickets every few minutes, and **Sync now** on the
  Issues page (or `importctl servicenow sync`) runs one pass on demand. The state of the ticket sets the status of
  the issue; a ticket resolved while the finding is still there resolves the issue as `servicenow`, and the next
  validation run re-opens it with **follow-up needed**.
- **To ServiceNow.** When a finding disappears, the ticket gets a work note (and, if the backend is set to, is
  moved to Resolved). Setting an issue to **wontfix**, and a changed finding text, are sent too. Closed tickets are
  never re-opened.
- **Follow-up.** If a finding returns after its ticket is Resolved or Closed, **Create follow-up ticket** opens a
  new ticket linked to the issue; the earlier ones stay as history and the newest is current.
- **When ServiceNow is down.** Validation and reconcile never wait for it. The issue shows a sync badge (pending,
  failed with the last error) and the next pass retries. If automatic sync is switched off, the page says so and
  **Sync now** still works.

## Enabling ServiceNow

This is set up by whoever runs the backend; without it the ticket controls do not appear.

1. **The gate.** Only `SERVICENOW_BASE_URL` (https) switches the integration on. A set but incomplete
   configuration stops the backend at startup instead of half-working.
2. **Connection.** `SERVICENOW_AUTH` (`oauth` or `basic`) with `SERVICENOW_USER`/`SERVICENOW_PASSWORD` or
   `SERVICENOW_CLIENT_ID`/`SERVICENOW_CLIENT_SECRET`, optionally `SERVICENOW_TABLE` (default `incident`).
3. **Structured settings.** A JSON file named by `SERVICENOW_CONFIG_FILE`: the state map, the close code and the
   routing (the property naming an entity's authoritative owner, the map to assignment groups, the fallback group).
4. **Limits.** `SERVICENOW_BULK_CAP` (default 25), `SERVICENOW_SYNC_INTERVAL` (default 15m),
   `SERVICENOW_ON_FINDING_GONE` (`comment` or `resolve`), `SERVICENOW_APP_URL` (for the link back).
5. **Activation order.** Deploy with the base URL empty (no change), point it at a test instance, create single
   tickets, try a bulk dry run, then let the worker run. `SERVICENOW_SYNC_ENABLED=false` pauses the worker and
   the automatic pushes without removing manual creation. Unsetting the base URL turns the feature off again;
   issues keep their links.

## Where issues are stored

Issues live only in the backend-written graph `<default base>/issues`, outside the namespace graphs, so they never
appear as individuals, in search or in the workbench. The graph also keeps the last run (time and not-checked
constraints) that the validation page opens with, and the users the assignee list offers. Removing the graph
(`DROP GRAPH`) removes all issues and nothing else.

## Related

- [Validation Report View](validation-report-view)
