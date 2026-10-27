# app

The SvelteKit frontend (Svelte 5 + TypeScript) of the RDF Schema Editor. It builds to **static files only**
(`@sveltejs/adapter-static`, SPA mode with an `index.html` fallback, `ssr = false`) — there is no server code;
the browser talks to the Go `backend/` through `/api/*`. See the root `README.md` for the full setup
(backend, tokens, Docker Compose) and `CLAUDE.md` for the architecture.

```sh
bun install
bun run dev        # http://localhost:5173 — /api is proxied to the Go backend (needs app/.env, see .env.example)
bun run check      # svelte-check
bun run test       # vitest (server + jsdom component projects)
bun run build      # static site in build/ (index.html + _app/)
```

`bun run dev` has no nginx, so `vite.config.ts` proxies `/api` to `DEV_BACKEND_URL` and adds the service token
from `DEV_BACKEND_AUTH_TOKEN` (both read from `app/.env`, never bundled).

Production is `app/Dockerfile`: a Bun build stage, then `nginxinc/nginx-unprivileged` serving `build/` on
port 8080 with the config in `nginx/default.conf.template` (SPA fallback, `/api/` proxy that injects the service
token, CSP and security headers). Run it with `docker compose up --build` from the repo root.
