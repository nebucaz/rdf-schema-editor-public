# SOC Demo

A small, synthetic security-operations dataset for trying the [Query Workbench](query-workbench). It answers
one question end to end: **which server and logfile produced this alert?**

## What it is

A `soc` namespace with six servers, nine logfiles, three detection rules, 70 authentication events and four
alerts. The chain `Alert → Authentication event → Log file → Server` is stored as plain relations, so the
workbench derives the answer by following it. All addresses are RFC 5737 documentation addresses and all
hostnames end in `example.com`.

## Load it

1. Hamburger menu → **Namespaces** → **Add**: prefix `soc`, base IRI
   `http://ld.pageagent.com/example/soc`.
2. Hamburger menu → **Import Turtle…**, choosing `soc` as the **Target graph** each time, in this order:
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
and reset. The click path for the same queries is kept as an appendix.

**Search** mode is free text over every value; switch to **SPL** to paste a pipeline (see
[SPL in the Workbench](spl-unsupported)).

## Limits

The demo cannot yet show inverse traversal (walking from a server back to its alerts), OR groups between
different properties, or relative time such as `earliest=-24h`.

## Related

- [Query Workbench](query-workbench) — the builder, results, saved queries and reports.
- [Import / Export](import-export) — what **Import Turtle…** does and validates.
- [The namespace & named-graph model](namespace-model) — what the `soc` namespace governs.
