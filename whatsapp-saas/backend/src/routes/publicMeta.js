/**
 * Rotas públicas Meta — atribuição LP (sem JWT).
 */

const express = require("express")
const { z } = require("zod")
const { prisma } = require("../lib/prisma")
const {
  getIntegrationByPublicKey,
  createAttributionLead,
  isOriginAllowed,
  cleanupExpiredAttributionLeads,
} = require("../lib/metaAttributionLead")

function resolvePublicKey(req) {
  return (
    req.body?.vestoPublicKey ||
    req.body?.publicKey ||
    req.headers["x-vesto-key"] ||
    req.query?.key ||
    ""
  )
}

function createPublicMetaRouter() {
  const router = express.Router()

  async function corsForAttribution(req, res) {
    const origin = req.headers.origin
    const publicKey = resolvePublicKey(req)

    if (!origin) {
      return { ok: false, status: 403, message: "Origin obrigatório." }
    }

    const integration = await getIntegrationByPublicKey(prisma, publicKey)
    if (!integration) {
      return { ok: false, status: 401, message: "Chave pública inválida." }
    }

    if (!integration.allowedOrigins?.length) {
      return {
        ok: false,
        status: 403,
        message: "Configure os domínios da LP em Integrações → Meta antes de usar o script.",
      }
    }

    if (!isOriginAllowed(integration.allowedOrigins, origin)) {
      return { ok: false, status: 403, message: "Domínio não autorizado para esta conta." }
    }

    res.setHeader("Access-Control-Allow-Origin", origin)
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Vesto-Key")
    res.setHeader("Vary", "Origin")
    return { ok: true, integration }
  }

  router.options("/meta/attribution", async (req, res) => {
    const check = await corsForAttribution(req, res)
    if (!check.ok) return res.status(check.status).json({ error: "FORBIDDEN", message: check.message })
    return res.status(204).end()
  })

  router.post("/meta/attribution", async (req, res) => {
    try {
      const check = await corsForAttribution(req, res)
      if (!check.ok) return res.status(check.status).json({ error: "FORBIDDEN", message: check.message })

      const schema = z.object({
        ref: z.string().min(8).max(24),
        fbclid: z.string().max(512).optional().nullable(),
        fbc: z.string().max(512).optional().nullable(),
        fbp: z.string().max(512).optional().nullable(),
        clickAt: z.union([z.number(), z.string()]).optional().nullable(),
        pageUrl: z.string().max(2048).optional().nullable(),
        utm_source: z.string().max(120).optional().nullable(),
        utm_medium: z.string().max(120).optional().nullable(),
        utm_campaign: z.string().max(120).optional().nullable(),
        utm_content: z.string().max(120).optional().nullable(),
        utm_term: z.string().max(120).optional().nullable(),
        vestoPublicKey: z.string().optional(),
        publicKey: z.string().optional(),
      })

      const parsed = schema.safeParse(req.body)
      if (!parsed.success) {
        return res.status(400).json({ error: "VALIDATION_ERROR", message: "Payload inválido." })
      }

      cleanupExpiredAttributionLeads(prisma).catch(() => {})

      const result = await createAttributionLead(prisma, check.integration.userId, parsed.data)
      if (result.error) {
        return res.status(400).json({ error: result.error, message: result.message })
      }

      return res.json({ ok: true, ref: result.ref })
    } catch (err) {
      console.error("[public/meta/attribution]", err)
      return res.status(500).json({ error: "INTERNAL_ERROR", message: "Falha ao registrar atribuição." })
    }
  })

  return router
}

module.exports = { createPublicMetaRouter }
