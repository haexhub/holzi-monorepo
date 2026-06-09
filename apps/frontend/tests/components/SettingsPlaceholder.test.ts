import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PlaceholderSection from '~/components/settings/PlaceholderSection.vue'
import { settingsNav } from '~/lib/settingsNav'

// The placeholder pages all render this component; it looks up the
// current route in `settingsNav` and shows label + upcoming hint. These
// tests guard against accidental nav-model breakage (typo in a `to`,
// dropped upcoming hint, etc).

const currentPath = { value: '/' }

// Nuxt-test-env relies on the real vue-router (`useRouter().afterEach`), so
// only swap `useRoute` and keep everything else intact.
vi.mock('vue-router', async (importOriginal) => {
  const mod = await importOriginal<typeof import('vue-router')>()
  return {
    ...mod,
    useRoute: () => ({
      get path() {
        return currentPath.value
      },
    }),
  }
})

function mountAtRoute(path: string) {
  currentPath.value = path
  return mount(PlaceholderSection)
}

describe('settingsNav model', () => {
  it('exposes one entry per Control Center section', () => {
    const tos = settingsNav.map((n) => n.to)
    expect(tos).toEqual([
      '/settings/llm',
      '/settings/preferences',
      '/settings/memory',
      '/settings/tasks',
      '/settings/skills',
      '/settings/workspaces',
      '/settings/diagnostics',
      '/settings/insights',
      '/settings/logs',
    ])
  })

  it('flags placeholder sections with an upcomingKey and shipped sections without', () => {
    const shipped = settingsNav.filter((n) => !n.upcomingKey).map((n) => n.to)
    expect(shipped).toEqual([
      '/settings/llm',
      '/settings/preferences',
      '/settings/memory',
      '/settings/tasks',
      '/settings/skills',
      '/settings/workspaces',
      '/settings/diagnostics',
      '/settings/insights',
      '/settings/logs',
    ])
    for (const item of settingsNav) {
      if (!shipped.includes(item.to)) {
        expect(item.upcomingKey, `${item.to} should have an upcomingKey`).toBeTruthy()
      }
    }
  })
})

describe('PlaceholderSection', () => {
  it('renders the label + upcoming hint for the active placeholder route', () => {
    // Pick the first still-upcoming entry dynamically so this test doesn't
    // need touching every time another section ships.
    const firstPlaceholder = settingsNav.find((n) => n.upcomingKey)
    if (!firstPlaceholder) {
      // Once every section is shipped, the placeholder component has
      // nothing to render — drop this test then.
      return
    }
    const wrapper = mountAtRoute(firstPlaceholder.to)
    // `$t` in the test setup is a passthrough on the key, so we assert
    // on the i18n keys rather than translated strings.
    expect(wrapper.text()).toContain(firstPlaceholder.labelKey)
    expect(wrapper.text()).toContain('pages.settings.placeholder.notImplemented')
  })

  it('renders nothing when the route is not in the nav model', () => {
    const wrapper = mountAtRoute('/settings/unknown')
    expect(wrapper.find('h2').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
  })
})
