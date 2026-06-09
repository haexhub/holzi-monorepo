import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  loading: vi.fn(),
  promise: vi.fn(),
  dismiss: vi.fn(),
}))

vi.mock('vue-sonner', () => ({ toast: mocks }))

import { useToast } from '~/composables/useToast'

describe('useToast', () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset()
  })

  it('forwards success/error/info/warning/loading with a 4s default duration', () => {
    const toast = useToast()

    toast.success('saved')
    toast.error('boom')
    toast.info('ping')
    toast.warning('careful')
    toast.loading('working')

    expect(mocks.success).toHaveBeenCalledWith('saved', { duration: 4000 })
    expect(mocks.error).toHaveBeenCalledWith('boom', { duration: 4000 })
    expect(mocks.info).toHaveBeenCalledWith('ping', { duration: 4000 })
    expect(mocks.warning).toHaveBeenCalledWith('careful', { duration: 4000 })
    expect(mocks.loading).toHaveBeenCalledWith('working', { duration: 4000 })
  })

  it('lets call-site options override the default duration', () => {
    useToast().error('keep this up', { duration: 10_000, id: 'sticky' })
    expect(mocks.error).toHaveBeenCalledWith('keep this up', {
      duration: 10_000,
      id: 'sticky',
    })
  })

  it('re-exports promise and dismiss directly', () => {
    const toast = useToast()
    expect(toast.promise).toBe(mocks.promise)
    expect(toast.dismiss).toBe(mocks.dismiss)
  })
})
