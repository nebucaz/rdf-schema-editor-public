# External Vocabulary Management View

CRUD for registered external vocabularies — opened from the Settings menu (cog): **Manage ▸ External
Vocabularies**.

## What you see

A list of every registered vocabulary's prefix and base IRI. Vocabularies built into the app (e.g.
`schema`) are marked **built-in** and can't be removed.

## What you can do

- **Add** — opens the [External Vocabulary Form](external-vocabulary-form) to register a new
  prefix/base IRI pair.
- **Delete** — removes a non-built-in vocabulary registration. Existing [External Class
  Nodes](external-class-node) referencing that prefix on the canvas are unaffected by this — deleting
  a vocabulary registration doesn't retroactively edit the canvas.

## Related

- [External Vocabulary Form](external-vocabulary-form) — the add dialog.
- [External Class Node](external-class-node) / [External Class Form](external-class-form) — where a
  registered vocabulary is actually used.
