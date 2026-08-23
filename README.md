# rdf-schema-editor

A visual ERD-style editor for RDF Schema (`owl:Class`, `owl:ObjectProperty`/`owl:DatatypeProperty`,
`rdfs:domain`/`rdfs:range`) and SHACL shapes (`sh:NodeShape`/`sh:PropertyShape`), backed directly by a
GraphDB repository — the diagram reads and writes the graph, there is no separate "export" step.

See `spec/setup/plan.md` for the full implementation plan, architecture decisions, and story breakdown.

## How it's organized

- **`app/`** — the web application (SvelteKit + Svelte 5 + TypeScript). This is the primary user-facing
  piece; see below for running it.
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

## Running the app in dev mode

The app lives in `app/` and expects the GraphDB repository set up above.

1. **Install dependencies** (the project uses [bun](https://bun.sh), indicated by `bun.lock`; `npm`/`pnpm`/`yarn` work too):

   ```sh
   cd app
   bun install
   ```

2. **Configure the SPARQL endpoint.** Copy the example env file and adjust it to point at your triple store:

   ```sh
   cp .env.example .env
   ```

   ```
   SPARQL_ENDPOINT_URL=http://localhost:7201/repositories/rdfschema
   SPARQL_USER=
   SPARQL_PASSWORD=
   ```

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
