/**
 * Etiquetas WhatsApp Business ↔ CRM
 *
 * - QUALIFICADO (kind=qualified): acionamento → tag CRM + LeadQualified → Meta
 * - Cada estágio do Kanban (kind=stage): etiqueta WA → move card no Kanban
 * - Quote / Purchase NÃO usam etiqueta (só formulário no CRM)
 */

const {
  findLabels,
  syncLabels,
  handleLabel,
  setInstanceWebhook,
  bindInstanceHost,
} = require("./evolution")
const {
  QUALIFIED_TAG_NAME,
  isQualifiedTagName,
  ensureDefaultTags,
  tagNameKey,
} = require("./crmDefaults")
const { trackMetaForContactTag } = require("./metaConversions")
const { notifyTagAddedForContact, onStageChange } = require("./crmFlows")
const { logContactActivity } = require("./crmContactActivity")
const { emitCrmEvent, formatConversationRow, CONVERSATION_INCLUDE } = require("./crmCore")
const { phoneDigitsFromValue } = require("./participantIdentity")

const KIND_STAGE = "stage"
const KIND_QUALIFIED = "qualified"
const QUALIFIED_REF = "QUALIFIED"

function normalizeLabelName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
}

function labelNameKey(name) {
  return normalizeLabelName(name).toLowerCase()
}

function pickLabelId(raw) {
  if (!raw || typeof raw !== "object") return null
  const id = raw.id ?? raw.labelId ?? raw.predefinedId
  if (id == null || id === "") return null
  return String(id)
}

function pickLabelName(raw) {
  return normalizeLabelName(raw?.name || raw?.labelName || "")
}

function pickLabelColor(raw) {
  if (raw?.color == null || raw.color === "") return null
  return String(raw.color)
}

function normalizeWaLabels(list) {
  const out = []
  const seen = new Set()
  for (const item of Array.isArray(list) ? list : []) {
    const id = pickLabelId(item)
    const name = pickLabelName(item)
    if (!id || !name) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, name, color: pickLabelColor(item), key: labelNameKey(name) })
  }
  return out
}

async function ensureWebhookLabelEvents(connection) {
  if (!connection?.instanceName) return
  const base = String(process.env.BACKEND_PUBLIC_URL || process.env.PUBLIC_API_URL || "").replace(/\/+$/, "")
  if (!base) return
  // Em produção o secret é obrigatório — sem ele o backend responde 401 e a etiqueta
  // muda no celular sem chegar no CRM.
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim()
  const webhookUrl = secret
    ? `${base}/api/evolution/webhook?secret=${encodeURIComponent(secret)}`
    : `${base}/api/evolution/webhook`
  try {
    bindInstanceHost(connection.instanceName, connection.evolutionHost || "primary")
    await setInstanceWebhook(connection.instanceName, webhookUrl)
  } catch (err) {
    console.warn("[wa-labels] webhook update:", err?.message || err)
  }
}

async function upsertLink(prisma, data) {
  const existingByLabel = await prisma.crmWhatsappLabelLink.findUnique({
    where: {
      connectionId_waLabelId: {
        connectionId: data.connectionId,
        waLabelId: data.waLabelId,
      },
    },
  })
  if (existingByLabel) {
    return prisma.crmWhatsappLabelLink.update({
      where: { id: existingByLabel.id },
      data: {
        kind: data.kind,
        crmRefKey: data.crmRefKey,
        stageId: data.stageId || null,
        waLabelName: data.waLabelName,
        waLabelColor: data.waLabelColor,
        lastSyncedAt: new Date(),
        instanceName: data.instanceName,
        userId: data.userId,
      },
    })
  }

  const existingByRef = await prisma.crmWhatsappLabelLink.findUnique({
    where: {
      connectionId_kind_crmRefKey: {
        connectionId: data.connectionId,
        kind: data.kind,
        crmRefKey: data.crmRefKey,
      },
    },
  })
  if (existingByRef) {
    return prisma.crmWhatsappLabelLink.update({
      where: { id: existingByRef.id },
      data: {
        waLabelId: data.waLabelId,
        waLabelName: data.waLabelName,
        waLabelColor: data.waLabelColor,
        stageId: data.stageId || null,
        lastSyncedAt: new Date(),
        instanceName: data.instanceName,
      },
    })
  }

  try {
    return await prisma.crmWhatsappLabelLink.create({ data })
  } catch (err) {
    // Corrida com LABELS_EDIT auto-sync paralelo
    if (err?.code === "P2002") {
      const again = await prisma.crmWhatsappLabelLink.findUnique({
        where: {
          connectionId_waLabelId: {
            connectionId: data.connectionId,
            waLabelId: data.waLabelId,
          },
        },
      })
      if (again) {
        return prisma.crmWhatsappLabelLink.update({
          where: { id: again.id },
          data: {
            kind: data.kind,
            crmRefKey: data.crmRefKey,
            stageId: data.stageId || null,
            waLabelName: data.waLabelName,
            waLabelColor: data.waLabelColor,
            lastSyncedAt: new Date(),
            instanceName: data.instanceName,
            userId: data.userId,
          },
        })
      }
    }
    throw err
  }
}

