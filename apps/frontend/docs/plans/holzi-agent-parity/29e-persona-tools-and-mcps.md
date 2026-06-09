# Plan 29-E: Tools, MCPs und Berechtigungen pro Persona

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Planned.**

Cross-repo. Persona bekommt eine Tool-Allowlist; `build_tool_catalog`
filtert; Frontend bietet Multi-Select.

Depends on: [29-A](./29a-personas-and-channels.md). Verwandt mit
[21](./21-approval-granularity.md) (Approvals sind orthogonal zur
Allowlist — Allowlist = „darf die Persona dieses Tool überhaupt sehen",
Approval = „muss der User es bestätigen wenn die Persona es nutzt").

## Goal

Pro Persona definieren, welche Tools (inkl. perspektivisch MCP-bezogener
Tools) dem Agent sichtbar sind. Standardmäßig sieht eine Persona alle
Tools („NULL"-Wert in der Spalte = volles Catalog). Wenn ein Array
gesetzt ist, ist es eine **Allowlist** — nur diese Tools werden in den
Agent-Run gegeben.

## Why

- Eine „Tutor"-Persona soll keinen `shell_exec` haben dürfen, auch wenn
  sie technisch könnte.
- Eine „Coding-Reviewer"-Persona will nur lesende Tools auf der
  Workspace-Seite, keine `write_file`-Operationen.
- Sicherheit: jede Persona ist ein abgegrenzter Capability-Pool.

## Non-Goals

- **Tool-Konfiguration pro Persona** (z.B. eigene Brave-Search-Keys).
  YAGNI.
- **MCP-Server pro Persona installieren** (eigene Subprozesse). Das ist
  ein eigener Plan — hier nur Allowlist über existierende
  Tool-Namen.
- **Persona-spezifische Approval-Defaults** (Plan 21 macht Approvals
  granular; ob Approval auch persona-aware sein soll, kommt nach 21
  + 29-E).
- **Dynamische Tool-Discovery** (z.B. „alle Tools mit `write`-Tag
  auto-blocken"). User wählt Tools explizit aus.

## Scope

### Backend (`/home/haex/Projekte/Holzi`)

- Migration `personas`:
  - Neue Spalte `tool_allowlist TEXT` (JSON-Array von Tool-Namen, oder
    `NULL` = alle Tools).
- `repository/personas.py`: Update/Create akzeptiert `tool_allowlist`,
  serialisiert als JSON-String, parsed beim Read.
- `tool_catalog.py`: neue Funktion
  ```python
  def filter_catalog(
      catalog: list[Tool],
      allowlist: list[str] | None,
  ) -> list[Tool]:
      if allowlist is None:
          return catalog
      allowed = set(allowlist)
      return [t for t in catalog if t.name in allowed]
  ```
- `PersonaContext` aus 29-D bekommt zusätzlich `tool_allowlist`-Feld;
  die Call-Sites filtern das `tool_catalog` vor `run_agent(...)`.
- Neuer Endpoint **`GET /api/tools`** — listet alle bekannten Tool-Namen
  + Description + Channel-Hint, damit das Frontend einen Multi-Select-
  Picker bauen kann, ohne die Tool-Namen zu hardcoden.

**Validierung:**
- Tool-Namen in `tool_allowlist` müssen in `build_tool_catalog(...)`
  existieren → unbekannte Namen → 422.
- Wenn ein Tool aus dem Code entfernt wird, persistierter Eintrag in
  einer Persona wird *nicht* automatisch entfernt; `filter_catalog`
  skipped ihn silent. Optional: Boot-Warn-Log.

### Frontend (`/home/haex/Projekte/holzi-frontend`)

- `pnpm run gen:api`.
- Persona-Card aus 29-A (+29-D) erweitern um Tool-Picker:
  - „Tools" Section in der Card.
  - Wenn `tool_allowlist === null` → zeigt „Alle Tools verfügbar" mit
    Button „Einschränken".
  - Sonst Multi-Select (Checkbox-Liste) aus `GET /api/tools`-Response,
    gruppiert nach Channel/Kategorie wenn Backend das mitliefert.
  - Button „Alle erlauben" setzt zurück auf `null`.

### Tests

Backend:
- `tests/test_personas_repo.py` erweitert: `tool_allowlist` round-trip
  (JSON-Serialisierung), NULL-Defaults.
- `tests/test_api_preferences.py`: PUT mit unbekanntem Tool-Namen → 422.
- `tests/test_runner.py` (oder bestehender Agent-Test): Persona mit
  Allowlist → Agent erhält nur diese Tools in der ersten Request-
  Message.
- `tests/test_tool_catalog.py`: `filter_catalog(allowlist=None)` →
  Catalog unverändert; mit Allowlist → korrekte Filterung.

Frontend:
- `tests/components/PreferencesPage.test.ts`: Allowlist-Toggle,
  Tool-Auswahl persistiert, „Alle erlauben" Reset.

## Open Questions

- Sollte der `GET /api/tools`-Endpoint persona-bezogen sein
  (`GET /api/personas/{id}/available-tools` mit Channel-Filter)? →
  Vorschlag: nein, generisch genug — Persona wählt aus dem globalen
  Pool, Channel-Recursion-Guards (`cross_channel_send`) bleiben separat.
- Sollten gewisse Tools immer verfügbar sein, auch wenn die Allowlist
  sie ausblendet (z.B. `memory_read`)? → Vorschlag: nein. Allowlist
  ist hart. Wer Tools immer braucht, fügt sie in der UI hinzu.
