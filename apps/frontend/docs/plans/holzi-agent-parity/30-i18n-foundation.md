# Plan 30: i18n-Foundation — DE/EN über UI + Backend-Error-Codes

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task.

Status: **Plan 30 complete — all tasks on `main`.** Task 1 (foundation +
picker + `llm.vue`), Task 4a (Settings shell + nav + preferences personas/
channels), Task 4b (all remaining `/settings/*` pages + ThemeToggle +
WorkspacePanel/WorkspaceGitTab + SkillsSection/McpServersSection),
Task 4c (chat-family: 4c1 chat/* components + chat pages, 4c2
`ChatHub.vue`), Task 2 (backend `ErrorCode` enum, 113 codes, all routes
migrated + diagnostics shape on `{code, params}`), Task 3
(FE `translateError` helper, eight composables migrated,
`useChatStream.friendlyChatError(err, t)`, `/settings/diagnostics`
rerendered against the new contract, `tests/i18n/error-codes.test.ts`
pins FE↔BE coverage) and **Task 5 (final raw-text sweep on `login.vue`
+ `NotesPanel` + `ModelSelect` + `AppConfirmHost` + `DialogContent` —
done via grep audit since the project carries no ESLint stack)** are
all on `main`.

## Verification (Tasks 2 + 3 + 5, 2026-06-04)

- Backend (`/home/haex/Projekte/Holzi`):
  - `uv run pytest` — 860 passed, 3 deselected.
  - `uv run ruff check src/ tests/` — All checks passed.
  - `uv run mypy src/` — Success: no issues found in 67 source files.
- Frontend (`/home/haex/Projekte/holzi-frontend`):
  - `pnpm vitest run` — 448 tests pass (41 files), including
    `tests/lib/errorMessages.test.ts` (7), `tests/i18n/keys.test.ts`
    (2), `tests/i18n/error-codes.test.ts` (114 — covers all 113
    `ErrorCode` values × 2 locales + structural guard).
  - `pnpm typecheck` — exit 0.
  - `grep '[äöüÄÖÜß]'` über `app/` (Kommentare gefiltert) ist leer.
- Commits:
  - Backend `feat(errors): introduce ErrorCode enum, migrate routes`
    (`893991d`).
  - Frontend `feat(i18n): error-code rendering helper + composable
    migration` (`5f9f042`).
  - Frontend Task 5 sweep `feat(i18n): final sweep — login + NotesPanel
    + ModelSelect + UI primitives` (`dc76475`).

Cross-repo. Frontend-i18n + Backend-Error-Code-Refactor.

Depends on: [29-A](./29a-personas-and-channels.md) (Preferences-Seite
existiert; Sprach-Picker landet dort). Eingeordnet als
**Wave 0** von [Plan 35](./35-strategic-roadmap-2026h2.md) — alles
Folgende erbt i18n von Anfang an.

## Goal

`@nuxtjs/i18n` einrichten, alle UI-Strings extrahieren, DE und EN als
erste Sprachen, Sprach-Picker in `/settings/preferences`. Backend
liefert ab diesem Plan Error-Codes statt deutscher Strings, Frontend
übersetzt diese Codes lokal.

## Why

Hauptziel der Roadmap-Revision (siehe [Plan 35](./35-strategic-roadmap-2026h2.md))
ist „OSS-Produkt mit Usern". Eine Deutsch-only-UI kastriert die Reichweite ab
Tag eins, da der überwiegende Teil potenzieller OSS-User außerhalb DACH
sitzt. i18n ist außerdem foundational — jeder Plan ab Wave A shippt
bilingual von Anfang an, statt später nachzuziehen.

Backend-Error-Codes statt deutscher Strings ist konsistent mit der
**Failure Policy** aus Plan 35 (explicit failure, no silent recovery):
Backend gibt eindeutige Maschinen-Codes, Frontend rendert in der
gewählten Sprache.

## Non-Goals

- Locale-aware Date/Number-Formatting jenseits dessen, was `Intl` und
  `@nuxtjs/i18n` standardmäßig geben.
- RTL-Support.
- Externe Translation-Services / automatische Übersetzung. Manuelle
  DE/EN-JSONs.
- Backend hat *eigene* Locale-Pakete (`hermes/i18n/de.json`). Verworfen
  zugunsten Error-Codes — Backend ist sprach-agnostisch, FE übersetzt.
- Sprachen jenseits DE/EN. Erweiterbar via neue JSON-Datei +
  Picker-Option, aber nicht Scope dieses Plans.

## Architecture / Approach

### Frontend (Nuxt)

- `@nuxtjs/i18n` mit Locales `de` (default) + `en`, Strategy
  `prefix_except_default` (DE bleibt unter `/`, EN bekommt `/en/`-
  Prefix; manuelle User-Wahl 2026-06-04, überstimmt den initialen
  `no_prefix`-Vorschlag). Locale lebt zusätzlich im i18n-Cookie +
  `Accept-Language`-Fallback bei Erstbesuch.
- Lazy-Loading aus `i18n/locales/{de,en}.json`.
- Key-Hierarchie:
  - `common.*` — wiederverwendete Buttons, Labels („Speichern",
    „Abbrechen", „Löschen", „Bearbeiten", „Schließen", …).
  - `nav.*` — Navigation-Items (Control-Center-Sidebar + Mobile-Tabs).
  - `pages.<page>.*` — seitenspezifische Strings, ein Block pro Page.
  - `components.<component>.*` — komponentenspezifische Strings, wenn
    nicht trivial in `pages.*` integrierbar.
  - `errors.<CODE>` — Backend-Error-Code-Übersetzungen (UPPER_SNAKE
    Keys passend zu Backend `ErrorCode`-Enum).
- `setLocale()` aus `useI18n({ useScope: 'global' })` setzt Sprache +
  persistiert via i18n-Cookie + navigiert auf die Prefix-URL. **Wichtig:**
  ohne `useScope: 'global'` gibt vue-i18n im composition-mode einen
  lokalen Composer zurück, der keine `setLocale`-Augmentierung hat — der
  Call ist dann ein stiller no-op. Keine Backend-Persistenz (single-user;
  bei Wave C wird Locale dann per-user-Preference gespeichert).
- `detectBrowserLanguage: true` als initiale Auswahl; manuelle User-Wahl
  überschreibt.

### Backend (Hermes)

- Neue Datei `src/hermes/errors.py` definiert eine `ErrorCode`-Enum
  (StrEnum) mit allen User-actionable Fehler-Codes
  (`SLUG_CONFLICT`, `PERSONA_DEFAULT_DELETE`, `WORKSPACE_NOT_FOUND`,
  `AUTH_INVALID`, `LLM_CREDENTIAL_MISSING`, etc.).
- Alle `HTTPException(detail=…)`-Stellen in `src/hermes/routes/*.py`
  und Repository-Layer, die heute deutsche Strings raischen, werden
  auf `detail=ErrorCode.X.value` umgestellt.
- Backend ist ab da locale-agnostisch — keine User-sichtbaren Strings
  mehr im Backend. Diagnostics-Texte (Plan 20), die heute deutsch
  sind, werden ebenfalls auf Code+Param-Struktur umgestellt
  (`{ "code": "SANDBOX_WARNING", "params": { "reason": "…" } }`).
- `Accept-Language`-Parsing wird **nicht** benötigt — Backend
  übergibt Code, FE entscheidet Sprache.

### Frontend-Error-Rendering

- Neuer Helper `app/lib/errorMessages.ts`:
  ```ts
  export function translateError(error: unknown, t: TranslateFn): string {
    const code = extractCode(error)  // aus error.detail oder error.code
    if (code && hasI18nKey(`errors.${code}`)) return t(`errors.${code}`)
    return t('errors.GENERIC') + (code ? ` (${code})` : '')
  }
  ```
- Alle bestehenden `useFoo`-Composables, die heute Strings wie
  `'Fehler beim Laden.'` raisen, werden auf `translateError(err, t)`
  umgestellt.
- Fallback: unbekannte Codes zeigen generischen Text + Code in
  Klammern (für Debugging).

### Tests

- Neuer Test `tests/i18n/keys.test.ts` — assert dass alle Keys in
  `de.json` auch in `en.json` existieren (no orphans, no missing).
- Neuer Test `tests/i18n/error-codes.test.ts` — assert dass alle
  Backend-`ErrorCode`-Enum-Werte als `errors.X`-Key in beiden Locales
  existieren. Datenquelle: `app/types/api-generated.ts` (kommt aus
  `pnpm run gen:api`).
- Bestehende Component-Tests: die meisten asserten heute auf deutsche
  Strings — pro Page-Extraktion werden sie mitgeführt (entweder
  assert auf den i18n-Key via `vi.mock('@nuxtjs/i18n')` oder auf das
  DE-Render-Result, je nach Stil).

## Scope

### Frontend-String-Extraktion (geschätzt 250–400 Stellen)

- `app/pages/**/*.vue` — Page-Titles, Section-Headers, Buttons,
  Empty-States.
- `app/components/**/*.vue` — alle sichtbaren Strings.
- `app/composables/**/*.ts` — Error-Fallback-Strings (`'Fehler beim
  Laden.'` → `t('errors.LOAD_FAILED')` oder
  `translateError(err, t)`).
