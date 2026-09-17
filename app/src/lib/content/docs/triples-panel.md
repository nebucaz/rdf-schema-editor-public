# Triples Panel

The **Triples Panel** shows the raw generated Turtle behind a class, a Workspace, or the whole graph —
and, for a single class, lets you edit it directly. Opened from an Entity/Individual Node's "View
triples" menu entry, or the whole-graph hamburger-menu entry.

## Scope

- **One node** — a single class's or individual's own triples. Editable.
- **A Workspace** — every node currently in that Workspace, unioned together. Read-only — a
  multi-node union has no single subject to structurally save back.
- **The whole graph** — everything across every namespace. Editable.

## Tabs

- **Schema** — `owl:Class`/`owl:ObjectProperty`/`owl:DatatypeProperty` triples.
- **Shapes** — the corresponding SHACL `sh:NodeShape`/`sh:PropertyShape` triples.
- **Catalog** *(only for a catalog-authoritative class)* — the generated DCAT catalog entry, plus the
  [Catalog Metadata Form](catalog-metadata-form) for per-class publisher/license/distribution
  overrides.

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
