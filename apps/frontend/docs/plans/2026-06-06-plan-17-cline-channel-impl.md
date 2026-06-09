# Plan 17 Stufe 1: Cline First-Class Channel

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Cline (VS Code) a first-class Holzi channel — sticky sessions per workspace, cline conversations visible and continuable from the web UI.

**Architecture:** `/v1/chat/completions` gets sticky-session logic: without `X-Hermes-Session` it resumes the latest `channel=cline` conversation keyed by `X-Holzi-Workspace` (default `"default"`), creating a new one only when none exists. The web UI's channel guard on `/api/chat`, `/retry`, and `/edit-and-regenerate` is relaxed to also allow `channel=cline`. ChatHub fetches all conversations and filters out `task`-channel rows client-side, so cline conversations appear in the sidebar.

**Tech Stack:** Python/FastAPI + pytest/httpx (Holzi backend at `/home/haex/Projekte/Holzi`), Vue 3/Nuxt + Vitest (frontend at worktree)

**Repos:**
- Backend: `/home/haex/Projekte/Holzi`
- Frontend worktree: `/home/haex/Projekte/holzi-frontend/.worktrees/plan-17-cline-channel`

---

## Task 1: Backend — Sticky session in `routes/chat.py`

**Files:**
- Modify: `src/hermes/routes/chat.py`
- Modify: `tests/test_chat.py`

All commands run in `/home/haex/Projekte/Holzi`.

### Step 1: Write the failing tests

Append to `tests/test_chat.py`:

```python
async def test_chat_completions_sticky_session_resumes_same_workspace(
    client: httpx.AsyncClient,
) -> None:
    _install_upstream(_non_stream_handler(content="first"))
    r1 = await client.post(
        "/v1/chat/completions",
        headers={**AUTH, "X-Holzi-Workspace": "my-project"},
        json={"model": "m", "messages": [{"role": "user", "content": "hello"}]},
    )
    assert r1.status_code == 200
    session_id = int(r1.headers["x-hermes-session"])

    _install_upstream(_non_stream_handler(content="second"))
    r2 = await client.post(
        "/v1/chat/completions",
        headers={**AUTH, "X-Holzi-Workspace": "my-project"},
        json={"model": "m", "messages": [{"role": "user", "content": "follow-up"}]},
    )
    assert r2.status_code == 200
    assert int(r2.headers["x-hermes-session"]) == session_id

    msgs = await messages.list_by_conversation(app.state.db, session_id)
    assert [m.content for m in msgs] == ["hello", "first", "follow-up", "second"]


async def test_chat_completions_different_workspaces_get_different_sessions(
    client: httpx.AsyncClient,
) -> None:
    _install_upstream(_non_stream_handler())
    r1 = await client.post(
        "/v1/chat/completions",
        headers={**AUTH, "X-Holzi-Workspace": "project-a"},
        json={"model": "m", "messages": [{"role": "user", "content": "hi a"}]},
    )
    _install_upstream(_non_stream_handler())
    r2 = await client.post(
        "/v1/chat/completions",
        headers={**AUTH, "X-Holzi-Workspace": "project-b"},
        json={"model": "m", "messages": [{"role": "user", "content": "hi b"}]},
    )
    assert int(r1.headers["x-hermes-session"]) != int(r2.headers["x-hermes-session"])


async def test_chat_completions_no_workspace_header_is_sticky(
    client: httpx.AsyncClient,
) -> None:
    _install_upstream(_non_stream_handler())
    r1 = await client.post(
        "/v1/chat/completions",
        headers=AUTH,
        json={"model": "m", "messages": [{"role": "user", "content": "hi"}]},
    )
    _install_upstream(_non_stream_handler())
    r2 = await client.post(
        "/v1/chat/completions",
        headers=AUTH,
        json={"model": "m", "messages": [{"role": "user", "content": "hi again"}]},
    )
    assert int(r1.headers["x-hermes-session"]) == int(r2.headers["x-hermes-session"])


async def test_chat_completions_explicit_session_overrides_sticky(
    client: httpx.AsyncClient,
) -> None:
    _install_upstream(_non_stream_handler())
    # Create a cline conversation first (sticky)
    r1 = await client.post(
        "/v1/chat/completions",
        headers={**AUTH, "X-Holzi-Workspace": "ws"},
        json={"model": "m", "messages": [{"role": "user", "content": "hello"}]},
    )
    sticky_id = int(r1.headers["x-hermes-session"])

    # Create an explicit separate conversation
    other = await conversations.create(app.state.db, channel="cline", ts=1000)

    _install_upstream(_non_stream_handler())
    r2 = await client.post(
        "/v1/chat/completions",
        headers={**AUTH, "X-Hermes-Session": str(other.id)},
        json={"model": "m", "messages": [{"role": "user", "content": "direct"}]},
    )
    assert r2.status_code == 200
    assert int(r2.headers["x-hermes-session"]) == other.id
    assert other.id != sticky_id
```

