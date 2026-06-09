import {
  Activity,
  BarChart3,
  Cpu,
  Database,
  FileText,
  FolderTree,
  ListChecks,
  SlidersHorizontal,
  Wrench,
} from 'lucide-vue-next'

export interface SettingsNavItem {
  to: string
  /** i18n key (resolved via `$t(labelKey)` in the template). Plan 30
   *  Wave 0 Task 4a — labels live in `nav.<section>.label`. */
  labelKey: string
  icon: Component
  /** undefined for shipped sections, otherwise the i18n key for the
   *  placeholder hint. */
  upcomingKey?: string
}

export const settingsNav: readonly SettingsNavItem[] = [
  { to: '/settings/llm', labelKey: 'nav.llm.label', icon: Cpu },
  { to: '/settings/preferences', labelKey: 'nav.preferences.label', icon: SlidersHorizontal },
  { to: '/settings/memory', labelKey: 'nav.memory.label', icon: Database },
  { to: '/settings/tasks', labelKey: 'nav.tasks.label', icon: ListChecks },
  { to: '/settings/skills', labelKey: 'nav.skills.label', icon: Wrench },
  { to: '/settings/workspaces', labelKey: 'nav.workspaces.label', icon: FolderTree },
  { to: '/settings/diagnostics', labelKey: 'nav.diagnostics.label', icon: Activity },
  { to: '/settings/insights', labelKey: 'nav.insights.label', icon: BarChart3 },
  { to: '/settings/logs', labelKey: 'nav.logs.label', icon: FileText },
] as const
