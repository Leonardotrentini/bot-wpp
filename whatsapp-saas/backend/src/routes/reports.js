const express = require("express")
const { authMiddleware } = require("../lib/auth")
const { parseReportQuery, buildReportDashboard } = require("../lib/reportDashboard")

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

  return router
}

module.exports = { createReportsRouter }