/**
 * Sincroniza etiquetas WA com estágios + QUALIFICADO (match por nome).
 * A Evolution não cria labels via API de forma confiável — o usuário cria no app
 * (ou já tem) e aqui vinculamos pelo nome.
 */
async function syncWhatsappLabelsForUser(prisma, userId, { forceResync = true } = {}) {
  await ensureDefaultTags(userId)

  const connection = await prisma.whatsAppConnection.findUnique({ where: { userId } })
  if (!connection?.instanceName) {
    return {
      ok: false,
      error: "NO_CONNECTION",
      message: "Conecte um WhatsApp Business antes de sincronizar etiquetas.",
    }
  }
  if (!connection.connected) {
    return {
      ok: false,
      error: "DISCONNECTED",
      message: "WhatsApp desconectado. Reconecte e tente sincronizar de novo.",
    }
  }

  bindInstanceHost(connection.instanceName, connection.evolutionHost || "primary")
  await ensureWebhookLabelEvents(connection)

  let rawLabels
  try {
    rawLabels = forceResync
      ? await syncLabels(connection.instanceName)
      : await findLabels(connection.instanceName)
  } catch (err) {
    return {
      ok: false,
      error: "EVOLUTION_ERROR",
      message: err?.message || "Falha ao listar etiquetas na Evolution.",
    }
  }

  const waLabels = normalizeWaLabels(rawLabels)
  const stages = await prisma.crmKanbanStage.findMany({
    where: { userId },
    orderBy: { sortOrder: "asc" },
  })

  const usedLabelIds = new Set()
  const linked = []
  const missing = []

  // QUALIFICADO
  const qualifiedWa =
    waLabels.find((l) => isQualifiedTagName(l.name)) ||
    waLabels.find((l) => l.key === "qualificado" || l.key === "lead qualificado")
  if (qualifiedWa) {
    const row = await upsertLink(prisma, {
      userId,
      connectionId: connection.id,
      instanceName: connection.instanceName,
      kind: KIND_QUALIFIED,
      crmRefKey: QUALIFIED_REF,
      stageId: null,
      waLabelId: qualifiedWa.id,
      waLabelName: qualifiedWa.name,
      waLabelColor: qualifiedWa.color,
    })
    usedLabelIds.add(qualifiedWa.id)
    linked.push({ kind: KIND_QUALIFIED, name: QUALIFIED_TAG_NAME, waLabelId: row.waLabelId, waLabelName: row.waLabelName })
  } else {
    missing.push({
      kind: KIND_QUALIFIED,
      name: QUALIFIED_TAG_NAME,
      hint: "Crie no WhatsApp Business uma etiqueta chamada QUALIFICADO e sincronize de novo.",
    })
  }

  // Estágios
  for (const stage of stages) {
    const key = labelNameKey(stage.name)
    const match = waLabels.find((l) => !usedLabelIds.has(l.id) && l.key === key)
    if (match) {
      const row = await upsertLink(prisma, {
        userId,
        connectionId: connection.id,
        instanceName: connection.instanceName,
        kind: KIND_STAGE,
        crmRefKey: stage.id,
        stageId: stage.id,
        waLabelId: match.id,
        waLabelName: match.name,
        waLabelColor: match.color,
      })
      usedLabelIds.add(match.id)
      linked.push({
        kind: KIND_STAGE,
        stageId: stage.id,
        name: stage.name,
        waLabelId: row.waLabelId,
        waLabelName: row.waLabelName,
      })
    } else {
      missing.push({
        kind: KIND_STAGE,
        stageId: stage.id,
        name: stage.name,
        hint: `Crie no WhatsApp uma etiqueta com o nome "${stage.name}" (igual à coluna do Kanban).`,
      })
    }
  }

  // Remove vínculos órfãos desta conexão (estágios apagados / labels trocadas)
  const keepIds = linked.map((l) => l.waLabelId)
  if (keepIds.length) {
    await prisma.crmWhatsappLabelLink.deleteMany({
      where: {
        connectionId: connection.id,
        waLabelId: { notIn: keepIds },
      },
    })
  } else {
    await prisma.crmWhatsappLabelLink.deleteMany({ where: { connectionId: connection.id } })
  }

  return {
    ok: true,
    connection: {
      id: connection.id,
      phone: connection.phone,
      instanceName: connection.instanceName,
      connected: connection.connected,
    },
    waLabelsCount: waLabels.length,
    linked,
    missing,
    message:
      missing.length === 0
        ? "Todas as etiquetas do CRM estão vinculadas ao WhatsApp."
        : `${linked.length} vinculada(s), ${missing.length} pendente(s). Crie as faltantes no WhatsApp Business e sincronize.`,
  }
}

