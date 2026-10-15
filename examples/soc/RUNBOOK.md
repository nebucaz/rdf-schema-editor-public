# SOC demo runbook: from alert to logfile and server

A walkthrough of the Query Workbench on a small, synthetic security-operations dataset. The question it
answers: **which logfile on which server produced this alert?** The graph already holds the chain
`Alert → AuthenticationEvent → LogFile → Server`; the builder follows it, and the **SPL** mode takes the
pipeline as text, and *Show query* prints any builder query back as SPL.

Everything is hand-authored and safe to share: addresses come from the RFC 5737 documentation ranges and
hostnames end in `example.com`.

> **Paste SPL, or click.** Steps 3–5 give a block of SPL to paste into the workbench's **SPL** mode; the
> same result can be built by clicking (see [the appendix](#appendix-the-click-path)). The **Search** mode is
> still free text over every string value. Some constructs are not supported yet, see
> [the limits](#what-the-engine-cant-do-yet).

## The dataset

| What | How many |
|---|---|
| Servers / LogFiles / DetectionRules | 6 / 9 / 3 |
| Alerts / AuthenticationEvents | 4 / 70 |
| Events by outcome | 29 Failure, 41 Success |

| Alert | Severity | Status | Rule | Logfile(s) that produced it |
|---|---|---|---|---|
| A-1001 | High | Investigating | SSH brute force | web-01 `auth.log` |
| A-1002 | Medium | Open | Password spray | web-01, web-02, app-01 `auth.log` |
| A-1003 | Low | Closed | SSH brute force | db-01 `auth.log` |
| A-1004 | High | Investigating | Off-hours privileged login | dc-01 `Security.evtx` |

Three more logfiles (`nginx/access.log`, `postgresql.log`, `app/app.log`) exist only as wrong answers to rule out.

## 1. Load the sample

Needs the app, the backend and GraphDB running (see the repository `README.md`).

1. Open the hamburger menu → **Namespaces** → **Add**. Prefix `soc`, base IRI
   `http://ld.pageagent.com/example/soc`. Save.
2. Hamburger menu → **Import Turtle…**, three times, **in this order** (an import is validated against what
   is already stored, so the schema must be there before the data that uses it). Each time, choose
   `soc` as the **Target graph**, then drop the file on the upload field (or click it to choose the file):
   1. `examples/soc/soc-schema.ttl`
   2. `examples/soc/soc-shapes.ttl`
   3. `examples/soc/soc-data.ttl`
3. Open **Query Workbench** (`/workbench`). The class picker lists `Alert`, `Authentication event`,
   `Detection rule`, `Log file` and `Server`. If it does not, tick `soc` in the workbench's own namespace
   scope.

**Expected:** each import reports its inserted triples with no validation errors, and the five classes appear.

## 2. Pivot from an indicator

You have an address from a firewall, not an alert. Type `203.0.113.45` in **Search all properties** and press
**Search**.

**Expected:** 14 events. The hit line shows the matching property (`sourceIp`, or `message`, which also
contains the address). Twelve are failures, one is a success for `deploy`, and one is a failure on a second
server. Press **Open in builder** on any hit to start a query rooted at `Authentication event`.

## 3. Alert → logfile → server

Switch the search region to **SPL**, paste this and press **Run**:

```
Alert
| triggeredBy
| triggeredBy.recordedIn
| triggeredBy.recordedIn.hostedOn
| where severity="High"
| fields alertId, title, triggeredBy.timestamp, triggeredBy.recordedIn.path, triggeredBy.recordedIn.hostedOn.hostname
```

The text becomes a builder query: three hops hang off `Alert`, the filter is on the root and five columns are
ticked. **Expected:** 14 rows.

| alertId | title | path | hostname | rows |
|---|---|---|---|---|
| A-1001 | SSH brute force followed by a successful login | `/var/log/auth.log` | web-01.example.com | 13 |
| A-1004 | Administrator RDP login outside business hours | `C:\Windows\System32\winevt\Logs\Security.evtx` | dc-01.example.com | 1 |

There is one row per triggering event, hence 13 for A-1001. Change `"High"` to `"Medium"` for A-1002
(8 rows over web-01, web-02 and app-01) or `"Low"` for A-1003 (7 rows, all db-01). Press **Export CSV** to
download the full result.

## 4. Aggregate: who fails most?

Paste:

```
Authentication event
| where outcome="Failure"
| stats count as count by sourceIp
| sort -count
```

**Expected:** four rows, 29 failures in all.

| sourceIp | count |
|---|---|
| 203.0.113.45 | 13 |
| 198.51.100.7 | 8 |
| 192.0.2.10 | 7 |
| 192.0.2.88 | 1 |

Two variants of the same question. Only the noisy sources, with a filter on the measure. **Expected:** two
rows, 13 and 8.

```
Authentication event
| where outcome="Failure"
| stats count as count by sourceIp
| where count>7
| sort -count
```

The top five, as a one-liner (`top` is shorthand for count, sort descending, `head`). **Expected:** the same
four rows, because only four sources failed at all.

```
Authentication event
| where outcome="Failure"
| top 5 sourceIp
```

## 5. Blast radius of one source

Which servers did `203.0.113.45` touch, and with how many accounts? Paste:

```
Authentication event
| recordedIn
| recordedIn.hostedOn
| where sourceIp="203.0.113.45"
| stats count as events, dc(user) as users by recordedIn.hostedOn.hostname
| sort -events
```

**Expected:** two rows. The same source reached two servers, one of which (`bastion-01`) has no alert.

| hostname | events | users |
|---|---|---|
| web-01 | 13 | 13 |
| bastion-01 | 1 | 1 |

## 6. Triage artefacts

Saving and annotating need a user identity (`USER_AUTH_TOKEN`, see the in-app *Query Workbench* section).
Without it you can still run and share unsaved queries.

1. **Save** the query from step 3 (name, optional description). It appears under **Saved queries**.
2. **Copy result link (read-only)** gives a page with only the title and the live table; a saved query's link
   is its report at `/reports/<id>`.
3. **Annotate** a cell that stands for a single fact (a plain attribute such as `sourceIp` on an
   unaggregated query): open its badge and add a label, for example for a known false positive such as
   A-1003's `svc-backup` failures.

## 7. Reset

Hamburger menu → **Namespaces** → delete `soc`. The app refuses and reports how many entries block it;
confirm the **force** option. Importing the three files again restores the demo.

## Further questions: backwards hops, OR and relative time

Three things the chain above cannot ask. Each block parses to the model the tests assert on.

### Which alerts touched a server?

A hop can run **backwards**: `^hostedOn` reads "the logfiles hosted on this server", and the chain continues
to the events recorded in them and the alerts they triggered. Start from `Server`:

```
Server
| ^hostedOn
| ^hostedOn.^recordedIn
| ^hostedOn.^recordedIn.^triggeredBy
| where hostname="web-01.example.com"
| stats count as events by ^hostedOn.^recordedIn.^triggeredBy.alertId
| sort -events
```

**Expected:** two rows, because only two alerts have events on web-01.

| alertId | events |
|---|---|
| A-1001 | 13 |
| A-1002 | 3 |

In the builder a backwards hop is listed under the class's inbound relationships and drawn as `← hostedOn`.

### High or Medium alerts in a window

Conditions on different filters can be joined with **OR**, grouped by parentheses:

```
Alert
| where (severity="High" OR severity="Medium")
| where raisedAt>="2026-03-15T03:15:00Z"
| fields alertId, title, severity, raisedAt
| sort raisedAt
```

**Expected:** two rows, A-1002 (Medium, 2026-03-15) and A-1004 (High, 2026-03-16). A-1003 is inside the window but
Low; A-1001 is High but older. Groups and the other conditions are AND-ed: `(a OR b) AND c`. In the builder,
tick two filter chips and choose **Group as "any of"**. For several values of *one* property,
`severity IN ("High","Medium")` is the shorter spelling of the same thing.

### Relative time

```
Alert
| where raisedAt>="-24h"
| fields alertId, title, raisedAt
| sort -raisedAt
```

`earliest=-24h` is accepted as well, and `now`, `+1d`, `-90m`, `-2w` and `-30s` work (units `s m h d w`, UTC).
The expression is stored with the query, so a saved query, its report and a shared link always mean "the last
24 hours *from when it runs*"; the results show the resolved window. **Expected on this sample:** no rows
unless you run it within a day of the data (it ends on 2026-03-16), so use the absolute window above when you
need a reproducible result.

## Appendix: the click path

The same queries without typing SPL. After each, **Show query** must print exactly the block above.

**Step 3.** Pick the class **Alert**. Expand `triggeredBy` → `recordedIn` → `hostedOn`. Filter on the root:
`severity` equals `High`. Tick `alertId`, `title` (on Alert), `timestamp` (on `triggeredBy`), `path`
(on `recordedIn`) and `hostname` (on `hostedOn`).

**Step 4.** Pick **Authentication event**. Filter `outcome` equals `Failure`. Tick `sourceIp`; in
**Aggregation** group by `sourceIp` and add a **COUNT** of **the entity**, alias `count`. Sort `count`
descending. For the `count>7` variant add a **Having** condition on `count`.

**Step 5.** Pick **Authentication event**, expand `recordedIn` → `hostedOn`. Filter on the root: `sourceIp`
equals `203.0.113.45`. Tick `hostname` (on `hostedOn`) and `user` (on the root). Group by `hostname`; add
**COUNT** of the entity (alias `events`) and **COUNT DISTINCT** of `user` (alias `users`). Sort `events`
descending.

**Backwards hops.** Pick **Server**, expand the inbound `← hostedOn`, then `← recordedIn` and `← triggeredBy`.
Filter `hostname` on the root, tick `alertId` on the last hop, group by it and add **COUNT** of the entity.

**OR group.** Pick **Alert**, filter `severity` equals `High` (and add a second filter on another property, or
parse the SPL), select the filter chips and choose **Group as “any of”**.

## What the engine can't do yet

These are known gaps in the current workbench, not mistakes in the sample. They are listed under
"Deferred" in `spec/query-workbench/plan.md` and `spec/spl-input/plan.md`.

- **No full boolean logic.** Filters are AND-ed, with OR only as `(a OR b) AND c`. `(a AND b) OR c`, nested
  groups and `NOT` are rejected with a message pointing at the spot (run two queries instead).
- **No computed or joined data.** `eval`, `rex`, `join`, `lookup` and subsearches are not supported.
- **No time snapping or calendar units.** `-24h` works; `@d` (snap to day) and months or years do not.
