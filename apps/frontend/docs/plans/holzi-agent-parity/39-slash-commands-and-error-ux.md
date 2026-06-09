# Plan 39: Wave B2 — Slash-Command Picker + Explicit Error UX

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Done — BE merged PR #77 (2026-06-05), FE folded into Plan 40 #103, merged 2026-06-06 (squash `42cb7b6`; #101 closed as superseded)**

**Goal:** Ship two inter-related features: (1) per-turn model + persona overrides via `/model <name>` and `/persona <name>` composer commands + a header pill that shows the active persona/model and opens a picker; (2) replace the generic inline error string with a structured `ChatErrorCard` that shows the sanitised provider error, the real HTTP status code, and a contextual hint to try a different model.

**Architecture:**
- Overrides are one-turn-only in-memory state in `ChatHub.vue`; never persisted to DB. The backend receives `model_override` / `persona_id_override` on `POST /api/chat` and passes them into `resolve_persona_context`.
- `GET /api/chat/context` is a new lightweight endpoint that returns the currently-resolved `{persona_id, persona_name, model}` for the header pill to display.
- Error sanitisation happens in `_classify_chat_error` (backend): extracts `error.message` from the upstream JSON body, redacts known API-key patterns, truncates to 300 chars, and maps HTTP 429 to the new SSE code `upstream_rate_limited`.

**Tech Stack:** FastAPI, SQLite/SQLAlchemy, httpx (BE); Nuxt 3 / Vue 3 / Pinia / VueUse / reka-ui / @nuxtjs/i18n / Vitest (FE)

**Cross-repo workflow:** Backend first → pytest → `pnpm run gen:api` → frontend → vitest → Status/Verification in this file.

---

## Pre-flight hygiene

Before starting any task, run these in the frontend repo root:

```bash
# Sync local main with remote (PRs #98 + #99 are already merged)
git fetch origin
git checkout main
git reset --hard origin/main

# Remove any stale merged branches (optional, run `git branch --merged origin/main` to review first)
# git branch -d <branch>

# Create the implementation branch from clean origin/main
git checkout -b feat/wave-b2-slash-error-ux origin/main
```

The backend lives at `/home/haex/Projekte/Holzi`. Create a matching branch there:

```bash
cd /home/haex/Projekte/Holzi
git fetch origin
git checkout -b feat/wave-b2-slash-error-ux origin/main
```

---

## Part I — Backend (Holzi / hermes)

### Task 1: `upstream_rate_limited` SSE code + improved `_classify_chat_error`

**Files:**
- Modify: `src/hermes/routes/api.py` (function `_classify_chat_error`, ~line 110)
- Create: `tests/test_classify_chat_error.py`

**Context:** `_classify_chat_error` currently maps any `HTTPStatusError` to `("upstream_http_error", 502, "upstream returned N")`. We need to (a) distinguish 429 from 5xx with a new code `upstream_rate_limited`, (b) pass the real upstream status as `status_code` instead of always 502, and (c) extract a sanitised message from the provider JSON body.

**Step 1: Write the failing test**

Create `tests/test_classify_chat_error.py`:

```python
"""Unit tests for _classify_chat_error and _sanitize_upstream_message."""
import json
import pytest
import httpx

from hermes.routes.api import _classify_chat_error, _sanitize_upstream_message


def _make_status_error(status: int, body: bytes = b"") -> httpx.HTTPStatusError:
    req = httpx.Request("POST", "http://upstream/v1/chat/completions")
    resp = httpx.Response(status, content=body, request=req)
    return httpx.HTTPStatusError(f"HTTP {status}", request=req, response=resp)


def test_classify_429_returns_rate_limited_code():
    body = json.dumps({"error": {"message": "Rate limit exceeded", "type": "rate_limit_error"}}).encode()
    exc = _make_status_error(429, body)
    code, status_code, message = _classify_chat_error(exc)
    assert code == "upstream_rate_limited"
    assert status_code == 429
    assert "Rate limit exceeded" in message


def test_classify_503_returns_upstream_http_error():
    body = json.dumps({"error": {"message": "Service unavailable", "type": "overloaded_error"}}).encode()
    exc = _make_status_error(503, body)
    code, status_code, message = _classify_chat_error(exc)
    assert code == "upstream_http_error"
    assert status_code == 503
    assert "Service unavailable" in message


def test_classify_http_error_with_empty_body():
    exc = _make_status_error(500, b"")
    code, status_code, message = _classify_chat_error(exc)
    assert code == "upstream_http_error"
    assert status_code == 500
    assert "HTTP 500" in message


def test_sanitize_redacts_api_key_in_message():
    body = json.dumps({"error": {"message": "Invalid key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}}).encode()
    exc = _make_status_error(401, body)
    _, _, message = _classify_chat_error(exc)
    assert "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" not in message
    assert "[REDACTED]" in message


def test_sanitize_upstream_message_openai_shape():
    body = json.dumps({"error": {"message": "You exceeded your current quota", "type": "insufficient_quota"}}).encode()
    msg = _sanitize_upstream_message(body, 429)
    assert msg == "You exceeded your current quota"


def test_sanitize_upstream_message_non_json_falls_back():
    msg = _sanitize_upstream_message(b"<html>Bad Gateway</html>", 502)
    assert msg == "HTTP 502"


def test_sanitize_upstream_message_empty_body():
    msg = _sanitize_upstream_message(b"", 429)
    assert msg == "HTTP 429"


def test_classify_timeout():
    exc = httpx.TimeoutException("timed out")
    code, status_code, message = _classify_chat_error(exc)
    assert code == "upstream_timeout"
    assert status_code == 504


def test_classify_request_error():
    exc = httpx.ConnectError("connection refused")
    code, status_code, message = _classify_chat_error(exc)
    assert code == "upstream_unreachable"
    assert status_code == 502
```

**Step 2: Run to confirm failure**

```bash
cd /home/haex/Projekte/Holzi
pytest tests/test_classify_chat_error.py -v 2>&1 | head -30
```

Expected: `ImportError` or `AttributeError` — `_sanitize_upstream_message` doesn't exist yet.

**Step 3: Add `_sanitize_upstream_message` and update `_classify_chat_error` in `src/hermes/routes/api.py`**

First add `import re` to the stdlib import block at the top of the file (alongside `asyncio`, `json`, etc.).

Then add the helper and constant just above `_classify_chat_error`:

