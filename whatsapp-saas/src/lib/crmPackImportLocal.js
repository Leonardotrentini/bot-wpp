/**
 * Importação client-side de pack CRM (modo demo / fallback).
 * Espelha a lógica do backend crmPackImport.js com maps em memória.
 */

function slugKey(raw, fallback) {
  const base = String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return base || fallback
}

function requireKey(map, key, label) {
  const id = map.get(String(key || ''))
  if (!id) throw new Error(`${label}: chave "${key}" não existe no pack.`)
  return id
}

function compileTrigger(raw, tagByKey, stageByKey, flowName) {
  const type = String(raw?.type || '')
  if (type === 'new_conversation') return { type }
  if (type === 'keyword') {
    const keywords = (raw.keywords || []).map((k) => String(k).trim()).filter(Boolean)
    if (!keywords.length) throw new Error(`Fluxo "${flowName}": keyword exige keywords.`)
    return { type, keywords, matchMode: raw.matchMode === 'exact' ? 'exact' : 'contains' }
  }
  if (type === 'no_reply') {
    const delayUnit = raw.delayUnit === 'minutes' ? 'minutes' : 'hours'
    const delayValue = Math.max(1, Number(raw.delayValue) || (delayUnit === 'minutes' ? 60 : 24))
    const minutes = delayUnit === 'minutes' ? delayValue : delayValue * 60
    return { type, delayUnit, delayValue, minutes, hours: Math.ceil(minutes / 60) }
  }
  if (type === 'stage_change') {
    return {
      type,
      stageId: raw.stageKey ? requireKey(stageByKey, raw.stageKey, `Fluxo "${flowName}"`) : null,
    }
  }
  if (type === 'tag_added') {
    return { type, tagId: requireKey(tagByKey, raw.tagKey, `Fluxo "${flowName}"`) }
  }
  if (type === 'contact_reply') {
    const keys = Array.isArray(raw.tagKeys) ? raw.tagKeys : []
    const tagIds = [...new Set(keys.map((k) => requireKey(tagByKey, k, `Fluxo "${flowName}"`)))]
    if (!tagIds.length) throw new Error(`Fluxo "${flowName}": contact_reply exige tagKeys.`)
    return { type, tagIds }
  }
  throw new Error(`Fluxo "${flowName}": trigger.type inválido.`)
}

function compileActions(actions, tagByKey, stageByKey, flowName) {
  if (!Array.isArray(actions) || !actions.length) throw new Error(`Fluxo "${flowName}": informe ações.`)
  return actions.map((action, i) => {
    const type = String(action?.type || '')
    if (type === 'send_message') {
      const body = String(action.body || '').trim()
      if (!body) throw new Error(`Fluxo "${flowName}" ação[${i}]: body obrigatório.`)
      return { type, body, mediaType: 'none' }
    }
    if (type === 'add_tag' || type === 'remove_tag') {
      return { type, tagId: requireKey(tagByKey, action.tagKey, `Fluxo "${flowName}" ação[${i}]`) }
    }
    if (type === 'move_stage') {
      return { type, stageId: requireKey(stageByKey, action.stageKey, `Fluxo "${flowName}" ação[${i}]`) }
    }
    if (type === 'set_status') return { type, value: String(action.value || 'open') }
    if (type === 'assign_ai') return { type }
    throw new Error(`Fluxo "${flowName}" ação[${i}]: type inválido.`)
  })
}

/**
 * @param {object} pack
 * @param {{ tags: any[], stages: any[], flows: any[] }} store — mutável
 */
export function importCrmPackLocal(pack, store) {
  if (!pack || pack.kind !== 'vesto_crm_pack' || Number(pack.version) !== 1) {
    throw new Error('Pack inválido: use kind "vesto_crm_pack" e version 1.')
  }
  if (!Array.isArray(pack.tags) || !Array.isArray(pack.stages) || !Array.isArray(pack.flows)) {
    throw new Error('Pack inválido: tags, stages e flows devem ser arrays.')
  }

  const summary = {
    packName: String(pack.name || 'Pack CRM').trim() || 'Pack CRM',
    tagsCreated: 0,
    tagsReused: 0,
    stagesCreated: 0,
    stagesReused: 0,
    flowsCreated: 0,
  }

  const tagByKey = new Map()
  const tagsOut = []
  for (let i = 0; i < pack.tags.length; i += 1) {
    const row = pack.tags[i] || {}
    const name = String(row.name || '').trim()
    if (!name) throw new Error(`tags[${i}]: name obrigatório.`)
    const key = String(row.key || slugKey(name, `tag_${i + 1}`)).toLowerCase()
    const existing = store.tags.find((t) => t.name.toLowerCase() === name.toLowerCase())
    let tag = existing
    if (tag) summary.tagsReused += 1
    else {
      tag = { id: `tag-${Date.now()}-${i}`, name, color: row.color || '#22c55e' }
      store.tags.push(tag)
      summary.tagsCreated += 1
    }
    tagByKey.set(key, tag.id)
    tagsOut.push({ id: tag.id, key, name: tag.name, color: tag.color, reused: Boolean(existing) })
  }

  const stageByKey = new Map()
  const stagesOut = []
  for (let i = 0; i < pack.stages.length; i += 1) {
    const row = pack.stages[i] || {}
    const name = String(row.name || '').trim()
    if (!name) throw new Error(`stages[${i}]: name obrigatório.`)
    const key = String(row.key || slugKey(name, `stage_${i + 1}`)).toLowerCase()
    const existing = store.stages.find((s) => s.name.toLowerCase() === name.toLowerCase())
    let stage = existing
    if (stage) summary.stagesReused += 1
    else {
      stage = {
        id: `stage-${Date.now()}-${i}`,
        name,
        color: row.color || '#64748b',
        sortOrder: store.stages.length,
        isDefault: Boolean(row.isDefault),
      }
      store.stages.push(stage)
      summary.stagesCreated += 1
    }
    stageByKey.set(key, stage.id)
    stagesOut.push({
      id: stage.id,
      key,
      name: stage.name,
      color: stage.color,
      isDefault: stage.isDefault,
      reused: Boolean(existing),
    })
  }

  const flowsOut = []
  for (let i = 0; i < pack.flows.length; i += 1) {
    const row = pack.flows[i] || {}
    const name = String(row.name || '').trim()
    if (!name) throw new Error(`flows[${i}]: name obrigatório.`)
    const trigger = compileTrigger(row.trigger, tagByKey, stageByKey, name)
    const actions = compileActions(row.actions, tagByKey, stageByKey, name)
    const flow = {
      id: `flow-${Date.now()}-${i}`,
      name,
      enabled: row.enabled === true,
      trigger,
      conditions: Array.isArray(row.conditions) ? row.conditions : [],
      actions,
      cooldownPerContactHours: Math.min(720, Math.max(1, Number(row.cooldownPerContactHours) || 24)),
      quietHours: null,
      createdAt: new Date().toISOString(),
    }
    store.flows.push(flow)
    summary.flowsCreated += 1
    flowsOut.push(flow)
  }

  return { summary, tags: tagsOut, stages: stagesOut, flows: flowsOut }
}
