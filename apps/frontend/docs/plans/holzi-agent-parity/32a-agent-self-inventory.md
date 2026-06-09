# Plan 32-A: Agent-Self-Inventory + Self-Provisioning

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Merged** (2026-06-03; cross-repo [Holzi#67](https://github.com/haexhub/Holzi/pull/67) + [holzi-frontend#86](https://github.com/haexhub/holzi-frontend/pull/86)).

Cross-repo. Backend bekommt Meta-Tools, die der Agent aufrufen kann, um seine eigene Tool- und MCP-Surface zu inspizieren und (mit User-Approval) zu erweitern. Frontend bekommt MCP-spezifische Approval-Card-Felder.

Depends on:

- [32](./32-mcp-server-crud.md) — Backend-CRUD für MCP-Server muss existieren, bevor `mcp_install` etwas anlegen kann.
- [21](./21-approval-granularity.md) — Approval-Granularität (once / session / always / deny + reason). `mcp_install` MUSS approval-pflichtig sein; ohne Plan 21 ist die Approval-UX zu grob.

Konsumiert: [31](./31-tool-inventory-and-mcp-surface.md) (`source`-Pille im Catalog), Plan-32-Endpoints (Server-CRUD + Health), `app.state.tool_catalog` und `app.state.mcp_manager`.

## Goal

Vier Meta-Tools dem Agent geben, damit Conversational Configuration für die Tool/MCP-Achse funktioniert:

- `list_tools` — Agent sieht seine eigene Tool-Surface (Name, Beschreibung, Source). Antwortet auf „was kannst du?" / „hast du Tool X?".
- `mcp_status` — Agent sieht Health pro MCP-Server. Antwortet auf „läuft MCP-Server Y?" / „warum funktioniert Tool Z nicht?".
- `mcp_install` — Agent kann (mit Approval) einen neuen MCP-Server registrieren. Antwortet auf „richte Service X ein".
- `mcp_restart` — Agent kann (mit Approval) einen MCP-Server neu starten, wenn er gecrasht ist.

Ergebnis: Nutzer kann denselben Workflow per Chat (Conversational) oder UI (`/settings/skills`) bedienen — beides spielt dieselben Backend-Endpoints. „Holzi konfigurierbar via Holzi" auch in Chat-Form.

## Why

- Conversational Config ist bequemer als UI-Navigation für einmalige Setup-Tasks („richte mir Filesystem-MCP für `/home/me/Notes` ein").
- Der Agent kann auf Frage „hast du Service X?" heute nur halluzinieren — er hat keinen Zugriff auf seinen eigenen Tool-Stand.
- Self-Provisioning schließt den Loop: Holzi kann sich selbst aufbauen, sofern der User zustimmt.
- Macht das Skills-Page (Plan 31) zur **Inspect-/Override-Surface,** während der Standard-Pfad Conversational wird.

## Non-Goals

- **Selbst-Modifikation des Codes** oder der Hardcoded-Tool-Builder. `mcp_install` legt nur DB-Rows + startet Lifecycle-Manager an, kein Code-Schreiben.
- **Auto-Install ohne Approval.** Jeder `mcp_install`-/`mcp_restart`-Call löst eine Approval-Card aus.
- **Mass-Provisioning** („richte mir die Top-10-MCP-Server ein"). Pro Tool-Call ein Server. Wenn der Agent mehrere anlegen will, macht er N Tool-Calls.
- **`mcp_remove` / `mcp_reconfigure` via Tools.** Plan 32-A ist „read + create + restart". Destruktion und Re-Config gehören ins UI, weil sie häufiger Versehen sind als Absicht.
- **Persona-Self-Modification** (Persona-Prompts via Tool ändern). Wäre Pendant für Plan 33; separates Thema.
- **Workspace-Self-Provisioning.** Workspaces sind eine andere Achse (Plan 25); falls Agent-Self-Provisioning dort gewünscht ist, eigener Plan.
- **`list_personas` / `list_workspaces`-Meta-Tools.** Die Skills-Page-Achse zuerst; andere Self-Inventory-Tools bei Bedarf in weiteren Plänen.
- **MCP-Server-Discovery** (Agent schlägt von sich aus Server vor, die der User nicht kennt). Reaktiv, nicht proaktiv — der Agent erfindet keine URLs.

## Scope

### Backend (`/home/haex/Projekte/Holzi`)

**Meta-Tool-Builder — neue Datei `src/hermes/tools/meta.py`:**

```python
def build_meta_tools(
    *,
    db: AsyncEngine,
    mcp_manager: McpServerManager,
    tool_catalog_provider: Callable[[], list[Tool]],
) -> list[Tool]:
    return [_list_tools(tool_catalog_provider),
            _mcp_status(mcp_manager),
            _mcp_install(db, mcp_manager),
            _mcp_restart(db, mcp_manager)]
```

`tool_catalog_provider` ist ein Callable, das den aktuellen `app.state.tool_catalog` liefert — keine Closure über eine möglicherweise stale Liste.

`list_tools`:

```python
Tool(
    name="list_tools",
    description=(
        "List all tools currently available to this agent, grouped by source "
        "(built-in vs. mcp:<server-name>). Use when the user asks 'what can "
        "you do?', 'do you have X?', or 'which tools are available?'."
    ),
    parameters_schema={
        "type": "object",
        "properties": {
            "source_filter": {"type": "string",
                              "description": "Optional: 'builtin', 'mcp:<name>', or omit for all."}
        },
    },
    handler=async_handler,
    requires_approval=False,  # read-only
)
```

Return: JSON-String mit `{tools: [{name, description, source, requires_approval}]}`, optional gefiltert. `list_tools` taucht im eigenen Output mit auf (kein Recursion-Filter — Transparenz schlägt Cleverness).

`mcp_status`:

```python
Tool(
    name="mcp_status",
    description=(
        "Report the runtime status of all configured MCP servers (ready / "
        "starting / crashed / disabled), including last error. Use when the "
        "user asks why an MCP-backed tool is unavailable or whether server X "
        "is running."
    ),
    parameters_schema={"type": "object", "properties": {}},
    handler=async_handler,
    requires_approval=False,
)
```

Return: JSON `{servers: [{name, status, tool_count, last_error, last_checked_at}]}`, oder `{servers: []}` wenn keine konfiguriert.

`mcp_install`:

```python
Tool(
    name="mcp_install",
    description=(
        "Register and start a new MCP server. Requires user approval. Use "
        "when the user asks to add/install/connect an MCP server, providing "
        "transport ('http' or 'stdio'), URL (http) or command + args (stdio), "
        "and a short slug name."
    ),
    parameters_schema={
        "type": "object",
        "required": ["name", "transport"],
        "properties": {
            "name": {"type": "string", "description": "kebab-case slug, 2-30 chars"},
            "display_name": {"type": "string"},
            "transport": {"type": "string", "enum": ["http", "stdio"]},
            "url": {"type": "string", "description": "http only"},
            "command_argv": {"type": "array", "items": {"type": "string"},
                             "description": "stdio only"},
            "env": {"type": "object", "additionalProperties": {"type": "string"}},
            "credentials": {"type": "string", "description": "optional bearer token"},
        },
    },
    handler=async_handler,
    requires_approval=True,
    risk_reason=(
        "Installs an external MCP server that will run with Holzi's user "
        "permissions and expose its tools to the agent."
    ),
)
```

Handler-Sequenz: `mcp_servers_repo.create(...)` (gibt id zurück) → `mcp_manager.start_server(id)` mit Wait-Loop bis `status="ready"` ODER 15 s Timeout. Bei Erfolg: `app.state.tool_catalog` Pending-Reload flaggen (siehe Catalog-Integration unten), Return `{success: true, server: {…ohne credentials, ohne env-Werte…}, tools_added: [name, …]}`. Bei Timeout / Start-Fehler: **Cleanup-Pfad** — `mcp_manager.stop_server(id)` (Best-Effort) + `mcp_servers_repo.delete(id)`, damit kein Zombie-Eintrag in der DB hängen bleibt; Return `{success: false, error: "Server startup timed out (15s) — try mcp_restart or check /settings/skills"}` oder eine konkrete Fehlermeldung aus `last_error`.

**Redaction-Contract für `mcp_install` (verbindlich):**

`mcp_install`-Parameter (`credentials`, Werte in `env`) sind Geheimnisse und dürfen ausschließlich im Klartext durch den Repo-/Manager-Write-Pfad fließen. An jeder anderen Stelle werden sie maskiert oder weggelassen:

- **Approval-Card-Payload (Frontend-UI):** Backend redaktiert die Parameter, bevor sie in das SSE-`approval_request`-Event gehen. `credentials` wird zu `"[redacted, N chars]"`; Werte in `env` werden zu `"[redacted]"`, Keys bleiben sichtbar (User soll sehen, dass `GITHUB_TOKEN` gesetzt wird, ohne den Wert zu sehen). `url`, `command_argv`, `display_name`, `transport`, `name` bleiben sichtbar.
- **`agent_runs.events`:** Persistierte Tool-Call-Records nutzen denselben redaktierten Payload — nicht den Roh-Input.
- **Logs (`logger.info("meta_tool_invoked", ...)`):** Nutzt den redaktierten Payload + zusätzlich `redact_secrets()` (Plan 27 Logging-Processor) als Defense-in-Depth.
- **Handler-Return:** `server`-Sub-Objekt im Return-JSON nutzt dieselbe `env_keys`-Repräsentation wie `GET /api/mcp/servers` aus Plan 32 — niemals raw `env_json` oder `credentials`.

`mcp_restart` hat keine Secrets in den Parametern und braucht keine spezielle Redaction; der Defense-in-Depth-Logger-Processor läuft trotzdem.

Single source of truth ist ein Helper `redact_mcp_install_params(params: dict) -> dict` in `tools/meta.py`, der von Approval-Emitter, Run-Event-Writer und Logger gemeinsam aufgerufen wird.

`mcp_restart`:

```python
Tool(
    name="mcp_restart",
    description="Restart an MCP server by name. Requires user approval.",
    parameters_schema={
        "type": "object",
        "required": ["name"],
        "properties": {"name": {"type": "string"}},
    },
    handler=async_handler,
    requires_approval=True,
    risk_reason="Restarts an MCP server (tools temporarily unavailable).",
)
```

**Catalog-Integration:**

`tool_catalog.py` bekommt einen 6. Builder-Aufruf:

```python
def build_tool_catalog(*, db, ..., mcp_manager, app_state_provider, current_channel=None):
    builtin = (build_memory_tools(db) + ... + build_user_guide_tools())
    meta = build_meta_tools(db=db, mcp_manager=mcp_manager,
                            tool_catalog_provider=app_state_provider)
    remote = mcp_manager.aggregate_tools() if mcp_manager else []
    for t in builtin + meta: object.__setattr__(t, "source", "builtin")
    return builtin + meta + remote
```

Meta-Tools haben `source="builtin"` (sie sind built-in, auch wenn sie über MCP-Subjekte handeln).

**Audit-Log:**

Jeder Approval-pflichtige Meta-Tool-Aufruf (`mcp_install`, `mcp_restart`) wird in `agent_runs.events` als eigener Event-Typ persistiert (Plan 08 Event-Envelope). Kein neues DB-Schema — `/settings/insights` aggregiert das automatisch über bestehende Run-Events.

Plus optional ein `logger.info("meta_tool_invoked", ...)` für `/settings/logs`-Sichtbarkeit (Plan 27).

### Frontend (`/home/haex/Projekte/holzi-frontend`)

**Approval-Card-Erweiterung (`components/approval/ApprovalCard.vue`):**

Aktuelle Approval-Cards (Plan 09 + 21) zeigen `tool_name`, `parameters`, `risk_reason`. Für `mcp_install` braucht es eine **bessere Darstellung** der Parameter, weil ein Roh-JSON-Block für „transport / url / command_argv / env" hässlich ist:

- Wenn `tool_name === "mcp_install"`: spezialisierte Sub-Komponente `<McpInstallApprovalDetails :params="…" />`, die Transport-Pille + URL/Command + env-Liste sauber rendert.
- Wenn `tool_name === "mcp_restart"`: einzeilig „Server: `{name}` neu starten".
- Generischer Fallback bleibt für alle anderen Tools.

Plan-21-Approval-Levels (once / session / always / deny) sind orthogonal — die Card-Header bleibt unverändert.

**Skills-Page (`/settings/skills`):**

Keine eigene Section für Meta-Tools — sie tauchen in der Tool-Liste mit `source="builtin"` auf, neben den anderen Built-in-Tools. Visuell nichts Besonderes; die Approval-Badge zeigt sich automatisch bei `mcp_install` / `mcp_restart`.

**Insights/Logs:**

- `/settings/insights` (Plan 27) zeigt Meta-Tool-Calls in den per-Tool-Aggregaten automatisch.
- `/settings/logs` zeigt `meta_tool_invoked`-Records.

### Tests

Backend:

- `tests/test_meta_tools.py` — Unit:
  - `list_tools` mit und ohne `source_filter`.
  - `mcp_status` mit 0 / 1 / N Servern.
  - `mcp_install` Happy Path (mock Manager + Repo).
  - `mcp_install` Validation-Fehler (Slug-Format, Transport-Mismatch).
  - `mcp_restart` mit unbekanntem Server-Name → Error-JSON.
- `tests/test_chat_meta_approval.py` — Integration:
  - End-to-End-Flow: User-Message → Agent ruft `mcp_install` → Approval-Card erscheint → User approve → MCP-Server gestartet → tool_catalog enthält neue Tools.
  - Deny-Pfad: Approval verweigert → kein DB-Schreib, Agent erhält klare Fehler-Message.
- `tests/test_meta_tools_redaction.py` — Redaction-Contract: `mcp_install`-Aufruf mit `credentials="bearer-xyz"` + `env={"GITHUB_TOKEN": "ghp_secret"}` löst (a) ein `approval_request`-Event aus, dessen Payload weder `bearer-xyz` noch `ghp_secret` enthält, aber den Key `GITHUB_TOKEN` zeigt; (b) einen `agent_runs.events`-Eintrag mit identisch redaktiertem Payload; (c) eine `meta_tool_invoked`-Log-Zeile, die nach Logger-Processor-Pipe keine der beiden Secrets enthält. Sequenz-Reihenfolge ist Teil der Assertion (kein Race, der das Secret kurzzeitig leakt).

Frontend:

- `tests/components/ApprovalCard.test.ts` (erweitern):
  - `mcp_install`-Variante rendert spezialisierte Details.
  - `mcp_restart`-Variante rendert einzeilig.
- `tests/components/McpInstallApprovalDetails.test.ts` — Render-Test mit verschiedenen Parameter-Kombinationen (http vs. stdio, mit/ohne env, mit/ohne credentials).

## Suggested Implementation

### 1. Backend: `tools/meta.py` + Unit-Tests

- TDD `test_meta_tools.py` zuerst.
- `tool_catalog_provider`-Pattern verhindert stale Catalog-Snapshots in der Closure.

### 2. Backend: Catalog-Integration

- `build_tool_catalog` um Meta-Builder erweitern; Call-Sites in Lifespan + Tests anpassen.

### 3. Backend: Integration-Test

- `test_chat_meta_approval.py` mit existierender SSE-Test-Infrastruktur (siehe `reference_asgi_transport_buffering`-Memory für Edge-Cases).

### 4. Frontend: ApprovalCard-Erweiterung

- `<McpInstallApprovalDetails>` als eigene Komponente; ApprovalCard wählt per `v-if="tool_name === 'mcp_install'"`.

### 5. Frontend: Tests

### 6. Verifikation

- Live: User sagt im Chat „richte mir den Filesystem-MCP-Server für `/tmp` ein".
- Erwartet: Approval-Card erscheint mit Transport-Pille „stdio", Command sichtbar.
- Nach Approve: Status-Banner „MCP-Server `filesystem` gestartet, 5 Tools verfügbar".
- Nachfrage „kannst du jetzt Dateien lesen?": Agent ruft `list_tools` (kein Approval) und antwortet positiv mit den neuen Tool-Namen.
- `/settings/skills` zeigt den Server in der MCP-Section + die Tools mit `source="mcp:filesystem"`.

## Open Questions

- **Sollen Meta-Tools für alle Personas verfügbar sein, oder nur für eine privilegierte „Admin"-Persona?** Plan 29-E hat Persona-Allowlists; eine Tutor-Persona sollte vermutlich kein `mcp_install` haben. → Vorschlag: **Default-Allowlist** für eine Persona enthält Meta-Tools; neue Personas erben das, der User kann es per-Persona entziehen. Wird in Plan 29-E-Followup ausgearbeitet.
- **`mcp_install`-Result-Verifizierung:** Geklärt im Scope-Block — synchron mit 15 s Timeout, bei Fehler vollständiger Cleanup (stop_server + delete-Row), damit kein Zombie zurückbleibt.
- **Recursion-Schutz bei `mcp_install` während laufender Agent-Run:** technisch geht das, aber tool_catalog-Reassembly mitten im Run würde dem laufenden Agent neue Tools unter dem Hintern wegziehen. → Vorschlag: **Reassembly verzögert** bis Ende des aktuellen Runs (Pending-Reload-Flag); nächster Run sieht die neuen Tools.
- **Mass-Audit-Trail:** soll `mcp_install` zusätzlich in eine separate `audit_log`-Tabelle schreiben, oder reicht `agent_runs.events`? → Vorschlag: erstmal nur Events; Audit-Log wenn der User es vermisst.
- **`mcp_remove` als zukünftiger Tool**: explizit Non-Goal in 32-A, aber wenn Plan 32 das UI hat und Nutzer es vermissen, eigener Folgeplan (mit erhöhter Approval-Stufe „always-confirm").

## Implementation Notes & Deviations

Plan 32-A was written before Plan 32 merged; the implementation reconciled the
plan against the shipped API:

- **Manager name:** `app.state.mcp_servers_manager` (`McpServerManager`), not
  the plan's `mcp_manager` (which is the *inbound* StreamableHTTP server).
- **`mcp_restart` → no approval.** Deliberately `requires_approval=False`
  (mirrors the `/settings/skills` restart button — it only relaunches existing
  config). This supersedes the plan body's `requires_approval=True`. Consequence:
  the frontend `mcp_restart` approval-card variant is dead code and was **not**
  built; only `<McpInstallApprovalDetails>` (for `mcp_install`) ships.
- **`agent_runs.events` doesn't exist** as a column — tool calls persist to
  `messages.meta_json`. The redaction contract therefore targets the persisted
  message rows (the assistant turn's `tool_calls` + the tool turn's
  `arguments`) plus the SSE events, not a separate events table.
- **Redaction wiring:** a new `Tool.redact_arguments` callable carries
  `redact_mcp_install_params`; `agent.run_agent` computes `display_args` once and
  routes it to the approval callback, the `tool_call` SSE event, and both
  persisted `meta_json` sites, while raw args still reach the handler and the
  upstream request. No new approval gate — rides Plan 21's existing gate.
- **Catalog freshness:** wired the manager's `on_catalog_change` hook in the
  lifespan so agent-driven `mcp_install`/`mcp_restart` refresh
  `app.state.tool_catalog` (the route CRUD path already did via its own
  `_refresh_catalog`). `build_tool_catalog` gained optional `encryptor` +
  `tool_catalog_provider`.
- **No `gen:api`** — no new endpoints.

- **Inbound `/mcp` reads the live catalog.** CodeRabbit flagged that the
  inbound `/mcp` StreamableHTTP server (`mcp_session_manager`, used by external
  clients like Cline/HaexChat) snapshotted its tools + name→Tool `lookup` at
  mount, so it served a stale set after any runtime catalog change — a
  pre-existing Plan-32 issue (its `_refresh_catalog` already rebinds). Fixed in
  this PR: `build_mcp_server` takes a `tools_provider` and reads it live in both
  `list_tools`/`call_tool`, bound to the lifespan's `_live_catalog`. A
  runtime-installed server now appears on `/mcp` without a restart (regression
  test in `test_mcp_server.py`).

### Verification

Backend (`/home/haex/Projekte/Holzi`): `uv run pytest` → **861 passed**
(`test_meta_tools.py` 18 unit, `test_chat_meta_approval.py` 3 integration:
approve/deny/list_tools-no-approval, `test_meta_tools_redaction.py` 2:
approval-event + persisted-records + emission-sequence, and log-boundary;
`test_tool_catalog_merge.py` extended). `uv run ruff check` clean,
`uv run mypy src` clean.

Frontend (`/home/haex/Projekte/holzi-frontend`): `pnpm test` → **301 passed**
(`McpInstallApprovalDetails.test.ts` + extended `ApprovalCard.test.ts`).
`pnpm typecheck` clean.

Live dev-stack smoke (chat "install the filesystem MCP for /tmp" → approval
card → list_tools follow-up): **not yet run** — covered by the integration
tests against the faked connector; recommend one manual pass once staging
carries a real filesystem-MCP server.