```python
_API_KEY_RE = re.compile(
    r"\b("
    r"sk-ant-[A-Za-z0-9_\-]{20,}"   # Anthropic
    r"|sk-[A-Za-z0-9]{20,}"          # OpenAI
    r"|gsk_[A-Za-z0-9]{20,}"         # Google AI Studio
    r"|AIza[A-Za-z0-9_\-]{35,}"      # Google
    r")\b"
    r"|Bearer [A-Za-z0-9_\-\.]{20,}" # Generic bearer
)


def _sanitize_upstream_message(body: bytes, status: int) -> str:
    """Extract a safe-to-display message from a provider error response body.

    Parses JSON, extracts .error.message or top-level .message, redacts
    known API key patterns, and truncates to 300 chars. Returns
    "HTTP <status>" on parse failure or empty body.
    """
    if not body:
        return f"HTTP {status}"
    try:
        data = json.loads(body)
    except (json.JSONDecodeError, ValueError):
        return f"HTTP {status}"
    msg = ""
    if isinstance(data.get("error"), dict):
        msg = str(data["error"].get("message", ""))
    if not msg:
        msg = str(data.get("message", ""))
    if not msg:
        return f"HTTP {status}"
    msg = _API_KEY_RE.sub("[REDACTED]", msg)
    return msg[:300]
```

Update `_classify_chat_error`:

```python
def _classify_chat_error(exc: BaseException) -> tuple[str, int, str]:
    """Map an agent-loop exception to (sse_code, status_code, message).

    status_code is the HTTP status the upstream actually returned (or the
    equivalent synthetic one for network errors). The frontend uses it to
    distinguish 429 (rate-limit) from 5xx (provider error) from 50x (our side).
    """
    if isinstance(exc, httpx.HTTPStatusError):
        upstream_status = exc.response.status_code
        body = exc.response.content  # populated for non-streaming raises
        message = _sanitize_upstream_message(body, upstream_status)
        if upstream_status == 429:
            return ("upstream_rate_limited", 429, message)
        return ("upstream_http_error", upstream_status, message)
    if isinstance(exc, httpx.TimeoutException):
        return ("upstream_timeout", 504, "upstream timed out")
    if isinstance(exc, httpx.RequestError):
        return (
            "upstream_unreachable",
            502,
            f"could not reach upstream: {exc}",
        )
    return ("agent_error", 500, str(exc))
```

**Step 4: Run tests to confirm they pass**

```bash
cd /home/haex/Projekte/Holzi
pytest tests/test_classify_chat_error.py -v
```

Expected: all 9 tests green.

**Step 5: Commit**

```bash
git add src/hermes/routes/api.py tests/test_classify_chat_error.py
git commit -m "feat(chat): upstream_rate_limited SSE code + sanitized error message"
```

---

### Task 2: `ChatRequest` model/persona overrides + `resolve_persona_context` update

**Files:**
- Modify: `src/hermes/routes/api.py` (class `ChatRequest`, function `_stream_web_agent_run`)
- Modify: `src/hermes/personas.py` (function `resolve_persona_context`)
- Create: `tests/test_api_chat_overrides.py`

**Context:** The frontend will pass optional `model_override: str` and `persona_id_override: int` on `POST /api/chat`. The backend should use these as one-turn overrides — the model/persona is NOT persisted. The `agent_runs` row logs the _effective_ model (the override, not the persona default).

**Step 1: Write the failing test**

Create `tests/test_api_chat_overrides.py`:

```python
"""Tests for per-turn model + persona overrides on POST /api/chat."""
import json
import httpx
import pytest
from asgi_lifespan import LifespanManager
from hermes.main import app

VALID_TOKEN = "test-token-for-pytest"
AUTH = {"Authorization": f"Bearer {VALID_TOKEN}"}


def _sse_done_stream() -> bytes:
    """Minimal SSE stream: session + run + one text chunk + done."""
    chunks = [
        b'event: session\ndata: {"event":"session","version":1,"data":{"conversation_id":1}}\n\n',
        b'event: run\ndata: {"event":"run","version":1,"data":{"run_id":"r1"}}\n\n',
        b'event: text\ndata: {"event":"text","version":1,"data":{"content":"ok"}}\n\n',
        b'data: [DONE]\n\n',
        b'event: done\ndata: {"event":"done","version":1,"data":{}}\n\n',
    ]
    return b"".join(chunks)


@pytest.fixture
async def client():
    async with (
        LifespanManager(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as c,
    ):
        yield c


@pytest.fixture(autouse=True)
def _mock_upstream(monkeypatch):
    """Intercept upstream calls and return a canned SSE stream."""
    seen_bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_bodies.append(json.loads(request.content))
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            stream=httpx.ByteStream(_sse_done_stream()),
        )

    app.state.upstream = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="http://fake-upstream",
    )
    yield seen_bodies
    # credential fixture restores upstream in test teardown via LifespanManager


async def test_chat_request_accepts_model_override(client, _mock_upstream):
    resp = await client.post(
        "/api/chat",
        headers=AUTH,
        json={"message": "hello", "model_override": "claude-opus-4-7"},
    )
    # Stream consumes without error (2xx headers delivered)
    assert resp.status_code == 200


async def test_chat_request_accepts_persona_id_override(client, _mock_upstream):
    # persona_id=1 should exist (the default "Hermes" persona seeded at lifespan)
    resp = await client.post(
        "/api/chat",
        headers=AUTH,
        json={"message": "hello", "persona_id_override": 1},
    )
    assert resp.status_code == 200


async def test_chat_request_rejects_unknown_persona_id(client, _mock_upstream):
    resp = await client.post(
        "/api/chat",
        headers=AUTH,
        json={"message": "hello", "persona_id_override": 999999},
    )
    assert resp.status_code == 404
```

**Step 2: Run to confirm failure**

```bash
cd /home/haex/Projekte/Holzi
pytest tests/test_api_chat_overrides.py -v 2>&1 | head -20
```

Expected: `422 Unprocessable Entity` for the unknown field (Pydantic rejects `model_override`).

**Step 3: Update `ChatRequest` and `_stream_web_agent_run` in `src/hermes/routes/api.py`**

In `ChatRequest`:
```python
class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    conversation_id: int | None = None
    attachment_ids: list[int] = Field(default_factory=list)
    # One-turn overrides. Not persisted. Cleared after the agent run.
    model_override: str | None = Field(default=None, min_length=1)
    persona_id_override: int | None = Field(default=None, ge=1)
```

In `api_chat`, pass the overrides to `_stream_web_agent_run`. Change the call from:
```python
return await _stream_web_agent_run(request, convo)
```
to:
```python
return await _stream_web_agent_run(
    request,
    convo,
    model_override=payload.model_override,
    persona_id_override=payload.persona_id_override,
)
```

Update `_stream_web_agent_run` signature and `resolve_persona_context` call:
```python
async def _stream_web_agent_run(
    request: Request,
    convo: Any,
    *,
    model_override: str | None = None,
    persona_id_override: int | None = None,
) -> Response:
    ...
    persona_ctx = await resolve_persona_context(
        WEB_CHANNEL,
        db,
        model_override=model_override,
        persona_id_override=persona_id_override,
    )
```

**Step 4: Update `resolve_persona_context` in `src/hermes/personas.py`**

