# Plan 29-D: LLM-Credential und Modell pro Persona

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Done.** BE [Holzi#76](https://github.com/haexhub/Holzi/pull/76)
merged 2026-06-05; FE [#96](https://github.com/haexhub/holzi-frontend/pull/96)
merged 2026-06-05. Follow-up refactor [#97](https://github.com/haexhub/holzi-frontend/pull/97)
(Plan 29-D-A: persona-card reuses `SettingsModelSelect`) merged 2026-06-05,
and review-fix [#98](https://github.com/haexhub/holzi-frontend/pull/98)
(a11y label `for`/`id` + clearable "use credential default" entry) merged
2026-06-05. See [29-D-A](./29da-modelselect-reuse.md).

Cross-repo. Persona-Tabelle bekommt zwei neue Spalten, Resolver liefert
zusätzlich zur System-Prompt-Composition auch das gewählte LLM, Frontend
bekommt zwei Dropdowns pro Persona-Card.

Depends on: [29-A](./29a-personas-and-channels.md) (Personas-Tabelle),
bestehende `llm_credentials`-Infrastruktur (provider_models, list_provider_models).

## Goal

Pro Persona unabhängig wählen, **welche LLM-Credential** und **welches
Modell** sie nutzt. Bewusst entkoppelt: eine Credential bringt Zugang zu
**allen** Modellen ihres Providers; die Persona entscheidet, welches
Modell aus diesem Pool aktiv ist.

Beispiel: Credential „Anthropic-Personal" → Persona „Code-Reviewer"
nutzt `claude-opus-4-7`, Persona „Tutor" nutzt `claude-sonnet-4-6`.

## Why

Stärkere Modelle sind teurer und langsamer. Eine Persona, die nur
Brainstorming macht, braucht kein Opus. Eine, die Code reviewen soll,
braucht es schon.

Heute (Plan 09 ff.) hat jede `LlmCredential` ein `model`-Feld — das
funktioniert nur, weil aktuell eine Credential = der gesamte Agent
ist. Mit Personas zerbricht die Annahme.

## Non-Goals

- **Reasoning-Stufe pro Persona** (Plan 23 Composer-Chips). Kann
  Follow-up sein.
- **Auto-Selection / Cost-aware Routing.** Persona wählt manuell.
- **Per-Persona-Provider-Settings** (Temperatur, Top-P, etc.). Folgt
  später, wenn nachgefragt.
- **Fallback-Cascading** (Opus → wenn down → Sonnet). YAGNI.

## Scope

### Backend (`/home/haex/Projekte/Holzi`)

- Migration `personas`:
  - Neue Spalte `llm_credential_id INTEGER REFERENCES llm_credentials(id)
    ON DELETE SET NULL`.
  - Neue Spalte `model TEXT` (nullable, ein String wie
    `"claude-opus-4-7"`).
- `LlmCredential.model` wird zu **Default-Modell der Credential** (für
  legacy Code-Pfade) — das Feld bleibt, aber Personas überschreiben es.

**Resolver-Erweiterung:** statt nur einen System-Prompt-String liefert
der Resolver einen `PersonaContext`:

```python
@dataclass
class PersonaContext:
    system_prompt: str           # persona.prompt + "\n\n" + channel.prompt
    credential: LlmCredential    # immer non-null; Fallback auf is_active
    model: str                   # persona.model OR credential.model

async def resolve_persona_context(
    channel: str,
    db,
    *,
    persona_id_override: int | None = None,
) -> PersonaContext: ...
```

Resolution:
1. Persona-ID: override → channel.default_persona_id → globale Default-
   Persona.
2. Credential: persona.llm_credential_id → falls None → is_active-Credential.
3. Modell: persona.model → falls None → credential.model.
4. Wenn keine Credential gefunden (frische Installation) → wirf
   `NoCredentialError(503)`.

**Endpoints:**

- `PUT /api/personas/{id}` akzeptiert zusätzlich `llm_credential_id` und
  `model`. Validierung:
  - `llm_credential_id` muss existieren (oder `null`) → sonst 422.
  - `model` muss in `list_provider_models(credential)` enthalten sein
    (case-sensitive ID-Match) → sonst 422. Wenn `llm_credential_id`
    null, dann auch `model` null erzwingen.
- Neuer Helper-Endpoint **`GET /api/personas/{id}/models`** → ruft
  intern `list_provider_models(persona.credential)` auf, sodass das
  Frontend ein Dropdown füllen kann, ohne den Credential-API direkt
  zu kennen.

**Call-Sites-Umstellung:** alle `run_agent(...)` werden umgestellt von
„nimm is_active-Credential" auf „nimm `PersonaContext.credential`".

### Frontend (`/home/haex/Projekte/holzi-frontend`)

- `pnpm run gen:api`.
- `usePersonas.ts` bekommt `listModels(personaId)`.
- Persona-Card aus 29-A erweitern:
  - **Credential-Dropdown** — listet alle Credentials aus
    `GET /api/llm/credentials`. „— (globale Default-Credential) —" als
    erste Option.
  - **Modell-Dropdown** — lädt nach Credential-Wahl `GET
    /api/personas/{id}/models` (oder Frontend ruft direkt
    `/api/llm/credentials/{id}/models` aus existierender Infrastruktur);
    Default = Credential's Default-Modell.
- Wenn keine Credential gewählt → Modell-Dropdown disabled mit Hint
  „verwendet das Modell der aktiven Credential".

### Tests

Backend:
- `tests/test_personas_resolver.py` erweitert: `PersonaContext` ist
  korrekt geresolved in 6 Pfaden (Persona × Credential × Modell jeweils
  set/unset).
- `tests/test_api_preferences.py`: PUT mit unbekannter Credential →
  422; PUT mit Modell, das im Provider-Modell-Listing fehlt → 422.
- `tests/test_api_chat.py` (oder `test_runner.py`): Persona mit eigener
  Credential → Upstream-Mock wird mit deren ciphertext aufgerufen.

Frontend:
- `tests/components/PreferencesPage.test.ts`: Credential-Switch lädt
  Modell-Liste neu; Modell-Wahl persistiert; Reset („globale Default")
  setzt beide auf null.

## Open Questions

- Soll der Modell-Dropdown sortiert sein (z.B. Opus oben, dann Sonnet,
  dann Haiku) oder alphabetisch? → Vorschlag: Backend-`list_provider_
  models` definiert die Reihenfolge (heute schon der Fall in
  `ANTHROPIC_OAUTH_MODELS`).
- Wenn `llm_credential_id` per `ON DELETE SET NULL` aufgeräumt wird,
  muss `model` synchron auf NULL gesetzt werden? → **Ja**, sonst hat
  Persona ein Modell ohne Credential-Provider — Migrations-Trigger
  oder app-seitiger Cleanup im Credential-Delete-Endpoint.

---

## Implementation Plan

**Goal:** Per-persona LLM credential + model selection, with `PersonaContext` resolver driving both api.py and scheduler.py call sites.

**Architecture:**
- `personas.py` grows a `PersonaContext` dataclass and `resolve_persona_context()`. The existing `get_effective_system_prompt()` becomes a thin wrapper so test imports don't break mid-plan.
- Two schema columns (`llm_credential_id`, `model`) on `personas`; lifespan adds a one-shot migration similar to `_migrate_prompt_to_fragments`.
- Per-request ephemeral upstream client built from `PersonaContext.credential` via `build_client_for_credential`. For Anthropic (proxy mode) this is a cheap no-auth client; for non-Anthropic (api_key mode) it decrypts and sets Bearer header. Client is closed in the stream generator's `finally` block.

**Tech Stack:** FastAPI, SQLAlchemy Core, SQLite, httpx, Pydantic, Vue 3 + @nuxtjs/i18n, Vitest + @vue/test-utils, pytest-asyncio

---

### Task 1 — Schema: two new columns on `personas`

**Repo:** backend

**Files:**
- Modify: `src/hermes/schema.py` (personas table)
- Modify: `src/hermes/repository/models.py` (Persona dataclass)
- Modify: `src/hermes/repository/personas.py` (_row_to_persona, create, update)

**Context:**
The `personas` table lives in `src/hermes/schema.py:362-377`. The `Persona` dataclass is in `src/hermes/repository/models.py:148-164`. The repo functions `_row_to_persona`, `create`, `update`, `get`, `get_default` are in `src/hermes/repository/personas.py`.

**Step 1: Add columns to `personas` Table in schema.py**

In `src/hermes/schema.py`, after the `updated_at` column (line 376) inside the `personas` Table definition, add:

```python
    # Plan 29-D: per-persona LLM credential + model.
    # ON DELETE SET NULL so deleting a credential doesn't orphan personas.
    Column(
        "llm_credential_id",
        Integer,
        ForeignKey("llm_credentials.id", ondelete="SET NULL"),
    ),
    Column("model", Text),  # NULL = fall back to credential.model
```

**Step 2: Add fields to Persona dataclass in models.py**

In `src/hermes/repository/models.py`, add to the `Persona` dataclass after `is_default`:

```python
    llm_credential_id: int | None = None
    model: str | None = None
```

**Step 3: Update `_row_to_persona` in repository/personas.py**

Find `_row_to_persona` and add the two new fields:

```python
def _row_to_persona(row) -> Persona:
    return Persona(
        id=row.id,
        name=row.name,
        soul=row.soul,
        identity=row.identity,
        agents=row.agents,
        is_default=bool(row.is_default),
        created_at=row.created_at,
        updated_at=row.updated_at,
        llm_credential_id=row.llm_credential_id,
        model=row.model,
    )
```

**Step 4: Update `create` in repository/personas.py**

Add `llm_credential_id: int | None = None` and `model: str | None = None` parameters, include them in the `.values(...)` dict:

```python
async def create(
    engine: AsyncEngine,
    *,
    name: str,
    soul: str = "",
    identity: str = "",
    agents: str = "",
    is_default: bool = False,
    history_author: str = "user",
    llm_credential_id: int | None = None,
    model: str | None = None,
) -> Persona:
```

Add `llm_credential_id=llm_credential_id, model=model` to the `.values(...)` call.

**Step 5: Update `update` in repository/personas.py**

Add `llm_credential_id: int | None = None, *, clear_credential: bool = False` and `model: str | None = None` parameters (use `UNSET` sentinel or a dedicated approach). The simplest approach: pass keyword args that are `None` to mean "don't change" vs an explicit `null_value` sentinel. Since personas currently don't have nullable fields in `update`, use a sentinel:

```python
_UNSET = object()

async def update(
    engine: AsyncEngine,
    persona_id: int,
    *,
    name: str | None = None,
    soul: str | None = None,
    identity: str | None = None,
    agents: str | None = None,
    is_default: bool | None = None,
    llm_credential_id: int | None | object = _UNSET,  # _UNSET = don't touch
    model: str | None | object = _UNSET,              # _UNSET = don't touch
    history_author: str = "user",
) -> Persona | None:
```

Inside `update`, build the `updates` dict and only include the new fields when they are not `_UNSET`:

```python
if llm_credential_id is not _UNSET:
    updates[t.c.llm_credential_id] = llm_credential_id
if model is not _UNSET:
    updates[t.c.model] = model
```

**Step 6: Run unit tests to verify no regressions**

```bash
cd /home/haex/Projekte/Holzi
pytest tests/test_personas_resolver.py tests/test_api_preferences.py -v
```

Expected: all existing tests pass (new columns are nullable, existing code paths unaffected).

**Step 7: Commit**

```bash
cd /home/haex/Projekte/Holzi
git add src/hermes/schema.py src/hermes/repository/models.py src/hermes/repository/personas.py
git commit -m "feat(personas): add llm_credential_id + model columns (Plan 29-D Task 1)"
```

---

### Task 2 — Lifespan migration + ensure_backfill update

**Repo:** backend

**Files:**
- Modify: `src/hermes/personas.py`

**Context:**
`personas.py` has multiple one-shot migration helpers called from `lifespan` in `main.py`. The pattern: PRAGMA-gated ADD COLUMN, then idempotent update. See `_migrate_prompt_to_fragments` (around line 163) as the exact template. The `ensure_backfill` function (around line 250) is called on every boot and does NOT need to change — the two new columns default to NULL which is correct for existing rows.

**Step 1: Add migration function to personas.py**

Add after `_migrate_skills_add_enabled` (before `ensure_backfill`):

```python
async def _migrate_personas_add_credential_columns(engine: AsyncEngine) -> None:
    """One-shot: add llm_credential_id + model to personas if missing. Idempotent."""
    async with engine.connect() as conn:
        cols = (await conn.execute(text("PRAGMA table_info(personas)"))).all()
        has_cred = any(row.name == "llm_credential_id" for row in cols)
    if has_cred:
        return
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "ALTER TABLE personas ADD COLUMN llm_credential_id INTEGER "
                "REFERENCES llm_credentials(id) ON DELETE SET NULL"
            )
        )
        await conn.execute(
            text("ALTER TABLE personas ADD COLUMN model TEXT")
        )
```

**Step 2: Register the migration in main.py lifespan**

Open `src/hermes/main.py`. Find the section where `_migrate_prompt_to_fragments` and other migration functions are called (around line 150-170 in the lifespan). Add the new migration call in the same sequence:

```python
await personas._migrate_personas_add_credential_columns(app.state.db)
```

**Step 3: Run full test suite to confirm migration works**

```bash
cd /home/haex/Projekte/Holzi
pytest tests/ -x -q 2>&1 | tail -5
```

Expected: all tests pass, no new failures.

**Step 4: Commit**

```bash
cd /home/haex/Projekte/Holzi
git add src/hermes/personas.py src/hermes/main.py
git commit -m "feat(personas): lifespan migration for llm_credential_id + model (Plan 29-D Task 2)"
```

---

### Task 3 — PersonaContext + resolve_persona_context in personas.py

**Repo:** backend

**Files:**
- Modify: `src/hermes/personas.py`
- Modify: `src/hermes/errors.py` (new error code)

**Context:**
`get_effective_system_prompt(channel, engine)` in `personas.py` is the current resolver. It returns a plain `str`. Two call sites: `src/hermes/routes/api.py:400` and `src/hermes/scheduler.py:183`. We need a `PersonaContext` dataclass and a new resolver function. Keep `get_effective_system_prompt` as a thin wrapper so tests don't break until Task 7 updates the call sites.

The `llm_credentials` repo is already imported in `personas.py` or can be added. The `NoCredential` error needs a new `ErrorCode`.

**Step 1: Add PERSONA_NO_CREDENTIAL to errors.py**

In `src/hermes/errors.py`, find the persona error codes (around line 103-110). Add:

```python
    PERSONA_NO_CREDENTIAL = "PERSONA_NO_CREDENTIAL"
    PERSONA_INVALID_CREDENTIAL = "PERSONA_INVALID_CREDENTIAL"
    PERSONA_INVALID_MODEL = "PERSONA_INVALID_MODEL"
```

**Step 2: Add PersonaContext dataclass and resolver to personas.py**

Add imports at the top of `src/hermes/personas.py`:

```python
from dataclasses import dataclass
from hermes.repository import llm_credentials as llm_credentials_repo
from hermes.repository.models import LlmCredential
```

Add the dataclass after the existing imports block (before `CHANNEL_REGISTRY`):

```python
@dataclass
class PersonaContext:
    """Resolved agent context for a single chat turn.

    `credential` is always non-null: persona.llm_credential_id → active
    credential → RuntimeError if neither exists (503 on lifespan check).
    `model` is persona.model if set, otherwise credential.model.
    """

    system_prompt: str
    credential: LlmCredential
    model: str
```

Add the new resolver function after `get_effective_system_prompt`:

```python
async def resolve_persona_context(
    channel: str,
    engine: AsyncEngine,
) -> PersonaContext:
    """Extend get_effective_system_prompt with credential + model resolution.

    Resolution order:
    1. system_prompt: same composition as get_effective_system_prompt.
    2. credential: persona.llm_credential_id → active credential.
       Raises HTTPException(503, PERSONA_NO_CREDENTIAL) if neither found.
    3. model: persona.model → credential.model.
       Falls back to settings.model if credential.model is also None.
    """
    from hermes.config import settings  # local import to avoid circular
    from fastapi import HTTPException

    system_prompt = await get_effective_system_prompt(channel, engine)

    # Resolve persona for the given channel (duplicate the persona-id logic).
    if channel not in CHANNEL_REGISTRY:
        raise KeyError(f"unknown channel: {channel}")
    row = await channels_repo.get(engine, channel)
    persona_id: int | None = None if row is None else row.default_persona_id
    persona = None
    if persona_id is not None:
        persona = await personas_repo.get(engine, persona_id)
    if persona is None:
        persona = await personas_repo.get_default(engine)

    # Credential resolution.
    credential: LlmCredential | None = None
    if persona is not None and persona.llm_credential_id is not None:
        credential = await llm_credentials_repo.get(engine, persona.llm_credential_id)
    if credential is None:
        credential = await llm_credentials_repo.get_active(engine)
    if credential is None:
        raise HTTPException(
            status_code=503,
            detail=ErrorCode.PERSONA_NO_CREDENTIAL.value,
        )

    # Model resolution.
    model = (
        (persona.model if persona is not None else None)
        or credential.model
        or settings.model
    )

    return PersonaContext(
        system_prompt=system_prompt,
        credential=credential,
        model=model,
    )
```

**Step 3: Write tests for the new resolver**

In `tests/test_personas_resolver.py`, add a helper to seed a credential and test the 6 resolution paths:

```python
from hermes.personas import resolve_persona_context, PersonaContext
from hermes.repository import llm_credentials as cred_repo
from hermes.crypto import EncryptedBlob

async def _seed_credential(engine, *, model: str | None = None, is_active: bool = False) -> int:
    """Seed a dummy api_key credential. Returns credential id."""
    cred = await cred_repo.create_api_key(
        engine,
        provider="openai",
        display_name="test-cred",
        base_url=None,
        ciphertext=EncryptedBlob(iv="aa", tag="bb", data="cc"),
    )
    import time
    from sqlalchemy import text
    async with engine.begin() as conn:
        await conn.execute(
            text("UPDATE llm_credentials SET model=:m, is_active=:a WHERE id=:id"),
            {"m": model, "a": 1 if is_active else 0, "id": cred.id},
        )
    return cred.id


@pytest.mark.asyncio
async def test_resolve_context_uses_active_cred_when_persona_has_none(conn):
    """No persona credential → active credential used."""
    cred_id = await _seed_credential(conn, model="gpt-4o", is_active=True)
    await _seed_default_persona(conn, identity="x")
    ctx = await resolve_persona_context("web", conn)
    assert isinstance(ctx, PersonaContext)
    assert ctx.credential.id == cred_id
    assert ctx.model == "gpt-4o"


@pytest.mark.asyncio
async def test_resolve_context_persona_credential_overrides_active(conn):
    """Persona pins a specific credential → that credential wins."""
    active_id = await _seed_credential(conn, model="gpt-4o", is_active=True)
    pinned_id = await _seed_credential(conn, model="gpt-3.5-turbo", is_active=False)
    persona = await _seed_default_persona(conn, identity="x")
    # Pin the non-active credential on the persona
    from hermes.repository import personas as p_repo
    await p_repo.update(conn, persona.id, llm_credential_id=pinned_id)
    ctx = await resolve_persona_context("web", conn)
    assert ctx.credential.id == pinned_id
    assert ctx.model == "gpt-3.5-turbo"


@pytest.mark.asyncio
async def test_resolve_context_persona_model_overrides_cred_model(conn):
    """persona.model wins over credential.model."""
    cred_id = await _seed_credential(conn, model="gpt-4o", is_active=True)
    persona = await _seed_default_persona(conn, identity="x")
    from hermes.repository import personas as p_repo
    await p_repo.update(conn, persona.id, llm_credential_id=cred_id, model="gpt-4-turbo")
    ctx = await resolve_persona_context("web", conn)
    assert ctx.model == "gpt-4-turbo"


@pytest.mark.asyncio
async def test_resolve_context_no_credential_raises_503(conn):
    """No active credential and persona has none → 503."""
    from fastapi import HTTPException
    await _seed_default_persona(conn, identity="x")
    with pytest.raises(HTTPException) as exc_info:
        await resolve_persona_context("web", conn)
    assert exc_info.value.status_code == 503


@pytest.mark.asyncio
async def test_resolve_context_model_falls_back_to_settings_model(conn):
    """credential.model is None and persona.model is None → settings.model."""
    from unittest.mock import patch
    await _seed_credential(conn, model=None, is_active=True)
    await _seed_default_persona(conn, identity="x")
    with patch("hermes.personas.settings") as mock_settings:
        mock_settings.model = "fallback-model"
        ctx = await resolve_persona_context("web", conn)
    assert ctx.model == "fallback-model"
```

**Step 4: Run the new tests**

```bash
cd /home/haex/Projekte/Holzi
pytest tests/test_personas_resolver.py -v -k "resolve_context"
```

Expected: all 5 new tests pass.

**Step 5: Run full test suite**

```bash
cd /home/haex/Projekte/Holzi
pytest tests/ -x -q 2>&1 | tail -5
```

Expected: all tests pass.

**Step 6: Commit**

```bash
cd /home/haex/Projekte/Holzi
git add src/hermes/personas.py src/hermes/errors.py tests/test_personas_resolver.py
git commit -m "feat(personas): PersonaContext + resolve_persona_context (Plan 29-D Task 3)"
```

---

### Task 4 — PUT /api/personas/{id}: accept + validate credential and model

**Repo:** backend

**Files:**
- Modify: `src/hermes/routes/preferences.py`

**Context:**
`PersonaUpdate` (line ~180) and `PersonaResponse` (line ~55) are in `preferences.py`. The `update_persona` handler (line ~238) calls `personas_repo.update`. We need:
1. Add `llm_credential_id: int | None = _UNSET` and `model: str | None = _UNSET` to `PersonaUpdate`
2. Validate the new fields in `update_persona`
3. Add `llm_credential_id` and `model` to `PersonaResponse` and `_persona_to_dict`

Note: Pydantic's `ConfigDict(extra="forbid")` means we need to actually add the fields rather than use a sentinel object in the Pydantic model. Use `UNSET_INT = -1` as a sentinel or use a two-pass approach (field + separate `_fields_provided` set). The cleanest Pydantic-compatible approach is to use a custom sentinel class.

Actually, for Pydantic, use `model_fields_set` to distinguish "not provided" from "provided as null". Read the `PersonaUpdate` body, then check `"llm_credential_id" in body.model_fields_set` to know if the caller explicitly sent it.

**Step 1: Add fields to PersonaUpdate**

```python
class PersonaUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=64)
    soul: str | None = Field(default=None, max_length=8192)
    identity: str | None = Field(default=None, max_length=8192)
    agents: str | None = Field(default=None, max_length=8192)
    is_default: bool | None = None
    # Plan 29-D: per-persona LLM credential + model.
    # Not in model_fields_set → field not in request body → don't touch DB column.
    # In model_fields_set + null → explicit clear.
    llm_credential_id: int | None = None
    model: str | None = None
```

**Step 2: Add fields to PersonaResponse and _persona_to_dict**

```python
class PersonaResponse(BaseModel):
    id: int
    name: str
    soul: str
    identity: str
    agents: str
    is_default: bool
    created_at: int
    updated_at: int
    llm_credential_id: int | None = None
    model: str | None = None
```

In `_persona_to_dict`:
```python
def _persona_to_dict(p: Persona) -> dict[str, Any]:
    return {
        "id": p.id,
        "name": p.name,
        "soul": p.soul,
        "identity": p.identity,
        "agents": p.agents,
        "is_default": p.is_default,
        "created_at": p.created_at,
        "updated_at": p.updated_at,
        "llm_credential_id": p.llm_credential_id,
        "model": p.model,
    }
```

**Step 3: Add validation + new fields to update_persona handler**

In `update_persona`, after the all-empty check and before the `personas_repo.update` call, add validation:

```python
from hermes.routes.llm import list_credential_models  # import at top of file
from hermes.repository import llm_credentials as llm_credentials_repo
from hermes.provider_models import list_provider_models

# Validate llm_credential_id if provided
new_cred_id: int | None | object = _UNSET  # _UNSET sentinel from repo layer
new_model: str | None | object = _UNSET

if "llm_credential_id" in body.model_fields_set:
    if body.llm_credential_id is not None:
        cred = await llm_credentials_repo.get(db, body.llm_credential_id)
        if cred is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "code": ErrorCode.PERSONA_INVALID_CREDENTIAL.value,
                    "params": {"id": body.llm_credential_id},
                },
            )
    new_cred_id = body.llm_credential_id

if "model" in body.model_fields_set:
    if body.model is not None:
        # model can only be set when a credential is set (either new or existing)
        effective_cred_id = (
            body.llm_credential_id
            if "llm_credential_id" in body.model_fields_set
            else existing.llm_credential_id
        )
        if effective_cred_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "code": ErrorCode.PERSONA_INVALID_MODEL.value,
                    "params": {"model": body.model, "reason": "no_credential"},
                },
            )
        cred = await llm_credentials_repo.get(db, effective_cred_id)
        if cred is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "code": ErrorCode.PERSONA_INVALID_CREDENTIAL.value,
                    "params": {"id": effective_cred_id},
                },
            )
        http = request.app.state.external_http
        encryptor = request.app.state.encryptor
        available_models = await list_provider_models(cred, http=http, encryptor=encryptor)
        if not any(m.id == body.model for m in available_models):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "code": ErrorCode.PERSONA_INVALID_MODEL.value,
                    "params": {"model": body.model},
                },
            )
    new_model = body.model

# Pass new fields to update (use _UNSET sentinel from personas_repo to signal "no change")
from hermes.repository.personas import _UNSET as REPO_UNSET
updated = await personas_repo.update(
    db,
    persona_id,
    name=body.name,
    soul=body.soul,
    identity=body.identity,
    agents=body.agents,
    is_default=body.is_default,
    llm_credential_id=new_cred_id if new_cred_id is not _UNSET else REPO_UNSET,
    model=new_model if new_model is not _UNSET else REPO_UNSET,
)
```

Note: The `_UNSET` sentinel is imported from `repository/personas.py`. Make it a module-level exported object there.

Actually, cleaner approach — just import `_UNSET` from `repository/personas.py` and reuse it everywhere. Make sure `_UNSET` is defined at module level in `repository/personas.py` (not inside a function), so it can be imported.

**Step 4: Add GET /api/personas/{id}/models endpoint**

After the `update_persona` handler, add:

```python
@router.get("/personas/{persona_id}/models", response_model=ModelListResponse)
async def list_persona_models(persona_id: int, request: Request) -> dict[str, Any]:
    """Return the model list for the persona's pinned credential (or active credential).

    Thin wrapper over GET /api/llm/credentials/{id}/models so the UI
    doesn't need to know which credential a persona uses.
    """
    from hermes.provider_models import list_provider_models, ProviderModelsError, ModelChoice

    db = _db(request)
    persona = await personas_repo.get(db, persona_id)
    if persona is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": ErrorCode.PERSONA_NOT_FOUND.value, "params": {"id": persona_id}},
        )

    cred: LlmCredential | None = None
    if persona.llm_credential_id is not None:
        cred = await llm_credentials_repo.get(db, persona.llm_credential_id)
    if cred is None:
        cred = await llm_credentials_repo.get_active(db)
    if cred is None:
        raise HTTPException(
            status_code=503,
            detail=ErrorCode.PERSONA_NO_CREDENTIAL.value,
        )

    try:
        models = await list_provider_models(
            cred,
            http=request.app.state.external_http,
            encryptor=request.app.state.encryptor,
        )
    except ProviderModelsError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {"models": [{"id": m.id, "label": m.label} for m in models]}
```

Add `ModelListResponse` import from `hermes.routes.llm`:

```python
from hermes.routes.llm import ModelListResponse
```

**Step 5: Write failing tests for the new validation**

In `tests/test_api_preferences.py`, add:

```python
async def test_put_persona_invalid_credential_422(client: httpx.AsyncClient) -> None:
    """llm_credential_id pointing to non-existent credential → 422."""
    resp = await client.put(
        "/api/personas/1",
        json={"llm_credential_id": 9999},
        headers=AUTH,
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "PERSONA_INVALID_CREDENTIAL"


async def test_put_persona_invalid_model_no_credential_422(client: httpx.AsyncClient) -> None:
    """Trying to set model without a credential → 422."""
    resp = await client.put(
        "/api/personas/1",
        json={"model": "gpt-4o"},
        headers=AUTH,
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "PERSONA_INVALID_MODEL"


async def test_put_persona_credential_and_model_persisted(client: httpx.AsyncClient) -> None:
    """Valid credential + model pair is persisted and returned."""
    # Create a credential first via the LLM endpoint
    create_resp = await client.post(
        "/api/llm/credentials",
        json={"provider": "openai", "display_name": "test", "api_key": "sk-test"},
        headers=AUTH,
    )
    assert create_resp.status_code == 201
    cred_id = create_resp.json()["id"]

    # Mock model validation: the test uses ASGITransport which goes through
    # the real provider_models code. For openai provider, list_provider_models
    # hits the network — we skip model validation in this test by using a
    # model that is returned by the mock.
    # Simplest approach: monkeypatch list_provider_models in the route module.
    # This test is an integration test that verifies persistence, not validation.
    # See test_put_persona_invalid_model_422 for validation coverage.
    # Just verify that llm_credential_id is persisted and returned:
    put_resp = await client.put(
        "/api/personas/1",
        json={"llm_credential_id": cred_id},
        headers=AUTH,
    )
    assert put_resp.status_code == 200
    assert put_resp.json()["llm_credential_id"] == cred_id


async def test_get_persona_models_returns_list(client: httpx.AsyncClient) -> None:
    """GET /api/personas/{id}/models returns model list from active credential."""
    # When there's no credential, expect 503.
    resp = await client.get("/api/personas/1/models", headers=AUTH)
    assert resp.status_code == 503
```

**Step 6: Run the new tests**

```bash
cd /home/haex/Projekte/Holzi
pytest tests/test_api_preferences.py -v -k "invalid_credential or invalid_model or credential_and_model or persona_models"
```

Fix any failures.

**Step 7: Run full test suite**

```bash
cd /home/haex/Projekte/Holzi
pytest tests/ -x -q 2>&1 | tail -5
```

**Step 8: Commit**

```bash
cd /home/haex/Projekte/Holzi
git add src/hermes/routes/preferences.py tests/test_api_preferences.py
git commit -m "feat(personas): PUT accepts llm_credential_id+model, GET models endpoint (Plan 29-D Task 4)"
```

---

### Task 5 — Credential-delete cascade: null out persona.model

**Repo:** backend

**Files:**
- Modify: `src/hermes/routes/llm.py`

**Context:**
`ON DELETE SET NULL` on `llm_credential_id` handles nulling the FK column when a credential is deleted. But `model` has no FK constraint and stays non-null. We need to explicitly null `model` in the `delete_credential` route handler (line 123-132 in `routes/llm.py`), before the deletion so we know which personas to update.

**Step 1: Write failing test first**

In `tests/test_api_preferences.py`, add:

```python
async def test_delete_credential_nulls_persona_model(client: httpx.AsyncClient) -> None:
    """Deleting a credential also nulls persona.model for pinned personas."""
    # Create credential
    create_resp = await client.post(
        "/api/llm/credentials",
        json={"provider": "openai", "display_name": "d", "api_key": "sk-x"},
        headers=AUTH,
    )
    cred_id = create_resp.json()["id"]

    # Pin credential on persona (skip model validation via direct DB update — or
    # just set llm_credential_id and leave model null, then verify null stays null
    # after delete). Simpler test: just verify llm_credential_id becomes null.
    put_resp = await client.put(
        "/api/personas/1",
        json={"llm_credential_id": cred_id},
        headers=AUTH,
    )
    assert put_resp.status_code == 200

    # Delete the credential
    del_resp = await client.delete(f"/api/llm/credentials/{cred_id}", headers=AUTH)
    assert del_resp.status_code == 204

    # Verify persona no longer references the credential
    list_resp = await client.get("/api/personas", headers=AUTH)
    persona = list_resp.json()["personas"][0]
    assert persona["llm_credential_id"] is None
    assert persona["model"] is None
```

**Step 2: Run test to see it fail**

```bash
cd /home/haex/Projekte/Holzi
pytest tests/test_api_preferences.py::test_delete_credential_nulls_persona_model -v
```

Expected: FAIL (model not nulled after credential delete).

**Step 3: Update delete_credential in routes/llm.py**

In `routes/llm.py`, add import at top:

```python
from sqlalchemy import text as sql_text
```

In `delete_credential`, before `repo.delete`:

```python
async def delete_credential(request: Request, cred_id: int) -> Response:
    db: AsyncEngine = request.app.state.db
    if not await repo.exists(db, cred_id):
        raise HTTPException(
            status_code=404, detail=ErrorCode.LLM_CREDENTIAL_NOT_FOUND.value
        )
    # ON DELETE SET NULL handles llm_credential_id but not model.
    async with db.begin() as conn:
        await conn.execute(
            sql_text(
                "UPDATE personas SET model = NULL "
                "WHERE llm_credential_id = :cid"
            ),
            {"cid": cred_id},
        )
    if not await repo.delete(db, cred_id):
        raise HTTPException(
            status_code=404, detail=ErrorCode.LLM_CREDENTIAL_NOT_FOUND.value
        )
    await _refresh_upstream(request)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

Note: `repo.exists` might not exist yet. Check `src/hermes/repository/llm_credentials.py` — if it doesn't have an `exists` helper, just do the NULL update unconditionally (it's a no-op if no persona uses this credential) and rely on `repo.delete` returning False for the 404.

Simpler implementation (no `exists` needed):

```python
async def delete_credential(request: Request, cred_id: int) -> Response:
    db: AsyncEngine = request.app.state.db
    # Null out model for any persona pinned to this credential BEFORE the FK
    # cascade would set llm_credential_id=NULL (so we can still target by id).
    async with db.begin() as conn:
        await conn.execute(
            sql_text(
                "UPDATE personas SET model = NULL WHERE llm_credential_id = :cid"
            ),
            {"cid": cred_id},
        )
    if not await repo.delete(db, cred_id):
        raise HTTPException(
            status_code=404, detail=ErrorCode.LLM_CREDENTIAL_NOT_FOUND.value
        )
    await _refresh_upstream(request)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
```

**Step 4: Run the test**

```bash
cd /home/haex/Projekte/Holzi
pytest tests/test_api_preferences.py::test_delete_credential_nulls_persona_model -v
```

Expected: PASS.

**Step 5: Run full suite**

```bash
cd /home/haex/Projekte/Holzi
pytest tests/ -x -q 2>&1 | tail -5
```

**Step 6: Commit**

```bash
cd /home/haex/Projekte/Holzi
git add src/hermes/routes/llm.py tests/test_api_preferences.py
git commit -m "fix(personas): null persona.model when credential deleted (Plan 29-D Task 5)"
```

---

### Task 6 — Update call sites: api.py + scheduler.py use PersonaContext

**Repo:** backend

**Files:**
- Modify: `src/hermes/routes/api.py`
- Modify: `src/hermes/scheduler.py`

**Context:**

In `routes/api.py`, the function `_stream_web_agent_run` (line ~235) currently:
1. Gets `model` from `llm_credentials_repo.get_active_model(db) or settings.model` (line ~277)
2. Gets `upstream` from `request.app.state.upstream` (line ~241)
3. Passes both to `run_agent` with `system_prompt=await get_effective_system_prompt(WEB_CHANNEL, db)` (line ~400)

New behavior:
1. Call `resolve_persona_context(WEB_CHANNEL, db)` → `PersonaContext`
2. Build ephemeral upstream from `persona_ctx.credential` via `build_client_for_credential`
3. Use `persona_ctx.model` and `persona_ctx.system_prompt`
4. Close the ephemeral upstream in the stream generator's `finally` block

In `scheduler.py` (line ~162-189), same pattern but for the `TASK_CHANNEL`.

**Step 1: Update imports in routes/api.py**

Change:
```python
from hermes.personas import get_effective_system_prompt
```
To:
```python
from hermes.personas import resolve_persona_context
```

Add:
```python
from hermes.upstream import build_client_for_credential
```

Remove (no longer needed at this call site):
```python
from hermes.repository import (
    llm_credentials as llm_credentials_repo,
    ...
)
```
(Only remove `llm_credentials_repo` from this import if it's no longer used elsewhere in `api.py`. Check first — it may be used in other handlers.)

**Step 2: Update _stream_web_agent_run in routes/api.py**

Replace lines 274-279 (model resolution) and line 241 (upstream) and the `run_agent` call site (lines 396-412):

```python
async def _stream_web_agent_run(request: Request, convo: Any) -> Response:
    db: AsyncEngine = request.app.state.db

    tools = build_tool_catalog(...)  # unchanged

    run_id = uuid.uuid4().hex
    chat_runs: dict[str, asyncio.Event] = request.app.state.chat_runs
    cancel_event = asyncio.Event()
    chat_runs[run_id] = cancel_event

    approvals: dict[str, asyncio.Future[ApprovalDecision]] = request.app.state.approvals
    session_approvals: dict[int, set[str]] = request.app.state.session_approvals

    # Resolve persona context (system_prompt + credential + model).
    persona_ctx = await resolve_persona_context(WEB_CHANNEL, db)
    model = persona_ctx.model

    # Build per-request upstream from persona's credential.
    # For Anthropic (proxy mode), build_client_for_credential returns a cheap
    # no-auth client pointing at the proxy. For other providers, it decrypts
    # the API key and sets the Bearer header.
    persona_upstream = build_client_for_credential(
        persona_ctx.credential,
        encryptor=request.app.state.encryptor,
        fallback_proxy_url=settings.llm_url,
    )

    async def gen() -> AsyncIterator[bytes]:
        try:
            yield to_sse(SessionEvent(data=SessionData(conversation_id=convo.id)))
            yield to_sse(RunEvent(data=RunData(run_id=run_id)))

            queue: asyncio.Queue[BaseModel | None] = asyncio.Queue()
            metrics: dict[str, Any] = {}

            # ... (all existing callbacks: on_chunk, on_reasoning, etc.) ...

            async def run_task() -> None:
                try:
                    async with track_run(
                        db,
                        run_id=run_id,
                        conversation_id=convo.id,
                        channel=WEB_CHANNEL,
                        model=model,
                        metrics=metrics,
                    ):
                        await run_agent(
                            upstream=persona_upstream,  # <-- was: upstream
                            db=db,
                            conversation_id=convo.id,
                            system_prompt=persona_ctx.system_prompt,  # <-- was: await get_effective_system_prompt(...)
                            model=model,
                            tools=tools,
                            on_chunk=on_chunk,
                            on_reasoning=on_reasoning,
                            on_tool_call=on_tool_call,
                            on_tool_result=on_tool_result,
                            on_approval=on_approval,
                            cancel_event=cancel_event,
                            metrics=metrics,
                        )
                finally:
                    await queue.put(None)

            # ... rest of gen() unchanged ...
        finally:
            # Close the ephemeral upstream when the stream ends.
            await persona_upstream.aclose()

    return StreamingResponse(gen(), media_type="text/event-stream", headers=response_headers)
```

Key changes: `persona_upstream` instead of `upstream`, `persona_ctx.system_prompt` instead of `await get_effective_system_prompt(...)`, `model` from `persona_ctx.model`.

Move the `await persona_upstream.aclose()` to a `finally` block that wraps the entire `gen()` body, so it closes even if an exception propagates mid-stream.

**Step 3: Update scheduler.py**

In `src/hermes/scheduler.py`:

Change imports:
```python
from hermes.personas import resolve_persona_context
from hermes.upstream import build_client_for_credential
from hermes.config import settings
```

Remove:
```python
from hermes.personas import get_effective_system_prompt
from hermes.repository import llm_credentials as llm_credentials_repo
```

In the task-firing method (around line 162), replace:
```python
model = (
    await llm_credentials_repo.get_active_model(self.db)
) or self._fallback_model
```

With:
```python
persona_ctx = await resolve_persona_context(TASK_CHANNEL, self.db)
model = persona_ctx.model
task_upstream = build_client_for_credential(
    persona_ctx.credential,
    encryptor=self._encryptor,
    fallback_proxy_url=self._fallback_proxy_url,
)
```

And in the `run_agent` call:
```python
result = await self._agent_runner(
    upstream=task_upstream,  # was: self._upstream_provider()
    db=self.db,
    conversation_id=convo.id,
    system_prompt=persona_ctx.system_prompt,  # was: await get_effective_system_prompt(...)
    model=model,
    tools=self._tool_factory(),
    metrics=metrics,
)
```

After the run, close `task_upstream`:
```python
finally:
    await task_upstream.aclose()
    # ... existing finally logic ...
```

The `AgentTaskScheduler.__init__` needs two new params instead of `upstream_provider`:
- `encryptor: Encryptor` — for decrypting API keys
- `fallback_proxy_url: str` — for Anthropic proxy path

Update `main.py` to pass these when constructing the scheduler:
```python
app.state.scheduler = AgentTaskScheduler(
    app.state.db,
    encryptor=app.state.encryptor,
    fallback_proxy_url=settings.llm_url,
    tool_factory=...,
    fallback_model=settings.model,
)
```

Remove the `upstream_provider` lambda from the constructor call.

**Step 4: Run full test suite**

```bash
cd /home/haex/Projekte/Holzi
pytest tests/ -x -q 2>&1 | tail -5
```

Expected: all tests pass. Fix any import errors or signature mismatches.

**Step 5: Commit**

```bash
cd /home/haex/Projekte/Holzi
git add src/hermes/routes/api.py src/hermes/scheduler.py src/hermes/main.py
git commit -m "feat(chat): run_agent uses PersonaContext credential + model (Plan 29-D Task 6)"
```

---

### Task 7 — Backend i18n: add error translations (DE + EN)

**Repo:** frontend (i18n strings live in the FE even for BE-emitted errors)

**Files:**
- Modify: `i18n/locales/de.json`
- Modify: `i18n/locales/en.json`
- Modify: `tests/i18n/error-codes.test.ts` (auto-pinned by the coverage test)

**Context:**
The i18n error coverage test at `tests/i18n/error-codes.test.ts` parses `hermes/errors.py` and checks that every `ErrorCode` has a translation in both locale files. Three new codes were added in Task 3: `PERSONA_NO_CREDENTIAL`, `PERSONA_INVALID_CREDENTIAL`, `PERSONA_INVALID_MODEL`.

**Step 1: Add German translations**

In `i18n/locales/de.json`, find the `PERSONA_*` block (around line 538) and add:

```json
"PERSONA_NO_CREDENTIAL": "Keine LLM-Credential konfiguriert. Bitte füge unter Einstellungen → LLM einen API-Key hinzu.",
"PERSONA_INVALID_CREDENTIAL": "Credential {id} existiert nicht.",
"PERSONA_INVALID_MODEL": "Modell '{model}' ist für diese Credential nicht verfügbar.",
```

**Step 2: Add English translations**

In `i18n/locales/en.json`, find the `PERSONA_*` block and add:

```json
"PERSONA_NO_CREDENTIAL": "No LLM credential configured. Add an API key under Settings → LLM.",
"PERSONA_INVALID_CREDENTIAL": "Credential {id} does not exist.",
"PERSONA_INVALID_MODEL": "Model '{model}' is not available for this credential.",
```

**Step 3: Run the i18n coverage test**

```bash
cd /home/haex/Projekte/holzi-frontend
pnpm test -- tests/i18n/error-codes.test.ts
```

Expected: PASS (all error codes covered).

**Step 4: Commit**

```bash
cd /home/haex/Projekte/holzi-frontend
git add i18n/locales/de.json i18n/locales/en.json
git commit -m "feat(i18n): translations for PERSONA_NO_CREDENTIAL + INVALID_CREDENTIAL + INVALID_MODEL (Plan 29-D Task 7)"
```

---

### Task 8 — Frontend: pnpm run gen:api

**Repo:** frontend

**Files:**
- Modify: `app/types/api-generated.ts` (auto-generated)
- Modify: `app/types/api.ts` (manual type aliases — check if Persona type needs updating)

**Context:**
`pnpm run gen:api` regenerates `app/types/api-generated.ts` from the backend's OpenAPI schema. After Tasks 1-6, `PersonaResponse` has two new fields (`llm_credential_id`, `model`) and a new endpoint `GET /api/personas/{id}/models`. The backend must be running on the expected port.

The memory note says the gen:api command needs specific env vars:
- Backend at: check `/home/haex/Projekte/holzi-frontend/package.json` for the exact env+port

**Step 1: Check gen:api configuration**

```bash
cat /home/haex/Projekte/holzi-frontend/package.json | grep gen
```

Run gen:api per the memory note at [reference_gen_api_command.md](../memory/reference_gen_api_command.md).

**Step 2: Run gen:api**

```bash
cd /home/haex/Projekte/holzi-frontend
HERMES_API_URL=http://localhost:<PORT> pnpm run gen:api
```

(Replace `<PORT>` with the actual port from the memory reference.)

**Step 3: Verify new fields in generated types**

```bash
grep -n "llm_credential_id\|PERSONA_NO_CREDENTIAL\|personas.*models" app/types/api-generated.ts | head -10
```

Expected: `llm_credential_id` and `model` appear in the `PersonaResponse` schema.

**Step 4: Check app/types/api.ts for necessary updates**

The `Persona` type alias at `app/types/api.ts:113` maps to `components['schemas']['PersonaResponse']`. Since the Pydantic model now has `llm_credential_id` and `model` with defaults, they'll appear in the generated schema. No manual change needed if the generated type includes them.

**Step 5: Commit**

```bash
cd /home/haex/Projekte/holzi-frontend
git add app/types/api-generated.ts app/types/api.ts
git commit -m "feat(api-types): regenerate against PersonaResponse with llm_credential_id + model (Plan 29-D Task 8)"
```

---

### Task 9 — Frontend: usePersonas.ts + useLlmCredentials helper

**Repo:** frontend

**Files:**
- Modify: `app/composables/usePersonas.ts`

**Context:**
`usePersonas.ts` already has `list`, `create`, `update`, `delete`, `history`, `restoreHistory`. Add `listModels(personaId)` that calls `GET /api/personas/{id}/models`.

Also update the `update` call signature type — `PersonaUpdate` now has `llm_credential_id` and `model` fields (from gen:api). This should "just work" since it maps to the generated type.

**Step 1: Add listModels to usePersonas.ts**

```typescript
listModels: (id: number) =>
  api.get<LlmModelListResponse>(`/api/personas/${id}/models`),
```

Add the `LlmModelListResponse` import:
```typescript
import type {
  LlmModelListResponse,
  Persona,
  PersonaCreate,
  PersonaHistoryListResponse,
  PersonaListResponse,
  PersonaUpdate,
} from '~/types/api'
```

(`LlmModelListResponse` is already defined in `app/types/api.ts` from the existing `useLlmCredentials` infrastructure.)

**Step 2: Run typecheck**

```bash
cd /home/haex/Projekte/holzi-frontend
pnpm typecheck
```

Expected: no new type errors.

**Step 3: Commit**

```bash
cd /home/haex/Projekte/holzi-frontend
git add app/composables/usePersonas.ts
git commit -m "feat(composables): usePersonas.listModels (Plan 29-D Task 9)"
```

---

### Task 10 — Frontend: credential + model dropdowns in Preferences page

**Repo:** frontend

**Files:**
- Modify: `app/pages/settings/preferences.vue`

**Context:**
The preferences page (984 lines) has per-persona cards with an inline editor. The editor currently shows `name`, `soul`, `identity`, `agents`, `is_default`. We need to add two more fields in the editor UI:
1. **Credential dropdown** (select from `GET /api/llm/credentials`)
2. **Model dropdown** (select from `GET /api/personas/{id}/models`, lazy-loaded when credential changes)

The credential list is loaded once on page mount. The model list is loaded per-persona when the credential dropdown changes.

**Step 1: Add credential list state**

Near the top of the `<script setup>`, after `const personas = ref<Persona[]>([])`:

```typescript
import type { LlmCredential } from '~/types/api'

const credentialsApi = useLlmCredentials()
const personasApi = usePersonas()

const credentials = ref<LlmCredential[]>([])

async function load() {
  loading.value = true
  error.value = null
  try {
    const [pers, chans, creds] = await Promise.all([
      personasApi.list(),
      channelsApi.list(),
      credentialsApi.list(),
    ])
    personas.value = pers.personas
    channels.value = chans.channels
    credentials.value = creds
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : t('pages.preferences.personas.errors.load')
  } finally {
    loading.value = false
  }
}
```

**Step 2: Add per-persona model state**

Add refs for the credential/model edit values (alongside existing `formSoul`, `formName` etc.):

```typescript
const formCredentialId = ref<number | null>(null)
const formModel = ref<string | null>(null)
const formModels = ref<{ id: string; label: string }[]>([])
const modelsLoading = ref(false)
```

**Step 3: Update startEdit to populate credential/model**

Find the `startEdit` function (or wherever `formName`, `formSoul` etc. are set when editing starts). Add:

```typescript
formCredentialId.value = p.llm_credential_id ?? null
formModel.value = p.model ?? null
// Load models for the persona's current credential
if (p.llm_credential_id !== null) {
  loadModelsForPersona(p.id)
}
```

**Step 4: Add loadModelsForPersona helper**

```typescript
async function loadModelsForPersona(personaId: number) {
  modelsLoading.value = true
  try {
    const resp = await personasApi.listModels(personaId)
    formModels.value = resp.models
  } catch {
    formModels.value = []
  } finally {
    modelsLoading.value = false
  }
}
```

**Step 5: Add onCredentialChange handler**

When the credential dropdown changes:

```typescript
async function onFormCredentialChange(personaId: number) {
  formModel.value = null  // reset model when credential changes
  if (formCredentialId.value !== null) {
    // We need models for the credential. Call the backend using the newly-set
    // credential value — but the persona doesn't have it persisted yet.
    // Solution: call GET /api/llm/credentials/{id}/models directly.
    modelsLoading.value = true
    try {
      const resp = await credentialsApi.listModels(formCredentialId.value)
      formModels.value = resp.models
    } catch {
      formModels.value = []
    } finally {
      modelsLoading.value = false
    }
  } else {
    formModels.value = []
  }
}
```

**Step 6: Include credential/model in save payload**

In the `savePersona` / `submitEdit` function, add to the `PersonaUpdate` body:

```typescript
const body: PersonaUpdate = {
  name: formName.value || undefined,
  soul: formSoul.value,
  identity: formIdentity.value,
  agents: formAgents.value,
  is_default: formIsDefault.value || undefined,
  llm_credential_id: formCredentialId.value,  // null = use global default
  model: formModel.value,                     // null = use credential default
}
```

**Step 7: Add dropdowns in template**

Inside the persona edit form (within `v-if="editing === p.id"`), after the `agents` textarea and before the submit buttons, add:

```html
<!-- Credential selection -->
<div class="form-group">
  <label :for="`cred-${p.id}`">{{ t('pages.preferences.personas.form.credential') }}</label>
  <select
    :id="`cred-${p.id}`"
    v-model="formCredentialId"
    @change="onFormCredentialChange(p.id)"
  >
    <option :value="null">{{ t('pages.preferences.personas.form.credentialGlobalOption') }}</option>
    <option v-for="cred in credentials" :key="cred.id" :value="cred.id">
      {{ cred.display_name }}
    </option>
  </select>
</div>

<!-- Model selection (disabled when no credential chosen) -->
<div class="form-group">
  <label :for="`model-${p.id}`">{{ t('pages.preferences.personas.form.model') }}</label>
  <select
    :id="`model-${p.id}`"
    v-model="formModel"
    :disabled="formCredentialId === null || modelsLoading"
  >
    <option :value="null">{{ t('pages.preferences.personas.form.modelDefaultOption') }}</option>
    <option v-for="m in formModels" :key="m.id" :value="m.id">{{ m.label }}</option>
  </select>
  <span v-if="formCredentialId === null" class="hint">
    {{ t('pages.preferences.personas.form.modelHintNoCredential') }}
  </span>
</div>
```

**Step 8: Add i18n keys**

In `i18n/locales/de.json` → `pages.preferences.personas.form`:

```json
"credential": "LLM-Credential",
"credentialGlobalOption": "— Globale Default-Credential —",
"model": "Modell",
"modelDefaultOption": "— Default-Modell der Credential —",
"modelHintNoCredential": "verwendet das Modell der aktiven Credential"
```

Same in `i18n/locales/en.json`:

```json
"credential": "LLM Credential",
"credentialGlobalOption": "— Global default credential —",
"model": "Model",
"modelDefaultOption": "— Credential's default model —",
"modelHintNoCredential": "uses the active credential's model"
```

**Step 9: Run typecheck**

```bash
cd /home/haex/Projekte/holzi-frontend
pnpm typecheck
```

Fix any type errors.

**Step 10: Run vitest suite**

```bash
cd /home/haex/Projekte/holzi-frontend
pnpm test 2>&1 | tail -10
```

Fix any failures in `PreferencesPage.test.ts` caused by the new `GET /api/llm/credentials` call in `load()`. The mock needs to handle the new path:

```typescript
function mockInitialLoad(
  personas: Persona[] = [defaultPersona],
  channels: ChannelPrompt[] = twoChannels,
  credentialsList: LlmCredential[] = [],
) {
  apiGet.mockImplementation((path: string) => {
    if (path === '/api/personas') return Promise.resolve({ personas })
    if (path === '/api/channels') return Promise.resolve({ channels })
    if (path === '/api/llm/credentials') return Promise.resolve(credentialsList)
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
}
```

**Step 11: Commit**

```bash
cd /home/haex/Projekte/holzi-frontend
git add app/pages/settings/preferences.vue i18n/locales/de.json i18n/locales/en.json
git commit -m "feat(preferences): credential + model dropdowns per persona (Plan 29-D Task 10)"
```

---

### Task 11 — Frontend tests: PreferencesPage credential + model coverage

**Repo:** frontend

**Files:**
- Modify: `tests/components/PreferencesPage.test.ts`

**Context:**
The existing test file mocks `useApi`. Three new behaviors to test:
1. Credential switch → model list reloaded
2. Model choice persists in the save payload
3. Reset (choose "global default" credential) → both `llm_credential_id` and `model` set to null in save

**Step 1: Write the 3 new tests**

Add to the existing `describe('settings/preferences.vue', ...)` block:

```typescript
it('credential dropdown triggers model list reload', async () => {
  const cred: LlmCredential = {
    id: 42, provider: 'openai', mode: 'api_key', display_name: 'My OpenAI',
    base_url: null, model: 'gpt-4o', is_active: true,
    api_key_iv: null, api_key_tag: null, api_key_data: null,
    oauth_status: null, oauth_authorized_at: null, oauth_iv: null, oauth_tag: null,
    oauth_data: null, created_at: 1_700_000_000, updated_at: 1_700_000_000,
  }
  mockInitialLoad([defaultPersona], twoChannels, [cred])
  apiGet.mockImplementation((path: string) => {
    if (path === '/api/personas') return Promise.resolve({ personas: [defaultPersona] })
    if (path === '/api/channels') return Promise.resolve({ channels: twoChannels })
    if (path === '/api/llm/credentials') return Promise.resolve([cred])
    if (path === '/api/llm/credentials/42/models') {
      return Promise.resolve({ models: [{ id: 'gpt-4o', label: 'GPT-4o' }] })
    }
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })

  const wrapper = mount(PreferencesPage)
  await vi.waitFor(() => expect(wrapper.find('[data-testid="persona-card-1"]').exists()).toBe(true))

  // Open edit form
  await wrapper.find('[data-testid="persona-edit-1"]').trigger('click')
  await vi.waitFor(() => expect(wrapper.find('[data-testid="cred-select-1"]').exists()).toBe(true))

  // Change credential
  const credSelect = wrapper.find('[data-testid="cred-select-1"]')
  await credSelect.setValue(42)
  await credSelect.trigger('change')

  await vi.waitFor(() => {
    expect(apiGet).toHaveBeenCalledWith('/api/llm/credentials/42/models', undefined)
  })
})

it('model choice is included in the save payload', async () => {
  const cred: LlmCredential = { /* ... */ id: 42, model: null /* ... */ }
  // ... setup ...
  apiPut.mockResolvedValue({ ...defaultPersona, llm_credential_id: 42, model: 'gpt-4o' })
  // ... open edit, set credential 42, set model 'gpt-4o', submit ...
  // verify apiPut was called with llm_credential_id: 42, model: 'gpt-4o'
})

it('resetting credential nulls model in save payload', async () => {
  const personaWithCred = persona({ id: 1, name: 'Hermes', is_default: true })
  // ... setup persona with llm_credential_id: 42 ...
  // Open edit → choose "global default" (null) credential → submit
  // verify apiPut was called with llm_credential_id: null, model: null
})
```

**Step 2: Run the new tests**

```bash
cd /home/haex/Projekte/holzi-frontend
pnpm test -- tests/components/PreferencesPage.test.ts
```

Fix failures until all tests pass.

**Step 3: Run full vitest suite**

```bash
cd /home/haex/Projekte/holzi-frontend
pnpm test 2>&1 | tail -5
```

**Step 4: Commit**

```bash
cd /home/haex/Projekte/holzi-frontend
git add tests/components/PreferencesPage.test.ts
git commit -m "test(preferences): credential + model dropdown coverage (Plan 29-D Task 11)"
```

---

### Task 12 — Verification + PR creation

**Verification commands:**

Backend:
```bash
cd /home/haex/Projekte/Holzi
pytest tests/ -q 2>&1 | tail -5
ruff check src/
mypy src/hermes/ --ignore-missing-imports
```

Frontend:
```bash
cd /home/haex/Projekte/holzi-frontend
pnpm typecheck
pnpm test 2>&1 | tail -5
```

Expected:
- All backend tests pass (≥ 911 pytest)
- All frontend tests pass (≥ 459 vitest)
- ruff + mypy clean
- pnpm typecheck exit 0

**Update plan status:**

In this file, change `Status: **Planned.**` to `Status: **In Progress.**` (and `**Done.**` after merge).

**Create PRs (squash-merge with haexhub-token):**

```bash
# Backend PR
cd /home/haex/Projekte/Holzi
git push -u origin wave-b1-persona-llm-model
gh pr create --title "feat(personas): Wave B1 — per-persona LLM credential + model (Plan 29-D)" \
  --body "$(cat <<'EOF'
## Summary
- Adds `llm_credential_id` + `model` columns to `personas` table
- `resolve_persona_context()` replaces `get_effective_system_prompt()` at call sites
- PUT `/api/personas/{id}` accepts + validates credential/model
- GET `/api/personas/{id}/models` for dropdown population
- Credential deletion nulls persona model (app-side cleanup)
- Ephemeral per-request upstream built from persona credential

## Test plan
- [ ] `pytest tests/ -q` passes
- [ ] `ruff check src/` clean
- [ ] `mypy src/hermes/` clean
- [ ] CodeRabbit review
EOF
)"
```

```bash
# Frontend PR
cd /home/haex/Projekte/holzi-frontend
git push -u origin wave-b1-persona-llm-model-fe
gh pr create --title "feat(preferences): Wave B1 — credential + model dropdowns per persona (Plan 29-D)" \
  --body "$(cat <<'EOF'
## Summary
- Regenerated API types with new PersonaResponse fields
- usePersonas.listModels() composable
- Credential + model dropdowns in persona editor
- i18n for DE + EN

## Test plan
- [ ] `pnpm typecheck` exit 0
- [ ] `pnpm test` passes
- [ ] CodeRabbit review
EOF
)"
```

**Verification before merge:**
Run CodeRabbit on both PRs, fix valid findings, squash-merge via haexhub-token.

---

## Verification

After merge, the full cross-repo test suite must be green:
- Backend: `pytest tests/ -q` → all pass
- Frontend: `pnpm test` → all pass
- `ruff check src/` → clean
- `mypy src/hermes/ --ignore-missing-imports` → clean
- `pnpm typecheck` → exit 0

Change `Status: **Planned.**` to `Status: **Done.**` in this file.
