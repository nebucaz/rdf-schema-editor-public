# Triples Panel

The **Triples Panel** shows the raw Turtle behind a class, an individual, a Workspace, or a whole
namespace, one tab per graph, and lets you edit it directly. It is reachable from every page except the
read-only review pages: **View Triples** in the Settings menu (cog), plus an Entity/Individual Node's
"View triples" entry on the canvas. The menu entry opens on the tab that fits the page:

| Page | Opens on |
|------|----------|
| Schema (canvas), Ontology, Governance | Schema |
| Identities, Workbench, Reports, Questions | Instances |
| Validation, Issues | Shapes |
| Vocabulary, Taxonomy | Vocab (Schema if no vocabulary namespace exists) |

## Scope

- **One node** — a single class's or individual's own triples. Editable. A class opens on Schema, an
  individual on Instances.
- **A Workspace** — every node currently in that Workspace, unioned together. Read-only — a
  multi-node union has no single subject to structurally save back.
- **The whole graph** — one namespace's graphs. Editable (except Vocab).

## Tabs

Each tab is exactly one graph of the selected namespace, and a save can only touch that graph.

- **Schema** — `owl:Class`/`owl:ObjectProperty`/`owl:DatatypeProperty` triples (`<base>/schema`).
- **Instances** — individuals and the reified statements behind annotations (`<base>`). Read-only above
  5,000 triples.
- **Shapes** — the corresponding SHACL `sh:NodeShape`/`sh:PropertyShape` triples (`<base>/shapes`).
- **Vocab** *(only for the vocabulary namespace, whole-graph scope)* — the SKOS concepts and schemes
  (`<base>/vocab`). **Read-only**: concepts carry linked triples (`skos:broader`, top concepts, collections)
  that free text could break; edit them on the Vocabulary page.
- **Catalog** *(only for a catalog-authoritative class)* — the generated DCAT catalog entry, plus the
  [Catalog Metadata Form](catalog-metadata-form) for per-class publisher/license/distribution
  overrides.

Turtle that belongs to another tab (for example a class pasted into Instances) is rejected with a message
naming the tab it belongs in. A class declared in another namespace is accepted as the type of an
individual.

## What you can do

- Pick which registered **namespace** the panel targets from the selector at the top.
- Where editing is allowed: click the pencil to edit the raw Turtle directly, then save — the panel
  validates (syntax, SHACL well-formedness, structural checks) before persisting, and shows any
  issues inline.
- **Download .ttl** — saves the current tab's Turtle to a file.
- **Download LinkML** — exports the current namespace's full schema as a LinkML YAML file.

## Related

- [Catalog Metadata Form](catalog-metadata-form) — the form on the Catalog tab.
- [SHACL/structural validation](shacl-validation) — what the save-time checks cover.
- [Import/export](import-export) — the other ways schema content moves in and out of the app.
