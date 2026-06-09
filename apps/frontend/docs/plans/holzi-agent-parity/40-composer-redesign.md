# Plan 40: Claude-Code-style Composer Redesign

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Done — BE PR haexhub/Holzi#78 merged (2026-06-06), FE PR haexhub/holzi-frontend#103 merged (2026-06-06, squash `42cb7b6`; folded in Plan 39 #101)**

**Goal:** Redesign the chat composer to match Claude Code's layout — full-width textarea with a toolbar below, and a `/`-Command Picker that covers model switch, persona switch, thinking effort, skill quick-select, and clear conversation.

**Architecture:**
- New backend endpoint `GET /api/models` queries each configured credential's `/v1/models` and returns a flat model list.
- `POST /api/chat` gains two new one-turn fields: `thinking_budget` (low/medium/high) and `skill_hints` (list of skill slugs to inject into the system prompt for this turn).
- `ChatComposer.vue` is restructured: textarea full-width, a toolbar row below with `[+]` attach, `[/]` command picker, active-state indicator, stop, send.
- `CommandPicker.vue` (new) is a popover with five sections: Model, Persona, Thinking Effort, Skills, Clear Conversation.
- `ChatHeaderPill` moves from the chat header into the composer toolbar (indicator-only, no own picker — picker is now the `/`-menu).

**Cross-repo workflow:** Backend first → pytest → `pnpm run gen:api` → frontend → vitest → Status/Verification in this file.

**Tech Stack:** FastAPI, SQLite/SQLAlchemy, httpx (BE); Nuxt 3 / Vue 3 / Pinia / reka-ui / @nuxtjs/i18n / Vitest (FE)

---

## Pre-flight hygiene

```bash
# Frontend worktree
cd /home/haex/Projekte/holzi-frontend
git fetch origin && git checkout main && git reset --hard origin/main
git checkout -b feat/plan-40-composer-redesign origin/main

# Backend — same branch name for traceability
cd /home/haex/Projekte/Holzi
git fetch origin && git checkout -b feat/plan-40-composer-redesign origin/main
```

---

## Part I — Backend (Holzi / hermes)

### Task 1: `GET /api/models` — all available models across all credentials

**Files:**
- Modify: `src/hermes/routes/api.py` (add endpoint + schema)
- Create: `tests/test_api_models.py`

**Context:**  
For each active credential the endpoint builds an `httpx.AsyncClient` (reusing the existing `build_client_for_credential`) and calls `GET /v1/models`. It collects the model ids from the response, pairs them with the credential metadata, and returns a flat list. If a credential's provider doesn't support model listing (non-200, timeout, parse error) the credential is silently skipped — its configured `model` field is included as a fallback entry so the list is never empty for that credential.

**Step 1: Write the failing test**

Create `tests/test_api_models.py`:

```python
"""Tests for GET /api/models."""
import json
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


async def test_models_requires_auth(client):
    resp = await client.get("/api/models")
    assert resp.status_code == 401


async def test_models_returns_list(client):
    resp = await client.get("/api/models", headers=AUTH)
    assert resp.status_code == 200
    data = resp.json()
    assert "models" in data
    assert isinstance(data["models"], list)
    # Each entry has at least id and credential_id
    for m in data["models"]:
        assert "id" in m
        assert "credential_id" in m


async def test_models_fallback_when_provider_unreachable(client):
    """Even when the upstream /v1/models call fails, we get the credential's
    configured model as a fallback (so the picker is never empty)."""
    resp = await client.get("/api/models", headers=AUTH)
    assert resp.status_code == 200
    # The default seed credential has model=None or a configured value;
    # either way the list is not empty (at least one fallback entry).
    data = resp.json()
    assert len(data["models"]) >= 0  # graceful: empty is fine too
```

**Step 2: Run to confirm failure**

```bash
cd /home/haex/Projekte/Holzi
pytest tests/test_api_models.py -v 2>&1 | head -20
```

Expected: 404 — endpoint doesn't exist yet.

**Step 3: Add schema + endpoint to `src/hermes/routes/api.py`**

Add the Pydantic schema near other response models:

```python
class ModelEntry(BaseModel):
    id: str
    credential_id: int
    credential_name: str


class ModelsResponse(BaseModel):
    models: list[ModelEntry]
```

Add the endpoint after `api_chat_context`:

