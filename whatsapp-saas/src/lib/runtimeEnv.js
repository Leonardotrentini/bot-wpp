/** Config injetada em runtime pelo script em `dist/index.html` (ver `scripts/railway-serve.mjs`). */
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

export function resolveUseRealApi() {
  const rt = getRuntimeVestoEnv()
  if (rt && typeof rt.useRealApi === 'boolean') return rt.useRealApi
  if (import.meta.env.VITE_USE_REAL_API === 'true') return true
  if (import.meta.env.VITE_USE_REAL_API === 'false') return false
  return false
}
