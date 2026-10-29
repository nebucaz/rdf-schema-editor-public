# Catalog Settings View

App-wide settings — opened from the Settings menu (cog)'s **Catalog settings…** entry.

## Fields

- **Catalog marker class** — which class marks its direct subclasses as eligible for DCAT catalog
  generation and the [Provenance Report](provenance-report-view). Also, a direct subclass of this
  marker class is required to set a Concept Namespace on its own [Entity Form](entity-form).
- **Represents-predicate** — which `owl:ObjectProperty` [Backstage catalog sync](backstage-catalog-sync)
  uses to link a synced individual back to the local class it represents.

Both settings save together via one **Save** button.

## Related

- [Backstage catalog sync](backstage-catalog-sync) — how the represents-predicate is used during sync.
- [Entity Form](entity-form) — where the Catalog marker class's effect on Concept Namespace shows up
  per class.
- [Provenance Report View](provenance-report-view) — gated on the same Catalog marker class.