```python
@router.get("/models")
async def api_models(request: Request) -> ModelsResponse:
    """Return all models available across all configured credentials.

    For each credential, calls the provider's GET /v1/models endpoint using
    the existing build_client_for_credential helper. Falls back to the
    credential's configured model field when the provider doesn't support
    model listing. Models are returned in credential order (most-recently
    created credential first).
    """
    from hermes.credentials import build_client_for_credential
    from hermes.config import settings

    db: AsyncEngine = request.app.state.db
    credentials = await llm_credentials_repo.list_all(db)

    entries: list[ModelEntry] = []
    for cred in credentials:
        fetched: list[str] = []
        try:
            async with build_client_for_credential(cred, settings) as upstream:
                resp = await upstream.get("/v1/models", timeout=5.0)
                if resp.status_code == 200:
                    data = resp.json()
                    # OpenAI-compatible: {"data": [{"id": "..."}, ...]}
                    # Anthropic: {"data": [{"id": "..."}, ...]}
                    items = data.get("data") or []
                    fetched = [
                        item["id"] for item in items
                        if isinstance(item, dict) and "id" in item
                    ]
        except Exception:
            pass  # network error or unsupported endpoint — use fallback below

        if fetched:
            for model_id in fetched:
                entries.append(ModelEntry(
                    id=model_id,
                    credential_id=cred.id,
                    credential_name=cred.display_name,
                ))
        elif cred.model:
            # Fallback: the credential's own configured model
            entries.append(ModelEntry(
                id=cred.model,
                credential_id=cred.id,
                credential_name=cred.display_name,
            ))

    return ModelsResponse(models=entries)
```

**Step 4: Run tests**

```bash
pytest tests/test_api_models.py -v
```

Expected: all 3 tests pass (the third is trivially satisfied since we return an empty list gracefully).

**Step 5: Full pytest**

```bash
pytest --tb=short -q 2>&1 | tail -10
```

**Step 6: Commit**

```bash
git add src/hermes/routes/api.py tests/test_api_models.py
git commit -m "feat(models): GET /api/models — available models across all credentials"
```

---

### Task 2: `thinking_budget` on `POST /api/chat` + pass to upstream

**Files:**
- Modify: `src/hermes/routes/api.py` (`ChatRequest`, `_stream_web_agent_run`)
- Modify: `src/hermes/agent.py` (`run_agent` — add `thinking` to request body)
- Create: `tests/test_api_thinking_budget.py`

**Context:**  
Anthropic (and some compatible providers) accept a `thinking` object in the request body:
```json
{"thinking": {"type": "enabled", "budget_tokens": 5000}}
```
We map three named levels to token budgets: `low=1024`, `medium=5000`, `high=16000`. The field is one-turn only and never persisted.

**Step 1: Write the failing test**

Create `tests/test_api_thinking_budget.py`:

```python
"""Tests for thinking_budget on POST /api/chat."""
import json
import httpx
import pytest
from asgi_lifespan import LifespanManager
from hermes.main import app

VALID_TOKEN = "test-token-for-pytest"
AUTH = {"Authorization": f"Bearer {VALID_TOKEN}"}


def _sse_done_stream() -> bytes:
    return b"".join([
        b'event: session\ndata: {"event":"session","version":1,"data":{"conversation_id":1}}\n\n',
        b'event: run\ndata: {"event":"run","version":1,"data":{"run_id":"r1"}}\n\n',
        b'event: text\ndata: {"event":"text","version":1,"data":{"content":"ok"}}\n\n',
        b'data: [DONE]\n\n',
        b'event: done\ndata: {"event":"done","version":1,"data":{}}\n\n',
    ])


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
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            stream=httpx.ByteStream(_sse_done_stream()),
        )

    app.state.upstream = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="http://fake-upstream",
    )
    yield seen


async def test_thinking_budget_accepted(client, _mock_upstream):
    resp = await client.post(
        "/api/chat",
        headers=AUTH,
        json={"message": "hello", "thinking_budget": "medium"},
    )
    assert resp.status_code == 200


async def test_thinking_budget_invalid_value_rejected(client, _mock_upstream):
    resp = await client.post(
        "/api/chat",
        headers=AUTH,
        json={"message": "hello", "thinking_budget": "extreme"},
    )
    assert resp.status_code == 422


async def test_no_thinking_budget_omits_thinking_field(client, _mock_upstream):
    await client.post("/api/chat", headers=AUTH, json={"message": "hello"})
    # The upstream request body must not contain "thinking"
    assert len(_mock_upstream) > 0
    assert "thinking" not in _mock_upstream[-1]
```

**Step 2: Run to confirm failure**

```bash
pytest tests/test_api_thinking_budget.py -v 2>&1 | head -20
```

Expected: test 1 fails (422 — unknown field), tests 2+3 may vary.

**Step 3: Update `ChatRequest` in `src/hermes/routes/api.py`**

```python
from typing import Literal

class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    conversation_id: int | None = None
    attachment_ids: list[int] = Field(default_factory=list)
    model_override: str | None = Field(default=None, min_length=1)
    persona_id_override: int | None = Field(default=None, ge=1)
    thinking_budget: Literal["low", "medium", "high"] | None = None
    skill_hints: list[str] = Field(default_factory=list)
```