```python
async def resolve_persona_context(
    channel: str,
    engine: AsyncEngine,
    *,
    model_override: str | None = None,
    persona_id_override: int | None = None,
) -> PersonaContext:
    """Extend get_effective_system_prompt with credential + model resolution.

    Override resolution order (one-turn; not persisted):
    - persona_id_override: skips channel default persona lookup, uses this ID.
      Raises HTTPException(404, PERSONA_NOT_FOUND) if the ID doesn't exist.
    - model_override: supersedes persona.model / credential.model / settings.model.
    """
    from fastapi import HTTPException
    from hermes.config import settings

    # Resolve persona (with optional one-turn override)
    if persona_id_override is not None:
        override_persona = await personas_repo.get(engine, persona_id_override)
        if override_persona is None:
            raise HTTPException(
                status_code=404, detail=ErrorCode.PERSONA_NOT_FOUND.value
            )
        # Build system prompt using the override persona but still with the
        # channel prompt (channel prompt = format/tone layer, not identity).
        # We call get_effective_system_prompt with the channel and then
        # re-compose because get_effective_system_prompt doesn't accept a
        # persona override — simplest path is to call the normal resolver and
        # substitute the persona in the credential chain below.
        system_prompt = await _get_system_prompt_for_persona(
            channel, engine, persona=override_persona
        )
        persona = override_persona
    else:
        system_prompt = await get_effective_system_prompt(channel, engine)
        row = await channels_repo.get(engine, channel)
        persona_id: int | None = None if row is None else row.default_persona_id
        persona = None
        if persona_id is not None:
            persona = await personas_repo.get(engine, persona_id)
        if persona is None:
            persona = await personas_repo.get_default(engine)

    # Credential resolution (unchanged)
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

    # Model resolution (override wins)
    model: str = model_override or (
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

Add the helper `_get_system_prompt_for_persona` just above `resolve_persona_context`:

```python
async def _get_system_prompt_for_persona(
    channel: str, engine: AsyncEngine, *, persona: Persona
) -> str:
    """Build a system prompt using the given persona instead of the channel default.

    Used when `persona_id_override` is set on a chat request — the system
    prompt structure is identical to `get_effective_system_prompt` except
    the persona is supplied directly rather than resolved from the channel row.
    """
    if channel not in CHANNEL_REGISTRY:
        raise KeyError(f"unknown channel: {channel}")

    row = await channels_repo.get(engine, channel)
    channel_prompt = (row.prompt if row is not None else CHANNEL_REGISTRY[channel]["default_prompt"])

    enabled_skills = await skills_repo.list_enabled(engine)
    catalog = _catalog_index(enabled_skills)
    index = capabilities.load_capability_index()

    parts: list[str] = []
    persona_parts: list[str] = []
    for header, body in _persona_sections(persona):
        body = body.strip()
        if body:
            persona_parts.append(f"{header}\n{body}")
    if persona_parts:
        parts.append("\n\n".join(persona_parts))
    if catalog:
        parts.append(catalog)
    if index:
        parts.append(index)
    parts.append(channel_prompt)

    bootstrap_done = await users_mod.is_bootstrap_completed(engine)
    bootstrap_loadable = any(s.slug == "bootstrap-first-chat" for s in enabled_skills)
    if not bootstrap_done and bootstrap_loadable:
        parts.append(_BOOTSTRAP_HINT)

    return "\n\n".join(parts)
```

**Step 5: Run tests**

```bash
cd /home/haex/Projekte/Holzi
pytest tests/test_api_chat_overrides.py -v
```

Expected: all 3 tests pass.

**Step 6: Run full test suite to check for regressions**

```bash
cd /home/haex/Projekte/Holzi
pytest --tb=short -q 2>&1 | tail -10
```

Expected: same or better pass count as before (baseline: ~904 pytest).

**Step 7: Commit**

```bash
git add src/hermes/personas.py src/hermes/routes/api.py tests/test_api_chat_overrides.py
git commit -m "feat(chat): model_override + persona_id_override on POST /api/chat"
```

---

### Task 3: `GET /api/chat/context` endpoint

**Files:**
- Modify: `src/hermes/routes/api.py` (new endpoint + schema)
- Create: `tests/test_api_chat_context.py`

**Context:** The frontend header pill needs to display the currently-resolved persona name and model without building the full system prompt on every poll. This lightweight endpoint resolves persona + credential + model (3–4 DB queries) and returns the metadata only.

**Step 1: Write the failing test**

Create `tests/test_api_chat_context.py`:

```python
"""Tests for GET /api/chat/context."""
import httpx
import pytest
from asgi_lifespan import LifespanManager
from hermes.main import app

VALID_TOKEN = "test-token-for-pytest"
AUTH = {"Authorization": f"Bearer {VALID_TOKEN}"}


