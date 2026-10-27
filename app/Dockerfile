# Build stage — Node/Bun is only needed here, to compile the static site.
FROM oven/bun:1 AS build

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build
# Security headers incl. the hash of SvelteKit's inline bootstrap script (changes every build).
RUN bun run scripts/csp-snippet.ts build/index.html /tmp/security-headers.conf

# Runtime stage — nginx serving static files; no Node runtime. The unprivileged image runs as the
# non-root `nginx` user on port 8080 and may write the rendered config.
FROM nginxinc/nginx-unprivileged:stable-alpine

# Only these two variables are substituted into the template; nginx's own $host, $uri, ... survive.
ENV NGINX_ENVSUBST_FILTER="^(BACKEND_UPSTREAM|BACKEND_AUTH_TOKEN|ENABLE_HSTS)$"
# Send Strict-Transport-Security only when TLS is terminated in front of this container.
ENV ENABLE_HSTS=false

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /tmp/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 8080
