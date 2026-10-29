# Provenance Report View

A read-only, per-attribute provenance/contributor report for a class — opened via an Entity Node's
**Provenance** menu entry (only shown for catalog-authoritative classes).

## What you see

One row per attribute the class declares:

- **Attribute** — the attribute's name.
- **Contributor** — the individual identified as the source of this attribute's value, if known, with
  a badge showing whether that's an **attribute-level override** or the class's **default**
  contributor.
- **Authority** — the recognized authority for that contributor, if any.
- **Last generated** — when the catalog entry reflecting this was last generated.

An attribute with no known contributor is shown as such rather than left blank.

## Notes

This view has no edit affordance anywhere — to change a contributor/authority assertion, use the
existing individual/relation editors ([Is-Master-For Edge](is-master-for-edge), [Member
Form](member-form)) that actually own that data.

## Related

- [Catalog Settings View](settings-view) — where the Catalog marker class gating this report's availability is
  configured.
- [Is-Master-For Edge](is-master-for-edge) — where `isMasterFor`/contributor assertions are made.
