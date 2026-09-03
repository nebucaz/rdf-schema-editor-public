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

## Authentication

Every route except `/health` requires a signed JWT: `Authorization: Bearer <jwt>`, HS256-signed
against `AUTH_JWT_SECRET`. A missing header, malformed header, bad signature, or expired token all
get a `401` (see `spec/threat-mitigation/plan.md`). This is a deliberate placeholder — a static,
per-caller identity minted ahead of time, not a per-human login — until real end-user identity
arrives from the embedding framework the app is expected to run inside.

Mint a token with the `importctl mint-token` subcommand (see below): one for the frontend
(`--sub frontend-app`, configured as `app/.env`'s `BACKEND_AUTH_TOKEN`), and a distinct one for
`importctl` itself (`--sub importctl`, configured as `IMPORTCTL_AUTH_TOKEN`).

### Audit log

Every request that reaches `/sparql`, `/sparql/update`, `/sources/{source}/discover`, or
`/sources/{source}/sync` (i.e. every request the auth middleware above let through) writes one
structured JSON line to stdout, distinct from `chimiddleware.Logger`'s own method/path/status line:

```json
{"timestamp":"2026-09-03T12:00:00Z","caller":"frontend-app","method":"POST","path":"/sparql","detail":"SELECT ?s WHERE { ?s ?p ?o }","status":200}
```

`caller` is the verified JWT `sub`; `detail` is the SPARQL query/update text (bounded to 500 bytes)
for the two SPARQL routes, or the source name for the two source routes; `error` is present only on
a non-2xx outcome. An unauthenticated request (rejected `401`) never reaches a handler and gets no
audit entry — it's already visible via the request logger, with no real identity to attach.

**Current-phase limitation**: `caller` is a static per-caller identity baked into the JWT at mint
time (`frontend-app`, `importctl`), not a per-human identity — real end-user identity is expected to
arrive later from the framework embedding this app (see `spec/threat-mitigation/research.md`'s
"Design: audit logging" section and `spec/threat-mitigation/plan.md`).

## CLI (`importctl`)

`backend/cmd/cli` is a thin HTTP client over the two routes above, meant to be run against an
already-running backend (`go run ./cmd/server` or the Docker Compose service):

Every request needs its own signed JWT (`--sub importctl`, see "Authentication" above) — set once
via `IMPORTCTL_AUTH_TOKEN`, or pass `--token` per invocation:

```sh
export IMPORTCTL_AUTH_TOKEN=$(AUTH_JWT_SECRET=... go run ./cmd/cli mint-token --sub importctl)

go run ./cmd/cli discover backstage
go run ./cmd/cli sync backstage              # dry-run by default — writes nothing
go run ./cmd/cli sync backstage --apply      # performs a real sync

# point at a non-default backend:
go run ./cmd/cli sync backstage --backend-url http://localhost:8090
# or: BACKEND_URL=http://localhost:8090 go run ./cmd/cli sync backstage

# or pass the token per invocation instead of exporting it:
go run ./cmd/cli sync backstage --token "$IMPORTCTL_AUTH_TOKEN"
```

`importctl mint-token` signs a JWT against `AUTH_JWT_SECRET` (read from env — this subcommand
doesn't call a running backend) and prints it to stdout. `--ttl` defaults to 1 year
(`8760h`); `--sub` is required:

```sh
# the frontend's token — app/.env's BACKEND_AUTH_TOKEN
AUTH_JWT_SECRET=... go run ./cmd/cli mint-token --sub frontend-app

# importctl's own token — this CLI's own IMPORTCTL_AUTH_TOKEN (see below)
AUTH_JWT_SECRET=... go run ./cmd/cli mint-token --sub importctl --ttl 8760h
```

## Running locally

```sh
cd backend
cp .env.example .env
# edit .env: GRAPHDB_ENDPOINT_URL must point at your running GraphDB repository
# (see the root README.md for standing one up), GRAPHDB_USER/PASSWORD if it requires auth,
# and AUTH_JWT_SECRET (required — the backend fails to start without it, see "Authentication" below)

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
