# Plan 38: Wave A3 — Curated Starter Skill Library

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Merged 2026-06-05.**

Third and final file of Wave A
([Plan 35 §A3](./35-strategic-roadmap-2026h2.md#a3--curated-starter-skill-library)).
Backend-only — the Skills-Page already renders skills dynamically
from the API; no frontend changes are needed.

Depends on:
- [37](./37-skill-catalog-bootstrap.md) — `skills`-table with `enabled`
  column, `ensure_bootstrap_skill_seeded` pattern, FTS5 `skills_fts`
  virtual table, Catalog-Index renderer. Plan 38 follows the same
  INSERT OR IGNORE seed pattern.

Followups:
- Wave B1 = Plan 29-D-Resurrect (per-persona model pin) — independent.
- Wave D1 = Skill-Frontmatter-Standard — D1 will rewrite A3's bodies
  to include typed YAML frontmatter columns parsed at write-time.
  Plan 38 bodies are plain Markdown without frontmatter (YAGNI).

## Goal

Ship 8 built-in skills as catalog entries so a fresh Holzi install is
immediately useful for common tasks — no user setup required. The agent
discovers and loads the right skill on demand via the Wave-A2 catalog.
Skills are globally enabled; the user can disable any of them from
`/settings/skills`.

**Wave A success criteria from Plan 35:**

> Skills page shows ~10 catalog entries; chat agent demonstrably loads
> `code-review` only when reviewing code, not on every turn.
> System-prompt token count for a fresh conversation stays under 1k
> tokens even with 20 skills installed.

## The 8 Skills

| slug | name | when_to_use |
|---|---|---|
| `brainstorming` | Brainstorming | User wants to generate, expand, or structure ideas |
| `code-review` | Code-Review | User pastes a diff, snippet, or asks for code feedback |
| `daily-journal` | Tagesjournal | User wants to reflect, journal, or talk through their day |
| `learn-explain` | Erklären & Lernen | User wants to understand a topic or concept |
| `recipe-helper` | Rezept-Helfer | User asks about cooking, recipes, or meal planning |
| `socratic-dialogue` | Sokratischer Dialog | User wants to think through a question or position deeply |
| `summarize-source` | Quelle zusammenfassen | User provides a URL, file, or pasted text to condense |
| `web-research` | Web-Recherche | User asks for facts, comparisons, or current information |

Alphabetical by slug = order in the Catalog-Index and in the
`skills_fts` FTS5 results.

## Architecture / Approach

### New module: `src/hermes/starter_skills.py`

Follows the exact pattern of `ensure_bootstrap_skill_seeded` in
`personas.py`. Contains:

- `STARTER_SKILLS: Final[list[dict]]` — list of 8 skill dictionaries
  (`slug`, `name`, `description`, `when_to_use`, `body_markdown`).
- `ensure_starter_skills_seeded(engine: AsyncEngine) -> None` —
  iterates `STARTER_SKILLS`, runs one `INSERT OR IGNORE` per skill on
  `slug` uniqueness. One transaction per skill (simpler, each slug is
  independent). Idempotent: user-edited bodies are never overwritten.

### Lifespan wiring in `src/hermes/main.py`

After `ensure_bootstrap_skill_seeded`:

```python
# Plan 38: seed the curated starter skills. Must run after
# ensure_bootstrap_skill_seeded (no hard dependency, but consistent
# boot order). Idempotent — INSERT OR IGNORE per slug.
await ensure_starter_skills_seeded(app.state.db)
```

### Skill body format

Each body:
- Language-switch instruction at the top (same as Bootstrap-Skill).
- DE-default prose with numbered steps and tips.
- ~30–60 lines. Bodies are loaded on demand via `skill_load(slug)` —
  they sit in conversation context for one turn only; no token waste
  when the skill is not in use.

### Token budget impact

8 new skills × ~35 tokens per catalog line = ~280 tokens added to
every system prompt. Combined with Bootstrap-Skill that's 9 lines ×
~35 = ~315 tokens total catalog overhead. Well within the Wave-A
success criterion of "under 1k tokens for a fresh conversation".

### No frontend changes

The `/settings/skills` page lists skills from `GET /api/skills`, which
returns all rows including the 8 new ones. The enabled-toggle, token
counter, and CRUD buttons work without any code change.

## Scope

### Backend only (`/home/haex/Projekte/Holzi`, package `hermes`)

1. **New module**: `src/hermes/starter_skills.py`
   - `STARTER_SKILLS` constant (8 skill dicts)
   - `ensure_starter_skills_seeded(engine)` function
2. **Lifespan**: `src/hermes/main.py` — import + one new call after
   `ensure_bootstrap_skill_seeded`.
3. **Tests**: `tests/test_starter_skills_seed.py` (new, ~5 tests).

### Frontend — no changes

Skills page already renders dynamically. No new locale keys, no new
components, no gen:api run needed.

## Tasks

Backend-only, one commit per task.

---

### Task 1: Write the failing tests

**Files:**
- Create: `tests/test_starter_skills_seed.py`

**Step 1: Write the tests** (they will fail — module doesn't exist yet)

```python
import pytest
from sqlalchemy.ext.asyncio import AsyncEngine

from hermes.starter_skills import ensure_starter_skills_seeded, STARTER_SKILLS


@pytest.mark.asyncio
async def test_all_starter_skills_seeded(engine: AsyncEngine) -> None:
    """All 8 starter skills are present after ensure_starter_skills_seeded."""
    await ensure_starter_skills_seeded(engine)
    async with engine.connect() as conn:
        from sqlalchemy import text
        rows = (await conn.execute(text("SELECT slug FROM skills ORDER BY slug"))).all()
    slugs = {r.slug for r in rows}
    for skill in STARTER_SKILLS:
        assert skill["slug"] in slugs, f"Missing skill: {skill['slug']}"


@pytest.mark.asyncio
async def test_starter_skills_all_enabled(engine: AsyncEngine) -> None:
    """All seeded skills default to enabled=1."""
    await ensure_starter_skills_seeded(engine)
    async with engine.connect() as conn:
        from sqlalchemy import text
        rows = (
            await conn.execute(
                text("SELECT slug, enabled FROM skills WHERE slug != 'bootstrap-first-chat'")
            )
        ).all()
    for row in rows:
        assert row.enabled == 1, f"{row.slug} should be enabled"


@pytest.mark.asyncio
async def test_starter_skills_seeded_idempotent(engine: AsyncEngine) -> None:
    """Running ensure_starter_skills_seeded twice creates no duplicate rows."""
    await ensure_starter_skills_seeded(engine)
    await ensure_starter_skills_seeded(engine)
    async with engine.connect() as conn:
        from sqlalchemy import text
        count = (
            await conn.execute(text("SELECT COUNT(*) FROM skills"))
        ).scalar()
    assert count == len(STARTER_SKILLS)


@pytest.mark.asyncio
async def test_starter_skills_preserves_user_edit(engine: AsyncEngine) -> None:
    """A manually edited body is NOT overwritten on second boot."""
    await ensure_starter_skills_seeded(engine)
    async with engine.begin() as conn:
        from sqlalchemy import text
        await conn.execute(
            text("UPDATE skills SET body_markdown = 'custom body' WHERE slug = 'code-review'")
        )
    await ensure_starter_skills_seeded(engine)
    async with engine.connect() as conn:
        from sqlalchemy import text
        row = (
            await conn.execute(
                text("SELECT body_markdown FROM skills WHERE slug = 'code-review'")
            )
        ).first()
    assert row is not None and row.body_markdown == "custom body"


@pytest.mark.asyncio
async def test_starter_skills_count(engine: AsyncEngine) -> None:
    """STARTER_SKILLS contains exactly 8 entries."""
    assert len(STARTER_SKILLS) == 8
```

**Step 2: Run the tests to confirm they fail**

```bash
cd /home/haex/Projekte/Holzi
uv run pytest tests/test_starter_skills_seed.py -v
```

Expected: `ModuleNotFoundError: No module named 'hermes.starter_skills'`

---

### Task 2: Implement `src/hermes/starter_skills.py`

**Files:**
- Create: `src/hermes/starter_skills.py`

```python
import time
from typing import Final

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

# ---------------------------------------------------------------------------
# Skill body constants — DE-default with language-switch instruction.
# INSERT OR IGNORE on slug: user-edited bodies are never overwritten.
# Wave D1 will add YAML frontmatter to these bodies; for now they are
# plain Markdown.
# ---------------------------------------------------------------------------

_BRAINSTORMING_BODY: Final[str] = """\
# brainstorming

> If the user writes in English, switch to English throughout.

Du hilfst dabei, Ideen zu generieren, auszuweiten und zu strukturieren.

## Ablauf

1. **Verstehe das Ziel**: Was soll am Ende rausgekommen sein? Eine lange
   Liste roher Ideen, eine priorisierte Shortlist, eine Mindmap-Struktur?

2. **Divergenz zuerst** (Ideen sammeln — keine Bewertung):
   - Quantity over quality. Schreibe alles auf, auch Unwahrscheinliches.
   - Nutze verschiedene Blickwinkel: Was würde ein Neuling tun? Ein Experte?
     Jemand mit unbegrenztem Budget? Jemand mit null Budget?
   - „Ja, und…"-Prinzip: Baue auf Ideen des Users auf, statt sie sofort
     zu hinterfragen.

3. **Konvergenz danach** (Ideen bewerten — nur wenn gewünscht):
   - Gruppenbildung: Ähnliche Ideen clustern.
   - Priorisierung: Impact vs. Aufwand, oder Risiko vs. Chance.
   - Top-3 oder Top-5 herausarbeiten.

4. **Nächste Schritte**: Frage, welche Idee vertieft werden soll.

## Tipps

- Bewerte nicht während der Divergenz-Phase — das bremst den Fluss.
- Stelle Rückfragen, wenn das Problem zu vage ist: „Für wen? Mit welchen
  Einschränkungen?"
- Halte die Energie hoch — kurze, prägnante Outputs statt Romane.
"""

_CODE_REVIEW_BODY: Final[str] = """\
# code-review

> If the user writes in English, switch to English throughout.

Du führst ein gründliches Code-Review durch.

## Ablauf

1. **Verstehe den Kontext**: Frage, falls nicht klar: Welche Sprache /
   welches Framework? Was soll der Code tun? Gibt es bestimmte Aspekte,
   auf die du dich konzentrieren sollst?

2. **Analysiere den Code** auf diese Dimensionen:
   - **Korrektheit**: Logikfehler, Edge-Cases, Off-by-one-Fehler
   - **Sicherheit**: Injection, unsichere Deserialisierung, sensitive
     Daten im Code, fehlende Input-Validierung
   - **Performance**: Unnötige Loops, N+1-Queries, teure Operationen
     in heißen Pfaden
   - **Lesbarkeit**: Benennung, Länge von Funktionen, Komplexität
   - **Tests**: Fehlen wichtige Test-Cases oder werden nur Happy-Paths
     abgedeckt?

3. **Priorisiere Findings**:
   - 🔴 Blocker (Bugs, Security-Issues — muss gefixt werden)
   - 🟡 Empfehlung (Performance, Style, Testbarkeit)
   - 🟢 Nit (Kleinigkeiten, Nitpicks)

4. **Format**:
   Findings als kommentierte Liste mit konkreten Code-Vorschlägen
   (Diff-Stil oder Inline). Erst Priorität benennen, dann Begründung,
   dann Vorschlag.

## Tipps

- Hebe auch das Positive hervor — was der Code gut macht.
- Mach konkrete Änderungsvorschläge, keine vagen Hinweise.
- Bei großen Diffs: erst Architektur-Level kommentieren, dann Details.
"""

_DAILY_JOURNAL_BODY: Final[str] = """\
# daily-journal

> If the user writes in English, switch to English throughout.

Du begleitest ein Tagebuch- oder Reflektionsgespräch.

## Ablauf

1. **Einstieg**: Beginne mit einer offenen Frage, z.B.:
   - „Wie war dein Tag? Was beschäftigt dich gerade?"
   - „Was war heute das Wichtigste für dich?"

2. **Aktives Zuhören**: Stelle Vertiefungsfragen — keine Bewertungen.
   Deine Aufgabe ist es, dem User zu helfen, seinen eigenen Gedanken
   zu folgen, nicht ihn zu leiten.

3. **Muster erkennen** (nur wenn der User es möchte): Nach dem Gespräch
   oder auf Anfrage kannst du beobachten, welche Themen wiederkehren.

4. **Abschluss**: Frage optional am Ende:
   - „Gibt es etwas, das du morgen anders machen möchtest?"
   - „Was nimmst du aus diesem Gespräch mit?"

## Optionale Einstiegsprompts

Falls der User nicht weiß, wo er anfangen soll:
- „Was hat dich heute überrascht?"
- „Gab es einen Moment, auf den du stolz bist?"
- „Was hat dir Energie gegeben — was hat sie genommen?"
- „Was wolltest du tun, aber nicht geschafft?"

## Tipps

- Kein ungebetener Rat. Fragen, kein Dozieren.
- Wenn der User eine schwierige Situation schildert: Mitgefühl zuerst,
  Lösungen nur wenn explizit gewünscht.
- Halte den Ton warm, nicht therapeutisch.
"""

_LEARN_EXPLAIN_BODY: Final[str] = """\
# learn-explain

> If the user writes in English, switch to English throughout.

Du erklärst ein Thema auf das Niveau des Users angepasst.

## Ablauf

1. **Vorkenntnisse einschätzen**: Frage kurz, was der User schon weiß.
   Oder bitte ihn, in einem Satz zu erklären, was er versteht — das
   verrät das Niveau besser als eine direkte Frage.

2. **Erkläre in Schichten**:
   - Beginne mit der einfachsten, richtigen Erklärung.
   - Füge Präzision Schicht für Schicht hinzu.
   - Keine Details, die der User noch nicht verarbeiten kann.

3. **Ankerpunkte nutzen**: Verknüpfe das Neue mit etwas, das der User
   schon kennt. Analogien, Beispiele, Gegenbeispiele.

4. **Verständnis prüfen**: Stelle am Ende eine einfache
   Verständnisfrage — nicht „Hast du alles verstanden?" (Antwort ist
   immer ja), sondern eine konkrete Frage zum Inhalt.

5. **Tiefer gehen wenn nötig**: Folgefragen signalisieren, dass das
   Grundniveau passt — antworte dann detail-reicher.

## Tipps

- Keine Fachbegriffe ohne Definition.
- Lieber ein Konzept richtig als drei Konzepte oberflächlich.
- „Ich weiß es nicht" ist besser als eine unsichere Erklärung.
"""

_RECIPE_HELPER_BODY: Final[str] = """\
# recipe-helper

> If the user writes in English, switch to English throughout.

Du hilfst beim Kochen, Mahlzeiten planen und Rezepte finden oder anpassen.

## Ablauf

1. **Kontext verstehen**:
   - Welche Zutaten sind vorhanden / was soll verbraucht werden?
   - Wie viele Personen, Allergien oder Unverträglichkeiten?
   - Wie viel Zeit und welche Kocherfahrung hat der User?

2. **Rezept vorschlagen oder anpassen**:
   - Klares Rezept: Mengenangaben (pro Portion), Schritt-für-Schritt.
   - Schwierigkeitsgrad und Zeitaufwand nennen.
   - Substitutionen anbieten für fehlende Zutaten.

3. **Mahlzeitenplanung** (falls gewünscht):
   - Wochenplan mit Einkaufsliste.
   - Resteverwertung einplanen (z.B. „Montagsreste für Donnerstag").
   - Nährwertbalance berücksichtigen wenn gewünscht.

## Tipps

- Schreibe Mengen so, dass sie skalierbar sind (pro Portion markiert).
- Erkläre Techniken kurz, wenn der Schwierigkeitsgrad es erfordert.
- Wenn Zutaten fehlen: kreative Substitutionen vorschlagen, nicht
  „kauf das nach".
"""

_SOCRATIC_DIALOGUE_BODY: Final[str] = """\
# socratic-dialogue

> If the user writes in English, switch to English throughout.

Du führst ein sokratisches Gespräch — du stellst Fragen, statt
Antworten zu geben.

## Prinzipien

1. **Fragen statt Aussagen**: Deine Hauptrolle ist es, durch gezielte
   Fragen das Denken des Users zu schärfen. Du hast keine Meinung zu
   verteidigen.

2. **Entlarve Widersprüche sanft**: Wenn du eine Inkonsistenz in den
   Aussagen des Users erkennst, frage danach — ohne es direkt zu
   benennen. „Wie verträgt sich das mit dem, was du vorhin gesagt hast,
   dass…?"

3. **Gehe tiefer, nicht breiter**: Bleibe bei einem Punkt, bis er
   wirklich durchdacht ist. Führe nichts Neues ein, solange der
   aktuelle Punkt offen ist.

4. **Annahmen hinterfragen**:
   - „Was setzt du dabei voraus?"
   - „Woher weißt du das?"
   - „Wäre das auch in folgendem Fall wahr: …?"

## Ablauf

1. Lass den User sein Thema oder seine Position formulieren.
2. Stelle eine einzige Frage, die den Kern trifft.
3. Höre die Antwort, und stelle die nächste Frage — basierend auf dem,
   was gesagt wurde.
4. Nach 5–7 Runden: Biete optional eine Synthese an oder lass den User
   zusammenfassen.

## Tipps

- Deine Fragen sollten kurz sein.
- Keine rhetorischen Fragen, die die Antwort bereits enthalten.
- Wenn der User deine Meinung will: Du kannst sie teilen, aber klar
  als persönliche Perspektive markieren, nicht als Wahrheit.
"""

_SUMMARIZE_SOURCE_BODY: Final[str] = """\
# summarize-source

> If the user writes in English, switch to English throughout.

Du kondensierst eine Quelle (URL, Dateiinhalt oder direkt eingefügter
Text) auf das Wesentliche.

## Ablauf

1. **Quelle bestimmen**:
   - URL → `fetch_url` verwenden um den Inhalt zu laden.
   - Datei oder eingefügter Text → direkt verarbeiten.

2. **Ziel klären** (frage wenn unklar):
   - TL;DR (2–3 Sätze)
   - Strukturierte Übersicht (Abschnitte mit Key-Points)
   - Entscheidungs-Basis (Kernthesen, Vor-/Nachteile)

3. **Zusammenfassung erstellen**:
   - Kern-Aussagen priorisieren, Details weglassen.
   - Sprache des Originals paraphrasieren, nicht kopieren.
   - Länge proportional zum Original-Dokument.

4. **Quellenangabe**: URL oder Dateiname am Anfang oder Ende nennen.

## Tipps

- Bei sehr langen Texten: erst Struktur (Überschriften,
  Einleitung/Fazit) lesen, dann vertiefen.
- Bei akademischen Texten: Abstract + Conclusion zuerst.
- Wenn unklar was wichtig ist: frage nach der Entscheidung oder
  Aktion, für die die Zusammenfassung gebraucht wird.
"""

_WEB_RESEARCH_BODY: Final[str] = """\
# web-research

> If the user writes in English, switch to English throughout.

Du führst eine strukturierte Web-Recherche durch.

## Ablauf

1. **Kläre die Frage**: Was genau soll recherchiert werden? Gibt es
   einen Zeitraum, eine Region oder eine Sprache?

2. **Suche**: Benutze `web_search` mit mehreren, unterschiedlich
   formulierten Queries. Mindestens 2–3 Suchläufe für komplexe Fragen.

3. **Quellen bewerten**:
   - Primärquelle > Sekundärquelle > Blog
   - Aktualität: Datum notieren
   - Autorität: Wer hat das veröffentlicht?

4. **Synthese**: Fasse das Ergebnis strukturiert zusammen. Trenne
   Fakten von Meinungen. Weise auf Widersprüche zwischen Quellen hin.

5. **Quellenangabe**: Jede Behauptung mit URL belegen.
   Format: [Titel](URL) – Datum.

## Tipps

- Spekuliere nicht. Wenn keine verlässliche Quelle gefunden wurde,
  sage das explizit.
- Überprüfe wichtige Claims mit einer zweiten, unabhängigen Quelle.
- Bei vagen Fragen: Konkretisiere zuerst, dann recherchiere.
"""


# ---------------------------------------------------------------------------
# Aggregated list — slug is the PRIMARY KEY; name, description, when_to_use
# feed the Catalog-Index in the system prompt.
# ---------------------------------------------------------------------------

STARTER_SKILLS: Final[list[dict]] = [
    {
        "slug": "brainstorming",
        "name": "Brainstorming",
        "description": (
            "Ideen generieren, ausweiten und strukturieren — für kreative "
            "Aufgaben, Entscheidungen oder Problemlösungen."
        ),
        "when_to_use": (
            "User möchte Ideen sammeln, eine Entscheidung durchdenken oder "
            "ein Problem aus verschiedenen Blickwinkeln betrachten."
        ),
        "body_markdown": _BRAINSTORMING_BODY,
    },
    {
        "slug": "code-review",
        "name": "Code-Review",
        "description": (
            "Gründliches Code-Review mit priorisierten Findings "
            "(Blocker / Empfehlung / Nit) und konkreten Änderungsvorschlägen."
        ),
        "when_to_use": (
            "User fügt einen Diff, ein Snippet oder eine Datei ein und "
            "fragt nach Feedback, Review oder Verbesserungsvorschlägen."
        ),
        "body_markdown": _CODE_REVIEW_BODY,
    },
    {
        "slug": "daily-journal",
        "name": "Tagesjournal",
        "description": (
            "Begleitung eines Reflexions- oder Tagebuchgesprächs — "
            "aktives Zuhören, Vertiefungsfragen, kein ungebetener Rat."
        ),
        "when_to_use": (
            "User möchte über seinen Tag reflektieren, Gedanken ordnen "
            "oder ein Journaling-Gespräch führen."
        ),
        "body_markdown": _DAILY_JOURNAL_BODY,
    },
    {
        "slug": "learn-explain",
        "name": "Erklären & Lernen",
        "description": (
            "Ein Thema niveaugerecht erklären — von der einfachen "
            "Analogie bis zur fachlichen Tiefe, angepasst an den User."
        ),
        "when_to_use": (
            "User möchte ein Konzept, eine Technologie oder ein Thema "
            "verstehen oder vertiefen."
        ),
        "body_markdown": _LEARN_EXPLAIN_BODY,
    },
    {
        "slug": "recipe-helper",
        "name": "Rezept-Helfer",
        "description": (
            "Rezepte finden, anpassen und Mahlzeiten planen — "
            "mit Berücksichtigung vorhandener Zutaten und Ernährungswünsche."
        ),
        "when_to_use": (
            "User fragt nach Rezepten, Kochanleitung, Zutatensubstitutionen "
            "oder Wochenplanung."
        ),
        "body_markdown": _RECIPE_HELPER_BODY,
    },
    {
        "slug": "socratic-dialogue",
        "name": "Sokratischer Dialog",
        "description": (
            "Tiefes Durchdenken einer These durch gezielte Fragen — "
            "der Agent urteilt nicht, sondern hinterfragt."
        ),
        "when_to_use": (
            "User möchte eine Position durchdenken, philosophisch diskutieren "
            "oder Annahmen hinterfragen."
        ),
        "body_markdown": _SOCRATIC_DIALOGUE_BODY,
    },
    {
        "slug": "summarize-source",
        "name": "Quelle zusammenfassen",
        "description": (
            "URL, Dokument oder Text auf das Wesentliche verdichten — "
            "TL;DR, strukturierte Übersicht oder Entscheidungs-Basis."
        ),
        "when_to_use": (
            "User gibt eine URL, eine Datei oder einen langen Text und "
            "möchte eine Zusammenfassung oder einen Überblick."
        ),
        "body_markdown": _SUMMARIZE_SOURCE_BODY,
    },
    {
        "slug": "web-research",
        "name": "Web-Recherche",
        "description": (
            "Strukturierte Web-Recherche mit mehreren Suchläufen, "
            "Quellenbewertung und belegten Aussagen."
        ),
        "when_to_use": (
            "User fragt nach Fakten, aktuellen Ereignissen, Vergleichen "
            "oder Themen, die eine Web-Suche erfordern."
        ),
        "body_markdown": _WEB_RESEARCH_BODY,
    },
]


async def ensure_starter_skills_seeded(engine: AsyncEngine) -> None:
    """Idempotent: INSERT OR IGNORE each starter skill row.

    Called once per boot (after ``ensure_bootstrap_skill_seeded``).
    If the user has edited a skill body via the Skills-Page,
    ``INSERT OR IGNORE`` matched on the UNIQUE slug leaves the row
    untouched — no overwrite.
    """
    now = int(time.time())
    async with engine.begin() as conn:
        for skill in STARTER_SKILLS:
            await conn.execute(
                text(
                    "INSERT OR IGNORE INTO skills"
                    "(slug, name, description, when_to_use, body_markdown,"
                    " enabled, created_at, updated_at) "
                    "VALUES (:slug, :name, :description, :when_to_use,"
                    " :body_markdown, 1, :now, :now)"
                ),
                {
                    "slug": skill["slug"],
                    "name": skill["name"],
                    "description": skill["description"],
                    "when_to_use": skill["when_to_use"],
                    "body_markdown": skill["body_markdown"],
                    "now": now,
                },
            )
```

**Step 3: Run the tests**

```bash
uv run pytest tests/test_starter_skills_seed.py -v
```

Expected: 5 passed.

**Step 4: Commit**

```bash
git add src/hermes/starter_skills.py tests/test_starter_skills_seed.py
git commit -m "feat(skills): curated starter skill library — 8 seed skills"
```

---

### Task 3: Wire into lifespan

**Files:**
- Modify: `src/hermes/main.py`

**Step 1: Add the import** (alongside the existing bootstrap import)

Find the line:

```python
from hermes.personas import (
    ...
    ensure_bootstrap_skill_seeded,
    ...
)
```

Add alongside it (or as a separate top-level import):

```python
from hermes.starter_skills import ensure_starter_skills_seeded
```

**Step 2: Add the lifespan call**

Find in `main.py`:

```python
        await ensure_bootstrap_skill_seeded(app.state.db)
```

Add immediately after:

```python
        # Plan 38: seed the 8 curated starter skills. Idempotent —
        # INSERT OR IGNORE per slug; user-edited bodies are preserved.
        await ensure_starter_skills_seeded(app.state.db)
```

**Step 3: Run the full test suite**

```bash
uv run pytest -x
```

Expected: all passing (Plan 37 baseline: 904 passed).

**Step 4: Linting + type-check**

```bash
uv run ruff check src/ tests/
uv run mypy src/
```

Expected: clean.

**Step 5: Commit**

```bash
git add src/hermes/main.py
git commit -m "feat(main): wire starter skills seed into lifespan"
```

---

### Task 4: Live smoke + docs

**Files:**
- Modify: `docs/plans/holzi-agent-parity/38-starter-skill-library.md`
  (this file) — Status-Line + Verification-Block.
- Modify: `docs/plans/holzi-agent-parity/35-strategic-roadmap-2026h2.md`
  — Wave-A3 entry with "**A3 done YYYY-MM-DD**".

**Step 1: Start the stack**

```bash
make CONTAINER_BIN=docker COMPOSE_BIN="docker compose" up-local-full
```

**Step 2: Smoke-check `/settings/skills`**

Open `http://localhost:3000/settings/skills`. Expected:

- 9 skills visible (Bootstrap-Skill + 8 starter skills)
- Each has an enabled-toggle (all on by default)
- Token counter shows ~9 active
- All 8 starter skill slugs visible in the list

**Step 3: Catalog-Index in effective prompt**

Open `/settings/preferences` → „Effektiver Prompt". Expected:

`## Available skills` section with 9 lines, alphabetical:
`bootstrap-first-chat`, `brainstorming`, `code-review`, `daily-journal`,
`learn-explain`, `recipe-helper`, `socratic-dialogue`, `summarize-source`,
`web-research`.

**Step 4: Smoke-check skill loading in chat**

Open a chat, send: „Kannst du meinen Code reviewen?" (paste a small
snippet). Expected: agent loads `code-review` (Tool-Card visible in
chat), applies the structured review format.

**Step 5: Update plan docs**

- Add Verification block to this file (Task 4).
- Update Plan 35 §A3 with „**A3 done YYYY-MM-DD**" and Wave A
  success criteria checkmarks.

**Step 6: Commit**

```bash
git add docs/plans/holzi-agent-parity/38-starter-skill-library.md \
        docs/plans/holzi-agent-parity/35-strategic-roadmap-2026h2.md
git commit -m "docs: mark Plan 38 (Wave A3) complete"
```

---

## Verification

BE branch `wave-a3-starter-skills` — 2 commits:

| SHA | Commit |
|---|---|
| `5ddf9ee` | feat(skills): curated starter skill library — 8 seed skills |
| `5d69980` | feat(main): wire starter skills seed into lifespan |

**Test results:**
- Backend: `uv run pytest` → **911 passed** (906 baseline + 5 new seed tests), ruff clean, mypy clean
- Frontend: no changes — `pnpm vitest run` unchanged

**Smoke (2026-06-05):**
- Direct Python smoke: `ensure_bootstrap_skill_seeded` + `ensure_starter_skills_seeded` → 9 skills in DB, all enabled=1 ✓
- Slugs: `bootstrap-first-chat`, `brainstorming`, `code-review`, `daily-journal`, `learn-explain`, `recipe-helper`, `socratic-dialogue`, `summarize-source`, `web-research` ✓
- All INSERT OR IGNORE — second boot leaves user-edited bodies intact ✓

## Risk Register

| Risk | Mitigation |
|---|---|
| Skill body in DE confuses EN-only users | Every body starts with "If the user writes in English, switch to English." LLMs are multilingual; in practice this works. Body-locale split = Wave D. |
| 8 new catalog lines inflate the system prompt past Wave-A goal | 9 skills × ~35 tokens = ~315 tokens total catalog overhead. Well under 1k token goal. Token counter on `/settings/skills` lets users disable any skill they don't need. |
| `web-research` body references `web_search` tool which may not be available | `web_search` is a user-installed MCP or built-in tool; skill body says "benutze `web_search`" as a hint. If it's absent, the agent will say so. No functional breakage. |
| `summarize-source` body references `fetch_url` tool | Same as above — hint only; agent handles gracefully if absent. |
| User edits a starter skill body → re-deploy reverts it | INSERT OR IGNORE: once the row exists, re-deploy is a no-op on that slug. Body is preserved. |
| Wave D1 rewrites body format — are A3 bodies the right starting point? | D1 adds frontmatter columns parsed at write time; the prose body stays. A3 bodies are clean Markdown — D1 migration appends frontmatter without touching the prose. No risk. |

## Decision Log

- 2026-06-05: Plan 38 as Wave A3 — backend-only, 8 skills, new
  `starter_skills.py` module separate from `personas.py` (which is
  already long). Same INSERT OR IGNORE seed pattern as Plan 37.
- 2026-06-05: 8 skills chosen: brainstorming, code-review,
  daily-journal, learn-explain, recipe-helper, socratic-dialogue,
  summarize-source, web-research. Matches Plan 35 §A3 illustrative
  list (swapped `writing-feedback` for `brainstorming` — more
  universally useful for an assistant).
- 2026-06-05: No YAML frontmatter in A3 bodies. D1 is the
  frontmatter-standard wave; adding it now would be YAGNI and D1
  explicitly says it will rewrite A3 bodies to the standard format.
- 2026-06-05: No frontend changes. Skills-Page already renders
  dynamically; token counter auto-calculates; no new locale keys.
