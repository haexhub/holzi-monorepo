# Plan 35: Strategic Roadmap Revision (2026 H2)

> **For Claude:** META-PLAN. This is **not** an implementation plan. It
> defines six waves (0–E) of subsequent implementation plans. Each
> wave gets its own family of plan files when started. Wave boundaries
> are revision points — re-evaluate priorities before opening the next
> wave.

Status: **Planned. Strategy / sequencing only.** No code touched by this
plan. **Wave 0 (i18n), Wave A (A1/A2/A3 — Plans 36/37/38), Wave B1
(Plans 29-D + 29-D-A), Wave B2 (Plan 39), and Plan 40 (Composer Redesign)
all shipped by 2026-06-06.**
Next executable slice: **Wave C1** (multi-user / family-mode foundation).

## Genesis

Triggered 2026-06-04 by a competitive analysis against **OpenClaw**
(`openclaw.ai`), **IronClaw** (`nearai/ironclaw`), **Nanobot**
(`HKUDS/nanobot`), and **NanoClaw** (`nanocoai/nanoclaw`). The original
trigger was a request to ship 3+ default personas (Plan 29-A follow-up).
Investigation revealed that the persona surface is a thin layer over a
much larger gap: Holzi's *surrounding* features (onboarding, skill
discovery, multi-user, subagents) lag the field even though its core
prompt-composition model is competitive.

Short version, by tool:

- **OpenClaw**: CLI onboarding wizard + Markdown identity files
  (`SOUL.md`/`IDENTITY.md`/`USER.md`/`AGENTS.md`) per workspace +
  multi-agent bindings.
- **IronClaw**: `BOOTSTRAP.md` self-deleting first-chat onboarding +
  agent-mutable `USER.md` profile + `*-setup` skills.
- **Nanobot**: ClawHub vector-search **skill marketplace** + 12 bundled
  skills + `modelPresets` + `/model <preset>` slash command.
- **NanoClaw**: Multi-user via `user_roles` + `agent_group_members`,
  per-agent container isolation, deterministic prompt composition.

## Hauptziel

**OSS-Produkt mit Usern.** Decided by the user 2026-06-04. Changes the
calculus from „personal scratch-my-own-itch" to „competitive feature
surface". Plans are sequenced by user-facing impact per session of
work, not by architectural neatness.

## Migration Policy

**No backward compatibility. No legacy carry-over.** Every plan in
this roadmap is free to drop columns / tables and recreate them
cleanly, change wire contracts without versioning shims, re-seed
defaults after schema changes, and assume the user accepts
re-onboarding after a major migration.

Rationale: Holzi has no production user base to protect yet. Clean
cuts are cheaper than migration logic, easier to review, and reduce
the risk of half-state bugs. When the user base grows enough to make
this painful, this policy gets revised — but not preemptively.

See [[feedback-no-backward-compat]].

## Failure Policy

**Explicit failure over silent recovery.** Decided by the user
2026-06-04 during the Wave B revision. When the user picks a model /
provider / persona, we run with exactly that. If a provider 429s,
times out, or returns an error, the user sees the actual error +
a hint to try a different model — never a silent fallback / retry
against a different model. Holzi does not pretend to be more reliable
than its dependencies are.

See [[feedback-explicit-failure]].

## Competitive Position

Where Holzi leads (USPs to defend, not water down):

1. Rootless Podman sandbox (no Docker daemon needed)
2. German-first UI + i18n (Wave 0 lands DE/EN, more languages later)
3. Integrated Tasks/Cron + Diagnostics + Insights/Logs as first-class
   `/settings/*` panels
4. Channels (web/task) as clean abstraction with per-channel persona
   defaults
5. **Always-learning agent with searchable memory** (Hermes' core
   USP) — the agent learns user-specific facts into the Notes store
   continuously and retrieves them on demand via `memory_search`,
   instead of cramming a `USER_PROFILE` blob into every system prompt.
   See [[feedback-memory-search-not-prompt-inject]].
6. Single-binary self-hosting story (one container = one user = one
   worker; multi-user planned for Wave C)

Where Holzi lags (this roadmap addresses, in order):

1. **No i18n** — UI is German-only, blocking non-DACH OSS reach (Wave 0)
2. **No onboarding** — new users hit an empty `/settings/preferences`
   (Wave A)
3. **Persona is one prompt blob** — not structured into voice /
   identity / rules (Wave A1)