@pytest.fixture
async def client():
    async with (
        LifespanManager(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as c,
    ):
        yield c


async def test_chat_context_requires_auth(client: httpx.AsyncClient) -> None:
    resp = await client.get("/api/chat/context")
    assert resp.status_code == 401


async def test_chat_context_returns_persona_and_model(client: httpx.AsyncClient) -> None:
    """After lifespan boot the default 'Hermes' persona + configured model are visible."""
    resp = await client.get("/api/chat/context", headers=AUTH)
    assert resp.status_code == 200
    data = resp.json()
    assert "persona_name" in data
    assert "model" in data
    assert isinstance(data["model"], str)
    assert data["model"]  # non-empty
    assert data["persona_name"] == "Hermes"  # default seed persona
```

**Step 2: Run to confirm failure**

```bash
cd /home/haex/Projekte/Holzi
pytest tests/test_api_chat_context.py -v 2>&1 | head -15
```

Expected: 404 — the endpoint doesn't exist yet.

**Step 3: Add the schema + endpoint to `src/hermes/routes/api.py`**

Add the Pydantic model near the other response models:

```python
class ChatContextResponse(BaseModel):
    """Lightweight metadata about the currently-resolved persona + model.

    Used by the chat header pill to display the active agent identity.
    Does NOT include the system_prompt (large; computed per-turn only).
    """
    persona_id: int | None
    persona_name: str | None
    model: str
```

Add the endpoint after the `/api/chat/runs/{run_id}/cancel` route:

```python
@router.get("/chat/context")
async def api_chat_context(request: Request) -> ChatContextResponse:
    """Return the currently-resolved persona name + model for the web channel.

    Resolves persona → credential → model using the same priority chain as
    POST /api/chat but skips the (expensive) system-prompt build. Suitable
    for polling from the header pill. Returns 503 if no credential is
    configured (same condition that would block a real chat turn).
    """
    db: AsyncEngine = request.app.state.db
    from hermes.personas import resolve_chat_context_meta

    persona_id, persona_name, model = await resolve_chat_context_meta(
        WEB_CHANNEL, db
    )
    return ChatContextResponse(
        persona_id=persona_id,
        persona_name=persona_name,
        model=model,
    )
```

**Step 4: Add `resolve_chat_context_meta` to `src/hermes/personas.py`**

```python
async def resolve_chat_context_meta(
    channel: str,
    engine: AsyncEngine,
) -> tuple[int | None, str | None, str]:
    """Resolve persona_id + persona_name + model without building system_prompt.

    Used by GET /api/chat/context. Three to four DB reads — significantly
    cheaper than `resolve_persona_context` which also runs skill-catalog +
    capability-index assembly.
    """
    from fastapi import HTTPException
    from hermes.config import settings

    row = await channels_repo.get(engine, channel)
    persona_id: int | None = None if row is None else row.default_persona_id
    persona = None
    if persona_id is not None:
        persona = await personas_repo.get(engine, persona_id)
    if persona is None:
        persona = await personas_repo.get_default(engine)

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

    model: str = (
        (persona.model if persona is not None else None)
        or credential.model
        or settings.model
    )

    return (
        persona.id if persona else None,
        persona.name if persona else None,
        model,
    )
```

**Step 5: Run tests**

```bash
cd /home/haex/Projekte/Holzi
pytest tests/test_api_chat_context.py -v
```

Expected: 2 tests pass.

**Step 6: Full pytest**

```bash
cd /home/haex/Projekte/Holzi
pytest --tb=short -q 2>&1 | tail -10
```

**Step 7: Commit**

```bash
git add src/hermes/personas.py src/hermes/routes/api.py tests/test_api_chat_context.py
git commit -m "feat(chat): GET /api/chat/context — persona name + model for header pill"
```

---

### Task 4: Backend PR + CodeRabbit

Push the backend branch and open a PR:

```bash
cd /home/haex/Projekte/Holzi
git push -u origin feat/wave-b2-slash-error-ux
gh pr create \
  --title "feat(chat): Wave B2 — error sanitisation + chat overrides + /api/chat/context" \
  --body "$(cat <<'EOF'
## Summary
- `upstream_rate_limited` SSE code for HTTP 429; sanitised provider error body in `message`
- `model_override` + `persona_id_override` on `POST /api/chat` (one-turn, not persisted)
- `GET /api/chat/context` returns resolved persona name + model for the FE header pill
- Adds `_sanitize_upstream_message` + `resolve_chat_context_meta`

## Test plan
- [ ] `pytest tests/test_classify_chat_error.py` all green
- [ ] `pytest tests/test_api_chat_overrides.py` all green
- [ ] `pytest tests/test_api_chat_context.py` all green
- [ ] Full `pytest --tb=short -q` ≥ previous pass count
EOF
)"
```

Wait for CodeRabbit. Address any findings, then merge.

---

## Part II — Frontend (holzi-frontend)

### Task 5: `pnpm run gen:api`

After the backend PR is merged (or while it's in review if you have the BE running locally):

```bash
cd /home/haex/Projekte/holzi-frontend
# Follow memory reference_gen_api_command.md for the exact env + port
pnpm run gen:api
```

Verify `app/types/api-generated.ts` gained:
- `ChatContextResponse` schema component
- `model_override` + `persona_id_override` on the `/api/chat` POST request body

**Commit:**
```bash
git add app/types/api-generated.ts
git commit -m "chore: regenerate API types for Wave B2 BE changes"
```

---

### Task 6: i18n strings for error card + slash command UI

**Files:**
- Modify: `i18n/locales/de.json`
- Modify: `i18n/locales/en.json`

**Step 1: Add German strings to `de.json`**

Under the existing `errors.chat` key, add `upstream_rate_limited` and extend the existing entries to include `hint` lines:

```json
"chat": {
  "upstream_unreachable": "LLM-Provider nicht erreichbar. Prüfe deine Credentials in den Einstellungen.",
  "upstream_timeout": "LLM-Provider hat zu lange gebraucht. Versuch es nochmal.",
  "upstream_http_error": "LLM-Provider hat einen Fehler gemeldet{statusSuffix}.",
  "upstream_rate_limited": "Anfrage-Limit beim Provider erreicht (429 Too Many Requests).",
  "agent_error": "Interner Fehler: {message}",
  "unauthorized": "Session abgelaufen — bitte neu einloggen.",
  "request_failed": "Chat-Request fehlgeschlagen{statusSuffix}.",
  "unknown": "Chat-Fehler.",
  "hintModelSwitch": "Versuch's mit einem anderen Modell:",
  "hintModelSwitchCommand": "/model <modell-name> im Chat",
  "hintModelSwitchLink": "Modell in den Einstellungen wählen"
}
```

Add the header pill + slash command strings under `components.chatHub` (at the end of that section):

```json
"contextPill": {
  "aria": "Aktive Persona und Modell",
  "overrideActive": "Override aktiv — gilt für den nächsten Turn",
  "clearOverride": "Override zurücksetzen",
  "personaLabel": "Persona",
  "modelLabel": "Modell",
  "apply": "Anwenden"
}
```

**Step 2: Add English strings to `en.json`**

Same structure, English text:

```json
"chat": {
  "upstream_unreachable": "LLM provider not reachable. Check your credentials in Settings.",
  "upstream_timeout": "LLM provider took too long to respond. Try again.",
  "upstream_http_error": "LLM provider returned an error{statusSuffix}.",
  "upstream_rate_limited": "Request limit reached at the provider (429 Too Many Requests).",
  "agent_error": "Internal error: {message}",
  "unauthorized": "Session expired — please log in again.",
  "request_failed": "Chat request failed{statusSuffix}.",
  "unknown": "Chat error.",
  "hintModelSwitch": "Try a different model:",
  "hintModelSwitchCommand": "/model <model-name> in chat",
  "hintModelSwitchLink": "Choose model in Settings"
}
```

```json
"contextPill": {
  "aria": "Active persona and model",
  "overrideActive": "Override active — applies to next turn only",
  "clearOverride": "Clear override",
  "personaLabel": "Persona",
  "modelLabel": "Model",
  "apply": "Apply"
}
```

**Step 3: Verify i18n coverage test still passes**

```bash
cd /home/haex/Projekte/holzi-frontend
pnpm run test --run tests/i18n/ 2>&1 | tail -15
```

Expected: all i18n tests pass (no missing keys between DE and EN).

**Step 4: Commit**

```bash
git add i18n/locales/de.json i18n/locales/en.json
git commit -m "feat(i18n): error card + context pill strings (de + en)"
```

---

### Task 7: `ChatErrorCard.vue` component

**Files:**
- Create: `app/components/chat/ErrorCard.vue`
- Create: `tests/components/ChatErrorCard.test.ts`

**Context:** Replaces the inline `<div v-if="error">` in `ChatHub.vue` with a richer card that shows a heading based on error type, the (sanitised) provider message for upstream errors, and a contextual hint to try a different model for provider errors.

**Step 1: Write the failing test**

Create `tests/components/ChatErrorCard.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...orig,
    useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => {
      if (params) return `${key}(${JSON.stringify(params)})`
      return key
    }}),
  }
})

