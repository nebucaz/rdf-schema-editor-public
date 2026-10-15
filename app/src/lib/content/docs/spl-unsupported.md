# SPL in the Workbench

Switch the Query Workbench's search region to **SPL** to type a query instead of clicking it together. The
text becomes the same query the builder edits, so you can adjust it visually afterwards, and **Show query**
prints it back as SPL.

## What you can write

A query is a pipeline that starts with a class name; each stage is separated by `|`.

- **Class** — `Alert` (a leading `search Alert` is accepted).
- **Follow a relationship** — `| triggeredBy`, or deeper with dots: `| triggeredBy.recordedIn`. A leading `^`
  walks it backwards: `| ^hostedOn` from `Server` reaches the logfiles hosted on it.
- **Filter** — `| where severity="High"`, comparisons `>`, `>=`, `<`, `<=`, `!=`, `IN (…)`,
  `isnotnull(field)`. `==` and `AND` are accepted as synonyms.
- **OR** — `| where (severity="High" OR severity="Medium")`, AND-ed with other conditions:
  `(a OR b) AND c`. Mixing AND and OR without parentheses is rejected rather than guessed.
- **Time range** — `earliest=… latest=…` on the class's single date-time property, absolute
  (`"2026-01-01T00:00:00Z"`) or relative: `earliest=-24h latest=now` (`now`, or `+`/`-` a number and one of
  `s m h d w`). A comparison accepts the same, quoted: `where raisedAt>="-24h"`.
- **Columns** — `| fields title, triggeredBy.timestamp` (`table` is accepted), then `| rename … as …`.
- **Aggregate** — `| stats count, dc(field), sum(f), avg(f), min(f), max(f) by field`, then
  `| where count>5` to filter on a measure.
- **Order and cap** — `| sort -count`, `| head 20`, or `| top 10 field`.

Names are the labels shown in the builder, and they are case-insensitive. An ambiguous name is an error that
lists the candidates; it is never guessed.

## What is not supported

Constructs with no equivalent in the builder fail with an error that points at the exact spot:

- Commands that compute or reshape data: `eval`, `rex`, `regex`, `join`, `append`, `lookup`,
  `transaction`, `timechart`, `chart`, `eventstats`, `streamstats`, `bin`, `dedup`, `tail`, `map`, `union`.
- Subsearches in `[ … ]`.
- `NOT`, `(a AND b) OR c` and groups nested inside an OR group (not expressible as a query).
- Relative time snapping (`@d`) and months or years.
- More than one `stats`, `fields`, `sort` or `head` stage, or stages out of order.

Free-text search is unchanged: in **Search** mode, text containing `|` only *offers* a switch to SPL.
