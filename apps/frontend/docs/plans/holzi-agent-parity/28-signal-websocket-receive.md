# Plan 28: Signal Note-to-Self via WebSocket (json-rpc mode)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Obsolet (durch [Plan 34](./34-remove-messengers.md) 2026-06-04 ausgebaut).** Wurde am 2026-06-04 als [Holzi#69](https://github.com/haexhub/Holzi/pull/69) gemerged (6 commits, 919 pytest passing), aber NIE produktiv aktiviert — der Ansible-Quadlet-Flip auf `MODE=json-rpc` (Task 8) blieb deferred, und Recherche zeigte dass selbst mit json-rpc das eigentliche Problem (signal-cli's syncMessage-Filter für linked-secondary-Devices) NICHT gelöst gewesen wäre. Per User-Entscheidung wurde die gesamte Messenger-Familie via Plan 34 entfernt statt eine eigene Primary-Signal-Number zu beschaffen. Der WS-Receive-Code lebt nur noch in der Git-Historie (commits unter `Holzi#69`); falls Signal jemals wieder eingebaut wird, ist das ein neuer Plan auf dem Stand der eigenen Primary-Number.

Depends on: existing Signal integration (Plan 19 baseline + the messenger
accounts CRUD already on main). No frontend-facing changes — pure backend +
one Ansible-Quadlet edit.

Backend-only. **No `gen:api` step.** Cross-system in the deployment sense
(Holzi backend ↔ Ansible-managed signal-cli-rest-api Quadlet), not the API-
contract sense.

## Goal

Make `SignalWorker` actually receive messages the user types into "Notiz an
mich" on their primary Signal device — by switching from the HTTP-poll
`/v1/receive` endpoint to its WebSocket variant that signal-cli-rest-api
exposes in `MODE=json-rpc`.

## Why

Verified live on `haex.cloud` (2026-05-31):

- The current `MODE=native` Quadlet renders `/v1/receive` as HTTP — Worker
  polls it, signal-cli-rest-api answers `200 + []` to every call, even when
  the user has freshly typed a Note-to-Self. No syncMessages surface.
- Direct 60s long-poll from inside the hermes-server container while the
  user writes a Note-to-Self also returned `[]`.
- Send works fine in the other direction (`POST /v2/send` → message arrives
  on the phone), proving the Signal account linking itself is healthy.

