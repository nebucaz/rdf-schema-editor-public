# SKOS: Import, Export and API

The vocabulary is standard SKOS, so it can leave the app and come back, be read by people who cannot edit it, and be pulled by other tools. This page lists what exists and where. The editing itself is described in [Vocabulary](vocabulary).

## Export

Choose **Export** on the Vocabulary page to download one scheme or all schemes as Turtle or CSV, with an optional SHACL shapes file. Editorial notes and project fields stay out unless you tick them; hidden labels are part of the file. The export reads and changes nothing.

## Import

Choose **Import**, add a SKOS Turtle file or a CSV, then **Preview import**. The preview sorts every entry into new, changed, conflicting, similar and skipped; nothing is applied until **Apply import**. New concepts start as *proposed* and carry the file as their source; the change log gets one entry. Importing the same file twice changes nothing.

## What SKOS constructs are covered

Preferred, alternative and hidden labels with language tags, definition, scope note, example, editorial note, notation, history (generated), broader, narrower and related, the five mapping properties, concept schemes with Dublin Core metadata, top concepts, and ordered and unordered collections. SKOS-XL and constructs outside SKOS are listed as skipped on import, never dropped silently.

## Checks

The [Model checks](gate-report) reports the known SKOS and qSKOS defects, and **Scheme health** on the [Ontology](pipeline-view) page summarises each scheme. They advise; nothing blocks a save.

## Reading and printing

A scheme can also be seen as a picture: the **Graph** view on the Taxonomy page and the graph on the printable scheme page are read-only, show broader links as layers, can add related and mapping links, and collapse the deepest levels of a large scheme. Each scheme also stores `skos:hasTopConcept` for its top concepts, which Turtle exports carry as standard SKOS.

- **Glossary** (`/review/glossary`): browse A to Z or as a tree, search, open a concept. Deprecated concepts show struck through with their replacement.
- **Printable scheme** (`/review/scheme?scheme=<id>`): scheme details, the hierarchy and the collections, with a **Print** button.
- **Search in the Query Workbench** adds the thesaurus: the alternative and hidden labels and the narrower concepts of a term are searched too, shown as **Also searching for:** chips you can switch off.

None of these pages shows hidden labels or editorial notes, and none can write.

## Glossary API for other tools

The backend serves the vocabulary read-only to callers with the service token (no user needed):

| Route | Returns |
|---|---|
| `GET /glossary/schemes` | the schemes |
| `GET /glossary/concepts` | a page of concepts; filter with `scheme`, `lang`, `modifiedSince`, `page`, `pageSize` |
| `GET /glossary/concepts/{id}` | one concept |

Ask for JSON or Turtle with the `Accept` header or `?format=`. Hidden labels, editorial notes and the project's own fields are never served. Mint a token with `go run ./cmd/cli mint-token --sub importctl`, then `importctl glossary export` writes the vocabulary to a file. The routes are described in `backend/README.md`.