vi.mock('#imports', () => ({
  useLocalePath: () => (path: string) => path,
  navigateTo: vi.fn(),
}))

import ChatErrorCard from '~/components/chat/ErrorCard.vue'
import { ChatStreamError } from '~/composables/useChatStream'

describe('ChatErrorCard.vue', () => {
  it('renders the error code i18n key as heading', () => {
    const err = new ChatStreamError('Rate limit exceeded', {
      code: 'upstream_rate_limited',
      statusCode: 429,
    })
    const wrapper = mount(ChatErrorCard, { props: { error: err } })
    expect(wrapper.text()).toContain('errors.chat.upstream_rate_limited')
  })

  it('shows model-switch hint for upstream provider errors', () => {
    const err = new ChatStreamError('overloaded', {
      code: 'upstream_http_error',
      statusCode: 503,
    })
    const wrapper = mount(ChatErrorCard, { props: { error: err } })
    expect(wrapper.text()).toContain('errors.chat.hintModelSwitch')
  })

  it('shows model-switch hint for rate-limited errors', () => {
    const err = new ChatStreamError('rate limited', {
      code: 'upstream_rate_limited',
      statusCode: 429,
    })
    const wrapper = mount(ChatErrorCard, { props: { error: err } })
    expect(wrapper.text()).toContain('errors.chat.hintModelSwitch')
  })

  it('shows model-switch hint for timeout errors', () => {
    const err = new ChatStreamError('timeout', { code: 'upstream_timeout', statusCode: 504 })
    const wrapper = mount(ChatErrorCard, { props: { error: err } })
    expect(wrapper.text()).toContain('errors.chat.hintModelSwitch')
  })

  it('does NOT show model-switch hint for agent_error', () => {
    const err = new ChatStreamError('something broke', { code: 'agent_error', statusCode: 500 })
    const wrapper = mount(ChatErrorCard, { props: { error: err } })
    expect(wrapper.text()).not.toContain('errors.chat.hintModelSwitch')
  })

  it('does NOT show model-switch hint for unreachable errors', () => {
    const err = new ChatStreamError('connection refused', { code: 'upstream_unreachable', statusCode: 502 })
    const wrapper = mount(ChatErrorCard, { props: { error: err } })
    expect(wrapper.text()).not.toContain('errors.chat.hintModelSwitch')
  })

  it('emits dismiss when the close button is clicked', async () => {
    const err = new ChatStreamError('x', { code: 'agent_error', statusCode: 500 })
    const wrapper = mount(ChatErrorCard, { props: { error: err } })
    const closeBtn = wrapper.find('[aria-label]')
    await closeBtn.trigger('click')
    expect(wrapper.emitted('dismiss')).toBeTruthy()
  })
})
```

**Step 2: Run to confirm failure**

```bash
cd /home/haex/Projekte/holzi-frontend
pnpm run test --run tests/components/ChatErrorCard.test.ts 2>&1 | head -20
```

Expected: module-not-found error for `~/components/chat/ErrorCard.vue`.

**Step 3: Create `app/components/chat/ErrorCard.vue`**

```vue
<script setup lang="ts">
import { AlertCircle, X } from 'lucide-vue-next'
import type { ChatStreamError } from '~/composables/useChatStream'

const props = defineProps<{
  error: ChatStreamError
}>()
const emit = defineEmits<{ dismiss: [] }>()
const { t } = useI18n({ useScope: 'global' })
const localePath = useLocalePath()

// Show the model-switch hint for provider-side errors where changing the
// model is the most actionable response. Not for network/auth errors.
const HINT_CODES = new Set([
  'upstream_rate_limited',
  'upstream_http_error',
  'upstream_timeout',
])

const showHint = computed(() => HINT_CODES.has(props.error.code))

const statusSuffix = computed(() =>
  props.error.statusCode ? ` (${props.error.statusCode})` : ''
)

const heading = computed(() =>
  t(`errors.chat.${props.error.code}`, {
    message: props.error.message,
    statusSuffix: statusSuffix.value,
  })
)
</script>

<template>
  <div
    role="alert"
    class="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
  >
    <AlertCircle class="mt-0.5 size-4 shrink-0" />
    <div class="flex-1 space-y-2">
      <p class="font-medium">{{ heading }}</p>
      <div v-if="showHint" class="text-xs text-destructive/80">
        <p>{{ t('errors.chat.hintModelSwitch') }}</p>
        <ul class="mt-1 list-disc pl-4 space-y-0.5">
          <li><code class="font-mono">{{ t('errors.chat.hintModelSwitchCommand') }}</code></li>
          <li>
            <NuxtLink
              :to="localePath('/settings/preferences')"
              class="underline underline-offset-2 hover:opacity-80"
            >
              {{ t('errors.chat.hintModelSwitchLink') }}
            </NuxtLink>
          </li>
        </ul>
      </div>
    </div>
    <button
      type="button"
      class="rounded p-0.5 text-destructive/70 hover:text-destructive"
      :aria-label="$t('common.close')"
      @click="emit('dismiss')"
    >
      <X class="size-3.5" />
    </button>
  </div>
</template>
```

**Step 4: Run tests**

```bash
cd /home/haex/Projekte/holzi-frontend
pnpm run test --run tests/components/ChatErrorCard.test.ts 2>&1 | tail -10
```

Expected: all 7 tests pass.

**Step 5: Commit**

```bash
git add app/components/chat/ErrorCard.vue tests/components/ChatErrorCard.test.ts
git commit -m "feat(chat): ChatErrorCard component with provider-error hint"
```

---

### Task 8: `ChatHub.vue` — use `ChatErrorCard` + structured error state

**Files:**
- Modify: `app/components/ChatHub.vue`

**Context:** Replace the generic `error: ref<string | null>` with a richer state: `streamError: ref<ChatStreamError | null>` for SSE errors and keep a separate `nonStreamError: ref<string | null>` for upload/cancel errors that don't have a structured code. Replace the inline `<div v-if="error">` with `<ChatErrorCard>`.

**Step 1: In `ChatHub.vue` script, update the error state refs**

Change:
```typescript
const error = ref<string | null>(null)
```
to:
```typescript
import type { ChatStreamError } from '~/composables/useChatStream'
// Structured error for SSE-stream failures (has code + statusCode for
// the error card hint logic). Separate from non-stream errors (upload,
// cancel, rename) which use a plain string toast or inline message.
const streamError = ref<ChatStreamError | null>(null)
const error = ref<string | null>(null)  // non-stream errors keep the string slot
```

**Step 2: Update `runStream` to set `streamError` instead of `error`**

In the `catch (err: unknown)` block of `runStream`:

Change:
```typescript
} catch (err: unknown) {
  outcome = 'failed'
  error.value = friendlyChatError(err, t)
}
```
to:
```typescript
} catch (err: unknown) {
  outcome = 'failed'
  if (err instanceof ChatStreamError) {
    streamError.value = err
  } else {
    error.value = friendlyChatError(err, t)
  }
}
```

Also clear `streamError` at the start of `runStream` (alongside `error.value = null`):
```typescript
streamError.value = null
error.value = null
```

**Step 3: Replace inline error div with `<ChatErrorCard>` in the template**

Find the existing error div in `<template>`:
```html
<div
  v-if="error"
  role="alert"
  class="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
