function isProduction() {
  return process.env.NODE_ENV === "production"
}

/** Registro público: desligado em produção salvo ALLOW_PUBLIC_REGISTER=true */
function isPublicRegistrationAllowed() {
  const flag = process.env.ALLOW_PUBLIC_REGISTER?.trim().toLowerCase()
  if (flag === "true") return true
  if (flag === "false") return false
  return !isProduction()
}

function getCorsOrigin() {
  const configured = process.env.FRONTEND_URL?.trim()
  if (configured) return configured
  if (isProduction()) return false
  return "*"
}

function isWebhookSecretConfigured() {
  return Boolean(process.env.EVOLUTION_WEBHOOK_SECRET?.trim())
}

function isValidEvolutionWebhook(req) {
  const expected = process.env.EVOLUTION_WEBHOOK_SECRET?.trim()
  if (!expected) {
    if (isProduction()) return false
    return true
  }
  const received =
    req.query.secret ||
    req.get("x-evolution-secret") ||
    req.get("x-webhook-secret") ||
    req.get("authorization")?.replace(/^Bearer\s+/i, "")
  return received === expected
}

/** Não expor stack/raw de APIs externas ao cliente em produção. */
function sanitizeClientError(err, { error = "ERROR", message, status } = {}) {
  const payload = {
    error: err?.code || error,
    message: message || err?.message || "Erro interno.",
  }
  if (!isProduction()) {
    if (err?.meta) payload.meta = err.meta
    if (err?.details) payload.details = err.details
    if (err?.rawPreview) payload.details = { ...(payload.details || {}), rawPreview: err.rawPreview }
  }
  return { status: status || err?.status || 500, body: payload }
}

function logStartupSecurityChecks() {
  const warnings = []
  if (isProduction()) {
    if (!process.env.FRONTEND_URL?.trim()) warnings.push("FRONTEND_URL não definido — CORS bloqueará browsers.")
    if (!isWebhookSecretConfigured()) warnings.push("EVOLUTION_WEBHOOK_SECRET ausente — webhook Evolution rejeitado.")
    if (!isPublicRegistrationAllowed()) warnings.push("Registro público DESLIGADO (use admin ou ALLOW_PUBLIC_REGISTER=true).")
    const jwt = process.env.JWT_SECRET?.trim() || ""
    if (jwt.length < 32) warnings.push("JWT_SECRET curto — use 32+ caracteres aleatórios.")
  }
  for (const w of warnings) console.warn("[security]", w)
  if (!warnings.length && isProduction()) console.log("[security] Verificações básicas OK.")
}

module.exports = {
  isProduction,
  isPublicRegistrationAllowed,
  getCorsOrigin,
  isWebhookSecretConfigured,
  isValidEvolutionWebhook,
  sanitizeClientError,
  logStartupSecurityChecks,
}
