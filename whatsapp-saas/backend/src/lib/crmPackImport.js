/**
 * Importação de packs CRM (tags + estágios + fluxos) via JSON.
 * Referências por key/name — nunca por cuid de outra conta.
 */

const { normalizeTrigger } = require("./crmFlows")

const COLOR_RE = /^#[0-9a-fA-F]{6}$/
const KEY_RE = /^[a-z0-9_]{1,40}$/

const TRIGGER_TYPES = new Set([
  "new_conversation",
  "keyword",
  "no_reply",
  "stage_change",
  "tag_added",
  "contact_reply",
])

const ACTION_TYPES = new Set([
  "send_message",
  "add_tag",
  "remove_tag",
  "move_stage",
  "assign_ai",
  "set_status",
])

function slugKey(raw, fallback) {
  const base = String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
  return base || fallback
}

function normalizeColor(value, fallback = "#64748b") {
  const c = String(value || "").trim()
  return COLOR_RE.test(c) ? c : fallback
}

function validatePackShape(pack) {
  if (!pack || typeof pack !== "object" || Array.isArray(pack)) {
    return "Pack inválido: esperado um objeto JSON."
  }
  if (pack.kind !== "vesto_crm_pack") {
    return 'Pack inválido: "kind" deve ser "vesto_crm_pack".'
  }
  if (Number(pack.version) !== 1) {
    return 'Pack inválido: "version" deve ser 1.'
  }
  if (!Array.isArray(pack.tags)) return 'Pack inválido: "tags" deve ser array.'
  if (!Array.isArray(pack.stages)) return 'Pack inválido: "stages" deve ser array.'
  if (!Array.isArray(pack.flows)) return 'Pack inválido: "flows" deve ser array.'
  if (pack.tags.length > 50) return "Máximo de 50 tags por pack."
  if (pack.stages.length > 30) return "Máximo de 30 estágios por pack."
  if (pack.flows.length > 30) return "Máximo de 30 fluxos por pack."
  return null
}

function normalizeTagDefs(rawTags) {
  const out = []
  const used = new Set()
  for (let i = 0; i < rawTags.length; i += 1) {
    const row = rawTags[i] || {}
    const name = String(row.name || "").trim().slice(0, 40)
    if (!name) throw new Error(`tags[${i}]: informe "name".`)
    let key = String(row.key || "").trim().toLowerCase()
    if (!key) key = slugKey(name, `tag_${i + 1}`)
    if (!KEY_RE.test(key)) throw new Error(`tags[${i}]: "key" inválida (${key}). Use a-z, 0-9 e _.`)
    if (used.has(key)) throw new Error(`tags[${i}]: key duplicada "${key}".`)
    used.add(key)
    out.push({ key, name, color: normalizeColor(row.color, "#22c55e") })
  }
  return out
}

function normalizeStageDefs(rawStages) {
  const out = []
  const used = new Set()
  let defaultSeen = false
  for (let i = 0; i < rawStages.length; i += 1) {
    const row = rawStages[i] || {}
    const name = String(row.name || "").trim().slice(0, 40)
    if (!name) throw new Error(`stages[${i}]: informe "name".`)
    let key = String(row.key || "").trim().toLowerCase()
    if (!key) key = slugKey(name, `stage_${i + 1}`)
    if (!KEY_RE.test(key)) throw new Error(`stages[${i}]: "key" inválida (${key}).`)
    if (used.has(key)) throw new Error(`stages[${i}]: key duplicada "${key}".`)
    used.add(key)
    const isDefault = Boolean(row.isDefault) && !defaultSeen
    if (isDefault) defaultSeen = true
    out.push({
      key,
      name,
      color: normalizeColor(row.color, "#64748b"),
      isDefault,
      sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : i,
    })
  }
  out.sort((a, b) => a.sortOrder - b.sortOrder)
  return out
}

function resolveTagId(map, key, ctx) {
  const id = map.get(String(key || ""))
  if (!id) throw new Error(`${ctx}: tagKey "${key}" não existe no pack.`)
  return id
}

function resolveStageId(map, key, ctx) {
  const id = map.get(String(key || ""))
  if (!id) throw new Error(`${ctx}: stageKey "${key}" não existe no pack.`)
  return id
}