async function getWhatsappLabelsStatus(prisma, userId) {
  await ensureDefaultTags(userId)
  const connection = await prisma.whatsAppConnection.findUnique({ where: { userId } })
  const stages = await prisma.crmKanbanStage.findMany({
    where: { userId },
    orderBy: { sortOrder: "asc" },
  })
  const links = connection
    ? await prisma.crmWhatsappLabelLink.findMany({ where: { connectionId: connection.id } })
    : []

  const byRef = new Map(links.map((l) => [`${l.kind}:${l.crmRefKey}`, l]))

  const qualifiedLink = byRef.get(`${KIND_QUALIFIED}:${QUALIFIED_REF}`) || null
  const stageRows = stages.map((s) => {
    const link = byRef.get(`${KIND_STAGE}:${s.id}`) || null
    return {
      stageId: s.id,
      name: s.name,
      color: s.color,
      linked: Boolean(link),
      waLabelId: link?.waLabelId || null,
      waLabelName: link?.waLabelName || null,
      lastSyncedAt: link?.lastSyncedAt?.toISOString?.() || null,
    }
  })

  return {
    connection: connection
      ? {
          id: connection.id,
          phone: connection.phone,
          instanceName: connection.instanceName,
          connected: connection.connected,
        }
      : null,
    qualified: {
      name: QUALIFIED_TAG_NAME,
      kind: KIND_QUALIFIED,
      effect: "Aplica tag no CRM → dispara LeadQualified → Meta",
      linked: Boolean(qualifiedLink),
      waLabelId: qualifiedLink?.waLabelId || null,
      waLabelName: qualifiedLink?.waLabelName || null,
      lastSyncedAt: qualifiedLink?.lastSyncedAt?.toISOString?.() || null,
    },
    stages: stageRows,
    linkedCount: links.length,
    pendingCount: (qualifiedLink ? 0 : 1) + stageRows.filter((s) => !s.linked).length,
  }
}

async function findConversationByChatJid(prisma, userId, chatJid) {
  const jid = String(chatJid || "").trim()
  if (!jid || jid.endsWith("@g.us")) return null
  const variants = [jid]
  const bare = jid.includes("@") ? jid.split("@")[0] : jid
  if (bare) {
    variants.push(`${bare}@s.whatsapp.net`, `${bare}@lid`, bare)
  }
  const digits = phoneDigitsFromValue(bare)

  let conversation = await prisma.crmConversation.findFirst({
    where: {
      userId,
      OR: [
        { remoteJid: { in: [...new Set(variants)] } },
        ...(digits && digits.length >= 10
          ? [{ contact: { phone: { contains: digits.slice(-10) } } }]
          : []),
      ],
    },
    include: {
      contact: { include: { tags: { include: { tag: true } } } },
    },
  })
  return conversation
}