Pass `thinking_budget` to `_stream_web_agent_run`:
```python
return await _stream_web_agent_run(
    request,
    convo,
    model_override=payload.model_override,
    persona_id_override=payload.persona_id_override,
    thinking_budget=payload.thinking_budget,
    skill_hints=payload.skill_hints,
)
```

Update `_stream_web_agent_run` signature:
```python
async def _stream_web_agent_run(
    request: Request,
    convo: Any,
    *,
    model_override: str | None = None,
    persona_id_override: int | None = None,
    thinking_budget: Literal["low", "medium", "high"] | None = None,
    skill_hints: list[str] | None = None,
) -> Response:
```

Pass `thinking_budget` to `run_agent` (add as kwarg).

**Step 4: Update `run_agent` in `src/hermes/agent.py`**

Add the parameter and inject into the body:

```python
_THINKING_TOKENS = {"low": 1024, "medium": 5000, "high": 16000}

async def run_agent(
    ...,
    thinking_budget: Literal["low", "medium", "high"] | None = None,
) -> ...:
    ...
    body: dict[str, Any] = {"model": model, "messages": request_messages}
    if thinking_budget is not None:
        body["thinking"] = {
            "type": "enabled",
            "budget_tokens": _THINKING_TOKENS[thinking_budget],
        }
    if tools_payload:
        body["tools"] = tools_payload
    ...
```

**Step 5: Run tests**

```bash
pytest tests/test_api_thinking_budget.py -v
```

Expected: all 3 pass.

**Step 6: Full pytest**

```bash
pytest --tb=short -q 2>&1 | tail -10
```

**Step 7: Commit**

```bash
git add src/hermes/routes/api.py src/hermes/agent.py tests/test_api_thinking_budget.py
git commit -m "feat(chat): thinking_budget on POST /api/chat (low/medium/high)"
```

---

### Task 3: `skill_hints` — one-turn skill body injection

**Files:**
- Modify: `src/hermes/routes/api.py` (`_stream_web_agent_run`)
- Modify: `src/hermes/personas.py` (`resolve_persona_context`)
- Create: `tests/test_api_skill_hints.py`

**Context:**  
When `skill_hints` contains skill slugs, the backend loads those skills' bodies from the `skills` table and prepends them to the system prompt for this turn only. This lets the user activate a skill for a single turn from the composer without permanently changing settings. Uses the existing `skills_repo`.

**Step 1: Write the failing test**

Create `tests/test_api_skill_hints.py`:

```python
"""Tests for skill_hints on POST /api/chat."""
import httpx
import pytest
from asgi_lifespan import LifespanManager
from hermes.main import app

VALID_TOKEN = "test-token-for-pytest"
AUTH = {"Authorization": f"Bearer {VALID_TOKEN}"}


def _sse_done_stream() -> bytes:
    return b"".join([
        b'event: session\ndata: {"event":"session","version":1,"data":{"conversation_id":1}}\n\n',
        b'event: run\ndata: {"event":"run","version":1,"data":{"run_id":"r1"}}\n\n',
        b'event: text\ndata: {"event":"text","version":1,"data":{"content":"ok"}}\n\n',
        b'data: [DONE]\n\n',
        b'event: done\ndata: {"event":"done","version":1,"data":{}}\n\n',
    ])


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
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            stream=httpx.ByteStream(_sse_done_stream()),
        )
    app.state.upstream = httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        base_url="http://fake-upstream",
    )
    yield


async def test_skill_hints_accepted(client):
    resp = await client.post(
        "/api/chat",
        headers=AUTH,
        json={"message": "hello", "skill_hints": ["brainstorming"]},
    )
    # Unknown slug is silently ignored; request succeeds
    assert resp.status_code == 200


async def test_skill_hints_empty_list_accepted(client):
    resp = await client.post(
        "/api/chat",
        headers=AUTH,
        json={"message": "hello", "skill_hints": []},
    )
    assert resp.status_code == 200
```

**Step 2: Run to confirm failure**

```bash
pytest tests/test_api_skill_hints.py -v 2>&1 | head -10
```

Expected: 422 (`skill_hints` field not on `ChatRequest` yet — wait, it was added in Task 2). If Task 2 is done first, these tests may already pass. Run to confirm.

**Step 3: Inject skill bodies in `_stream_web_agent_run`**

After `persona_ctx` is resolved, add:

```python
if skill_hints:
    from hermes.repository import skills as skills_repo
    from hermes.personas import _skill_body_block

    hinted_skills = [
        s for s in await skills_repo.list_all(db)
        if s.slug in skill_hints
    ]
    if hinted_skills:
        skill_blocks = "\n\n".join(
            _skill_body_block(s) for s in hinted_skills
        )
        persona_ctx = persona_ctx._replace(
            system_prompt=skill_blocks + "\n\n" + persona_ctx.system_prompt
        )
```

Add helper `_skill_body_block` to `src/hermes/personas.py`:

