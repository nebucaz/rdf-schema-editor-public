# SHACL/Structural Validation

Two distinct validation mechanisms, both driven by SHACL shapes, cover different moments and
different things.

## Save-time checks (editor)

Every save — from a form, or from a [Triples Panel](triples-panel) raw-Turtle edit — runs three
layers of checks before anything is written to GraphDB:

1. **Syntax** — is the Turtle well-formed at all.
2. **SHACL well-formedness** — is the `sh:NodeShape`/`sh:PropertyShape` structure itself sound (e.g.
   every `sh:property` blank node has exactly one `sh:path`).
3. **Structural** — hand-written OWL/RDFS checks: does `rdfs:domain`/`rdfs:range` point at a
   declared class, are there no `subClassOf` cycles, no conflicting redefinitions.

Most issues block the save outright. A few are warnings that don't block (for example, an
inconsistency introduced by a Backstage-mapped class) — the save-time report distinguishes the two.

This layer never checks instance *data* against shapes as a reasoner would — it's schema/shapes
well-formedness and structural sanity, not constraint evaluation.

## The Validation Report

A separate, on-demand check: real SHACL constraint validation of every individual in the graph
against the shapes graph, run from the [Validation Report View](validation-report-view). This is
what actually evaluates the supported constraints against real data, producing a per-individual list
of violations, grouped by identity by default, each with the offending value, and exportable as CSV, JSON,
Markdown or PDF. Nothing is cached — each run starts fresh.

**What is checked.** On a property shape: `sh:minCount`, `sh:maxCount`, `sh:datatype`, `sh:class`
(including `sh:or` unions of classes), `sh:minLength` and `sh:pattern` (with the flags `i`, `s`, `m`).
On a node shape: `sh:sparql` constraints with a `sh:select` query, which the backend runs against
GraphDB for the shape's instances, within limits (one `SELECT`, no `SERVICE`, no updates, a size cap, a
timeout and a row cap).

**What is not checked, and how you find out.** Anything else, such as `sh:in`, `sh:nodeKind`,
`sh:maxLength`, `sh:node`, a property path other than a plain predicate, a deactivated or `sh:ask`
constraint, a pattern that does not compile, or a `sh:select` the safety check rejects, is skipped. The
report lists every skipped constraint in a banner above the table (rule, construct, reason), so a clean
report is not mistaken for clean data. With a banner showing, the all-clear text reads "No violations
found among the checked constraints".

## Related

- [Validation Report View](validation-report-view) — where to read the SHACL constraint-violation
  report.
- [Triples Panel](triples-panel) — where save-time validation issues surface inline during editing.