>
  <AlertCircle class="mt-0.5 size-4 shrink-0" />
  <p class="flex-1">{{ error }}</p>
  <button
    type="button"
    class="rounded p-0.5 text-destructive/70 hover:text-destructive"
    :aria-label="$t('components.chatHub.aria.dismissError')"
    @click="error = null"
  >
    <X class="size-3.5" />
  </button>
</div>
```

Replace with:
```html
<!-- Structured provider/stream errors (code + hint). -->
<ChatErrorCard
  v-if="streamError"
  :error="streamError"
  @dismiss="streamError = null"
/>
<!-- Plain non-stream errors (upload failures, etc.). -->
<div
  v-if="error"
  role="alert"
  class="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
>
  <AlertCircle class="mt-0.5 size-4 shrink-0" />
  <p class="flex-1">{{ error }}</p>
  <button
    type="button"
    class="rounded p-0.5 text-destructive/70 hover:text-destructive"
    :aria-label="$t('components.chatHub.aria.dismissError')"
    @click="error = null"
  >
    <X class="size-3.5" />
  </button>
</div>
```

**Step 4: Run vitest to check for regressions**

```bash
cd /home/haex/Projekte/holzi-frontend
pnpm run test --run 2>&1 | tail -15
```

Expected: vitest passes at ≥ previous count (add/remove nothing for ChatHub directly — it's tested via integration, not unit tests currently).

**Step 5: Commit**

```bash
git add app/components/ChatHub.vue
git commit -m "feat(chat): use ChatErrorCard for structured stream errors"
```

---

### Task 9: Slash command parsing + one-turn override state in `ChatHub.vue`

**Files:**
- Modify: `app/components/ChatHub.vue`
- Modify: `app/composables/useChatStream.ts`

**Context:** When the user sends a message starting with `/model <name>` or `/persona <name>`, strip the command from the text, set a one-turn `nextTurnOverride` state, and pass the override to `sendChatMessage`. If the remaining text after stripping is empty (pure command with no message), set the override state and return without sending — the header pill will show the pending override.

**Step 1: Extend `sendChatMessage` in `useChatStream.ts`**

Extend the payload type:

```typescript
export async function sendChatMessage(
  payload: {
    message: string
    conversation_id?: number
    attachment_ids?: number[]
    model_override?: string       // one-turn; not persisted
    persona_id_override?: number  // one-turn; not persisted
  },
  callbacks: ChatStreamCallbacks = {},
): Promise<ChatStreamResult> {
  return postChatStream('/api/chat', payload, callbacks)
}
```

(No other changes needed — `postChatStream` already passes the full payload as JSON body.)

**Step 2: Add `parseSlashOverrides` utility to `ChatHub.vue` script**

Add before the component's reactive state declarations:

```typescript
interface SlashParseResult {
  cleanText: string
  modelOverride?: string
  personaName?: string  // resolved to personaId on the FE via personas list
}

function parseSlashOverrides(raw: string): SlashParseResult {
  let text = raw.trimStart()
  let modelOverride: string | undefined
  let personaName: string | undefined

  // /model <name> [optional rest of message]
  const modelRe = /^\/model\s+(\S+)([\s\S]*)$/
  const modelM = text.match(modelRe)
  if (modelM) {
    modelOverride = modelM[1]!.trim()
    text = (modelM[2] ?? '').trim()
  }

  // /persona <name> [optional rest of message]
  const personaRe = /^\/persona\s+(.+?)(?:\n|$)([\s\S]*)$/
  const personaM = text.match(personaRe)
  if (personaM) {
    personaName = personaM[1]!.trim()
    text = (personaM[2] ?? '').trim()
  }

  return { cleanText: text, modelOverride, personaName }
}
```

**Step 3: Add one-turn override state**

```typescript
// One-turn model/persona override. Set by /model or /persona slash commands
// or by the header pill picker. Cleared after the turn completes (or
// if the user explicitly clears it via the pill). personaId is null when
// the personas list hasn't loaded yet or no override is set.
const nextTurnOverride = ref<{ model?: string; personaId?: number } | null>(null)
```

You'll also need the personas list for resolving persona names to IDs:
```typescript
const { list: listPersonas } = usePersonas()
const personasList = ref<Persona[]>([])

async function loadPersonas() {
  try {
    const res = await listPersonas()
    personasList.value = res.personas
  } catch {
    // non-fatal: pill just won't resolve /persona <name>
  }
}
```

Call `loadPersonas()` in `onMounted` alongside `loadConversations()`.

**Step 4: Update `send()` to parse slash commands**

At the start of `send(payload: { text: string; files: File[] })`:

```typescript
// Parse slash overrides from the raw text. If only a command was typed
// (no actual message content), apply the override and return — no API call.
const parsed = parseSlashOverrides(payload.text)
if (parsed.modelOverride !== undefined) {
  nextTurnOverride.value = {
    ...nextTurnOverride.value,
    model: parsed.modelOverride,
  }
}
if (parsed.personaName !== undefined) {
  const match = personasList.value.find(
    (p) => p.name.toLowerCase() === parsed.personaName!.toLowerCase()
  )
  if (match) {
    nextTurnOverride.value = {
      ...nextTurnOverride.value,
      personaId: match.id,
    }
  }
}
const effectiveText = parsed.cleanText
if (!effectiveText && !payload.files.length) {
  // Pure slash command — override is set, no message to send.
  return
}
// Continue with effectiveText instead of raw payload.text
```

Replace uses of `text` / `payload.text` further down with `effectiveText`.

**Step 5: Pass override to `sendChatMessage`**

In the `runStream` call inside `send()`:

```typescript
await runStream((callbacks) =>
  sendChatMessage(
    {
      message: effectiveText,
      conversation_id: conversationId ?? undefined,
      attachment_ids: uploaded.map((a) => a.id),
      model_override: nextTurnOverride.value?.model,
      persona_id_override: nextTurnOverride.value?.personaId,
    },
    callbacks,
  ),
)
```

**Step 6: Clear override after turn finishes**

In the `finally` block of `runStream`, after clearing streaming state:
```typescript
nextTurnOverride.value = null
```

**Step 7: Run vitest + typecheck**

```bash
cd /home/haex/Projekte/holzi-frontend
pnpm run test --run 2>&1 | tail -10
pnpm typecheck 2>&1 | tail -10
```

Expected: all tests pass; typecheck exit 0.

**Step 8: Commit**

```bash
git add app/components/ChatHub.vue app/composables/useChatStream.ts
git commit -m "feat(chat): slash commands /model and /persona for one-turn overrides"
```

---

### Task 10: `ChatHeaderPill.vue` component

**Files:**
- Create: `app/components/chat/HeaderPill.vue`
- Create: `tests/components/ChatHeaderPill.test.ts`

**Context:** The header pill shows the currently-resolved persona name + model. When a one-turn override is active, it shows the override values with a highlighted badge. Clicking the pill opens a popover with: a persona picker (dropdown of all personas), a model override text field, and a clear-override button. Changes made in the popover set the `nextTurnOverride` state in `ChatHub.vue` and are exposed via `update:override` emit.

**Step 1: Write the failing test**

Create `tests/components/ChatHeaderPill.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...orig,
    useI18n: () => ({ t: (key: string) => key }),
  }
})

