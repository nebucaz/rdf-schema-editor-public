# SOC Demo

A small, synthetic security-operations dataset for trying the [Query Workbench](query-workbench). It answers
one question end to end: **which server and logfile produced this alert?**

## What it is

A `soc` namespace with six servers, nine logfiles, three detection rules, 70 authentication events and four
alerts. The chain `Alert → Authentication event → Log file → Server` is stored as plain relations, so the
workbench derives the answer by following it. All addresses are RFC 5737 documentation addresses and all
hostnames end in `example.com`.

## Load it

1. Settings menu (cog) → **Manage ▸ Namespaces** → **Add**: prefix `soc`, base IRI
   `http://ld.pageagent.com/example/soc`.
2. Settings menu (cog) → **Import / Export ▸ Import Turtle…**, choosing `soc` as the **Target graph** each time, in this order:
   1. `examples/soc/soc-schema.ttl`
   2. `examples/soc/soc-shapes.ttl`
   3. `examples/soc/soc-data.ttl`
3. Open the Query Workbench and pick **Alert**.

To remove it again, delete the `soc` namespace with the force option (see
[Namespace Management View](namespace-management-view)).

## Walk through it

`examples/soc/RUNBOOK.md` in the repository has the seven steps, each with a block of SPL to paste into the
workbench's **SPL** mode and the expected rows: pivot from an IP address, alert to logfile to server, top
failing sources (including `where count>7` and `top 5`), blast radius of one source, saving and annotating,
and reset. A closing section answers three more questions: which alerts touched a server (a backwards hop),
High *or* Medium alerts in a window (an OR group) and the last 24 hours (relative time). The click path for the
same queries is kept as an appendix.

**Search** mode is free text over every value; switch to **SPL** to paste a pipeline (see
[SPL in the Workbench](spl-unsupported)).

## Limits

Boolean logic is limited to `(a OR b) AND c`: `(a AND b) OR c`, nested groups and `NOT` are not
expressible. Time can be relative (`-24h`, `now`) but cannot snap to a boundary such as `@d`. Computed or
joined data (`eval`, `join`, `lookup`) is not supported.

## Related

- [Query Workbench](query-workbench) — the builder, results, saved queries and reports.
- [Import / Export](import-export) — what **Import Turtle…** does and validates.
- [The namespace & named-graph model](namespace-model) — what the `soc` namespace governs.
