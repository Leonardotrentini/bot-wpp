/**
 * Chave de IA da empresa — cifrada em repouso. Nunca devolver o token completo.
 */

const crypto = require("crypto")

function secretKey() {
  const secret = process.env.AI_CREDENTIALS_SECRET || process.env.JWT_SECRET
  if (!secret) {
    const err = new Error("JWT_SECRET ausente para cifrar a chave de IA.")
    err.code = "AI_SECRET_MISSING"
    throw err
  }
  return crypto.createHash("sha256").update(String(secret)).digest()
}

function encryptApiKey(plain) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey(), iv)
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString("base64")
}

function decryptApiKey(payload) {
  const buf = Buffer.from(String(payload || ""), "base64")
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = crypto.createDecipheriv("aes-256-gcm", secretKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8")
}

function last4(apiKey) {
  const s = String(apiKey || "")
  return s.slice(-4)
}

function publicAiStatus(row) {
  if (!row?.apiKeyEnc) return { configured: false, last4: null, baseUrl: "https://api.openai.com/v1" }
  return {
    configured: true,
    last4: row.apiKeyLast4 || null,
    baseUrl: row.baseUrl || "https://api.openai.com/v1",
  }
}

async function resolveOrgAiClient(prisma, organizationId) {
  if (!organizationId) return { configured: false, apiKey: null, baseUrl: null }
  const row = await prisma.organizationAiConfig.findUnique({ where: { organizationId } })
  if (!row?.apiKeyEnc) return { configured: false, apiKey: null, baseUrl: row?.baseUrl || null }
  return {
    configured: true,
    apiKey: decryptApiKey(row.apiKeyEnc),
    baseUrl: String(row.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, ""),
    last4: row.apiKeyLast4,
  }
}

module.exports = {
  encryptApiKey,
  decryptApiKey,
  last4,
  publicAiStatus,
  resolveOrgAiClient,
}
