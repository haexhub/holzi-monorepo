import { toast as sonner, type ExternalToast } from 'vue-sonner'

const DEFAULT_DURATION_MS = 4000

function withDefaults(options?: ExternalToast): ExternalToast {
  return { duration: DEFAULT_DURATION_MS, ...(options ?? {}) }
}

export function useToast() {
  return {
    success(message: string, options?: ExternalToast) {
      return sonner.success(message, withDefaults(options))
    },
    error(message: string, options?: ExternalToast) {
      return sonner.error(message, withDefaults(options))
    },
    info(message: string, options?: ExternalToast) {
      return sonner.info(message, withDefaults(options))
    },
    warning(message: string, options?: ExternalToast) {
      return sonner.warning(message, withDefaults(options))
    },
    loading(message: string, options?: ExternalToast) {
      return sonner.loading(message, withDefaults(options))
    },
    promise: sonner.promise,
    dismiss: sonner.dismiss,
  }
}

export type Toaster = ReturnType<typeof useToast>