async function applyQualifiedFromWhatsapp(prisma, io, sendText, { userId, conversation }) {
  if (!conversation?.contactId) return { ok: false, reason: "no-contact" }
  const tag = await ensureDefaultTags(userId)
  const existing = await prisma.crmContactTag.findUnique({
    where: { contactId_tagId: { contactId: conversation.contactId, tagId: tag.id } },
  })
  if (existing) return { ok: true, already: true }

  await prisma.crmContactTag.create({
    data: { contactId: conversation.contactId, tagId: tag.id },
  })
  logContactActivity(prisma, {
    userId,
    contactId: conversation.contactId,
    type: "tag_added",
    payload: { tagId: tag.id, tagName: tag.name, source: "whatsapp_label" },
  }).catch(() => {})

  const contact = await prisma.crmContact.findUnique({
    where: { id: conversation.contactId },
    include: { tags: { include: { tag: true } } },
  })

  let metaTracking = null
  try {
    metaTracking = await trackMetaForContactTag(prisma, {
      userId,
      contact,
      tagName: QUALIFIED_TAG_NAME,
    })
  } catch (err) {
    console.error("[wa-labels] LeadQualified:", err?.message || err)
    metaTracking = { sent: false, error: err?.message || "Falha Meta" }
  }

  if (io && sendText) {
    notifyTagAddedForContact({ prisma, io, sendText }, { userId, contactId: conversation.contactId, tagId: tag.id }).catch(
      (err) => console.error("[wa-labels] tag_added flow:", err?.message || err),
    )
  }

  const refreshed = await prisma.crmConversation.findUnique({
    where: { id: conversation.id },
    include: CONVERSATION_INCLUDE,
  })
  if (refreshed) {
    emitCrmEvent(io, userId, "crm:conversation", { conversation: formatConversationRow(refreshed) })
  }

  return { ok: true, metaTracking }
}

async function applyStageFromWhatsapp(prisma, io, sendText, { userId, conversation, stageId }) {
  if (!conversation || !stageId) return { ok: false }
  if ((conversation.kanbanStageId || null) === stageId) return { ok: true, already: true }

  const stage = await prisma.crmKanbanStage.findFirst({ where: { id: stageId, userId } })
  if (!stage) return { ok: false, reason: "stage-missing" }

  const updated = await prisma.crmConversation.update({
    where: { id: conversation.id },
    data: { kanbanStageId: stageId },
    include: CONVERSATION_INCLUDE,
  })

  if (conversation.contactId) {
    logContactActivity(prisma, {
      userId,
      contactId: conversation.contactId,
      type: "stage_changed",
      payload: { stageId: stage.id, stageName: stage.name, source: "whatsapp_label" },
    }).catch(() => {})
  }

  emitCrmEvent(io, userId, "crm:conversation", { conversation: formatConversationRow(updated) })

  if (io && sendText) {
    onStageChange({ prisma, io, sendText }, { conversation: updated, stageId }).catch((err) =>
      console.error("[wa-labels] stage_change flow:", err?.message || err),
    )
  }

  return { ok: true, stageId: stage.id, stageName: stage.name }
}

/**
 * Extrai action add|remove do payload Evolution.
 * NÃO usar association.type — no Baileys isso é "label_jid" / "label_message".
 */
function resolveLabelAssociationAction(payload) {
  const raw = String(payload?.type || payload?.action || "").toLowerCase().trim()
  if (raw === "remove" || raw === "delete" || raw === "unassociate") return "remove"
  if (raw === "add" || raw === "associate" || raw === "create") return "add"
  // Sem type explícito: eventos de associação sem flag costumam ser "add"
  return "add"
}

/**
 * Webhook LABELS_ASSOCIATION / LABELS_EDIT
 */
