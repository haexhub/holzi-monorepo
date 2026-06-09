# Plan 19: Production Hardening

Depends on: most prior plans (this is the deploy-ready pass).

## Goal

Make Holzi realistic to run as an always-on server agent reachable from
everywhere.

## Why

The agent hub only works if it survives real use: mobile networks, public
internet exposure, backups, restarts, and deployment drift.

## Scope

Backend/Infra:

- Finish frontend-to-backend deploy handoff.
- Add security headers.
- Add rate limits for failed auth and expensive chat endpoints.
- Add health/diagnostics endpoint.
- Add SQLite backup script.

Frontend:

- Ensure mobile layout is usable.
- Add diagnostics page link in Control Center.

Tests:

- Backend health endpoint.
- Build/deploy smoke command.
- Backup script dry-run if feasible.

## Suggested Implementation

1. Decide deployment shape:
   - single Holzi image containing built frontend
   - or separate frontend static image behind Traefik
2. Add Dockerfile/compose changes.
3. Add Traefik labels:
   - TLS
   - rate limit
   - security headers
4. Add `make backup` or script for SQLite `.backup`.
5. Add `/api/health` or `/api/diagnostics`.
6. Mobile layout: collapse three columns into drawers/tabs.

## Acceptance Criteria

- One documented command can build/deploy the stack locally.
- Frontend is served by the production stack.
- Mobile chat is usable.
- Health endpoint reports core dependencies.
- Backup script produces a restorable SQLite backup.

## Out Of Scope

- Full VPS bootstrap automation.
- Passkey auth.
- Multi-user accounts.
- External monitoring service integration.

## Files Likely Touched

- Holzi backend/infra:
  - `Dockerfile`
  - `docker-compose.yml`
  - `Makefile`
  - `src/hermes/main.py`
  - `src/hermes/routes/health.py`
  - `scripts/`
- Frontend:
  - `Dockerfile`
  - `nginx.conf`
  - `app/pages/index.vue`
