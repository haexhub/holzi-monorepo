# Per-Model Thinking Picker (Frontend) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the composer's Thinking Effort picker capability-aware — show it only for models that support extended thinking, render the levels the backend reports, and never send a stale budget for a non-thinking model.

**Architecture:** Backend PR #79 (merged) extended `/api/models` so every `ModelEntry` now carries `provider: string` and `thinking: { supported: boolean; levels: string[] }`. The frontend currently ignores this: `CommandPicker.vue` renders a hardcoded `none/low/medium/high` Thinking Effort section for every model. This plan (1) regenerates `app/types/api-generated.ts` to pick up the new fields, then (2) teaches `CommandPicker` to resolve the *effective* model (`override?.model ?? defaultModel`), look up its `ModelEntry`, and render the Thinking Effort section only when `thinking.supported` is true — building the level buttons from `thinking.levels` plus a synthetic `none` option. Selecting a model that can't think strips a stale `thinkingBudget` from the override.

**Tech Stack:** Vue 3 / Nuxt 4, TypeScript, reka-ui Popover, Vitest + `@vue/test-utils` (`tests/components/`), `openapi-typescript` via `pnpm run gen:api`.

**Design decisions (locked in with the user):**
- Non-thinking model → **hide** the Thinking Effort section entirely (no disabled/greyed variant).
- Switching to a non-thinking model → **auto-clear** `thinkingBudget` from the override.
- Render level buttons **from `thinking.levels`** (+ a synthetic `none`), not a hardcoded array.

**Out of scope (explicitly):**
- No change to how `thinking_budget` is sent on the wire — `useChatStream.ts` already forwards it; backend #79 handles provider dispatch and silently drops it for unsupported models.
- The `provider` field is surfaced in the type but this plan does not render it anywhere (no UI requirement yet). Adding it now is YAGNI.
- Persona-switch-driven default-model changes that orphan a `thinkingBudget` are left to the backend's drop behaviour (see Task 3 note); only the in-picker model switch auto-clears.

---

## Pre-flight: regenerate API types against merged backend

The new `/api/models` shape only exists on backend `main` (PR #79 merged). The local Holzi checkout is on a stale branch, so update it before generating.

### Step 1: Bring local backend to merged main

```bash
cd /home/haex/Projekte/Holzi
git stash --include-untracked   # if the tree is dirty; otherwise skip
git checkout main
git pull --ff-only
```

Verify #79 landed:

```bash
git log --oneline -3 | grep -i thinking
ls src/hermes/thinking.py        # must exist
```

Expected: `thinking.py` exists and a recent commit mentions per-model thinking.

### Step 2: Regenerate the frontend API types

Per the project's `gen:api` ritual, start the backend on the non-default port in one shell:

```bash
cd /home/haex/Projekte/Holzi && \
  HERMES_AUTH_TOKEN=test-token-for-openapi \
  HERMES_DB_PATH=$(mktemp --suffix=.db) \
  uv run uvicorn hermes.main:app --host 127.0.0.1 --port 18082 --log-level warning
```

In a second shell, from the frontend repo:

```bash
cd /home/haex/Projekte/holzi-frontend
HERMES_AUTH_TOKEN=test-token-for-openapi HERMES_URL=http://127.0.0.1:18082 pnpm run gen:api
```

Then stop the backend (Ctrl-C in the first shell).

### Step 3: Verify the generated type

Run: `grep -A12 '/\*\* ModelEntry \*/' app/types/api-generated.ts`

Expected: `ModelEntry` now contains `provider: string;` and a `thinking` object referencing a `ThinkingSupportDTO`-style shape with `supported: boolean;` and `levels: string[];`.

> If `gen:api` can't be run (no `uv` / backend won't boot), hand-edit `app/types/api-generated.ts`: add `provider: string;` and `thinking: { supported: boolean; levels: string[] };` to `ModelEntry`, and add the `ThinkingSupportDTO` schema if the generator would have referenced it. Note in the commit that types were hand-patched and a real `gen:api` should follow.

### Step 4: Commit the regenerated types

```bash
git add app/types/api-generated.ts
git commit -m "chore(types): regen api types for per-model thinking (provider + thinking)"
```

