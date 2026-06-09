# Plan 31: Tool-Inventar + MCP-Surface — die `/settings/skills`-Seite

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Merged 2026-06-03.** Cross-repo
[Holzi#65](https://github.com/haexhub/Holzi/pull/65) +
[holzi-frontend#83](https://github.com/haexhub/holzi-frontend/pull/83).

Backend: `GET /api/tools` returning `ToolsResponse { tools: ToolInfo[],
total }` sorted alphabetically from `app.state.tool_catalog` (one build
path — the same list MCP exposes). `source` projected statically to
`"builtin"`; Plan 32 will swap that for pass-through once the catalog
carries MCP-sourced tools. `GET /api/mcp/health` is state-only
(`app.state.mcp_manager` presence + `len(tool_catalog)`); no HTTP self-
probe to avoid an ASGI re-entry that the StreamableHTTPSessionManager
would reject without a full MCP handshake.

Frontend: `/settings/skills` placeholder replaced with two sections —
MCP-Surface card (status pill, URL+copy, exponierte Tool-Anzahl, „vor
X s" relative timestamp, Refresh, disabled „MCP-Server konfigurieren"-
Button als Plan-32-Sprungpunkt) und flache alphabetische Tool-Liste
(Name monospace, `source`-Pille, Approval-Badge + risk_reason nur bei
`requires_approval`, JSON-Schema-Toggle mit „keine Parameter"-Fallback,
disabled per-Tool-„Konfigurieren"-Button mit Plan-32/33-Tooltip).
`settingsNav.ts` verliert den `upcoming`-Hint für `/settings/skills`;
das ist der letzte abgeschaltete Control-Center-Placeholder.

## Verification

- Backend: `uv run pytest` (773 passed including 9 neue Cases in
  `tests/test_api_tools.py` + `tests/test_api_mcp_health.py`), `ruff
  check` clean, `mypy src` clean (73 source files).
- Frontend: `pnpm vitest run` (280 passed including 11 neue Cases in
  `tests/components/SkillsPage.test.ts` und das mitgezogene
  `SettingsPlaceholder.test.ts`), `pnpm typecheck` exit 0.
- Manual review pass von Claude (CodeRabbit rate-limited) fand keine
  Blocker; ein NIT-Fix nachgezogen (`parameters_schema: dict[str,
  Any]` für Konsistenz mit dem Rest von `src/hermes/routes/`).



Cross-repo. Backend bekommt zwei kleine read-only Endpoints (Tool-Katalog
+ MCP-Health); Frontend baut den `/settings/skills`-Placeholder zur ersten
echten Tool-Übersichts-Seite um.

Depends on:

- [14](./14-control-center-shell.md) — Control Center shell + Nav-Slot
  „Skills & Tools" existiert als Placeholder.
- [20](./20-onboarding-diagnostics-docs.md) — Pattern für status-getriebene
  Cards (`DiagnosticsCheck` mit `id/label/status/message`). **Post-Plan-30
  (2026-06-04)** ist der Diagnostics-Shape `{id, status, code, params}`
  — `label` + `message` raus, FE rendert via i18n. Der MCP-Health-Block
  in Plan 31 hat aber seine eigene Status-Card-Logik (`McpStatus`-Type),
  ist also vom Diag-Shape-Change unabhängig.

Folgt:

- [Plan 32 — MCP-Server CRUD](./32-mcp-server-crud.md) — MCP-Server
  registrieren, Lifecycle, Credentials; mergt exponierte Remote-Tools in
  den Catalog.
- [Plan 32-A — Agent-Self-Inventory + Self-Provisioning](./32a-agent-self-inventory.md) —
  Meta-Tools `list_tools` / `mcp_status` / `mcp_install` / `mcp_restart`;
  der Agent soll auf Nutzer-Frage „hast du Service X?" antworten und ggf.
  einrichten können.
- [Plan 33 — Skills als DB-Artefakte](./33-skills-as-db-artifacts.md) —
  Anthropic-Skill-Modell (Markdown + Frontmatter), Aktivierung pro
  Persona, Resolver-Composition `persona + skills + channel`.

Konsumenten:

- [29-E](./29e-persona-tools-and-mcps.md) — Persona-Tool-Allowlist nutzt
  den hier eingeführten `GET /api/tools`-Endpoint als Multi-Select-
  Datenquelle.

## Goal

Drei zusammenhängende Dinge auf einer Seite sichtbar machen, ohne aktive
Konfiguration (das kommt in Plan 32 / 32-A / 33):

1. **Tool-Liste** — welche Tools hat der Agent heute überhaupt? Flach
   alphabetisch, pro Tool: Name, Beschreibung, Approval-Badge,
   `source`-Pille (heute überall `builtin`), ausklappbarer
   JSON-Schema-Viewer für `parameters_schema`. Pro Tool ein
   **deaktivierter** „Konfigurieren"-Button mit Hover-Tooltip
   („Konfiguration kommt mit Plan 32 / 33").
2. **MCP-Surface** — der Agent exponiert seine Tools bereits via
   StreamableHTTP unter `/mcp` für externe Clients (Cline, HaexChat).
   Eine kleine Health-Card oben auf der Seite zeigt: Status (grün/rot),
   URL, „letzte Prüfung vor Xs", exponierte Tool-Anzahl. Eigener
   deaktivierter „MCP-Server konfigurieren"-Button als Sprungpunkt für
   Plan 32.
3. **Read-only.** Diese Seite konfiguriert nichts. Sie ist die Antwort
   auf die Frage „was kann mein Agent eigentlich?" und das **Sprungpad**
   in die Config-Pages, die Plan 32/33 bringen.

Der `/settings/skills`-Placeholder verschwindet; der `upcoming`-Hint in
`settingsNav.ts` wird entfernt.

## Why

- Heute lebt die Tool-Liste verteilt in 5 Builder-Funktionen unter
  `src/hermes/tools/`. Der User (Holzi ist single-user) hat keine
  Möglichkeit, ohne `grep` zu sehen, was der Agent kann oder welche
  Parameter ein Tool erwartet.
- Plan 29-E (Persona-Tool-Allowlist) braucht `GET /api/tools` als
  Datenquelle für den Multi-Select-Picker. Wenn der Endpoint sowieso
  entsteht, ist es ein kleiner Schritt, ihn auch zu rendern.
- Die MCP-Surface existiert seit `mcp_server.py`, ist aber nirgends im
  UI sichtbar. Setup-Probleme („Cline kann sich nicht verbinden") sind
  heute unsichtbar bis zum Bug-Report. Ein Health-Check auf der
  zugehörigen Seite macht die Surface diagnostizierbar.
- Verankert das **Design-Prinzip „Holzi konfigurierbar via Holzi"** für
  die Tool/MCP-Achse: die Skills-Page wird Single Entry-Point. Plan 32
  und 33 dockt mit Config-Pages an die hier vorbereiteten Sprungpunkte
  an, statt Settings irgendwo zu vergraben.
- Schaltet den letzten verbleibenden Placeholder im Control Center ab
  (nach Plan 25 ist `/settings/workspaces` echt, nach 29-A ist
  `/settings/preferences` echt — `skills` ist der letzte Stub).

## Non-Goals

- **Tool-Konfiguration** (Tool deaktivieren, Tool-Parameter anpassen,
  eigene Credentials pro Tool). → Plan 32 / Plan 33.
- **MCP-Server-Management** (zusätzliche externe MCP-Server registrieren,
  Subprozesse starten/stoppen, Auth). → Plan 32.
- **Agent-Self-Inventory-Tools** (Meta-Tools, mit denen der Agent
  selbst seine Tool/MCP-Liste abfragen oder neue einrichten kann).
  → Plan 32-A.
- **Skills als DB-Artefakte** (Anthropic-Skill-Modell: Markdown-Files mit
  Frontmatter, pro Persona aktivierbar). → Plan 33.
- **Approval-Konfiguration** pro Tool. → Plan 21 (Approval-Granularität).
- **Tool-Statistik** („wie oft wurde `web_search` benutzt"). Lebt schon
  in `/settings/insights` über `agent_runs`-Aggregate.
- **Live-Catalog-Reload** ohne Restart. Der Catalog wird im Lifespan
  einmal assembliert; Änderungen brauchen Backend-Restart. Reicht für
  Plan 31 — Plan 32 wird das brechen müssen.
- **Per-Channel-Filterung** der Tool-Liste (Frontend zeigt den Catalog
  ohne `current_channel`-Filter — die `cross_channel_send`-Recursion-
  Guard-Mechanik ist Implementierungsdetail).
- **Gruppierung/Kategorisierung** der Tool-Liste. Bei aktuell 13 Tools
  ist eine flache alphabetische Liste scannbar; eine Builder-Kategorie-
  Map wäre zusätzliche Pflegestelle bei sehr geringem Nutzen. Ab Plan 32
  wird die natürliche Achse ohnehin `source` (built-in vs.
  `mcp:<server-name>`) sein — das ist eine Pille pro Tool, keine
  Section-Struktur.
- **i18n** der UI-Strings — Plan 30.

## Scope

### Backend (`/home/haex/Projekte/Holzi`)

**Bestandsaufnahme Auth:** Die globale `bearer_auth_middleware` in
`src/hermes/auth.py` schützt alles bis auf `PUBLIC_PATHS =
frozenset({"/healthz"})`. Damit sind sowohl die neuen `/api/tools` und
`/api/mcp/health` als auch der bereits existierende `app.mount("/mcp",
…)` und `GET /mcp/manifest` schon heute auth-gated. Plan 31 fügt
keine neuen Public-Paths hinzu und keine Auth-Bypässe.

**Endpoint — neue Datei `src/hermes/routes/tools.py`:**

```python
class ToolInfo(BaseModel):
    name: str
    description: str
    requires_approval: bool
    risk_reason: str | None
    parameters_schema: dict
    # Heute immer "builtin". Plan 32 fügt "mcp:<server-name>" hinzu.
    # Bewusst free-form string statt Literal, damit der OpenAPI-Schema-
    # Vertrag bei Plan-32-Rollout stabil bleibt.
    source: str

class ToolsResponse(BaseModel):
    tools: list[ToolInfo]  # alphabetisch sortiert nach name
    total: int             # = len(tools)
```

- `GET /api/tools` → `ToolsResponse`.
- Datenquelle: `request.app.state.tool_catalog` (im Lifespan einmal mit
  `current_channel=None` assembliert). Kein neuer Helper, keine zweite
  Build-Pfad — der read-only Endpoint zeigt exakt was MCP exponiert.
- Sortierung im Endpoint: `sorted(tools, key=lambda t: t.name)`.
- `source` wird im Endpoint statisch auf `"builtin"` gesetzt. Sobald
  Plan 32 MCP-Tools in den Catalog mergt, setzt die MCP-Pipeline ihren
  eigenen `source`-Wert (`"mcp:<server-name>"`), und der Endpoint
  reicht ihn nur durch.

**MCP-Health-Endpoint — eigene Datei `src/hermes/routes/mcp_health.py`:**

```python
class McpHealthResponse(BaseModel):
    status: Literal["ok", "error"]
    url: str           # immer "/mcp" (Pfad, Host kennt das Backend nicht)
    tool_count: int    # = len(tool_catalog) at request time
    message: str       # human-readable, z.B. "session manager bereit"
```

- `GET /api/mcp/health` → `McpHealthResponse`.
- Check-Logik: greift `app.state.mcp_manager` ab (gesetzt im Lifespan).
  - `None` → `status="error"`, `message="MCP-Session-Manager nicht
    initialisiert"`.
  - Sonst: `status="ok"`, `message="bereit"` und `tool_count =
    len(app.state.tool_catalog)`.
- Bewusst **kein** HTTP-Self-Probe auf `/mcp` — das wäre eine
  Cross-Request-Schleife durch den ASGI-Stack und der Streamable-HTTP-
  Handler verlangt ein etabliertes MCP-Session-Handshake, das ein
  triviales `GET /` nicht erfüllt. Der State-Check oben ist die ehrliche
  Aussage „der Mount-Punkt ist gesetzt und die Tools sind da".

Beide Router in `routes/api.py` einhängen (analog zu
`routes/diagnostics.py`).

### Frontend (`/home/haex/Projekte/holzi-frontend`)

- `pnpm run gen:api` (siehe `reference_gen_api_command`-Memory) — neue
  Types `ToolInfo`, `ToolsResponse`, `McpHealthResponse` in
  `app/types/api-generated.ts`. (Kein `ToolCategory`.)
- Neues Composable `app/composables/useTools.ts`:
  - `list()` → `ToolsResponse`.
- Neues Composable `app/composables/useMcpHealth.ts`:
  - `check()` → `McpHealthResponse`.
  - Optional: `lastCheckedAt` ref, gesetzt nach jedem `check()`.
- `app/pages/settings/skills.vue` — Placeholder ersetzt durch zwei
  Sections:

  **Section 1: MCP-Surface (Card oben)**
  - Header „MCP-Server" + kurze Erklärung („Externe Clients wie Cline
    oder HaexChat können die Tools dieses Agents über MCP ansprechen.").
  - Status-Badge (grün „aktiv" / rot „inaktiv"), URL als Code-Block mit
    Copy-Button, „N Tools exponiert", relative Zeit der letzten Prüfung
    („vor 3 s") + Refresh-Button.
  - Setup-Hinweis (einzeilig): „Endpoint-URL `{host}/mcp` als
    Streamable-HTTP-MCP-Server konfigurieren. Auth via Bearer-Token
    (siehe `HERMES_AUTH_TOKEN`)." — präzise, ohne falsche
    „ungeschützt"-Aussage.
  - Deaktivierter Button **„MCP-Server konfigurieren"** mit Tooltip
    „Externe MCP-Server hinzufügen kommt mit Plan 32". Wird Sprungpunkt
    in Plan 32.

  **Section 2: Tool-Katalog**
  - Header „Tools" + Total-Count („13 Tools verfügbar").
  - Flache alphabetisch sortierte Liste von Tool-Cards. Jede Card:
    - Tool-Name (monospace) + `source`-Pille (heute „built-in",
      perspektivisch „mcp:<server-name>") + Approval-Badge wenn
      `requires_approval`.
    - Description-Text (2–3 Zeilen, kein Truncate).
    - „Parameter ansehen"-Toggle → klappt einen Code-Block mit
      JSON-pretty-printed `parameters_schema` aus. Fallback wenn das
      Schema leer ist: „keine Parameter".
    - Deaktivierter Footer-Button **„Konfigurieren"** mit Tooltip „Tool-
      Konfiguration kommt mit Plan 32 / 33".
  - Empty-State wenn `tools.length === 0` („Catalog leer — Backend nicht
    initialisiert?" — heute unmöglich, aber Vorsorge).

- Keine Auto-Refresh, single-user, latenzfrei. MCP-Health wird einmal
  beim Mount geprüft und sonst nur per Button.
- Inline-Error-Banner für 401/500.
- `settingsNav.ts` Entry für `/settings/skills`: `upcoming`-Hint
  entfernen.

### Tests

Backend:

- `tests/test_api_tools.py` — neue Datei:
  - `GET /api/tools` ohne Auth → 401.
  - `GET /api/tools` mit Auth → 200, `total == len(tools)`, Liste ist
    nach `name` alphabetisch sortiert.
  - Jede `ToolInfo` hat `name`, `description`, `parameters_schema`
    (kann leer sein), `source == "builtin"`.
  - Mindestens drei bekannte Tools sind in der Response enthalten
    (`save_note`, `web_search`, `read_user_guide`).
  - `requires_approval`-Flag wird durchgereicht (mock einen Tool-
    Builder, der ein Tool mit `requires_approval=True` zurückgibt → in
    der Response taucht das Flag auf).
- `tests/test_api_mcp_health.py` — neue Datei:
  - `GET /api/mcp/health` ohne Auth → 401.
  - Lifespan-State: mit `app.state.mcp_manager = None` → `status="error"`,
    `message` enthält „nicht initialisiert".
  - Mit `app.state.mcp_manager` gesetzt (Fake-Object) + Catalog
    geseedet → `status="ok"`, `tool_count` = Cataloglänge,
    `url == "/mcp"`.

Frontend:

- `tests/components/SkillsPage.test.ts` — neue Datei:
  - Initial render: lädt `/api/tools` + `/api/mcp/health` parallel,
    zeigt Loading-State, dann beide Sections.
  - MCP-Card: zeigt Status, URL, Tool-Count; Refresh-Button triggert
    neuen `/api/mcp/health`-Call.
  - „MCP-Server konfigurieren"-Button ist disabled, hat
    `title`-Attribut mit Plan-32-Hinweis.
  - Tool-Catalog: Liste ist alphabetisch sortiert (Reihenfolge im DOM
    vs. erwartete Reihenfolge prüfen); `source`-Pille zeigt „built-in";
    Approval-Badge erscheint nur bei `requires_approval=true`-Tools.
  - Parameter-Toggle: Klick öffnet den JSON-Block, zweiter Klick
    schließt ihn.
  - „Konfigurieren"-Button pro Tool ist disabled mit Tooltip.
  - 401 vom Backend → Error-Banner; 500 vom MCP-Health → MCP-Card
    zeigt „Status unbekannt", Tool-Liste bleibt sichtbar.
- `tests/components/settingsNav.test.ts` (falls existent — sonst
  Sanity-Check inline): `/settings/skills`-Entry hat kein `upcoming`
  mehr.

## Suggested Implementation

### 1. Backend: `GET /api/tools`

- TDD: `test_api_tools.py` zuerst, dann Route, dann grün ziehen.
- Pydantic-Response-Models exakt wie oben (für `gen:api`).
- Datenquelle ist `request.app.state.tool_catalog` — keine neue
  Helper-Funktion, kein zweiter Build-Pfad.

### 2. Backend: `GET /api/mcp/health`

- Lifespan-State-Inspection. Kein HTTP-Probe.
- TDD: `test_api_mcp_health.py` zuerst.

### 3. Backend: Router einhängen

- `routes/api.py`: `include_router(tools.router)` +
  `include_router(mcp_health.router)`.
- Bestehende `pytest`-Suite grün, ruff + mypy clean.

### 4. Frontend: gen:api + Composables

- Backend lokal hoch (siehe `reference_gen_api_command`-Memory),
  `pnpm run gen:api`, Diff prüfen.
- Composables (`useTools`, `useMcpHealth`) jeweils ~20 Zeilen.

### 5. Frontend: SkillsPage

- Pattern aus `pages/settings/diagnostics.vue` für die status-Card
  (grün/rot-Badge + relative Zeit).
- Schema-Viewer: einfacher `<pre><code>` mit `JSON.stringify(schema,
  null, 2)`. Kein Syntax-Highlight nötig — Schemas sind klein und
  geringe Häufigkeit.
- „Konfigurieren"-Buttons als `<button disabled>` mit `title`-Tooltip;
  bewusst noch keine `<NuxtLink>`s, damit kein toter Link existiert,
  bevor Plan 32/33 die Zielroute baut.
- `settingsNav.ts`: `upcoming` aus `/settings/skills`-Entry entfernen.

### 6. Frontend Tests

- `vi.waitFor`-Pattern aus `reference_component_testing`-Memory.

### 7. Verifikation

- `make up-local-full`, `/settings/skills` öffnen.
- Erwartet: MCP-Card zeigt „aktiv", N (aktuelle Catalog-Länge), eine
  flache alphabetisch sortierte Liste rendert, jedes Tool hat
  `source`-Pille + Parameter-Toggle + disabled Konfigurieren-Button.
- Refresh-Button auf MCP-Card → neuer Health-Call (Network-Tab prüfen).
- Approval-Badge: heute hat kein produktives Tool `requires_approval=
  True` — synthetisch im Test gedeckt, in der Live-Surface unsichtbar
  bis Plan 21 das nutzt.
- Backend `uv run pytest` clean, ruff + mypy clean.
- Frontend `pnpm vitest run` clean, `pnpm typecheck` clean.

## Open Questions

- Soll der MCP-Health-Endpoint Teil von `/api/diagnostics` werden statt
  eines eigenen Endpoints? → Vorschlag: **nein.** `/api/diagnostics`
  ist „muss vor erstem Chat konfiguriert sein"; MCP-Health ist ein
  Tool-Surface-Detail das nur auf `/settings/skills` interessant ist.
  Würde die Diagnostics-Card aufblähen ohne Onboarding-Wert. Falls
  Plan 32 mehrere MCP-Server bringt, ist die Health-Anzeige sowieso
  pro-Server und nicht mehr binär.
- Soll die Schema-Anzeige auch Beispiel-Calls rendern („so würde ein
  Aufruf aussehen")? → **Nicht in 31.** Schemas sind selbstdokumentiert
  genug für das Debugging-Zielpublikum (= der User).
- Sollten Tools mit `requires_approval=True` optisch sortiert nach oben?
  → Vorschlag: **nein,** strikt alphabetisch. Approval-Badge ist
  auffällig genug; künstliche Sortier-Achsen erschweren das schnelle
  Finden eines bekannten Tool-Namens.
- Sollte die `source`-Pille schon heute klickbar/filterbar sein? →
  **Nein.** Bei einem einzigen Wert (`builtin`) wäre der Filter leer.
  Sobald Plan 32 mehrere Sources bringt, ist Filter ein eigenes Feature.
- Sollen die Konfigurieren-Buttons schon als `<NuxtLink>` auf
  `/settings/mcp` / `/settings/tools/{name}` zeigen, mit 404-Stub als
  Platzhalter? → **Nein.** Toter Link verwirrt mehr als ein disabled
  Button. Die Zielrouten werden in 32/33 angelegt.