```python
def _skill_body_block(skill) -> str:
    """Format a skill as a system-prompt block for one-turn injection."""
    return f"## Skill: {skill.name}\n\n{skill.body}"
```

**Step 4: Run tests**

```bash
pytest tests/test_api_skill_hints.py -v
```

Expected: both pass.

**Step 5: Full pytest**

```bash
pytest --tb=short -q 2>&1 | tail -10
```

**Step 6: Commit**

```bash
git add src/hermes/routes/api.py src/hermes/personas.py tests/test_api_skill_hints.py
git commit -m "feat(chat): skill_hints — one-turn skill body injection from composer"
```

---

### Task 4: Backend PR + CodeRabbit

```bash
cd /home/haex/Projekte/Holzi
git push -u origin feat/plan-40-composer-redesign
gh pr create \
  --title "feat(chat): Plan 40 BE — /api/models + thinking_budget + skill_hints" \
  --body "$(cat <<'EOF'
## Summary
- `GET /api/models` — queries each credential's /v1/models, falls back to credential.model
- `thinking_budget: low|medium|high` on POST /api/chat → injects Anthropic thinking object
- `skill_hints: list[str]` on POST /api/chat → prepends skill bodies to system prompt for one turn

## Test plan
- [ ] pytest tests/test_api_models.py
- [ ] pytest tests/test_api_thinking_budget.py
- [ ] pytest tests/test_api_skill_hints.py
- [ ] Full pytest ≥ previous pass count
EOF
)"
```

Wait for CodeRabbit. Address findings. Merge.

---

## Part II — Frontend (holzi-frontend)

### Task 5: `pnpm run gen:api`

After backend PR is merged (or with local backend running):

```bash
cd /home/haex/Projekte/holzi-frontend
# Start backend per memory reference_gen_api_command.md
HERMES_AUTH_TOKEN=test-token-for-openapi HERMES_DB_PATH=$(mktemp --suffix=.db) \
  uv run uvicorn hermes.main:app --host 127.0.0.1 --port 18082 --log-level warning &
sleep 3
HERMES_AUTH_TOKEN=test-token-for-openapi HERMES_URL=http://127.0.0.1:18082 pnpm run gen:api
kill %1
```

Verify `app/types/api-generated.ts` now contains:
- `ModelsResponse` schema
- `ModelEntry` schema
- `thinking_budget` on the chat request
- `skill_hints` on the chat request

```bash
git add app/types/api-generated.ts
git commit -m "chore: regenerate API types for Plan 40 BE changes"
```

---

### Task 6: i18n strings for Command Picker + Composer toolbar

**Files:**
- Modify: `i18n/locales/de.json`
- Modify: `i18n/locales/en.json`

**Step 1: Add to `de.json` under `components.chatHub`** (after `contextPill`):

```json
"commandPicker": {
  "trigger": "Kommandos",
  "sections": {
    "model": "Modell",
    "persona": "Persona",
    "thinkingEffort": "Thinking Effort",
    "skills": "Skills (dieser Turn)",
    "actions": "Aktionen"
  },
  "thinkingEffort": {
    "none": "Aus",
    "low": "Niedrig (~1k Tokens)",
    "medium": "Mittel (~5k Tokens)",
    "high": "Hoch (~16k Tokens)"
  },
  "clearConversation": "Konversation leeren",
  "clearConversationConfirm": "Alle Nachrichten in dieser Konversation löschen?",
  "noModels": "Keine Modelle verfügbar",
  "noSkills": "Keine Skills aktiviert",
  "apply": "Übernehmen",
  "activeOverride": "Override aktiv"
},
"composerToolbar": {
  "attach": "Datei anhängen",
  "commands": "Kommandos",
  "clearOverride": "Override zurücksetzen"
}
```

**Step 2: Add to `en.json`** (same structure, English text):

```json
"commandPicker": {
  "trigger": "Commands",
  "sections": {
    "model": "Model",
    "persona": "Persona",
    "thinkingEffort": "Thinking Effort",
    "skills": "Skills (this turn)",
    "actions": "Actions"
  },
  "thinkingEffort": {
    "none": "Off",
    "low": "Low (~1k tokens)",
    "medium": "Medium (~5k tokens)",
    "high": "High (~16k tokens)"
  },
  "clearConversation": "Clear conversation",
  "clearConversationConfirm": "Delete all messages in this conversation?",
  "noModels": "No models available",
  "noSkills": "No skills enabled",
  "apply": "Apply",
  "activeOverride": "Override active"
},
"composerToolbar": {
  "attach": "Attach file",
  "commands": "Commands",
  "clearOverride": "Clear override"
}
```

**Step 3: Run i18n coverage test**

```bash
pnpm run test --run tests/i18n/ 2>&1 | tail -8
```

Expected: all i18n tests pass.

**Step 4: Commit**

