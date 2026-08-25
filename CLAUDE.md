# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A visual ERD-style editor for RDF Schema (`owl:Class`, `owl:ObjectProperty`/`owl:DatatypeProperty`,
`rdfs:domain`/`rdfs:range`) and SHACL shapes (`sh:NodeShape`/`sh:PropertyShape`), backed directly by a
GraphDB repository — the diagram reads and writes the graph live; there is no separate "export" step.
See `spec/setup/plan.md` and `spec/named-graphs/plan.md` for the full ADRs and story breakdown; `spec/`
holds every sprint's plan/research/story files and is the authoritative design record — check it before
assuming a behavior is undocumented.

The actual application lives in `app/` (SvelteKit + Svelte 5 + TypeScript). All commands below are run
from `app/`.

## Commands

```sh
cd app
bun install              # install deps (bun.lock present; npm/pnpm/yarn also work)

bun run dev               # start dev server (Vite/SvelteKit, http://localhost:5173)
bun run build              # production build
bun run preview            # preview production build
bun run check               # svelte-kit sync + svelte-check (type checking)
bun run check:watch          # same, in watch mode

bun run test                # vitest, single run
bun run test:unit            # vitest, watch mode
bun run test:unit -- path/to/file.spec.ts   # run a single test file
```

Tests are colocated `*.spec.ts` files next to the code they test (e.g. `sparql-connector.spec.ts` next
to `sparql-connector.ts`). Vitest is configured as a single `server` project (`environment: 'node'`),
excluding `*.svelte.spec.ts` — there's no component-testing project set up yet.

The app needs a running GraphDB instance to develop against beyond unit tests (SPARQL-mocked unit tests
don't need it). See `README.md` for the full Docker setup (dedicated container on port 7201, repository
ID `rdfschema`, non-SHACL-enabled) and `.env` config (`SPARQL_ENDPOINT_URL`, `SPARQL_USER`,
`SPARQL_PASSWORD`, copied from `.env.example`).

## Architecture

### Three cooperating surfaces

1. **ERD canvas** (`@xyflow/svelte` / Svelte Flow) — the primary UI. Draw entity nodes (→ `owl:Class`),
   attributes (→ `owl:DatatypeProperty` + `sh:property`), relation edges (→ `owl:ObjectProperty` +
   `sh:property` with `sh:class`), and attributed relationships / association classes (e.g.
   `EmploymentAssignment` — an association class with ≥2 `owl:ObjectProperty` links to related
   entities, diamond-marker edges). Every canvas action is a direct read/write against GraphDB.
2. **Raw triples view/editor** (`TriplesPanel.svelte`) — shows generated Turtle for the schema or a
   selection and allows manual Turtle editing, gated by validation before save.
3. **Validation layer** (`services/validation.ts`) — syntax parse, SHACL shapes-graph well-formedness,
   and hand-written OWL/RDFS structural checks (domain/range reference declared classes, no
   `subClassOf` cycles, no conflicting redefinitions). No OWL2-RL consistency reasoning in v1 — the
   GraphDB repository is deliberately non-SHACL-enabled; validation lives entirely in the app layer.

### Data flow: SvelteKit routes proxy all SPARQL