### Step 2: Run to verify they fail

```bash
cd /home/haex/Projekte/Holzi
pytest tests/test_chat.py::test_chat_completions_sticky_session_resumes_same_workspace -v
```

Expected: `FAILED` — `AssertionError` (sessions differ because currently every request creates a new conversation).

### Step 3: Implement sticky session

Replace the `_resolve_conversation` function in `src/hermes/routes/chat.py`:

```python
CLINE_CHANNEL = "cline"
_DEFAULT_WORKSPACE = "default"


async def _resolve_conversation(request: Request, db: AsyncEngine) -> Conversation:
    header = request.headers.get("x-hermes-session")
    if header is not None:
        try:
            conv_id = int(header)
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail=ErrorCode.CHAT_INVALID_SESSION.value
            ) from exc
        convo = await conversations.get(db, conv_id)
        if convo is None:
            raise HTTPException(
                status_code=404, detail=ErrorCode.CHAT_SESSION_NOT_FOUND.value
            )
        return convo

    workspace = request.headers.get("x-holzi-workspace", _DEFAULT_WORKSPACE)
    existing = await conversations.find_latest_by_external_id(
        db, channel=CLINE_CHANNEL, external_id=workspace
    )
    if existing is not None:
        return existing
    return await conversations.create(
        db, channel=CLINE_CHANNEL, external_id=workspace
    )
```

Also remove the old `channel = request.headers.get("x-hermes-channel", "vscode")` line and the `channel=channel` arg from `conversations.create` — they are no longer used.

### Step 4: Run all tests

```bash
pytest tests/test_chat.py -v
```

Expected: all passing.

### Step 5: Commit

```bash
git add src/hermes/routes/chat.py tests/test_chat.py
git commit -m "feat(chat): sticky cline session per X-Holzi-Workspace"
```

---

## Task 2: Backend — Allow web UI to continue cline conversations

**Files:**
- Modify: `src/hermes/routes/api.py`
- Modify: `tests/test_api_chat.py`

All commands run in `/home/haex/Projekte/Holzi`.

### Step 1: Write failing test

Append to `tests/test_api_chat.py`:

```python
async def test_api_chat_can_continue_cline_conversation(
    client: httpx.AsyncClient,
) -> None:
    from hermes.repository import conversations as conv_repo

    cline_conv = await conv_repo.create(app.state.db, channel="cline")
    response = await client.post(
        "/api/chat",
        headers=AUTH,
        json={
            "message": "hello from web",
            "conversation_id": cline_conv.id,
        },
    )
    # Should NOT return 400 CONVERSATION_NOT_WEB
    assert response.status_code != 400
    # Exact status depends on agent running; 200 or 500 are both acceptable here —
    # the key invariant is that the channel guard doesn't fire.
    assert response.json().get("detail") != "CONVERSATION_NOT_WEB"


async def test_api_chat_task_channel_still_blocked(
    client: httpx.AsyncClient,
) -> None:
    from hermes.repository import conversations as conv_repo

    task_conv = await conv_repo.create(app.state.db, channel="task")
    response = await client.post(
        "/api/chat",
        headers=AUTH,
        json={
            "message": "sneak into task",
            "conversation_id": task_conv.id,
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "CONVERSATION_NOT_WEB"
```

