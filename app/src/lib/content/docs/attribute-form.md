# Attribute Form

Adds or edits a class attribute — an `owl:DatatypeProperty` plus its `sh:property` shape constraint.
Opened via an Entity Node's **+ Add attribute** button, or the pencil icon next to an existing one.

## Fields

- **Name** — the attribute's `rdfs:label`.
- **Datatype** — one of the supported XSD types (`string`, `integer`, `decimal`, `date`, `dateTime`,
  `boolean`, `anyURI`).
- **Required** — `sh:minCount 1`; shown as `!` on the node.
- **Repeatable** — allows multiple values; shown as `[]` on the node. Unlocks two more options:
  - **Group values on one line** — on the Identities resource page's Properties table, shows all
    values comma-separated in one row instead of one row per value.
  - **Display values as chips** — shows values as chips instead; also implies grouping even without
    the checkbox above checked.
- **Required for direct subclasses** — when checked, every class directly declared
  `rdfs:subClassOf` this one must set its own value for this attribute at the *class* level (via the
  Entity Form) — independent of whether instances themselves are required to set it.
- **Mapping information** — free-text hint for whatever ingestion source is configured for this class
  (e.g. Backstage sync), describing how to populate this property from that source's own data. Syntax
  is up to the source to interpret (a field path, JSON pointer, etc.).

## Related

- [Entity Node](entity-node) — where an attribute is displayed and where "+ Add attribute" lives.
- [Entity Form](entity-form) — "required for direct subclasses" values are filled in there, on the
  subclass itself.
- [The `/identities` area](identities-area) — where "group on one line"/"display as chips" take effect.
