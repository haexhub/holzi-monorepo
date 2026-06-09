# Plan 29-C: Persona pro Conversation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Planned.**

Cross-repo. Backend-Spalte + Endpoint-Erweiterung + Composer-Chip im
Web-Chat.

Depends on: [29-A](./29a-personas-and-channels.md), [01](./01-conversation-lifecycle.md)
(`conversations`-Tabelle), Relationship zu Plan [23](./23-composer-chips.md)
(Composer-Chip-Infrastruktur — falls 23 zuerst kommt, ist 29-C nur eine
Erweiterung des Chip-Sets).

## Goal

Erlauben, dass jede Web-Chat-Conversation einer konkreten Persona
zugeordnet ist. User kann pro Conversation eine Persona wählen; ohne
Auswahl gilt die `default_persona_id` des Web-Channels (aus 29-A), die
ohne weitere Konfiguration die globale `is_default`-Persona ist.

## Why

Verschiedene Conversation-Typen brauchen verschiedene Personas — eine
„Coding-Session" will den Reviewer, eine „Brainstorming"-Session will
den Sokrates-Tutor.

## Non-Goals

- Persona-Switch mitten in einer Conversation, der **rückwirkend** die
  System-Message austauscht. Wechsel gilt ab dem nächsten Turn; alte
  Messages bleiben kontextuell unter der alten Persona.
- Persona pro Signal-/Telegram-Conversation. Signal/Telegram nutzen die
  Channel-Default-Persona aus 29-A; pro-Account-Override ist eigene
  Diskussion.

## Scope

### Backend (`/home/haex/Projekte/Holzi`)

- Migration `conversations` → neue Spalte `persona_id INTEGER REFERENCES
  personas(id) ON DELETE SET NULL`.
- `repository/conversations.py`: `create`/`update` akzeptieren
  `persona_id`.
- `POST /api/conversations`, `PATCH /api/conversations/{id}` akzeptieren
  `persona_id`.
- `routes/api.py` Chat-SSE-Stream: vor `run_agent(...)` der Channel-
  Override mit `conversation.persona_id`.

### Frontend (`/home/haex/Projekte/holzi-frontend`)

- `pnpm run gen:api`.
- Composer-Persona-Chip in `pages/index.vue` (oder im Composer-
  Component) — Klick öffnet Popover mit Persona-Liste; Auswahl ruft
  `PATCH /api/conversations/{id}` mit `persona_id`.
- Chip zeigt den Persona-Namen + Icon; Default-State zeigt „Default
  (Channel-Default)" oder den Namen der Channel-Default-Persona.

### Tests

Backend:
- `tests/test_api_chat.py`: Conversation mit `persona_id` → SSE-Run
  startet mit dieser Persona im System-Prompt.

Frontend:
- `tests/components/ComposerPersonaChip.test.ts`: Render, Switch,
  optimistic-update + Rollback bei Fehler.
