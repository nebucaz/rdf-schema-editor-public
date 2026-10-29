# Backstage Catalog Sync

Pulls entities from a connected [Backstage](https://backstage.io) software-catalog instance into
GraphDB as individuals, keeping local data in step with the catalog automatically.

## Discover

The [Missing Concepts Panel](missing-concepts-panel) lists every Backstage entity `kind` the live
catalog has that no local class maps to yet, and lets you create and tag a class for one in a
single step — the next sync picks it up.

## Sync

Once a class is mapped to a `kind`, entities of that kind sync into GraphDB as individuals in the
background on a fixed interval — there's no manual "sync now" button to press; mapping the class is
the only step needed.

## Regenerate

For a catalog-authoritative class, the [Triples Panel](triples-panel)'s Catalog tab can regenerate
that class's DCAT catalog entry from current data at any time via its **Regenerate** button.

## Settings that drive it

Set from the [Catalog Settings View](settings-view):

- **Catalog marker class** — which class marks its direct subclasses as catalog-eligible.
- **Represents-predicate** — the `owl:ObjectProperty` used to link a synced individual back to the
  local class it represents.

## Related

- [Missing Concepts Panel](missing-concepts-panel) — the discover step.
- [Catalog Settings View](settings-view) — the marker class and represents-predicate settings.
- [Entity Form](entity-form) — where a class's Backstage `kind` mapping is set.
- [Triples Panel](triples-panel) — where a catalog entry is regenerated, on the Catalog tab.
