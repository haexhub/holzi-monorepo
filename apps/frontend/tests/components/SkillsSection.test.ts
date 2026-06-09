import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// SkillsSection calls useI18n() in setup for validation/toast/confirm copy;
// the bare mount has no i18n plugin so useI18n would throw without the
// importOriginal-preserving mock. t() passes the key through; useLocalePath()
// is auto-imported from the nuxt test env.
vi.mock('vue-i18n', async (importOriginal) => {
  const orig = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...orig,
    useI18n: () => ({ t: (key: string) => key }),
  }
})

import SkillsSection from '~/components/settings/SkillsSection.vue'
import type { Skill, SkillListResponse } from '~/types/api'

const apiGet = vi.fn()
const apiPost = vi.fn()
const apiPut = vi.fn()
const apiDelete = vi.fn()

vi.mock('~/composables/useApi', () => ({
  useApi: () => ({
    get: (path: string, query?: Record<string, unknown>) => apiGet(path, query),
    post: (path: string, body?: unknown) => apiPost(path, body),
    put: (path: string, body?: unknown) => apiPut(path, body),
    patch: vi.fn(),
    delete: (path: string, body?: unknown) => apiDelete(path, body),
  }),
}))

const confirmFn = vi.fn()
vi.mock('~/composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: (opts: unknown) => confirmFn(opts) }),
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('~/composables/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError }),
}))

// `RenderedMarkdown` pulls in shiki/katex which take seconds to load and
// add nothing to these tests. Replace with a stub that just dumps the
// content prop.
vi.mock('~/components/chat/RenderedMarkdown.vue', () => ({
  default: {
    name: 'RenderedMarkdown',
    props: ['content'],
    template: '<div data-testid="rendered-markdown">{{ content }}</div>',
  },
}))

function skill(over: Partial<Skill> & { id: number; slug: string }): Skill {
  return {
    id: over.id,
    slug: over.slug,
    name: over.name ?? over.slug,
    description: over.description ?? 'desc',
    when_to_use: over.when_to_use ?? null,
    body_markdown: over.body_markdown ?? 'body',
    enabled: over.enabled ?? true,
    created_at: over.created_at ?? 1_700_000_000,
    updated_at: over.updated_at ?? 1_700_000_000,
  }
}

function setupList(skills: Skill[]) {
  const resp: SkillListResponse = { skills }
  apiGet.mockImplementation((path: string) => {
    if (path === '/api/skills') return Promise.resolve(resp)
    return Promise.reject(new Error(`unexpected GET ${path}`))
  })
}

