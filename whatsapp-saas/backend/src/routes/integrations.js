/**
 * Rotas de integrações (Meta / Facebook).
 */

const express = require("express")
const { z } = require("zod")
const { prisma } = require("../lib/prisma")
const { authMiddleware } = require("../lib/auth")
const {
  getMetaIntegration,
  getMetaIntegrationEnriched,
  upsertMetaIntegration,
  testMetaIntegration,
  getMetaIntegrationCredentials,
  updateMetaLpIntegration,
} = require("../lib/metaConversions")
const { fetchMetaAdsDashboard, testMetaAdsConnection } = require("../lib/metaAds")
const { getGtmIntegration, upsertGtmIntegration } = require("../lib/gtmIntegration")

function createIntegrationsRouter() {
  const router = express.Router()
  router.use(authMiddleware)

  router.use((req, res, next) => {
    if (req.dataScope?.orgRole === "SELLER") {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "Integrações estão disponíveis apenas para o dono da empresa.",
      })
    }
    return next()
  })

  router.get("/", async (req, res) => {
    const meta = await getMetaIntegration(prisma, req.user.sub)
    const gtm = await getGtmIntegration(prisma, req.user.sub)
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
        {
          id: "gtm",
          name: "Google Tag Manager",
          description: "Container GTM para tags na landing page (GA4, Ads, pixels auxiliares).",
          connected: Boolean(gtm?.connected),
          provider: "gtm",
        },
      ],
    })
  })

  router.get("/meta", async (req, res) => {
    const integration = await getMetaIntegrationEnriched(prisma, req.user.sub)
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
      adAccountId: z.string().max(32).optional().nullable(),
      adsAccessToken: z.string().max(512).optional().nullable(),
      adsEnabled: z.boolean().optional(),
      allowedOrigins: z.array(z.string().max(253)).optional(),
      lpWhatsapp: z.string().max(32).optional().nullable(),
      lpWhatsappMsg: z.string().max(500).optional().nullable(),
      lpRotatorMode: z.enum(["sequential"]).optional(),
      lpSellers: z
        .array(
          z.object({
            label: z.string().max(80).optional().nullable(),
            phone: z.string().max(32),
          }),
        )
        .optional(),
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

  router.patch("/meta/lp", async (req, res) => {
    const schema = z.object({
      allowedOrigins: z.array(z.string().max(253)).optional(),
      lpWhatsappMsg: z.string().max(500).optional().nullable(),
      lpRotatorMode: z.enum(["sequential"]).optional(),
      lpSellers: z
        .array(
          z.object({
            label: z.string().max(80).optional().nullable(),
            phone: z.string().max(32),
          }),
        )
        .min(1),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos." })
    }

    const result = await updateMetaLpIntegration(prisma, req.user.sub, parsed.data)
    if (result.error === "NOT_CONFIGURED") {
      return res.status(400).json({ error: result.error, message: result.message })
    }
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

  router.get("/gtm", async (req, res) => {
    const integration = await getGtmIntegration(prisma, req.user.sub)
    return res.json({ integration: integration || null })
  })

  router.put("/gtm", async (req, res) => {
    const conversionTagSchema = z.object({
      key: z.string().max(40),
      enabled: z.boolean().optional(),
      eventName: z.string().max(40).optional(),
      tagName: z.string().max(80).optional().nullable(),
    })
    const schema = z.object({
      containerId: z.string().min(8).max(32),
      enabled: z.boolean().optional(),
      conversionTags: z.array(conversionTagSchema).optional(),
      ga4MeasurementId: z.string().max(32).optional().nullable(),
      ga4ApiSecret: z.string().max(128).optional().nullable(),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Dados inválidos." })
    }

    const result = await upsertGtmIntegration(prisma, req.user.sub, parsed.data)
    if (result.error === "VALIDATION") {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: result.message })
    }

    return res.json({ integration: result.integration })
  })

  router.get("/meta/ads", async (req, res) => {
    try {
      const period = String(req.query.period || "7d")
      const integration = await getMetaIntegrationCredentials(prisma, req.user.sub)
      if (!integration?.adsEnabled) {
        return res.status(400).json({
          error: "NOT_ENABLED",
          message: "Ative a leitura de anúncios e salve a integração.",
        })
      }

      const result = await fetchMetaAdsDashboard(prisma, req.user.sub, integration, { period })
      if (result.error === "NOT_CONFIGURED") {
        return res.status(400).json({ error: result.error, message: result.message })
      }
      if (result.error) {
        return res.status(502).json({ error: result.error, message: result.message })
      }
      return res.json(result)
    } catch (err) {
      console.error("[integrations/meta/ads]", err)
      return res.status(500).json({
        error: "INTERNAL_ERROR",
        message: err?.message || "Falha ao carregar dados de anúncios.",
      })
    }
  })

  router.post("/meta/ads/test", async (req, res) => {
    try {
      const integration = await getMetaIntegrationCredentials(prisma, req.user.sub)
      if (!integration) {
        return res.status(400).json({ error: "NOT_CONFIGURED", message: "Salve a integração Meta antes de testar." })
      }

      const result = await testMetaAdsConnection(prisma, req.user.sub, integration)
      if (result.error === "NOT_CONFIGURED") {
        return res.status(400).json({ error: result.error, message: result.message })
      }
      if (result.error) {
        return res.status(502).json({ error: result.error, message: result.message })
      }
      return res.json(result)
    } catch (err) {
      console.error("[integrations/meta/ads/test]", err)
      return res.status(500).json({
        error: "INTERNAL_ERROR",
        message: err?.message || "Falha ao testar conta de anúncios.",
      })
    }
  })

  return router
}

module.exports = { createIntegrationsRouter }
