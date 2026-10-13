# Examples

Importable sample data for trying the app. Each folder is self-contained and uses its own namespace, so it
never touches your existing schema.

| Folder | What it is | Start here |
|---|---|---|
| [`soc/`](soc/) | A security-operations sample: servers, logfiles, authentication events and alerts, for the Query Workbench. | [`soc/RUNBOOK.md`](soc/RUNBOOK.md) |

## Importing a sample

1. Create the sample's namespace (the base IRI is stated at the top of each `.ttl` file) and make it the
   **Active namespace**.
2. Hamburger menu → **Import Turtle…** for each file, in the order the sample's runbook gives. Schema first,
   then shapes, then data: an import is validated against what is already stored.
3. To remove a sample, delete its namespace with the force option.

Imports only ever add triples; nothing already stored is overwritten or deleted.
