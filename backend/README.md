# backend

A standalone Go service, sibling to `app/`, that sits between the browser (via nginx, or the Vite dev
proxy) and GraphDB. It is a SPARQL gateway passthrough (`POST /sparql`, `POST /sparql/update`) plus the
Backstage-sync routes and worker, the user-identity/session routes, and the annotation and short-link logic
the frontend used to run in SvelteKit — see `spec/report/plan.md` and `spec/static-frontend/plan.md`.

```
POST /sparql          {"query": string, "infer"?: false}
POST /sparql/update   {"update": string}
```

Both accept `Content-Type: application/json` (the browser's contract); form-encoded `query`/`update`/
`infer` bodies are still accepted for non-browser callers. A successful response is GraphDB's body
relayed unchanged. Every error is JSON `{"message": string}`: `400` for a missing/invalid parameter
or malformed body, `502` if GraphDB is unreachable, and GraphDB's own status (message = its error
text) otherwise.

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
GET /sources/{source}/raw/{kind}
```

Returns the source's own undecoded upstream JSON for every entity of `kind` — every field it sent
(including `relations[]`), with none of this app's field-mapping or `rse:sourceRelation` resolution
applied. A debugging escape hatch for confirming exactly what upstream sent, e.g. whether a missing
relation is a genuinely-empty `relations[]` upstream vs. one this app's own mapping/target-resolution
skipped (see `SyncSummary.skippedRelations` for that latter case). `404` for an unknown source, `501`
for a source that doesn't implement `sync.RawSource` (not every source need support this), `502` if
upstream is unreachable.

```
POST /sources/{source}/sync?dryRun=true|false
```

Triggers an immediate sync/merge run (`internal/sync.Engine.RunSync`) and returns its summary —
`dryRun` (default `false`) computes the full plan and reports it without writing anything to
GraphDB. `404` for an unknown source, `409` if a real (non-dry-run) sync for that source is already
in progress (dry runs are exempt), `502` if the upstream source is unreachable. A
`BackstageSyncWorker` also ticks a real sync automatically on `BACKSTAGE_SYNC_INTERVAL` (default
`1h`, see `.env.example`) — this route is for on-demand/CLI-triggered runs, not a replacement for it.

## Route overview

| Route | Service JWT | Signed-in user | Notes |
|-------|:-----------:|:--------------:|-------|
| `GET /health` | – | – | liveness |
| `GET /config` | – | – | `{defaultNamespaceBaseIri, devLoginEnabled}` |
| `GET /me` | – | – | `{user}` or `{user: null}` |
| `POST /auth/dev-login`, `POST /auth/logout` | – | – | only when `DEV_LOGIN_ENABLED=true` |
| `POST /sparql`, `POST /sparql/update` | ✔ | ✔ | GraphDB passthrough |
| `GET /validation/report` | ✔ | ✔ | |
| `POST /shared-queries`, `GET /shared-queries/{id}` | ✔ | ✔ | short share links |
| `POST /annotations`, `DELETE /annotations` | ✔ | ✔ | server-side stamping |
| `GET /sources/{source}/discover`, `GET …/raw/{kind}`, `POST …/sync` | ✔ | – | sync worker and `importctl` have no user |

"Signed-in user" = a verified `Oglala` cookie (`handler.RequireUser`, otherwise JSON 401 `"Sign in required"`).

```
POST /shared-queries        {"model": <QueryModel>}  ->  {"id": string}
GET  /shared-queries/{id}                            ->  {"model": <QueryModel>}  (404 if unknown)
```

The model is validated with the Go port of the frontend's `parseQueryModel` (`internal/querymodel`, at most
200 000 characters, else `413`) and stored as a `SharedQuery` node in the default namespace's `/schema` graph; `createdBy`
(the cookie user's `sub`) and `createdAt` are stamped here and any client-supplied values ignored. Ids are
10-character short-link ids (`internal/shortlinks`); a malformed id is rejected before any SPARQL runs.

```
POST   /annotations   {"fact": {...}, "annotation": {...}}  ->  {"iri", "annotatedBy", "annotatedAt"}
DELETE /annotations   {"iri": string}                       ->  {"success": true}
```

Stores the reified annotation (`internal/annotations`); `annotatedBy`/`annotatedAt` are stamped from the cookie
user and the server clock. `DELETE` only removes nodes typed `Annotation`. Bad input is `400`, GraphDB failures
`502`.

The SPARQL guards, query-model validation, short-link ids and annotation SPARQL are mirrored in the frontend;
`testdata/golden/*.json` are shared fixtures that both `go test` and Vitest consume.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `GRAPHDB_ENDPOINT_URL` | – (required) | GraphDB repository URL. In a container use `host.docker.internal`, not `localhost` |
| `GRAPHDB_USER`, `GRAPHDB_PASSWORD` | empty | Basic auth, if the repository needs it |
| `AUTH_JWT_SECRET` | – (required) | HS256 secret for the service JWT |
| `PORT` | `8090` | listen port |
| `PUBLIC_SCHEMA_NAMESPACE` | built-in default | default namespace; served to the frontend by `/config` |
| `BACKSTAGE_BASE_URL`, `BACKSTAGE_TOKEN` | empty | Backstage source |
| `BACKSTAGE_SYNC_INTERVAL` | `1h` | background sync period |
| `USER_JWT_SECRET` | empty | HS256 secret verifying the `Oglala` cookie; unset = nobody is ever signed in |
| `DEV_LOGIN_ENABLED` | `false` | route the dev login/logout; needs `USER_JWT_SECRET`, refused when `APP_ENV=production` |
| `COOKIE_SECURE` | `false` | `Secure` attribute on the dev-login cookie (set with HTTPS) |
| `APP_ENV` | empty | `production` forbids the dev login |
| `ALLOWED_ORIGINS` | empty | extra origins the CSRF guard accepts (comma-separated) |

## Authentication

Every route except `/health` and the session routes (`GET /config`, `GET /me`, `POST /auth/dev-login`, `POST /auth/logout`) requires a signed service JWT: `Authorization: Bearer <jwt>`, HS256-signed
against `AUTH_JWT_SECRET`. A missing header, malformed header, bad signature, or expired token all
get a `401` (see `spec/threat-mitigation/plan.md`). This is a deliberate placeholder — a static,
per-caller identity minted ahead of time, not a per-human login — until real end-user identity
arrives from the embedding framework the app is expected to run inside.

Mint a token with the `importctl mint-token` subcommand (see below): one for the frontend
(`--sub frontend-app`; nginx injects it from the root `.env`'s `BACKEND_AUTH_TOKEN`, the Vite dev proxy from
`app/.env`'s `DEV_BACKEND_AUTH_TOKEN`), and a distinct one for `importctl` itself (`--sub importctl`,
configured as `IMPORTCTL_AUTH_TOKEN`). The data routes additionally need the signed-in user described next.

### User identity (`GET /me`)

The end user is identified by an HS256 JWT in the `Oglala` cookie, verified with `USER_JWT_SECRET`
(separate from `AUTH_JWT_SECRET`). `GET /me` returns `{"user": {sub, displayName, email, department,
groups}}`, or `{"user": null}` (status 200) for an absent, invalid or expired cookie — or when
`USER_JWT_SECRET` is unset. `handler.UserFromRequest(r)` gives later handlers the verified user, and
`handler.RequireUser` refuses the request with `401 {"message": "Sign in required"}` when there is none.

### Dev login (`POST /auth/dev-login`, `POST /auth/logout`)

Only routed when `DEV_LOGIN_ENABLED=true` (otherwise `404`); startup is refused with
`APP_ENV=production` or without `USER_JWT_SECRET`. `dev-login` takes an optional JSON body
`{"sub"?: string}` (default `dev-user`) and sets the `Oglala` cookie — an 8-hour HS256 token with the
same claims as an SSO one (`groups: []`), `HttpOnly; SameSite=Lax; Path=/`, plus `Secure` when
`COOKIE_SECURE=true`. `logout` expires the cookie. Send `Content-Type: application/json` from a
browser (see CSRF guard). The SSO "auth token" counterpart is not implemented (open question in the spec).

### Runtime config (`GET /config`)

Replies `{"defaultNamespaceBaseIri", "devLoginEnabled"}` — the default namespace base IRI derived
from `PUBLIC_SCHEMA_NAMESPACE` (same derivation as `app/src/lib/config.ts`'s `defaultNamespaceBaseIriFrom`), and
whether the dev login is on. No secrets; no service token needed.

### CSRF guard

Every non-`GET` route (including the session routes) also passes `handler.CSRFGuard`. A request carrying any of
`Cookie`, `Origin` or `Sec-Fetch-Site` (i.e. from a browser) must be `Content-Type: application/json`
(`415` otherwise), have an `Origin` equal to the request `Host` or listed in `ALLOWED_ORIGINS`, and
not be `Sec-Fetch-Site: cross-site` (`403`). Requests with none of those headers (`importctl`) are
unaffected. Rejections are JSON `{"message"}` and audit-logged. When a reverse proxy sits in front,
forward the original `Host` or set `ALLOWED_ORIGINS`.

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

# dump the raw upstream JSON for every Component (or any other kind) — no mapping applied
go run ./cmd/cli raw backstage Component
go run ./cmd/cli raw backstage Component --out component-dump.json

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

`app/`'s `bun run dev` expects this service running alongside it (its Vite proxy targets
`DEV_BACKEND_URL` in `app/.env`) — see the root README.md, including "Tokens".

## Testing

```sh
go test ./...
```

## Docker Compose

The root `docker-compose.yml` defines `backend` (this service, **no published port**) and `frontend` (nginx
serving the static app and proxying `/api/` here). It has no database of its own — GraphDB is the only store,
reached over `GRAPHDB_ENDPOINT_URL` (use `host.docker.internal` for a GraphDB on the host).

```sh
docker compose up --build        # needs the root .env with BACKEND_AUTH_TOKEN, see the root README
```
