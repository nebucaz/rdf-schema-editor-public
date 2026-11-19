# Examples

Importable sample data for trying the app. Each folder is self-contained and uses its own namespace, so it
never touches your existing schema.

| Folder | What it is | Start here |
|---|---|---|
| [`soc/`](soc/) | A security-operations sample: servers, logfiles, authentication events and alerts, for the Query Workbench, including backwards hops, OR groups and relative time. | [`soc/RUNBOOK.md`](soc/RUNBOOK.md) |
| [`itam-shapes/`](itam-shapes/) | Six ITAM data quality shapes (SHACL, incl. `sh:sparql`) with a minimal schema and 23 test records that must produce exactly 22 findings, for the Validation report. | [`itam-shapes/RUNBOOK.md`](itam-shapes/RUNBOOK.md) |
| [`asset-classification/`](asset-classification/) | One SKOS scheme of 28 classification values (lifecycle stage, criticality, hosting, sensitivity, legacy terms) that shows every link of the Taxonomy graph: broader, related, mapping and same concept (a concept with two parents). Values say in which state an asset is; kinds of things stay classes. | Import `asset-classification.ttl` on the Vocabulary page (use **Where it lands** to import it under your own IRIs), then **Taxonomy** > **Graph** |

## Importing a sample

1. Create the sample's namespace (the base IRI is stated at the top of each `.ttl` file) and make it the
   **Active namespace**.
2. Hamburger menu → **Import Turtle…** for each file, in the order the sample's runbook gives. Schema first,
   then shapes, then data: an import is validated against what is already stored.
3. To remove a sample, delete its namespace with the force option.

Imports only ever add triples; nothing already stored is overwritten or deleted.