vi.mock('#imports', () => ({
  useLocalePath: () => (p: string) => p,
}))

import ChatHeaderPill from '~/components/chat/HeaderPill.vue'
import type { Persona } from '~/types/api'

const basePersona: Persona = {
  id: 1,
  name: 'Hermes',
  soul: '',
  identity: '',
  agents: '',
  is_default: true,
  llm_credential_id: null,
  model: null,
  created_at: 0,
  updated_at: 0,
}

describe('ChatHeaderPill.vue', () => {
  it('shows persona name and model from resolved context', () => {
    const wrapper = mount(ChatHeaderPill, {
      props: {
        personaName: 'Hermes',
        model: 'claude-opus-4-7',
        personas: [basePersona],
        override: null,
      },
    })
    expect(wrapper.text()).toContain('Hermes')
    expect(wrapper.text()).toContain('claude-opus-4-7')
  })

  it('shows override badge when override is active', () => {
    const wrapper = mount(ChatHeaderPill, {
      props: {
        personaName: 'Hermes',
        model: 'claude-opus-4-7',
        personas: [basePersona],
        override: { model: 'claude-sonnet-4-6' },
      },
    })
    expect(wrapper.text()).toContain('claude-sonnet-4-6')
    expect(wrapper.text()).toContain('components.chatHub.contextPill.overrideActive')
  })

  it('emits clear when the clear-override button is clicked', async () => {
    const wrapper = mount(ChatHeaderPill, {
      props: {
        personaName: 'Hermes',
        model: 'claude-opus-4-7',
        personas: [basePersona],
        override: { model: 'claude-sonnet-4-6' },
      },
    })
    const clearBtn = wrapper.find('[data-testid="clear-override"]')
    expect(clearBtn.exists()).toBe(true)
    await clearBtn.trigger('click')
    expect(wrapper.emitted('clear')).toBeTruthy()
  })
})
```

**Step 2: Run to confirm failure**

```bash
cd /home/haex/Projekte/holzi-frontend
pnpm run test --run tests/components/ChatHeaderPill.test.ts 2>&1 | head -15
```

**Step 3: Create `app/components/chat/HeaderPill.vue`**

```vue
<script setup lang="ts">
import { ChevronDown, X } from 'lucide-vue-next'
import {
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
} from 'reka-ui'
import type { Persona } from '~/types/api'

const props = defineProps<{
  personaName: string | null
  model: string
  personas: Persona[]
  override: { model?: string; personaId?: number } | null
}>()

const emit = defineEmits<{
  clear: []
  'update:override': [value: { model?: string; personaId?: number } | null]
}>()

const { t } = useI18n({ useScope: 'global' })
const open = ref(false)

// Local picker state
const pickerModel = ref('')
const pickerPersonaId = ref<number | undefined>(undefined)

function openPicker() {
  pickerModel.value = props.override?.model ?? ''
  pickerPersonaId.value = props.override?.personaId
  open.value = true
}

function applyPicker() {
  const next: { model?: string; personaId?: number } = {}
  if (pickerModel.value.trim()) next.model = pickerModel.value.trim()
  if (pickerPersonaId.value !== undefined) next.personaId = pickerPersonaId.value
  emit('update:override', Object.keys(next).length ? next : null)
  open.value = false
}

const displayPersonaName = computed(() => {
  if (props.override?.personaId != null) {
    return props.personas.find((p) => p.id === props.override!.personaId)?.name ?? props.personaName
  }
  return props.personaName
})

const displayModel = computed(() => props.override?.model ?? props.model)
const hasOverride = computed(() => !!props.override && Object.keys(props.override).length > 0)
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors hover:bg-muted"
        :class="hasOverride ? 'border-primary/50 bg-primary/10 text-primary' : 'text-muted-foreground'"
        :aria-label="t('components.chatHub.contextPill.aria')"
        :title="hasOverride ? t('components.chatHub.contextPill.overrideActive') : undefined"
        @click="openPicker"
      >
        <span class="max-w-[8rem] truncate">{{ displayPersonaName ?? '—' }}</span>
        <span class="opacity-40">·</span>
        <span class="max-w-[10rem] truncate font-mono">{{ displayModel }}</span>
        <ChevronDown class="size-3 opacity-60" />
      </button>
    </PopoverTrigger>

    <!-- Clear-override badge (only when override active) -->
    <button
      v-if="hasOverride"
      type="button"
      class="-ml-1 rounded-full p-0.5 text-primary/70 hover:text-primary"
      :aria-label="t('components.chatHub.contextPill.clearOverride')"
      data-testid="clear-override"
      @click.stop="emit('clear')"
    >
      <X class="size-3" />
    </button>

    <PopoverPortal>
      <PopoverContent
        :side-offset="8"
        class="z-50 w-72 rounded-lg border bg-popover p-4 shadow-md"
        align="end"
      >
        <div class="space-y-4">
          <!-- Persona picker -->
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-muted-foreground">
              {{ t('components.chatHub.contextPill.personaLabel') }}
            </label>
            <select
              v-model="pickerPersonaId"
              class="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
            >
              <option :value="undefined">— {{ t('components.chatHub.contextPill.personaLabel') }} —</option>
              <option v-for="p in personas" :key="p.id" :value="p.id">
                {{ p.name }}
              </option>
            </select>
          </div>

          <!-- Model override -->
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-muted-foreground">
              {{ t('components.chatHub.contextPill.modelLabel') }}
            </label>
            <input
              v-model="pickerModel"
              type="text"
              class="w-full rounded-md border bg-background px-3 py-1.5 text-sm font-mono placeholder:font-sans placeholder:text-muted-foreground"
              placeholder="e.g. claude-opus-4-8"
            />
          </div>

          <UiButton size="sm" class="w-full" @click="applyPicker">
            {{ t('components.chatHub.contextPill.apply') }}
          </UiButton>
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
```

**Step 4: Run tests**

```bash
cd /home/haex/Projekte/holzi-frontend
pnpm run test --run tests/components/ChatHeaderPill.test.ts 2>&1 | tail -10
```

Expected: all 3 tests pass.

**Step 5: Commit**

```bash
git add app/components/chat/HeaderPill.vue tests/components/ChatHeaderPill.test.ts
git commit -m "feat(chat): ChatHeaderPill — active persona + model with override picker"
```

---

### Task 11: Wire `ChatHeaderPill` into `ChatHub.vue`

**Files:**
- Modify: `app/components/ChatHub.vue`

**Context:** Load `GET /api/chat/context` on mount + after each turn to keep the pill current. Pass personas list and override state to the pill. Wire override updates from the pill into `nextTurnOverride`.

**Step 1: Add context loading to `ChatHub.vue`**

Add new reactive state:
```typescript
const chatContext = ref<{ personaName: string | null; model: string } | null>(null)