> Adding required fields to `ModelEntry` will break the type-check of any test fixture that builds a bare `ModelEntry`. That is fixed in Task 1.

---

## Task 1: Fix existing fixtures + pin the new shape

Adding `provider` + `thinking` as required fields makes every existing `ModelEntry` literal a type error. Fix the fixtures first so the suite compiles, and add a fixture that carries the new fields for later tasks.

**Files:**
- Modify: `tests/components/ChatCommandPicker.test.ts` (the `model` fixture, ~line 18)
- Modify: `tests/components/ChatComposer.test.ts` (any `ModelEntry` fixture)
- Check: any other file building a `ModelEntry` — find with the command below

**Step 1: Find every ModelEntry literal**

Run: `grep -rn "ModelEntry" tests/ app/ | grep -v api-generated`
Expected: a small list (the two test files above plus prop typings). Only literals (object construction) need updating.

**Step 2: Run the type-check to see the failures**

Run: `pnpm run typecheck` (or `pnpm test` — Vitest type-checks on import)
Expected: errors like `Property 'thinking' is missing in type` on the `model` fixtures.

**Step 3: Update the fixtures**

In `tests/components/ChatCommandPicker.test.ts`, change the `model` fixture to a thinking-capable model and add a non-thinking one:

```typescript
const model: ModelEntry = {
  id: 'claude-opus-4-8', credential_id: 1, credential_name: 'Default',
  provider: 'anthropic',
  thinking: { supported: true, levels: ['low', 'medium', 'high'] },
}

const nonThinkingModel: ModelEntry = {
  id: 'gpt-4o', credential_id: 1, credential_name: 'Default',
  provider: 'openai',
  thinking: { supported: false, levels: [] },
}
```

Apply the same `provider` + `thinking` additions to every `ModelEntry` literal `grep` found (e.g. in `ChatComposer.test.ts`). Use `supported: true` with `levels: ['low','medium','high']` unless the test specifically needs a non-thinking model.

**Step 4: Verify the suite compiles and passes**

Run: `pnpm test -- tests/components/ChatCommandPicker.test.ts tests/components/ChatComposer.test.ts`
Expected: PASS (behaviour unchanged so far — only fixtures updated).

**Step 5: Commit**

```bash
git add tests/components/ChatCommandPicker.test.ts tests/components/ChatComposer.test.ts
git commit -m "test: extend ModelEntry fixtures with provider + thinking"
```

---

## Task 2: CommandPicker resolves effective model + hides unsupported thinking

Teach `CommandPicker` to know the effective model and gate the Thinking Effort section on its capability, rendering levels from the backend.

**Files:**
- Modify: `app/components/chat/CommandPicker.vue`
- Modify: `app/components/chat/ChatComposer.vue` (pass the default model down)
- Modify: `app/components/ChatHub.vue` (it already has `chatContext.model`; confirm it reaches the composer — it does via `:model`)
- Test: `tests/components/ChatCommandPicker.test.ts`

### Step 1: Write the failing tests

Add to `tests/components/ChatCommandPicker.test.ts`. These mount the picker, open the popover (portaled to `document.body`), and assert on the Thinking Effort section. Use the i18n mock already in the file (`t` returns the key), so the section heading key is `components.chatHub.commandPicker.sections.thinkingEffort` and level labels are `components.chatHub.commandPicker.thinkingEffort.<level>`.

