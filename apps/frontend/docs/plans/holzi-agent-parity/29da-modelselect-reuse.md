# Plan 29-D-A: Persona-Editor reuses `<ModelSelect>` instead of inline dropdown

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Done.** FE [#97](https://github.com/haexhub/holzi-frontend/pull/97)
merged 2026-06-05; review-fix [#98](https://github.com/haexhub/holzi-frontend/pull/98)
merged 2026-06-05 (CodeRabbit-clean): restored the a11y `<label for>` ↔ trigger
`id` association the refactor dropped, collapsed the binding to `v-model`, and
re-added the explicit "use credential's default" (null-model) entry as an
opt-in `clearable` prop on `ModelSelect` so the credential cards on `llm.vue`
stay unchanged. Frontend-only follow-up to
[Plan 29-D](./29d-persona-llm-and-model.md) (Wave B1). Pure refactor —
no API change, no schema change, no new feature.

Depends on: [29-D](./29d-persona-llm-and-model.md) merged.

## Goal

Replace the inline native `<select>` + `loadModelsForCredential` block
in `app/pages/settings/preferences.vue` with the existing
`<SettingsModelSelect>` component
([`app/components/settings/ModelSelect.vue`](../../../app/components/settings/ModelSelect.vue)),
so the persona editor and the LLM-credentials page share one
race-safe, searchable, i18n-aware model picker.

Result: ~50 lines deleted from `preferences.vue`; the
`formModels`/`modelsLoading`/`loadModelsForCredential`/`onFormCredentialChange`
quartet collapses into a single component prop.

## Why

Plan 29-D shipped a native `<select>` plus an inline async loader. A
Claude-review on PR #96 found two issues that don't exist in
`<ModelSelect>`:

1. **Weaker race-guard.** `loadModelsForCredential` only checked
   `editing.value`. Switching credentials rapidly on the same persona
   could let a stale model list overwrite a fresh one. (Fixed in
   `77a4fa3` by adding a `formCredentialId.value === credId` guard.)
   `<ModelSelect>` uses a monotonic `fetchToken` counter — a cleaner
   pattern that survives any future state input.
2. **Stale-model auto-clear missing.** When the user picks a model,
   then a new model list arrives that no longer contains it,
   `preferences.vue` keeps the now-invalid `formModel`. The user has
   to notice + manually re-pick. `<ModelSelect>` already does
   `emit('update:modelValue', null)` in this case (see
   `ModelSelect.vue:52-54`).
3. **No search.** Provider lists can have dozens of models. The native
   `<select>` has no filter; `<ModelSelect>`'s Combobox does.

Plus the obvious cost: ~50 lines of duplicated wiring + i18n keys
(`modelDefaultOption`, `modelHintNoCredential`, plus the loading /
empty / error states already covered by `components.modelSelect.*`).

## Non-Goals

- **Credential dropdown stays.** It's a flat list from `credentials.value`
  with one "global default" option — no async, no race, no benefit
  from Combobox. Keep the native `<select>`.
- **No change to `<ModelSelect>`'s public API** beyond an *optional*
  `testId` prop (see Scope, Task 2) — the LLM-page call site stays
  unchanged.
- **No change to the PUT payload, the BE endpoint, or the i18n
  error-code surface.**
- **No new feature.** This is structural cleanup.

## Scope

### Frontend (`/home/haex/Projekte/holzi-frontend`)

**`app/components/settings/ModelSelect.vue`** — add one optional prop
so the persona-card variant can carry a per-persona testid (today's
`persona-model-select-${persona.id}`):

```ts
const props = defineProps<{
  modelValue: string | null
  credentialId: number | null
  disabled?: boolean
  testId?: string
}>()
```

Bind on the `ComboboxTrigger`:

```vue
<ComboboxTrigger
  :data-testid="testId"
  ...
>
```

No behavioural change. The LLM-page call site doesn't pass `testId` →
no regression there.

**`app/pages/settings/preferences.vue`** — remove the model-loading
machinery:

- Drop the `LlmModelChoice` import.
- Drop these refs: `formModels`, `modelsLoading`.
- Drop these functions: `loadModelsForCredential`, the `onFormCredentialChange`
  handler shrinks to a no-op (or gets inlined and deleted — `<ModelSelect>`
  reacts to the `credentialId` prop change on its own).
- In `openEdit`, drop the `if (persona.llm_credential_id !== null && …)
  void loadModelsForCredential(...)` block — `<ModelSelect>` loads
  itself via its `watch(() => props.credentialId, ..., { immediate: true })`.
- In `openCreate` + `cancelEdit`, drop `formModels.value = []` and
  `modelsLoading.value = false` — both refs are gone.
- In the template, replace the entire `<select>` block + the
  "modelHintNoCredential" hint with:

  ```vue
  <div class="flex flex-col gap-1">
    <label
      :for="`persona-model-${persona.id}`"
      class="text-xs font-medium text-muted-foreground"
    >
      {{ $t('pages.preferences.personas.form.model') }}
    </label>
    <SettingsModelSelect
      :model-value="formModel"
      :credential-id="formCredentialId"
      :test-id="`persona-model-select-${persona.id}`"
      @update:model-value="(v) => formModel = v"
    />
  </div>
  ```

  The `<ModelSelect>` already shows the "needs credential" placeholder
  when `credentialId === null`, so the inline German hint
  (`modelHintNoCredential`) becomes redundant.

- Drop the `@change="onFormCredentialChange"` on the credential
  `<select>`. Replace with `@change="formModel = null"` (inline) — when
  the user picks a different credential, the previously-stored model
  id is by definition wrong for the new provider. `<ModelSelect>` will
  also clear it once its load resolves and the id isn't in the list,
  but doing it synchronously prevents a one-frame flicker of a stale
  selection.

**`i18n/locales/de.json` + `i18n/locales/en.json`** — remove the now-
unused keys:

- `pages.preferences.personas.form.modelDefaultOption`
- `pages.preferences.personas.form.modelHintNoCredential`

Keep `pages.preferences.personas.form.model` (the label).
`<ModelSelect>` has its own i18n surface
(`components.modelSelect.placeholder` / `needsCredential` / `loading`
/ `empty` / `error` / `noMatch` / `searchPlaceholder`) which is already
populated in both locales (verified before writing this plan).

### Tests

`tests/components/PreferencesPage.test.ts` — three affected cases:

1. **"credential change triggers model list fetch"** (around line 996)
   — the GET path is unchanged (`/api/llm/credentials/10/models`).
   Test still passes as long as setting the credential `<select>` to
   `"10"` triggers the Combobox-internal load. Likely needs no edit
   beyond the disabled-check (`<ModelSelect>` uses `<ComboboxTrigger>`,
   not `<select>`, so `attributes('disabled')` doesn't apply — use the
   trigger's `aria-disabled` or the testid'd element's
   `classList.contains('disabled:opacity-50')`-equivalent instead).

2. **"model dropdown disabled when no credential selected"**
   (line 1024) — rewrite: query `[data-testid="persona-model-select-1"]`
   (the `ComboboxTrigger` element) and assert its `disabled` /
   `aria-disabled` attribute. `<ModelSelect>` computes `isDisabled` as
   `disabled || loading || credentialId === null || !!error` — with no
   credential picked, `credentialId === null` → disabled.

3. **"save includes `llm_credential_id` and model in PUT payload"**
   (line 1038) — picking the model via Combobox needs a different
   helper than native `setValue`. Two options:

   - (a) Drive the picker the way users do: click the trigger to open,
     then click the `ComboboxItem` for `gpt-4o`. Reka-UI's `ComboboxItem`
     renders as a regular DOM node and dispatches `select` on click;
     the existing `@select.prevent="pick(m.id)"` handler will emit
     `update:modelValue`.
   - (b) Reach in and call `wrapper.findComponent(SettingsModelSelect)
     .vm.$emit('update:modelValue', 'gpt-4o')`. Less realistic but
     stable across Combobox-internal refactors.

   Prefer (a) if it works in jsdom; fall back to (b) if Reka-UI's
   `ComboboxPortal` makes the items unreachable in the wrapper.

No change to the other ~20 PreferencesPage tests (they don't touch the
model select).

### Verification

- `pnpm typecheck` exit 0.
- `pnpm test` — all 467 tests pass.
- Manual smoke (or Playwright if available):
  1. Open `/settings/preferences`, click "Bearbeiten" on a persona.
  2. Pick a credential → model Combobox enables, loads.
  3. Type a substring → list filters.
  4. Pick a model → trigger shows the label.
  5. Switch credential → `formModel` resets to null, list reloads.
  6. Save → PUT payload contains `{ llm_credential_id, model }`.
  7. Re-open the same persona → model + credential prefill correctly.

## Open Questions

- **Combobox keyboard interaction in jsdom.** If test option (a)
  doesn't work (Reka-UI's portal rendering may not be in the wrapper's
  shadow), fall back to (b) — adjusted in the task list once we know.
- **Should we also drop the credential `<select>` in favour of a
  Combobox?** No — credentials are user-named (`display_name`), the
  list is short (≤10), and there's no search payoff. Out of scope.

## Tasks

1. Add optional `testId` prop to `ModelSelect.vue` + bind to
   `ComboboxTrigger`. `pnpm typecheck` → exit 0. No test changes.

2. Rip out `formModels` / `modelsLoading` / `loadModelsForCredential`
   from `preferences.vue` + the corresponding template block. Wire in
   `<SettingsModelSelect>` with `formModel` + `formCredentialId`.
   `pnpm typecheck` → exit 0 (tests will break here, that's expected).

3. Remove the unused i18n keys (`modelDefaultOption`,
   `modelHintNoCredential`) from `de.json` + `en.json`. `pnpm
   typecheck` → exit 0.

4. Update the three affected PreferencesPage tests for the Combobox
   interaction. `pnpm test` → 467 passed. (Same count — no test added
   or removed.)

5. Manual smoke via `pnpm dev` + a real credential (or Playwright).
   Verify the 7 steps in §Verification.

6. Open a PR titled `refactor(preferences): persona-card uses
   SettingsModelSelect (Plan 29-D-A)`. Run CodeRabbit; address valid
   findings; squash-merge.

7. Update [Plan 29-D](./29d-persona-llm-and-model.md) Status line:
   `Status: **Done.**` once both this PR and the parent PR #96 are on
   `main`. Update `MEMORY.md` entry for the Wave B1 roadmap.