Research from upstream issues
([bbernhard#797](https://github.com/bbernhard/signal-cli-rest-api/issues/797),
[bbernhard#840](https://github.com/bbernhard/signal-cli-rest-api/issues/840))
and the project README pinned the actual contract:

> In JSON-RPC mode it's no longer possible to poll for incoming messages
> via the HTTP GET receive endpoint. Instead you have to use websockets. …
> the /v1/receive endpoint is implemented as a websocket endpoint.

So our HTTP-GET against the `json-rpc` endpoint silently no-ops, and the
HTTP variants (`native`, `normal`) have their own sync-delivery bugs.
**json-rpc + WebSocket is the only path that's known-good** for Note-to-
Self via a linked secondary device.

Bonus payoff: linked-device + self-source filter is the **simplest possible
auth model**. Only the user's own primary device can produce an envelope
whose `source == self_number` *and* `syncMessage.sentMessage.destination ==
self_number` — Signal's identity-key signing guarantees that. No phone-
number allowlist, no shared secret, no UI for managing trust. The original
"give Holzi its own Signal number" idea is *worse* on both UX and security.

## Non-Goals

- **Own Signal number for Holzi.** Worse UX (yet another contact, yet
  another SIM/VoIP slot), worse security (every spammer who scrapes the
  number can DM the agent — needs Allowlist UI + identity-key
  pinning that we don't have today).
- **Inbound dataMessages from other senders.** Receiving "hi Holzi" from
  third-party Signal users is out of scope for this plan; the Worker only
  acts on envelopes where `source == self_number` (Note-to-Self path).
  Opening up to other senders is a future plan with its own Allowlist UI.
- **Switching `POST /v2/send` to a WebSocket call.** HTTP send works fine
  in json-rpc mode — leave it alone.
- **Telegram / Cline / Roo channels.** Untouched. Plan 17 territory.
- **Multi-account or multi-conversation Signal routing.** Single linked
  number per Holzi instance stays the invariant.

## Scope

### Ansible (`/home/haex/Projekte/ansible`)

- `roles/holzi/templates/quadlet/signal-cli-rest-api.container.j2` —
  `Environment=MODE=json-rpc`. Update the inline comment to reflect the
  new rationale (WebSocket receive is the contract Holzi uses; HTTP-poll
  is intentionally not used). The previous diagnostic comment about
  "Holzi polls HTTP" is now wrong.
- One-shot ansible-playbook apply on the haex.cloud box during
  verification (Task 9). No new role logic.

### Backend (`/home/haex/Projekte/Holzi`)

**Dependency**

- `pyproject.toml` — add `websockets>=12` (async-native, pure-Python,
  well-maintained). No httpx-ws or aiohttp; one extra dep is enough.

**`src/hermes/signal/client.py`**

- Keep `send`, `start_qr_link`, `list_registered_numbers` exactly as
  today — HTTP-side stays.
- Drop the HTTP-poll `receive` method (no caller after this plan; no
  back-compat shim — the only call site is `SignalWorker._run`).
- Add `receive_stream(self) -> AsyncIterator[dict[str, Any]]` that opens
  a WebSocket to `ws://signal-cli-rest-api:8080/v1/receive/{number}` and
  yields decoded envelope dicts. Translates `ws://` from the configured
  `signal_url` (which is `http://...`) — small `_ws_url()` helper.
- Connection management lives **inside** `receive_stream`: open the
  socket, yield each parsed message, close on cancel/exit. The Worker
  decides reconnect policy, not the client.
- Parsing: each WS frame is a JSON object — typically the bare envelope
  dict (no wrapping `{envelope: ...}` like HTTP `/v1/receive` returns —
  the WS shape differs!). Verify the actual shape during Task 4 against
  the real signal-cli-rest-api and adapt the parser. Plan a fixture
  recorded from the live WS.

**`src/hermes/signal/worker.py`**

- Replace the HTTP-poll loop in `_run` with a WebSocket-consume loop +
  reconnect backoff:
  - `async for envelope in self.client.receive_stream(): await self.process_envelope(envelope)`
  - On `websockets.ConnectionClosed` / network error: log
    `signal_ws_disconnected`, sleep with incremental backoff using a
    manually chosen sequence (1s, 2s, 5s, 10s, capped 30s — not strict
    2^n; the early steps are faster than exponential so a brief
    signal-cli-rest-api restart doesn't add a needless multi-second
    gap), retry. Reset backoff to 1s after a successful frame.
  - On `asyncio.CancelledError`: propagate up so `stop()` exits clean.
- Replace `_extract_note_to_self_text` with `_extract_self_text` that
  reads **both** envelope shapes:
  - `envelope.source == self_number` is the mandatory auth gate
    (Signal's identity-key signing makes this unspoofable).
  - Path A (Note-to-Self from primary, the normal case):
    `envelope.syncMessage.sentMessage.destination == self_number` and
    `.message` is a non-empty string → use that text.
  - Path B (rare — DM from same number on a different device):
    `envelope.dataMessage.message` non-empty → use that text.
  - Both checks done in sequence; the first match wins; otherwise
    return None and skip the envelope.
- Drop `convo_gap_seconds` / `poll_timeout` ctor params — both were
  poll-era concepts. Conversation-gap heuristic stays (it's not about
  HTTP polling, it's about session boundaries), so its constant moves
  inline. Poll-timeout is gone entirely.

**`src/hermes/signal/lifecycle.py`**

- `rebuild_signal_worker_from_db` keeps the same shape — start/stop the
  worker on activation/deactivation. No new app.state slot: the
  WebSocket lives inside the worker's `_run` task, owned by the
  `SignalWorker` instance, cleaned up on `worker.stop()` via task
  cancellation.

**`tests/test_signal_worker.py`**

- Replace the `respx` HTTP-mock harness with a fake-stream harness:
  - `FakeSignalClient` lives in `tests/conftest.py` (single canonical
    location so Task 3 and Task 5 share it). Async `receive_stream`
    yields from a scripted list of envelopes (deque), then optionally
    raises `ConnectionClosed` to exercise reconnect.
- New tests:
  - `test_extract_self_text_sync_message` — syncMessage.sentMessage with
    matching source+destination → text returned.
  - `test_extract_self_text_data_message` — dataMessage with matching
    source → text returned (the rare path).
  - `test_extract_self_text_rejects_other_source` — `source != self`
    → returns None (security boundary).
  - `test_extract_self_text_rejects_other_destination` —
    syncMessage with destination ≠ self → returns None.
  - `test_worker_reconnects_after_connection_closed` — fake stream
    raises ConnectionClosed once, then yields a real envelope; assert
    both backoff sleep happens (mock `asyncio.sleep`) and the second
    envelope is processed.
  - Existing tests for "appends to existing conversation within 6h" and
    "creates new conversation when gap exceeds 6h" stay, but rewritten
    against the new stream harness.

### Frontend / API contract

**None.** No new endpoint, no schema change, no `app/types/api-generated.ts`
regeneration. The frontend already only consumes the messenger-accounts
CRUD plus a generic chat conversation feed; Signal envelopes never crossed
that boundary.

## Verification Plan

In order:

1. Backend unit tests green: full `pytest` suite, no regressions.
2. Ruff + mypy clean.
3. Local sanity (`make up-local-full`): can the Worker connect to a
   dummy WebSocket and process a scripted envelope without crashing? An
   integration test against a real signal-cli-rest-api is *not* required —
   that's what step 4 is for.
4. Live verification on `haex.cloud` (single-user box, owned by user):
   - Quadlet → `MODE=json-rpc`, ansible apply with `-K`.
   - Restart `hermes-server.service` so the new worker picks up.
   - `podman exec signal-cli-rest-api curl -s localhost:8080/v1/about`
     → `mode: json-rpc`.
   - User writes Note-to-Self on their phone.
   - `podman logs hermes-server` shows a `signal_envelope_received`
     event within seconds, then `messages.append` + `agent_runner`
     activity + outbound `POST /v2/send`.
   - User sees Holzi's reply land in the same "Notiz an mich" chat.
   - DB check: at least one row in `conversations` with
     `channel='signal'` plus matching user + assistant rows in
     `messages`.

## Risks

- **Reconnect storm.** If signal-cli-rest-api restarts (`AutoUpdate=registry`
  + new image), Worker drops + reconnects. Cap backoff at 30s and log every
  reconnect attempt so we can spot a loop in the diagnostics page.
- **Envelope shape on WS differs from HTTP.** The HTTP `/v1/receive` wraps
  envelopes in `{envelope: {...}}`; the WS variant typically emits the bare
  envelope or wraps it differently. Task 4 includes recording one real
  envelope from the box and pinning the parser to that exact shape — no
  guessing from docs.
- **`InvalidMessageStructureException`** seen in upstream issue #797 for
  certain Note-to-Self edges (e.g. deletes producing empty syncMessage).
  Worker treats unparseable / unknown envelopes as no-op skips, not errors
  — log at debug level but don't surface as Diagnostics warnings.
- **Malformed JSON frames.** A bug in signal-cli-rest-api or a corrupted
  frame could yield non-JSON bytes on the WS. `json.JSONDecodeError`
  inside the stream parser is treated identically to the unknown-envelope
  case above: log at debug, skip the frame, **do not** disconnect or
  raise a Diagnostics warning. Only `ConnectionClosed`/network errors
  trigger the reconnect-backoff path.
- **Diagnostics drift.** The Plan 20 messenger check counts `is_active=true`
  rows in `messenger_accounts`. It does *not* check that the WS is actually
  connected. Out of scope for this plan, but worth a `liveness` field on
  `app.state.signal_worker` plus a `_check_messenger_worker` slice in
  Plan 28b if reliability matters later. For now: log inspection is good
  enough for a single-user box.

## Out-of-Scope Follow-Ups (deliberately deferred)

- **Plan 28b — Worker liveness in Diagnostics.** Add a `_check_messenger_worker`
  to `/api/diagnostics` that probes the WS-connected state (last successful
  frame timestamp on the worker). Small.
- **Plan 28c — Multi-sender allowlist.** Open up the Worker to handle
  envelopes where `source != self_number` if the source is on an explicit
  allowlist (DB-backed, managed via `/settings/messenger`). Needs UI work.
- **Plan 28d — Workspace-write-channel disambiguation.** Plan 13's
  `commit_message = "user[conv-N]: ..."` doesn't know whether `conv-N`
  was a Signal chat or a WebUI chat. Adding the channel to the tag is a
  papercut not worth a plan slice on its own — bundle if/when another
  workspace-write touchup happens.

## Task Breakdown

Tasks are sized for one focused commit each; subagents can take one at a
time.

### Task 1: Add `websockets` dependency

**Files:**
- Modify: `pyproject.toml` (Holzi repo) — add `websockets>=12` to the
  runtime dependency list (the section your project already uses; match
  the existing comma+newline style).
- Modify: `uv.lock` or `poetry.lock` — regenerate.

**Steps:**
1. Add the dep to `pyproject.toml`.
2. Run the project's lockfile-regen command (check `make` or `pyproject.toml`
   for the canonical command — typically `uv sync` or `poetry lock`).
3. Run `pytest -q` to confirm the existing suite still imports clean.
4. Commit `chore(deps): add websockets for Signal WS receive (Plan 28)`.

### Task 2: Refactor `SignalClient` — drop poll, add `receive_stream`

**Files:**
- Modify: `src/hermes/signal/client.py` — remove `receive()`, add
  `receive_stream()` and `_ws_url()` helper.
- Modify: `tests/test_signal_worker.py` — adapt the fixture that built
  the old `SignalClient(http, number)` to still construct it (signature
  unchanged: `__init__(http, number)`; `http` is now unused by the stream
  path but still needed for `send`).

**Steps:**
1. Write the failing test for `_ws_url()`: given `signal_url='http://signal-cli-rest-api:8080'`
   and `number='+4917…'`, returns `'ws://signal-cli-rest-api:8080/v1/receive/+4917…'`.
2. Run it — expected: FAIL (helper doesn't exist).
3. Implement `_ws_url`.
4. Add `receive_stream` skeleton that opens a WS, yields each message
   parsed as JSON, closes on exit. Use `websockets.connect` with a
   reasonable `ping_interval=20`, `ping_timeout=10` so we detect dead
   sockets fast.
5. Run the relevant unit tests — expected: green.
6. Commit `feat(signal): SignalClient.receive_stream over WebSocket (Plan 28)`.

### Task 3: Worker — switch loop to WS stream, add reconnect backoff

**Files:**
- Modify: `src/hermes/signal/worker.py` — `_run` rewrite + ctor cleanup.

**Steps:**
1. Write a failing test
   `test_worker_processes_envelope_from_stream` using `FakeSignalClient`
   (imported from `tests/conftest.py` — see Scope): script the stream
   to yield one Note-to-Self envelope; assert `process_envelope` runs
   and the conversation row gets created.
2. Run — expected: FAIL (`receive_stream` not consumed by `_run` yet).
3. Rewrite `_run` to iterate `receive_stream`; remove `poll_timeout` and
   the now-dead `convo_gap_seconds` ctor param (move the constant inline).
4. Run — green.
5. Write a failing test
   `test_worker_reconnects_after_connection_closed` — fake stream raises
   `ConnectionClosed` once, then yields. Mock `asyncio.sleep`. Assert the
   second envelope is processed and `signal_ws_disconnected` was logged.
6. Run — FAIL (no reconnect logic).
7. Add the `while not self._stop.is_set()` outer loop + try/except around
   `async for envelope in stream`. On `ConnectionClosed` (or generic
   `Exception` that isn't `CancelledError`): log + backoff + retry. Reset
   backoff to 1s on each successful frame.
8. Run — green.
9. Commit `feat(signal): WebSocket-based receive loop with reconnect backoff (Plan 28)`.

### Task 4: Record a real envelope shape from the box

**Files:**
- New (temporary): `tests/fixtures/signal_envelopes/note_to_self.json` —
  recorded sample envelope from the live signal-cli-rest-api WS.

**Steps:**
1. On `haex.cloud`, with `MODE=json-rpc` already live (apply Ansible from
   Task 9 *before* this task, or use a side-Quadlet for the recording
   only): `podman exec hermes-server python3 -c "
   import asyncio, websockets, json
   async def go():
       async with websockets.connect('ws://signal-cli-rest-api:8080/v1/receive/+4917…') as ws:
           for _ in range(5):
               raw = await ws.recv()
               print(json.dumps(json.loads(raw), indent=2))
   asyncio.run(go())
   "`
2. User writes a Note-to-Self while the script is running.
3. Capture the printed envelope; save to fixture file.
4. Confirm parser in `_extract_self_text` (Task 5) reads the actual fields.
5. Commit `test(signal): record live Note-to-Self envelope fixture (Plan 28)`.

This is intentionally out of order with the implementation tasks — it's
the only step that needs the real box, so it pre-empts the parser tuning.

### Task 5: `_extract_self_text` — both envelope shapes + security boundary

**Files:**
- Modify: `src/hermes/signal/worker.py` — replace
  `_extract_note_to_self_text` with `_extract_self_text`.
- Modify: `tests/test_signal_worker.py` — new test cases (see Scope).

**Steps:**
1. Write failing test for the syncMessage path using the Task 4 fixture.
2. Run — FAIL.
3. Implement the syncMessage branch. Use `.get()` chains, don't trust the
   envelope shape.
4. Run — green.
5. Add the four other tests (dataMessage, source-mismatch reject,
   destination-mismatch reject, both-empty returns None).
6. Run — confirm green / fix gaps as needed.
7. Commit `feat(signal): accept Note-to-Self via syncMessage.sentMessage (Plan 28)`.

### Task 6: Remove the now-dead HTTP-poll test harness

**Files:**
- Modify: `tests/test_signal_worker.py` — remove the old `respx` mocks
  used by the HTTP-poll tests.
- Modify: `tests/conftest.py` if it imports `respx` only for these tests.

**Steps:**
1. Run `pytest tests/test_signal_worker.py -v` — confirm all currently
   green tests stay green after removing the dead imports.
2. Run `ruff check`.
3. Commit `chore(signal): drop respx mocks left over from HTTP-poll era (Plan 28)`.

### Task 7: Full backend suite + ruff + mypy

**Files:** none new.

**Steps:**
1. `pytest -q` — full suite green.
2. `ruff check`, `ruff format --check`.
3. `mypy src/hermes/signal/` (or however the project runs type-check).
4. If everything green: commit nothing (already committed in earlier tasks);
   if anything red: fix in a focused commit and re-run.

### Task 8: Quadlet — back to `MODE=json-rpc`

**Files:**
- Modify: `roles/holzi/templates/quadlet/signal-cli-rest-api.container.j2`
  (ansible repo) — `Environment=MODE=json-rpc`, comment rewritten to
  reflect "Holzi uses WebSocket receive on /v1/receive, HTTP-poll is
  intentionally not used".

**Steps:**
1. Edit the file.
2. `cd /home/haex/Projekte/ansible && git diff` — sanity check the patch.
3. `ansible-playbook -i inventory/haex.cloud.yml haex.cloud.play.yml \
    --tags holzi -K --check --diff` — dry-run.
4. Commit in ansible repo (separate from Holzi backend commits):
   `quadlet(holzi): signal-cli-rest-api MODE=json-rpc for WS receive (Plan 28)`.

### Task 9: Live verification on the box

**Files:** none — production roll.

**Steps:**
1. `ansible-playbook … --tags holzi -K` (real run, not check).
2. On the box as `haex-service`:
   - `podman exec signal-cli-rest-api curl -s localhost:8080/v1/about`
     → expect `"mode":"json-rpc"`.
   - `systemctl --user restart hermes-server.service` (so it picks up
     the new worker version from the next image pull).
3. User writes a Note-to-Self.
4. Within ~5s: `podman logs --tail 50 hermes-server` should show
   `signal_envelope_received` (or whatever final event name lands in
   Task 3) + agent activity + outbound send.
5. Reply lands on the phone in "Notiz an mich".
6. Sanity:
   ```bash
   podman exec hermes-server python3 -c "
   import sqlite3
   c = sqlite3.connect('/data/hermes.db')
   print(c.execute(\"SELECT id, datetime(updated_at,'unixepoch') FROM conversations WHERE channel='signal' ORDER BY updated_at DESC LIMIT 3\").fetchall())
   "
   ```
   → at least one row, dated now.

### Task 10: Plan-doc + roadmap README update + memory correction

**Files:**
- Modify: `docs/plans/holzi-agent-parity/28-signal-websocket-receive.md`
  — flip `Status: Planned` to `Status: Merged YYYY-MM-DD` with PR links.
- Modify: `docs/plans/holzi-agent-parity/README.md` — add Plan 28 to the
  Completed section with the merged line, mirroring the style used for
  Plans 20/20-A/20-B/20-C/25.
- Modify: `~/.claude/projects/-home-haex-Projekte-holzi-frontend/memory/reference_signal_linked_secondary_limits.md`
  — current memory says "signal-cli filters syncMessages always, fix is
  own Holzi number". Both claims are wrong post-Plan 28. Rewrite the
  memory to reflect the WS-receive contract and the auth-via-self-source
  invariant. Or delete it and write a fresh `reference_signal_ws_receive.md`
  with the right framing.

**Steps:**
1. After Task 9 verified green: do the doc edits.
2. Run `git diff docs/plans/`.
3. Commit `docs(plan-28): mark merged + memory correction`.
