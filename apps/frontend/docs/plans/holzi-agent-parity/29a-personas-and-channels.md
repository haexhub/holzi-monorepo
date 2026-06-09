# Plan 29-A: Personas + Channel-Prompts — die `/settings/preferences`-Seite

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Merged 2026-06-01.** Cross-repo
[Holzi#61](https://github.com/haexhub/Holzi/pull/61) +
[Holzi#62](https://github.com/haexhub/Holzi/pull/62) (response_model
follow-up) +
[holzi-frontend#79](https://github.com/haexhub/holzi-frontend/pull/79).

Backend: new `src/hermes/personas.py` owns the `CHANNEL_REGISTRY`
(web/task/signal/telegram), the `DEFAULT_PERSONA_*` seeds, the
idempotent `ensure_backfill(db)` lifespan hook, and the
`get_effective_system_prompt(channel, db)` resolver. Two new tables
(`personas` + `channel_prompts`) via `schema.py` + a single-default
trigger pair in `schema.sql`. Repos: `repository/personas.py` (CRUD +
`get_default`, refuses to delete the default) and `repository/channels.py`
(`ensure_seeded` per registry, `update` with a sentinel-arg so
`default_persona_id: null` differs from "omitted", `reset_prompt`). The
new `routes/preferences.py` exposes `GET/POST/PUT/DELETE /api/personas`
and `GET/PUT/POST /api/channels`; Pydantic response models so OpenAPI
emits proper `PersonaResponse` / `ChannelPromptResponse` shapes for
`gen:api`. The four `*_SYSTEM_PROMPT` constants are gone; the four
call-sites (`routes/api.py:393`, `scheduler.py:187`, `main.py:209`,
`main.py:261`) now call `get_effective_system_prompt(channel, db)`. New
tests: `test_personas_repo.py` (12), `test_channels_repo.py` (9),
`test_personas_resolver.py` (7), `test_api_preferences.py` (18). End-
to-end "composition flows through" coverage added in `test_api_chat.py`
(web channel) and `test_scheduler.py` (task channel).

Frontend: new `app/composables/usePersonas.ts` + `app/composables/useChannels.ts`,
new generated types `Persona`, `PersonaCreate`, `PersonaUpdate`,
`ChannelPrompt`, `ChannelPromptUpdate`. `/settings/preferences` is now
a two-section page (Personas: inline CRUD + Default-Badge + 'Als
Default setzen' + delete-disabled-for-default; Channels: one card per
registry entry with persona dropdown, prompt textarea, and 'Prompt
zurücksetzen' when non-default). `settingsNav` drops the `upcoming`
hint on the entry. Page-test (`tests/components/PreferencesPage.test.ts`)
covers initial render, create + 409 mapping, set-default + badge move,
channel persona pick, custom prompt + reset.

Verification: backend `uv run pytest` → 757 passed (3 deselected) +
`uv run ruff check src/ tests/` + `uv run mypy src/` clean. Frontend
`pnpm vitest run` → 267 passed (31 files) + `pnpm typecheck` clean.
Live smoke via uvicorn on port 18083 confirmed the boot backfill (1
default Hermes persona + 4 channel rows), create-new-persona,
promote-to-default demotes the prior default, 422 on default-delete,
channel prompt + persona update, reset, and 404 for unknown channel.

Cross-repo. Backend bekommt zwei neue Tabellen + Endpoints; Frontend baut die
`/settings/preferences`-Placeholder zur ersten echten Preferences-Seite um.

Depends on: [14](./14-control-center-shell.md) (Control Center shell + nav
slot „Preferences" existiert als Placeholder).

Followups: [29-B](./29b-persona-per-task.md) (Persona pro `agent_task`),
[29-C](./29c-persona-per-conversation.md) (Persona pro Conversation), beides
nach 29-A.

## Goal

Zwei konzeptionell getrennte Konfigurationen ins Backend ziehen und im
Frontend bedienbar machen:

1. **Personas** (viele Rows, vom User anlegbar) — *wer* spricht: Name +
   System-Prompt + `is_default`-Flag. Beispiel: „Hermes der Direkte",
   „Strenger Code-Reviewer", „Sokrates-Tutor".
2. **Channel-Prompts** (4 Rows, fix wie der Code-Registry) — *wie* der
   Kanal funktioniert: Format-/Längen-/Ton-Anweisungen für den jeweiligen
   Kanal (web / task / signal / telegram), plus optional eine
   `default_persona_id` für diesen Channel.

Der effektive System-Prompt wird zur Laufzeit komponiert als
`persona.prompt + "\n\n" + channel.prompt`.

Per-Task- und Per-Conversation-Persona-Auswahl ist explizit *nicht* in
29-A (siehe 29-B / 29-C). 29-A liefert die Infrastruktur, und Web-Chat /
Tasks / Signal / Telegram nutzen alle die `default_persona_id` ihres
Channels (mit Fallback auf die globale `is_default`-Persona).

Generisch erweiterbar: Wenn im Backend ein neuer Channel-Worker (z.B.
`discord`) hinzukommt, reicht ein Eintrag in der `CHANNEL_REGISTRY`-Map;
UI und DB rendern automatisch eine fünfte Channel-Card.

## Why

- Heute lebt jedes Verhaltenswort des Agents in vier `*_SYSTEM_PROMPT`-
  Konstanten und braucht einen Code-Deploy. Der User (Holzi ist single-
  user) kann sein eigenes Agent-Verhalten nicht ändern.
- *Wer* (Identität) und *wie* (Kanal-Format) zu trennen erlaubt Mix-and-
  Match: dieselbe „Code-Reviewer"-Persona kann via Signal kurz antworten
  und via Web ausführlich, ohne dass zwei Persona-Rows existieren müssen.
- Persona-CRUD ist Standardfeature in agentischen Frontends. Holzi sollte
  das auch haben, bevor 29-B/29-C die Auswahl-UI bringen können.

## Non-Goals

- **Persona pro Task** → Plan 29-B.
- **Persona pro Conversation** → Plan 29-C.
- **Versionierung / History** der Personas. Edit überschreibt; wer alte
  Werte will, nimmt git / Audit-Log.
- **Composition jenseits von `persona + "\n\n" + channel`** (z.B. Base-
  Prompt + Persona + Channel, Template-Variablen wie `{{user_name}}`).
- **Markdown- oder Variable-Interpolation** im Prompt. Opaquer String.
- **Per-Persona-Toolzugriff oder -Reasoning-Stufe.** Spezialisierung des
  Verhaltens findet im Prompt-Text statt.
- **Auth / Multi-User.** Holzi ist single-user; Personas sind global.
- **i18n** der UI-Strings — Plan 30.

## Scope

### Backend (`/home/haex/Projekte/Holzi`)

**Channel-Registry — Single source of truth für bekannte Channels:**

Neue Datei `src/hermes/personas.py`:

```python
from typing import Final

# Vier bekannte Channels. Key = exakter String, den die Call-Site
# als Channel-Identifier benutzt.
CHANNEL_REGISTRY: Final[dict[str, dict[str, str]]] = {
    "web": {
        "label": "Web-Chat",
        "default_prompt": (
            "Du sprichst durch das Web-UI. Markdown ist OK, "
            "längere Antworten sind OK."
        ),
    },
    "task": {
        "label": "Geplante Tasks",
        "default_prompt": (
            "Du führst einen geplanten Task autonom aus. Es gibt keinen "
            "User am anderen Ende. Antworte knapp und fokussiert auf das "
            "Resultat."
        ),
    },
    "signal": {
        "label": "Signal",
        "default_prompt": (
            "Du antwortest über Signal Note-to-Self. 1–3 kurze Sätze, "
            "kein Markdown, keine Tabellen, kein Code-Fence ohne Not."
        ),
    },
    "telegram": {
        "label": "Telegram",
        "default_prompt": (
            "Du antwortest über einen Telegram-Bot. 1–3 kurze Sätze, "
            "kein Markdown, keine Tabellen, kein Code-Fence ohne Not."
        ),
    },
}

# Default-Persona (wird beim ersten Boot in die DB geschrieben).
DEFAULT_PERSONA_NAME: Final[str] = "Hermes"
DEFAULT_PERSONA_PROMPT: Final[str] = (
    "Du bist Hermes, ein persönlicher KI-Assistent für Martin. "
    "Sei direkt, präzise und technisch."
)
```

**Tabellen — neue Migration in `src/hermes/db.py`:**

```sql
CREATE TABLE IF NOT EXISTS personas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    prompt TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Per-Channel-Konfiguration. Row pro Channel-Key aus CHANNEL_REGISTRY.
-- Werden idempotent beim Boot angelegt.
CREATE TABLE IF NOT EXISTS channel_prompts (
    channel TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    default_persona_id INTEGER,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (default_persona_id) REFERENCES personas(id) ON DELETE SET NULL
);

-- Trigger: garantiert genau eine Default-Persona. Bei UPDATE mit
-- is_default=1 werden alle anderen automatisch auf 0 gesetzt.
CREATE TRIGGER IF NOT EXISTS personas_single_default_insert
AFTER INSERT ON personas FOR EACH ROW WHEN NEW.is_default = 1
BEGIN
    UPDATE personas SET is_default = 0 WHERE id != NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS personas_single_default_update
AFTER UPDATE OF is_default ON personas FOR EACH ROW WHEN NEW.is_default = 1
BEGIN
    UPDATE personas SET is_default = 0 WHERE id != NEW.id;
END;
```

**Boot-Backfill** in `main.py` Lifespan (vor Worker-Start):

- Wenn `personas` leer → eine Row mit `DEFAULT_PERSONA_*` und
  `is_default=1` anlegen.
- Für jeden Key in `CHANNEL_REGISTRY`, der nicht in `channel_prompts`
  existiert → Row mit `prompt = default_prompt` und
  `default_persona_id = NULL` (Fallback greift → globale
  `is_default`-Persona) anlegen.
- Idempotent: erneute Boot-Pässe ändern nichts.

**Repository `src/hermes/repository/personas.py`:**

- `list_all(db) -> list[Persona]`
- `get(db, id) -> Persona | None`
- `get_by_name(db, name) -> Persona | None`
- `create(db, *, name, prompt, is_default) -> Persona`
  (UNIQUE constraint auf `name` → bei Duplikat IntegrityError → 409)
- `update(db, id, *, name?, prompt?, is_default?) -> Persona | None`
- `delete(db, id) -> bool` (False wenn `is_default=1` → 422 in der Route,
  weil sonst kein Default mehr existiert; FK-CASCADE SET NULL kümmert
  sich um channel_prompts und (in 29-B/C) agent_tasks / conversations)
- `get_default(db) -> Persona | None`

Und `src/hermes/repository/channels.py`:

- `list_all(db) -> list[ChannelPromptRow]`
- `get(db, channel) -> ChannelPromptRow | None`
- `update(db, channel, *, prompt?, default_persona_id?) -> ChannelPromptRow`
- `reset_prompt(db, channel) -> ChannelPromptRow` (setzt auf
  `CHANNEL_REGISTRY[channel]["default_prompt"]` zurück)

**Resolver** in `src/hermes/personas.py`:

```python
async def get_effective_system_prompt(channel: str, db) -> str:
    """Resolver für die Call-Sites. Wirft KeyError für unbekannten Channel."""
    if channel not in CHANNEL_REGISTRY:
        raise KeyError(f"unknown channel: {channel}")

    row = channels_repo.get(db, channel)
    # row darf nicht None sein wegen Boot-Backfill — defensive Defaults
    # trotzdem für saubere Tests.
    channel_prompt = row.prompt if row else CHANNEL_REGISTRY[channel]["default_prompt"]
    persona_id = row.default_persona_id if row else None

    persona = personas_repo.get(db, persona_id) if persona_id else None
    if persona is None:
        persona = personas_repo.get_default(db)
    if persona is None:
        # Theoretisch unmöglich nach Boot-Backfill; falls doch (DB-
        # Corruption), kein Crash, sondern Channel-Prompt allein.
        return channel_prompt

    return f"{persona.prompt}\n\n{channel_prompt}"
```

**Endpoints — neue Datei `src/hermes/routes/preferences.py`:**

Personas:

- `GET /api/personas` → `{ "personas": [{id, name, prompt, is_default,
  created_at, updated_at}, …] }`
- `POST /api/personas` → Body `{name, prompt, is_default?}` → 201 mit
  neuer Row. `name` 1..64 chars, `prompt` 1..8192 chars. Duplicate name →
  409.
- `PUT /api/personas/{id}` → Body `{name?, prompt?, is_default?}` →
  200 oder 404.
- `DELETE /api/personas/{id}` → 204; 422 wenn `is_default=1` (User muss
  erst eine andere zum Default machen). FK-SET-NULL räumt
  `channel_prompts.default_persona_id` auf.

Channels:

- `GET /api/channels` → `{ "channels": [{channel, label, default_prompt,
  prompt, is_default_prompt, default_persona_id, updated_at}, …] }` —
  iteriert in `CHANNEL_REGISTRY`-Reihenfolge. `is_default_prompt ==
  (prompt == default_prompt)`.
- `PUT /api/channels/{channel}` → Body `{prompt?, default_persona_id?}`
  → 200. Channel-Key muss in Registry sein, sonst 404.
  `default_persona_id` muss existieren, sonst 422.
- `POST /api/channels/{channel}/reset` → setzt `prompt` zurück auf
  `CHANNEL_REGISTRY[channel]["default_prompt"]`, ändert
  `default_persona_id` nicht. 200.

Alle Endpoints auth-gated; Router in `routes/api.py` einhängen.

**Call-Site-Umstellung:**

Die 4 Stellen, die heute `system_prompt=*_SYSTEM_PROMPT` setzen, werden
zu `system_prompt=await get_effective_system_prompt(channel, db)`:

| Datei | Heute | Nach 29-A |
|---|---|---|
| `routes/api.py:393` | `system_prompt=WEB_SYSTEM_PROMPT` | `system_prompt=await get_effective_system_prompt("web", db)` |
| `scheduler.py:187` | `system_prompt=TASK_SYSTEM_PROMPT` | `system_prompt=await get_effective_system_prompt("task", db)` |
| `main.py:209` | `system_prompt=SIGNAL_SYSTEM_PROMPT` | `system_prompt=await get_effective_system_prompt("signal", db)` |
| `main.py:261` | `system_prompt=TELEGRAM_SYSTEM_PROMPT` | `system_prompt=await get_effective_system_prompt("telegram", db)` |

Die alten 4 Konstanten werden entfernt; ihre Texte leben jetzt in
`CHANNEL_REGISTRY` (Channel-spezifischer Teil) und in der „Hermes"-
Default-Persona (Identitäts-Teil).

### Frontend (`/home/haex/Projekte/holzi-frontend`)

- `pnpm run gen:api` (siehe `reference_gen_api_command`-Memory) — neue
  Types `Persona`, `PersonaList`, `PersonaCreate`, `PersonaUpdate`,
  `ChannelPrompt`, `ChannelPromptList`, `ChannelPromptUpdate` in
  `app/types/api-generated.ts`.
- Neues Composable `app/composables/usePersonas.ts`:
  `list()`, `create(body)`, `update(id, body)`, `delete(id)`.
- Neues Composable `app/composables/useChannels.ts`:
  `list()`, `update(channel, body)`, `reset(channel)`.
- `app/pages/settings/preferences.vue` — Placeholder ersetzt durch
  **zwei-Section-Layout**:

  **Section 1: Personas**
  - Header „Personas" + kurze Erklärung („wer der Agent ist — Identität
    und Stil").
  - „Neue Persona"-Button öffnet Inline-Form (Name + Prompt-Textarea +
    Default-Checkbox).
  - Liste der Personas als Cards. Jede Card hat:
    - Name + „Default"-Badge falls aktiv.
    - Read-only Prompt-Preview (3 Zeilen, mit Klick aufklappbar).
    - Buttons: **Bearbeiten** · **Als Default setzen** (falls nicht
      Default) · **Löschen** (mit `confirm()`, disabled wenn Default).
  - Edit-Modus: Inline Textarea + Speichern/Abbrechen.

  **Section 2: Channels**
  - Header „Channels" + kurze Erklärung („wie der Kanal sich verhält —
    Format, Länge, Ton").
  - Vier Cards (eine pro Channel), gerendert aus `GET /api/channels`-
    Response (kein hardcoded Channel-Liste im FE):
    - Card-Header: `label` + Channel-Key-Badge + „Default-Prompt" /
      „Eigener Prompt"-Badge.
    - Persona-Dropdown („Default-Persona für diesen Channel"):
      `<select>` aus den Personas-Daten + Eintrag „— Globaler Default
      (is_default-Persona) —" mit `value=""` → `default_persona_id =
      null`.
    - Prompt-Textarea (6 Zeilen, monospace).
    - Footer: **Speichern** · **Prompt zurücksetzen** (nur wenn nicht
      Default-Prompt, mit `confirm()`).

  Stale-selection-Guard nach jeder Mutation (load() neu).

  Inline-Error-Banner für 404/409/422/500.

- Keine Auto-Refresh, single-user, latenzfrei.

### Tests

Backend:

- `tests/test_personas_repo.py` — Repository-Helper: CRUD, UNIQUE name,
  single-default-Trigger, `delete` mit Default → False.
- `tests/test_channels_repo.py` — Repository-Helper: list/get/update/
  reset, FK-SET-NULL nach `delete persona`.
- `tests/test_api_preferences.py` — Endpoints:
  - `GET /api/personas` initially: 1 Default-Persona aus Backfill.
  - `POST /api/personas` ok + 409 bei Duplicate name + 422 bei
    leerem prompt + 422 bei `prompt`-Länge > 8192.
  - `PUT /api/personas/{id}` mit `is_default=true` → andere verlieren
    Default (Trigger-Test).
  - `DELETE /api/personas/{id}` Default-Persona → 422.
  - `DELETE` einer non-Default-Persona, die einem Channel zugewiesen
    ist → channel.default_persona_id wird NULL.
  - `GET /api/channels` initially: 4 Rows, alle `is_default_prompt:
    true`, alle `default_persona_id: null`.
  - `PUT /api/channels/web` mit unbekannter persona_id → 422.
  - `PUT /api/channels/unknown` → 404.
  - `POST /api/channels/web/reset` → prompt zurück auf Default,
    default_persona_id unverändert.
- `tests/test_personas_resolver.py` — `get_effective_system_prompt`:
  - Backfill-State → `default_persona.prompt + "\n\n" +
    default_channel_prompt`.
  - Override Channel-Prompt → kommt in der Composition.
  - Setze `channel.default_persona_id` → diese Persona wird benutzt.
  - Lösche Persona → channel fällt zurück auf globale Default-Persona.
- Bestehende `tests/test_chat.py` / `test_scheduler.py` /
  `test_signal_worker.py` / `test_telegram_worker.py`: minimaler
  Patch, damit sie weiter grün sind (DB-Fixture hat die Backfill-
  Rows). Zwei neue Assertions pro Channel-Test:
  `(a)` ohne Custom-Prompt → Default-Composition kommt durch,
  `(b)` mit Custom-Prompt → Custom kommt durch.

Frontend:

- `tests/components/PreferencesPage.test.ts` — neue Datei:
  - Initial render: 1 Persona-Card (Default), 4 Channel-Cards.
  - „Neue Persona" → Form → Submit → POST aufgerufen, Card erscheint.
  - „Als Default setzen" → PUT mit `is_default: true`, alte Card
    verliert Default-Badge.
  - Channel-Persona-Dropdown ändern → PUT mit `default_persona_id`.
  - Channel-Prompt editieren → PUT mit `prompt`; „Prompt zurücksetzen"
    → POST `/reset`.
  - 409 vom Backend → Error-Banner zeigt „Name bereits vergeben".

## Suggested Implementation

### 1. Backend: Personas + Channel-Tabellen + Repos

- TDD: zuerst `test_personas_repo.py`, dann Repository, dann grün
  ziehen.
- Trigger für single-default mit Plain-SQL-Test absichern (zwei Rows
  mit `is_default=1` direkt INSERTen → erwarte dass nur die neuere 1
  hat).

### 2. Backend: Boot-Backfill + Resolver

- Lifespan-Hook in `main.py` (vor Worker-Start, damit Worker schon
  korrekt resolven).
- `get_effective_system_prompt`-Tests grün ziehen.

### 3. Backend: Endpoints

- `routes/preferences.py` schreiben.
- `test_api_preferences.py` Test-für-Test grün ziehen.
- Im `routes/api.py` einhängen.

### 4. Backend: Call-Sites umstellen

- Vier Code-Stellen suchen + ersetzen.
- Bestehende Tests anpassen, Backfill in Test-DB-Fixture sicherstellen.
- Alte `*_SYSTEM_PROMPT`-Konstanten löschen.

### 5. Frontend: gen:api + Composables

- Backend lokal hoch, `pnpm run gen:api`, Diff prüfen.
- Composables (`usePersonas`, `useChannels`) jeweils ~30 Zeilen.

### 6. Frontend: PreferencesPage

- Pattern aus `pages/settings/memory.vue` für die Persona-Liste (flach,
  Edit-inline) — keine Two-Pane wie Memory, weil hier zwei Sections
  nebeneinander leben.
- Channel-Section: Wiederverwendbare `<ChannelPromptCard>`-Komponente
  oder inline-loop, je nachdem wie groß die Card wird.

### 7. Frontend Tests

- `vi.waitFor`-Pattern aus `reference_component_testing`-Memory.

### 8. Verifikation

- `make up-local-full`, `/settings/preferences` öffnen.
- Eine Persona anlegen, als Default setzen, Web-Channel auf diese
  Persona zeigen lassen, Channel-Prompt editieren.
- Web-Chat senden, in `/settings/logs` prüfen dass die neue Composition
  im Agent-Run-System-Message landet.
- Backend `pytest` clean, ruff + mypy clean.
- Frontend `pnpm vitest run` clean, `pnpm typecheck` clean.

## Open Questions

- Soll `is_default_prompt` im FE als „Default" oder „Standard" gelabelt
  sein? → Vorschlag: „Default" (matched LLM-Page und ist im Code-
  Kontext naheliegend).
- Sollten die Channel-Cards die `effective`-Composition als Preview
  zeigen („So sieht der finale Prompt aus")? → **Nicht in 29-A.**
  Kann als Followup, wenn der User es vermisst.
- Sollte `personas_single_default_*`-Trigger zusätzlich verhindern,
  dass die *einzige* Default-Persona auf `is_default=0` gesetzt wird?
  → Vorschlag: nein, Backend-Endpoint `PUT` weist `is_default=false`
  ab wenn es die einzige Default-Row ist (422). Trigger bleibt simpel.
