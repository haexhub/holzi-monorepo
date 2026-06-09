# Plan 32: MCP-Server CRUD

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Merged 2026-06-03** — cross-repo
[Holzi#66](https://github.com/haexhub/Holzi/pull/66) +
[holzi-frontend#85](https://github.com/haexhub/holzi-frontend/pull/85)
merged after CI green and two `Explore` self-review passes (CR
rate-limited again). Mypy blocker fixed pre-merge (`McpServerHandle`
events use `field(default_factory=asyncio.Event)` so the per-handle
events are non-`Optional` from construction); one NIT (`build_tool_catalog`
import hoisted to module top in `routes/mcp_servers.py`) and one test
gap (paired credentials=null clear test with omitted-credentials-keeps
test) pulled in. Frontend gained a `deletingId` single-flight latch
mirroring restart/toggle. Manual smoke against a real filesystem-MCP
server (Suggested Implementation §9) remains open and is a good first
verification step in the next session once the deploy box catches up.

### Verification

**Backend** (`/home/haex/Projekte/Holzi`):

- `.venv/bin/python -m pytest` → 835 passed, 3 deselected (was 778
  before Plan 32; 57 new tests across
  `test_mcp_servers_repo.py` (29), `test_mcp_manager.py` (11),
  `test_tool_catalog_merge.py` (3), `test_api_mcp_servers.py` (14)).
- `.venv/bin/ruff check src/hermes tests` → clean.

**Frontend** (`/home/haex/Projekte/holzi-frontend`):

- `pnpm run gen:api` regenerated `app/types/api-generated.ts` against
  the live Plan-32 backend; new schemas surface as
  `McpServer*` types in `app/types/api.ts`.
- `pnpm run typecheck` → exit 0.
- `pnpm run test` → 293 passed (was 269 pre-Plan-32; +12 new in
  `tests/components/McpServersSection.test.ts` plus 12 in the updated
  `tests/components/SkillsPage.test.ts`).

**Manual verification still TODO** (post-merge):

- Register the filesystem-MCP server
  (`npx -y @modelcontextprotocol/server-filesystem /tmp`) via
  `/settings/skills` → expect status `ready`, ~5 tools labelled
  `source="mcp:filesystem"`.
- Trigger `read_file` from a chat turn to confirm the tool handler
  reaches the live `ClientSession`.
- Hit the Neustart button → status flickers `starting` → `ready`.
- Delete the row → the wrapped tools disappear from both `/api/tools`
  and the Skills page within one refresh tick.

Cross-repo. Backend bekommt persistente MCP-Server-Konfigurationen, Lifecycle-Management und Catalog-Merge; Frontend bekommt CRUD-UI als neue Section auf `/settings/skills`.

Depends on:

- [31](./31-tool-inventory-and-mcp-surface.md) — read-only Tool-Inventar + MCP-Surface-Card existiert; deaktivierte „MCP-Server konfigurieren"-Buttons werden hier aktiviert.

Verwandt:

- [21](./21-approval-granularity.md) — Approval-Granularität wird relevant, sobald Plan 32-A Self-Install-Tools für den Agent freischaltet.
- [11b-a](./11b-a-sandbox-spine.md) — Sandbox-Isolation pro MCP-Server ist explizit Non-Goal hier (Server laufen im Agent-Container); falls Isolation gewünscht, eigener Followup-Plan.

Folgt: [Plan 32-A — Agent-Self-Inventory + Self-Provisioning](./32a-agent-self-inventory.md).

## Goal

Externe MCP-Server (HTTP StreamableHTTP oder lokaler stdio-Subprozess) als persistente Konfiguration in der DB ablegen, lifecycle-managen (start / stop / restart / disable), Credentials sicher verwalten und die exponierten Tools in den vorhandenen `tool_catalog` mergen mit `source="mcp:<server-name>"`.

Aktiviert die in Plan 31 vorbereiteten Sprungpunkte:

- „MCP-Server konfigurieren" auf der MCP-Surface-Card → `/settings/skills` scrollt zur neuen MCP-Server-Section (oder eigene Sub-Route, siehe Open Questions).
- „Konfigurieren"-Button pro Tool mit `source="mcp:<name>"` → blendet den zugehörigen MCP-Server-Card-Edit-Form ein.

## Why

- Heute ist die Tool-Surface fix in 5 Builder-Funktionen verdrahtet. Neue Capabilities erfordern Code-Deploy.
- Anthropic-Skills, Community-MCP-Server (filesystem-MCP, github-MCP, …) und externe SaaS-Integrationen sind das natürliche Erweiterungs-Pattern für agentische Systeme — Holzi soll das ohne Code-Änderung aufnehmen können.
- Verankert das **„Holzi konfigurierbar via Holzi"**-Prinzip aus dem README für die MCP-Achse.
- Plan 31 hat die UI-Slots vorbereitet; ohne Plan 32 bleiben sie permanent disabled.

## Non-Goals

- **Sandbox-Isolation pro MCP-Server** (jeder Server in eigenem Container). Wäre ein eigener großer Plan via Plan 11b-Architektur; hier laufen MCP-Subprozesse erstmal im Agent-Container. Sicherheits-Hinweis im UI: „MCP-Server laufen mit Holzi-Rechten; nur vertrauenswürdige Server installieren."
- **MCP-Marketplace / Browse-and-Install-UI.** Manuelles Eingeben von URL / Command / Config reicht. Discovery ist späteres Thema.
- **Multi-User-Berechtigungen** pro MCP-Server. Holzi ist single-user.
- **Auto-Update** von MCP-Server-Versionen. Manueller Restart durch User; ggf. Hinweis bei Versions-Mismatch.
- **Tool-Renaming oder -Filtering** pro MCP-Server (Allowlist von exponierten Tools). Sollte primär über Plan 29-E (Persona-Allowlist) laufen.
- **Hot-Reload des Catalogs** ohne Restart-Endpoint. Add / Edit / Delete eines MCP-Servers triggert `manager.restart_server(id)`, NICHT App-Restart; aber der gesamte `tool_catalog` wird dabei neu assembliert. Vollautomatischer Filewatch o.ä. ist Non-Goal.
- **i18n** der UI-Strings — Plan 30.

## Scope

### Backend (`/home/haex/Projekte/Holzi`)

**DB-Schema — neue Migration in `src/hermes/db.py` + `schema.sql`:**

```sql
CREATE TABLE IF NOT EXISTS mcp_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,           -- slug, ^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$
    display_name TEXT NOT NULL,          -- user-controlled free text
    transport TEXT NOT NULL,             -- "http" | "stdio"
    url TEXT,                            -- http: vollständige URL; stdio: NULL
    command_argv TEXT,                   -- stdio: JSON-Array; http: NULL
    env_json TEXT,                       -- stdio: JSON-Map (env-Vars); http: NULL
    credentials_iv TEXT,                 -- analog llm_credentials (optional)
    credentials_tag TEXT,
    credentials_data TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_error TEXT,                     -- last lifecycle-/handshake-error
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(enabled);
```

Constraint per Application-Layer: `transport="http"` → `url NOT NULL` & `command_argv IS NULL`; `transport="stdio"` → `command_argv NOT NULL` & `url IS NULL`. SQLite-CHECK-Constraints sind möglich, aber der Endpoint validiert ohnehin früher.

**Credentials-Storage:** `crypto.py` existiert (AES-256-GCM, IV/Tag/Data-Tripel wie in `llm_credentials`). Wird 1:1 wiederverwendet. `credentials_data` enthält bei HTTP-Transport den Bearer-Token oder API-Key (provider-spezifisch); bei stdio ist es typischerweise leer (Auth läuft via `env_json`).

**Secret-Bereinigung in Responses:** `env_json` kann bei stdio-Servern Secrets enthalten (z. B. `GITHUB_TOKEN=…`), genauso wie `credentials_data`. Beides darf nie raw in GET-Responses, agent_runs.events oder Logs landen. GET-Responses geben statt `env_json` ein `env_keys: list[str]` zurück (nur die Variablen-Namen), `credentials_data` taucht überhaupt nicht auf. Write-Pfade (POST/PUT) akzeptieren `env` und `credentials` als reguläre Body-Felder; das Repository verschlüsselt `credentials` und persistiert `env_json` als opaken Blob. Tests verifizieren, dass nach `create` / `update` die GET-Response weder Bearer-Token noch Env-Werte enthält.

Hinweis im UI: Variablen-Namen selbst tauchen in Responses und Logs auf. Falls ein Name selbst sensitive Topologie verrät (z. B. `INTERNAL_PROD_DB_PASSWORD_V2`), sollte der User ihn abstrahieren (`DB_PASSWORD` o. ä.) — das ist eine Empfehlung, kein technischer Constraint.

**HTTP-Client-Fehler-Handling:** Beim `httpx.AsyncClient` / `StreamableHTTP-Session` können beliebige Fehler auftreten (TLS-Handshake-Fail, Connection-Reset, Server-500 beim initialen `list_tools`). Der Manager fängt jeden solchen Fehler im `start_server` / `restart_server`-Pfad, setzt `status="crashed"` + `last_error` (auf 256 Zeichen gekappt), und propagiert ihn NICHT in den Caller-Stack. **Kein Auto-Retry** im Lifecycle-Manager — Re-Trigger nur via User-Aktion (UI-Button, `mcp_restart`-Tool). Konsistent mit dem Sandbox-Crash-Pattern aus Plan 11b-b (Health-Watcher persistiert, Auto-Restart ist Non-Goal).

**Repository `src/hermes/repository/mcp_servers.py`:**

- `list_all(db) -> list[McpServerRow]`
- `list_enabled(db) -> list[McpServerRow]`
- `get(db, id) -> McpServerRow | None`
- `get_by_name(db, name) -> McpServerRow | None`
- `create(db, *, name, display_name, transport, url?, command_argv?, env?, credentials?, enabled=True) -> McpServerRow` (UNIQUE auf `name` → IntegrityError → 409 in der Route)
- `update(db, id, *, display_name?, url?, command_argv?, env?, credentials?, enabled?) -> McpServerRow | None`
- `delete(db, id) -> bool`
- `set_last_error(db, id, error: str | None) -> None`

`McpServerRow` (Dataclass) hält Plaintext-Felder + entschlüsselte Credentials; Endpoints serialisieren ohne `credentials_*`-Felder und ohne Plaintext-Credential-String.

**Lifecycle-Manager — neue Datei `src/hermes/mcp_manager.py`:**

Analog zu `SandboxManager` aus Plan 11b-a:

```python
class McpServerHandle:
    """Per-Server Runtime-State."""
    id: int
    name: str
    transport: Literal["http", "stdio"]
    process: asyncio.subprocess.Process | None   # nur stdio
    http_client: httpx.AsyncClient | None        # nur http
    mcp_session: ClientSession                   # python-mcp-sdk ClientSession
    tools: list[Tool]                            # zuletzt geholte Tools (mit source="mcp:<name>")
    status: Literal["starting", "ready", "crashed", "disabled"]
    last_checked_at: float

class McpServerManager:
    def __init__(self, db): self._handles: dict[int, McpServerHandle] = {}
    async def start_all_enabled(self) -> None: ...    # Lifespan-Hook
    async def stop_all(self) -> None: ...
    async def start_server(self, id: int) -> McpServerHandle: ...
    async def stop_server(self, id: int) -> None: ...
    async def restart_server(self, id: int) -> McpServerHandle: ...
    async def get_status(self, id: int) -> McpServerHandle | None: ...
    def aggregate_tools(self) -> list[Tool]:
        """Alle 'ready' Server: deren tools flach concat'd."""
```

Stdio-Transport: `asyncio.create_subprocess_exec(*argv, env=env, stdin=PIPE, stdout=PIPE, stderr=PIPE)` + `mcp.client.stdio.stdio_client` aus dem MCP-SDK.

HTTP-Transport: `mcp.client.streamable_http.streamablehttp_client(url, headers={"Authorization": f"Bearer {credentials}"})`.

Beide returnen `ClientSession`; `session.initialize()` + `session.list_tools()` liefert die Tool-Liste.

Adapter-Funktion `wrap_mcp_tool(server_name, mcp_tool) -> Tool` erzeugt ein `hermes.agent.Tool` mit:

- `name = f"{server_name}__{mcp_tool.name}"` (oder bei Konflikt-Risiko `f"mcp_{server_name}_{mcp_tool.name}"`; Open Question)
- `handler = lambda args: session.call_tool(mcp_tool.name, args)` (async)
- `parameters_schema = mcp_tool.inputSchema`
- `source = f"mcp:{server_name}"` — bewusst free-form string in Plan 31 vorbereitet
- `requires_approval = False` als Default; Plan 29-E + Plan 21 entscheiden später per-Tool

**Catalog-Merge in `tool_catalog.py`:**

```python
def build_tool_catalog(*, db, signal_client, signal_self_number,
                      external_http, brave_api_key, mcp_manager,
                      current_channel=None) -> list[Tool]:
    builtin = (
        build_memory_tools(db)
        + build_cross_channel_tools(...)
        + build_productivity_tools(db)
        + build_external_tools(...)
        + build_user_guide_tools()
    )
    # Plan 31: each builtin Tool gets source="builtin" gesetzt
    for t in builtin: object.__setattr__(t, "source", "builtin")
    remote = mcp_manager.aggregate_tools() if mcp_manager else []
    return builtin + remote
```

`Tool`-Dataclass bekommt `source: str = "builtin"` als Default-Feld (Plan 31 hat das im Schema vorbereitet, jetzt erstmals wirklich genutzt). `frozen=True` bleibt; Builder setzen `source` beim Konstruktor-Call.

`app.state.tool_catalog` wird im Lifespan nach `mcp_manager.start_all_enabled()` assembliert. `manager.restart_server(...)` triggert nach Erfolg eine Re-Assembly von `app.state.tool_catalog` (Single-Worker-Invariante → kein Locking nötig).

**Endpoints — neue Datei `src/hermes/routes/mcp_servers.py`:**

- `GET /api/mcp/servers` → `{ "servers": [{id, name, display_name, transport, url?, command_argv?, env_keys?, enabled, status, last_error, last_checked_at}, …] }` — `env_keys` ist die Liste der Env-Variablen-Namen ohne Values; `credentials_data` und Roh-`env_json` tauchen NIE in der Response auf (siehe „Secret-Bereinigung in Responses" oben).
- `POST /api/mcp/servers` → 201 mit neuer Row; löst sofort `manager.start_server(id)` aus. Validation: slug, transport-spezifische Felder, Credential-Format.
- `PUT /api/mcp/servers/{id}` → 200 oder 404; triggert `manager.restart_server(id)` falls relevant geändert (transport / url / command_argv / env / credentials / enabled).
- `DELETE /api/mcp/servers/{id}` → 204; vorher `manager.stop_server(id)`. Persona-Tool-Allowlists (Plan 29-E) müssen den Tool-Namen ggf. später aufräumen (Followup für 29-E).
- `POST /api/mcp/servers/{id}/restart` → 200, force restart.
- `GET /api/mcp/servers/{id}/health` → `{ status, last_error, last_checked_at, tool_count }` — pro Server.

Bestehender `GET /api/mcp/health` aus Plan 31 wird zu „Aggregate" — zeigt globalen Status (alle enabled-Server ready? sonst Liste der problematischen).

Alle Endpoints sind durch `bearer_auth_middleware` auth-gated.

### Frontend (`/home/haex/Projekte/holzi-frontend`)

- `pnpm run gen:api` — neue Types `McpServer`, `McpServerCreate`, `McpServerUpdate`, `McpServerHealth`, `McpServerList`.
- Neues Composable `app/composables/useMcpServers.ts`: `list()`, `create(body)`, `update(id, body)`, `delete(id)`, `restart(id)`, `health(id)`.
- `app/pages/settings/skills.vue`:

  **Neue Section ganz oben: „MCP-Server"**
  - Header + Subtext („Externe MCP-Server bringen zusätzliche Tools mit. Sie laufen mit Holzi-Rechten — nur vertrauenswürdige Quellen installieren.").
  - Liste von Server-Cards (Pattern wie `/settings/workspaces`):
    - Card-Header: `display_name` + Status-Badge (ready / starting / crashed / disabled) + Transport-Pille (http / stdio).
    - Sub-Zeile: URL bzw. Command + N Tools exponiert.
    - Actions: Edit · Restart · Disable/Enable · Delete (mit Confirm-Modal).
    - Crash-Details: `last_error` ausklappbar.
  - „Neuer MCP-Server"-Button öffnet ein Form (Modal oder Inline):
    - Transport-Toggle (HTTP / stdio) → bedingte Felder.
    - HTTP: URL + optional Bearer-Token (mit Reveal-Toggle).
    - stdio: Command + Args (Liste) + Env-Vars (Key/Value-Pairs).
    - Display-Name + Slug (mit Live-Validation, kebab-case).
  - Empty-State: „Keine MCP-Server konfiguriert. `+ Neuer Server`."

  **Bestehende MCP-Surface-Card aus Plan 31**: bleibt, der „MCP-Server konfigurieren"-Button wird `<NuxtLink>` auf einen Anchor in der neuen Section, NICHT mehr disabled.

  **Tool-Katalog (Section 2 aus Plan 31)**: Tools mit `source="mcp:<name>"` werden gleich gerendert wie built-in; der Konfigurieren-Button pro MCP-Tool springt zum zugehörigen MCP-Server-Card-Anker (statt disabled zu bleiben).

- Auto-Refresh der Server-Statuses alle 10 s solange die Page sichtbar ist (Pattern wie `/settings/diagnostics`).

### Tests

Backend:

- `tests/test_mcp_servers_repo.py` — CRUD, slug-Validation, UNIQUE name, credentials roundtrip.
- `tests/test_mcp_manager.py` — Lifecycle mit Fake-Subprocess + Fake-HTTP-Client; restart-Resilienz, crash-status-set, aggregate_tools-Reihenfolge.
- `tests/test_api_mcp_servers.py` — Endpoints inkl. 401, 409 für Duplicate slug, 422 für Validation-Fehler, 404, 200, 201, 204. Redaction-Cases: nach `POST` mit `credentials="bearer-xyz"` + `env={"GITHUB_TOKEN": "ghp_…"}` enthält die anschließende GET-Response weder `bearer-xyz` noch `ghp_…` noch ein `env_json`-Feld; `env_keys` listet aber `["GITHUB_TOKEN"]`.
- `tests/test_tool_catalog_merge.py` — `build_tool_catalog` mit gemocktem Manager: built-in + remote concatenated, source-Werte korrekt.

Frontend:

- `tests/components/McpServersSection.test.ts` — neue Datei: render mit 0/1/N Servern, Create-Flow, Validation-Fehler-Mapping, Restart-Trigger, Delete-Confirm.
- `tests/components/SkillsPage.test.ts` (aus Plan 31) erweitern: „MCP-Server konfigurieren"-Button ist nicht mehr disabled; Konfigurieren-Button für MCP-Tool springt zum richtigen Anker.

## Suggested Implementation

### 1. Backend: Schema + Repo

- TDD `test_mcp_servers_repo.py` zuerst.
- Migration in `db.py` + `schema.sql`; bestehende Snapshot-Tests anpassen.
- Crypto-Helper aus `crypto.py` direkt wiederverwenden.

### 2. Backend: `McpServerManager`

- Mit `mcp` Python-SDK (`pip install mcp` — Dep prüfen, sollte schon da sein wegen `mcp_server.py`).
- TDD: Fake-`ClientSession`, das `list_tools` / `call_tool` mock-returnt.
- Lifecycle integriert in `main.py` Lifespan: vor Worker-Start `start_all_enabled()`, im Cleanup `stop_all()`.

### 3. Backend: Catalog-Merge + `Tool.source`

- `Tool`-Dataclass um `source: str = "builtin"` erweitern.
- `build_tool_catalog` um `mcp_manager`-Parameter erweitern; alle Call-Sites anpassen (Lifespan, Tests).
- Test `test_tool_catalog_merge.py` grün.

### 4. Backend: Endpoints

- `routes/mcp_servers.py` mit Pydantic-Response-Models.
- Beim POST/PUT/DELETE/Restart-Erfolg: `app.state.tool_catalog` neu assemblieren (extrahierte Helper-Funktion in `tool_catalog.py`).
- `GET /api/mcp/health` aus Plan 31 zu Aggregat refactoren.

### 5. Frontend: gen:api + Composable

### 6. Frontend: McpServersSection auf /settings/skills

- Pattern aus `/settings/workspaces` für Card-Liste.
- Form als eigenes Component `<McpServerForm>` (Create/Edit shared).

### 7. Frontend: Plan-31-Sprungpunkte aktivieren

- Disabled-Buttons → `<NuxtLink>` auf `#mcp-server-{id}` bzw. `#mcp-section`.

### 8. Frontend Tests

### 9. Verifikation

- Filesystem-MCP von Anthropic registrieren (`npx -y @modelcontextprotocol/server-filesystem /tmp`); erwartet: Status ready, ~5 Tools mit `source="mcp:filesystem"`.
- Chat: Agent `read_file` testen.
- Restart-Button → Status flackert „starting" → „ready".
- Delete: Tools verschwinden aus `/api/tools` und `/settings/skills`.

## Open Questions

- **Eigene Sub-Route `/settings/mcp` statt Section auf `/settings/skills`?** Pro Sub-Route: weniger überladene Page, klarer URL-Scope. Pro Section: alles Tool-bezogene an einem Ort, weniger Nav-Klick. → Vorschlag: **erstmal Section,** falls die Page kippt (>5 Server, komplexe Forms) wird Plan-32-Followup eine Sub-Route abspalten.
- **Tool-Namen-Kollision** zwischen Servern (z.B. zwei Server bieten `read_file`)? → Prefix `{server_name}__{tool_name}` ist eindeutig aber hässlich; nur prefixen bei tatsächlicher Kollision wäre eleganter aber stateful.
- **stdio-Subprozess-Logs**: wo landen die? `stderr` mitschneiden und in `last_error` schreiben + zusätzlich in `HERMES_LOG_FILE` als `mcp.server.<name>`-Records? → Letzteres, damit Plan-27-Logs-Viewer sie sieht.
- **`PUT` mit Credential-Update**: wie unterscheidet das Frontend „keine Änderung" von „Credential leeren"? → Sentinel: `credentials: undefined` = unchanged, `null` = clear, `string` = set. Pattern aus Plan 29-A `channels.update`.
- **Catalog-Reassemble Race-Condition** zwischen `restart_server` und einem laufenden `run_agent`? → Single-Worker-Invariante; Reassembly setzt `app.state.tool_catalog` atomar; laufende Agent-Calls haben ihren Catalog-Snapshot per Argument. Soll OK sein, aber Testfall einbauen.
- **MCP-Server-Auto-Restart** nach Crash? → Vorschlag: **nein.** Lifespan-Init startet einmal; Crash → `status="crashed"` + `last_error`; User restarted manuell. Auto-Restart wäre eigener Followup (Backoff-Logik, Crash-Loop-Detection).
