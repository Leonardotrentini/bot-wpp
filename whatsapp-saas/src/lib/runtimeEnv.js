/** Config injetada em runtime pelo script em `dist/index.html` (ver `scripts/railway-serve.mjs`). */

/** Origem pública do backend (script vesto-attribution.js fica na raiz, não em /api). */
export const DEFAULT_BACKEND_ORIGIN = 'https://backend-production-7a466.up.railway.app'

export function getRuntimeVestoEnv() {
  if (typeof window === 'undefined') return null
  return window.__VESTO_ENV__ ?? null
}

export function resolveApiBaseURL() {
  const rt = getRuntimeVestoEnv()
  const fromInject = rt && typeof rt.apiBase === 'string' && rt.apiBase.trim()
  if (fromInject) return fromInject.replace(/\/+$/, '')
  const v = import.meta.env.VITE_API_URL
  if (v) return String(v).replace(/\/+$/, '')
  return 'http://localhost:4000/api'
}

/** URL base do backend sem /api — usada no script da LP. */
export function resolveBackendOrigin() {
  const apiBase = resolveApiBaseURL()
  if (/^https?:\/\//i.test(apiBase)) {
    const withoutApi = apiBase.replace(/\/api\/?$/i, '')
    if (withoutApi && withoutApi !== '/api' && !withoutApi.endsWith('/api')) {
      return withoutApi.replace(/\/+$/, '')
    }
    try {
      return new URL(apiBase).origin
    } catch {
      return DEFAULT_BACKEND_ORIGIN
    }
  }
  return DEFAULT_BACKEND_ORIGIN
}

export function resolveUseRealApi() {
  const rt = getRuntimeVestoEnv()
  if (rt && typeof rt.useRealApi === 'boolean') return rt.useRealApi
  if (import.meta.env.VITE_USE_REAL_API === 'true') return true
  if (import.meta.env.VITE_USE_REAL_API === 'false') return false
  return import.meta.env.PROD === true
}
