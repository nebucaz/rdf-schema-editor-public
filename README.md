# rdf-schema-editor

A visual ERD-style editor for RDF Schema (`owl:Class`, `owl:ObjectProperty`/`owl:DatatypeProperty`,
`rdfs:domain`/`rdfs:range`) and SHACL shapes (`sh:NodeShape`/`sh:PropertyShape`), backed directly by a
GraphDB repository — the diagram reads and writes the graph, there is no separate "export" step.

See `spec/setup/plan.md` for the full implementation plan, architecture decisions, and story breakdown.

## How it's organized

- **`app/`** — the web application (SvelteKit + Svelte 5 + TypeScript). This is the primary user-facing
  piece; see below for running it.
- **`backend/`** — a standalone Go service that talks to GraphDB on the app's behalf (a SPARQL gateway
  passthrough today, growing into more later — see `spec/report/plan.md`). See `backend/README.md`.
- **`spec/`** — design notes, architecture decisions, and the sprint/story plan.

## Running a local GraphDB instance (Docker)

The app needs a SPARQL 1.1 endpoint to talk to. This project uses its **own** dedicated GraphDB
container and repository — independent of any other project's GraphDB instance (e.g. `semantic-crm`'s
`graphcrm` repository), per the ADR in `spec/setup/plan.md`.

