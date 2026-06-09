# Plan 20-B: Dev-Stack docker-agnostisch machen

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Implemented and merged on 2026-05-30.** Cross-repo: backend
[Holzi#52](https://github.com/haexhub/Holzi/pull/52) (squashed as
`1fa341b`), frontend
[holzi-frontend#58](https://github.com/haexhub/holzi-frontend/pull/58)
(squashed as `525fc50`).

Unblocks the live verification step that [Plan 20-A](./20a-sandbox-crash-log.md)
had to defer: the Makefile now auto-detects docker first then podman
(override via `CONTAINER_BIN=` / `COMPOSE_BIN=`); sandbox-specific bits
(HERMES_SANDBOX_* env + Podman control-socket mount) moved to a new
`docker-compose.local.podman.yml` overlay that the Makefile layers in only
when `CONTAINER_BIN=podman`. Hand-running compose without the Makefile keeps
working thanks to `${HERMES_CONTAINER_SOCKET:-/var/run/docker.sock}` in the
base file. `XDG_RUNTIME_DIR` empty (sudo / cron / minimal CI shells) is
covered by a `/run/user/$(id -u)` fallback in the Makefile.

CodeRabbit was credits-exhausted on both PRs (per
[[feedback-coderabbit-workflow]] credit-exhaustion fallback). Two parallel
general-purpose agents (one per repo) reviewed instead. Findings worth
addressing: empty-`XDG_RUNTIME_DIR` fallback, compose hand-run default, and
`.env.example` empty-value trap on the backend; user-local
`../../../../.claude/projects/...` paths replaced with `[[memory-ref]]`
form on the frontend, and Task 2 tagged as already-covered by the existing
`tests/test_api_sandbox.py::test_sandbox_status_503_when_not_configured`.

Verification (2026-05-30):

- `cd /home/haex/Projekte/Holzi && make -n up-local-full` on the user's
  Docker host → `docker compose -p hermes-local -f docker-compose.local.yml`,
  no `sandbox-image` build, no Podman overlay.
- `make -n CONTAINER_BIN=podman up-local-full` → `podman compose` invocation
  includes `-f docker-compose.local.podman.yml` and `podman build
  hermes-sandbox:dev`.
- `make CONTAINER_BIN= up-local-full` → clean error, exit 1.
- `docker compose -p hermes-local -f docker-compose.local.yml -f
  docker-compose.local.podman.yml config` → Podman overlay merges cleanly;
  base alone has no sandbox refs.
- `make up-local-full` live on the user's Docker host → all five containers
  (`hermes-server`, `haex-claude-proxy`, `signal-cli-rest-api`,
  `holzi-frontend`, `hermes-traefik`) come up; `/api/diagnostics` returns
  six checks with `sandbox: warning ("HERMES_SANDBOX_SOCKET not set")`;
  frontend serves 200 OK at `app.localhost`; `/api/sandbox/crashes` returns
  `[]` cleanly.
- `make down-local` cleans up containers + network.
- **Podman live verification: deferred.** No Podman host reachable in this
  session. The compose-config parse smoke covers the overlay merge; the
  real Plan 20-A end-to-end (Podman crash → DB row → page row → restart
  survives) still requires a Podman host. Plan 20-A's manager-level
  `test_sandbox_crash_persistence.py` covers the persistence contract via
  `FakeSandboxBackend`; the live-Podman re-verification stays on the
  haex.cloud box as a follow-up.
- Backend full test suite did not need to run — no Python code changed.

This slice does **not** change the production sandbox runtime. Holzi's
production sandbox-manager stays hard rootless-Podman per
[[project-holzi-sandbox-podman]]; Plan 20-B only makes the *dev-stack wrapper*
runtime-agnostic so a frontend-focused developer with only Docker installed
can still bring the stack up and exercise the agent against a working
sandbox-less backend.

## Goal

`make up-local-full` succeeds on both hosts:

- **Docker-only host** (current user setup): the stack starts without any
  Podman socket. The backend's `SandboxManager` resolves to `None`
  (Plan 11b-a behaviour for unset `HERMES_SANDBOX_SOCKET`); workspace and
  exec tools return 503, the Diagnostics page reports
  `Sandbox-Runtime: warning, not configured`, everything else works.
- **Podman host** (CI / haex.cloud): unchanged. Sandbox-spawning still works.

## Why

Three concrete defects, all reproducible on the user's host today:

1. `Makefile:9-10` hard-defaults `CONTAINER_BIN ?= podman` /
   `COMPOSE_BIN ?= $(CONTAINER_BIN) compose`. Podman 3.4.x has no built-in
   `compose` subcommand → `unknown shorthand flag: 'p' in -p`.
2. `podman-compose 1.5.0` (Python fallback) hangs in `epoll_wait` instead of
   launching the stack — it mis-parses the nested
   `${HERMES_PODMAN_SOCKET:-${XDG_RUNTIME_DIR}/podman/podman.sock}` spread
   across `docker-compose.local.yml:89` and `docker-compose.local.yml:223`.
3. `docker-compose.local.yml:89` mounts the Podman control socket into
   `hermes-server` unconditionally. On a Docker host that socket path
   doesn't exist; compose errors before any container starts.

## Non-Goals

- Making the **production** stack docker-compatible. Plan 11b-a explicitly
  pinned production sandboxing to rootless Podman; this slice does not
  touch `docker-compose.yml`.
- Building a docker-shim sandbox backend. Sandboxes simply stay off on a
  Docker host; the agent already survives the missing socket.
- A Compose v1 fallback. Only `docker compose` v2 and `podman compose`
  (Podman 4.x built-in) are supported. `podman-compose 1.5.0` stays broken
  and undocumented — users on Podman 3.x are pointed at upgrading.
- Cleaning up unrelated Makefile / compose lint. Touch only the lines this
  plan needs.

## Scope

Backend repo (`/home/haex/Projekte/Holzi`):

- `Makefile` — auto-detect runtime (`docker` preferred when both present, ▼
  override via `CONTAINER_BIN=…`), conditional `sandbox-image` dependency,
  conditional Podman-overlay compose file, and a clear early-exit if no
  runtime is installed.
- `docker-compose.local.yml` — flatten the two nested substitutions
  (`HERMES_PODMAN_SOCKET` + `XDG_RUNTIME_DIR`) into a single
  `HERMES_CONTAINER_SOCKET` variable. Move the **sandbox**-socket mount on
  `hermes-server` and the `HERMES_SANDBOX_*` env vars into a new overlay
  file; the base file keeps only what works on both runtimes.
- `docker-compose.local.podman.yml` *(new)* — Podman-only overlay that re-
  adds the sandbox socket mount + `HERMES_SANDBOX_*` env on `hermes-server`.
- `.env.example` — document `HERMES_CONTAINER_SOCKET` with both runtimes'
  defaults and a "leave unset to let the Makefile pick" note.
- Smoke test that the existing `SandboxManager` lifespan path stays clean
  when `HERMES_SANDBOX_SOCKET` is unset. **Only if** there isn't already
  one — search first; `build_sandbox_manager` already handles this so a
  test very likely exists.

Frontend repo (`/home/haex/Projekte/holzi-frontend`):

- No code changes expected. The Diagnostics page already renders
  `Sandbox-Runtime: warning, not configured` for the Docker-only case.
- This plan file + a one-line bump in
  `docs/plans/holzi-agent-parity/README.md`'s "next up".
- Memory updates per [[feedback-session-wrapup-ritual]] after merge.

Cross-repo workflow per [[feedback-cross-repo-workflow]] applies, but the
backend slice ships first (no API surface changes — pure Makefile/compose),
so `pnpm run gen:api` is **not** needed this session.

## Suggested Implementation

### 1. Backend — confirm `SandboxManager` already tolerates a missing socket

Read `src/hermes/sandbox/manager.py::build_sandbox_manager` (or wherever the
factory now lives) and the corresponding lifespan boot in `src/hermes/main.py`.
The Plan 11b-a contract is that `build_sandbox_manager()` returns `None` when
`HERMES_SANDBOX_SOCKET` is unset and the rest of the app routes around that
absence (workspace/exec endpoints → 503).

```bash
cd /home/haex/Projekte/Holzi
grep -nE "HERMES_SANDBOX_SOCKET|build_sandbox_manager|sandbox_manager" \
    src/hermes/main.py src/hermes/sandbox/manager.py src/hermes/config.py
```

Expected: a guard that returns `None`/skips when the env var is empty. If
the guard is missing, **stop and reopen as a backend slice** — the dev-stack
fix below depends on the backend tolerating a no-sandbox boot.

### 2. Backend — smoke test for "no sandbox socket" lifespan

**Already covered — skip unless the existing coverage regresses.**
`tests/test_api_sandbox.py::test_sandbox_status_503_when_not_configured`
and `test_sandbox_restart_503_when_not_configured` both drive the full
lifespan via `LifespanManager(app)` and assert
`app.state.sandbox_manager is None`, which is exactly the contract this
slice depends on. Verified during execution; no new test added.

Grep tests first:

```bash
cd /home/haex/Projekte/Holzi
grep -RnE "HERMES_SANDBOX_SOCKET|sandbox_manager is None|build_sandbox_manager" tests/
```

If a test already proves the lifespan boots cleanly without
`HERMES_SANDBOX_SOCKET`, do nothing. Otherwise add one — minimal shape,
modelled on existing lifespan tests:

```python
# tests/test_main_no_sandbox.py
import os

import pytest
from httpx import ASGITransport, AsyncClient

from hermes.main import app


@pytest.mark.asyncio
async def test_app_boots_without_sandbox_socket(monkeypatch, tmp_path):
    monkeypatch.delenv("HERMES_SANDBOX_SOCKET", raising=False)
    monkeypatch.setenv("HERMES_DB_PATH", str(tmp_path / "hermes.db"))
    monkeypatch.setenv("HERMES_AUTH_TOKEN", "test")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # /api/diagnostics returns 200 even when sandbox is unconfigured;
        # the response just carries sandbox=warning. We only need to prove
        # lifespan startup did not raise.
        resp = await ac.get(
            "/api/diagnostics",
            headers={"Authorization": "Bearer test"},
        )
        assert resp.status_code == 200
        assert app.state.sandbox_manager is None
```

Run it: `uv run pytest tests/test_main_no_sandbox.py -v` → green.

Commit: `test(devstack): cover lifespan boot without HERMES_SANDBOX_SOCKET`.

### 3. Backend — flatten the nested substitution in `docker-compose.local.yml`

Two changes in `docker-compose.local.yml`:

- `:89` (volume mount on `hermes-server`) — **delete entirely**, moves to
  the Podman overlay (Task 5).
- `:81-83` (sandbox env on `hermes-server`) — **delete entirely**, moves
  to the Podman overlay.
- `:223` (volume mount on `traefik`) — replace the nested form with a
  single flat variable:

```yaml
  traefik:
    volumes:
      # Container-control socket — docker.sock on Docker hosts, the rootless
      # Podman socket on Podman hosts. The Makefile picks the default; the
      # user can pin a path via HERMES_CONTAINER_SOCKET in .env.
      - ${HERMES_CONTAINER_SOCKET}:/var/run/docker.sock:ro
```

No fallback inside compose — the Makefile guarantees the variable is set.
Flat substitution parses identically in `docker compose` v2 and `podman
compose` (Podman 4.x built-in), avoiding the `${A:-${B}/x}` shape that
broke `podman-compose 1.5.0`.

Smoke-check that the diff doesn't break the base parse:

```bash
cd /home/haex/Projekte/Holzi
HERMES_CONTAINER_SOCKET=/var/run/docker.sock \
  docker compose -p hermes-local -f docker-compose.local.yml config > /dev/null
```

Expected: exit 0, no output.

Commit: `chore(devstack): flatten container-socket substitution in compose`.

### 4. Backend — strip sandbox-specific bits out of the base compose

In `docker-compose.local.yml` under the `hermes-server:` service, remove:

```yaml
      HERMES_SANDBOX_SOCKET: ${HERMES_SANDBOX_SOCKET:-unix:///run/podman/podman.sock}
      HERMES_SANDBOX_NETWORK: ${HERMES_SANDBOX_NETWORK:-none}
      HERMES_SANDBOX_IMAGE: ${HERMES_SANDBOX_IMAGE:-hermes-sandbox:dev}
```

…and remove the volume entry pointing at the Podman socket. Leave a single
short comment in place referencing the overlay file:

```yaml
    # Sandbox runtime envs + Podman-socket mount live in
    # docker-compose.local.podman.yml. Layered in by the Makefile when
    # CONTAINER_BIN=podman. Docker-only hosts skip both — the agent
    # detects the missing HERMES_SANDBOX_SOCKET and disables sandboxes
    # at boot (Plan 11b-a). Workspace/exec endpoints return 503 in that
    # mode; everything else works.
```

Verify the file still parses, this time without any sandbox vars set:

```bash
HERMES_CONTAINER_SOCKET=/var/run/docker.sock \
  docker compose -p hermes-local -f docker-compose.local.yml config | \
  grep -E "HERMES_SANDBOX|podman.sock" || echo "no sandbox refs remain"
```

Expected: prints `no sandbox refs remain`.

Commit: `chore(devstack): drop sandbox-only env+mount from base compose`.

### 5. Backend — add the Podman overlay file

Create `docker-compose.local.podman.yml`:

```yaml
# Podman-only overlay for the local dev-stack.
#
# Layered in by the Makefile when CONTAINER_BIN=podman. Adds the rootless
# Podman control-socket mount + HERMES_SANDBOX_* env so the agent can
# spawn workspace sandboxes. Docker-only hosts never see this file and
# boot the agent with sandboxing disabled (warning state on
# /settings/diagnostics).
services:
  hermes-server:
    environment:
      HERMES_SANDBOX_SOCKET: ${HERMES_SANDBOX_SOCKET:-unix:///run/podman/podman.sock}
      HERMES_SANDBOX_NETWORK: ${HERMES_SANDBOX_NETWORK:-none}
      HERMES_SANDBOX_IMAGE: ${HERMES_SANDBOX_IMAGE:-hermes-sandbox:dev}
    volumes:
      - ${HERMES_CONTAINER_SOCKET}:/run/podman/podman.sock
```

Verify it composes with the base file under Podman semantics:

```bash
HERMES_CONTAINER_SOCKET=$XDG_RUNTIME_DIR/podman/podman.sock \
  docker compose -p hermes-local \
    -f docker-compose.local.yml \
    -f docker-compose.local.podman.yml \
    config | grep -A2 "HERMES_SANDBOX_SOCKET\|/run/podman/podman.sock"
```

Expected: shows the sandbox env + mount on `hermes-server`. (We use
`docker compose config` for parsing — the merge semantics are identical;
this is just a parse-time check.)

Commit: `feat(devstack): add Podman overlay for sandbox socket`.

### 6. Backend — Makefile auto-detect + conditional overlay

Replace the runtime block at the top of `Makefile`. The diff is concentrated;
the rest of the file stays untouched.

```makefile
# Container runtime — auto-detect. Docker is preferred when both are
# installed because most contributors install it first; explicit override
# via `make CONTAINER_BIN=podman …` always wins. The Podman path additionally
# layers in docker-compose.local.podman.yml so the agent can spawn workspace
# sandboxes via the rootless Podman socket.
CONTAINER_BIN ?= $(shell command -v docker >/dev/null 2>&1 && echo docker || (command -v podman >/dev/null 2>&1 && echo podman))
COMPOSE_BIN ?= $(CONTAINER_BIN) compose

COMPOSE := $(COMPOSE_BIN) -p hermes

# Host path of the container-control socket. docker.sock on Docker hosts;
# rootless Podman socket on Podman hosts. Overridable in .env.
ifeq ($(CONTAINER_BIN),docker)
  export HERMES_CONTAINER_SOCKET ?= /var/run/docker.sock
  COMPOSE_LOCAL_OVERLAYS :=
  SANDBOX_IMAGE_DEP :=
else ifeq ($(CONTAINER_BIN),podman)
  export HERMES_CONTAINER_SOCKET ?= $(XDG_RUNTIME_DIR)/podman/podman.sock
  COMPOSE_LOCAL_OVERLAYS := -f docker-compose.local.podman.yml
  SANDBOX_IMAGE_DEP := sandbox-image
endif

COMPOSE_LOCAL := $(COMPOSE_BIN) -p hermes-local \
    -f docker-compose.local.yml \
    $(COMPOSE_LOCAL_OVERLAYS)
```

Add a runtime-check target and wire it into the up-* targets:

```makefile
.PHONY: _check-runtime
_check-runtime:
	@if [ -z "$(CONTAINER_BIN)" ]; then \
	  echo "Error: no container runtime detected."; \
	  echo "Install docker or podman, or invoke with CONTAINER_BIN=… COMPOSE_BIN=…"; \
	  exit 1; \
	fi
```

Update `up-local` / `up-local-full` so the sandbox image build is conditional:

```makefile
up-local: _check-runtime $(SANDBOX_IMAGE_DEP) ## Local dev-stack on *.localhost (backend only, no frontend)
	$(COMPOSE_LOCAL) up -d --build

up-local-full: _check-runtime $(SANDBOX_IMAGE_DEP) ## Local dev-stack + holzi-frontend (Nuxt dev with HMR)
	$(COMPOSE_LOCAL) --profile frontend up -d --build
```

Same `_check-runtime` dep on `up` / `up-traefik` / `down` / `down-local` /
`logs*` / `ps*` / `sandbox-image` / `clean`. Leave `install` / `dev` /
`lint` / `typecheck` / `test` / `token` / `help` runtime-free — they don't
touch compose.

Verify on the user's host (Docker only):

```bash
cd /home/haex/Projekte/Holzi
make -n up-local-full
```

Expected output mentions `docker compose -p hermes-local -f docker-compose.local.yml …`
with **no** Podman overlay and **no** `sandbox-image` build step.

Then with an explicit Podman override:

```bash
make -n CONTAINER_BIN=podman up-local-full
```

Expected: includes `-f docker-compose.local.podman.yml` and a `sandbox-image`
build step.

Commit: `feat(devstack): auto-detect docker vs podman, conditional overlay`.

### 7. Backend — `.env.example` documentation

Append a new section under "Local dev-stack" in `.env.example`:

```
# -----------------------------------------------------------------------------
# Container runtime (docker-compose.local.yml — set by the Makefile if unset)
# -----------------------------------------------------------------------------
# Path of the container-control socket the Traefik label-router (and, in the
# Podman case, the agent's sandbox-manager) talks to. Leave unset to let
# `make` pick the right default based on the detected runtime:
#   Docker:  /var/run/docker.sock
#   Podman:  $XDG_RUNTIME_DIR/podman/podman.sock
# Override only when running compose by hand and not through the Makefile.
# HERMES_CONTAINER_SOCKET=
```

Also update the existing dev-stack header note in `docker-compose.local.yml`
(the comment block at the top) to mention both runtimes and that
`HERMES_SANDBOX_SOCKET` lives in the overlay now. Keep the edit minimal.

Commit: `docs(devstack): document HERMES_CONTAINER_SOCKET + runtime split`.

### 8. Live verification — Docker host (this session)

Per [[verification-before-completion]]:

```bash
cd /home/haex/Projekte/Holzi

# Bring up the stack.
make up-local-full

# Containers running:
docker ps --format '{{.Names}}\t{{.Status}}'
# Expected: hermes-server, haex-claude-proxy, signal-cli-rest-api,
# holzi-frontend, hermes-traefik all "Up …".

# Backend health + diagnostics.
TOKEN=$(grep '^HERMES_AUTH_TOKEN=' .env | cut -d= -f2)
curl -sS -H "Authorization: Bearer $TOKEN" \
  http://hermes.localhost/api/diagnostics | python3 -m json.tool
# Expected: 6 entries; sandbox subsystem = warning with a "not configured"
# message; everything else ok.

# Frontend loads.
curl -sSI http://app.localhost | head -1
# Expected: HTTP/1.1 200 OK
```

Then exercise the Diagnostics page in the browser
(`http://app.localhost/settings/diagnostics`) — sandbox section warning,
"Letzte Fehlläufe" + "Sandbox-Abstürze" sections empty (DB is fresh).

Tear down:

```bash
make down-local
```

If any step fails, **stop and capture the failing output**; do not start
patching. The plan is to ship the dev-stack fix unblocked by sandbox
behaviour, not to debug sandbox behaviour from a half-broken stack.

### 9. Live verification — Podman host (deferred / opportunistic)

Run on the haex.cloud box or any local Podman 4.x setup if available in
this session window:

```bash
cd /home/haex/Projekte/Holzi
make CONTAINER_BIN=podman up-local-full
podman ps --format '{{.Names}}\t{{.Status}}'
TOKEN=$(grep '^HERMES_AUTH_TOKEN=' .env | cut -d= -f2)
curl -sS -H "Authorization: Bearer $TOKEN" \
  http://hermes.localhost/api/diagnostics | python3 -m json.tool
# Expected: sandbox subsystem = ok this time.
make down-local
```

If a Podman host isn't reachable, **document the deferral** in the
Status block — do not ship without acknowledging the half-tested matrix.

### 10. Override hooks — smoke

```bash
# Force docker compose on a host that has both runtimes.
make -n COMPOSE_BIN="docker compose" up-local-full

# Force podman on a docker-preferred host (no actual run, dry-run only):
make -n CONTAINER_BIN=podman up-local-full
```

Both should print sensible compose invocations matching the override.

## Verification (per [[verification-before-completion]])

- `cd /home/haex/Projekte/Holzi && uv run pytest tests/test_main_no_sandbox.py -v`
  *(if added — green)*.
- `cd /home/haex/Projekte/Holzi && uv run pytest`
  → no regression vs. main.
- `docker compose -p hermes-local -f docker-compose.local.yml config` →
  exit 0; no sandbox refs left in the base file.
- `make -n up-local-full` on the Docker host prints docker compose
  invocations only.
- `make up-local-full` on the Docker host: all five containers Up; backend
  `/api/diagnostics` reports `sandbox: warning`; frontend loads at
  `app.localhost`.
- `make -n CONTAINER_BIN=podman up-local-full` includes the Podman
  overlay; if a Podman host is available, the live equivalent boots with
  `sandbox: ok`.

## Out Of Scope

- Auto-detecting which sandbox runtime to *use* at runtime. The agent
  consults `HERMES_SANDBOX_SOCKET`; the overlay file is the only place
  the dev-stack sets it.
- A Docker-based sandbox shim (`docker exec` instead of Podman exec).
  Production stays Podman; dev-on-Docker stays sandbox-less.
- Cleaning up the agent-vs-traefik privilege overlap on the same socket.
  Plan 11b-a already calls this a known v1 trade-off and points at a
  socket-proxy hardening follow-up.
- The two remaining Plan 20 follow-ups (onboarding empty state +
  README/troubleshooting/provider docs). Own sessions per
  [[feedback-session-scoping]].

## Acceptance Criteria

- On a Docker-only host, `make up-local-full` brings up
  `hermes-server` + `haex-claude-proxy` + `signal-cli-rest-api` +
  `holzi-frontend` + `hermes-traefik` and the agent's `/api/diagnostics`
  reports `sandbox: warning ("not configured")`.
- On a Podman host (verified live or, if unavailable, dry-run-only)
  `make up-local-full` still produces the same five containers and the
  sandbox subsystem reports `ok`.
- `make COMPOSE_BIN="docker compose" up-local-full` and
  `make CONTAINER_BIN=podman up-local-full` work as explicit overrides.
- `make` exits with a clear error when neither runtime is installed.
- No production-compose files changed.
- The `reference-docker-local-devstack` memory can be tightened: the
  default `make up-local-full` works again; only the sandbox-runtime
  caveat remains.

## Files Likely Touched

Backend (`/home/haex/Projekte/Holzi`):

- `Makefile` — auto-detect block + `_check-runtime` target +
  conditional overlay/SANDBOX_IMAGE_DEP wiring.
- `docker-compose.local.yml` — drop sandbox env + sandbox mount; flatten
  the traefik socket substitution.
- `docker-compose.local.podman.yml` — new, holds the Podman-only bits.
- `.env.example` — document `HERMES_CONTAINER_SOCKET`.
- `tests/test_main_no_sandbox.py` — *new, only if no equivalent exists*.

Frontend (`/home/haex/Projekte/holzi-frontend`):

- `docs/plans/holzi-agent-parity/20b-devstack-docker-agnostic.md` — this
  file; Status block filled post-merge.
- `docs/plans/holzi-agent-parity/README.md` — bump "next up" to point
  here, move 20-A's "deferred live verify" hook to point at this plan.

## After Merge

Per [[feedback-session-wrapup-ritual]]:

- Fill the `Status:` line at the top of this file with the actual cross-
  repo PR links (squashed SHAs).
- Re-run the Plan 20-A live verification (sandbox crash → DB row → page
  row → restart-survives) now that `make up-local-full` works on the
  Docker host, and append the captured output to Plan 20-A's
  `Verification` block.
- Memory updates:
  - `reference_docker_local_devstack.md` — drop the
    `podman compose` failure narrative; keep only the "sandbox disabled
    on Docker hosts" caveat.
  - `project_holzi_diagnostics_panel.md` — note Plan 20-B merged and
    Plan 20-A live-verified.
- README: move this plan from "next up" to Completed.

PR workflow + CodeRabbit per [[feedback-coderabbit-workflow]]; push/merge
via the haexhub token per [[reference-git-push-account]]. Per
[[feedback-session-scoping]] this is the only slice in the session.
