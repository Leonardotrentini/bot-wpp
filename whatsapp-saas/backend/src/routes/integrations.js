/**
 * Rotas de integrações (Meta / Facebook).
 */

const express = require("express")
const { z } = require("zod")
const { prisma } = require("../lib/prisma")
const { authMiddleware } = require("../lib/auth")
const {
  getMetaIntegration,
  upsertMetaIntegration,
  testMetaIntegration,
} = require("../lib/metaConversions")

function createIntegrationsRouter() {
  const router = express.Router()
  router.use(authMiddleware)

  router.get("/", async (req, res) => {
    const meta = await getMetaIntegration(prisma, req.user.sub)
    return res.json({
      integrations: [
        {
          id: "meta",
          name: "Meta (Facebook)",
          description:
            "Envia o funil WhatsApp (ConversationStarted, LeadQualified, Quote, Purchase) para o Pixel via API de Conversões.",
          connected: Boolean(meta?.connected),
          provider: "meta",
        },
      ],
    })
  })

  router.get("/meta", async (req, res) => {
    const integration = await getMetaIntegration(prisma, req.user.sub)
    return res.json({ integration: integration || null })
  })

  router.put("/meta", async (req, res) => {
    const schema = z.object({
      pixelId: z.string().min(5).max(32),
      accessToken: z.string().max(512).optional().nullable(),
      facebookPageId: z.string().max(32).optional().nullable(),
      enabled: z.boolean().optional(),
      sendQuotes: z.boolean().optional(),
      sendPurchases: z.boolean().optional(),
      testEventCode: z.string().max(64).optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos." })
    }

    const result = await upsertMetaIntegration(prisma, req.user.sub, parsed.data)
    if (result.error === "VALIDATION") {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: result.message })
    }

    return res.json({ integration: result.integration })
  })

  router.post("/meta/test", async (req, res) => {
    const result = await testMetaIntegration(prisma, req.user.sub)
    if (result.error === "NOT_CONFIGURED") {
      return res.status(400).json({ error: result.error, message: result.message })
    }
    if (result.error) {
      return res.status(502).json({ error: result.error, message: result.message })
    }
    return res.json(result)
  })

  return router
}

module.exports = { createIntegrationsRouter }
