# External Class Form

Registers a reference to a class from an external vocabulary on the canvas, creating an [External
Class Node](external-class-node).

## Fields

- **Prefixed name** — e.g. `schema:Organization`. The prefix must be a known one — either a built-in
  (`schema`, and the app's other bundled prefixes) or one registered via the [External Vocabulary
  Form](external-vocabulary-form). As you type, the form shows the full IRI the name resolves to, or
  the list of known prefixes if it doesn't resolve.

## Notes

- **Manage vocabularies →** opens the [External Vocabulary Management View](external-vocabulary-management-view)
  to register a new prefix, if the one you need isn't listed yet.
- This form only creates the *reference* stub on the canvas — it doesn't define or import the external
  class's own properties.

## Related

- [External Class Node](external-class-node) — the node this form creates.
- [External Vocabulary Form](external-vocabulary-form) — registers the prefix/base IRI this form
  resolves against.
