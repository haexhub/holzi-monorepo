# Plan 33: Skills als DB-Artefakte

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Merged 2026-06-03/04** (frontend PR [#87](https://github.com/haexhub/holzi-frontend/pull/87), backend PR [haexhub/Holzi#68](https://github.com/haexhub/Holzi/pull/68)).

Verification (2026-06-03):

- Backend (`/home/haex/Projekte/Holzi`, branch `plan-33-skills-db`): new
  `skills` + `persona_skills` tables, `skills_repo` (incl. atomic
  `set_persona_skills`), `routes/skills.py`, persona-skills endpoints in
  `routes/preferences.py`, resolver extension in `hermes/personas.py`
  (composition: `persona + skills + capability_index + channel`). Full
  `pytest` suite green: 910 passed (16 repo + 7 resolver + 22 API tests
  added).
- Frontend (this repo, branch `plan-33-skills-db`): `pnpm run gen:api`
  picked up the new endpoints; `useSkills` composable, `SkillsSection`
  (two-pane editor with security notice + soft-warning length counter)
  at the top of `/settings/skills`, persona-card "Aktive Skills"
  sub-block on `/settings/preferences` with toggle + up/down reorder +
  remove + add-dropdown. `pnpm test` green: 35 files, 315 tests (14
  new).
- Live: created skill `strict-german`, activated on the default
  persona, called `get_effective_system_prompt('web', engine)` — body
  appears between persona and capability index for every channel.
  Disabling the skill omits its body; deleting the skill clears the
  persona-skills link via FK CASCADE.

Cross-repo. Backend bekommt eine `skills`-Tabelle (Markdown-Body + Frontmatter) + Per-Persona-Aktivierung; Frontend bekommt einen Markdown-Editor auf `/settings/skills` und Persona-Card-Integration auf `/settings/preferences`.

Depends on:

- [29-A](./29a-personas-and-channels.md) — Personas + `get_effective_system_prompt`-Resolver existieren; dieser Plan erweitert die Composition um Skills.
- [31](./31-tool-inventory-and-mcp-surface.md) — `/settings/skills` als echte Page existiert; bekommt eine zweite obere Section für Skills (Tools rutschen runter).

Verwandt:

- [Plan 32](./32-mcp-server-crud.md) — MCP-Server bringen Tools; Skills bringen Prompts. Beide leben unter `/settings/skills`, sind aber konzeptuell getrennt.

## Goal

Wiederverwendbare Prompt-Bausteine („Skills" im Anthropic-Sinne: Markdown-Body mit YAML-Frontmatter) als DB-Rows speichern, pro Persona aktivieren/deaktivieren, beim Build des effektiven System-Prompts mit hineinmischen.

Beispiele:

- **Skill „strict-german"** (`when_to_use: immer`, Body: „Antworte ausschließlich auf Deutsch, du-Form, höflich.")
- **Skill „code-style-typescript"** (`when_to_use: bei Code-Reviews`, Body: „Bei TypeScript-Reviews achte auf … [50 Zeilen Style-Guide]").
- **Skill „brief-mode"** (`when_to_use: kurzer Channel`, Body: „Maximal 3 Sätze, keine Listen.").

Persona „Strenger Reviewer" aktiviert `code-style-typescript`; Persona „Sokrates-Tutor" aktiviert `brief-mode`; Persona „Hermes" (Default) aktiviert `strict-german`.

Composition (in `get_effective_system_prompt`):

```text
persona.prompt
+ "\n\n"
+ join(active_skills_for_persona, sep="\n\n")
+ "\n\n"
+ channel.prompt
```

## Why

- Plan 29-A hat den System-Prompt-Refactor halbiert: Persona + Channel sind getrennt. Skills sind die **dritte Achse** — modulare, wiederverwendbare Prompt-Module, die über Personas hinweg geteilt werden.
- Ohne Skills landen wiederkehrende Anweisungen („immer auf Deutsch", „kein Code ohne Tests") in jeder Persona dupliziert.
- Anthropic-Skill-Modell (Markdown + Frontmatter mit `description` / `when_to_use` / `name`) ist etabliert und passt zu Holzis Storage-Modell.
- Macht `/settings/skills` zur **tatsächlichen Skills-Page** — heute trägt sie den Namen, hat aber nur die Tool-Achse.

