# Query Console View

A free-form SPARQL query console — opened from the hamburger menu's **Query Console** entry. Useful
for ad hoc questions the canvas UI doesn't have a dedicated view for.

## What you can do

- Type a `SELECT` or `ASK` query and **Run** it. Only these two query forms are supported here; other
  forms are rejected with an error before anything is sent.
- Results render as a table (`SELECT`) or a true/false result (`ASK`).
- **Save queries** — save the current query text under a name and optional description, to reuse
  later without retyping it. A saved query can be:
  - **Run** — loads its text into the console and executes it immediately.
  - **Edit** — loads its text without running, so you can tweak and then **Update** it.
  - Deleted, from its own row in the saved-queries list.

## Related

- [Triples Panel](triples-panel) — the more structured, node/namespace-scoped alternative for viewing
  triples, when you don't need arbitrary SPARQL.
