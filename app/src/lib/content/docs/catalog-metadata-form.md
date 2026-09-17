# Catalog Metadata Form

Sets per-class DCAT catalog metadata overrides, for classes marked as catalog-authoritative. Found on
the Catalog tab of the [Triples Panel](triples-panel) for such a class, alongside the generated
catalog Turtle.

## Fields

All fields are optional — leaving one blank means "use the namespace's default" (set via the
[Namespace Form](namespace-form)) rather than overriding it for this class specifically:

- **Publisher override** (`dct:publisher`)
- **License override** (`dct:license`) — must be a well-formed IRI if set.
- **Distribution format** (`dct:format`) — an IANA media-type IRI.
- **Distribution media type** (`dcat:mediaType`) — an IANA media-type IRI.
- **Distribution access URL** (`dcat:accessURL`)

## Notes

- Saving writes straight to GraphDB; it doesn't go through the Catalog tab's Turtle draft, so a manual
  edit there and a save here can't clobber each other mid-session — saving here just tells the Catalog
  tab to refresh so the change becomes visible in the generated Turtle too.
- The form always starts blank (it's write-only) — the Turtle view right next to it already shows the
  class's current effective values in context.

## Related

- [Triples Panel](triples-panel) — the Catalog tab this form lives on.
- [Namespace Form](namespace-form) — where the defaults this form can override are set.