## Non-Goals

- **Skill-Marketplace / Browse + Install** (Skills aus einem Hub ziehen). Manuelles Schreiben reicht.
- **Filesystem-Auto-Discovery** von Skill-Dateien (z.B. aus `~/.claude/skills/`). Holzi hat die DB als Source-of-Truth; Filesystem-Import ist eventueller Followup.
- **Skill-Versionierung / History.** Edit überschreibt; Git ist außer Reichweite (Skills sind DB-Rows).
- **Trigger-Mechanik** („Skill X wird nur dann gemischt, wenn der User-Text das Wort Y enthält"). Skills sind statische Includes per Persona — kein dynamisches Routing.
- **Skills via MCP** (External MCP-Server liefert Skills statt Tools). Konzeptuell denkbar, aber Plan 32 fokussiert Tools.
- **Per-Conversation Skill-Overrides.** Persona-Auswahl pro Conversation (Plan 29-C) reicht; wer Skills tauschen will, tauscht die Persona.
- **i18n** der UI-Strings — Plan 30.

## Scope

### Backend (`/home/haex/Projekte/Holzi`)

**DB-Schema — neue Migration in `src/hermes/db.py` + `schema.sql`:**

```sql
CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,      -- ^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$  (1..64 chars, kebab-case)
    name TEXT NOT NULL,             -- display name
    description TEXT NOT NULL,      -- frontmatter.description (short)
    when_to_use TEXT,               -- frontmatter.when_to_use (optional)
    body_markdown TEXT NOT NULL,    -- the prompt content (no frontmatter)
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS persona_skills (
    persona_id INTEGER NOT NULL,
    skill_id INTEGER NOT NULL,
    ordering INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (persona_id, skill_id),
    FOREIGN KEY (persona_id) REFERENCES personas(id) ON DELETE CASCADE,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_persona_skills_persona
    ON persona_skills(persona_id, ordering);
```

`ordering` erlaubt dem User, Skills für eine Persona explizit zu reihen (System-Prompt-Reihenfolge ist relevant für LLMs).

**Frontmatter-Format (Application-Layer):**

Edit-UI zeigt zwei Felder (`description`, `when_to_use`) explizit und einen großen Markdown-Body. Backend serialisiert/deserialisiert nicht aus echtem YAML — die Felder sind separate Columns. „Frontmatter" ist hier nur eine konzeptuelle Anleihe; die Persistenz ist strukturiert.

Export-Endpoint (Open Question: ja/nein) würde echtes YAML-Frontmatter generieren für Skill-Files:

```markdown
---
name: code-style-typescript
description: TypeScript code review guidelines
when_to_use: Bei TypeScript-Code-Reviews
---

Bei TypeScript-Reviews achte auf …
```

**Repository `src/hermes/repository/skills.py`:**

- `list_all(db) -> list[Skill]`
- `get(db, id) -> Skill | None`
- `get_by_slug(db, slug) -> Skill | None`
- `create(db, *, slug, name, description, when_to_use?, body_markdown) -> Skill` (UNIQUE slug → IntegrityError → 409)
- `update(db, id, **fields) -> Skill | None`
- `delete(db, id) -> bool`
- `list_for_persona(db, persona_id) -> list[tuple[Skill, int, bool]]` (Skill + ordering + enabled, sortiert by ordering)
- `set_persona_skills(db, persona_id, items: list[dict]) -> None` — atomar: löscht alle persona_skills für die Persona, schreibt die neue Liste. Items: `{skill_id, ordering, enabled}`.

**Resolver-Erweiterung in `src/hermes/personas.py`:**

```python
async def get_effective_system_prompt(channel: str, db, *,
                                      persona_id: int | None = None) -> str:
    # persona_id-Param existiert ab Plan 29-B/29-C; falls None → Default-
    # Persona für den Channel.
    persona = ... (existing logic from 29-A)
    channel_row = ... (existing logic from 29-A)

    skills = await skills_repo.list_for_persona(db, persona.id)
    active_skill_bodies = [s.body_markdown for s, _ord, enabled in skills if enabled]
    skills_block = "\n\n".join(active_skill_bodies)

    parts = [persona.prompt]
    if skills_block:
        parts.append(skills_block)
    parts.append(channel_row.prompt)
    return "\n\n".join(parts)
```

Single Source of Truth für die Composition; die 4 Call-Sites aus Plan 29-A müssen nichts ändern.

**Endpoints — neue Datei `src/hermes/routes/skills.py`:**

Skills:

- `GET /api/skills` → `{ "skills": [{id, slug, name, description, when_to_use, body_markdown, created_at, updated_at}] }`
- `POST /api/skills` → 201 mit neuer Row. Validation: slug-Format, `name`/`description`/`body_markdown` non-empty, `body_markdown` max ~16 KiB. Duplicate slug → 409.
- `PUT /api/skills/{id}` → 200 / 404.
- `DELETE /api/skills/{id}` → 204; `persona_skills` werden via CASCADE aufgeräumt.

Persona-Skill-Verknüpfung (über `routes/preferences.py` aus Plan 29-A erweitern):

- `GET /api/personas/{id}/skills` → `{ "skills": [{skill: {…}, ordering: int, enabled: bool}] }` (sortiert).
- `PUT /api/personas/{id}/skills` → Body `{ "items": [{skill_id, ordering, enabled}, …] }` — atomares Set.

Alle Endpoints auth-gated.

### Frontend (`/home/haex/Projekte/holzi-frontend`)

- `pnpm run gen:api` — neue Types `Skill`, `SkillCreate`, `SkillUpdate`, `PersonaSkillItem`.
- Neues Composable `app/composables/useSkills.ts`: `list()`, `create(body)`, `update(id, body)`, `delete(id)`, `listForPersona(personaId)`, `setForPersona(personaId, items)`.
- `app/pages/settings/skills.vue` umstrukturiert:

  **Neue Section 1: „Skills"** (ganz oben, vor MCP-Server-Section aus Plan 32 und Tool-Katalog aus Plan 31)
  - Header + Subtext („Wiederverwendbare Prompt-Bausteine. Personas aktivieren einzelne Skills auf der Preferences-Seite.").
  - Two-Pane-Layout wie `/settings/memory` (Plan 15):
    - Links: Skill-Liste (slug + name + description-Preview), Suchfeld, „Neuer Skill"-Button.
    - Rechts: Detail-View mit:
      - Read-Modus: Skill rendered (Markdown via `RenderedMarkdown`), Edit/Delete-Buttons.
      - Edit-Modus: `name` / `description` / `when_to_use` / `body_markdown`-Textarea + Slug (read-only nach create) + Save/Cancel.
  - „Neuer Skill"-Inline-Form (Modal oder im rechten Pane): wie Edit, plus Slug-Eingabe (mit Live-Validation).
  - Cross-Link: „Skill in N Personas aktiv" → klickbar zum Filtern in `/settings/preferences`.
  - **Sicherheitshinweis** unter dem Editor (subtil, einzeilig): „Skill-Inhalte fließen in jeden System-Prompt der aktivierenden Personas und sind damit in `/settings/logs` und `/settings/insights` sichtbar — keine API-Keys oder Geheimnisse hier einfügen." Skills sind reines Markdown ohne Secret-Redaction-Layer; der Hinweis ist die einzige Schutzmaßnahme gegen versehentliches Pasten.

  **Bestehende Sections aus Plan 31 + 32:** MCP-Server bleibt zwischen Skills und Tool-Katalog; Tool-Katalog ganz unten.

- `app/pages/settings/preferences.vue` (aus Plan 29-A) erweitert: jede Persona-Card bekommt einen neuen Sub-Block **„Aktive Skills"**:
  - Liste der aktivierten Skills (drag-and-drop zum Reordern via Plan 22's DnD-Surface — Plan-22-Followup falls 22 noch nicht da ist; alternativ Up/Down-Buttons als Interim).
  - „Skill hinzufügen"-Dropdown (verfügbare Skills, die noch nicht aktiv sind).
  - Toggle pro Skill (enabled/disabled, ohne ihn zu entfernen).

### Tests

Backend:

- `tests/test_skills_repo.py` — CRUD, UNIQUE slug, list_for_persona Ordering, set_persona_skills Atomarität.
- `tests/test_api_skills.py` — Endpoints inkl. 401, 409, 422, 404.
- `tests/test_personas_resolver_with_skills.py` — Resolver mit 0 / 1 / N Skills, mit disabled-Filter, Ordering-Reihenfolge.

Frontend:

- `tests/components/SkillsSection.test.ts` — neue Datei: Two-Pane, Create/Edit/Delete, Validation.
- `tests/components/PreferencesPage.test.ts` (aus Plan 29-A) erweitern: Persona-Card zeigt Skill-Liste, Add/Remove/Reorder, Toggle.

## Suggested Implementation

### 1. Backend: Schema + Repo

- TDD `test_skills_repo.py` zuerst.
- `set_persona_skills` als Transaction (DELETE + INSERTs).

### 2. Backend: Resolver-Erweiterung

- `test_personas_resolver_with_skills.py` zuerst.
- Bestehender Resolver-Test bleibt grün (leere Skills → Composition unverändert).

### 3. Backend: Endpoints

- `routes/skills.py` + `routes/preferences.py`-Erweiterung.

### 4. Frontend: gen:api + Composable

### 5. Frontend: SkillsSection auf /settings/skills

- Pattern aus `/settings/memory` (Two-Pane).
- `RenderedMarkdown` für Read-Modus (existiert seit Plan 07).

### 6. Frontend: PreferencesPage-Erweiterung

- Sub-Block pro Persona-Card.
- Reorder: Up/Down-Buttons als MVP (DnD wenn Plan 22 da ist).

### 7. Frontend Tests

### 8. Verifikation

- Live: Skill „strict-german" anlegen, Default-Persona aktivieren.
- Web-Chat senden; in `/settings/logs` prüfen dass der System-Prompt der Run die Composition `persona + strict-german + channel` enthält.
- Skill deaktivieren (Toggle), erneut senden: System-Prompt fällt auf `persona + channel` zurück.
- Skill löschen: `persona_skills` ist via CASCADE leer; Composition wie ohne.

## Open Questions

- **YAML-Frontmatter-Import/Export-Endpoint** für Skill-Dateien? → Vorschlag: **nicht in 33.** Wenn der User es vermisst, eigener Followup.
- **Composition-Reihenfolge:** `persona + skills + channel` ist der naive Default. Manche LLMs reagieren besser auf `skills + persona + channel`. → Vorschlag: **erstmal Persona zuerst** (Persona ist Identität, Skills sind Anweisungen, Channel ist Form); falls schlechte Ergebnisse, konfigurierbar machen.
- **Maximum-Length** für `body_markdown`: 16 KiB technisch arbiträr. LLM-Context-Budgets sind die echte Grenze, aber 16 KiB pro Skill × N Skills × Persona-Composition kann eskalieren. → Soft-Warning ab 8 KiB im UI; Hard-Cap 16 KiB.
- **Skills von MCP-Servern bereitgestellt:** das Anthropic-Modell sieht das vor (MCP-Server kann Skills exposen). → **Non-Goal in 33;** wenn Plan 32 sich stabilisiert hat, eigener Plan.
- **Per-Channel Skill-Override** (Skill „brief-mode" nur für Signal-Channel auch wenn Persona auf alle Channels läuft)? → **Non-Goal.** Persona-Skills sind global pro Persona; wenn unterschiedliches Verhalten pro Channel gewünscht ist, ist das Channel-Prompts-Sache (Plan 29-A).
- **Skill-Tags / -Kategorien:** sinnvoll bei 50+ Skills, overkill bei 5. → **Nicht jetzt;** wenn der Skill-Set wächst, eigener Followup.
- **Drag-&-Drop-Reorder ohne Plan 22:** Up/Down-Buttons sind hässlich aber zugänglich. → MVP-Buttons; DnD-Upgrade wenn Plan 22 da ist.