The browser never talks to GraphDB directly. `src/routes/api/sparql/+server.ts` (SELECT/ASK) and
`api/sparql/update/+server.ts` (INSERT/DELETE/Update) are thin server-side proxies that inject
`SPARQL_ENDPOINT_URL`/`SPARQL_USER`/`SPARQL_PASSWORD` (from `$env/static/private`) and forward the
request to GraphDB. `services/sparql-connector.ts`'s `SparqlConnector` class is the sole client of
these routes — hand-written SPARQL query strings and SPARQL-JSON parsing, no RDF/SPARQL client
library (mirrors the sibling project `semantic-crm`'s approach). It carries every domain-specific
CRUD method (classes, attributes, relations, association classes, inheritance, individuals,
namespaces) in one class — there's no repository-per-entity split.

`services/turtle.ts` handles Turtle parsing/serialization and quad partitioning (schema vs. shapes vs.
instances, blank-node nesting) via `n3`. `services/canvas-model.ts` is a **pure** function
(`buildCanvasModel`) that reconstructs the `{nodes, edges}` canvas model from a `FetchedSchema` — no
GraphDB access, fully unit-testable, and the thing STORY-009's "load existing schema back into the
canvas" round-trip depends on.

### Namespaces and named graphs

Every namespace (`{prefix, base IRI, description}`) owns **three** named graphs, derived from its base
IRI by `namespaceGraphs()` in `config.ts`:

- `<base>` — instances (individuals/enumerated members)
- `<base>/schema` — TBox (classes, properties)
- `<base>/shapes` — SHACL shapes

These are path-segment suffixes, not fragment suffixes, so a resource literally named "schema" can
never collide with the graph's own identifier. Entity/property/individual IRIs mint as
`<base>#LocalName` under their *owning* namespace's base IRI (`utils/iri.ts`), not a single app-global
constant. `DEFAULT_NAMESPACE_BASE_IRI` (from `PUBLIC_SCHEMA_NAMESPACE` in `.env`, or a hardcoded
fallback) is the pre-existing namespace every call defaults to when no explicit namespace is passed.

Almost every `SparqlConnector` method takes an optional `namespaceBaseIri` parameter (default:
`DEFAULT_NAMESPACE_BASE_IRI`). The one deliberate exception: `insertObjectProperty`/
`updateObjectProperty`/`deleteObjectProperty` derive their target graph automatically from the
relationship's *source* class's own namespace (`findNamespaceOfClass`, a cross-graph `GRAPH ?g {...}`
lookup) — this is what lets a relation cross namespaces without a namespace field on `RelationForm`.
See `spec/named-graphs/plan.md`'s ADR table (10 numbered decisions) before changing anything in this
area — the graph-per-namespace shape, IRI-minting scope, and cross-namespace relationship handling are
all deliberate, previously-litigated design choices, not incidental.

Namespaces themselves are stored as ordinary triples: a namespace's own base IRI is the subject of its
declaration (`<base> a <SCHEMA_NAMESPACE>Namespace ; <SCHEMA_NAMESPACE>prefix "..." ; rdfs:comment
"..."`), always in the *default* namespace's `/schema` graph — alongside the
`AttributedRelationship` marker class used to distinguish association classes from plain entities
(`rdfs:subClassOf <SCHEMA_NAMESPACE>AttributedRelationship`, not a link-count heuristic).

### GraphDB query conventions (`sparql-connector.ts`)

- `fromClause(...graphs)` → `FROM <g>` for SELECT/ASK, merging named graphs into the default graph so
  plain triple patterns match.
- `withGraph(graph)` → `WITH <graph>`, scopes a full `DELETE {} INSERT {} WHERE {}` Modify operation;
  must be repeated per `;`-separated operation.
- `inGraph(triples, graph)` → wraps `INSERT DATA`/`DELETE DATA`/`DELETE WHERE` triples in an explicit
  `GRAPH <graph> { ... }` block (those forms have no `WITH`/`USING`).
- All user-supplied IRIs are checked with `assertSafeSparqlIri`/`isSafeSparqlIri` before interpolation
  into query strings (guards against SPARQL injection via the IRIREF grammar); string literals go
  through `escapeString`. There's no parameterized-query mechanism — string interpolation is the
  pattern throughout, so any new query must apply these same guards.
- `VOCAB_FILTER`/`VOCAB_NAMESPACES` exclude RDF/RDFS/OWL/XSD/SHACL vocabulary IRIs from raw-triples
  queries (GraphDB's reasoner materializes vocabulary axioms when inference is on); `isBlank(...)` is
  short-circuited first since every `sh:property` shape is itself a blank node.

### Frontend structure

- `routes/+page.svelte` — main canvas page; `routes/spike/canvas/+page.svelte` — STORY-003's throwaway
  canvas-library spike, kept for reference.
- `lib/components/` — Svelte components: canvas nodes/edges (`EntityNode`, `ExternalClassNode`,
  `RelationEdge`, `AttributedLinkEdge`, `InheritanceEdge`), forms (`EntityForm`, `RelationForm`,
  `AssociationForm`/`AssociationEditForm`, `AttributeForm`, `MemberForm`), and chrome
  (`HamburgerMenu`, `Modal`, `ThemeToggle`, `TriplesPanel`).
- `lib/stores/` — `layout-store.ts` (per-browser `localStorage` diagram layout, behind an interface so
  a future GraphDB-backed layout channel can swap in without touching canvas code) and
  `node-color-store.ts`, both following the same `LocalStorage*Store` pattern.
- `lib/utils/iri.ts` — IRI minting (`classIri`, `propertyIri`, `nodeShapeIri`, `individualIri`) and
  name-casing helpers (`pascalCase`, `camelCase`); `lib/utils/color-palette.ts`,
  `lib/utils/floating-edge.ts` — canvas edge-routing math.

## Conventions worth knowing before editing

- Generated Turtle style (labels, comments, prefix use) should match `semantic-crm`'s
  `ontology/gcrm-shema.ttl`/`gcrm-shapes.ttl` — this project intentionally mirrors that sibling
  project's architecture and output style but is otherwise fully independent (own repo, own GraphDB
  repository, no shared ontology dependency).
- An entity/property/namespace's IRI is derived once at creation time from its name and never changes;
  renaming only updates `rdfs:label` (`renameClass`, `renameIndividual`, etc.) — don't add IRI-rewriting
  on rename.
- Deletion methods that could orphan references (`deleteClass`, `deleteNamespace`) default to refusing
  and reporting what blocks them (`externalReferences` / `entryCount`), only proceeding when the caller
  passes `{ force: true }` — preserve this refuse-then-force shape for any new cascading delete.
