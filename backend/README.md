# backend

A standalone Go service, sibling to `app/`, that sits between the SvelteKit app and GraphDB. It
starts as a SPARQL gateway passthrough (`POST /sparql`, `POST /sparql/update`) and is the deployable
substrate later stories attach Backstage-sync routes and a background worker to — see
`spec/report/plan.md`.

It also serves source-parameterized ingestion routes resolved against an in-process registry
(`internal/sync.Registry`) — `backstage` is the first registered source:

```
GET /sources/{source}/discover
```

Returns the upstream `kind`s present in the named source's live catalog that have no corresponding
local class (via the `backstageKind` annotation predicate) — `404` for an unknown source name, `502`
if the upstream source or GraphDB is unreachable. Configure the Backstage source via
`BACKSTAGE_BASE_URL`/`BACKSTAGE_TOKEN` in `.env` (see `.env.example`); the service still starts
without them, but Backstage-sourced routes fail at call time until both are set.

```
POST /sources/{source}/sync?dryRun=true|false
```

Triggers an immediate sync/merge run (`internal/sync.Engine.RunSync`) and returns its summary —
`dryRun` (default `false`) computes the full plan and reports it without writing anything to
GraphDB. `404` for an unknown source, `409` if a real (non-dry-run) sync for that source is already
in progress (dry runs are exempt), `502` if the upstream source is unreachable. A
`BackstageSyncWorker` also ticks a real sync automatically on `BACKSTAGE_SYNC_INTERVAL` (default
`1h`, see `.env.example`) — this route is for on-demand/CLI-triggered runs, not a replacement for it.

## CLI (`importctl`)

`backend/cmd/cli` is a thin HTTP client over the two routes above, meant to be run against an
already-running backend (`go run ./cmd/server` or the Docker Compose service):

```sh
go run ./cmd/cli discover backstage
go run ./cmd/cli sync backstage              # dry-run by default — writes nothing
go run ./cmd/cli sync backstage --apply      # performs a real sync

# point at a non-default backend:
go run ./cmd/cli sync backstage --backend-url http://localhost:8090
# or: BACKEND_URL=http://localhost:8090 go run ./cmd/cli sync backstage
```

## Running locally

```sh
cd backend
cp .env.example .env
# edit .env: GRAPHDB_ENDPOINT_URL must point at your running GraphDB repository
# (see the root README.md for standing one up), GRAPHDB_USER/PASSWORD if it requires auth

go run ./cmd/server
# or: PORT=8090 go run ./cmd/server
```

Verify it started:

```sh
curl http://localhost:8090/health
# {"status":"ok"}
```

`app/`'s `bun run dev` expects this service running alongside it (via `BACKEND_URL` in
`app/.env`) — see the root README.md.

## Testing

```sh
go test ./...
```

## Docker Compose

A `backend` service definition lives in the root `docker-compose.yml`, sibling to GraphDB. It has no
database of its own — GraphDB is the only store, reached over `GRAPHDB_ENDPOINT_URL`.

```sh
docker compose up --build backend
```
