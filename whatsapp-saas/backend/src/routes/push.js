const express = require("express")
const { authMiddleware } = require("../lib/auth")
const {
  getVapidPublicKey,
  ensureWebPushConfigured,
  upsertPushSubscription,
  removePushSubscription,
  countPushSubscriptions,
} = require("../lib/webPush")

function createPushRouter() {
  const router = express.Router()

  router.get("/vapid-public-key", (_req, res) => {
    const publicKey = getVapidPublicKey()
    if (!publicKey || !ensureWebPushConfigured()) {
      return res.status(503).json({
        error: "PUSH_NOT_CONFIGURED",
        message: "Notificações push ainda não estão configuradas neste servidor.",
      })
    }
    return res.json({ publicKey })
  })

  router.get("/status", authMiddleware, async (req, res) => {
    const configured = Boolean(getVapidPublicKey() && ensureWebPushConfigured())
    const count = configured ? await countPushSubscriptions(req.user.sub) : 0
    return res.json({ configured, subscribed: count > 0, devices: count })
  })

  router.post("/subscribe", authMiddleware, async (req, res) => {
    if (!ensureWebPushConfigured()) {
      return res.status(503).json({
        error: "PUSH_NOT_CONFIGURED",
        message: "Notificações push ainda não estão configuradas neste servidor.",
      })
    }
    try {
      const row = await upsertPushSubscription(
        req.user.sub,
        req.body?.subscription || req.body,
        req.headers["user-agent"] || null,
      )
      return res.json({ ok: true, id: row.id })
    } catch (err) {
      if (err?.code === "INVALID_SUBSCRIPTION") {
        return res.status(400).json({ error: "INVALID_SUBSCRIPTION", message: err.message })
      }
      console.error("[push] subscribe:", err?.message || err)
      return res.status(500).json({ error: "SUBSCRIBE_FAILED", message: "Falha ao registrar notificações." })
    }
  })

  router.post("/unsubscribe", authMiddleware, async (req, res) => {
    const endpoint = req.body?.endpoint || req.body?.subscription?.endpoint
    const result = await removePushSubscription(req.user.sub, endpoint)
    return res.json({ ok: true, ...result })
  })

  return router
}

module.exports = { createPushRouter }