4. **Skills are persona-pinned and loaded blindly** —
   token-wasteful, risks „forgotten skill" lock-in. Resolved via
   Wave-A2's lazy-load catalog. See [[feedback-lazy-load-skills]].
5. **No per-persona model pin and no clear error UX** — Wave B
6. **Single-user only** — blocks family/team self-hosting (Wave C)
7. **No skill discovery / import** — Plan 33 ships CRUD, no
   marketplace integration (Wave D)
8. **No subagent orchestration** — Plan 10 ships event taxonomy +
   cards but no spawning (Wave E)

## The Six Waves

### Wave 0 — i18n Foundation **(done 2026-06-04)**

**Status**: Plan 30 fully on `main` — Tasks 1 + 2 + 3 + 4 + 5 done.
Final commits: backend `893991d`, frontend `5f9f042` (helper + composables),
frontend `dc76475` (Task 5 sweep). 448 vitest, 860 pytest, ruff + mypy
clean, `pnpm typecheck` exit 0. **Note**: backend went with
`ErrorCode`-enum + `{code, params}`-detail rather than
`Accept-Language` parsing — backend stays locale-agnostic and the FE
owns translation. Every plan from Wave A on inherits both the bilingual
UI convention and the `ErrorCode`/`translateError` contract.

**Goal**: Every plan after this ships bilingual (DE/EN) from the first
commit. New users from non-DACH markets see Holzi in their language
out of the box.

**Why first**: Foundational shift — every subsequent plan touches UI
strings or backend error messages. Doing it now means each later
plan adds i18n-ready strings by default; deferring means backfilling
every plan we wrote in between.

**Content**: Existing Plan 30 (i18n-Foundation), re-aligned as Wave 0.
`@nuxtjs/i18n` set up, all current UI strings extracted into locale
files, backend `ErrorCode`-enum + `translateError(err, t)`-helper,
language picker in `/settings/preferences`.

**Effort spent**: 5 sessions cross-repo (foundation + 4 sub-tasks).

### Wave A — Onboarding Foundation

**Goal**: A fresh install greets the user, learns who they are, and
ships an opinionated starter persona — without requiring them to read
docs or visit `/settings/preferences` first.

**Why second**: Highest user-facing impact per unit of work after
i18n. Other waves all assume the user has gotten past first-launch.

#### A1 — Persona-Fragments (DB-Spalten + History) — **done 2026-06-05**

Shipped as [Plan 36](./36-personas-fragments.md). Branch
`wave-a1-personas-fragments` in both repos carries the cross-repo
work (BE: 8 commits, FE: 7 commits). 884 backend pytest + 461
frontend vitest + ruff + mypy + typecheck all clean. Pending PR
review + merge.

Replace `personas.prompt` (single text column) with three typed
columns:

- `soul` — voice / tone / boundaries
- `identity` — name / vibe / emoji
- `agents` — operating rules

Storage stays in the DB. Resolver composes them with named section
headers in the system prompt. No `user_profile` column — see Failure
Policy + [[feedback-memory-search-not-prompt-inject]]: dynamic
user-context lives in the Notes store, retrieved on demand via
`memory_search`, never injected statically.

Add `persona_history` table — every write to a persona writes a
snapshot (timestamp + author + diff). `/settings/preferences` grows
a „Verlauf"-tab per persona for rollback + compare. Recovers the
„git versioning of persona" value without coupling to a real git
repo or filesystem.

**Why DB and not MD-Files**: Resolver runs on every chat turn;
reading from sandbox-mounted files would couple chat-availability
to sandbox-availability and add latency. Multi-user (Wave C) is
`WHERE user_id = ?` with DB, file-mount-per-user with files.
Subagents (Wave E) inherit from DB trivially.

**Drop `persona_skills` table.** Skills are universally available
via the Wave-A2 catalog mechanism — no Persona-pinning.

**Est. effort**: 1 session cross-repo.

#### A2 — Skill-Catalog (lazy-load) + Bootstrap-Skill **[done 2026-06-05, Plan 37]**

Two related changes that ride the same mechanism:

**Skill-Catalog mechanism**: The system prompt contains only a
*catalog index* — for each skill, a one-line `name + description +
when_to_use` summary (~15–25 tokens per skill, ~400 tokens for 20
skills). Body stays in the DB. New built-in tool `skill_load(name)`
returns the full markdown body as tool-result, which then sits in
conversation context from that point on. Optional
`skill_search(query)` queries all skill bodies via FTS5 (Plan 15's
mechanism) for „I'm not sure which skill applies".