1. **Start GraphDB in a container**, persisting its data to a named volume. Port `7201` (not GraphDB's
   default `7200`) is used on the host so this can run alongside another GraphDB instance:

   ```sh
   docker run -d \
     --name rdf-schema-editor-graphdb \
     -p 7201:7200 \
     -v rdf-schema-editor-graphdb-data:/opt/graphdb/home \
     ontotext/graphdb:10.7.0
   ```

   Give it a few seconds to start, then open the Workbench at [http://localhost:7201](http://localhost:7201).

2. **Create the repository.** In the Workbench, go to *Setup → Repositories → Create new repository*,
   choose *GraphDB Repository*, and set the repository ID to `rdfschema` — this must match the path in
   `SPARQL_ENDPOINT_URL` (`.../repositories/rdfschema`). Accept the defaults (a plain repository, **not**
   SHACL-enabled — see the ADR table for why) and create it.

   Equivalently, from the command line:

   ```sh
   curl -X POST http://localhost:7201/rest/repositories \
     -F "config=@app/scripts/rdfschema-repo-config.ttl;type=text/turtle"
   ```

3. **Verify** by running a query in the Workbench's *SPARQL* tab, e.g. `SELECT * WHERE { ?s ?p ?o } LIMIT 10`.

To stop/start the container later: `docker stop rdf-schema-editor-graphdb` /
`docker start rdf-schema-editor-graphdb`. The volume keeps your data across restarts;
`docker rm -v rdf-schema-editor-graphdb` removes both the container and its data.

## Running the backend

The app no longer talks to GraphDB directly — `backend/`, a standalone Go service, is the sole thing
that does, and the app forwards its SPARQL query/update calls there over HTTP. **Start it before the
app** (the app's `/api/sparql*` routes will fail with a 502 "Backend unreachable" error otherwise).

Requires Go 1.25+ (`go version` to check).

1. **Configure it.** Copy the example env file and point it at the GraphDB repository set up above:

   ```sh
   cd backend
   cp .env.example .env
   ```

   ```
   GRAPHDB_ENDPOINT_URL=http://localhost:7201/repositories/rdfschema
   GRAPHDB_USER=
   GRAPHDB_PASSWORD=
   PORT=8090
   AUTH_JWT_SECRET=
   ```

   Leave `GRAPHDB_USER`/`GRAPHDB_PASSWORD` blank for an unauthenticated repository (the default from
   the Docker setup above); `PORT` is optional and defaults to `8090`. `AUTH_JWT_SECRET` is
   **required** — the backend refuses to start without it (every route but `/health` needs a signed
   bearer JWT, see `backend/README.md`'s "Authentication" section). Generate one with
   `openssl rand -base64 32`.

2. **Run it:**

   ```sh
   go run ./cmd/server
   ```

   Verify it started: `curl http://localhost:8090/health` → `{"status":"ok"}`.

   Alternatively, build and run a standalone binary: `go build -o backend-server ./cmd/server &&
   ./backend-server`. Or via Docker Compose from the repo root: `docker compose up --build backend`
   (reads the same `backend/.env`; no database service of its own — GraphDB is the only store).

3. **Run its tests** (optional): `go test ./...` from `backend/`.

See `backend/README.md` for more detail.

## Running the app in dev mode

The app lives in `app/` and expects the backend above running.

1. **Install dependencies** (the project uses [bun](https://bun.sh), indicated by `bun.lock`; `npm`/`pnpm`/`yarn` work too):

   ```sh
   cd app
   bun install
   ```

2. **Configure the backend URL.** Copy the example env file and point it at the backend started above
   (this replaces the old `SPARQL_ENDPOINT_URL`/`SPARQL_USER`/`SPARQL_PASSWORD` vars, which now live in
   `backend/.env` instead — see above):

   ```sh
   cp .env.example .env
   ```

   ```
   BACKEND_URL=http://localhost:8090
   ```

   If you have an existing `app/.env` from before this change, edit it the same way — drop the old
   `SPARQL_*` vars and add `BACKEND_URL`.

3. **Start the dev server:**

   ```sh
   bun run dev
   # or: bun run dev -- --open   (also opens a browser tab)
   ```

   The app is served by Vite (SvelteKit), typically at `http://localhost:5173`.

Other useful scripts (run from `app/`):

```sh
bun run build     # production build
bun run preview   # preview the production build
bun run check     # type-check with svelte-check
bun run test      # run unit tests (vitest)
```

## Syncing from Backstage

The backend can pull entities from a [Backstage](https://backstage.io) software catalog and mint them
as individuals in GraphDB, mapped to whichever local class you've tagged with the matching
`backstageKind` — see `spec/report/plan.md` (Sprint 2/3) for the full design. Requires the backend and
app already running per the sections above.

1. **Configure the Backstage source**, in `backend/.env`:

   ```
   BACKSTAGE_BASE_URL=https://your-backstage-instance/api/catalog
   BACKSTAGE_TOKEN=                # leave blank if your instance doesn't require auth
   BACKSTAGE_SYNC_INTERVAL=1h      # how often the background worker runs a real sync (optional, default 1h)
   ```

   Restart `go run ./cmd/server` after changing `.env`.

2. **Mint a bearer token for `importctl`** — every backend route but `/health` requires one (see
   `backend/README.md`'s "Authentication" section):

   ```sh
   cd backend
   export IMPORTCTL_AUTH_TOKEN=$(AUTH_JWT_SECRET=<same value as backend/.env> go run ./cmd/cli mint-token --sub importctl)
   ```

3. **See what Backstage has that you haven't mapped locally yet** — either open the app's hamburger
   menu → **Missing concepts** panel, or from the command line:

   ```sh
   go run ./cmd/cli discover backstage
   ```

4. **Map at least one kind to a local class.** In the Missing Concepts panel, use "Create class now"
   against one of the listed kinds (e.g. `Component`) — or, on an existing class, set its
   `backstageKind` field (in the entity edit form) to match a kind by hand.

5. **Dry-run the sync** to preview what it would do, without writing anything to GraphDB:

   ```sh
   go run ./cmd/cli sync backstage
   ```

6. **Run it for real:**

   ```sh
   go run ./cmd/cli sync backstage --apply
   ```

   (Equivalently: `curl -X POST "http://localhost:8090/sources/backstage/sync?dryRun=false" -H "Authorization: Bearer $IMPORTCTL_AUTH_TOKEN"`.)
   A background worker also re-runs this automatically every `BACKSTAGE_SYNC_INTERVAL` — the CLI/route
   above is for on-demand runs, not a replacement for it.

7. **Check the app.** Switch the canvas to **Instances** view mode — synced individuals show a small
   `⇄ backstage` badge and have their edit (pencil) button disabled, since a sync overwrites manual
   edits on the next run. An individual that disappears from Backstage in a later sync is soft-flagged
   stale (`⚠` badge) rather than deleted — see `spec/report/story-009-staleness-handling.md`.

See `backend/README.md`'s "CLI (`importctl`)" section for the full command reference (`--backend-url`,
error/exit-code behavior, etc.).

### Testing the `represents` link (Component/API → an existing core concept)

Beyond minting a bare individual per Backstage entity, a synced `backstage:Component`/`backstage:API`
individual can also be linked to an existing "real" concept individual you already modeled by hand
(e.g. `core:Application`, `core:Schnittstelle`) — via one `represents` object property, resolved from a
fixed Backstage annotation, `metadata.annotations["enterprise.catalog.iri"]`. Its value must be the
**exact IRI** of the target individual — this is a direct reference, not an identifier lookup, so the
target individual's IRI needs to be predictable and stable before you can annotate anything in
Backstage with it. Setting this up end-to-end:

1. **Give the target class a Concept Namespace**, so its individuals mint under a predictable base IRI
   instead of whichever namespace happens to be active in the canvas. Open the class's edit form (e.g.
   `core:Application`) and set **Concept namespace** to the base IRI you want its individuals' IRIs
   prefixed with, e.g. `https://ld.pageagent.com/application/`. This is stored as
   `<classIri> rse:namespace <baseIri>` and is inherited by subclasses that don't declare their own
   (STORY-099/100).

2. **Create the target individual with an explicit Identifier.** Node menu → **Manage Instances** →
   add a new member, and fill in the **Identifier** field (e.g. `871944`) rather than leaving it blank.
   With a Concept Namespace declared (step 1), the individual mints as
   `<conceptNamespaceBaseIri>#<identifier>` — e.g. `https://ld.pageagent.com/application#871944` — not
   under the namespace selected in the dropdown above it. (An identifier-less, label-derived member
   still mints under the selected namespace as before — the Concept Namespace override only applies
   to this explicit-identifier path.) Copy this IRI (open the individual's "View triples") — Backstage
   needs it verbatim in the next step.

3. **Configure the `represents` predicate once, in the app.** Hamburger menu → **Settings** →
   **Represents predicate** → pick (or first create, via a normal relation edge) the
   `owl:ObjectProperty` you want `represents` links written with. Draw a relation edge using that same
   predicate from `backstage:Component` to `core:Schnittstelle`'s class, and from `backstage:API` to
   `core:Application`'s class — each class's own SHACL shape needs an `sh:property`/`sh:class` entry
   for this predicate, one per (shadow class, target class) pair, or the link resolves to a
   "no shape entry for `<predicate>`" failure at sync time (see step 5).

4. **Annotate the Backstage entity.** On the Component/API entity in Backstage
   (`catalog-info.yaml`'s `metadata.annotations`), set:

   ```yaml
   metadata:
     annotations:
       enterprise.catalog.iri: "https://ld.pageagent.com/application#871944"
   ```

   using the exact IRI copied in step 2.

5. **Dry-run the sync and inspect the full JSON** — `importctl`'s table view (`go run ./cmd/cli sync
   backstage`) only shows proposed individual counts, not per-entity link failures. To see whether the
   `represents` link actually resolved (bad/missing IRI, missing shape entry, or a target-type
   mismatch all fail silently in the table view), call the route directly and check
   `representsFailures`:

   ```sh
   curl -s -X POST "http://localhost:8090/sources/backstage/sync?dryRun=true" \
     -H "Authorization: Bearer $IMPORTCTL_AUTH_TOKEN" | jq .
   ```

   An empty/absent `representsFailures` array means every annotated entity's link resolved cleanly.

6. **Apply the sync** (`go run ./cmd/cli sync backstage --apply`), then check the app: the synced
   `backstage:Component`/`backstage:API` individual should show a relation edge (using the predicate
   from step 3) pointing at the `core:Application`/`core:Schnittstelle` individual from step 2.

## Backstage Relations

| Source Entity | Forward Relation Type | Inverse Relation Type | Target Entity |
| --- | --- | --- | --- |
| User | memberOf | hasMember | Group |
| Group or User | ownerOf | ownedBy | Component |
| Group or User | ownerOf | ownedBy | System |
| Group or User | ownerOf | ownedBy | Domain |
| Group or User | ownerOf | ownedBy | API |
| Group or User | ownerOf | ownedBy | Resource |
| Group or User | ownerOf | ownedBy | Template |
| Domain | hasSystem | partOf (or childOf) | System |
| System | hasComponent | partOf | Component |
| System | hasApi | partOf | API |
| Component | dependsOn | dependencyOf | Component |
| Component | dependsOn | dependencyOf | Resource |
| Component | providesApi | apiProvidedBy | API |
| Component | consumesApi | apiConsumedBy | API |
| Resource | dependencyOf | dependsOn | Component |
| Location | contains | managedByLocation | Any Entity |