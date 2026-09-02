/**
 * Base de conhecimento do agente — texto inline + chunks (PDF/texto).
 */

const MAX_KNOWLEDGE_CHARS = Number(process.env.CRM_AI_MAX_KNOWLEDGE_CHARS || 12000)
const MAX_PDF_BYTES = 5 * 1024 * 1024

async function loadKnowledgeChunks(prisma, agentId) {
  return prisma.crmAiAgentKnowledge.findMany({
    where: { agentId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, type: true, contentText: true },
  })
}

function trimKnowledgeText(text) {
  const raw = String(text || "").trim()
  if (!raw) return ""
  if (raw.length <= MAX_KNOWLEDGE_CHARS) return raw
  return `${raw.slice(0, MAX_KNOWLEDGE_CHARS)}\n\n[… conteúdo truncado por limite de ${MAX_KNOWLEDGE_CHARS} caracteres]`
}

async function extractPdfText(buffer) {
  try {
    const pdfParse = require("pdf-parse")
    const data = await pdfParse(buffer)
    return String(data?.text || "").trim()
  } catch (err) {
    if (err?.code === "MODULE_NOT_FOUND") {
      throw new Error("Suporte a PDF indisponível no servidor (pdf-parse). Cole o texto manualmente.")
    }
    throw err
  }
}

async function parseKnowledgeUpload({ name, type, contentText, base64, mimeType }) {
  const label = String(name || "Documento").trim().slice(0, 120) || "Documento"
  const kind = String(type || "text").trim()

  if (kind === "text") {
    const text = trimKnowledgeText(contentText)
    if (!text) throw new Error("Texto vazio.")
    return { name: label, type: "text", contentText: text, mimeType: mimeType || "text/plain", fileSize: text.length }
  }

  if (kind === "pdf") {
    if (!base64) throw new Error("Arquivo PDF ausente.")
    const buffer = Buffer.from(String(base64), "base64")
    if (buffer.length > MAX_PDF_BYTES) {
      throw new Error(`PDF maior que ${Math.round(MAX_PDF_BYTES / 1024 / 1024)}MB.`)
    }
    const text = trimKnowledgeText(await extractPdfText(buffer))
    if (!text) throw new Error("Não foi possível extrair texto do PDF.")
    return {
      name: label,
      type: "pdf",
      contentText: text,
      mimeType: mimeType || "application/pdf",
      fileSize: buffer.length,
    }
  }

  throw new Error("Tipo de conhecimento inválido.")
}

module.exports = {
  MAX_KNOWLEDGE_CHARS,
  MAX_PDF_BYTES,
  loadKnowledgeChunks,
  trimKnowledgeText,
  parseKnowledgeUpload,
}