This is the Anthropic Agent SDK / MCP pattern (description in
prompt, schema/body lazy-loaded on demand) applied to skills.
Replaces the „attach skills to personas" model and resolves the
token-explosion problem.

**Bootstrap-Skill**: Built-in skill `bootstrap-first-chat`, surfaced
in the catalog. On first user message in a fresh conversation where
`users.bootstrap_completed = 0`, the agent loads it, runs a 3–5
question Q&A (one question at a time), writes `soul` + `identity`
via a new `persona_update` tool, optionally writes 1–3 starter
notes about the user via the existing notes tools (NOT into persona
— into searchable memory), then flips `bootstrap_completed = true`
and falls silent in subsequent conversations.

**Why both in A2**: Bootstrap depends on the catalog mechanism
existing — it's the first thing the catalog loads, and demos the
pattern end-to-end (load skill → execute → write artifacts → exit).

**Est. effort**: 2 sessions cross-repo.

#### A3 — Curated Starter Skill Library

**Status**: Plan 38 fully on `wave-a3-starter-skills` — merged 2026-06-05. 9 skills in catalog (bootstrap + 8 starters). Wave A complete.

Ship ~6–10 built-in skills as catalog entries, covering common
Holzi use cases:

- `code-review` — review diffs / PRs / single files
- `web-research` — structured web research with source tracking
- `socratic-dialogue` — philosophical / coaching conversations
- `writing-feedback` — prose / essay / email feedback
- `summarize-source` — condense a URL / file / paste
- `daily-journal` — reflection / journaling prompts
- `recipe-helper` — cooking / meal planning (family-friendly)
- `learn-explain` — teach a topic at the user's level
- (others as needs surface)

Each ships as a `skills`-table row with body + frontmatter (prepares
Wave-D import format). Universally accessible via catalog. Bootstrap
(A2) doesn't attach them — they're just available, the agent
decides when to load.

**Why this isn't role-bundles**: A user is a developer AND a
philosopher AND a parent — role bundles would force-pick one
identity. Granular skills compose freely with the lazy-load
catalog.

**Est. effort**: 1 session for skill format finalization +
~1 session for the 6–10 skill bodies.

**Wave A success criteria**:

- New install + first chat → user sees IronClaw-style Q&A onboarding
- After bootstrap, `/settings/preferences` shows the user's filled
  persona (three fragments) + a „Verlauf"-tab
- Skills page shows ~10 catalog entries; chat agent demonstrably
  loads `code-review` only when reviewing code, not on every turn
- System-prompt token count for a fresh conversation stays under
  1k tokens even with 20 skills installed
- Effective-prompt panel on `/settings/preferences` shows composed
  `soul` + `identity` + `agents` + skill-catalog-index + channel

### Wave B — Per-Persona Model + Explicit Error UX

**Goal**: Each persona has its own model pin. When the upstream
provider errors, the user sees the actual error + a hint to try a
different model. No silent fallback.

**Why this size**: Slimmed from the original three-plan Wave B after
the user's „explicit failure over silent recovery" directive
(2026-06-04). Fallback-chain dropped entirely.

#### B1 — Plan 29-D activated (Modell pro Persona) **(done 2026-06-05)**

Already planned in `29d-persona-llm-and-model.md`. Wave B1 = execute
it. `personas.llm_credential_id` + `personas.model`, resolver
returns `PersonaContext { credential, model }` alongside the system
prompt. Two dropdowns per persona card on `/settings/preferences`.

