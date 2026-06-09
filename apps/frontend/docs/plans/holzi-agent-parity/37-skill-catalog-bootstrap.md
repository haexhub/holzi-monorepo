# Plan 37: Skill-Catalog (lazy-load) + Bootstrap-Skill

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task.

Status: **Merged 2026-06-05.**

## Verification

BE branch `wave-a2-skill-catalog` — 8 commits:

| SHA | Commit |
|---|---|
| `7b423b5` | feat(skills): drop persona_skills + add enabled column + users table |
| `46d57e1` | feat(skills): repo learns enabled column + users module + drop persona_skills repo |
| `cf8d442` | feat(personas): resolver emits skill catalog index + bootstrap hint |
| `879f275` | feat(tools): skill_load + skill_search built-in tools |
| `e8741e8` | feat(tools): persona_update + mark_bootstrap_complete built-in tools |
| `48cddf7` | feat(skills): seed bootstrap-first-chat skill on first boot |
| `e78d251` | feat(api): skills CRUD learns enabled + drop persona_skills endpoints |
| `1ee6827` | test(bootstrap): integration coverage for catalog + load + persona_update + complete |

FE branch `wave-a2-skill-catalog` — 4 commits:

| SHA | Commit |
|---|---|
| `71b0086` | feat(api-types): regenerate for skill catalog + enabled flag + drop persona_skills |
| `be4599f` | feat(skills): global enabled toggle + token budget counter |
| `43853b9` | feat(preferences): drop persona-skill activation block |
| `d95bc49` | feat(i18n): skill catalog locale keys + drop persona-skill keys |

**Test results:**
- Backend: `uv run pytest` → **904 passed**, ruff clean, mypy clean
- Frontend: `pnpm vitest run` → **459 passed**, typecheck exit 0

**Live-Smoke (2026-06-05):**
- `/settings/skills` — bootstrap-first-chat Skill sichtbar, enabled-Toggle, Token-Counter `~82 Tokens · 1/1 aktiv` ✓
- `/settings/preferences` — kein Persona-Skills-Block mehr ✓
- System-Prompt enthält `## Available skills` + Bootstrap-Hint ✓
- `users.bootstrap_completed = 0` nach erstem Boot ✓