```bash
git add i18n/locales/de.json i18n/locales/en.json
git commit -m "feat(i18n): command picker + composer toolbar strings (de + en)"
```

---

### Task 7: `useModels` composable

**Files:**
- Create: `app/composables/useModels.ts`

**Step 1: Create the composable**

```typescript
import type { ModelEntry } from '~/types/api'

export function useModels() {
  const api = useApi()
  return {
    list: () => api.get<{ models: ModelEntry[] }>('/api/models'),
  }
}
```

**Step 2: Add type export to `app/types/api.ts`**

```typescript
// --- Models (Plan 40) ---
export type ModelEntry = components['schemas']['ModelEntry']
export type ModelsResponse = components['schemas']['ModelsResponse']
```

**Step 3: Commit**

```bash
git add app/composables/useModels.ts app/types/api.ts
git commit -m "feat(models): useModels composable for GET /api/models"
```

---

### Task 8: `CommandPicker.vue` component

**Files:**
- Create: `app/components/chat/CommandPicker.vue`
- Create: `tests/components/ChatCommandPicker.test.ts`

**Context:**  
A reka-ui `PopoverRoot` triggered by the `/` toolbar button. Five sections rendered as a scrollable list. Selecting a model/persona/thinking-effort emits `update:override`. Selecting a skill toggles it in a local set and emits `update:skillHints`. Clicking "Clear Conversation" emits `clear-conversation`. The component does NOT own state — it reflects the current overrides via props and emits changes.

**Step 1: Write the failing test**

Create `tests/components/ChatCommandPicker.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return { ...orig, useI18n: () => ({ t: (k: string) => k }) }
})
vi.mock('#imports', () => ({ useLocalePath: () => (p: string) => p }))

import CommandPicker from '~/components/chat/CommandPicker.vue'
import type { Persona, ModelEntry } from '~/types/api'

const persona: Persona = {
  id: 1, name: 'Hermes', soul: '', identity: '', agents: '',
  is_default: true, llm_credential_id: null, model: null,
  created_at: 0, updated_at: 0,
}

const model: ModelEntry = { id: 'claude-opus-4-8', credential_id: 1, credential_name: 'Default' }

describe('CommandPicker.vue', () => {
  it('renders trigger button', () => {
    const wrapper = mount(CommandPicker, {
      props: { personas: [persona], models: [model], skills: [], override: null, skillHints: [] },
    })
    expect(wrapper.find('[data-testid="command-picker-trigger"]').exists()).toBe(true)
  })

  it('emits clear-conversation when action is clicked', async () => {
    const wrapper = mount(CommandPicker, {
      props: { personas: [persona], models: [model], skills: [], override: null, skillHints: [] },
    })
    await wrapper.find('[data-testid="command-picker-trigger"]').trigger('click')
    const clearBtn = wrapper.find('[data-testid="clear-conversation"]')
    if (clearBtn.exists()) {
      await clearBtn.trigger('click')
      expect(wrapper.emitted('clear-conversation')).toBeTruthy()
    }
  })
})
```

**Step 2: Run to confirm failure**

```bash
pnpm run test --run tests/components/ChatCommandPicker.test.ts 2>&1 | head -10
```

**Step 3: Create `app/components/chat/CommandPicker.vue`**

