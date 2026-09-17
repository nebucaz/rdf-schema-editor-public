# Import / Export

The ways schema and instance content moves in and out of the app, mostly reached from the hamburger
menu.

## Import

- **Import Turtle…** — loads a `.ttl` file's triples into GraphDB, validated the same way as any
  other save (see [SHACL/structural validation](shacl-validation)).
- **Import Workspace…** — merges a Workspace-export bundle back in, recreating the Workspace, its
  layout, and any Notes it contained.

## Export

- **Export quads** — downloads every quad in the graph.
- **Export SVG** — exports the whole canvas as an SVG image, or just the current selection and the
  relations between selected entities if anything is selected. The file embeds HTML
  (`foreignObject`) for node visuals, so it may not render correctly in every external vector/PDF
  tool.
- **Download LinkML** — from the [Triples Panel](triples-panel), exports the current namespace's
  full schema as a [LinkML](https://linkml.io/) YAML file.
- **Download .ttl** — from the Triples Panel, downloads the current tab's Turtle.

## Related

- [Triples Panel](triples-panel) — hosts the LinkML/.ttl downloads and the raw-Turtle editor imports
  feed into.
- [SHACL/structural validation](shacl-validation) — the checks an import must pass.