### Step 2: Run to verify failure

```bash
pytest tests/test_api_chat.py::test_api_chat_can_continue_cline_conversation -v
```

Expected: `FAILED` — response is `400 CONVERSATION_NOT_WEB`.

### Step 3: Implement guard relaxation

In `src/hermes/routes/api.py`, near `WEB_CHANNEL = "web"` (line ~73), add:

```python
CLINE_CHANNEL = "cline"
```

Then change all three occurrences of `if existing.channel != WEB_CHANNEL:` / `if convo.channel != WEB_CHANNEL:` to:

```python
if existing.channel not in (WEB_CHANNEL, CLINE_CHANNEL):
```

(Lines ~273, ~1320, ~1368. Also update the comments above them to say "interactive surface" instead of "web-only surface".)

### Step 4: Run all tests

```bash
pytest tests/test_api_chat.py -v
```

Expected: all passing.

### Step 5: Commit

```bash
git add src/hermes/routes/api.py tests/test_api_chat.py
git commit -m "feat(api): allow web UI to continue cline-channel conversations"
```

---

## Task 3: Frontend — Show cline conversations in ChatHub

**Files:**
- Modify: `app/components/ChatHub.vue` (line ~178)

All commands run in `/home/haex/Projekte/holzi-frontend/.worktrees/plan-17-cline-channel`.

### Step 1: Write failing test

Create `tests/components/ChatHub.channel-filter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'

// Minimal stub — we only care about the conversations passed to ConversationList
const ConversationListStub = {
  name: 'ConversationList',
  props: ['conversations', 'activeId'],
  template: '<div><span v-for="c in conversations" :key="c.id" :data-channel="c.channel">{{ c.id }}</span></div>',
}

describe('ChatHub channel filtering', () => {
  it('shows web and cline conversations, excludes task', async () => {
    const fakeConversations = [
      { id: 1, channel: 'web', title: 'Web chat', updated_at: 1000, bookmarked: false },
      { id: 2, channel: 'cline', title: 'VS Code', updated_at: 999, bookmarked: false },
      { id: 3, channel: 'task', title: 'Scheduled', updated_at: 998, bookmarked: false },
    ]

    // Mock useApi so GET /api/conversations returns fakeConversations
    vi.mock('~/composables/useApi', () => ({
      useApi: () => ({
        get: vi.fn().mockResolvedValue(fakeConversations),
        post: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
      }),
    }))

    // Import after mocking
    const { default: ChatHub } = await import('~/components/ChatHub.vue')
    const wrapper = mount(ChatHub, {
      global: {
        plugins: [createTestingPinia()],
        stubs: { ConversationList: ConversationListStub, Teleport: true },
      },
    })

    // Trigger loadConversations
    await wrapper.vm.$nextTick()
    await vi.waitFor(() => {
      const spans = wrapper.findAll('[data-channel]')
      expect(spans.length).toBeGreaterThan(0)
    })

    const channels = wrapper.findAll('[data-channel]').map(s => s.attributes('data-channel'))
    expect(channels).toContain('web')
    expect(channels).toContain('cline')
    expect(channels).not.toContain('task')
  })
})
```

### Step 2: Run to verify failure

```bash
pnpm test -- --reporter=verbose tests/components/ChatHub.channel-filter.test.ts
```

Expected: `FAILED` — cline conversation is not shown (filtered out by `channel: 'web'`).

### Step 3: Implement

In `app/components/ChatHub.vue`, change `loadConversations` (lines ~175-191):

```typescript
async function loadConversations() {
  const seq = ++loadSeq
  try {
    const query: Record<string, unknown> = {}
    if (searchQuery.value) {
      query.q = searchQuery.value
    }
    const result = await api.get<Conversation[]>('/api/conversations', query)
    if (seq === loadSeq) {
      conversations.value = result.filter(c => c.channel !== 'task')
    }
  } catch (err: unknown) {
    if (seq === loadSeq) {
      error.value = err instanceof Error ? err.message : t('components.chatHub.errors.loadConversations')
    }
  }
}
```