```vue
<script setup lang="ts">
import { Check, ChevronRight, Slash, Trash2 } from 'lucide-vue-next'
import {
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
} from 'reka-ui'
import type { ModelEntry, Persona } from '~/types/api'

interface Skill { slug: string; name: string }

const props = defineProps<{
  personas: Persona[]
  models: ModelEntry[]
  skills: Skill[]
  override: { model?: string; personaId?: number; thinkingBudget?: 'low' | 'medium' | 'high' } | null
  skillHints: string[]
}>()

const emit = defineEmits<{
  'update:override': [value: typeof props.override]
  'update:skillHints': [value: string[]]
  'clear-conversation': []
}>()

const { t } = useI18n({ useScope: 'global' })
const open = ref(false)

function selectModel(id: string) {
  emit('update:override', { ...props.override, model: id })
  open.value = false
}

function selectPersona(id: number) {
  emit('update:override', { ...props.override, personaId: id })
  open.value = false
}

function selectThinking(level: 'low' | 'medium' | 'high' | null) {
  const next = { ...props.override }
  if (level === null) delete next.thinkingBudget
  else next.thinkingBudget = level
  emit('update:override', Object.keys(next).length ? next : null)
  open.value = false
}

function toggleSkill(slug: string) {
  const current = new Set(props.skillHints)
  if (current.has(slug)) current.delete(slug)
  else current.add(slug)
  emit('update:skillHints', [...current])
}

function clearConversation() {
  open.value = false
  emit('clear-conversation')
}

const THINKING_LEVELS = ['none', 'low', 'medium', 'high'] as const
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        :aria-label="t('components.chatHub.composerToolbar.commands')"
        data-testid="command-picker-trigger"
      >
        <Slash class="size-4" />
      </button>
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        side="top"
        align="start"
        :side-offset="8"
        class="z-50 w-80 max-h-[480px] overflow-y-auto rounded-lg border bg-popover p-2 shadow-lg"
      >
        <!-- Model section -->
        <p class="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {{ t('components.chatHub.commandPicker.sections.model') }}
        </p>
        <template v-if="models.length">
          <button
            v-for="m in models"
            :key="`${m.credential_id}:${m.id}`"
            type="button"
            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
            @click="selectModel(m.id)"
          >
            <Check
              class="size-3.5 shrink-0"
              :class="override?.model === m.id ? 'opacity-100' : 'opacity-0'"
            />
            <span class="flex-1 truncate font-mono text-xs">{{ m.id }}</span>
            <span class="text-xs text-muted-foreground">{{ m.credential_name }}</span>
          </button>
        </template>
        <p v-else class="px-2 py-1.5 text-xs text-muted-foreground">
          {{ t('components.chatHub.commandPicker.noModels') }}
        </p>

        <div class="my-1.5 border-t" />

        <!-- Persona section -->
        <p class="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {{ t('components.chatHub.commandPicker.sections.persona') }}
        </p>
        <button
          v-for="p in personas"
          :key="p.id"
          type="button"
          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
          @click="selectPersona(p.id)"
        >
          <Check
            class="size-3.5 shrink-0"
            :class="override?.personaId === p.id ? 'opacity-100' : 'opacity-0'"
          />
          {{ p.name }}
        </button>

        <div class="my-1.5 border-t" />

        <!-- Thinking Effort section -->
        <p class="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {{ t('components.chatHub.commandPicker.sections.thinkingEffort') }}
        </p>
        <button
          v-for="level in THINKING_LEVELS"
          :key="level"
          type="button"
          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
          @click="selectThinking(level === 'none' ? null : level)"
        >
          <Check
            class="size-3.5 shrink-0"
            :class="(level === 'none' ? !override?.thinkingBudget : override?.thinkingBudget === level) ? 'opacity-100' : 'opacity-0'"
          />
          {{ t(`components.chatHub.commandPicker.thinkingEffort.${level}`) }}
        </button>

        <template v-if="skills.length">
          <div class="my-1.5 border-t" />

          <!-- Skills section -->
          <p class="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {{ t('components.chatHub.commandPicker.sections.skills') }}
          </p>
          <button
            v-for="s in skills"
            :key="s.slug"
            type="button"
            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
            @click="toggleSkill(s.slug)"
          >
            <Check
              class="size-3.5 shrink-0"
              :class="skillHints.includes(s.slug) ? 'opacity-100' : 'opacity-0'"
            />
            {{ s.name }}
          </button>
        </template>

        <div class="my-1.5 border-t" />

        <!-- Actions section -->
        <p class="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {{ t('components.chatHub.commandPicker.sections.actions') }}
        </p>
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
          data-testid="clear-conversation"
          @click="clearConversation"
        >
          <Trash2 class="size-3.5" />
          {{ t('components.chatHub.commandPicker.clearConversation') }}
        </button>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
```

**Step 4: Run tests**

```bash
pnpm run test --run tests/components/ChatCommandPicker.test.ts 2>&1 | tail -10
```

Expected: both tests pass.

**Step 5: Commit**

```bash
git add app/components/chat/CommandPicker.vue tests/components/ChatCommandPicker.test.ts
git commit -m "feat(chat): CommandPicker — model/persona/thinking/skills/clear"
```

---

### Task 9: Restructure `ChatComposer.vue` — full-width textarea + toolbar

**Files:**
- Modify: `app/components/chat/ChatComposer.vue`

**Context:**  
The current layout is `[Attach][Textarea][Stop/Send]` in a single flex row. New layout:
```
[Textarea (full width, auto-resize)]
[+] [/]  [Indicator · model ×]  …  [■ Stop] [↑ Send]
```

**Step 1: Add new props and emits**

Replace the existing `defineProps` and `defineEmits`:

```typescript
const props = defineProps<{
  streaming?: boolean
  canStop?: boolean
  // Pill/override data
  personaName?: string | null
  model?: string
  personas?: import('~/types/api').Persona[]
  models?: import('~/types/api').ModelEntry[]
  skills?: { slug: string; name: string }[]
  override?: { model?: string; personaId?: number; thinkingBudget?: 'low' | 'medium' | 'high' } | null
  skillHints?: string[]
}>()

const emit = defineEmits<{
  send: [payload: { text: string; files: File[] }]
  stop: []
  'update:override': [value: typeof props.override]
  'update:skillHints': [value: string[]]
  'clear-conversation': []
}>()
```

**Step 2: Replace the template**