```typescript
async function openPicker(props: Record<string, unknown>) {
  const wrapper = mount(CommandPicker, { props, attachTo: document.body })
  await wrapper.find('[data-testid="command-picker-trigger"]').trigger('click')
  await wrapper.vm.$nextTick()
  return wrapper
}

it('shows Thinking Effort for a thinking-capable effective model', async () => {
  await openPicker({
    personas: [persona], models: [model], skills: [],
    override: { model: 'claude-opus-4-8' }, skillHints: [],
    defaultModel: 'claude-opus-4-8',
  })
  const heading = document.querySelector('[data-testid="thinking-section"]')
  expect(heading).not.toBeNull()
  // one button per backend level + the synthetic "none"
  const levelBtns = document.querySelectorAll('[data-testid^="thinking-level-"]')
  expect(levelBtns.length).toBe(4) // none, low, medium, high
})

it('hides Thinking Effort when the effective model does not support thinking', async () => {
  await openPicker({
    personas: [persona], models: [model, nonThinkingModel], skills: [],
    override: { model: 'gpt-4o' }, skillHints: [],
    defaultModel: 'claude-opus-4-8',
  })
  expect(document.querySelector('[data-testid="thinking-section"]')).toBeNull()
})

it('falls back to defaultModel when override has no model', async () => {
  await openPicker({
    personas: [persona], models: [model, nonThinkingModel], skills: [],
    override: null, skillHints: [],
    defaultModel: 'gpt-4o', // default is non-thinking
  })
  expect(document.querySelector('[data-testid="thinking-section"]')).toBeNull()
})
```

### Step 2: Run to verify failure

Run: `pnpm test -- tests/components/ChatCommandPicker.test.ts`
Expected: FAIL — `defaultModel` prop unknown, no `data-testid="thinking-section"`, levels hardcoded to 4 already but section not gated.

### Step 3: Implement in `CommandPicker.vue`

Add `defaultModel` to the props and compute the effective model's thinking support. Replace the hardcoded `THINKING_LEVELS` usage.

In `<script setup>`:

```typescript
const props = defineProps<{
  personas: Persona[]
  models: ModelEntry[]
  skills: Skill[]
  override: { model?: string; personaId?: number; thinkingBudget?: 'low' | 'medium' | 'high' } | null
  skillHints: string[]
  defaultModel: string
}>()

// The model that will actually run this turn: explicit override wins,
// otherwise the persona/context-resolved default.
const effectiveModelId = computed(() => props.override?.model ?? props.defaultModel)
const effectiveModel = computed(() =>
  props.models.find((m) => m.id === effectiveModelId.value),
)
// Unknown model (not in the list) → treat as no thinking support; the
// backend will drop any budget anyway, and we can't offer levels we
// don't know.
const thinkingSupported = computed(() => effectiveModel.value?.thinking.supported ?? false)
const thinkingLevels = computed<readonly string[]>(() =>
  thinkingSupported.value ? ['none', ...effectiveModel.value!.thinking.levels] : [],
)
```

Delete the old `const THINKING_LEVELS = [...] as const` line.

Update `selectModel` to auto-clear a now-orphaned budget:

```typescript
function selectModel(id: string) {
  const next = { ...props.override, model: id }
  const picked = props.models.find((m) => m.id === id)
  if (!picked?.thinking.supported) delete next.thinkingBudget
  emit('update:override', Object.keys(next).length ? next : null)
  open.value = false
}
```

### Step 4: Update the template (Thinking Effort section)

Wrap the section in `v-if="thinkingSupported"`, tag it for tests, and iterate `thinkingLevels`:

```vue
<template v-if="thinkingSupported">
  <div class="my-1.5 border-t" />
  <p
    data-testid="thinking-section"
    class="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide"
  >
    {{ t('components.chatHub.commandPicker.sections.thinkingEffort') }}
  </p>
  <button
    v-for="level in thinkingLevels"
    :key="level"
    type="button"
    :data-testid="`thinking-level-${level}`"
    class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
    @click="selectThinking(level === 'none' ? null : (level as 'low' | 'medium' | 'high'))"
  >
    <Check
      class="size-3.5 shrink-0"
      :class="(level === 'none' ? !override?.thinkingBudget : override?.thinkingBudget === level) ? 'opacity-100' : 'opacity-0'"
    />
    {{ t(`components.chatHub.commandPicker.thinkingEffort.${level}`) }}
  </button>
</template>
```

> Note: the previous markup had a leading `<div class="my-1.5 border-t" />` separator before the section that was always rendered. Move that separator *inside* the `v-if` (as shown) so hiding the section doesn't leave a dangling divider.

### Step 5: Pass `defaultModel` from `ChatComposer.vue`

`ChatComposer` already receives `:model` (the resolved default). Forward it to the picker. Find the `<ChatCommandPicker ...>` usage (~line 178) and add:

