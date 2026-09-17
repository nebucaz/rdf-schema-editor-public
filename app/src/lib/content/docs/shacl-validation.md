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
what actually evaluates `sh:minCount`, `sh:datatype`, `sh:class`, and similar constraints against
real data, producing a per-individual list of violations. Nothing is cached — each run starts
fresh.

## Related

- [Validation Report View](validation-report-view) — where to read the SHACL constraint-violation
  report.
- [Triples Panel](triples-panel) — where save-time validation issues surface inline during editing.
