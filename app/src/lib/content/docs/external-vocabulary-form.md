# External Vocabulary Form

Registers an external vocabulary — a `{prefix, base IRI}` pair — for use by the [External Class
Form](external-class-form)/[External Class Node](external-class-node) elsewhere in the app. Opened
from the [External Vocabulary Management View](external-vocabulary-management-view).

## Fields

- **Prefix** — the short name you'll type before a colon when referencing a class from this
  vocabulary (e.g. `gist`).
- **Base IRI** — the vocabulary's namespace IRI (e.g.
  `https://ontologies.semanticarts.com/gist/`).

## Notes

Registering a vocabulary here doesn't import any of its classes — it just makes the prefix resolvable
so you can reference individual external classes by prefixed name afterward.

## Related

- [External Vocabulary Management View](external-vocabulary-management-view) — the CRUD list this
  form is opened from.
- [External Class Form](external-class-form) — where a registered prefix actually gets used.
