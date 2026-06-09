# Webview Redesign: Vue + Tailwind + shadcn-vue Menu

## Ziel

Das Webview-Menü (Slash-Menu) auf Vue 3 + Tailwind CSS v4 + shadcn-vue umstellen und optisch an eine VS Code-ähnliche Command-Palette angleichen. Submenüs öffnen als überlagernde Panels mit Zurück-Button.

## Tech-Stack

| Schicht | Vorher | Nachher |
|---|---|---|
| Framework | Vanilla TS | Vue 3 |
| Styling | Custom CSS | Tailwind CSS v4 |
| Komponenten | Manuell | shadcn-vue |
| Bundler | tsc | Vite (iife-Format) |

Extension-Host-Code (tsc + rolldown) bleibt unverändert.

## Ordnerstruktur

```
src/webview/
  main.ts                  (Vue-Einstiegspunkt, acquireVsCodeApi hier)
  App.vue                  (Root: Messages + InputArea)
  vite.config.ts
  components/
    SlashMenu.vue           (Popover + Panel-Navigation)
    MessageList.vue
    InputArea.vue
    ToolRow.vue
    panels/
      ModelPanel.vue
      ModePanel.vue
      EffortPanel.vue
      SkillsPanel.vue
```

## Menü-Design

### Hauptmenü

```
┌─────────────────────────┐
│  Switch model...   >    │  → ModelPanel
│  Mode: Ask         >    │  → ModePanel
│  Effort: Medium    >    │  → EffortPanel
│  Thinking          ○    │  Toggle (direkt)
│  Skills            >    │  → SkillsPanel
│  Attach file...         │  direkte Aktion
└─────────────────────────┘
```

### Subpanel (Beispiel Model)

```
┌─────────────────────────┐
│  ← Model                │
│─────────────────────────│
│  ● claude-opus-4.8      │
│    claude-sonnet-4.6    │
│    claude-haiku-4.5     │
└─────────────────────────┘
```

### Navigation

`SlashMenu.vue` hält einen `currentPanel: null | 'model' | 'mode' | 'effort' | 'skills'` State.
- `null` → Hauptmenü rendern
- beliebiger Wert → entsprechendes Panel rendern
- Panel-Wechsel per CSS-Transition (`translate-x`, Tailwind)

## shadcn-vue Komponenten

| Komponente | Verwendet für |
|---|---|
| `Popover` | Menü-Overlay über dem Input |
| `Switch` | Thinking-Toggle |
| `Command` | Modellauswahl mit Suchfunktion |
| `Badge` | Aktive Einstellung im Hauptmenü (z.B. "Ask", "Medium") |

## Build-Pipeline

```json
// package.json scripts (Änderungen)
"compile:webview": "vite build --config src/webview/vite.config.ts",
"dev:webview": "vite build --watch --config src/webview/vite.config.ts"
```

Vite-Config:
- Format: `iife` (kompatibel mit nonce-basiertem `<script>`-Tag)
- Tailwind via PostCSS-Plugin
- Output: `out/webview/main.js` + `out/webview/style.css`

CSP bleibt: `script-src 'nonce-{{NONCE}}'`, `style-src 'unsafe-inline'`
→ CSS wird in `HolziPanel.ts` weiterhin inline injiziert (wie bisher `{{STYLES}}`).

## Kommunikation (unverändert)

`acquireVsCodeApi()` einmal in `main.ts`, dann per Vue `provide/inject` in alle Komponenten.
Alle bestehenden Message-Types (`ToExtension`, `FromExtension`) bleiben identisch.

## Was sich nicht ändert

- `HolziPanel.ts`, `HolziSocket.ts`, `extension.ts`
- Message-Protokoll Webview ↔ Extension
- CSP-Header
- Extension-Host Build (tsc + rolldown)
