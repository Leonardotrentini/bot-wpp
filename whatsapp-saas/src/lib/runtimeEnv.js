/** Config injetada em runtime pelo script em `dist/index.html` (ver `scripts/railway-serve.mjs`). */
export function getRuntimeVestoEnv() {
  if (typeof window === 'undefined') return null
  return window.__VESTO_ENV__ ?? null
}

export function resolveApiBaseURL() {
  const v = import.meta.env.VITE_API_URL
  if (v) return String(v).replace(/\/+$/, '')
  const rt = getRuntimeVestoEnv()?.apiBase
  if (rt) return String(rt).replace(/\/+$/, '')
  return 'http://localhost:4000/api'
}

export function resolveUseRealApi() {
  if (import.meta.env.VITE_USE_REAL_API === 'true') return true
  if (import.meta.env.VITE_USE_REAL_API === 'false') return false
  const rt = getRuntimeVestoEnv()
  if (rt?.useRealApi === true) return true
  if (rt?.useRealApi === false) return false
  return false
}
