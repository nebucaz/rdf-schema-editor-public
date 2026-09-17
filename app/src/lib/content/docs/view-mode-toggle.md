# View Mode Toggle

The **Schema / Instances** segmented control in the top bar switches what the canvas shows.

## Modes

- **Schema** — classes, properties, and their relations: the TBox. [Entity Node](entity-node),
  [External Class Node](external-class-node), and the relation/inheritance edges live here.
- **Instances** — individuals of the classes in the active Workspace: the ABox. [Individual
  Node](individual-node) and its `rdf:type`/relation edges live here instead.

Switching modes doesn't reload the schema — it just changes which node/edge types the existing
canvas model renders. The selection is a per-browser preference (`localStorage`), not written to
GraphDB, so it doesn't follow you across browsers or devices.

## Related

- [Entity Node](entity-node) — the Schema-view node type.
- [Individual Node](individual-node) — the Instances-view node type.
- [Namespace Filter](namespace-filter) — the other canvas-scoping control, which composes
  independently of view mode (which namespaces show vs. which layer of the graph shows).