### Step 4: Run test

```bash
pnpm test -- --reporter=verbose tests/components/ChatHub.channel-filter.test.ts
```

Expected: passing.

### Step 5: Run full suite

```bash
pnpm test
```

Expected: 481+ passing.

### Step 6: Commit

```bash
git add app/components/ChatHub.vue tests/components/ChatHub.channel-filter.test.ts
git commit -m "feat(chat): show cline conversations in sidebar, exclude task channel"
```

---

## Task 4: Frontend — Update i18n for CONVERSATION_NOT_WEB

The error `CONVERSATION_NOT_WEB` is now raised for `task`-channel conversations (not cline). Update the user-facing message to be accurate.

**Files:**
- Modify: `i18n/locales/en.json` (line ~529)
- Modify: `i18n/locales/de.json` (line ~529)

All commands run in `/home/haex/Projekte/holzi-frontend/.worktrees/plan-17-cline-channel`.

### Step 1: Update English

In `i18n/locales/en.json`, change:

```json
"CONVERSATION_NOT_WEB": "This conversation is not part of the web channel.",
```

To:

```json
"CONVERSATION_NOT_WEB": "This conversation cannot be continued here.",
```

### Step 2: Update German

In `i18n/locales/de.json`, change:

```json
"CONVERSATION_NOT_WEB": "Diese Konversation gehört nicht zum Web-Channel.",
```

To:

```json
"CONVERSATION_NOT_WEB": "Diese Konversation kann hier nicht fortgesetzt werden.",
```

### Step 3: Run i18n test to verify coverage still intact

```bash
pnpm test -- --reporter=verbose tests/i18n/
```

Expected: passing (error code still exists in both FE and BE, just message text changed).

### Step 4: Commit

```bash
git add i18n/locales/en.json i18n/locales/de.json
git commit -m "i18n: clarify CONVERSATION_NOT_WEB message (now covers non-interactive channels)"
```

---

## Task 5: Update Plan 17 doc + add Cline setup instructions

**Files:**
- Modify: `docs/plans/holzi-agent-parity/17-cline-roo-first-class-channel.md`

All commands run in `/home/haex/Projekte/holzi-frontend/.worktrees/plan-17-cline-channel`.

### Step 1: Prepend status block and add Cline setup section

At the **top** of the file, add:

```markdown
Status: Stufe 1 done (sticky session + web UI visibility)

## Cline Configuration

In VS Code, open Cline settings and configure a custom OpenAI-compatible provider:

| Setting | Value |
|---------|-------|
| Base URL | `https://<your-holzi-host>/v1` |
| API Key | your Holzi Bearer token (from `.env` → `AUTH_TOKEN`) |
| Model | any model ID Holzi is configured to use |

Optional headers (set in Cline's "Custom Headers" if supported):

| Header | Value | Effect |
|--------|-------|--------|
| `X-Holzi-Workspace` | project name, e.g. `holzi-frontend` | Isolates the sticky session per project |

Without `X-Holzi-Workspace`, all Cline requests share a single `"default"` session.

---
```

### Step 2: Commit

```bash
git add docs/plans/holzi-agent-parity/17-cline-roo-first-class-channel.md
git commit -m "docs(plan-17): Stufe 1 status + Cline setup instructions"
```

---

## Verification

After all tasks:

**Backend:**
```bash
cd /home/haex/Projekte/Holzi
pytest tests/test_chat.py tests/test_api_chat.py -v
```

**Frontend:**
```bash
cd /home/haex/Projekte/holzi-frontend/.worktrees/plan-17-cline-channel
pnpm test
```

**Manual smoke test:**
1. Start Holzi locally (`make up-local-full` or equivalent)
2. In Cline, set Base URL to `http://localhost:<port>/v1` and Bearer token
3. Send two messages → verify same `X-Hermes-Session` in response headers
4. Open Holzi web UI → verify the conversation appears in the sidebar with a `cline` badge
5. Reply from web UI → message appears in the thread