```vue
<ChatCommandPicker
  ...
  :models="models ?? []"
  :default-model="model ?? ''"
  :override="override ?? null"
  ...
/>
```

(`model` is the existing composer prop at `ChatComposer.vue:13`.)

### Step 6: Run tests

Run: `pnpm test -- tests/components/ChatCommandPicker.test.ts`
Expected: PASS (all three new tests + existing ones).

### Step 7: Commit

```bash
git add app/components/chat/CommandPicker.vue app/components/chat/ChatComposer.vue tests/components/ChatCommandPicker.test.ts
git commit -m "feat(chat): gate Thinking Effort picker on per-model capability"
```

---

## Task 3: Auto-clear test + full-suite verification

Pin the auto-clear behaviour explicitly and run the whole suite.

**Files:**
- Test: `tests/components/ChatCommandPicker.test.ts`

### Step 1: Write the failing test

```typescript
it('clears thinkingBudget when switching to a non-thinking model', async () => {
  const wrapper = await openPicker({
    personas: [persona], models: [model, nonThinkingModel], skills: [],
    override: { model: 'claude-opus-4-8', thinkingBudget: 'high' }, skillHints: [],
    defaultModel: 'claude-opus-4-8',
  })
  // Click the non-thinking model row
  const gpt = document.querySelector('[data-testid="model-row-gpt-4o"]') as HTMLElement
  gpt.click()
  await wrapper.vm.$nextTick()
  const last = wrapper.emitted('update:override')!.at(-1)![0] as Record<string, unknown> | null
  expect(last).not.toBeNull()
  expect(last!.model).toBe('gpt-4o')
  expect(last!.thinkingBudget).toBeUndefined()
})
```

This requires a stable selector on model rows. In `CommandPicker.vue`, add `:data-testid="\`model-row-${m.id}\`"` to the model `<button>` in the Model section.

### Step 2: Run to verify failure

Run: `pnpm test -- tests/components/ChatCommandPicker.test.ts -t "clears thinkingBudget"`
Expected: FAIL — selector missing until the `data-testid` is added; then PASS once Task 2's `selectModel` change is in (it already strips the budget).

### Step 3: Add the selector + make it pass

Add `:data-testid="\`model-row-${m.id}\`"` to the model row button in the Model section template.

Run: `pnpm test -- tests/components/ChatCommandPicker.test.ts -t "clears thinkingBudget"`
Expected: PASS

### Step 4: Run the full frontend suite

Run: `pnpm test`
Expected: all green (was 482 + the new cases; no regressions). Also run `pnpm run typecheck` — clean.

### Step 5: Commit

```bash
git add app/components/chat/CommandPicker.vue tests/components/ChatCommandPicker.test.ts
git commit -m "test(chat): pin thinkingBudget auto-clear on non-thinking model switch"
```

---

## Verification

After all tasks:

```bash
cd /home/haex/Projekte/holzi-frontend
pnpm run typecheck   # clean
pnpm test            # all green, includes new CommandPicker cases
```

**Manual smoke test (optional, needs local backend with #79):**
1. `make up-local-full` (or the local dev stack).
2. Open the chat composer → command picker.
3. With a Claude/o-series/gpt-5 model selected → Thinking Effort section is visible; pick "high".
4. Switch the model to `gpt-4o` (or any non-thinking model) → Thinking Effort section disappears and the active-override indicator no longer shows a budget.
5. Send a message on a thinking-capable model with a budget → reasoning card appears (existing behaviour, unchanged).

## Notes for the implementer

- The i18n keys already exist (`components.chatHub.commandPicker.sections.thinkingEffort`, `...thinkingEffort.none|low|medium|high`) — no locale changes needed as long as `levels` stays within `low/medium/high`. If the backend ever reports a level without a matching key, `t()` will echo the key; that's acceptable for now (out of scope).
- Component test conventions: Vitest + `@vue/test-utils`; reka-ui `PopoverContent` is portaled to `document.body`, so query the DOM there (not the wrapper) — see the existing tests in `ChatCommandPicker.test.ts`.
- Keep the change surgical: do not touch `useChatStream.ts`, the wire format, or `ReasoningCard`/`useReasoningPreference` — those are unrelated to this picker-capability change.