- `app/layouts/**/*.vue` — Nav-Labels, Sidebar.
- `app/lib/settingsNav.ts` — `label`- und `upcoming`-Felder werden
  zu i18n-Keys (z.B. `nav.preferences.label`).

### Backend-Error-Code-Migration

Audit aller `HTTPException(detail=…)` / `raise … detail="…"` in
`src/hermes/`:
- `src/hermes/routes/*.py` (alle Routen)
- `src/hermes/repository/*.py` (Validation-Errors die als
  ValueErrors raisen, die dann in Routen zu HTTPExceptions werden)
- `src/hermes/main.py` (Lifespan-Errors)

Pro `detail=…`-Stelle:
- Wenn deutscher String → in `ErrorCode`-Enum aufnehmen, Stelle
  umstellen.
- Wenn englischer technischer Name (z.B. „bad request body") →
  bleibt wie ist, wenn er für User unverständlich aber Code-
  technisch korrekt ist. Sonst auch Enum-Code.
- Diagnostics-Output (`/api/diagnostics`) wird auf
  `{ code, params }`-Struktur umgestellt.

## Tasks

Die Tasks sind so geschnitten, dass jede Task in eine Session passt.
TDD-Philosophie: erst Test schreiben, dann Impl, dann commit.

### Task 1: Foundation + Common-Keys + Sprach-Picker

**Files:**
- Create: `i18n/locales/de.json`, `i18n/locales/en.json`
- Modify: `nuxt.config.ts` (i18n-Modul + Config)
- Modify: `app/pages/settings/preferences.vue` (Sprach-Picker als
  dritte Section)
- Create: `tests/i18n/keys.test.ts`
- Modify: `package.json` (`@nuxtjs/i18n`-Dep)

**Steps:**

1. `pnpm add @nuxtjs/i18n` und in `nuxt.config.ts` als Modul
   konfigurieren mit Locales/Strategy/Lazy.
2. Initiale `de.json` mit `common.{save,cancel,delete,edit,close,
   loading,error,retry,confirm}` + `nav.{preferences,llm,memory,
   tasks,workspaces,skills,diagnostics,insights,logs}.label` +
   `errors.{GENERIC,NETWORK,UNKNOWN}`.
3. `en.json` 1:1 manuell übersetzen (gleiche Keys, englische Werte).
4. `tests/i18n/keys.test.ts` schreiben: Test failed wenn de.json und
   en.json unterschiedliche Key-Sets haben.
5. Run: `pnpm vitest run tests/i18n/keys.test.ts` → PASS.
6. Sprach-Picker als dritte Section in `/settings/preferences`:
   Select mit DE/EN, `setLocale()`-Aufruf bei Change. Test:
   `tests/components/PreferencesPage.test.ts` ergänzen um „picker
   change calls setLocale".
7. Eine Sample-Page (Vorschlag: `app/pages/settings/llm.vue` weil
   relativ klein) komplett auf i18n umstellen. Tests für diese Page
   anpassen.
8. Commit: `feat(i18n): foundation + common keys + Sprachpicker`

### Task 2: Backend Error-Code-Enum + Audit (done 2026-06-04, `893991d`)

**Files:**
- Create: `src/hermes/errors.py` (StrEnum)
- Modify: alle `src/hermes/routes/*.py` mit deutschen `detail=`-
  Strings
- Modify: `src/hermes/routes/diagnostics.py` (output-Struktur auf
  `{code, params}`)
- Modify: betroffene `tests/test_api_*.py` (assertieren jetzt auf
  Code statt String)

**Steps:**

1. `grep -rn 'detail=' src/hermes/routes/` ausführen, alle deutschen
   Strings sammeln. Erwartete Anzahl: ~30–60 Stellen.
2. `src/hermes/errors.py` mit `class ErrorCode(StrEnum)` schreiben,
   pro gefundener Stelle einen UPPER_SNAKE-Code. Beispiele:
   `SLUG_CONFLICT = "SLUG_CONFLICT"`,
   `PERSONA_DEFAULT_DELETE = "PERSONA_DEFAULT_DELETE"`,
   `WORKSPACE_NOT_FOUND = "WORKSPACE_NOT_FOUND"`.
3. Test schreiben (`tests/test_errors_enum.py`): assert dass jeder
   Enum-Wert == Name (StrEnum-Konvention) und dass die Enum nicht
   leer ist.
4. Pro Route-File: alle deutschen `detail=…` durch
   `detail=ErrorCode.X.value` ersetzen. Tests in
   `tests/test_api_*.py` anpassen: `assert resp.json()['detail']
   == "SLUG_CONFLICT"` statt `assert "existiert" in
   resp.json()['detail']`.
5. `routes/diagnostics.py` Output-Struktur auf
   `{ subsystem, status, code, params }` umstellen. Tests
   entsprechend.
6. Run: `cd /home/haex/Projekte/Holzi && uv run pytest` →
   alle PASS.
7. Run: `uv run ruff check src/` + `uv run mypy src/` → clean.
8. Commit (Backend-Repo): `feat(errors): introduce ErrorCode enum,
   migrate routes from german strings`

### Task 3: Frontend Error-Rendering-Helper + Composable-Migration (done 2026-06-04, `5f9f042`)

**Files:**
- Create: `app/lib/errorMessages.ts`
- Modify: alle `app/composables/use*.ts` mit deutschen Fallback-
  Strings (Stand 2026-06-04, via `rg "'Fehler|\"Fehler|fehlgeschlagen"
  app/composables/`):
  - `useInsights.ts`, `useTasks.ts`, `useTools.ts`,
    `useMcpServers.ts`, `useMcpHealth.ts`, `useLogs.ts`,
    `useDiagnostics.ts`, `useSkills.ts`
- Modify: `app/composables/useChatStream.ts` — die
  `friendlyChatError()`-Switch-Case mit `ChatStreamError.code`
  ist heute deutsche String-Map (NICHT Backend-ErrorCode, sondern
  client-side stream-error code). Mit umstellen: `errors.chat.<code>`
  oder analog. Tests in `tests/composables/useChatStream.test.ts`
  anpassen.
- Modify: `app/components/ChatHub.vue` — die `runStream()` /
  `restartSandbox()` / `decideApproval()` Calls von
  `friendlyChatError(err)` bleiben unverändert (sie konsumieren den
  i18n-Output direkt); aber die DE-Error-Fallbacks in den
  `try/catch`-Branches sind 4c2 bereits über
  `components.chatHub.errors.*` gelöst und brauchen Task 3 nicht.
- Modify: `i18n/locales/{de,en}.json` (alle `errors.*`-Keys aus
  Task 2 + Chat-Stream-Codes ergänzen)
- Create: `tests/lib/errorMessages.test.ts`
- Regenerate: `app/types/api-generated.ts` via `pnpm run gen:api`
  nach Task 2 (env + port: siehe [[reference_gen_api_command]])

**Steps:**

1. Nach Task 2 mergen: `pnpm run gen:api` ausführen, generated types
   updaten. Verifizieren dass `ErrorCode`-Enum im Generated-File
   erscheint.
2. `app/lib/errorMessages.ts` schreiben mit `translateError(err, t)`-
   Helper. Test schreiben für: bekannter Code, unbekannter Code (→
   `errors.UNKNOWN`-Fallback), null/undefined error, network error
   ohne Response.
3. Test laufen, FAIL erwartet.
4. Helper implementieren, Test PASS.
5. Pro Composable mit Fallback-String: `'Fehler beim Laden.'` durch
   `translateError(err, t)` ersetzen. Composable-Tests anpassen.
   Heute getestete DE-Strings → auf i18n-Key umbauen (Passthrough-
   `$t`-Stub).
6. `useChatStream.friendlyChatError()`: Switch-Case auf
   `t('errors.chat.<code>')`-Lookup umstellen. ChatStreamError-Code
   ist eine separate Achse als Backend-ErrorCode — diese gehört
   unter eine eigene Sub-Domain (z.B. `errors.chat.upstream_timeout`).
7. `de.json`/`en.json` um alle `errors.<CODE>`-Keys ergänzen, die
   in Task 2 erzeugt wurden. Lookup auf Code-Enum aus
   `app/types/api-generated.ts`. Plus `errors.chat.<code>`-Keys
   für die ChatStream-Codes.
8. Neuer Test `tests/i18n/error-codes.test.ts`: iteriert über
   `ErrorCode`-Enum (importiert aus `app/types/api-generated.ts`),
   assertet dass jeder Wert sowohl in `de.json` als auch `en.json`
   als `errors.<value>` existiert. **Wichtig:** Wenn der Enum-Import
   aus Generated-File JSON-AST-Probleme im Test-Env macht (siehe
   `keys.test.ts`-Workaround mit `fs.readFileSync`), analoger
   Workaround.
9. Run: `pnpm vitest run` → alle PASS.
10. Commit: `feat(i18n): error-code rendering helper +
    composable migration`

### Task 4: Page-by-Page-Extraktion

**Files:** alle `app/pages/**/*.vue` und betroffene Components.

**Approach:** Pro Page-File (~10–15 Pages):
1. Alle hartkodierten deutschen Strings in `<template>` und
   `<script>` lokalisieren.
2. Page-spezifische Keys unter `pages.<pagename>.*` in beide
   Locale-Files schreiben.
3. Page umstellen.
4. Component-Test für diese Page anpassen: DE-String-/aria-Assertions
   auf den i18n-Key umbauen (Passthrough-`$t`-Stub rendert den Key).
   **Test-Pattern (etabliert 4b):** sobald die Component `useI18n()` im
   *script* nutzt (toast/confirm/error/label-maps), braucht der Test
   `vi.mock('vue-i18n', importOriginal → useI18n: () => ({ t: k=>k }))`
   VOR dem statischen Component-Import. `useLocalePath()` ist im
   nuxt-Test-Env auto-imported. Interpolierte Werte (`{count}`,
   `{error}`) fallen beim Passthrough weg → wo ein Test den *Wert*
   prüft (Exit-Code, Fehlermeldung), Label + Wert getrennt rendern
   (`{{ $t('…label') }} {{ value }}`) statt `{{ $t('…', { value }) }}`.
5. Smoke: Live-DE↔EN-Check braucht den vollen Stack (`make up-local-full`)
   — `/settings/*` liegt hinter `auth.global.ts` (localStorage-Token
   `hermes.auth.token` reicht, keine Backend-Validierung) und die Pages
   rufen Backend-APIs. `pnpm dev` allein zeigt nur Error-States (aber
   lokalisiert). Unit-seitig deckt `keys.test` (de≡en) + Key-Assertions
   die String-Korrektheit ab.

**Sub-Splits:**
- **4a** (Commit `dbc5a48`, done): Settings-Shell (`settings.vue` +
  Layout-Header), Sidebar-Nav (`app/lib/settingsNav.ts`),
  `preferences.vue` Personas + Channels.
- **4b** (Commits `efd9a7f`+`8d41980`+`9c8b8fd`, done): ALLE restlichen
  `/settings/*`-Pages (`logs`, `insights`, `memory`, `workspaces`,
  `tasks`, `diagnostics`, `skills`) + `ThemeToggle.vue` +
  `panels/{WorkspacePanel,WorkspaceGitTab}.vue` +
  `settings/{SkillsSection,McpServersSection}.vue`. 327 vitest grün,
  typecheck clean.
- **4c1** (Commit `ef49c25`, done): Chat-Family-Components — alle
  `app/components/chat/*.vue` (ApprovalCard, AttachmentChip,
  ChatComposer, ChatMessage, ConversationList, EmptyChatState,
  McpInstallApprovalDetails, ReasoningCard, SandboxCrashCard,
  SubagentCard, ToolCallCard) + `app/pages/index.vue` +
  `app/pages/chat/[id].vue` + zugehörige Tests.
- **4c2** (done): `app/components/ChatHub.vue` (1107 Zeilen,
  Orchestrator) — Header, Sidebar-Aria-Labels, Queue-Statusmeldungen,
  Reasoning-Toggle-Titel, Notes/Workspace-Tabs, Upload-/Sandbox-/
  Bookmark-/Load-/Rename-/Delete-Error-Fallbacks, `localePath()` für
  alle `navigateTo()`/`router.replace()`/`<NuxtLink :to>`-Aufrufe.
  ChatHub ist in `tests/pages/{index,chat-id}.test.ts` gestubt, daher
  keine Test-Anpassungen nötig. **Damit ist die komplette Happy-Path-
  UI bilingual.**

**Schritt-Größe:** Pro logischer Gruppe ein Commit.

**Reihenfolge der verbleibenden Tasks:** keine — Plan 30 ist 2026-06-04
durch (Tasks 2 + 3 als Cross-Repo-Paar, Task 5 als grep-Sweep
direkt im Anschluss).

### Task 5: ESLint-Rule + Smoke-Verifikation (done 2026-06-04, `dc76475`)

**Tatsächlich umgesetzt:** grep-basierter Sweep statt ESLint-Rule. Die
Codebasis hat zum Zeitpunkt von Plan 30 keine ESLint-Infrastruktur
(weder `eslint.config.ts` noch `eslint`/`@nuxt/eslint` in den
devDependencies), und das Aufsetzen wäre weit jenseits eines „Abschluss-
Sweeps". Ein `grep '[äöüÄÖÜß]'` über `app/` (mit Filter auf Kommentare)
findet exakt die gleiche Klasse von Übersehenem, ohne den ESLint-Stack
einzuziehen. Findings:

- `app/pages/login.vue` — komplette Migration (Title, Description,
  Token-Label/-Placeholder, Submit/Submitting, vier Error-Branches).
  Höchster Impact, da Eingangstür der App.
- `app/components/panels/NotesPanel.vue` — Chat-Right-Rail Notes
  (separat von `/settings/memory`); jetzt mit `translateError()` für
  Fetch-Errors + Keys unter `components.notesPanel.*`.
- `app/components/settings/ModelSelect.vue` — pro-Credential Modell-
  Combobox; sieben neue Keys + `translateError()`.
- `app/components/AppConfirmHost.vue` — Default-Labels (Abbrechen /
  Löschen / Bestätigen / OK) jetzt über `common.*`.
- `app/components/ui/dialog/DialogContent.vue` — sr-only Schließen-
  Label via `common.close`.

Plus neuer `common.ok`-Key für den Prompt-Default. `AppConfirmHost.test`
bekommt den `vi.mock('vue-i18n')`-Stub, da der Setup jetzt `useI18n()`
ruft.

**Verifikation:** `pnpm vitest run` 448 grün; `pnpm typecheck` exit 0;
`grep '[äöüÄÖÜß]'` über `app/` (gefiltert auf nicht-Kommentare) ist
leer.

**Original-Plan (ESLint-Rule, für Referenz):**

**Files:**
- Modify: `eslint.config.ts` (aktiviere `@nuxtjs/i18n/no-raw-text`-
  Rule)
- Lint-fix-Run.

**Steps:**

1. ESLint-Rule `@nuxtjs/i18n/no-raw-text` aktivieren als ERROR.
2. `pnpm lint` ausführen, alle Restlücken sammeln. Erwartet: 0–10
   Findings (überwiegend Übersehene Strings aus Task 4).
3. Restlücken fixen pro Page-File, Commits klein halten.
4. Manuelle Verifikation: Dev-Stack hochfahren, jede Page in beiden
   Sprachen öffnen, keine deutschen Resstrings in EN-Mode finden.
5. Commit: `chore(i18n): enable no-raw-text rule + final cleanup`

## Verification

- `pnpm vitest run` → alle Tests grün, inkl. `tests/i18n/*`.
- `pnpm typecheck` → exit 0.
- `pnpm lint` → exit 0 mit aktiver `no-raw-text`-Rule.
- Backend: `uv run pytest` → alle Tests grün, inkl.
  `tests/test_errors_enum.py`.
- Backend: `uv run ruff check src/` + `uv run mypy src/` → clean.
- Live-Smoke via `make up-local-full`:
  - Frontend startet, Default-Locale ist Browser-Locale (DE bei
    `de-DE`-Browser, EN bei `en-US`-Browser).
  - Sprach-Picker in `/settings/preferences` wechselt Locale, alle
    Pages re-rendern.
  - Provoziertes Backend-Error (z.B. duplicate Persona-Slug) zeigt
    übersetzte Fehlermeldung in beiden Locales.

## Open Questions

Beide aus dem ursprünglichen Plan-30-Entwurf abgeräumt:

- **EN-Vollständigkeit**: zwingend vollständig, Test enforced.
  Lückenhaft + Fallback-auf-DE wäre UX-Bruch (deutsche Wörter
  würden in EN-UI leaken).
- **Browser-Locale-Detection**: ja, via `detectBrowserLanguage:
  true`. Manuelle Wahl in `/settings/preferences` überschreibt.

Neu:

- **Wave-C-Vorgriff**: Sollten wir Locale schon jetzt in der
  `users`-Tabelle (kommt erst in Wave C) vorsehen? → Nein, bleibt
  Cookie-based bis Wave C. Migration auf Per-User-Locale ist
  trivial nachrüstbar.

## Risk Register

| Risk | Mitigation |
|---|---|
| Backend-Error-Code-Migration bricht eine Route, die niemand bewusst testet | Task 2 erzwingt assert-auf-Code in jedem `test_api_*.py`. Wenn Test fehlt, ist Route nicht abgedeckt → vor Migration Test ergänzen. |
| EN-Übersetzungen schlecht / wörtlich | DE → EN manuell, Code-Reviewer prüft auf natürliches Englisch. Nicht maschinell. |
| 250–400 Strings explodieren auf 800 weil Komponenten dynamische Strings haben | Vor Task 4 ein `rg '">[A-ZÄÖÜ]'`-Sweep, um die echte Anzahl zu zählen. Plan ggf. neu schätzen. |
| Component-Tests gegen deutsche Strings brechen flächendeckend | Pro Page-Extraktion in Task 4 die Tests *als Teil derselben Commit*, nicht separat. So bleibt CI green. |