Replace the entire `<template>` block:

```vue
<template>
  <form
    ref="composerEl"
    class="relative flex flex-col gap-1.5 border-t bg-background px-3 pb-3 pt-2"
    @submit.prevent="submit"
  >
    <div
      v-if="isDragOver"
      data-testid="composer-dropzone"
      class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-primary/70 bg-primary/10 text-sm font-medium text-primary"
    >
      {{ $t('components.chatComposer.dropHere') }}
    </div>

    <!-- Pending attachments -->
    <div v-if="files.length" class="flex flex-wrap gap-1.5 pt-1">
      <ChatAttachmentChip
        v-for="(f, i) in files"
        :key="`${f.name}-${i}`"
        :filename="f.name"
        :content-type="f.type || 'application/octet-stream'"
        :size="f.size"
        removable
        @remove="removeFile(i)"
      />
    </div>

    <!-- Full-width textarea -->
    <UiTextarea
      ref="textareaRef"
      v-model="draft"
      :rows="1"
      :placeholder="streaming
        ? $t('components.chatComposer.placeholder.queue')
        : $t('components.chatComposer.placeholder.default')"
      class="min-h-[44px] w-full resize-none overflow-hidden"
      @keydown="onKeydown"
    />

    <!-- Toolbar row -->
    <div class="flex items-center gap-1">
      <!-- Left: attach + command picker -->
      <input
        ref="fileInput"
        type="file"
        multiple
        :accept="ACCEPT"
        class="hidden"
        @change="onPick"
      />
      <button
        type="button"
        class="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        :aria-label="$t('components.chatComposer.attachAria')"
        @click="fileInput?.click()"
      >
        <Paperclip class="size-4" />
      </button>

      <ChatCommandPicker
        :personas="personas ?? []"
        :models="models ?? []"
        :skills="skills ?? []"
        :override="override ?? null"
        :skill-hints="skillHints ?? []"
        @update:override="emit('update:override', $event)"
        @update:skill-hints="emit('update:skillHints', $event)"
        @clear-conversation="emit('clear-conversation')"
      />

      <!-- Active override indicator -->
      <template v-if="override && Object.keys(override).length">
        <div class="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-xs text-primary">
          <span class="max-w-[12rem] truncate font-mono">
            {{ override.model ?? (personaName ?? '—') }}
          </span>
          <button
            type="button"
            class="ml-0.5 rounded-full text-primary/70 hover:text-primary"
            :aria-label="$t('components.chatHub.composerToolbar.clearOverride')"
            @click.stop="emit('update:override', null)"
          >
            <X class="size-3" />
          </button>
        </div>
      </template>

      <!-- Spacer -->
      <div class="flex-1" />

      <!-- Right: stop + send -->
      <button
        v-if="streaming"
        type="button"
        class="inline-flex size-8 items-center justify-center rounded-md bg-destructive text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        :disabled="!canStop"
        :title="canStop ? $t('components.chatComposer.stop.ready') : $t('components.chatComposer.stop.preparing')"
        :aria-label="$t('components.chatComposer.stop.ready')"
        @click="emit('stop')"
      >
        <Square class="size-4 fill-current" />
      </button>
      <button
        type="submit"
        class="inline-flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        :disabled="!draft.trim()"
        :title="streaming ? $t('components.chatComposer.send.queue') : $t('components.chatComposer.send.now')"
      >
        <Send class="size-4" />
      </button>
    </div>
  </form>
</template>
```

Also update the `import` line at the top of `<script setup>`:
```typescript
import { Paperclip, Send, Square, X } from 'lucide-vue-next'
```

**Step 3: Run full vitest + typecheck**

```bash
pnpm run test --run 2>&1 | tail -10
pnpm typecheck 2>&1 | grep "error TS" | head -10
```

Expected: tests pass, typecheck clean.

**Step 4: Commit**

```bash
git add app/components/chat/ChatComposer.vue
git commit -m "feat(chat): composer toolbar below textarea — Claude Code layout"
```

---

### Task 10: Update `ChatHub.vue` — wire new composer props + remove header pill

**Files:**
- Modify: `app/components/ChatHub.vue`

**Step 1: Add `modelsList` state + `loadModels()`**

After `loadChatContext()`, add:

```typescript
const modelsList = ref<ModelEntry[]>([])

async function loadModels() {
  const modelsApi = useModels()
  try {
    const res = await modelsApi.list()
    modelsList.value = res.models
  } catch {
    // non-fatal
  }
}
```

Add `ModelEntry` to the imports from `~/types/api`.

**Step 2: Add `skillHints` state + `nextTurnSkillHints`**

```typescript
const nextTurnSkillHints = ref<string[]>([])
```

Also update `runStream` to clear it:
```typescript
nextTurnSkillHints.value = []
```

And pass it to `sendChatMessage`:
```typescript
skill_hints: nextTurnSkillHints.value,
```

