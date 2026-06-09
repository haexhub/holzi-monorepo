# Plan 34: Messenger-Familie komplett aus Holzi entfernen

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Status: **Merged 2026-06-04** (backend [Holzi#71](https://github.com/haexhub/Holzi/pull/71), frontend [holzi-frontend#89](https://github.com/haexhub/holzi-frontend/pull/89), Ansible [haexhub/ansible#48](https://github.com/haexhub/ansible/pull/48)). Box-side Ansible-Lauf steht noch aus — User führt mit `-K` selbst aus.

Verification (2026-06-04):

- **Backend:** Komplette Löschung von `src/hermes/signal/`, `src/hermes/telegram/`, `src/hermes/messenger/`, `routes/messenger.py`, `repository/messenger.py`, `tools/cross_channel.py` + 6 Test-Files (test_signal_*, test_telegram_*, test_messenger_repo, test_api_messenger, test_tools_cross_channel) + signal-envelope-fixtures + `docs/user-guide/messengers.md`. `messenger_accounts`-Tabelle aus `schema.py` + `schema.sql` raus, lifespan-Migration droppt sie + `DELETE FROM conversations WHERE channel IN ('signal','telegram')` (FK CASCADE). `CHANNEL_REGISTRY` schrumpft auf `{web, task}`. `websockets`-Dep raus. `signal_url`/`signal_number` aus `config.py`. `build_tool_catalog` verliert `signal_client`/`signal_self_number`/`current_channel`-Params. `_check_messenger` aus diagnostics raus. 858 pytest passing (war 919), ruff + mypy clean. Review-Trail: 1 BLOCKER (40 leftover signal/telegram channel-literals in test fixtures), 1 SHOULD-FIX (mcp_install URL `example.invalid` → `127.0.0.1:1` für fast-fail), 2 NITs aus CodeRabbit (stale comment wording in test docstrings) — alle adressiert.
- **Frontend:** `app/pages/settings/messenger.vue` + `app/composables/useMessenger.ts` + `tests/composables/useMessenger.test.ts` gelöscht. Messenger-Eintrag aus `app/lib/settingsNav.ts` raus. `MessengerAccount*` + `TelegramAccountCreate`-Types aus `api.ts` raus. `app/types/api-generated.ts` regeneriert via `pnpm run gen:api` gegen die Plan-34-BE-Worktree → keine `/api/messenger*`-Endpoints oder MessengerAccount-Schemas mehr. `useChannels.ts` + `EmptyChatState.vue` Doku-Kommentare auf `web, task` getrimmt. `SettingsPlaceholder.test.ts`-Snapshot von 10 auf 9 Nav-Entries geschrumpft. 322 vitest passing, typecheck clean. Review-Trail: 1 BLOCKER aus Explore-Review (orphaned `TelegramAccountCreate`-Interface), adressiert.
- **Ansible:** `signal-cli-rest-api.container.j2` + `signal-data.volume.j2` Templates gelöscht. `signal_url`/`signal_image` aus `defaults/main.yml` raus. `SIGNAL_IMAGE`/`HERMES_SIGNAL_URL`/`HERMES_SIGNAL_NUMBER` aus `env.j2` raus. `After=`/`Wants=signal-cli-rest-api.service` aus `hermes-server.container.j2` raus. `signal_number`-Key aus `secrets.example/haex.cloud.yml` raus. NEUER `deploy_quadlet.yml`-Block (idempotent, `failed_when: false`) stoppt + deaktiviert `signal-cli-rest-api.service`, entfernt die Quadlet-Files und den running container — no-op auf Boxen die Signal nie hatten. `from_scratch.yml` signal-Entries trimmed. `docker-compose.yml.j2` (legacy path) signal-Service + Volume + depends_on raus. Review-Trail: 1 NIT (dead `signal_number` in `secrets.example`) adressiert.

Auf haex.cloud nach dem Ansible-Lauf erwartet: nur noch `hermes-server` + `holzi-claude-proxy` + `traefik` Container. `journalctl --user -u hermes-server.service | grep signal` → leer. `/api/diagnostics` keine `messenger`-Check mehr.

Cross-repo + cross-system (Holzi-Backend + Holzi-Frontend + Ansible). Architektonische Korrektur: Signal-Note-to-Self-via-Linked-Secondary ist durch `signal-cli`'s syncMessage-Filter strukturell blockiert (siehe Quadlet-Template-Kommentar + Memory `reference_signal_linked_secondary_limits`), und Telegram-Bots sind aus Privacy-Gründen für den Use-Case unerwünscht. Statt eine eigene Primary-Signal-Number zu beschaffen oder Telegram zu integrieren wird die gesamte Messenger-Surface entfernt.

Depends on:

- Nichts (rein destruktiv).

Hard-removes / makes obsolete:

- [Plan 28](./28-signal-websocket-receive.md) — Signal-WebSocket-Receive war 2026-06-04 frisch gemerged. Wird als „Obsolet (Messenger entfernt durch Plan 34)" markiert.
- Plan-29-A-Channel-Registry-Erweiterungen: `signal` + `telegram` fliegen aus dem Registry → bleibt `web` + `task`.

## Goal

Den gesamten Messenger-Code-Pfad aus dem Repo + dem Production-Stack entfernen, ohne andere Plan-Familien (Personas, Skills, Workspaces, Sandbox, Approvals) zu touchieren. Nach diesem Plan ist Holzi ein Web-UI- + Geplante-Tasks-Agent — kein Messenger.

## Why

- **Signal:** Note-to-Self funktioniert nur, wenn Holzi eine eigene Primary-Number hat statt Linked-Secondary zu sein. Das ist Hardware + Telco-Kosten + Verifikations-Aufwand, den der User aktuell nicht eingehen will.
- **Telegram:** Privacy-Modell (zentralisiert, Bots nicht e2e) widerspricht Holzi's Privacy-Anspruch.
- **Web-UI** (mit Plan 26 Deep-Links live seit 2026-06-04) ist als Mobile-Surface ausreichend.
- **Code-Rot vermeiden:** Test-Last + Security-Surface des Messenger-Codes ist nicht trivial; soft-deprecate wäre teurer als hard-remove.

## Non-Goals

- **Conversation-Daten der bereits existierenden `signal`/`telegram`-Channels behalten** — wenn welche existieren, droppen (Cascade via FK).
- **Telegram später wieder reinholen** — Plan ist endgültig. Wenn jemand jemals wieder Messenger will, ist das ein neuer Plan auf dem Git-Historien-Stand.
- **Signal-Primary-Number-Variante als Alternativ-Pfad bauen** — wenn der User später umschwenkt, wird das ein separater Plan (28-A oder neue Nummer).
- **Channel-Registry-Refactor** — das `CHANNEL_REGISTRY`-Modell aus Plan 29-A bleibt unverändert (das ist genau dazu gedacht, dass das Set sich ändert).

## Scope

### Backend (`/home/haex/Projekte/Holzi`)

**Code-Löschung:**

- `src/hermes/signal/` (komplette Direktory)
- `src/hermes/telegram/` (komplette Direktory)
- `src/hermes/messenger/` (komplette Direktory — die unifizierte Abstraktion)
- `src/hermes/routes/messenger.py`
- `src/hermes/repository/messenger.py`
- `src/hermes/tools/cross_channel.py` (exposed `_cross_channel_send` nach Signal — komplette Tool-Fähigkeit fällt weg)
- Tests: `test_signal_*`, `test_telegram_*`, `test_messenger_repo.py`, `test_api_messenger.py`, `test_tools_cross_channel.py`

**Schema-Migration:**

- `messenger_accounts`-Tabelle aus `schema.py` + `repository/models.py` entfernen
- DB-Migration on lifespan: `DROP TABLE IF EXISTS messenger_accounts`
- Cleanup: `DELETE FROM conversations WHERE channel IN ('signal', 'telegram')` (CASCADE auf messages + attachments + agent_runs via FK)

**Personas / Channels:**

- `CHANNEL_REGISTRY` in `personas.py`: `signal` + `telegram` Einträge entfernen → bleibt `web` + `task`
- `routes/preferences.py`: schaut ob Channel-Update-Validierung implizit auf die Registry-Keys läuft (sollte automatisch nur web/task akzeptieren)
- `repository/channels.py`: `ensure_seeded` läuft idempotent, alte Rows in der DB werden über die Migration weggeräumt

**Lifespan / Wiring:**

- `main.py`: messenger-router unregister, Signal-Worker + Telegram-Worker Start/Stop entfernen, dependencies in `app.state` entfernen
- `tool_catalog.py`: `build_cross_channel_tools` Call entfernen, signal_client + signal_self_number Parameter weg
- `pyproject.toml`: `websockets`-Dep raus (war nur für Plan 28); `httpx` ggf. prüfen ob noch in messenger-spezifischen Kontexten

**Cross-affected Tests:**

`test_personas_resolver.py`, `test_channels_repo.py`, `test_api_preferences.py`, `test_agent.py`, `test_agent_streaming.py`, `test_api_chat.py`, `test_api_conversations.py`, `test_api_runs.py`, `test_conversations.py`, `test_messages.py`, `test_personas_resolver_with_skills.py`, `test_scheduler.py`, `test_tools_memory.py` — jeden Test der `channel='signal'`/`'telegram'` als Fixture nutzt auf `'web'`/`'task'` umstellen, channel-spezifische Test-Cases entfernen.

### Frontend (`/home/haex/Projekte/holzi-frontend`)

**Code-Löschung:**

- `app/pages/settings/messenger.vue`
- `app/composables/useMessenger.ts`
- `tests/composables/useMessenger.test.ts`

**Nav / UI:**

- `app/lib/settingsNav.ts`: Messenger-Eintrag entfernen
- `app/composables/useChannels.ts`: prüfen ob signal/telegram-spezifische Hilfslogik drin ist
- `app/pages/settings/preferences.vue`: Channel-Cards-Loop ist data-driven aus `/api/channels`, schrumpft automatisch auf web+task — Tests anpassen
- `app/pages/settings/insights.vue`, `app/pages/settings/llm.vue`, `app/pages/settings/tasks.vue`, `app/components/chat/ApprovalCard.vue`: signal/telegram-Referenzen aus UI-Filtern/Badges/Channel-Labeln entfernen
- `app/composables/useChatStream.ts`: prüfen ob channel-spezifische Logik raus muss

**Types / API:**

- Nach BE-Merge: `pnpm run gen:api` → `MessengerAccount*`-Types verschwinden automatisch
- `app/types/api.ts`: explizit benannte Re-Exports für MessengerAccount-Shapes löschen

**Cross-affected Tests:**

- `PreferencesPage.test.ts`, `SkillsPage.test.ts`, `TasksPage.test.ts`, `ApprovalCard.test.ts` — Fixtures + Mocks von messenger-Endpoints + signal/telegram-Channel-Cases entfernen

### Ansible (`/home/haex/Projekte/ansible/roles/holzi/`)

- `templates/quadlet/signal-cli-rest-api.container.j2` löschen
- `templates/quadlet/signal-data.volume.j2` löschen
- `tasks/deploy_quadlet.yml`: die Tasks die diese Templates rendern entfernen
- `defaults/main.yml`: Signal-relatierte Vars entfernen (`holzi.signal_image` etc.)
- `tasks/from_scratch.yml`: prüfen ob Signal-Setup-Step drin ist
- Cleanup-Task hinzufügen: stop + remove signal-cli-rest-api.service auf der Box (Quadlet-Removal entfernt das `.service`-Unit nur beim nächsten daemon-reload, der laufende Container muss explizit gestoppt + gelöscht werden)

### Production (haex.cloud)

Per Ansible-Lauf nach Merge:

```bash
ansible-playbook -i inventory haex.cloud.play.yml \
  --tags 'holzi' \
  --limit haex.cloud -K
```

Erwartete Effekte auf der Box:

- `signal-cli-rest-api.service` stopped + removed
- Container `signal-cli-rest-api` entfernt
- Volume `signal-data.volume` entfernt (oder bewusst behalten als Trash falls jemand das Reverse einrichten will — Vorschlag: behalten, ist klein, zerstören wenn Plan-34-Followup explizit cleanup ist)
- hermes-server gepullt mit dem neuen Image (kein Signal/Telegram-Code mehr)
- `journalctl --user -u hermes-server.service` zeigt keine `signal_*`-Events mehr

### Memory

- `reference_signal_linked_secondary_limits` → behalten als historisches Wissen, aber im Body ergänzen dass Messenger durch Plan 34 entfernt wurde
- MEMORY.md Index → kein neuer Eintrag (negative Plan, kein neues Capability)

## Suggested Implementation

### 1. Plan-Doc auf main committen

Dieser File. Anker für Status + Roadmap-README-Update.

### 2. Backend-PR

- Worktree `Holzi/.worktrees/plan-34-remove-messengers`
- Schema-Migration: DROP-TABLE + DELETE-FROM in der lifespan, Idempotent
- Code-Löschungen + CHANNEL_REGISTRY-Reduce
- Tests anpassen (cross-affected) + alle messenger-Tests löschen
- Full test suite green (Erwartung: ~750 tests, runter von 919)
- ruff + mypy clean

### 3. Frontend-PR (nach BE-Merge)

- Worktree `holzi-frontend/.worktrees/plan-34-remove-messengers`
- `pnpm run gen:api` gegen die frische BE-Box (lokal mit `make up-local-full` nach BE-Image-Rebuild) ODER kurz manuell die generated `MessengerAccount`-Types raus
- Frontend-Code-Löschungen + Cross-affected Tests
- Full vitest + typecheck green

### 4. Ansible-PR

- Worktree `ansible/.worktrees/plan-34-remove-messengers` (falls Ansible-Repo Worktrees nutzt — sonst direkt auf einem feature branch)
- Templates löschen + Deploy-Tasks aktualisieren + Cleanup-Task für die laufende Box
- Ansible-Lint clean

### 5. Production-Deploy

- Nach BE-Image-Rebuild via GHA + nach Frontend-Merge: Ansible-Playbook auf haex.cloud ausführen
- Verifikation: `ssh haex.cloud 'podman ps | grep signal-cli'` → keine Treffer
- Verifikation: `journalctl --user -u hermes-server.service --since "5 min ago" | grep -i signal` → keine Treffer
- Verifikation: `/api/diagnostics` zeigt keinen messenger-Check mehr (oder zeigt ihn als „n/a")

## Open Questions

- **websockets-Dep:** war Plan-28-spezifisch. Wird sonst irgendwo benötigt? → Recon hat nichts gefunden, kann raus.
- **Signal-Data-Volume auf der Box behalten oder zerstören?** → Vorschlag: erstmal behalten (klein, harmlos), explizit zerstören wenn jemand später aufräumt.
- **`reference_signal_linked_secondary_limits` Memory löschen oder behalten?** → Vorschlag: behalten + Body ergänzen — das Wissen ist nicht falsch, nur nicht mehr direkt anwendbar; falls Holzi je wieder Signal will, ist das die Begründungs-History.

## Out of Scope

- Eine Alternative Messenger-Integration einbauen (Matrix, XMPP, eigene Notification-Surface) — wenn jemals, eigener Plan.
- Push-Notifications für die Web-UI (Service-Worker + Web-Push) — eigener Plan.
- Mobile-App / PWA-Verbesserungen — eigener Plan.