**Status**: Done. BE Holzi#76 + FE #96 merged 2026-06-05; refactor
follow-up Plan 29-D-A (`29da-modelselect-reuse.md`) reused the existing
`SettingsModelSelect` combobox (FE #97), and review-fix #98 restored the
a11y label association + a clearable "use credential default" entry.
**Next executable slice is B2** below.

#### B2 — Slash-Command Picker + Improved Error UX **(done 2026-06-06)**

Two related changes:

**Slash-Command picker**: Composer commands `/model <name>` and
`/persona <name>` override the resolved model/persona *for the next
turn only*, not persisted to DB. A pill in the chat header shows
the active persona + model, click opens a picker popover.

**Improved error UX**: When the upstream LLM returns 429 / 5xx /
network-error / mid-stream-disconnect, the chat shows an error
card with:

- the actual provider error (sanitized — no secrets / no internal
  paths)
- a hint: „Versuch's mit einem anderen Modell" + link to
  `/settings/preferences` (model dropdown) and inline help for the
  `/model` slash command

No fallback chain. No silent retry. Errors are errors. See
[[feedback-explicit-failure]].

**Wave B success criteria**:

- Per-persona model pin works; switching personas mid-conversation
  changes the model on next turn
- `/model <name>` overrides for one turn, doesn't persist
- An Anthropic 429 surfaces a friendly error card with model-switch
  hint, no silent retry

### Wave C — Multi-User (Family-Mode)

**Goal**: A family admin installs Holzi once, then invites partner /
kids / parents as additional users. Each user has their own
conversations, memory, personas. Shared workspaces optional.

**Why before D and E**: The `app.state.*` invariants (cancel
registry, approval-futures, SSE buffers, sandbox manager) get
harder to refactor with every feature added on top. C is structural
debt; defer it and D/E need rework.

**Why this is the biggest wave**: Breaks the documented „one
container = one user = one worker" architecture principle. Every
endpoint gets a `user_id` scope. Every `app.state.*` Map becomes
per-user. Sandbox-Manager / Scheduler / Approval-Futures all need
user-namespacing.

#### C1 — Account-Layer + User-scoped DB

New plan. `users` table (id, email, password_hash, role, created_at,
parent_user_id for family hierarchy). All user-data tables
(`conversations`, `personas`, `persona_history`, `agent_tasks`,
`notes`, `workspaces`, `llm_credentials`, `mcp_servers`, `skills`,
`channel_prompts`, `sandbox_crashes`, `tool_approvals`) get a
required `user_id` foreign key + index — schema change drops and
recreates the affected tables; defaults re-seed for the bootstrap
admin user on first boot.

#### C2 — Family-Admin Inviting + Role Model

New plan. `/settings/family` (new Control Center entry). Admin
invites via email or one-time pairing link. Roles: `admin`,
`member`, `child`. `child` is family-mode-specific: enforces
approval on every tool call regardless of `tool_approvals`
config.

#### C3 — Per-User app.state Isolation + Per-User Resources

New plan. Refactor `app.state.cancel_registry`, `approval_futures`,
`sse_buffers`, `sandbox_manager` from single dicts to `dict[user_id,
…]` Maps. Per-user sandbox containers (one Podman container per
*active* user, not per session — bounded by `MAX_ACTIVE_USERS`
env). Per-user `mcp_manager` (so a family member can't see another
user's GitHub MCP). Workspace sharing: `workspace.owner_id` +
`workspace.shared_with: user_id[]` (default empty).

**Wave C success criteria**:

- Two browsers logged in as two family members each see their own
  conversation list, personas, notes
- Admin can see family roster + revoke
- Sandbox crash for User A doesn't surface to User B's diagnostics
- Fresh bootstrap on a clean DB seeds a working admin user and the
  Wave-A onboarding flow runs for them

### Wave D — Skill Marketplace

**Goal**: A user types „I need to scrape websites" in chat → agent
discovers, fetches, and installs a community skill (with approval),
within seconds.

**Why before Subagents**: Skills are the discoverability story for an
OSS product. ClawHub is Nanobot's deepest moat. Holzi's skill
system (Plan 33 + Wave A2 catalog) is the right shape but ships
with zero discovery.

#### D1 — Skill-Frontmatter-Standard (OpenClaw-/Nanobot-kompatibel)

New plan. Require YAML frontmatter on every skill (`name`,
`description`, `homepage`, `version`, `license`, `requires.tools`,
`metadata`). `skills.body_markdown` parses frontmatter at write
time into typed columns; the body keeps only the prose. The Wave-A3
starter skills get rewritten to this format. Adopting the
OpenClaw/Nanobot/ClawHub format means future imports cost zero
conversion effort.

#### D2 — Skill-Import (URL only)

New plan. `POST /api/skills/import` accepts a URL pointing at a
Markdown file with frontmatter. Tar.gz / Git-URL dropped — URL-only
is enough, smaller attack surface. Import flow is approval-gated
(rides Plan 21); imported skill lands disabled by default. Agent
meta-tool `skill_install(url)` exposes it as Holzi-can-self-
provision.

#### D3 — Optional: Registry-Endpoint or ClawHub-Bridge

New plan. Either:

- Bridge: `POST /api/skills/import?source=clawhub&slug=…` proxies
  the Nanobot `clawhub` skill's API. Cheapest path. Cedes registry
  control.
- Own: `holzi-skills.org` (or similar) — own a vector-searchable
  index of community-submitted skills with moderation. Most work.

Decide at D3-plan-time. Likely start with the bridge.

**Wave D success criteria**:

- Existing skills survive the frontmatter migration cleanly
- `skill_install` agent tool can land a new skill from a URL
- `/settings/skills` grows „Skill importieren"-Button (URL input)

### Wave E — Subagents

**Goal**: An agent task that asks „review this entire codebase" spawns
4 parallel subagents (one per top-level dir), aggregates findings,
returns a synthesized report. Each subagent runs in its own sandbox.
Plan 10's subagent event cards finally have something to render.

**Why last**: Needs stable sandbox isolation (done — Plan 11b),
stable multi-user (Wave C — so subagents can't escape one user's
scope), stable tool catalog (done — Plan 32), and a stable skill
story (Wave D).

#### E1 — Orchestrator-Tool: `spawn_subagent`

New plan. The current chat-agent IS the orchestrator (decided
2026-06-04) — no separate „orchestrator persona" concept. The
current agent gains a new built-in tool
`spawn_subagent({prompt, persona_id?, tool_allowlist?, timeout_s})`
that runs an isolated agent loop in a fresh sandbox container and
returns its final response as a structured tool-result. Subagent
calls emit the Plan-10 SSE events already in the wire contract.

**Why same-agent orchestration**: Simpler model. Any persona can
orchestrate when the task benefits. No separate „switch into
orchestrator mode" UX. Aligns with how Claude Code's `Agent`
tool works.

#### E2 — Subagent-Sandbox-Topologie + Result-Aggregation

New plan. Spawns ≤ N concurrent subagents (env-capped by
`MAX_CONCURRENT_SUBAGENTS`). Each gets a read-only mount of the
parent's workspace + its own scratch dir. Aggregation:
orchestrator gets each subagent's final response + metadata
(turns, tool calls, errors) as structured tool-result, can ask
for refinements, synthesizes.

#### E3 — Multi-Subagent-Cards-UI

Plan-10 cards already render a single subagent; extend to the
multi-subagent fanout: collapsible group card showing N subagent
chips with status + result, expand to see each subagent's full
transcript.

**Wave E success criteria**:

- A user prompt that needs cross-dir analysis fans out automatically
  via the orchestrator
- Subagents that crash don't take the parent down
- Each subagent costs accounted in `agent_runs` with `parent_run_id`
  set (Plan 03b extension — likely needs a follow-up)

## Dependency Graph

```
Wave 0: i18n   (foundational; gates all later UI work for bilingual) ✓ done 2026-06-04
Wave A: A1 → A2 → A3
        A1 → B1 (per-persona model needs structured persona — but B can
                 also run independent of A2/A3)
Wave B: B1 → B2
Wave C: A3+B2 → C1 → C2 → C3
        (C waits on A+B because retrofitting Multi-User costs less
         than retrofitting A+B onto Multi-User)
Wave D: A1+D1 → D2 → D3
        (D1 standardises the format A3 introduces)
Wave E: C3 → E1 → E2 → E3
        (E needs Multi-User done to scope subagent permissions)
```

## Out of Scope (for this revision)

- **Plan 17 (Cline/Roo first-class channel)** — orthogonal, can run
  in any wave. Punted because it's a channel concern, not a roadmap
  concern, post-Plan-34's messenger removal.
- **Plan 18 (Profiles/Spaces)** — README says „do not implement
  unless a use case appears". Multi-user (Wave C) supersedes it.
- **Plan 19 (Production Hardening)** — would benefit from happening
  *before* Wave C, but not prioritized. Re-evaluate at Wave-B-end.
- **Plan 23 (Composer-Chips)** — useful but cosmetic; not on the
  competitive critical path.

## Open Questions

These need answering at wave-plan time, not now:

- **A1**: do we want fragment-naming exactly `soul`/`identity`/
  `agents` or use German names (`stimme`/`identitaet`/`regeln`)? UI
  copy is bilingual via Wave 0 anyway, but column names are
  permanent.
- **A2**: how do we make the bootstrap skill resilient to user
  derailing („tell me a joke") mid-onboarding without making it
  brittle? Probably: bootstrap skill says „I'll set Holzi up first
  then we can chat freely" if user goes off-script, and bails out
  gracefully if the user explicitly says „skip".
- **A3**: which 6–10 starter skills exactly? List above is
  illustrative; final list debated at A3 plan time.
- **C1**: auth model — JWT? session cookies? Existing bearer token
  scheme extended to multi-user? Needs its own design-doc before
  C1's implementation plan.
- **C3**: per-user sandbox memory cost on a small host — does
  family-onboarding need a „max concurrent users" guidance?
- **D3**: bridge vs own registry. Bridge first; revisit if community
  forms.

## Resolved Decisions (2026-06-04 brainstorm)

- Hauptziel: OSS-Produkt mit Usern
- Migration Policy: no backward compat
- Failure Policy: explicit failure, no silent fallback
- Persona-Storage: DB-Spalten (3 typed columns) + `persona_history`
  table, *not* MD files in workspace
- Skill model: lazy-load catalog + `skill_load(name)` tool, NOT
  per-persona attachment; drop `persona_skills` table
- USER-context: lives in Notes (searchable), never injected into
  system prompt — `memory_search` is the retrieval primitive
- A3 starter skills: granular catalog, not role bundles
- E1 orchestrator: the current chat-agent IS the orchestrator
- D2 import: URL-only, no tar.gz / Git
- i18n: Wave 0, before everything else
- Wave order: 0 → A → B → C → D → E

## Risk Register

| Risk | Mitigation |
|---|---|
| Bootstrap-skill triggers on every fresh conversation, annoying returning users | `users.bootstrap_completed` flag, set true after first run. Re-trigger only on explicit persona reset. |
| Lazy-load catalog still inflates prompt if user installs 100s of skills | Per-user soft cap (env-tunable); user can disable skills from catalog without deleting them. |
| Skill-import is a security hole | Approval-gated (Plan 21), default-disabled, frontmatter validated, body size capped, no executable content. |
| Subagents spawn unbounded sandboxes, OOM the host | E2 env-caps `MAX_CONCURRENT_SUBAGENTS`. Orchestrator queues beyond cap. |
| Each wave wipes user-visible state (no backward compat) | Documented up front in Migration Policy. User accepts re-onboarding per major migration. |
| Roadmap obsolete after Wave A — competitive landscape shifts | Doc is revised at wave boundaries, not at plan boundaries. Each wave-end is a re-evaluation point. |

## How to Use This Doc

- **Wave-start checklist**: Before opening the first plan-file of a
  wave, re-read this doc's Open Questions for that wave and resolve
  them in the plan file's Goal/Non-Goals section.
- **Wave-end checklist**: After the last plan-file of a wave merges,
  update the success-criteria below the wave's heading (add
  „**Wave X completed YYYY-MM-DD**") and re-evaluate the next wave's
  priority before committing.
- **Plan-file naming**: Wave-0 = existing Plan 30. Wave-A plans
  start at Plan 36 (A1), Plan 37 (A2), Plan 38 (A3). Sub-plan suffix
  `-a`/`-b`/`-c` allowed per existing convention.

## Decision Log

- 2026-06-04: Hauptziel „OSS-Produkt mit Usern" picked (vs personal
  / learning / commercial).
- 2026-06-04: Wave order 0 → A → B → C → D → E.
- 2026-06-04: No backward compatibility — Migration Policy section.
- 2026-06-04: Roadmap-overview-only first (this doc), per-wave plans
  later.
- 2026-06-04: Skills lazy-loaded via catalog, not persona-attached.
- 2026-06-04: Persona-storage DB-columns + `persona_history` table,
  not MD files.
- 2026-06-04: USER-context goes to Notes + `memory_search`, not into
  system prompt.
- 2026-06-04: A3 = granular skill library, not role bundles.
- 2026-06-04: E1 orchestrator = current chat-agent, no separate
  persona.
- 2026-06-04: D2 import URL-only.
- 2026-06-04: B fallback-chain dropped — Failure Policy section.
- 2026-06-04: i18n moved up to Wave 0.
- 2026-06-04: Wave 0 / Plan 30 shipped — backend went with
  `ErrorCode`-enum + `{code, params}`-detail-shape instead of
  `Accept-Language` parsing, so the backend stays locale-agnostic
  and the FE owns translation. `tests/i18n/error-codes.test.ts` pins
  FE↔BE coverage so a new enum member without locale entries breaks
  CI immediately.