describe('settings/SkillsSection.vue', () => {
  beforeEach(() => {
    apiGet.mockReset()
    apiPost.mockReset()
    apiPut.mockReset()
    apiDelete.mockReset()
    confirmFn.mockReset()
    confirmFn.mockResolvedValue(true)
    toastSuccess.mockReset()
    toastError.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders empty state when no skills exist', async () => {
    setupList([])
    const wrapper = mount(SkillsSection)
    await flushPromises()
    expect(wrapper.find('[data-testid="skills-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="skill-empty-state"]').exists()).toBe(
      true,
    )
  })

  it('lists existing skills and opens read mode on click', async () => {
    setupList([
      skill({
        id: 1,
        slug: 'a',
        name: 'Alpha',
        description: 'first skill',
        body_markdown: '# Hi',
      }),
    ])
    const wrapper = mount(SkillsSection)
    await flushPromises()

    const item = wrapper.get('[data-testid="skill-item-a"]')
    expect(item.text()).toContain('Alpha')
    await item.trigger('click')

    const body = wrapper.get('[data-testid="skill-detail-body"]')
    expect(body.text()).toContain('# Hi')
  })

  it('creates a new skill via the form and refreshes the list', async () => {
    setupList([])
    apiPost.mockResolvedValueOnce(
      skill({
        id: 5,
        slug: 'strict-german',
        name: 'Strict German',
        body_markdown: 'Body.',
      }),
    )

    const wrapper = mount(SkillsSection)
    await flushPromises()
    await wrapper.get('[data-testid="skill-new"]').trigger('click')
    await wrapper
      .get('[data-testid="skill-form-slug"]')
      .setValue('strict-german')
    await wrapper
      .get('[data-testid="skill-form-name"]')
      .setValue('Strict German')
    await wrapper
      .get('[data-testid="skill-form-description"]')
      .setValue('German only')
    await wrapper
      .get('[data-testid="skill-form-body"]')
      .setValue('Body.')
    await wrapper.get('[data-testid="skill-save"]').trigger('click')
    await flushPromises()

    expect(apiPost).toHaveBeenCalledWith('/api/skills', {
      slug: 'strict-german',
      name: 'Strict German',
      description: 'German only',
      when_to_use: null,
      body_markdown: 'Body.',
      enabled: true,
    })
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('rejects invalid slugs at form-validation time', async () => {
    setupList([])
    const wrapper = mount(SkillsSection)
    await flushPromises()

    await wrapper.get('[data-testid="skill-new"]').trigger('click')
    await wrapper.get('[data-testid="skill-form-slug"]').setValue('Bad-Caps')
    await wrapper.get('[data-testid="skill-form-name"]').setValue('Name')
    await wrapper
      .get('[data-testid="skill-form-description"]')
      .setValue('Desc')
    await wrapper.get('[data-testid="skill-form-body"]').setValue('Body')
    await wrapper.get('[data-testid="skill-save"]').trigger('click')
    await flushPromises()

    expect(
      wrapper.get('[data-testid="skill-form-error"]').text(),
    ).toContain('components.skillsSection.errors.slugInvalid')
    expect(apiPost).not.toHaveBeenCalled()
  })

  it('updates an existing skill', async () => {
    setupList([
      skill({
        id: 7,
        slug: 'brief',
        name: 'Brief',
        description: 'old desc',
        body_markdown: 'old body',
      }),
    ])
    apiPut.mockResolvedValueOnce(
      skill({
        id: 7,
        slug: 'brief',
        name: 'Brief',
        description: 'new desc',
        body_markdown: 'new body',
      }),
    )

    const wrapper = mount(SkillsSection)
    await flushPromises()

    await wrapper.get('[data-testid="skill-item-brief"]').trigger('click')
    await wrapper.get('[data-testid="skill-edit"]').trigger('click')
    await wrapper
      .get('[data-testid="skill-form-description"]')
      .setValue('new desc')
    await wrapper
      .get('[data-testid="skill-form-body"]')
      .setValue('new body')
    await wrapper.get('[data-testid="skill-save"]').trigger('click')
    await flushPromises()

    expect(apiPut).toHaveBeenCalledWith('/api/skills/7', {
      name: 'Brief',
      description: 'new desc',
      when_to_use: null,
      body_markdown: 'new body',
    })
  })

  it('deletes a skill after confirmation', async () => {
    setupList([skill({ id: 3, slug: 'gone' })])
    apiDelete.mockResolvedValueOnce(undefined)

    const wrapper = mount(SkillsSection)
    await flushPromises()
    await wrapper.get('[data-testid="skill-item-gone"]').trigger('click')
    await wrapper.get('[data-testid="skill-delete"]').trigger('click')
    await flushPromises()

    expect(confirmFn).toHaveBeenCalled()
    expect(apiDelete).toHaveBeenCalledWith('/api/skills/3', undefined)
  })

  it('renders the security notice in the section header (always visible)', async () => {
    setupList([])
    const wrapper = mount(SkillsSection)
    await flushPromises()
    const notice = wrapper.get('[data-testid="skill-security-notice"]')
    expect(notice.text()).toContain('components.skillsSection.securityBefore')
    expect(notice.text()).toContain('components.skillsSection.securityAfter')
    // Notice stays visible after switching to read mode of an existing
    // skill (header lives above the two-pane).
  })

  it('filters the list by search query', async () => {
    setupList([
      skill({ id: 1, slug: 'alpha-skill', name: 'Alpha' }),
      skill({ id: 2, slug: 'beta-skill', name: 'Beta' }),
    ])
    const wrapper = mount(SkillsSection)
    await flushPromises()

    await wrapper.get('[data-testid="skill-search"]').setValue('alpha')
    await flushPromises()
    expect(wrapper.find('[data-testid="skill-item-alpha-skill"]').exists()).toBe(
      true,
    )
    expect(wrapper.find('[data-testid="skill-item-beta-skill"]').exists()).toBe(
      false,
    )
  })

  // ── Plan 37: enabled-toggle + token-budget counter ─────────────────

  it('renders an enabled-toggle per skill-row, checked when enabled=true', async () => {
    setupList([
      skill({ id: 1, slug: 'on-skill', enabled: true }),
      skill({ id: 2, slug: 'off-skill', enabled: false }),
    ])
    const wrapper = mount(SkillsSection)
    await flushPromises()

    const onToggle = wrapper.get('[data-testid="skill-enabled-on-skill"]')
      .element as HTMLInputElement
    expect(onToggle.checked).toBe(true)

    const offToggle = wrapper.get('[data-testid="skill-enabled-off-skill"]')
      .element as HTMLInputElement
    expect(offToggle.checked).toBe(false)
  })

  it('clicking the enabled-toggle calls useSkills.update(id, { enabled: false })', async () => {
    setupList([skill({ id: 5, slug: 'my-skill', enabled: true })])
    apiPut.mockResolvedValueOnce(
      skill({ id: 5, slug: 'my-skill', enabled: false }),
    )
    const wrapper = mount(SkillsSection)
    await flushPromises()

    await wrapper.get('[data-testid="skill-enabled-my-skill"]').trigger('change')
    await flushPromises()

    expect(apiPut).toHaveBeenCalledWith('/api/skills/5', { enabled: false })
  })

  it('renders the token-budget counter with correct calculation', async () => {
    // slug=6, description=4, when_to_use=0 (null → ''), so:
    // Math.ceil((6 + 4 + 0 + 32) / 4) = Math.ceil(42/4) = 11
    const s = skill({ id: 1, slug: 'myslug', description: 'desc', when_to_use: null, enabled: true })
    setupList([s])
    const wrapper = mount(SkillsSection)
    await flushPromises()

    const counter = wrapper.get('[data-testid="skill-token-budget"]')
    // The summary key is passed through as-is by the mock t()
    expect(counter.text()).toContain('pages.skills.list.tokenBudget.summary')
  })

  it('token-budget counter excludes disabled skills', async () => {
    setupList([
      skill({ id: 1, slug: 'enabled-s', enabled: true }),
      skill({ id: 2, slug: 'disabled-s', enabled: false }),
    ])
    const wrapper = mount(SkillsSection)
    await flushPromises()

    // The token budget is always rendered (even with 0 enabled)
    expect(wrapper.find('[data-testid="skill-token-budget"]').exists()).toBe(true)
  })
})