Second implementation file of Wave A
([Plan 35 §A2](./35-strategic-roadmap-2026h2.md#a2--skill-catalog-lazy-load--bootstrap-skill)).
Replaces the Per-Persona-Skill-Attach model from
[Plan 33](./33-skills-as-db-artifacts.md) with a lazy-load Catalog +
ships the first end-to-end Bootstrap-Skill flow.

Cross-repo. Backend ist die Substanz (Schema-Bruch + Migration +
Resolver-Composition + neue Tools + Seed); Frontend droppt die
Per-Persona-Skills-UI auf Preferences und ergänzt die Skills-Page um
einen globalen `enabled`-Toggle + Token-Budget-Counter.

Depends on:
- [33](./33-skills-as-db-artifacts.md) — `skills`-Tabelle + Skills-Page
  + Persona-Skill-Activation-Endpoints existieren; dieser Plan droppt
  die Per-Persona-Attach-Schicht und schaltet auf Catalog-Index +
  `skill_load`-Tool um.
- [36](./36-personas-fragments.md) — `personas.soul`/`identity`/`agents`
  + `persona_history` existieren; Bootstrap-Skill schreibt programma-
  tisch in genau diese drei Spalten und benutzt `history_author`-Kwarg
  (`'bootstrap'` als vierter Tier neben `user`/`system`/`migration`).
- [31](./31-tool-inventory-and-mcp-surface.md) + [32-A](./32a-agent-self-inventory.md)
  — `tool_catalog` + Tool-Constructor-Signature + Redaction-Hook
  existieren; neue Tools registrieren sich im selben Builder.
- [30](./30-i18n-foundation.md) — `ErrorCode`-Enum + bilinguale UI ist
  ab hier Pflicht; neue HTTP-Errors gehen über
  `{code, params}`-Detail-Shape.

Followups:
- Wave A3 = Plan 38 (Curated Starter Skill Library, ~6–10 Seed-Skills
  als Catalog-Entries).
- Wave B1 = Plan 29-D-Resurrect (Modell pro Persona) — unabhängig.

## Goal

Skills werden zu einem **globalen Register**, das jeder Persona zur
Verfügung steht. Der System-Prompt enthält nur einen schmalen
**Catalog-Index** (eine Zeile pro enabled Skill: Slug + Description +
when-to-use, ~20 Token/Skill). Body bleibt in der DB. Wenn der Agent
während eines Chat-Turns einen Skill braucht, ruft er das neue
Built-in-Tool **`skill_load(slug)`** und kriegt den vollen Body als
Tool-Result — lazy, on demand, vom LLM selbst entschieden. Das ist
das Anthropic-Agent-SDK / MCP-Pattern („Description sichtbar, Body
auf Abruf") angewandt auf Holzi-Skills.

Die in [Plan 33](./33-skills-as-db-artifacts.md) eingeführte
Per-Persona-Pin-Tabelle `persona_skills` + die zugehörigen
`GET/PUT /api/personas/{id}/skills`-Endpoints gehen ersatzlos weg.
Es gibt ab Plan 37 keine Persona-Skill-Curation mehr, weder im
Backend noch im UI.

Auf demselben Mechanismus reitet ein erster konkreter Use-Case: ein
**Bootstrap-Skill**. Bei einer frischen Installation
(`users.bootstrap_completed = 0`) bekommt der System-Prompt einen
einzeiligen Hint, der den Agenten anweist, beim ersten User-Turn
`skill_load('bootstrap-first-chat')` zu rufen. Der Skill-Body führt
eine 3–5-Fragen-Q&A durch, schreibt das Ergebnis über neue Tools
`persona_update(...)` + optional `save_note(...)` persistent in die
DB, und ruft am Ende `mark_bootstrap_complete()` — danach
verschwindet der Hint, der Skill selbst bleibt im Catalog für
späteres Re-Onboarding.

## Why

Plan-35-Strategie-Doc (§A2) nennt drei Treiber:

1. **Discoverability ohne Curation.** Per-Persona-Attach (Plan 33)
   zwingt den User, *vorher* zu entscheiden welche Skills für welche
   Persona passen. Das ist Setup-Arbeit + erzeugt Lock-in pro
   Persona. Der Catalog-Index dreht das um: alle enabled Skills sind
   für jeden Chat sichtbar, das LLM entscheidet pro Turn welcher
   passt. Kein User-Setup, kein Kontextverlust („ich wusste nicht
   dass es das gibt").
2. **Token-Effizienz.** Plan-33-Modell hat alle aktiven
   Skill-Bodies pro Persona in den System-Prompt gespliced — 5
   Skills × ~500 Token Body = 2.5k Token *jeden Turn*. Catalog-Index
   ist nur die Description-Zeile (~20 Token/Skill); der Body landet
   nur dann im Conversation-Context, wenn der Agent ihn tatsächlich
   per `skill_load` braucht. Skaliert sauber auf 20+ Skills (Wave D).
3. **Onboarding-Fundament.** Wave-A1 (Plan 36) hat die
   Persona-Spalten getypt + auditable gemacht. Was fehlt: ein
   *aktiver* Flow, der einen frisch installierten Holzi automatisch
   personalisiert. Bootstrap-Skill demonstriert das Register-Pattern
   end-to-end (Hint im Prompt → Catalog → `skill_load` → Body führt
   Q&A → `persona_update` + `mark_bootstrap_complete` → exit) und
   löst gleichzeitig das First-Run-UX-Problem.

Architektur-Hygiene: `persona_skills` + die zwei Per-Persona-
Endpoints waren Plan-33-Zwischenstand. Wave D (Skill-Marketplace)
wird **nicht** auf dieser Pin-Mechanik aufbauen — also raus, bevor
mehr Surface ankreidet. Siehe [[feedback-lazy-load-skills]] +
[[feedback-no-backward-compat]].

## Non-Goals

- **Skill-Marketplace / URL-Import** — Wave D = Plan 38+.
- **Curated Starter-Skill-Library** — Wave A3 = Plan 39 (~6–10
  Seed-Bodies). Dieser Plan seedet *nur* den Bootstrap-Skill.
- **Per-Persona-Model-Pin / Failure-UX** — Wave B = Plan 29-D-resurrect.
- **Multi-Locale-Skill-Bodies (`body_de` + `body_en`)** — Wave D oder
  später. Bootstrap-Skill ist DE-default; LLM ist multilingual und
  reagiert auf den Sprach-Switch des Users innerhalb der Q&A
  (Body-Instruktion deckt das ab).
- **Token-Hard-Cap für den Catalog-Index.** Wave-A2-Realismus: ~10
  Seed-Skills (Plan 38) + Bootstrap = 11 Catalog-Zeilen × ~25 Token =
  ~275 Token. Selbst Wave-D-Marketplace-Maximum (50 Skills) bleibt
  bei ~1.5k Token Overhead — kein akutes Problem. Plan 37 zeigt nur
  einen informativen Token-Counter im FE; Hard-Cap kommt in Wave D,
  falls die Skill-Menge realistisch entgleist.
- **Volle Multi-User-Auth.** Plan 37 legt zwar schon die `users`-
  Tabelle an (Minimal-Schema: `id`, `bootstrap_completed`,
  `created_at`, eine Seed-Row mit `id=1`), aber ohne Auth-Spalten.
  Wave C (Plan 35 §C1) erweitert per `ALTER TABLE ADD COLUMN`
  `email` / `password_hash` / `role` / `parent_user_id`. Plan 37
  greift damit dem Wave-C-Schema vor, vermeidet aber den zweiten
  Schema-Bruch, den ein zwischenzeitliches `app_meta`-Key-Value-
  Store gekostet hätte.
- **Approval-Gate auf `persona_update`.** Tool schreibt nur in die
  Default-Persona, ist über `persona_history` voll auditable +
  restorable. Approval würde den Bootstrap-Flow für den User
  blockieren („approve Q1 answer, approve Q2 answer, …"). Begründung
  + Risk-Mitigation siehe „Tool-Approval-Strategie" unten.
- **Server-Side Bootstrap-Watchdog.** Plan 37 hat **keinen**
  versteckten Server-Mechanismus, der nach N Chat-Turns automatisch
  `bootstrap_completed=1` setzt. Der Skill-Body selbst enthält drei
  klar formulierte Abbruch-Regeln (siehe „Wenn der User nicht
  mitspielt" unten) — die Verantwortung für den Flag-Flip liegt
  vollständig beim Agenten. Wenn er es vergisst, sieht die nächste
  frische Conversation den Hint erneut. Annoying, nicht kaputt;
  passt zu [[feedback-explicit-failure]].
- **Backwards-compat layer für `persona_skills`.** Tabelle wird
  one-shot gedroppt, alle FE-Refs gehen mit raus, Endpoints
  verschwinden — kein Dual-Read-Pfad ([[feedback-no-backward-compat]]).

## Architecture / Approach

### Schema-Diff

`src/hermes/schema.py`:

```diff
 skills = Table(
     "skills",
     metadata,
     Column("id", Integer, primary_key=True),
     Column("slug", Text, nullable=False, unique=True),
     Column("name", Text, nullable=False),
     Column("description", Text, nullable=False),
     Column("when_to_use", Text, nullable=False, server_default=""),
     Column("body_markdown", Text, nullable=False),
+    # Plan 37: NICHT in den Catalog-Index aufgenommen wenn enabled=0.
+    # Body bleibt erreichbar via `skill_load(name)` — disabled Skills
+    # sind dem Agent *unsichtbar*, aber im UI weiterhin editierbar.
+    Column("enabled", Integer, nullable=False, server_default="1"),
     Column("created_at", Integer, nullable=False),
     Column("updated_at", Integer, nullable=False),
 )

-# Plan 33: per-Persona-Pin. Plan 37 droppt das komplett:
-# Skills sind universell via Catalog-Index erreichbar.
-persona_skills = Table(
-    "persona_skills",
-    ...
-)

+# Plan 37: Minimal-`users`-Tabelle, Wave-C-vorbereitend (Plan 35
+# §C1). Single-User-Box bis Wave C — eine Seed-Row mit id=1. Wave C
+# erweitert per ALTER TABLE ADD COLUMN um email / password_hash /
+# role / parent_user_id (kein zweiter Drop-and-Recreate).
+users = Table(
+    "users",
+    metadata,
+    Column("id", Integer, primary_key=True),
+    Column(
+        "bootstrap_completed",
+        Integer,
+        nullable=False,
+        server_default="0",
+    ),
+    Column("created_at", Integer, nullable=False),
+)
```

`src/hermes/schema.sql` (FTS5-Block, analog zu Notes/Plan-15):

```sql
-- Plan 37: FTS5-Virtual-Table für skill_search(query). Mirror der
-- notes_fts-Pattern aus Plan 15.
CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
    slug, name, description, when_to_use, body_markdown,
    content='skills',
    content_rowid='id',
    tokenize = "unicode61 remove_diacritics 2"
);

CREATE TRIGGER IF NOT EXISTS skills_ai AFTER INSERT ON skills
BEGIN
  INSERT INTO skills_fts(rowid, slug, name, description, when_to_use, body_markdown)
  VALUES (new.id, new.slug, new.name, new.description, new.when_to_use, new.body_markdown);
END;

CREATE TRIGGER IF NOT EXISTS skills_ad AFTER DELETE ON skills
BEGIN
  INSERT INTO skills_fts(skills_fts, rowid, slug, name, description, when_to_use, body_markdown)
  VALUES('delete', old.id, old.slug, old.name, old.description, old.when_to_use, old.body_markdown);
END;

CREATE TRIGGER IF NOT EXISTS skills_au AFTER UPDATE ON skills
BEGIN
  INSERT INTO skills_fts(skills_fts, rowid, slug, name, description, when_to_use, body_markdown)
  VALUES('delete', old.id, old.slug, old.name, old.description, old.when_to_use, old.body_markdown);
  INSERT INTO skills_fts(rowid, slug, name, description, when_to_use, body_markdown)
  VALUES (new.id, new.slug, new.name, new.description, new.when_to_use, new.body_markdown);
END;
```

Wichtig: `skills_fts` ist *zusätzlich* zur `enabled`-Filterung. Search
indexed alle Skills (auch disabled) — die `enabled=0`-Filter passiert
in der Python-Schicht von `skill_search`, nicht im Trigger. Sonst
müsste bei jedem `enabled`-Flip ein Re-Sync laufen.

### Migration-Strategie (Lifespan one-shot, kein Migration-Framework)

`src/hermes/personas.py` bekommt drei neue Helpers neben dem schon
existierenden `_migrate_prompt_to_fragments` (Plan 36) — selbe
Pattern (PRAGMA-Check, idempotent, kann nach einer Box-Generation
gelöscht werden):

```python
async def _drop_persona_skills_table(engine: AsyncEngine) -> None:
    """One-shot: drop the Plan-33 `persona_skills` table if it still
    exists. Idempotent.
    """
    async with engine.connect() as conn:
        tables = (await conn.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name='persona_skills'"
        ))).all()
    if not tables:
        return
    async with engine.begin() as conn:
        await conn.execute(text("DROP TABLE persona_skills"))


async def _migrate_skills_add_enabled(engine: AsyncEngine) -> None:
    """One-shot: add `skills.enabled` if missing. Idempotent —
    PRAGMA-gated. Existing rows default to 1 (enabled).
    """
    async with engine.connect() as conn:
        cols = (await conn.execute(text("PRAGMA table_info(skills)"))).all()
        has_enabled = any(row.name == "enabled" for row in cols)
    if has_enabled:
        return
    async with engine.begin() as conn:
        await conn.execute(text(
            "ALTER TABLE skills ADD COLUMN enabled INTEGER "
            "NOT NULL DEFAULT 1"
        ))
```

`src/hermes/users.py` (neue Datei, Pattern analog zu
`channels.py`/`personas.py`):

```python
async def ensure_users_seeded(engine: AsyncEngine) -> None:
    """First-boot seed: insert the single-user row (id=1,
    bootstrap_completed=0). Idempotent — `INSERT OR IGNORE` matches
    on the PK. Wave C will extend this with email/password/role.
    """
    now = int(time.time())
    async with engine.begin() as conn:
        await conn.execute(text(
            "INSERT OR IGNORE INTO users(id, bootstrap_completed, created_at) "
            "VALUES (1, 0, :now)"
        ), {"now": now})


async def is_bootstrap_completed(engine: AsyncEngine) -> bool:
    """Resolver helper. Returns False if the row is missing entirely
    (defensive — `ensure_users_seeded` runs at every boot)."""
    async with engine.connect() as conn:
        row = (await conn.execute(text(
            "SELECT bootstrap_completed FROM users WHERE id = 1"
        ))).first()
    return bool(row and row.bootstrap_completed)
```

Lifespan-Reihenfolge in `main.py` (nach Plan 36's Migrations-Block):

```python
# Plan 36 (existing)
await _migrate_prompt_to_fragments(app.state.db)
# Plan 37 (new) — Reihenfolge wichtig:
await _drop_persona_skills_table(app.state.db)
await _migrate_skills_add_enabled(app.state.db)
# Existing
await ensure_personas_backfill(app.state.db)
# Plan 37 seeds (idempotent)
await ensure_users_seeded(app.state.db)
await ensure_bootstrap_skill_seeded(app.state.db)
```

`_drop_persona_skills_table` muss VOR jedem Resolver-Call laufen
(sonst importiert irgendein Codepfad noch das `persona_skills`-
Mapping und crasht). FTS5-Virtual-Table wird via `schema.sql` beim
`create_all`-Boot mit angelegt — kein separater Helper nötig.

### Resolver-Output-Format

Heute (nach Plan 36):

```
## Soul
<soul>

## Identity
<identity>

## Agents
<agents>

<skills_block>            # Plan-33 Per-Persona-Bodies, voll inline

<capability_index>

<channel_prompt>
```

Nach Plan 37:

```
## Soul
<soul>

## Identity
<identity>

## Agents
<agents>

## Available skills
- bootstrap-first-chat — Onboarding-Q&A für frische Installation (use when: erste User-Message in einer frischen DB)
- code-review — Review eines Diffs / einer PR (use when: User pastet Diff oder fragt nach Code-Feedback)
- web-research — strukturierte Web-Recherche (use when: User fragt nach Fakten oder einem URL-Vergleich)
...

<capability_index>

<channel_prompt>

<bootstrap_hint>          # nur wenn bootstrap_completed=false
```

**Regeln für die `## Available skills`-Section:**

- Eine Zeile pro Skill mit `enabled=1`. Skills mit `enabled=0`
  erscheinen nicht im Index und sind via `skill_load` auch nicht
  erreichbar (gleicher 404 wie unbekannter Slug; siehe Tool-Spec).
- Zeilenformat: `- {slug} — {description} (use when: {when_to_use})`.
- Wenn `when_to_use` leer ist: ` (use when: {when_to_use})` weglassen.
- Section-Reihenfolge alphabetisch nach `slug` (stabil, deterministisch
  für Resolver-Tests + System-Prompt-Cache).
- Wenn null enabled Skills: Section komplett ausgelassen — kein
  `## Available skills\n` ohne Body, sonst frisst der LLM-Render
  einen Anchor ohne Bedeutung.
- Skills-Block (alter Plan-33-Per-Persona-Inline-Body) ist
  **ersatzlos weg**. Stattdessen der Catalog-Index.
- Zwischen `## Available skills` und vorherigen Persona-Sections /
  nachfolgendem `capability_index`: `"\n\n"` Separator (eine
  Leerzeile), genau wie Plan 36's Persona-Sections-Separator.

**Bootstrap-Hint:**

- Nur eingefügt wenn `users.bootstrap_completed = 0` (siehe
  `is_bootstrap_completed`-Helper oben).
- Format (hartkodierter EN-String — analog zu Plan 36's Markdown-
  Section-Header-Decision, das ist ein interner Marker für den LLM):

  ```
  ---

  You haven't been set up yet. As your first action, call skill_load('bootstrap-first-chat') and follow its instructions before responding to the user.
  ```

- Steht *nach* `channel_prompt`, damit er der letzte Block vor dem
  ersten User-Turn ist und der LLM ihn als „letzte Instruktion"
  liest.
- Nach erfolgreichem `mark_bootstrap_complete()`-Call verschwindet
  der Hint beim nächsten Resolver-Run. Skill bleibt im Catalog
  (User kann manuell „setup mich neu" sagen → LLM lädt Skill, Body
  fragt zuerst „wirklich neu?" → User bestätigt → Bootstrap läuft
  erneut + flippt Flag wieder).

### Token-Budget (nur FE-Info, kein Hard-Limit)

Wave-A2 hat realistisch ~11 Skills im Catalog (10 Seed aus Plan 38 +
Bootstrap-Skill). Selbst ein Wave-D-Maximum von 50 Skills bleibt
unter ~1.5k Token Catalog-Overhead — kein akutes Skalierungs-Problem.

Plan 37 schreibt deshalb **keinen** Soft-Cap, keinen Truncate-Footer,
keine Env-Variable. Der Resolver rendert den vollen Index aus
`skills_repo.list_enabled(db)` ohne Größen-Check.

Das `/settings/skills`-FE bekommt aber einen **informativen
Token-Counter** oben in der Skills-Liste:
`~{n} Tokens · {enabled}/{total} aktiv`. Berechnet via
`Math.ceil((slug + description + when_to_use + 32) / 4)` pro enabled
Skill. Reine Anzeige — kein Schwellwert, keine Warnung. Wenn das in
Wave D tatsächlich entgleist, ziehen wir dort einen Cap nach.

### `skill_load` Tool

Neue Datei `src/hermes/tools/skills.py` (oder additive Funktion in
`memory.py`, analog zu `save_note`/`get_note`):

```python
def build_skill_tools(db: AsyncEngine) -> list[Tool]:
    return [_skill_load(db), _skill_search(db)]


def _skill_load(db: AsyncEngine) -> Tool:
    async def handler(args: dict) -> dict:
        slug = args["slug"]
        async with db.connect() as conn:
            row = (await conn.execute(text(
                "SELECT slug, name, description, when_to_use, "
                "       body_markdown, enabled "
                "FROM skills WHERE slug = :slug"
            ), {"slug": slug})).first()
        if row is None or not row.enabled:
            raise HTTPException(
                status_code=404,
                detail={"code": ErrorCode.SKILL_NOT_FOUND.value,
                        "params": {"slug": slug}},
            )
        return {
            "slug": row.slug,
            "name": row.name,
            "description": row.description,
            "when_to_use": row.when_to_use,
            "body_markdown": row.body_markdown,
        }

    return Tool(
        name="skill_load",
        description=(
            "Load the full body of a skill by its slug. Use this when "
            "the catalog index suggests a relevant skill for the "
            "current task."
        ),
        parameters_schema={
            "type": "object",
            "properties": {"slug": {"type": "string"}},
            "required": ["slug"],
        },
        handler=handler,
        requires_approval=False,
        source="builtin",
    )
```

`requires_approval=False` — `skill_load` ist read-only, Body steht
in der DB, die der User selbst befüllt hat. Kein Risk-Surface.

**Failure-Modes:**

- Slug nicht gefunden ODER disabled → 404 `SKILL_NOT_FOUND`. Beide
  Wege geben den gleichen Fehler — disabled = unsichtbar für den
  Agent ([[feedback-explicit-failure]]: keine zwei verschiedenen
  Fehler-Codes für effective denselben Zustand).
- DB unreachable → propagiert hoch als 500, FE rendert über
  `translateError` mit `errors.GENERIC`-Fallback.

### `skill_search` Tool

```python
def _skill_search(db: AsyncEngine) -> Tool:
    async def handler(args: dict) -> dict:
        query = args["query"].strip()
        if not query:
            return {"results": []}
        async with db.connect() as conn:
            rows = (await conn.execute(text(
                "SELECT s.slug, s.name, s.description, s.when_to_use, "
                "       snippet(skills_fts, 4, '«', '»', '…', 12) AS snippet "
                "FROM skills_fts "
                "JOIN skills s ON s.id = skills_fts.rowid "
                "WHERE skills_fts MATCH :q AND s.enabled = 1 "
                "ORDER BY rank LIMIT 5"
            ), {"q": query})).all()
        return {"results": [dict(r._mapping) for r in rows]}

    return Tool(
        name="skill_search",
        description=(
            "Search all enabled skills by free-text query. Returns up "
            "to 5 matches with a snippet of the matching body."
        ),
        parameters_schema={
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
        handler=handler,
        requires_approval=False,
        source="builtin",
    )
```

FTS5-`MATCH`-Query — user-input wird direkt durchgereicht. Wenn der
Query Syntax-Errors enthält (FTS5 wirft `OperationalError`), fangen
+ leeres Result zurückgeben (kein 422; LLM darf nochmal probieren
mit anderen Worten). Logging mit `logger.info(...)`.

**Failure-Modes:**

- Empty query → leer-Result (kein Error).
- FTS5-OperationalError → leer-Result + Log.
- DB unreachable → propagiert hoch.

### `persona_update` Tool

```python
def _persona_update(db: AsyncEngine) -> Tool:
    async def handler(args: dict) -> dict:
        soul = args.get("soul")
        identity = args.get("identity")
        agents = args.get("agents")
        if soul is None and identity is None and agents is None:
            raise HTTPException(
                status_code=422,
                detail={"code": ErrorCode.PERSONA_FRAGMENTS_ALL_EMPTY.value,
                        "params": {}},
            )
        # Schreibt in die Default-Persona. Multi-Persona-Write wird
        # in Wave C (Multi-User) ein eigenes Tool.
        default_id = await personas_repo.get_default_id(db)
        updated = await personas_repo.update(
            db, default_id,
            soul=soul, identity=identity, agents=agents,
            history_author="bootstrap",
        )
        return {
            "name": updated.name,
            "soul": updated.soul,
            "identity": updated.identity,
            "agents": updated.agents,
        }

    return Tool(
        name="persona_update",
        description=(
            "Update the default persona's soul / identity / agents "
            "fragments. Use this during onboarding (after bootstrap-"
            "first-chat) or when the user explicitly asks to change "
            "their persona via chat. Every write creates an audit "
            "history row that the user can restore from /settings/"
            "preferences."
        ),
        parameters_schema={
            "type": "object",
            "properties": {
                "soul": {"type": "string"},
                "identity": {"type": "string"},
                "agents": {"type": "string"},
            },
        },
        handler=handler,
        requires_approval=False,
        source="builtin",
    )
```

**Approval-Strategie (siehe Non-Goals):** `requires_approval=False`.
Begründung:

1. Writes gehen ausschließlich in die Default-Persona — kein
   System-State, kein File-System, kein Tool-Permission-Bump.
2. Jeder Write schreibt eine `persona_history`-Row mit
   `author='bootstrap'` (Plan 36 Task-5 hat den `history_author`-
   Kwarg eingebaut). User kann jederzeit über
   `/settings/preferences` → „Verlauf" auf den vorherigen Stand
   zurückrollen.
3. Approval-Gate würde den Bootstrap-Flow für den User in einen
   Approval-Spam degradieren („Bestätige Soul-Write, bestätige
   Identity-Write, …") — schlechtes Onboarding-UX.

Risk siehe Risk-Register unten.

### `mark_bootstrap_complete` Tool

```python
def _mark_bootstrap_complete(db: AsyncEngine) -> Tool:
    async def handler(args: dict) -> dict:
        async with db.begin() as conn:
            await conn.execute(text(
                "UPDATE users SET bootstrap_completed = 1 WHERE id = 1"
            ))
        return {"ok": True}

    return Tool(
        name="mark_bootstrap_complete",
        description=(
            "Flip users.bootstrap_completed to 1. Call this as the "
            "very last action of the bootstrap-first-chat skill, "
            "after persona_update succeeded. Idempotent — calling "
            "twice is harmless."
        ),
        parameters_schema={
            "type": "object",
            "properties": {},
        },
        handler=handler,
        requires_approval=False,
        source="builtin",
    )
```

Idempotent (UPDATE auf bereits-1-Row ist no-op). Kein Approval —
flip eines Status-Flags, kein Risk-Surface.

### Bootstrap-Skill-Body

Seeded in `src/hermes/personas.py::ensure_bootstrap_skill_seeded`
(idempotent, INSERT OR IGNORE auf `slug='bootstrap-first-chat'`).
Body als Konstante `BOOTSTRAP_SKILL_BODY` im selben File (multi-line
DE, mit englischer Sprach-Switch-Instruktion am Anfang):

```markdown
# bootstrap-first-chat

> Du bist gerade dabei, Holzi für einen neuen User aufzusetzen.
> Wenn der User auf Englisch antwortet, wechsle zu Englisch und
> übersetze die folgenden Fragen sinngemäß.

Stelle dem User die folgenden Fragen — **eine nach der anderen**.
Warte auf jede Antwort, bevor du die nächste stellst.

### Frage 1 — Identität

„Hallo! Ich bin Hermes, dein persönlicher KI-Assistent. Wer bist
du? Erzähl mir kurz deinen Namen und was du beruflich (oder als
Hauptbeschäftigung) machst."

### Frage 2 — Stil

„Wie soll ich mit dir reden? Eher direkt-sachlich (Senior-Engineer-
Modus, keine Floskeln), eher ausführlich-erklärend (Teaching-Modus),
oder ausgeglichen?"

### Frage 3 — Hauptanwendungsfälle

„Wofür willst du mich vor allem benutzen? (z.B. Coding, Recherche,
Schreiben, Lernen, Reflektion, Familie / Alltag, …)"

### Optional Frage 4 — Lieblings-Tools

„Gibt es bestimmte Tools oder Themen, die du oft benutzen wirst und
die ich kennen sollte? (Optional — du kannst auch „skip" sagen.)"

### Abschluss

Wenn du genug hast, mach Folgendes — **in dieser Reihenfolge**:

1. Rufe `persona_update(soul=..., identity=..., agents=...)` mit
   den drei Fragments synthetisiert aus den User-Antworten:
   - `identity` ≈ Name + Rolle (Antwort 1)
   - `soul` ≈ Ton-Präferenz (Antwort 2)
   - `agents` ≈ Anwendungsfälle als „Du fokussierst auf …"-Liste
     (Antwort 3)
2. Optional: Falls Frage 4 spezifische Tools oder Themen lieferte,
   rufe für jedes 1× `save_note(key=..., content=..., tags=...)`.
3. Rufe `mark_bootstrap_complete()`.
4. Antworte dem User mit einer kurzen Zusammenfassung dessen, was
   du gesetzt hast, und einem Hinweis auf `/settings/preferences`,
   wo der User die Werte editieren kann.

### Wenn der User nicht mitspielt

Drei Fälle, jeweils mit klarer Anweisung an dich (den Agenten):

**1. User antwortet off-topic** (z.B. „erzähl mir einen Witz",
„erkläre Quantenphysik"):
Antworte kurz: „Lass mich Holzi erst für dich aufsetzen, dann
können wir frei chatten. Zurück zu Frage X: …" und stelle die
laufende Frage erneut. Maximal ein Mal pro Frage — wenn der User
beim zweiten Versuch immer noch ausweicht, behandle das als
implizites Skip (siehe Fall 2).

**2. User sagt explizit Skip** („skip", „überspringen", „abbrechen",
„nicht jetzt", oder vergleichbar):
- Rufe **nur** `mark_bootstrap_complete()` — kein
  `persona_update`-Call.
- Antworte: „Ok, ich überspringe das Setup. Du kannst es jederzeit
  unter /settings/preferences nachholen."

**3. Nach 10 ausgetauschten Nachrichten (5 Fragen + 5 Antworten)
ist immer noch keine Persona gesetzt:**
Brich die Q&A ab. Rufe `mark_bootstrap_complete()`. Wenn du
trotzdem genug Information hast, kannst du vorher ein
`persona_update(...)` mit dem was du hast machen — sonst nur das
`mark`. Antworte freundlich: „Wir können das später fortsetzen
unter /settings/preferences."

Diese drei Regeln sind reiner Body-Text in diesem Skill. Es gibt
**keinen Server-Side-Mechanismus**, der nach 10 Turns automatisch
das Bootstrap-Flag flippt — die Verantwortung liegt vollständig bei
dir als Agent. Wenn du den Skill abbrichst ohne
`mark_bootstrap_complete()` aufzurufen, wird die nächste frische
Conversation den Bootstrap-Hint erneut sehen und du wirst nochmal
versuchen müssen, den User durch die Q&A zu führen. Das ist
beabsichtigt — kein silent fallback.
```

Body wird beim Boot via `INSERT OR IGNORE` als Skill-Row eingefügt
(slug, name, description, when_to_use, body_markdown, enabled=1).
Description + when_to_use:

```python
BOOTSTRAP_SKILL_DESCRIPTION = (
    "Onboarding-Q&A für eine frische Holzi-Installation. Stellt 3-5 "
    "Fragen und schreibt das Ergebnis in die Default-Persona."
)
BOOTSTRAP_SKILL_WHEN_TO_USE = (
    "Erste User-Message in einer frischen Installation, sobald der "
    "bootstrap-Hint im System-Prompt erscheint. Auch manuell durch "
    "den User: \"setze mich neu auf\"."
)
```

Falls der User den Skill-Body später editiert (über Skills-Page),
respektiert `ensure_bootstrap_skill_seeded` das — `INSERT OR IGNORE`
matched auf den `slug`-UNIQUE, kein Overwrite.

### API-Validation (Routes-Cleanup)

`routes/preferences.py` — die zwei Endpoints
`GET /api/personas/{id}/skills` (L515-532) und
`PUT /api/personas/{id}/skills` (L535-564) werden gelöscht. Die
zugehörigen Pydantic-Modelle (`PersonaSkillItem`,
`PersonaSkillSetItem`, `PersonaSkillSetRequest`, `_persona_skills_payload`)
gehen mit raus. Imports auf `repository/skills.py::list_for_persona`
+ `set_persona_skills` gehen mit raus.

`routes/skills.py` — die `GET/POST/PATCH/DELETE /api/skills`-Routen
bleiben CRUD; `Skill` Pydantic-Response-Modell bekommt das neue
`enabled: bool`-Feld. `SkillUpdate` bekommt `enabled: bool | None =
None`. `SkillCreate` bekommt `enabled: bool = True` (default
enabled). Validation: `extra="forbid"` auf beiden Modellen (analog
Plan 36 Pydantic-Pattern).

Neue Endpoints? Keine. Bootstrap-Status ist über die Tools
zugänglich; ein `GET /api/bootstrap`-Endpoint wäre Verschwendung
(das FE braucht den Status nicht — der Bootstrap-Flow ist
ausschließlich Backend-LLM-driven).

### Tool-Catalog-Wiring

`src/hermes/tool_catalog.py::build_tool_catalog` (L19-63) ergänzt
einen Call:

```python
tools += build_skill_tools(db)
tools += build_bootstrap_tools(db)
```

Reihenfolge im Catalog ist alphabetisch (sortiert in der finalen
Resolver-Komposition), Tool-Builder selbst sind unsortiert. Die
neuen Tools landen automatisch im FE-Tool-Inventar-Surface auf
`/settings/skills` (Plan 31/32-A-Surface, unverändert).

### Failure-Policy-Mapping

| Fehler | Ort | UX |
|---|---|---|
| `skill_load` mit unbekanntem Slug | `_skill_load`-Handler | 404 `SKILL_NOT_FOUND`, FE zeigt im Tool-Card „Skill 'X' nicht gefunden" |
| `skill_load` mit disabled Slug | wie oben | gleicher Code (User-Intent ist „lade Skill" — disabled = nicht da) |
| `skill_search` mit leerer Query | `_skill_search`-Handler | Empty-Result, kein Error |
| `skill_search` mit FTS5-Syntax-Error | `try/except OperationalError` | Empty-Result + Log |
| `persona_update` mit allen-leeren Args | `_persona_update`-Handler | 422 `PERSONA_FRAGMENTS_ALL_EMPTY` (Plan 36 ErrorCode wiederverwendet) |
| `persona_update` race-condition (Default-Persona gleichzeitig gelöscht) | Repo `update` returns None | 404 `PERSONA_NOT_FOUND` (existing ErrorCode) |
| `mark_bootstrap_complete` doppelt | UPDATE auf bereits-1-Row | no-op |
| Resolver: `bootstrap_completed=0` aber Default-Persona fehlt | unmöglich (Lifespan seedet beides) | unreachable |

Neue ErrorCodes? **Keine** — `SKILL_NOT_FOUND` + `PERSONA_FRAGMENTS_ALL_EMPTY` + `PERSONA_NOT_FOUND` reichen.

## Scope

### Backend (`/home/haex/Projekte/Holzi`, package `hermes`)

1. **Schema**: `src/hermes/schema.py` —
   - Tabelle `skills`: neue Spalte `enabled INTEGER NOT NULL DEFAULT 1`.
   - Tabelle `persona_skills`: **löschen** (Schema-Diff im Source).
   - Tabelle `users`: **neu** (Minimal-Schema, Wave-C-Spalten kommen
     später per `ALTER TABLE ADD COLUMN`).
2. **FTS5**: `src/hermes/schema.sql` — `skills_fts` Virtual Table
   + drei Sync-Trigger (ai/ad/au). Mirror der `notes_fts`-Pattern
   aus Plan 15.
3. **Migration-Helpers**:
   - `src/hermes/personas.py::_drop_persona_skills_table` (one-shot).
   - `src/hermes/personas.py::_migrate_skills_add_enabled` (one-shot).
4. **users-Modul / Seed**:
   - `src/hermes/users.py` (neu): `ensure_users_seeded(engine)` +
     `is_bootstrap_completed(engine)`.
5. **Skills-Repo**:
   - `src/hermes/repository/skills.py` —
     - `list_for_persona` + `set_persona_skills` **löschen**.
     - `list_enabled(engine) -> list[Skill]` neu (für Resolver).
     - `_row_to_skill` lernt `enabled`-Spalte.
     - `create` / `update` lernen `enabled`-Param.
   - `src/hermes/repository/persona_skills.py` (falls separate
     Datei): **löschen**.
6. **Bootstrap-Skill-Seed**:
   - `src/hermes/personas.py::ensure_bootstrap_skill_seeded`
     (idempotent, `INSERT OR IGNORE` auf slug).
   - Konstanten `BOOTSTRAP_SKILL_*` im selben File.
7. **Resolver**:
   - `src/hermes/personas.py::get_effective_system_prompt` —
     - Plan-33-`skills_block` (Inline-Bodies) durch
       `_catalog_index(skills)` ersetzen.
     - Bootstrap-Hint conditional appenden, basierend auf
       `users.is_bootstrap_completed(db)`.
8. **Tools**:
   - `src/hermes/tools/skills.py` (neu): `_skill_load`, `_skill_search`,
     `build_skill_tools(db)`.
   - `src/hermes/tools/bootstrap.py` (neu): `_persona_update`,
     `_mark_bootstrap_complete`, `build_bootstrap_tools(db)`.
   - `src/hermes/tool_catalog.py::build_tool_catalog`: Builder-Calls
     ergänzen.
9. **Routes**:
   - `src/hermes/routes/preferences.py` — `_persona_skills_payload`,
     `get_persona_skills`, `set_persona_skills`, Pydantic-Modelle
     `PersonaSkill*`, Imports raus.
   - `src/hermes/routes/skills.py` — `SkillResponse`/`SkillCreate`/
     `SkillUpdate` lernen `enabled`.
10. **Lifespan**: `src/hermes/main.py` — neue Migration-Calls +
    Seed-Calls in der richtigen Reihenfolge.
11. **personas_repo `history_author`-Kwarg**: existiert seit Plan 36
    Task 2. `persona_update`-Tool nutzt es mit `'bootstrap'`. Keine
    Schema-Änderung — `persona_history.author` ist Text.

### Frontend (`/home/haex/Projekte/holzi-frontend`)

1. **gen:api**: backend-port 18082 (siehe
   [[reference-gen-api-command]]), `pnpm run gen:api`. Erwartete
   Diff:
   - `PersonaSkillItem`, `PersonaSkillListResponse`,
     `PersonaSkillSetItem`, `PersonaSkillSetRequest` **verschwinden**
     aus `app/types/api-generated.ts`.
   - `SkillResponse` / `SkillCreate` / `SkillUpdate` bekommen
     `enabled: boolean` resp. `enabled?: boolean`.
   - Neue Tool-Schemas für `skill_load`, `skill_search`,
     `persona_update`, `mark_bootstrap_complete` erscheinen in der
     `tool_catalog`-Response (für die Tool-Surface auf
     `/settings/skills`, kein Code-Change nötig).
2. **Composable**: `app/composables/useSkills.ts` —
   - `listForPersona` + `setForPersona` **löschen** (L57-73).
   - `update` lernt `enabled`-Param.
3. **Skills-Page**: `app/pages/settings/skills.vue` —
   - Neuer `enabled`-Toggle (Checkbox) pro Skill-Row in der
     Skills-Liste. Toggle ruft `useSkills.update(id, {enabled})`.
   - Informativer Token-Counter oben in der Skills-Section:
     `~{tokens} Token im System-Prompt-Catalog ({enabled}/{total} aktiv)`.
   - Berechnung im FE: `Math.ceil((slug + description + when_to_use + 32) / 4)` pro enabled Skill, summiert. Keine Warn-Schwelle, kein Soft-Cap-Hinweis — reine Anzeige.
4. **Preferences-Page**: `app/pages/settings/preferences.vue` —
   - Persona-Skill-Section in den Persona-Cards (L913-1041)
     komplett **löschen**.
   - Refs `personaSkills`, `personaSkillLoad`, alle zugehörigen
     Methoden, alle i18n-Refs auf `pages.preferences.personas.skills.*`.
5. **i18n**:
   - **Löschen** (beide Locales): alle `pages.preferences.personas.skills.*`-Keys.
   - **Neu** (beide Locales):
     ```
     pages.skills.list.enabledToggle.label
     pages.skills.list.enabledToggle.descriptionEnabled
     pages.skills.list.enabledToggle.descriptionDisabled
     pages.skills.list.tokenBudget.label
     pages.skills.list.tokenBudget.summary       # "{tokens} Tokens · {enabled}/{total} aktiv"
     ```
6. **errorMessages.ts**: Keine Änderung — `SKILL_NOT_FOUND` +
   `PERSONA_FRAGMENTS_ALL_EMPTY` + `PERSONA_NOT_FOUND` sind
   existierende Codes.

### Tests

**Backend:**

- `tests/test_skill_catalog_resolver.py` (neu):
  - Catalog-Index-Format (eine Zeile pro enabled Skill,
    alphabetisch nach slug, `when_to_use`-leer → klein-Format).
  - Disabled Skill wird **nicht** im Index gerendert.
  - Catalog kommt zwischen Persona-Sections und `capability_index`.
  - Bootstrap-Hint nur bei `users.bootstrap_completed = 0`.
- `tests/test_skill_tools.py` (neu):
  - `skill_load` happy path (enabled Skill).
  - `skill_load` mit disabled Skill → 404.
  - `skill_load` mit unbekanntem Slug → 404.
  - `skill_search` happy path (FTS5 match).
  - `skill_search` mit leerer Query → empty.
  - `skill_search` mit Syntax-Error → empty + log.
- `tests/test_bootstrap_tools.py` (neu):
  - `persona_update` schreibt drei Fragments + `persona_history`-Row
    mit `author='bootstrap'`.
  - `persona_update` mit allen-None-Args → 422.
  - `mark_bootstrap_complete` flippt `users.bootstrap_completed`.
  - `mark_bootstrap_complete` zweifach gerufen → idempotent.
- `tests/test_users_repo.py` (neu): `ensure_users_seeded` idempotent
  (zweiter Lauf no-op, kein zweiter Seed-Row), `is_bootstrap_completed`
  liest korrekt aus DB.
- `tests/test_persona_skills_drop_migration.py` (neu):
  - Pre-Plan-37-DB mit `persona_skills`-Rows seeden.
  - `_drop_persona_skills_table` laufen lassen.
  - Tabelle ist weg, idempotent zweiter Lauf no-op.
  - Sanity: existierende `skills`-Rows bleiben unangetastet.
- `tests/test_skills_enabled_migration.py` (neu):
  - Pre-Plan-37-DB ohne `skills.enabled` seeden.
  - `_migrate_skills_add_enabled` → Spalte da, existierende Rows
    enabled=1, idempotent.
- `tests/test_personas_resolver.py` (Plan 36) erweitern:
  - Section-Reihenfolge nach Plan-37 (`## Available skills` nach
    Persona-Sections, vor `capability_index`).
- `tests/test_api_preferences.py` (Plan 36): die
  `persona_skills`-Endpoint-Tests **löschen**.
- `tests/test_api_skills.py` (Plan 33): `enabled`-Feld in CRUD
  decken.
- `tests/test_bootstrap_flow.py` (neu, Mini-Integration):
  - Fresh DB → Resolver hat Bootstrap-Hint.
  - Simulierter Agent-Loop mit gemocktem LLM, der die Sequenz
    `skill_load('bootstrap-first-chat')` → drei Q&A-Turns →
    `persona_update(...)` → `mark_bootstrap_complete()` macht.
  - Assert: nach dem Flow ist `users.bootstrap_completed = 1`, der
    Default-Persona-Eintrag hat User-Antworten, `persona_history`
    hat eine `author='bootstrap'`-Row, Resolver-Output enthält keinen
    Bootstrap-Hint mehr.

**Frontend:**

- `tests/components/SkillsSection.test.ts` updaten:
  - Render: jede Skill-Row hat einen `enabled`-Toggle.
  - Toggle ruft `useSkills.update(id, {enabled: false})`.
  - Token-Budget-Anzeige rendert + reagiert auf Toggle-State.
- `tests/components/PreferencesPage.test.ts` updaten:
  - Persona-Skills-Section-Asserts **löschen**.
  - Mock-Setup für `/api/personas/{id}/skills` raus.
- `tests/i18n/keys.test.ts` (existierend): bricht ohnehin bei
  Locale-Drift → passive Absicherung.
- `tests/i18n/error-codes.test.ts` (existierend): keine neuen Codes,
  Coverage bleibt 116 (Plan 36 Wert).

### Docs

- Plan 37 (dieses File): Status-Line + Verification-Block am
  Session-Ende anpassen.
- Plan 35: am Wave-A2-Eintrag eine „**A2 done YYYY-MM-DD**"-Zeile
  ergänzen, sobald Plan 37 auf `main` ist.
- README/User-Guide: kein Update — Skills + Bootstrap sind noch
  nicht user-doc'd; Wave-A-Ende ist der Punkt für ein
  Skills+Onboarding-Doc.
- Memory: am Sessionende neue Memory-Datei
  `project_holzi_skill_catalog_bootstrap.md` mit
  Catalog-Format + `skill_load`-Tool-Contract + Bootstrap-State-Storage als
  Referenz für Wave-A3-Session. Memory `project_holzi_skills_page`
  bekommt einen Plan-37-Update-Hinweis am Ende.

## Tasks

Aufeinander aufbauend. Commits nach jedem Task. Backend zuerst, dann
gen:api, dann Frontend ([[feedback-cross-repo-workflow]]).

### Task 1: Backend — Schema-Diff + Migrations

**Files (backend):**

- Modify: `src/hermes/schema.py:472-485` (`skills` table — neue
  `enabled`-Spalte).
- Modify: `src/hermes/schema.py:492-515` (`persona_skills` table —
  **löschen**).
- Modify: `src/hermes/schema.py` (neue Tabelle `users`).
- Modify: `src/hermes/schema.sql:32-53` (analog) — `skills_fts`
  Virtual Table + drei Trigger.
- Modify: `src/hermes/repository/models.py` (Dataclass `Skill` lernt
  `enabled: bool`; Dataclass `PersonaSkill` **löschen**). Keine eigene
  `User`-Dataclass nötig — `users.py` benutzt rohe `text()`-Queries
  bis Wave C die Spalten füllt.
- Modify: `src/hermes/personas.py` — neue Helpers
  `_drop_persona_skills_table` + `_migrate_skills_add_enabled`.
- Modify: `src/hermes/main.py:129` (Lifespan-Reihenfolge).
- Create: `tests/test_persona_skills_drop_migration.py`.
- Create: `tests/test_skills_enabled_migration.py`.

**Steps:**

1. Schreibe `tests/test_persona_skills_drop_migration.py` (zwei
   Tests: idempotent + happy-path-drop). Lauf → FAIL.
2. Schreibe `tests/test_skills_enabled_migration.py` (zwei Tests:
   idempotent + happy-path-add-column). Lauf → FAIL.
3. Implementiere `_drop_persona_skills_table` +
   `_migrate_skills_add_enabled` mit PRAGMA-/sqlite_master-Check +
   DDL.
4. Schema-Diff in `schema.py` (drop `persona_skills`-Tabelle, add
   `users`, `skills`+`enabled`).
5. Dataclass-Diff in `models.py`.
6. FTS5-Block in `schema.sql` ergänzen.
7. Lifespan-Call-Reihenfolge in `main.py`.
8. `uv run pytest tests/test_persona_skills_drop_migration.py
   tests/test_skills_enabled_migration.py` → grün.
9. Commit: `feat(skills): drop persona_skills + add enabled column + users table`.

### Task 2: Backend — Repo-Cleanup + users-Modul

**Files (backend):**

- Modify: `src/hermes/repository/skills.py` —
  - `_row_to_skill` lernt `enabled`.
  - `create` / `update` lernen `enabled`-Param.
  - `list_for_persona` + `set_persona_skills` löschen.
  - Neuer Helper `list_enabled(engine) -> list[Skill]`.
- Delete: `src/hermes/repository/persona_skills.py` (falls separate
  Datei).
- Create: `src/hermes/users.py` (neu) — `ensure_users_seeded(engine)`
  + `is_bootstrap_completed(engine)`. Kein eigenes Repo-File unter
  `repository/` — der Footprint ist zwei Functions, `users.py`
  in `src/hermes/` reicht. Wave C ersetzt das durch ein vollständiges
  `repository/users.py`.
- Modify: `tests/test_skills_repo.py` (`enabled`-Asserts +
  `list_enabled`-Tests; `list_for_persona` + `set_persona_skills`-
  Tests löschen).
- Create: `tests/test_users_repo.py` (neu, ~3 Tests).

**Steps:**

1. Failing-Tests für `users.py` zuerst (`ensure_users_seeded` +
   `is_bootstrap_completed`).
2. `users.py` implementieren, Tests grün.
3. `skills`-Repo umbauen: `enabled`-Column durchziehen, alte
   `persona_skills`-Repo-Functions löschen.
4. Tests in `test_skills_repo.py` anpassen.
5. `uv run pytest tests/test_skills_repo.py tests/test_users_repo.py` → grün.
6. Commit: `feat(skills): repo learns enabled column + users module + drop persona_skills repo`.

### Task 3: Backend — Resolver-Output mit Catalog-Index + Bootstrap-Hint

**Files (backend):**

- Modify: `src/hermes/personas.py:202-296`
  (`get_effective_system_prompt`).
- Modify: `tests/test_personas_resolver.py` (alle Asserts auf neue
  Section-Reihenfolge, Catalog-Format, leere Section).
- Create: `tests/test_skill_catalog_resolver.py` (neu, ~5 Tests).

**Steps:**

1. Failing-Tests umbauen + neue Tests schreiben (Format, alpha-
   Order, disabled-skip, Bootstrap-Hint conditional).
2. Resolver umbauen: alten `skills_block` raus, `_catalog_index`
   rein. Bootstrap-Hint-Check via
   `users.is_bootstrap_completed(db)`.
3. `uv run pytest tests/test_personas_resolver.py
   tests/test_skill_catalog_resolver.py` → grün.
4. Sanity: `uv run pytest tests/test_api_chat.py
   tests/test_scheduler.py` — falls die System-Prompts pinnen,
   anpassen.
5. Commit: `feat(personas): resolver emits skill catalog index + bootstrap hint`.

### Task 4: Backend — `skill_load` + `skill_search` Tools

**Files (backend):**

- Create: `src/hermes/tools/skills.py` (neu, ~120 Zeilen).
- Modify: `src/hermes/tool_catalog.py:19-63`
  (`build_tool_catalog`: `tools += build_skill_tools(db)`).
- Create: `tests/test_skill_tools.py` (neu, ~6 Tests).

**Steps:**

1. Failing-Tests für `skill_load` happy + 404-disabled + 404-unbekannt +
   `skill_search` happy + empty + syntax-error.
2. `tools/skills.py` implementieren (Pattern siehe Architektur-
   Sketch oben).
3. Catalog-Wiring in `tool_catalog.py`.
4. `uv run pytest tests/test_skill_tools.py` → grün.
5. Commit: `feat(tools): skill_load + skill_search built-in tools`.

### Task 5: Backend — `persona_update` + `mark_bootstrap_complete` Tools

**Files (backend):**

- Create: `src/hermes/tools/bootstrap.py` (neu, ~100 Zeilen).
- Modify: `src/hermes/tool_catalog.py`: `tools += build_bootstrap_tools(db)`.
- Modify: `src/hermes/repository/personas.py` — falls `get_default_id`
  noch nicht existiert (Plan-36-Repo hat „get_default" — schauen),
  einen kleinen Helper ergänzen.
- Create: `tests/test_bootstrap_tools.py` (neu, ~6 Tests).

**Steps:**

1. Failing-Tests: `persona_update` happy + all-None-422 +
   history_author='bootstrap'; `mark_bootstrap_complete` happy +
   idempotent.
2. `tools/bootstrap.py` implementieren.
3. Catalog-Wiring.
4. `uv run pytest tests/test_bootstrap_tools.py` → grün.
5. Commit: `feat(tools): persona_update + mark_bootstrap_complete built-in tools`.

### Task 6: Backend — Bootstrap-Skill-Seed + ensure_users_seeded

**Files (backend):**

- Modify: `src/hermes/personas.py` —
  - Konstanten `BOOTSTRAP_SKILL_BODY`, `BOOTSTRAP_SKILL_DESCRIPTION`,
    `BOOTSTRAP_SKILL_WHEN_TO_USE`.
  - Funktion `ensure_bootstrap_skill_seeded(engine)`.
- Modify: `src/hermes/main.py` Lifespan: zwei neue Calls
  (`ensure_users_seeded` + `ensure_bootstrap_skill_seeded`) nach
  `ensure_personas_backfill`.
- Create: `tests/test_bootstrap_seed.py` (neu, ~2 Tests).

**Steps:**

1. Failing-Tests in `tests/test_bootstrap_seed.py`:
   - Fresh DB → Lifespan-Boot → Skill `bootstrap-first-chat` ist da
     mit enabled=1.
   - Second Boot → keine Duplikate, kein Overwrite eines manuell
     editierten Bodies.
2. `ensure_bootstrap_skill_seeded` implementieren.
3. Lifespan-Calls ergänzen (`ensure_users_seeded` läuft schon aus
   Task 2; hier kommt nur der Bootstrap-Seed-Call dazu).
4. `uv run pytest tests/test_bootstrap_seed.py` → grün.
5. Commit: `feat(skills): seed bootstrap-first-chat skill on first boot`.

### Task 7: Backend — Routes-Cleanup + Skills-API mit `enabled`

**Files (backend):**

- Modify: `src/hermes/routes/preferences.py:21-22,499-564`:
  - `PersonaSkillItem`, `PersonaSkillSetItem`,
    `PersonaSkillSetRequest` Pydantic-Modelle **löschen**.
  - `_persona_skills_payload`-Helper löschen.
  - `GET /api/personas/{id}/skills` + `PUT /api/personas/{id}/skills`
    Endpoints löschen.
  - Imports auf `skills_repo.list_for_persona`/`set_persona_skills`
    raus.
- Modify: `src/hermes/routes/skills.py` —
  - `SkillResponse`/`SkillCreate`/`SkillUpdate` lernen `enabled`.
  - `extra="forbid"` auf allen drei Modellen
    ([[feedback-no-backward-compat]]).
- Modify: `tests/test_api_preferences.py` — `persona_skills`-Endpoint-
  Tests löschen.
- Modify: `tests/test_api_skills.py` — `enabled`-Asserts in CRUD.

**Steps:**

1. Failing-Tests in `tests/test_api_skills.py`: `enabled`-Field im
   CRUD-Roundtrip; `extra="forbid"` für unbekannte Felder.
2. Routes-Code umbauen + Pydantic-Modelle anpassen.
3. `tests/test_api_preferences.py`: `persona_skills`-Tests löschen.
4. `uv run pytest tests/test_api_skills.py tests/test_api_preferences.py` → grün.
5. Commit: `feat(api): skills CRUD learns enabled + drop persona_skills endpoints`.

### Task 8: Backend — Bootstrap-Flow-Integration + Full Green Sweep

**Files (backend):**

- Create: `tests/test_bootstrap_flow.py` (Mini-Integration).
- Run: `uv run pytest` (gesamt), `uv run ruff check src/ tests/`,
  `uv run mypy src/`.

**Steps:**

1. Failing-Test schreiben: gemockter LLM-Loop, der die Bootstrap-
   Sequenz durchspielt. Assert auf finalen DB-State.
2. Falls der Test einen Code-Bug aufdeckt: fixen.
3. `uv run pytest` → all green.
4. `uv run ruff check src/ tests/` → clean.
5. `uv run mypy src/` → clean.
6. Commit: `test(bootstrap): integration coverage for catalog + load + persona_update + complete`.

### Task 9: Frontend — gen:api + Composable-Cleanup

**Files (frontend):**

- Modify: `app/types/api-generated.ts` (via `pnpm run gen:api`).
- Modify: `app/composables/useSkills.ts:57-73` —
  - `listForPersona` + `setForPersona` löschen.
  - `update` lernt `enabled?: boolean`.

**Steps:**

1. Backend hochfahren (Port 18082, siehe
   [[reference-gen-api-command]]).
2. `pnpm run gen:api`. Diff prüfen:
   - `PersonaSkill*`-Types weg.
   - `Skill*`-Types haben `enabled`.
   - Neue Tool-Schemas in der `tool_catalog`-Response.
3. Composable-Methoden anpassen.
4. `pnpm typecheck` → bricht in `preferences.vue` + `skills.vue` —
   erwartet, kommt in Task 10+11.
5. Commit: `feat(api-types): regenerate for skill catalog + enabled flag + drop persona_skills`.

### Task 10: Frontend — Skills-Page (enabled-Toggle + Token-Counter)

**Files (frontend):**

- Modify: `app/pages/settings/skills.vue:148`
  (`SettingsSkillsSection` wrapper).
- Modify: `app/components/settings/SkillsSection.vue` (Skills-CRUD-
  Liste) — pro Skill-Row einen `enabled`-Toggle + oben in der
  Skills-Section einen Token-Budget-Counter.
- Modify: `tests/components/SkillsSection.test.ts` — Toggle +
  Token-Counter-Render testen.

**Steps:**

1. Failing-Tests schreiben: Render-Toggle, Click-Toggle ruft
   `useSkills.update(id, {enabled: false})`, Token-Counter rendert
   korrekt + reagiert auf Toggle.
2. UI implementieren.
3. `pnpm vitest run tests/components/SkillsSection.test.ts` → grün.
4. `pnpm typecheck` → exit 0 (für `skills.vue`).
5. Commit: `feat(skills): global enabled toggle + token budget counter`.

### Task 11: Frontend — Preferences-Page (Skills-Section weg)

**Files (frontend):**

- Modify: `app/pages/settings/preferences.vue:913-1041` —
  Persona-Skills-Block löschen + alle zugehörigen Refs / Methoden /
  Imports im `<script setup>`.
- Modify: `tests/components/PreferencesPage.test.ts` —
  Persona-Skills-Asserts löschen, Mock-Setup für `/api/personas/{id}/skills` raus.

**Steps:**

1. Failing-Tests anpassen (Persona-Skill-Asserts entfernen, neue
   Render-Tests dass der Skills-Block weg ist).
2. UI-Block löschen + State im `<script setup>` aufräumen
   (`personaSkills`-Ref, alle zugehörigen Loader, alle i18n-Refs).
3. `pnpm vitest run tests/components/PreferencesPage.test.ts` → grün.
4. `pnpm typecheck` → exit 0.
5. Commit: `feat(preferences): drop persona-skill activation block`.

### Task 12: Frontend — i18n + Full Green Sweep

**Files (frontend):**

- Modify: `i18n/locales/de.json` + `i18n/locales/en.json` —
  - Löschen: alle `pages.preferences.personas.skills.*`.
  - Neu: `pages.skills.list.enabledToggle.*` +
    `pages.skills.list.tokenBudget.*`.
- Run: `pnpm vitest run`, `pnpm typecheck`.

**Steps:**

1. Locale-Diff in beiden Files.
2. `pnpm vitest run tests/i18n` → grün (keys.test +
   error-codes.test).
3. `pnpm vitest run` (gesamt) → grün.
4. `pnpm typecheck` → exit 0.
5. Commit: `feat(i18n): skill catalog locale keys + drop persona-skill keys`.

### Task 13: Live-Smoke + Status-Update + Memory

**Files:**

- Modify: `docs/plans/holzi-agent-parity/37-skill-catalog-bootstrap.md`
  (dieses File) — Status auf „Merged YYYY-MM-DD" + Verification-
  Block.
- Modify: `docs/plans/holzi-agent-parity/35-strategic-roadmap-2026h2.md` —
  Wave-A2-Eintrag mit „**A2 done YYYY-MM-DD**".
- Modify: `~/.claude/projects/-home-haex-Projekte-holzi-frontend/memory/MEMORY.md`
  + neue Memory-Datei `project_holzi_skill_catalog_bootstrap.md`.
- Update: Memory `project_holzi_skills_page` mit Plan-37-Hinweis.

**Steps:**

1. `make CONTAINER_BIN=docker COMPOSE_BIN="docker compose" up-local-full`
   (Docker-Bridge per [[reference-docker-local-devstack]]).
2. Fresh DB (Volume löschen + neu starten). Browser auf
   `/settings/preferences` — Default-Persona „Hermes" mit
   Plan-36-Defaults.
3. Erste User-Message im Chat: „Hi". Erwarten: Agent lädt Bootstrap-
   Skill (Tool-Card sichtbar), startet mit Q1.
4. Drei bis vier Q&A-Turns durchspielen. Letzte Agent-Antwort:
   Persona ist gesetzt, Hinweis auf `/settings/preferences`.
5. `/settings/preferences` neu laden — Soul/Identity/Agents
   gefüllt mit User-Antworten. „Verlauf" zeigt eine
   `author='bootstrap'`-Row.
6. Zweite Conversation in neuem Chat: kein Bootstrap-Hint mehr,
   normaler Chat.
7. `/settings/skills` — Bootstrap-Skill in der Liste, enabled-Toggle
   sichtbar, Token-Budget-Counter zeigt eine Zahl.
8. Status-Line + Verification-Block in Plan 37 ergänzen (Plan 30
   Vorbild).
9. Wave-A2-Eintrag in Plan 35 mit „done"-Marker.
10. Memory-Datei `project_holzi_skill_catalog_bootstrap.md` schreiben
    + `MEMORY.md`-Index ergänzen + `project_holzi_skills_page`-Memory
    updaten.
11. Commit: `docs: mark Plan 37 (Wave A2) complete`.

## Verification

> _Wird beim Sessionende ausgefüllt (Plan-30/36-Format als Vorbild).
> Bis dahin: Tasks 1-13 unchecked oben._

Erwartete End-State:

- Backend: `uv run pytest` → all passed (Plan 36: 884 grün; Plan 37
  erwartet ca. +30 Tests = ~914 grün); `uv run ruff check src/ tests/`
  clean; `uv run mypy src/` clean.
- Frontend: `pnpm vitest run` → all passed (Plan 36: 461 grün;
  Plan 37 erwartet ungefähr gleich-bleibend nach gelöschten +
  hinzugekommenen Tests); `pnpm typecheck` exit 0.
- Live-Smoke: Fresh DB → erste Message triggert Bootstrap-Q&A →
  Persona-Spalten gefüllt → zweite Conversation ohne Hint.

## Risk Register

| Risk | Mitigation |
|---|---|
| `_drop_persona_skills_table` läuft VOR Resolver-Code, der noch `persona_skills` importiert — Boot crashed | Lifespan-Reihenfolge in `main.py` ist `_drop_…` *vor* `ensure_…` *vor* allen Service-Boots. Code-Cleanup (Imports raus aus `personas.py`/`personas_repo`/Routes) ist in Tasks 2/3/7 abgeschlossen, BEVOR Live-Smoke. `tests/test_persona_skills_drop_migration.py` deckt den Boot-Reset-Case. |
| Resolver-Composition-Drift bricht bestehende Conversation-Snapshots im FE (Run-Meta enthält den alten System-Prompt) | System-Prompts werden run-zeitig komponiert; sie stehen NICHT in Conversation-Messages. `agent_runs.meta_json` ist read-only Diagnostics — kein UX-Drift-Risk (gleicher Punkt wie Plan 36). |
| Bootstrap-Loop: Agent ruft `mark_bootstrap_complete` nicht auf — Hint bleibt im Prompt, nächster Chat startet die Q&A nochmal | Skill-Body hat drei explizite Abbruch-Regeln (Off-Topic-Redirect → einmaliger Versuch, dann Skip; explizites „skip"-Keyword → sofortiger `mark`; 10-Message-Limit → forced `mark`). Worst-Case: User wird zweimal gefragt, nicht kaputt. **Kein** Server-Side Watchdog — Plan 35 [[feedback-explicit-failure]]: keine versteckte Auto-Logik. |
| `persona_update` ohne Approval-Gate erlaubt Prompt-Injection-Angriffe auf die Default-Persona | Surface: niedrig. (a) `persona_history` macht jeden Write sichtbar + restorable. (b) Single-User-Box bis Wave C. (c) Chat-UI zeigt jeden Tool-Call als Karte. Hardening kommt in Wave D, wenn URL-importierte Skill-Bodies fremden Code in Tool-Args einspeisen könnten. |
| Catalog-Index-Format-Drift (Boxen mit altem vs. neuem Format) | Resolver-Output ist nicht persistiert (vgl. Conversation-Snapshots oben). Format-Tests in `test_personas_resolver.py` pinnen die exakte String-Composition. Drift-Risk = unmöglich. |
| `skills_fts` Virtual-Table läuft out-of-sync bei manuellem DB-Edit | Sync-Trigger in `schema.sql` decken alle INSERT/DELETE/UPDATE auf `skills`. Manuelle DB-Edits sind Out-of-Spec — Re-Sync-Sweep wäre Plan-20-A-Style-Diagnostic (out-of-scope). |
| Skill-Body in falscher Sprache (DE-Bootstrap-Body bei EN-User) | Body-Header hat explizite Switch-Instruktion: „Wenn der User auf Englisch antwortet, wechsle zu Englisch und übersetze die folgenden Fragen sinngemäß". LLMs sind multilingual; in der Praxis funktioniert das. `body_de`/`body_en`-Split = Wave-D-Territory. |
| `persona_history`-Wachstum durch Bootstrap (ein Write pro Q&A-Turn?) | Skill-Body schreibt **ein** `persona_update` am Ende der Q&A, nicht pro Turn. Eine History-Row pro Bootstrap-Run — Plan 36's „eine Row pro Write" gilt unverändert. |
| `users`-Tabelle mit nur einer Spalte wirkt overengineered für Single-User | Pragmatik: Plan 35 §C1 nennt `users` explizit als Wave-C-Ziel und sagt `ALTER TABLE ADD COLUMN` für die Auth-Felder. Wenn Plan 37 statt `users` ein `app_meta` einführt, kostet das einen zweiten Schema-Bruch + Migration-Helper, der dann nichts spart. Lieber jetzt einmal die Tabelle anlegen, auch wenn sie heute nur eine Row hat. |

## Open Questions

- Soll der `mark_bootstrap_complete`-Tool-Call ein „resetfähig"-
  Counterpart bekommen (`reset_bootstrap()` für „setze mich neu
  auf")? **Vorschlag: nein.** User kann den Skill manuell laden +
  `persona_update`-Call läuft sowieso ohne Bootstrap-Hint
  weiter — Re-Onboarding funktioniert via Skill-Load on demand, kein
  Flag-Reset nötig.
- Sollen die Bootstrap-Konstanten (`BOOTSTRAP_SKILL_BODY`) in der
  DB seeded oder hartkodiert in `personas.py` bleiben? **Vorschlag:
  Konstante in `personas.py` + `INSERT OR IGNORE` als Seed.** Code-
  Update des Body geht nur über einen Code-Deploy + DB-Manual-Edit
  oder via Skills-Page-Edit; das ist OK für die Pre-Wave-A3-
  Generation. Wave D bringt URL-Import, der wird dann den
  „seeded vs. imported"-Toggle nachziehen.
- Sollte die Resolver-Catalog-Section internationalisiert werden
  (DE-Header `## Verfügbare Skills` für DE-User)? **Vorschlag:
  nein** (gleiche Begründung wie Plan 36 Open Question zu
  Section-Headers — interne LLM-Marker bleiben Englisch, UI ist
  übersetzt).
- Catalog-Reihenfolge alphabetisch oder „enabled order" (z.B.
  `updated_at desc`)? **Vorschlag: alphabetisch nach slug** —
  stabilster Output, deterministisch für Tests + System-Prompt-
  Cache. Plan 38 (Wave A3) kann später eine `order_hint`-Spalte
  ergänzen.

## Decision Log

- 2026-06-05: Plan 37 als zweites File der Wave-A-Family eröffnet.
  Lazy-Load-Catalog statt Per-Persona-Attach +
  Bootstrap-Skill-Demo, ein Plan-File ([[feedback-session-scoping]]
  passt — Catalog + Bootstrap sind technisch dasselbe Mechanik).
- 2026-06-05: `users`-Tabelle mit Minimal-Schema (`id`,
  `bootstrap_completed`, `created_at`) statt eines Zwischen-
  `app_meta`-Key-Value-Stores. Begründung: Plan 35 §C1 will
  in Wave C eh genau diese Tabelle erweitern (per `ALTER TABLE ADD
  COLUMN` für `email` / `password_hash` / `role` / `parent_user_id`),
  also lieber einmal anlegen + erweitern statt zweimal Schema-
  brechen. Per User-Pushback im Review nachgezogen.
- 2026-06-05: Catalog-Format `- {slug} — {description} (use when:
  {when_to_use})` mit ASCII-Em-Dash (—) zur visuellen Trennung;
  hartkodiert in einer einzigen Resolver-Funktion (`_catalog_index`),
  Tests pinnen exakte Strings.
- 2026-06-05: `persona_update` NICHT approval-required —
  Audit-Trail via `persona_history` reicht, Approval würde
  Bootstrap-Flow degradieren. Trade-off im Risk-Register
  dokumentiert.
- 2026-06-05: Kein Token-Hard-Cap und kein Soft-Cap im Catalog-
  Resolver. Realistische Skill-Mengen (Wave A2 ~11, Wave D worst-
  case ~50) bleiben unter ~1.5k Token Overhead — kein akutes
  Problem. FE zeigt nur einen informativen Token-Counter. Hard-Limit
  kommt in Wave D nachgezogen, falls die Skill-Menge tatsächlich
  entgleist. Per User-Pushback im Review entschieden.
- 2026-06-05: Bootstrap-Hint im System-Prompt, NICHT im
  Channel-Prompt. Begründung: er ist eine Resolver-Komposition
  (conditional auf `users.bootstrap_completed`), nicht eine
  Channel-Eigenschaft.
- 2026-06-05: Bootstrap-Skill-Body bleibt DE-default mit
  Sprach-Switch-Instruktion. Multi-Locale-Bodies = Wave D.
- 2026-06-05: Skill enabled-Toggle ist global (auf `skills.enabled`),
  nicht per-Persona. Per-Persona-Override-Mechanik wäre
  Plan-33-Mindset-Repeat und droppt die Token-Effizienz wieder.