function compileTrigger(raw, tagByKey, stageByKey, flowName) {
  const type = String(raw?.type || "")
  if (!TRIGGER_TYPES.has(type)) throw new Error(`Fluxo "${flowName}": trigger.type inválido.`)

  if (type === "new_conversation") return { type }

  if (type === "keyword") {
    const keywords = Array.isArray(raw.keywords)
      ? raw.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 20)
      : []
    if (!keywords.length) throw new Error(`Fluxo "${flowName}": keyword exige keywords.`)
    return {
      type,
      keywords,
      matchMode: raw.matchMode === "exact" ? "exact" : "contains",
    }
  }

  if (type === "no_reply") {
    const delayUnit = raw.delayUnit === "minutes" ? "minutes" : "hours"
    const delayValue = Math.max(1, Math.min(43200, Number(raw.delayValue) || (delayUnit === "minutes" ? 60 : 24)))
    const minutes = delayUnit === "minutes" ? delayValue : delayValue * 60
    return { type, delayUnit, delayValue, minutes, hours: Math.ceil(minutes / 60) }
  }

  if (type === "stage_change") {
    const out = { type, stageId: null }
    if (raw.stageKey) out.stageId = resolveStageId(stageByKey, raw.stageKey, `Fluxo "${flowName}"`)
    return out
  }

  if (type === "tag_added") {
    const tagKey = raw.tagKey || raw.tag_key
    if (!tagKey) throw new Error(`Fluxo "${flowName}": tag_added exige tagKey.`)
    return { type, tagId: resolveTagId(tagByKey, tagKey, `Fluxo "${flowName}"`) }
  }

  if (type === "contact_reply") {
    const rawKeys = Array.isArray(raw.tagKeys) ? raw.tagKeys : Array.isArray(raw.conditionTags) ? raw.conditionTags : []
    const tagIds = [
      ...new Set(rawKeys.map((k) => resolveTagId(tagByKey, k, `Fluxo "${flowName}"`))),
    ]
    if (!tagIds.length) throw new Error(`Fluxo "${flowName}": contact_reply exige tagKeys.`)
    return { type, tagIds }
  }

  throw new Error(`Fluxo "${flowName}": trigger não suportado.`)
}

function compileActions(rawActions, tagByKey, stageByKey, flowName) {
  if (!Array.isArray(rawActions) || !rawActions.length) {
    throw new Error(`Fluxo "${flowName}": informe ao menos 1 ação.`)
  }
  if (rawActions.length > 10) throw new Error(`Fluxo "${flowName}": máximo 10 ações.`)

  return rawActions.map((action, i) => {
    const type = String(action?.type || "")
    if (!ACTION_TYPES.has(type)) {
      throw new Error(`Fluxo "${flowName}" ação[${i}]: type inválido.`)
    }
    if (type === "send_message") {
      const body = String(action.body || "").trim()
      if (!body) throw new Error(`Fluxo "${flowName}" ação[${i}]: send_message exige body.`)
      return { type, body: body.slice(0, 4096), mediaType: "none" }
    }
    if (type === "add_tag" || type === "remove_tag") {
      const tagKey = action.tagKey || action.tag_key
      if (!tagKey) throw new Error(`Fluxo "${flowName}" ação[${i}]: ${type} exige tagKey.`)
      return { type, tagId: resolveTagId(tagByKey, tagKey, `Fluxo "${flowName}" ação[${i}]`) }
    }
    if (type === "move_stage") {
      const stageKey = action.stageKey || action.stage_key
      if (!stageKey) throw new Error(`Fluxo "${flowName}" ação[${i}]: move_stage exige stageKey.`)
      return { type, stageId: resolveStageId(stageByKey, stageKey, `Fluxo "${flowName}" ação[${i}]`) }
    }
    if (type === "set_status") {
      const value = String(action.value || "")
      if (!["open", "pending", "resolved", "archived"].includes(value)) {
        throw new Error(`Fluxo "${flowName}" ação[${i}]: set_status value inválido.`)
      }
      return { type, value }
    }
    if (type === "assign_ai") {
      const out = { type }
      if (action.agentId) out.agentId = String(action.agentId)
      return out
    }
    return { type }
  })
}

function compileFlowDefs(rawFlows, tagByKey, stageByKey) {
  return rawFlows.map((row, i) => {
    const name = String(row?.name || "").trim().slice(0, 80)
    if (!name) throw new Error(`flows[${i}]: informe "name".`)
    const trigger = compileTrigger(row.trigger, tagByKey, stageByKey, name)
    if (!normalizeTrigger(trigger)) {
      throw new Error(`Fluxo "${name}": trigger inválido após normalização.`)
    }
    const actions = compileActions(row.actions, tagByKey, stageByKey, name)
    const cooldown = Math.min(720, Math.max(1, Number(row.cooldownPerContactHours) || 24))
    return {
      name,
      enabled: row.enabled === true,
      trigger,
      conditions: Array.isArray(row.conditions) ? row.conditions : [],
      actions,
      cooldownPerContactHours: cooldown,
      quietHours: row.quietHours && typeof row.quietHours === "object" ? row.quietHours : null,
    }
  })
}

/**
 * Importa o pack na conta `userId`.
 * @returns {{ summary, tags, stages, flows }}
 */