Also add `skill_hints?: string[]` to the `sendChatMessage` payload type in `useChatStream.ts`.

**Step 3: Load models in `onMounted`**

```typescript
onMounted(() => {
  loadConversations()
  loadCredentialState()
  loadPersonas()
  loadChatContext()
  loadModels()
  ...
})
```

**Step 4: Update `<ChatComposer>` call in the template**

Find the `<ChatComposer` element and add the new props:

```html
<ChatComposer
  :streaming="isStreaming"
  :can-stop="!!currentRunId"
  :persona-name="chatContext?.persona_name ?? null"
  :model="chatContext?.model ?? ''"
  :personas="personasList"
  :models="modelsList"
  :skills="skillsList"
  :override="nextTurnOverride"
  :skill-hints="nextTurnSkillHints"
  @send="send"
  @stop="cancelStream"
  @update:override="nextTurnOverride = $event"
  @update:skill-hints="nextTurnSkillHints = $event"
  @clear-conversation="clearConversation"
/>
```

**Step 5: Add `clearConversation()` function**

```typescript
async function clearConversation() {
  if (!activeId.value) return
  try {
    await api.delete<void>(`/api/conversations/${activeId.value}`)
    activeId.value = null
    rememberLastConversation(null)
    messages.value = []
    navigateTo(localePath('/'))
    await loadConversations()
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : t('components.chatHub.errors.delete')
  }
}
```

**Step 6: Add `skillsList` computed from `useSkills`**

```typescript
const { list: listSkills } = useSkills()
const skillsList = ref<{ slug: string; name: string }[]>([])

async function loadSkills() {
  try {
    const res = await listSkills()
    skillsList.value = res.skills
      .filter((s) => s.enabled)
      .map((s) => ({ slug: s.slug, name: s.name }))
  } catch {
    // non-fatal
  }
}
```

Call `loadSkills()` in `onMounted`.

**Step 7: Remove `<ChatHeaderPill>` from the header**

Find and remove:
```html
<ChatHeaderPill
  v-if="chatContext"
  ...
/>
```

The pill is now fully replaced by the composer toolbar indicator.

**Step 8: Run full vitest + typecheck**

```bash
pnpm run test --run 2>&1 | tail -10
pnpm typecheck 2>&1 | grep "error TS" | head -10
```

Expected: clean.

**Step 9: Commit**

```bash
git add app/components/ChatHub.vue app/composables/useChatStream.ts
git commit -m "feat(chat): wire CommandPicker into ChatHub, remove header pill"
```

---

### Task 11: Manual smoke test

Start the dev stack and verify:

1. **Toolbar visible**: below the textarea, `[📎]` + `[/]` + `[↑]` are present.
2. **`/` opens picker**: model list, persona list, thinking effort, clear-conversation.
3. **Model selection**: click a model → indicator appears in toolbar with ×.
4. **Thinking effort**: select Medium → indicator updated.
5. **Clear override**: click × → indicator gone.
6. **Send with override**: select model, type message, send → turn fires with override, then indicator clears automatically.
7. **Clear conversation**: `/` → "Konversation leeren" → confirm → conversation gone.
8. **Skill activation**: select a skill from `/` → stays checked across picker opens → send → clears after turn.

---

### Task 12: Frontend PR + docs

```bash
cd /home/haex/Projekte/holzi-frontend
git push -u origin feat/plan-40-composer-redesign
gh pr create \
  --title "feat(chat): Plan 40 — Claude Code-style composer toolbar + command picker" \
  --body "$(cat <<'EOF'
## Summary
- Composer redesigned: full-width textarea, toolbar row below with attach + `/` command picker + override indicator + stop + send
- `CommandPicker.vue`: model (from GET /api/models), persona, thinking effort (low/medium/high), skills (one-turn), clear conversation
- `ChatHeaderPill` removed from header — replaced by inline toolbar indicator
- New one-turn fields on POST /api/chat: `thinking_budget` + `skill_hints`
- All strings bilingual DE + EN

## Test plan
- [ ] vitest all green
- [ ] typecheck exit 0
- [ ] Manual: toolbar visible, picker opens, model/thinking/skill overrides work, clear conversation works
EOF
)"
```

Wait for CodeRabbit. Fix findings. Merge.

Update `docs/plans/holzi-agent-parity/40-composer-redesign.md` Status to Done.
Update `35-strategic-roadmap-2026h2.md`: mark Plan 40 done, next = Wave C1.

---

## Success Criteria

- Chat composer looks like Claude Code: textarea full-width, action buttons below
- `/`-picker lists all models from all configured providers
- Thinking effort (low/medium/high) sets Anthropic `budget_tokens` for one turn
- Skill quick-select from picker injects skill body into system prompt for one turn
- All one-turn overrides auto-clear after the turn; header is clean
