# SPA build (nuxt.config.ts has ssr: false) — Nuxt drops static assets
# under .output/public/. We serve them through nginx instead of node so
# the runtime image stays small and there's no server-side rendering
# loop to keep alive.

# ── Build stage ───────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# pnpm via corepack. Pinned to v10 to match the ci.yml workflow
# (uses pnpm/action-setup@v4 with version: 10). `@latest` would resolve
# to pnpm 11 today, which trips ERR_PNPM_IGNORED_BUILDS on this
# repo's onlyBuiltDependencies declaration in pnpm-workspace.yaml.
RUN corepack enable && corepack prepare pnpm@10 --activate

# Install deps first for cache-friendly rebuilds.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Build the SPA. `nuxt generate` (not `nuxt build`) is what we want for
# nginx-served static output: `build` produces a Nitro Node server +
# assets but leaves no top-level index.html. `generate` pre-renders the
# SPA shell into .output/public/index.html so nginx can serve a
# fully-static bundle without any Node runtime.
COPY . .
RUN pnpm run generate

# ── Runtime stage ─────────────────────────────────────────────────────
FROM nginx:1.27-alpine

# Custom config provides the SPA history-mode fallback (every unknown
# path falls through to index.html so vue-router can resolve it
# client-side).
COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=builder /app/.output/public /usr/share/nginx/html

EXPOSE 80

# Default nginx CMD is fine — keeps the foreground process for docker.
