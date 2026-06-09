# Plan 36: Personas — Fragments (soul / identity / agents) + History

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

Status: **Implemented + verified on `wave-a1-personas-fragments` branch
in both repos (2026-06-05) — pending PR + merge.** First implementation
file of Wave A ([Plan 35 §A1](./35-strategic-roadmap-2026h2.md#a1--persona-fragments-db-spalten--history)).
Replaces the single `personas.prompt` column from [Plan 29-A](./29a-personas-and-channels.md)
with three typed columns + a `persona_history` audit table.

## Verification (2026-06-05)

- Backend (`/home/haex/Projekte/Holzi`, branch `wave-a1-personas-fragments`):
  - `uv run pytest` — **884 passed, 3 deselected** (was 860 pre-Plan-36;
    +24 covers history-repo + history-routes + migration regression
    + history_author kwarg).
  - `uv run ruff check src/ tests/` — All checks passed.
  - `uv run mypy src/` — Success: no issues found in 68 source files.
  - Branch commits (BE):
    - `af9e1b8` `feat(personas): split prompt into soul/identity/agents columns + migration helper` (Task 1)
    - `fc87e31` `feat(personas): persona_history repo + auto-snapshot on create/update` (Task 2)
    - `09ee44d` `fix(personas): migration adds fragment columns + writes baseline history row` (Task 1 fix — caught by code-quality reviewer; `metadata.create_all` does not alter existing tables, so the migration helper had to add the new columns itself + write a baseline `author='migration'` history row per migrated persona)
    - `83e6876` `feat(personas): resolver composes soul/identity/agents with named headers` (Task 3)
    - `bc0a6ef` `test(personas): rewrite resolver-with-skills tests for Plan 36 section headers` (Task 3 follow-up)
    - `a7794d3` `feat(api): persona fragments + history endpoints` (Task 4)
    - `6a0dcf7` `feat(personas): backfill writes initial history snapshot + green sweep` (Task 5)
    - `1bcf282` `test(personas): cover history_author kwarg on repo.create` (Task 5 follow-up)
- Frontend (`/home/haex/Projekte/holzi-frontend`, same branch):
  - `pnpm vitest run` — **461 tests pass (41 files)**, including
    `tests/i18n/keys.test.ts`, `tests/i18n/error-codes.test.ts`
    (116 — covers the 3 new ErrorCode values × 2 locales),
    `tests/components/PreferencesPage.test.ts` (28).
  - `pnpm typecheck` — exit 0.
  - Branch commits (FE):
    - `606dc53` `docs(plans): add Plan 36 — Wave A1 persona fragments + history` (this doc)
    - `caca3c1` `feat(api-types): regenerate for persona fragments + history` (Task 6)
    - `61b4aa1` `feat(preferences): three-fragment persona editor + history subview` (Task 7)
    - `9f9d019` `fix(preferences): use truthy v-if guards for persona fragments` (Task 7 fixup — `.trim()` crashed on undefined fragments)
    - `d02593d` `feat(i18n): persona fragments + history locale keys` (Task 8)
    - `c09805e` `test(preferences): persona fragments + history coverage` (Task 9)
- Live-Smoke (`make up-local-full`) **not run** in this session — the
  Plan 36 spec listed it as optional. The full pytest + vitest +
  typecheck + 116-error-code i18n cross-coverage carries the
  confidence. Live-smoke can be done at PR-review time.

Notable implementation choices (more in Decision Log below):

- Migration baseline `persona_history` row uses `author='migration'`
  (third author tier alongside `'user'` for normal writes and
  `'system'` for the seed-persona; see Task 5 + Task 2 work).
- `personas_repo.create` gained a `history_author='user'` kwarg so
  the seed/migration paths can write non-`'user'` audit rows in the
  same transaction as the INSERT (Option A from Task 5).
- Restore endpoint reuses `personas_repo.update` so the
  auto-snapshot wiring from Task 2 handles the "restore writes a new
  history row" requirement for free — no separate write path.
- Resolver output is a hardcoded `[("## Soul", soul), ("## Identity",
  identity), ("## Agents", agents)]` list (not dict iteration), so a
  future field reorder shows up in diffs.

Cross-repo. Backend ist die ganze Substanz (Schema-Bruch + Migration +
Resolver-Output-Format + neue History-Endpoints); Frontend baut die
Persona-Card auf drei Textareas + History-Subview um.

Depends on:
- [29-A](./29a-personas-and-channels.md) — Personas-Tabelle + Resolver-
  Hot-Path existiert; dieser Plan ersetzt `prompt` durch drei
  Fragments.
- [30](./30-i18n-foundation.md) — `ErrorCode`-Enum + bilinguale UI sind
  ab hier Pflicht.
- [33](./33-skills-as-db-artifacts.md) — Resolver hat schon einen
  `skills_block`-Strang zwischen Persona und Channel; dieser Plan
  fasst nur den Persona-Strang neu, lässt die Skills-Komposition
  unverändert.

Followups:
- Wave A2 = Plan 37 (Skill-Catalog lazy-load) — wird
  `persona_skills` tatsächlich droppen.
- Wave B1 = Plan 29-D-Resurrect (Modell pro Persona).

## Goal

Persona ist nicht mehr **ein** Prompt-Blob, sondern drei typisierte
Sections:

- **`soul`** — Voice / Tone / Boundaries („Du bist direkt, sachlich, …")
- **`identity`** — Name / Vibe / Emoji („Du bist Hermes, ein …")
- **`agents`** — Operating Rules („Schreibe Tests zuerst, …")

Resolver komponiert die drei mit benannten Markdown-Headern in den
finalen System-Prompt. Jeder Write auf eine Persona schreibt eine Row
in eine neue `persona_history`-Tabelle (Audit-Trail + Restore). Die
`/settings/preferences`-Persona-Card splittet das eine Textarea in drei
beschriftete Felder und bekommt einen „Verlauf"-Tab pro Persona.

## Why

Plan-35-Strategie-Doc nennt drei treibende Gründe:

1. **Diskoverabilität.** Eine Person, die eine Persona neu anlegt, soll
   sehen *was* sie schreiben muss, nicht ein leeres Mega-Textarea. Drei
   Felder mit Beispieltexten sind ein Onboarding-Touchpoint, den ein
   einzelnes Prompt-Blob nicht hat.
2. **Versionierung.** Wer eine Persona umbaut, kann heute die alte
   Version nicht zurückholen — kein Git, kein Audit-Log. Eine kleine
   History-Tabelle ist viel günstiger als der Versuch, Personas in den
   Workspace-Git zu spiegeln.
3. **Onboarding-Fundament.** Wave-A2-Bootstrap-Skill (Plan 37) schreibt
   programmatisch in genau diese drei Spalten. Solange `prompt` ein
   String ist, müsste der Bootstrap-Skill den String parsen und mergen
   — schmerzhaft. Drei Spalten = drei `set_persona_field`-Calls.

Persistenz bleibt in der DB (nicht MD-Files im Workspace), siehe
[[feedback-persona-db-with-history]]: Resolver läuft auf jedem
Chat-Turn, Sandbox-Mount-Latency und Sandbox-Availability dürfen nicht
zwischen User und Chat stehen. Multi-User (Wave C) wird `WHERE user_id
= ?` mit DB billiger als File-Mount-per-User.

## Non-Goals

- **Skill-Catalog / lazy-load** — Wave A2 = Plan 37. `persona_skills`
  bleibt unverändert in diesem Plan, wird in 37 gedroppt.
- **Per-persona Model + Credential-Pin** — Wave B = Plan 29-D-resurrect.
- **`user_profile`-Spalte oder USER-Block im Resolver** — verworfen per
  Plan 35; User-Facts leben in Notes, retrievable via `memory_search`
  ([[feedback-memory-search-not-prompt-inject]]).
- **Diff-Visualisierung in der History.** History-Tab zeigt nur den
  vollen Snapshot pro Row + Restore-Button. Wer Diffs will, kann zwei
  Rows nebeneinander öffnen (vielleicht in Wave-D-Polish nachgezogen).
- **Per-User-Author-Tracking.** `author` ist hartcodiert `"user"` bis
  Wave C echte User-IDs bringt.
- **Backwards-compat layer.** Alte `prompt`-Spalte wird beim Boot
  one-shot in `identity` migriert und gedroppt, kein
  Dual-Field-Übergang ([[feedback-no-backward-compat]]).
- **Cleanup-Strategie für die History-Tabelle.** Single-User-Box, eine
  Row pro Persona-Write — wird auf Jahre nicht zum Problem. Cleanup
  kann später als Diagnostic-Sweep nachgezogen werden.

## Architecture / Approach

### Schema-Diff

`src/hermes/schema.py` + `src/hermes/schema.sql`:

```diff
 personas = Table(
     "personas",
     metadata,
     Column("id", Integer, primary_key=True),
     Column("name", Text, nullable=False, unique=True),
-    Column("prompt", Text, nullable=False),
+    # Plan 36: prompt-Blob aufgesplittet in drei Fragments. Jede
+    # Spalte ist NOT NULL DEFAULT '' — Backfill (siehe Lifespan)
+    # kopiert den alten `prompt` in `identity`.
+    Column("soul", Text, nullable=False, server_default=""),
+    Column("identity", Text, nullable=False, server_default=""),
+    Column("agents", Text, nullable=False, server_default=""),
     Column("is_default", Integer, nullable=False, server_default="0"),
     Column("created_at", Integer, nullable=False),
     Column("updated_at", Integer, nullable=False),
 )
+
+# Plan 36: Audit-Trail. Eine Row pro Persona-Write. `snapshot_json`
+# enthält `{name, soul, identity, agents}` zum Zeitpunkt des Writes
+# (NICHT `is_default` — das ist eine Sortier-Eigenschaft, keine
+# Identität). `author` ist heute fix `'user'`; Wave C ersetzt mit
+# echter user_id.
+persona_history = Table(
+    "persona_history",
+    metadata,
+    Column("id", Integer, primary_key=True),
+    Column(
+        "persona_id",
+        Integer,
+        ForeignKey("personas.id", ondelete="CASCADE"),
+        nullable=False,
+    ),
+    Column("author", Text, nullable=False, server_default="user"),
+    Column("snapshot_json", Text, nullable=False),
+    Column("created_at", Integer, nullable=False),
+)
+Index("idx_persona_history_persona", persona_history.c.persona_id)
```

Trigger in `schema.sql` für single-default bleibt unverändert.

### Migration-Strategie (Lifespan one-shot, kein Migration-Framework)

`src/hermes/personas.py::ensure_backfill` bekommt einen
**vor-aller-anderen-Logik-Schritt**, der den Spaltenwechsel macht:

```python
async def _migrate_prompt_to_fragments(engine: AsyncEngine) -> None:
    """One-shot: if `personas.prompt` still exists, copy each row's
    `prompt` value into `identity` and drop the column. Idempotent —
    on a fresh DB the column is gone after the first boot, on an
    already-migrated DB the PRAGMA check returns no `prompt` row and
    this is a no-op.
    """
    async with engine.connect() as conn:
        cols = (await conn.execute(text("PRAGMA table_info(personas)"))).all()
        has_prompt = any(row.name == "prompt" for row in cols)
    if not has_prompt:
        return
    async with engine.begin() as conn:
        await conn.execute(
            text("UPDATE personas SET identity = prompt WHERE identity = ''")
        )
        await conn.execute(text("ALTER TABLE personas DROP COLUMN prompt"))
```

Lifespan-Reihenfolge in `main.py`:

```python
await _migrate_prompt_to_fragments(app.state.db)
await ensure_personas_backfill(app.state.db)
```

Wichtig: das `_migrate`-Helper ist Plan-36-spezifisch und kann nach
einer Box-Generation gelöscht werden — er ist nicht Teil des dauerhaften
Lifespan-Contracts. Trotzdem erstmal in `personas.py` neben
`ensure_backfill`, damit das gesamte Persona-Schema-Setup an einer
Stelle lebt.

`DEFAULT_PERSONA_PROMPT` wird durch drei Konstanten ersetzt:

```python
DEFAULT_PERSONA_SOUL: Final[str] = (
    "Du bist direkt, präzise und technisch. Keine Floskeln, keine "
    "Höflichkeitswulst — der User ist Senior-Engineer."
)
DEFAULT_PERSONA_IDENTITY: Final[str] = (
    "Du bist Hermes, ein persönlicher KI-Assistent."
)
DEFAULT_PERSONA_AGENTS: Final[str] = (
    "Du befolgst Test-Driven-Development: erst die Tests, dann die "
    "Implementierung. Du fragst nach, bevor du destruktive Aktionen "
    "ausführst."
)
```

### Resolver-Output-Format

`get_effective_system_prompt(channel, engine)` setzt den Persona-Teil
neu zusammen. Heute (Plan 29-A + 33):

```
<persona.prompt>

<skills_block>

<capability_index>

<channel.prompt>
```

Nach Plan 36:

```
## Soul
<persona.soul>

## Identity
<persona.identity>

## Agents
<persona.agents>

<skills_block>

<capability_index>

<channel.prompt>
```

**Regeln:**

- Eine Section mit leerem Body (nach `.strip()`) wird komplett
  ausgelassen — Header *und* Body. Kein „## Soul\n\n## Identity\n…".
- Section-Reihenfolge ist hartkodiert (Soul → Identity → Agents) und
  stabil über alle Personas. Reihenfolgewechsel ist UI-Feature, nicht
  Backend.
- Zwischen den Persona-Sections, zwischen Persona-Block und
  Skills-Block, zwischen Skills und Channel-Prompt → immer
  `"\n\n"` (eine Leerzeile). Innerhalb einer Section nur `"\n"` zwischen
  Header und Body.
- Wenn alle drei Persona-Sections leer sind UND `skills_block` leer ist
  UND `capability_index` leer ist → der Resolver gibt nur den
  Channel-Prompt zurück. (Channel-Prompt ist via Boot-Backfill nie
  leer.) Das ist nicht silently-fallback im Sinne von
  [[feedback-explicit-failure]] — der User hat alle drei Fragments
  selbst leer gemacht, und API-Layer hätte das bei `POST/PUT` schon
  als 422 abgelehnt (siehe „API-Validation" unten).

### History-Schema + Write-Flow

Eine Row in `persona_history` wird bei jeder dieser Aktionen
geschrieben:

| Aktion | Body |
|---|---|
| `POST /api/personas` | Snapshot des **neuen** Werts |
| `PUT /api/personas/{id}` | Snapshot **nach** dem Write |
| `POST /api/personas/{id}/history/{snapshot_id}/restore` | Snapshot des restaurierten Zustands (= identisch zum Body von `snapshot_id`, aber mit neuem `created_at` und neuer Row-ID) |

Der Restore schreibt also **selbst** eine History-Row. Wenn nicht, ist
der Audit-Trail beim ersten Rollback gebrochen: User restored Snapshot
3, schreibt nichts, geht weg — beim nächsten Edit gibt's Snapshot 4,
und niemand weiß mehr, dass Snapshot 3 mal wieder aktiv war.

`snapshot_json` shape:

```json
{
  "name": "Hermes",
  "soul": "…",
  "identity": "…",
  "agents": "…"
}
```

`is_default` wird **nicht** mitgeschrieben — Default ist ein
Sortier-Flag der gesamten Personas-Tabelle, nicht eine Eigenschaft
einer einzelnen Persona-Version. Restore ändert `is_default` nicht.

`DELETE /api/personas/{id}` löscht via FK-CASCADE auch alle
zugehörigen History-Rows. Das ist OK: Personas-Delete ist eh die
„komplett verschwinden"-Aktion, History dazu ist nutzlos.

### API-Validation

`PersonaCreate` / `PersonaUpdate` Pydantic-Modelle:

```python
class PersonaCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    soul: str = Field(default="", max_length=8192)
    identity: str = Field(default="", max_length=8192)
    agents: str = Field(default="", max_length=8192)
    is_default: bool = False

    @model_validator(mode="after")
    def _at_least_one_fragment(self) -> "PersonaCreate":
        if not (self.soul.strip() or self.identity.strip() or self.agents.strip()):
            raise ValueError("PERSONA_FRAGMENTS_ALL_EMPTY")
        return self


class PersonaUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    soul: str | None = Field(default=None, max_length=8192)
    identity: str | None = Field(default=None, max_length=8192)
    agents: str | None = Field(default=None, max_length=8192)
    is_default: bool | None = None
    # All-empty validation runs after the merge with the existing row,
    # inside the route handler — model-validator can't see what's
    # already in the DB. See route flow below.
```

**Wichtig:** das alte `prompt`-Field ist in beiden Modellen
verschwunden. Pydantic 2 ignoriert unbekannte Felder per default
(unsere Config setzt das nicht um) — d.h. ein Client, der noch
`prompt: "..."` sendet, kriegt seine `name`/`is_default`-Felder
gespeichert und sein `prompt` wird stillschweigend verworfen. Das ist
**nicht** akzeptabel laut [[feedback-no-backward-compat]] +
[[feedback-explicit-failure]]: lieber explizit fehlschlagen.

Also: `model_config = ConfigDict(extra="forbid")` auf beiden Modellen,
sodass ein `prompt`-Feld vom Client als 422 zurückkommt.

Neue ErrorCodes in `src/hermes/errors.py`:

```python
PERSONA_FRAGMENTS_ALL_EMPTY = "PERSONA_FRAGMENTS_ALL_EMPTY"
PERSONA_HISTORY_NOT_FOUND = "PERSONA_HISTORY_NOT_FOUND"
PERSONA_HISTORY_PERSONA_MISMATCH = "PERSONA_HISTORY_PERSONA_MISMATCH"
```

### History-Endpoints

```
GET    /api/personas/{persona_id}/history
       → { "history": [{id, author, snapshot, created_at}, …] }
       Sortiert nach created_at DESC (neueste zuerst).

POST   /api/personas/{persona_id}/history/{snapshot_id}/restore
       → 200, body = aktualisierte Persona-Row (gleiche Shape wie PUT).
       Validates: snapshot_id existiert UND gehört zu persona_id.
       Bei Mismatch → 422 PERSONA_HISTORY_PERSONA_MISMATCH.
       Bei unbekannter snapshot_id → 404 PERSONA_HISTORY_NOT_FOUND.
       Side-effect: schreibt eine neue History-Row (siehe oben).
```

### Frontend-Surface

`/settings/preferences` Persona-Card:

- Im Read-View bleibt die Card-Header-Zeile (Name + Default-Badge +
  Buttons). Statt der heutigen 3-Zeilen-Prompt-Preview kommen drei
  kleine Untergruppen:
  - „Soul" + Body (line-clamp-2)
  - „Identity" + Body (line-clamp-2)
  - „Agents" + Body (line-clamp-2)
- Edit-View: drei Textareas statt einer, gestapelt, jede ~4 Zeilen
  hoch, jeweils mit Label + ein-Zeile-Description.
- Create-Form: gleiche drei Textareas, jeweils mit Placeholder
  (Beispieltexte, damit der User sieht *was* er da schreiben soll).
- Neuer **„Verlauf"-Toggle** pro Persona-Card. Aufgeklappt zeigt er
  eine Liste der Snapshots (neueste oben) als kompakte Cards:
  - Header: relatives Datum („vor 2 Tagen") + ISO-Timestamp als
    `title`-Attribut für Hover.
  - Body: Name + drei Fragments (mit Section-Headern), line-clamp-3.
  - Footer: ein **„Wiederherstellen"**-Button mit Confirm-Dialog.
- Die Skills-Sub-Section unter der Persona-Card bleibt **unverändert**
  (wird erst in Plan 37 gedroppt).

i18n-Keys (neu, in beiden Locales):

```
pages.preferences.personas.fragments.soul.label
pages.preferences.personas.fragments.soul.description
pages.preferences.personas.fragments.soul.placeholder
pages.preferences.personas.fragments.identity.label
pages.preferences.personas.fragments.identity.description
pages.preferences.personas.fragments.identity.placeholder
pages.preferences.personas.fragments.agents.label
pages.preferences.personas.fragments.agents.description
pages.preferences.personas.fragments.agents.placeholder
pages.preferences.personas.history.title
pages.preferences.personas.history.toggle
pages.preferences.personas.history.empty
pages.preferences.personas.history.restoreButton
pages.preferences.personas.history.restoreConfirm.title
pages.preferences.personas.history.restoreConfirm.description
errors.PERSONA_FRAGMENTS_ALL_EMPTY
errors.PERSONA_HISTORY_NOT_FOUND
errors.PERSONA_HISTORY_PERSONA_MISMATCH
```

Die alten i18n-Keys `pages.preferences.personas.form.prompt` +
`form.promptShort` werden gelöscht (Tests in `tests/i18n/keys.test.ts`
fangen Locale-Drift).

### Failure-Policy-Mapping

Wo läuft was schief, was passiert?

| Fehler | Ort | UX |
|---|---|---|
| Client sendet `prompt:` | Pydantic `extra="forbid"` | 422, FE rendert „Unbekanntes Feld" via `translateError` |
| Client sendet alle drei Fragments leer | `_at_least_one_fragment` validator | 422 `PERSONA_FRAGMENTS_ALL_EMPTY`, FE rendert „Mindestens ein Fragment muss gefüllt sein" |
| Update setzt alle drei leer (merge-Result leer) | Route handler nach merge | 422 `PERSONA_FRAGMENTS_ALL_EMPTY` |
| Restore unbekannter snapshot_id | Repo `get_history(id)` returns None | 404 `PERSONA_HISTORY_NOT_FOUND` |
| Restore snapshot von anderer Persona | Snapshot.persona_id ≠ URL persona_id | 422 `PERSONA_HISTORY_PERSONA_MISMATCH` |
| Resolver: alle drei + skills + index leer | Theoretisch unreachable (API-Layer hat das schon abgelehnt) | Channel-Prompt allein; kein Crash, kein silently-fallback (siehe Resolver-Format) |

## Scope

### Backend (`/home/haex/Projekte/Holzi`, package `hermes`)

1. **Schema**: `src/hermes/schema.py` — Tabelle `personas` umbauen,
   Tabelle `persona_history` neu. `src/hermes/schema.sql` — Trigger
   für single-default bleibt unverändert; neue Tabelle braucht keinen
   Trigger.
2. **Migration-Helper**: `src/hermes/personas.py::_migrate_prompt_to_fragments`
   (one-shot, PRAGMA-gated).
3. **Default-Constants**: `DEFAULT_PERSONA_SOUL` / `IDENTITY` /
   `AGENTS` ersetzen `DEFAULT_PERSONA_PROMPT`.
4. **Dataclass**: `repository/models.py::Persona` bekommt drei Felder
   `soul`/`identity`/`agents` statt `prompt`. Neue Dataclass
   `PersonaHistory` für History-Rows.
5. **Personas-Repo**: `repository/personas.py` — alle `create`/`update`/
   `get` schalten auf drei Spalten um. Repo schreibt automatisch eine
   History-Row in `create` und `update` (gleicher Connection-Cursor,
   ein `engine.begin()`-Block).
6. **History-Repo**: neue Datei `repository/persona_history.py` mit
   `write_snapshot(engine, persona_id, persona, *, author='user',
   ts=None)` + `list_for_persona(engine, persona_id)` + `get(engine,
   snapshot_id)`. `write_snapshot` serialisiert `Persona` zu JSON.
7. **Resolver**: `src/hermes/personas.py::get_effective_system_prompt`
   — neue Section-Komposition mit `## Soul`/`## Identity`/`## Agents`-
   Headern. Skills- und Capability-Index-Strang unverändert.
8. **Routes**: `routes/preferences.py` —
   `PersonaResponse`/`PersonaCreate`/`PersonaUpdate` umbauen (`prompt`
   raus, drei Fragments rein + `extra="forbid"`). Endpoints
   `GET /api/personas/{id}/history` +
   `POST /api/personas/{id}/history/{snapshot_id}/restore` neu.
9. **ensure_backfill**: schreibt Default-Persona mit drei
   Fragment-Defaults; ruft automatisch History-Snapshot mit
   `author='system'` (Sonderfall, damit der User die Initial-Seed-Row
   im Verlauf sieht).
10. **ErrorCode-Enum**: drei neue Members
    (`PERSONA_FRAGMENTS_ALL_EMPTY`, `PERSONA_HISTORY_NOT_FOUND`,
    `PERSONA_HISTORY_PERSONA_MISMATCH`).
11. **Lifespan**: `_migrate_prompt_to_fragments` *vor*
    `ensure_personas_backfill` aufrufen.

### Frontend (`/home/haex/Projekte/holzi-frontend`)

1. **gen:api**: backend-port 18082 (siehe
   [[reference-gen-api-command]]), `pnpm run gen:api` — neue Types
   `Persona`, `PersonaCreate`, `PersonaUpdate`, `PersonaHistoryItem`,
   `PersonaHistoryListResponse`.
2. **Composable**: `app/composables/usePersonas.ts` updaten —
   `create`/`update` bekommen `soul`/`identity`/`agents` statt
   `prompt`. Zwei neue Methoden `history(personaId)` und
   `restoreHistory(personaId, snapshotId)`.
3. **Page**: `app/pages/settings/preferences.vue`:
   - Persona-Edit-Form: drei Textareas mit Labels + Descriptions +
     Placeholders aus i18n.
   - Persona-Read-View: drei Mini-Subsections statt `<pre>`.
   - Pro Card: `<details>`-Toggle „Verlauf" mit Liste +
     Restore-Buttons (mit `useConfirm`).
   - Restore-Button schickt POST + reloadet Liste + History.
4. **i18n-Locales**: `i18n/locales/de.json` + `i18n/locales/en.json` —
   neue Keys (siehe Liste oben). Alte Keys `…form.prompt` +
   `…form.promptShort` löschen.
5. **errorMessages.ts**: `app/lib/errorMessages.ts` — neue Codes auf
   `errors.<CODE>` mappen (eigentlich macht das `translateError`
   automatisch sobald die Locale-Keys da sind; siehe
   [[reference-error-code-contract]]).

### Tests

**Backend:**

- `tests/test_personas_repo.py` — CRUD-Tests umbauen auf drei
  Fragments. Neue Assertion: jede `create`/`update` schreibt eine
  `persona_history`-Row.
- `tests/test_personas_resolver.py` — Composition mit `## Soul`/`##
  Identity`/`## Agents`-Headern; leere Section wird ausgelassen;
  Reihenfolge stabil; Channel-Prompt bleibt letzter Block; Skills
  bleiben zwischen Persona und Channel.
- `tests/test_api_preferences.py` —
  - CRUD-Roundtrip mit drei Fragments.
  - `prompt`-Feld im Body → 422 (extra="forbid").
  - Alle drei leer → 422 `PERSONA_FRAGMENTS_ALL_EMPTY`.
  - `GET .../history` initially: 1 Row aus dem
    `ensure_backfill`-Seed (für die Default-Persona).
  - `POST .../history/{snapshot_id}/restore` → Body matched
    Snapshot, History bekommt eine neue Row dazu.
  - Restore mit fremder snapshot_id → 422 `PERSONA_HISTORY_PERSONA_MISMATCH`.
  - Restore unbekannter snapshot_id → 404 `PERSONA_HISTORY_NOT_FOUND`.
- `tests/test_personas_migration.py` (neu): seed eine Pre-Plan-36-DB
  manuell (alte `prompt`-Spalte da, Row mit
  `prompt='legacy-text'`), `_migrate_prompt_to_fragments` laufen
  lassen, assert dass `identity='legacy-text'` und `prompt`-Spalte
  weg ist. Zweiter Lauf → Idempotenz (kein Crash, keine Änderung).

**Frontend:**

- `tests/components/PreferencesPage.test.ts` — Fragmente-Felder
  testen:
  - Create-Form rendert drei Textareas.
  - Edit-Form populiert die drei Felder aus persistierter Persona.
  - Read-View zeigt drei Sections.
  - History-Toggle öffnet Liste, Restore-Button schickt POST +
    Persona-Liste lädt neu.
- `tests/i18n/keys.test.ts` (existierend) bricht ohnehin, wenn ein
  Key in einer Locale fehlt — i18n-Coverage ist passiv abgesichert.
- `tests/i18n/error-codes.test.ts` (existierend) parst die `ErrorCode`-
  Enum aus dem Backend-File und enforced FE-Mapping — die drei neuen
  Codes brauchen Translation in beiden Locales.

### Docs

- Plan 36 (dieses File): Status-Line + Verification-Block am
  Session-Ende anpassen (siehe „Verification" weiter unten).
- Plan 35 (Strategic Roadmap): am Wave-A1-Eintrag eine „**A1 done
  YYYY-MM-DD**"-Zeile ergänzen, sobald Plan 36 auf `main` ist.
- README/User-Guide: kein Update nötig — Persona-Editor ist noch
  nicht user-doc'd (Wave-A-Ende ist der Punkt für ein Persona-Doc).
- Memory: am Sessionende `project_holzi_i18n_foundation`-Memory
  unverändert; neue Memory `project_holzi_persona_fragments` mit
  Schema + Resolver-Format + History-Contract als Referenz für
  Wave-A2/B-Sessions.

## Tasks

Aufeinander aufbauend. Commits nach jedem Task. Backend zuerst, dann
gen:api, dann Frontend (siehe [[feedback-cross-repo-workflow]]).

### Task 1: Backend — Schema-Diff + Migration-Helper

**Files (backend):**

- Modify: `src/hermes/schema.py:362-372` (Tabelle `personas`),
  + neue Tabelle `persona_history` darunter.
- Modify: `src/hermes/repository/models.py:147-158` (Dataclass
  `Persona`) + neue Dataclass `PersonaHistory`.
- Modify: `src/hermes/personas.py:60-65` (Default-Constants).
- Modify: `src/hermes/personas.py` — neuer Helper
  `_migrate_prompt_to_fragments(engine)`.
- Modify: `src/hermes/main.py:124-128` (Lifespan).
- Create: `tests/test_personas_migration.py` (neu).

**Steps:**

1. Schreibe `tests/test_personas_migration.py` mit zwei Tests
   (idempotent + happy-path-copy-and-drop). Lauf → FAIL.
2. Implementiere `_migrate_prompt_to_fragments` mit
   PRAGMA-table_info-Check + UPDATE + ALTER TABLE DROP COLUMN.
3. Schema-Diff in `schema.py` + Dataclass-Diff in `models.py`. (Tests
   in `test_personas_repo.py` brechen jetzt — OK, kommt Task 2.)
4. Default-Constants umbauen + Lifespan-Call einbauen.
5. `uv run pytest tests/test_personas_migration.py` → grün.
6. Commit: `feat(personas): split prompt into soul/identity/agents columns + migration helper`.

### Task 2: Backend — Repo-Layer + History-Repo

**Files (backend):**

- Modify: `src/hermes/repository/personas.py` (komplettes File:
  `_row_to_persona` + `create` + `update` umstellen, History-Row in
  `create`/`update` automatisch schreiben).
- Create: `src/hermes/repository/persona_history.py` (neu).
- Modify: `tests/test_personas_repo.py` (alle bisherigen Asserts auf
  drei Fragments umstellen + History-Row-Asserts).
- Create: `tests/test_persona_history_repo.py` (neu, ~6 Tests).

**Steps:**

1. Failing-Tests für `persona_history`-Repo zuerst
   (`write_snapshot`/`list_for_persona`/`get`).
2. Repo implementieren, Tests grün ziehen.
3. `personas.repository.create`/`update` so umbauen, dass sie eine
   History-Row im selben Transaktionsblock schreiben (`async with
   engine.begin() as conn` umschließt INSERT + History-INSERT).
4. `tests/test_personas_repo.py` umbauen + grün.
5. `uv run pytest tests/test_personas_repo.py tests/test_persona_history_repo.py` → grün.
6. Commit: `feat(personas): persona_history repo + auto-snapshot on create/update`.

### Task 3: Backend — Resolver-Output mit Section-Headern

**Files (backend):**

- Modify: `src/hermes/personas.py::get_effective_system_prompt`.
- Modify: `tests/test_personas_resolver.py` (alle Asserts auf
  Section-Header-Output).

**Steps:**

1. Failing-Tests umbauen: Composition mit Headern, leere Section
   ausgelassen, Skills bleiben zwischen Persona und Channel.
2. Resolver-Funktion umbauen — Persona-Block ist jetzt eine Liste
   `_persona_sections(persona)` die Tupel `(header, body)` liefert
   und nur nicht-leere Bodies durchgibt.
3. `uv run pytest tests/test_personas_resolver.py` + bestehende
   `test_api_chat.py` / `test_scheduler.py`-Tests laufen
   (Composition-Assertions dort sind grob; falls sie auf exakten
   Output-Strings hängen, anpassen — sonst nur grün-pinnen).
4. Commit: `feat(personas): resolver composes soul/identity/agents with named headers`.

### Task 4: Backend — Routes + neue Endpoints

**Files (backend):**

- Modify: `src/hermes/routes/preferences.py`:
  - `PersonaResponse`/`PersonaCreate`/`PersonaUpdate` umbauen
    (Fragments + `extra="forbid"`).
  - `_persona_to_dict` umbauen.
  - Neue Endpoints `list_persona_history` +
    `restore_persona_history` registrieren.
  - `_at_least_one_fragment`-Check auch im Update-Pfad (nach Merge).
- Modify: `src/hermes/errors.py` — drei neue ErrorCodes ergänzen.
- Modify: `tests/test_api_preferences.py` — alle bisherigen Tests
  auf Fragments umstellen, neue Tests für History + Restore + 422-Fälle.

**Steps:**

1. ErrorCode-Enum-Members ergänzen.
2. Failing-Tests in `test_api_preferences.py` ergänzen
   (Fragments-CRUD + extra=forbid-422 + all-empty-422 + History +
   Restore-happy-path + Mismatch + Not-Found).
3. Pydantic-Modelle umbauen + History-Endpoints implementieren.
4. `uv run pytest tests/test_api_preferences.py` → grün.
5. Commit: `feat(api): persona fragments + history endpoints`.

### Task 5: Backend — ensure_backfill + Full Test-Run

**Files (backend):**

- Modify: `src/hermes/personas.py::ensure_backfill` — schreibt drei
  Fragments für die Default-Persona + History-Row mit
  `author='system'`.
- Run: `uv run pytest` (gesamt), `uv run ruff check src/ tests/`,
  `uv run mypy src/`.

**Steps:**

1. `ensure_backfill` umbauen, dass es die drei
   `DEFAULT_PERSONA_*`-Konstanten benutzt + initialen History-Eintrag
   schreibt (über das Repo).
2. Pinned tests im `test_api_chat.py` / `test_scheduler.py` —
   wahrscheinlich pinnen sie schon `system_prompt` als String;
   anpassen auf neuen Composition-Output mit Headern.
3. `uv run pytest` → all green.
4. `uv run ruff check src/ tests/` → clean.
5. `uv run mypy src/` → clean.
6. Commit: `feat(personas): backfill writes initial history snapshot + green sweep`.

### Task 6: Frontend — gen:api + Composable

**Files (frontend):**

- Modify: `app/types/api-generated.ts` (via `pnpm run gen:api`).
- Modify: `app/composables/usePersonas.ts` — `create`/`update` neue
  Body-Shape; zwei neue Methoden `history(id)` +
  `restoreHistory(id, snapshotId)`.

**Steps:**

1. Backend hochfahren (Port 18082, siehe
   [[reference-gen-api-command]]).
2. `pnpm run gen:api`. Diff im `app/types/api-generated.ts`-File
   prüfen: drei Fragments rein, `prompt` raus, History-Types neu.
3. Composable-Methoden ergänzen (jede ~5-8 Zeilen,
   `$fetch`-Pattern wie schon vorhanden).
4. `pnpm typecheck` → exit 0 (TS-Bruch im `preferences.vue` ist
   erwartet, kommt in Task 7).
5. Commit: `feat(api-types): regenerate for persona fragments + history`.

### Task 7: Frontend — Page-Refactor (Persona-Card + History-Subview)

**Files (frontend):**

- Modify: `app/pages/settings/preferences.vue` —
  - Read-View: drei Mini-Sections für Soul/Identity/Agents.
  - Edit-View: drei Textareas mit Labels + Descriptions.
  - Create-Form: drei Textareas mit Placeholders.
  - Pro Card: `<details>`-Toggle „Verlauf" mit Liste +
    Restore-Buttons.

**Steps:**

1. State im `<script setup>` umbauen: `formPrompt` → `formSoul` /
   `formIdentity` / `formAgents`. `openEdit` populiert alle drei.
2. Submit-Form ruft `usePersonas.create({name, soul, identity,
   agents, is_default})` oder `update(id, …)`.
3. Read-View: drei Mini-Sections statt eines `<pre>`.
4. History-Toggle: `<details>` pro Card mit
   `personaHistory.value[id]`-Ref, lädt on-toggle via
   `usePersonas.history(id)`.
5. Restore-Button: `useConfirm` → POST → reload Personas + History.
6. Error-Handling: `translateError(err, t)` für alle Pfade (siehe
   [[reference-error-code-contract]]).
7. `pnpm typecheck` → exit 0.
8. Commit: `feat(preferences): three-fragment persona editor + history subview`.

### Task 8: Frontend — i18n-Keys (beide Locales)

**Files (frontend):**

- Modify: `i18n/locales/de.json`.
- Modify: `i18n/locales/en.json`.
- Modify (vielleicht): `app/lib/errorMessages.ts` (falls dort ein
  expliziter Code-Map-Pin nötig ist — sonst lädt `translateError`
  via `errors.<CODE>` direkt).

**Steps:**

1. Neue Keys (siehe Liste in Architecture) in beiden Locales
   ergänzen.
2. Alte Keys `…form.prompt` + `…form.promptShort` löschen.
3. Drei neue ErrorCode-Keys `errors.PERSONA_FRAGMENTS_ALL_EMPTY` /
   `errors.PERSONA_HISTORY_NOT_FOUND` /
   `errors.PERSONA_HISTORY_PERSONA_MISMATCH` in beiden Locales.
4. `pnpm vitest run tests/i18n` → grün (keys.test + error-codes.test).
5. Commit: `feat(i18n): persona fragments + history locale keys`.

### Task 9: Frontend — PreferencesPage.test.ts updaten

**Files (frontend):**

- Modify: `tests/components/PreferencesPage.test.ts`.

**Steps:**

1. Mocks für `usePersonas` updaten (drei Fragments + History +
   Restore).
2. Tests:
   - Render: drei Textareas in Create-Form.
   - Edit: Form populiert mit Fragments.
   - Submit: POST mit drei Fragments im Body.
   - History-Toggle: ruft `usePersonas.history` auf + rendert Liste.
   - Restore-Button: Confirm-Dialog + POST + reload.
3. `pnpm vitest run tests/components/PreferencesPage.test.ts` → grün.
4. `pnpm vitest run` (gesamt) → grün.
5. `pnpm typecheck` → exit 0.
6. Commit: `test(preferences): persona fragments + history coverage`.

### Task 10: Live-Smoke + Status-Update + Memory

**Files:**

- Modify: `docs/plans/holzi-agent-parity/36-personas-fragments.md`
  (dieses File) — Status auf „Merged YYYY-MM-DD" + Verification-Block.
- Modify: `docs/plans/holzi-agent-parity/35-strategic-roadmap-2026h2.md` —
  Wave-A1-Eintrag mit „**A1 done YYYY-MM-DD**".
- Modify: `~/.claude/projects/-home-haex-Projekte-holzi-frontend/memory/MEMORY.md`
  + neue Memory-Datei.

**Steps:**

1. `make up-local-full` (Holzi-Backend-Container + Frontend
   lokal). Browser auf `/settings/preferences`:
   - Default-Persona „Hermes" ist da mit drei Fragments.
   - Persona umbenennen + Identity-Feld ändern → Speichern.
   - „Verlauf" aufklappen → neue Snapshot-Row + die initiale
     Seed-Row sichtbar.
   - Restore auf die initiale Seed-Row → Persona-Werte snappen zurück
     + History-Liste hat eine Row mehr.
2. Status-Line + Verification-Block in Plan 36 ergänzen (Plan 30
   Vorbild).
3. Wave-A1-Eintrag in Plan 35 mit „done"-Marker.
4. Memory-Datei `project_holzi_persona_fragments.md` schreiben.
5. Commit: `docs: mark Plan 36 (Wave A1) complete`.

## Verification

> _Wird beim Sessionende ausgefüllt (Plan-30-Format als Vorbild). Bis
> dahin: Tasks 1-10 unchecked oben._

Erwartete End-State:

- Backend: `uv run pytest` → all passed, `uv run ruff check src/
  tests/` clean, `uv run mypy src/` clean.
- Frontend: `pnpm vitest run` → all passed, `pnpm typecheck` exit 0.
- Live-Smoke: Persona umbenennen → History-Tab zeigt zwei Rows
  (Seed + Edit). Restore → drei Rows (Seed + Edit + Restore-Snapshot).

## Risk Register

| Risk | Mitigation |
|---|---|
| One-shot-Migration auf Box mit existierenden Personas (eigentlich der Single-User-Fall) crashed oder schmeißt User-Content weg | `tests/test_personas_migration.py` seeded eine Pre-Plan-36-DB manuell und assertet Idempotenz + Content-Copy. Migration läuft *vor* `ensure_backfill`, sodass Default-Seed nicht den User-Content überschreibt. |
| Resolver-Output-Drift bricht laufende Conversation-Snapshots (Frontend rendert Chat-History mit altem System-Prompt im Run-Meta) | System-Prompts sind run-zeitig komponiert; sie stehen NICHT in Conversation-Messages. `agent_runs.meta_json` enthält sie zwar zum Audit, das ist read-only Diagnostics — kein Drift-Risk in der UX. |
| `persona_history`-Tabelle wächst unbounded | Single-User-Box, eine Row pro Persona-Write. Tausende Writes in Jahren = MBs. Cleanup-Task später, kein Blocker für diesen Plan. |
| Bisheriger `prompt`-User-Content geht im FE verloren, weil die UI die alte 3-Zeilen-Preview gegen drei Mini-Sections tauscht | Migration kopiert `prompt → identity`. Identity-Section bleibt also gefüllt; User sieht seinen alten Content im Identity-Feld + leeren Soul/Agents-Feldern, kann beim ersten Edit reorganisieren. |
| `extra="forbid"` lehnt Client-Requests ab, die noch `prompt` mitsenden — Frontend ist aber im selben Repo + selbem PR → kein Cross-Version-Risiko | Beide Seiten in der gleichen Session umgebaut. Live-Smoke fängt jeden vergessenen Call-Site. |
| Pydantic `model_validator(mode="after")` schlägt mit `ValueError("PERSONA_FRAGMENTS_ALL_EMPTY")` zu, FastAPI rendert das als 422 mit Pydantic-Error-Body (nicht als `{code, params}`-Detail wie der Rest) | Validator soll keine FastAPI-HTTPException werfen (geht auch nicht aus dem Modell raus). Stattdessen: kein `model_validator`, sondern Check im Route-Handler nach `body.model_dump()` → `HTTPException(422, detail={code: …, params: {}})`. Konsistent mit allen anderen Routes ([[reference-error-code-contract]]). |
| Resolver muss die Output-Reihenfolge stabil halten, sonst sieht der gleiche Persona-Editstand zwei Conversations weit auseinanderliegen | Resolver-Tests pin die exakte Output-String-Composition (mit Headern, Separatoren, Reihenfolge). Hartkodierte `[("## Soul", soul), ("## Identity", identity), ("## Agents", agents)]`-Liste statt Loop über Dict-Items (Dict-Order ist garantiert seit Py3.7, aber expliziter ist besser). |
| Restore-Endpoint könnte den `name`-UNIQUE-Constraint verletzen (User hat Persona umbenannt, will alten Namen restoren, der jetzt einer *anderen* Persona gehört) | Selten, aber möglich. Bei IntegrityError → 409 `PERSONA_NAME_CONFLICT` (gleicher Code wie create/update). FE rendert via `translateError`. Kein neuer ErrorCode nötig. |

## Open Questions

- Soll die Default-Seed-History-Row `author='system'` heißen oder
  `author='user'`? Vorschlag: `'system'`, damit der User in der UI
  sehen kann „das war die initiale Seed-Persona, nicht von mir
  geschrieben". Wave C kann das Schema dann erweitern. *Entschieden
  während Implementation, falls die UI Distinktion braucht.*
- Brauchen wir eine Begrenzung auf `persona_history`-Listenlänge im
  GET-Endpoint (paginieren / `?limit=`)? Vorschlag: nein für jetzt —
  Single-User, wenige Writes. Wenn der erste User mal 500 Edits
  macht, paginieren wir.
- Sollen die `## Soul`/`## Identity`/`## Agents`-Header
  internationalisiert sein? Vorschlag: **nein**. Das sind interne
  Marker für das LLM (das eh meistens englisch denkt) und für stabile
  Resolver-Tests. Die *UI-Labels* sind übersetzt; die *Prompt-Header*
  bleiben Englisch.
- Sollte der Restore-Endpoint einen `confirm`-Param brauchen
  (`?dry_run=true` returns die zu schreibende Persona, ohne sie zu
  schreiben)? Vorschlag: **nein** — UI macht `useConfirm`,
  Backend macht's einfach. Keine doppelte Source-of-Truth fürs
  Confirm-UX.

## Decision Log

- 2026-06-04: Wave-A1 als erstes File der Wave-A-Familie eröffnet.
  Spalten-Namen `soul`/`identity`/`agents` (Englisch, weil
  Spaltennamen permanent sind und die DB-Konvention hier Englisch
  ist; siehe Plan 35 Open Question „A1 column-name choice").
- 2026-06-04: Resolver-Format mit Markdown-Section-Headern entschieden
  (statt nackten `\n\n`-getrennten Strings) — gibt dem LLM
  semantische Hinweise auf die Section-Grenzen, ohne dass wir den
  Effective-Prompt-Preview im UI bauen müssen.
- 2026-06-04: Restore schreibt selbst eine History-Row.
  Audit-Trail-Konsistenz schlägt minimal-write-Approach.
- 2026-06-04: `extra="forbid"` auf `PersonaCreate`/`PersonaUpdate` —
  alte `prompt`-Felder vom Client failen explizit (422), kein
  silently-discard ([[feedback-no-backward-compat]] +
  [[feedback-explicit-failure]]).
- 2026-06-04: `_migrate_prompt_to_fragments` als one-shot im
  Lifespan, kein dauerhaftes Migration-Framework. Migration-Helper
  lebt neben `ensure_backfill` und kann nach einer Box-Generation
  gelöscht werden.
- 2026-06-04: `is_default` wandert *nicht* mit in den
  History-Snapshot — Default ist eine Sortier-Eigenschaft der ganzen
  Tabelle, keine Persona-Versionseigenschaft. Restore ändert
  `is_default` nicht.
- 2026-06-04: All-empty-Validation im Route-Handler statt im
  Pydantic-`model_validator` — konsistent mit den anderen
  `ErrorCode`-Detail-Shapes; Pydantic-422 sieht anders aus als die
  Rest-API-422.