async function importCrmPack(prisma, userId, pack) {
  const shapeError = validatePackShape(pack)
  if (shapeError) {
    const err = new Error(shapeError)
    err.code = "VALIDATION_ERROR"
    throw err
  }

  let tagDefs
  let stageDefs
  try {
    tagDefs = normalizeTagDefs(pack.tags)
    stageDefs = normalizeStageDefs(pack.stages)
  } catch (err) {
    err.code = "VALIDATION_ERROR"
    throw err
  }

  const summary = {
    packName: String(pack.name || "Pack CRM").trim().slice(0, 80) || "Pack CRM",
    tagsCreated: 0,
    tagsReused: 0,
    stagesCreated: 0,
    stagesReused: 0,
    flowsCreated: 0,
  }

  const existingTags = await prisma.crmTag.findMany({ where: { userId } })
  const tagByName = new Map(existingTags.map((t) => [t.name.toLowerCase(), t]))
  const tagByKey = new Map()
  const tagsOut = []

  for (const def of tagDefs) {
    const before = tagByName.get(def.name.toLowerCase())
    let row = before
    if (row) {
      summary.tagsReused += 1
    } else {
      row = await prisma.crmTag.create({
        data: { userId, name: def.name, color: def.color },
      })
      tagByName.set(def.name.toLowerCase(), row)
      summary.tagsCreated += 1
    }
    tagByKey.set(def.key, row.id)
    tagsOut.push({ id: row.id, key: def.key, name: row.name, color: row.color, reused: Boolean(before) })
  }

  const existingStages = await prisma.crmKanbanStage.findMany({ where: { userId }, orderBy: { sortOrder: "asc" } })
  const stageByName = new Map(existingStages.map((s) => [s.name.toLowerCase(), s]))
  const stageByKey = new Map()
  const stagesOut = []
  const maxSort = existingStages.reduce((m, s) => Math.max(m, s.sortOrder ?? 0), -1)
  let nextSort = maxSort + 1

  for (const def of stageDefs) {
    const before = stageByName.get(def.name.toLowerCase())
    let row = before
    if (row) {
      summary.stagesReused += 1
      if (def.isDefault && !row.isDefault) {
        await prisma.crmKanbanStage.updateMany({ where: { userId }, data: { isDefault: false } })
        row = await prisma.crmKanbanStage.update({ where: { id: row.id }, data: { isDefault: true } })
      }
    } else {
      if (def.isDefault) {
        await prisma.crmKanbanStage.updateMany({ where: { userId }, data: { isDefault: false } })
      }
      row = await prisma.crmKanbanStage.create({
        data: {
          userId,
          name: def.name,
          color: def.color,
          isDefault: def.isDefault,
          sortOrder: nextSort,
        },
      })
      nextSort += 1
      stageByName.set(def.name.toLowerCase(), row)
      summary.stagesCreated += 1
    }
    stageByKey.set(def.key, row.id)
    stagesOut.push({
      id: row.id,
      key: def.key,
      name: row.name,
      color: row.color,
      isDefault: row.isDefault,
      reused: Boolean(before),
    })
  }

  let flowDefs
  try {
    flowDefs = compileFlowDefs(pack.flows, tagByKey, stageByKey)
  } catch (err) {
    err.code = "VALIDATION_ERROR"
    throw err
  }

  const flowsOut = []
  for (const def of flowDefs) {
    const flow = await prisma.crmFlow.create({
      data: {
        userId,
        name: def.name,
        enabled: def.enabled,
        trigger: def.trigger,
        conditions: def.conditions,
        actions: def.actions,
        cooldownPerContactHours: def.cooldownPerContactHours,
        quietHours: def.quietHours,
      },
    })
    summary.flowsCreated += 1
    flowsOut.push({
      id: flow.id,
      name: flow.name,
      enabled: flow.enabled,
      trigger: flow.trigger,
      actions: flow.actions,
      cooldownPerContactHours: flow.cooldownPerContactHours,
    })
  }

  return {
    summary,
    tags: tagsOut.map(({ id, key, name, color, reused }) => ({ id, key, name, color, reused })),
    stages: stagesOut.map(({ id, key, name, color, isDefault, reused }) => ({
      id,
      key,
      name,
      color,
      isDefault,
      reused,
    })),
    flows: flowsOut,
  }
}

/** Valida pack sem gravar (útil para UI / testes). */
function previewCrmPack(pack) {
  const shapeError = validatePackShape(pack)
  if (shapeError) {
    const err = new Error(shapeError)
    err.code = "VALIDATION_ERROR"
    throw err
  }
  const tagDefs = normalizeTagDefs(pack.tags)
  const stageDefs = normalizeStageDefs(pack.stages)
  const tagByKey = new Map(tagDefs.map((t) => [t.key, `virtual:${t.key}`]))
  const stageByKey = new Map(stageDefs.map((s) => [s.key, `virtual:${s.key}`]))
  const flowDefs = compileFlowDefs(pack.flows, tagByKey, stageByKey)
  return {
    packName: String(pack.name || "Pack CRM").trim() || "Pack CRM",
    tags: tagDefs.length,
    stages: stageDefs.length,
    flows: flowDefs.length,
    flowNames: flowDefs.map((f) => f.name),
  }
}

module.exports = {
  importCrmPack,
  previewCrmPack,
  validatePackShape,
  normalizeTagDefs,
  normalizeStageDefs,
  compileFlowDefs,
}
