/**
 * Web Push (PWA) — envio de notificações com app fechado / tela bloqueada.
 *
 * Env:
 * - VAPID_PUBLIC_KEY
 * - VAPID_PRIVATE_KEY
 * - VAPID_SUBJECT (mailto: ou https:)
 */
const webpush = require("web-push")
const { prisma } = require("./prisma")

let configured = false

function getVapidConfig() {
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || "").trim()
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || "").trim()
  const subject = String(process.env.VAPID_SUBJECT || "mailto:suporte@vestogroup.com").trim()
  if (!publicKey || !privateKey) return null
  return { publicKey, privateKey, subject }
}

function ensureWebPushConfigured() {
  if (configured) return true
  const cfg = getVapidConfig()
  if (!cfg) return false
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey)
  configured = true
  return true
}

function getVapidPublicKey() {
  return getVapidConfig()?.publicKey || null
}

function previewBody(message, conversation) {
  if (conversation?.lastMessagePreview) return String(conversation.lastMessagePreview).slice(0, 120)
  const body = String(message?.body || "").trim()
  if (body) return body.slice(0, 120)
  const kind = String(message?.mediaKind || message?.type || "").toLowerCase()
  if (kind.includes("image") || kind === "image") return "📷 Imagem"
  if (kind.includes("audio") || kind === "audio" || kind.includes("ptt")) return "🎤 Áudio"
  if (kind.includes("video") || kind === "video") return "🎬 Vídeo"
  if (kind.includes("document") || kind === "document") return "📄 Documento"
  return "Nova mensagem"
}

function contactTitle(conversation) {
  const c = conversation?.contact
  const name = String(c?.name || c?.pushName || c?.savedName || "").trim()
  if (name) return name
  const phone = String(c?.phone || "").trim()
  if (phone) return phone
  return "Nova mensagem"
}

async function sendPushToUser(userId, { title, body, tag, data } = {}) {
  if (!userId || !ensureWebPushConfigured()) return { sent: 0, skipped: true }

  const rows = await prisma.pushSubscription.findMany({ where: { userId } })
  if (!rows.length) return { sent: 0 }

  const payload = JSON.stringify({
    title: title || "Vesto",
    body: body || "",
    tag: tag || undefined,
    data: data || {},
  })

  let sent = 0
  const staleIds = []

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          payload,
          { TTL: 60 * 60 * 12, urgency: "high" },
        )
        sent += 1
      } catch (err) {
        const status = err?.statusCode || err?.status
        if (status === 404 || status === 410) {
          staleIds.push(row.id)
        } else {
          console.warn("[web-push] send failed:", status || err?.message || err)
        }
      }
    }),
  )

  if (staleIds.length) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: staleIds } } }).catch(() => {})
  }

  return { sent, stale: staleIds.length }
}

/** Notifica inbox do user quando chega mensagem inbound (webhook). */
async function notifyCrmInboundPush(userId, { conversation, message } = {}) {
  if (!userId || !message || message.fromMe) return null
  const source = String(message.source || "")
  if (source && source !== "webhook") return null

  const conversationId = conversation?.id || message.conversationId
  if (!conversationId) return null

  return sendPushToUser(userId, {
    title: contactTitle(conversation),
    body: previewBody(message, conversation),
    tag: `crm-${conversationId}`,
    data: {
      url: `/dashboard/chat?c=${encodeURIComponent(conversationId)}`,
      conversationId,
      type: "crm_message",
    },
  })
}

async function upsertPushSubscription(userId, subscription, userAgent = null) {
  const endpoint = String(subscription?.endpoint || "").trim()
  const p256dh = String(subscription?.keys?.p256dh || "").trim()
  const auth = String(subscription?.keys?.auth || "").trim()
  if (!userId || !endpoint || !p256dh || !auth) {
    const err = new Error("Subscription inválida.")
    err.code = "INVALID_SUBSCRIPTION"
    throw err
  }

  return prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      userId,
      endpoint,
      p256dh,
      auth,
      userAgent: userAgent ? String(userAgent).slice(0, 400) : null,
    },
    update: {
      userId,
      p256dh,
      auth,
      userAgent: userAgent ? String(userAgent).slice(0, 400) : null,
    },
  })
}

async function removePushSubscription(userId, endpoint) {
  const ep = String(endpoint || "").trim()
  if (!ep) return { deleted: 0 }
  const result = await prisma.pushSubscription.deleteMany({
    where: { userId, endpoint: ep },
  })
  return { deleted: result.count }
}

async function countPushSubscriptions(userId) {
  return prisma.pushSubscription.count({ where: { userId } })
}

module.exports = {
  getVapidPublicKey,
  ensureWebPushConfigured,
  sendPushToUser,
  notifyCrmInboundPush,
  upsertPushSubscription,
  removePushSubscription,
  countPushSubscriptions,
}