async function handleWhatsappLabelsWebhook(prisma, io, sendText, instanceName, event, body) {
  const conn = await prisma.whatsAppConnection.findFirst({ where: { instanceName } })
  if (!conn) return

  if (event === "LABELS_EDIT") {
    // Re-sync leve em background quando o catálogo muda no celular
    syncWhatsappLabelsForUser(prisma, conn.userId, { forceResync: false }).catch((err) =>
      console.warn("[wa-labels] auto-sync after LABELS_EDIT:", err?.message || err),
    )
    return
  }

  if (event !== "LABELS_ASSOCIATION") return

  const payload = body?.data && typeof body.data === "object" ? body.data : body
  const association =
    payload?.association && typeof payload.association === "object" ? payload.association : null
  const action = resolveLabelAssociationAction(payload)
  const labelId = String(
    payload?.labelId ||
      payload?.label_id ||
      association?.labelId ||
      association?.label_id ||
      "",
  ).trim()
  const chatId = String(
    payload?.chatId ||
      payload?.chat_id ||
      association?.chatId ||
      association?.chat_id ||
      association?.jid ||
      "",
  ).trim()

  if (!labelId || !chatId) {
    console.warn("[wa-labels] LABELS_ASSOCIATION sem labelId/chatId", {
      instanceName,
      keys: payload && typeof payload === "object" ? Object.keys(payload).slice(0, 12) : [],
    })
    return
  }

  // Só reage a add (marcar etiqueta). Remove não zera o Kanban sozinho.
  if (action !== "add") {
    console.log(`[wa-labels] ignore ${action} label=${labelId} chat=${chatId}`)
    return
  }

  const link = await prisma.crmWhatsappLabelLink.findFirst({
    where: { connectionId: conn.id, waLabelId: labelId },
  })
  if (!link) {
    console.warn(`[wa-labels] etiqueta ${labelId} sem vínculo CRM (${instanceName})`)
    return
  }

  const conversation = await findConversationByChatJid(prisma, conn.userId, chatId)
  if (!conversation) {
    console.warn("[wa-labels] conversa não encontrada para", chatId)
    return
  }

  if (link.kind === KIND_QUALIFIED) {
    const result = await applyQualifiedFromWhatsapp(prisma, io, sendText, {
      userId: conn.userId,
      conversation,
    })
    console.log(`[wa-labels] QUALIFICADO chat=${chatId}`, result)
    return
  }

  if (link.kind === KIND_STAGE && link.stageId) {
    const result = await applyStageFromWhatsapp(prisma, io, sendText, {
      userId: conn.userId,
      conversation,
      stageId: link.stageId,
    })
    console.log(`[wa-labels] stage→${result?.stageName || "?"} chat=${chatId}`, result)
  }
}

/**
 * Espelha mudança de estágio do CRM → etiqueta no WhatsApp.
 */
async function mirrorStageChangeToWhatsapp(prisma, { userId, conversation, previousStageId, nextStageId }) {
  if (!conversation?.remoteJid || conversation.remoteJid.endsWith("@g.us")) return

  const connection = await prisma.whatsAppConnection.findUnique({ where: { userId } })
  if (!connection?.connected || !connection.instanceName) return

  const links = await prisma.crmWhatsappLabelLink.findMany({
    where: { connectionId: connection.id, kind: KIND_STAGE },
  })
  if (!links.length) return

  bindInstanceHost(connection.instanceName, connection.evolutionHost || "primary")
  const chatJid = conversation.remoteJid

  const prev = previousStageId ? links.find((l) => l.stageId === previousStageId) : null
  const next = nextStageId ? links.find((l) => l.stageId === nextStageId) : null

  try {
    if (prev && (!next || prev.waLabelId !== next.waLabelId)) {
      await handleLabel(connection.instanceName, {
        labelId: prev.waLabelId,
        chatJid,
        action: "remove",
      })
    }
    if (next) {
      await handleLabel(connection.instanceName, {
        labelId: next.waLabelId,
        chatJid,
        action: "add",
      })
    }
  } catch (err) {
    console.warn("[wa-labels] mirror stage→WA:", err?.message || err)
  }
}

/**
 * Quando QUALIFICADO é aplicado no CRM, espelha etiqueta no WA.
 */
async function mirrorQualifiedTagToWhatsapp(prisma, { userId, contact, action = "add" }) {
  const connection = await prisma.whatsAppConnection.findUnique({ where: { userId } })
  if (!connection?.connected || !connection.instanceName) return

  const link = await prisma.crmWhatsappLabelLink.findFirst({
    where: { connectionId: connection.id, kind: KIND_QUALIFIED },
  })
  if (!link) return

  const conversation = await prisma.crmConversation.findFirst({
    where: { userId, contactId: contact.id },
    orderBy: { lastMessageAt: "desc" },
  })
  const chatJid = conversation?.remoteJid || contact.remoteJid
  if (!chatJid || String(chatJid).endsWith("@g.us")) return

  bindInstanceHost(connection.instanceName, connection.evolutionHost || "primary")
  try {
    await handleLabel(connection.instanceName, {
      labelId: link.waLabelId,
      chatJid,
      action: action === "remove" ? "remove" : "add",
    })
  } catch (err) {
    console.warn("[wa-labels] mirror QUALIFICADO→WA:", err?.message || err)
  }
}

module.exports = {
  KIND_STAGE,
  KIND_QUALIFIED,
  QUALIFIED_REF,
  syncWhatsappLabelsForUser,
  getWhatsappLabelsStatus,
  handleWhatsappLabelsWebhook,
  mirrorStageChangeToWhatsapp,
  mirrorQualifiedTagToWhatsapp,
  labelNameKey,
  tagNameKey,
}
