const express = require("express")
const { prisma } = require("../lib/prisma")
const { authMiddleware } = require("../lib/auth")
const { parseReportQuery, buildReportDashboard } = require("../lib/reportDashboard")
const { getMetaIntegrationCredentials } = require("../lib/metaConversions")
const { fetchMetaAdPreview } = require("../lib/metaAds")

function createReportsRouter() {
  const router = express.Router()
  router.use(authMiddleware)

  router.get("/dashboard", async (req, res) => {
    try {
      const scope = req.dataScope
      const query = parseReportQuery(req)
      const data = await buildReportDashboard(scope.userIds, {
        ...query,
        metaOwnerUserId: scope.isOwner ? scope.actorId : req.user.sub,
      })
      return res.json(data)
    } catch (err) {
      console.error("[reports/dashboard]", err)
      return res.status(500).json({
        error: "REPORT_DASHBOARD_FAILED",
        message: err?.message || "Falha ao carregar relatório.",
      })
    }
  })

  /** Prévia visual do anúncio (iframe Meta) — mesmo recurso do botão Prévia no Ads Manager. */
  router.get("/meta/ads/:adId/preview", async (req, res) => {
    try {
      const scope = req.dataScope
      const metaUserId = scope.isOwner ? scope.actorId : req.user.sub
      const integration = await getMetaIntegrationCredentials(prisma, metaUserId)
      if (!integration?.adAccountId && !integration?.accessToken && !integration?.adsAccessToken) {
        return res.status(400).json({
          error: "NOT_CONFIGURED",
          message: "Configure a conta de anúncios Meta antes de ver a prévia.",
        })
      }

      const result = await fetchMetaAdPreview(integration, req.params.adId, {
        adFormat: req.query.format ? String(req.query.format) : undefined,
      })
      if (result.error === "NOT_CONFIGURED" || result.error === "VALIDATION") {
        return res.status(400).json(result)
      }
      if (result.error) {
        return res.status(502).json(result)
      }
      return res.json(result)
    } catch (err) {
      console.error("[reports/meta/ads/preview]", err)
      return res.status(500).json({
        error: "INTERNAL_ERROR",
        message: err?.message || "Falha ao carregar prévia do anúncio.",
      })
    }
  })

  return router
}

module.exports = { createReportsRouter }