async function loadChatContext() {
  try {
    const ctx = await api.get<{ persona_id: number | null; persona_name: string | null; model: string }>('/api/chat/context')
    chatContext.value = { personaName: ctx.persona_name, model: ctx.model }
  } catch {
    // non-fatal: pill just shows '—' if context can't be loaded
  }
}
```

Call `loadChatContext()` in `onMounted` and at the end of the clean `outcome === 'done'` path in `runStream`.

**Step 2: Insert `ChatHeaderPill` in the header template**

In the `<header>` section of `ChatHub.vue`, between the `<h1>` and the right-side controls, insert:

```html
<ChatHeaderPill
  v-if="chatContext"
  :persona-name="chatContext.personaName"
  :model="chatContext.model"
  :personas="personasList"
  :override="nextTurnOverride"
  class="ml-2"
  @clear="nextTurnOverride = null"
  @update:override="nextTurnOverride = $event"
/>
```

**Step 3: Run typecheck + full vitest**

```bash
cd /home/haex/Projekte/holzi-frontend
pnpm typecheck 2>&1 | tail -10
pnpm run test --run 2>&1 | tail -15
```

Expected: typecheck exit 0; vitest ≥ previous pass count.

**Step 4: Commit**

```bash
git add app/components/ChatHub.vue
git commit -m "feat(chat): wire ChatHeaderPill into chat header + load /api/chat/context"
```

---

### Task 12: Manual smoke test

Start the dev stack and verify end-to-end:

```bash
cd /home/haex/Projekte/holzi-frontend
pnpm dev
```

Verify:
1. **Header pill** shows the default persona name + model (e.g. "Hermes · claude-opus-4-7").
2. **Error card**: Temporarily break the upstream (e.g. set a bad API key in settings) and send a message — confirm the error card appears with the correct heading and the "try a different model" hint.
3. **`/model <name>` command**: Type `/model claude-haiku-4-5 What is 2+2?` and send. The pill should update to show the overridden model for that turn, and after the turn completes the pill should revert to the default.
4. **Pill picker**: Click the pill → popover opens → change model → click Apply → pill shows the pending override → send a message → override is used and then cleared.
5. **`/persona <name>` command** (if another persona exists): `/persona <other-name> Hello` switches persona for that one turn.

---

### Task 13: Frontend PR + CodeRabbit

```bash
cd /home/haex/Projekte/holzi-frontend
git push -u origin feat/wave-b2-slash-error-ux
gh pr create \
  --title "feat(chat): Wave B2 — slash commands + error card + header pill" \
  --body "$(cat <<'EOF'
## Summary
- `ChatErrorCard` replaces inline error div; shows provider error + model-switch hint for upstream errors (rate-limit, timeout, HTTP 5xx)
- `/model <name>` and `/persona <name>` composer slash commands — one-turn override, cleared after turn
- `ChatHeaderPill` in chat header shows active persona + model; click opens picker popover
- New `upstream_rate_limited` SSE error code (BE Task 1) handled here with specific copy
- All new i18n strings bilingual DE + EN

## Test plan
- [ ] `pnpm run test --run` all green
- [ ] `pnpm typecheck` exit 0
- [ ] Manual: error card visible on provider failure with hint
- [ ] Manual: `/model x` sets override pill; turn completes + pill resets
- [ ] Manual: pill picker opens, sets model, clears after turn
EOF
)"
```

Wait for CodeRabbit. Fix any valid findings, then merge.

---

### Task 14: Update plan docs + roadmap

**Files:**
- Modify: `docs/plans/holzi-agent-parity/39-slash-commands-and-error-ux.md` (this file, update Status)
- Modify: `docs/plans/holzi-agent-parity/35-strategic-roadmap-2026h2.md` (mark B2 done, set C1 as next)

**Step 1: Mark this plan done**

Update `Status:` at the top of this file:
```
Status: **Done — merged YYYY-MM-DD**
```

Add a `## Verification` section at the bottom:
```markdown
## Verification

- pytest: N tests pass (BE PR #XX)
- vitest: M tests pass (FE PR #XX)
- Manual: error card shows on 429; `/model` override works; pill resets after turn
```

**Step 2: Mark roadmap Wave B2 done and set up Wave C1**

In `35-strategic-roadmap-2026h2.md`, update the B2 section status to `**(done YYYY-MM-DD)**` and note the next executable slice is Wave C1.

**Step 3: Commit and PR**

```bash
git add docs/
git commit -m "docs: mark Plan 39 (Wave B2) done, roadmap Wave B2 complete"
gh pr create --title "docs: Wave B2 complete, next = Wave C1" --body "..."
```

---

## Success Criteria (from Plan 35)

- Per-persona model pin works (Wave B1 ✓); `/model <name>` overrides for one turn, doesn't persist ✓ (this plan)
- An Anthropic 429 surfaces a friendly error card with model-switch hint, no silent retry ✓ (this plan)
- Switching personas mid-conversation changes the model on next turn (via pill) ✓ (this plan)

---

## Verification

- pytest: all BE tests green (PR #77)
- vitest: 479 tests pass (FE PR #101)
- Manual: pill shows `Hermes · claude-sonnet-4-6` on load; popover picker sets override; `/model` + Enter updates pill without sending a turn; ×-badge clears override

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| Slash command parser conflicts with messages that legitimately start with `/` | Commands only recognised as `^/model ` or `^/persona ` — a message like `/home/user` or `/something else` passes through unchanged. |
| `GET /api/chat/context` called on every page load increases cold-start latency | 3–4 DB reads; SQLite in WAL mode. Acceptable at single-user scale. Cache TTL if it ever matters. |
| `persona_id_override` + system-prompt build duplicates `get_effective_system_prompt` code | `_get_system_prompt_for_persona` shares all the helper functions; just switches the persona source. Minimal duplication. |
| Sanitised provider message truncated to 300 chars hides important context | 300 chars covers almost all Anthropic/OpenAI error messages in practice. Power users can check the diagnostics/logs page for the raw error. |
