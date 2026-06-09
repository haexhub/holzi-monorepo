# Plan 29-B: Persona pro `agent_task`

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Planned.**

Cross-repo. Backend-Spalte + Endpoint-Erweiterung + Frontend-Dropdown im
Task-Form.

Depends on: [29-A](./29a-personas-and-channels.md) (Personas-Tabelle und
`get_effective_system_prompt`-Resolver existieren), [16](./16-tasks-cron-panel.md)
(`agent_tasks`-Tabelle und `/settings/tasks`-UI existieren).

## Goal

Erlauben, dass jeder geplante Task (`agent_tasks`-Row) eine konkrete
Persona zugewiesen bekommt. Wenn keine zugewiesen → Fallback auf die
Default-Persona des Channels `"task"` (aus 29-A).

## Why

Ein „Daily Standup zusammenfassen"-Task profitiert von einer anderen
Persona als ein „Lint die letzten Commits"-Task. Heute teilen sich alle
Tasks die globale Task-Persona.

## Non-Goals

- Mehrere Personas pro Task (kein „role-switching" innerhalb eines Runs).
- Per-Run-Override beim manuellen `POST /api/tasks/{id}/run` — der nutzt
  die gespeicherte `persona_id`.

## Scope

### Backend (`/home/haex/Projekte/Holzi`)

- Migration `agent_tasks` → neue Spalte `persona_id INTEGER REFERENCES
  personas(id) ON DELETE SET NULL`.
- `repository/agent_tasks.py` erweitert: `create`/`update` akzeptieren
  optional `persona_id`; `list_*` und `get_*` liefern es zurück.
- `routes/api.py` Tasks-Endpoints (`POST /api/tasks`, `PATCH
  /api/tasks/{id}`) akzeptieren `persona_id` (optional). 422 wenn Persona
  nicht existiert.
- `scheduler.py`: vor `run_agent(...)` resolver mit `persona_id`-Override:
  ```python
  if task.persona_id is not None:
      persona = personas_repo.get(db, task.persona_id)
      # Falls Persona zwischenzeitlich gelöscht wurde (FK SET NULL),
      # task.persona_id ist bereits None — kein Sonderfall hier.
      prompt = f"{persona.prompt}\n\n{channel_prompt}"
  else:
      prompt = await get_effective_system_prompt("task", db)
  ```
  Optional eleganter: `get_effective_system_prompt` bekommt ein Keyword-
  Argument `persona_id_override`.

### Frontend (`/home/haex/Projekte/holzi-frontend`)

- `pnpm run gen:api` (neue `AgentTask.persona_id`-Felder).
- `/settings/tasks` Task-Form: neues `<select>` „Persona" mit allen
  Personas + Eintrag „— Default für Channel ‚Tasks' —" mit `value=""` →
  `persona_id: null`.
- Detail-View zeigt die zugewiesene Persona als Badge (oder „Default").

### Tests

Backend:
- `tests/test_api_tasks.py`: `POST` mit unbekannter `persona_id` → 422,
  mit gültiger → 201, `PATCH` ändert Zuweisung.
- `tests/test_scheduler.py`: Task mit `persona_id` → resolver liefert
  diese Persona, nicht den Channel-Default.

Frontend:
- `tests/components/TasksPage.test.ts` (oder neuer File): Dropdown
  rendert alle Personas, Submit sendet `persona_id`.
