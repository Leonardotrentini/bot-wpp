/** Gatilhos adicionais combináveis (AND) com o gatilho principal. */

import { buildNoReplyTriggerPatch, getNoReplyDelayUi } from './flowNoReplyDelay.js'

export const PRIMARY_TRIGGER_LABELS = {
  new_conversation: 'Nova conversa',
  keyword: 'Palavra-chave',
  no_reply: 'Sem resposta',
  stage_change: 'Mudança de estágio',
  tag_added: 'Tag adicionada',
  contact_reply: 'Contato responde',
  has_tag: 'Contém a tag',
  not_has_tag: 'Não contém a tag',
}

/** Opções do dropdown — espelham o gatilho principal (+ filtros por tag). */
export const EXTRA_TRIGGER_OPTIONS = [
  { type: 'has_tag', label: 'Contém a tag' },
  { type: 'not_has_tag', label: 'Não contém a tag' },
  { type: 'keyword', label: 'Contato envia palavra-chave' },
  { type: 'no_reply', label: 'Contato sem responder há um tempo' },
  { type: 'stage_change', label: 'Estágio do Kanban é' },
  { type: 'tag_added', label: 'Quando a tag é adicionada' },
  { type: 'contact_reply', label: 'Contato tem tag(s)' },
]

const CONDITION_TYPES = new Set([
  'has_tag',
  'not_has_tag',
  'stage_is',
  'status_is',
  'keyword_in_last',
  'has_any_tag',
  'no_reply_minutes',
])

export function extraTriggerOptionsForPrimary(primaryType) {
  return EXTRA_TRIGGER_OPTIONS.filter((o) => o.type !== primaryType)
}

function resolveNoReplyMinutesFromExtra(extra) {
  const ui = getNoReplyDelayUi(extra || {})
  if (ui.unit === 'minutes') return Math.max(1, Number(ui.value) || 1)
  return Math.max(1, Number(ui.value) || 1) * 60
}

/** Converte condition da API → gatilho extra na UI. */
export function conditionToExtraTrigger(cond) {
  const type = String(cond?.type || '')
  if (type === 'has_tag') return { type: 'has_tag', tagId: String(cond.value || '') }
  if (type === 'not_has_tag') return { type: 'not_has_tag', tagId: String(cond.value || '') }
  if (type === 'stage_is') {
    return {
      type: 'stage_change',
      stageId: cond.value === '__none__' || cond.value == null ? '__none__' : String(cond.value),
    }
  }
  if (type === 'status_is') return { type: 'status_is', status: String(cond.value || '') }
  if (type === 'keyword_in_last') {
    try {
      const parsed = JSON.parse(String(cond.value || '{}'))
      return {
        type: 'keyword',
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
        matchMode: parsed.matchMode === 'exact' ? 'exact' : 'contains',
      }
    } catch {
      return { type: 'keyword', keywords: [], matchMode: 'contains' }
    }
  }
  if (type === 'has_any_tag') {
    try {
      const ids = JSON.parse(String(cond.value || '[]'))
      return { type: 'contact_reply', tagIds: Array.isArray(ids) ? ids.map(String) : [] }
    } catch {
      return { type: 'contact_reply', tagIds: [] }
    }
  }
  if (type === 'no_reply_minutes') {
    const minutes = Math.max(1, Number(cond.value) || 60)
    if (minutes % 60 === 0 && minutes >= 60) {
      return { type: 'no_reply', delayUnit: 'hours', delayValue: minutes / 60, hours: minutes / 60 }
    }
    return { type: 'no_reply', delayUnit: 'minutes', delayValue: minutes, minutes }
  }
  return null
}

/** Converte gatilhos extras da UI → conditions da API. */
export function extraTriggerToConditions(extra) {
  const type = String(extra?.type || '')
  if (type === 'has_tag' || type === 'tag_added') {
    return extra.tagId ? [{ type: 'has_tag', value: String(extra.tagId) }] : []
  }
  if (type === 'not_has_tag') {
    return extra.tagId ? [{ type: 'not_has_tag', value: String(extra.tagId) }] : []
  }
  if (type === 'stage_change') {
    if (extra.stageId === '' || extra.stageId == null) return []
    return [{ type: 'stage_is', value: extra.stageId === '__none__' ? '__none__' : String(extra.stageId) }]
  }
  if (type === 'status_is') {
    return extra.status ? [{ type: 'status_is', value: String(extra.status) }] : []
  }
  if (type === 'keyword') {
    const keywords = (Array.isArray(extra.keywords) ? extra.keywords : [])
      .map((k) => String(k).trim().toLowerCase())
      .filter(Boolean)
    if (!keywords.length) return []
    return [
      {
        type: 'keyword_in_last',
        value: JSON.stringify({
          keywords,
          matchMode: extra.matchMode === 'exact' ? 'exact' : 'contains',
        }),
      },
    ]
  }
  if (type === 'contact_reply') {
    const tagIds = [...new Set((Array.isArray(extra.tagIds) ? extra.tagIds : []).map(String).filter(Boolean))]
    if (!tagIds.length) return []
    return [{ type: 'has_any_tag', value: JSON.stringify(tagIds) }]
  }
  if (type === 'no_reply') {
    const minutes = resolveNoReplyMinutesFromExtra(extra)
    return [{ type: 'no_reply_minutes', value: String(minutes) }]
  }
  return []
}

export function extraTriggersFromConditions(conditions = []) {
  return (Array.isArray(conditions) ? conditions : [])
    .filter((c) => CONDITION_TYPES.has(String(c?.type || '')))
    .map(conditionToExtraTrigger)
    .filter(Boolean)
}

export function buildFlowConditions(flow) {
  const extras = Array.isArray(flow?.extraTriggers) ? flow.extraTriggers : extraTriggersFromConditions(flow?.conditions)
  return extras.flatMap(extraTriggerToConditions)
}

export function emptyExtraTrigger(type = 'has_tag') {
  switch (type) {
    case 'keyword':
      return { type, keywords: [], matchMode: 'contains' }
    case 'no_reply':
      return { type, delayUnit: 'hours', delayValue: 4, hours: 4 }
    case 'stage_change':
      return { type, stageId: '' }
    case 'status_is':
      return { type, status: 'open' }
    case 'contact_reply':
      return { type, tagIds: [] }
    case 'not_has_tag':
    case 'tag_added':
    case 'has_tag':
    default:
      return { type, tagId: '' }
  }
}

export function hydrateFlowForEditor(flow) {
  const base = flow ? JSON.parse(JSON.stringify(flow)) : null
  if (!base) return null
  base.extraTriggers = extraTriggersFromConditions(base.conditions)
  if (!Array.isArray(base.conditions)) base.conditions = []
  return base
}

export function formatExtraTriggerLabel(extra, tags = [], stages = []) {
  const type = String(extra?.type || '')
  if (type === 'has_tag' || type === 'tag_added' || type === 'not_has_tag') {
    const label = EXTRA_TRIGGER_OPTIONS.find((t) => t.type === type)?.label || type
    const tagName = tags.find((t) => t.id === extra.tagId)?.name || 'tag'
    return `${label}: ${tagName}`
  }
  if (type === 'stage_change') {
    if (extra.stageId === '__none__') return 'Estágio: Sem estágio'
    const stage = stages.find((s) => s.id === extra.stageId)
    return stage ? `Estágio: ${stage.name}` : 'Estágio do Kanban'
  }
  if (type === 'keyword' && extra.keywords?.length) {
    return `Palavra-chave: ${extra.keywords.join(', ')}`
  }
  if (type === 'no_reply') {
    const ui = getNoReplyDelayUi(extra)
    const unit = ui.unit === 'minutes' ? 'min' : 'h'
    return `Sem resposta: ${ui.value}${unit}`
  }
  if (type === 'contact_reply' && extra.tagIds?.length) {
    const names = extra.tagIds.map((id) => tags.find((t) => t.id === id)?.name || 'tag')
    return `Com tag(s): ${names.join(', ')}`
  }
  return EXTRA_TRIGGER_OPTIONS.find((t) => t.type === type)?.label || type
}

export function formatFlowTriggerSummary(flow, tags = [], stages = [], { formatNoReplyDelay } = {}) {
  const type = flow?.trigger?.type || 'new_conversation'
  let main = PRIMARY_TRIGGER_LABELS[type] || type

  if (type === 'keyword' && flow.trigger.keywords?.length) {
    main += ` (${flow.trigger.keywords.join(', ')})`
  }
  if (type === 'no_reply' && typeof formatNoReplyDelay === 'function') {
    main += ` (${formatNoReplyDelay(flow.trigger)})`
  }
  if (type === 'tag_added' && flow.trigger.tagId) {
    const name = tags.find((t) => t.id === flow.trigger.tagId)?.name
    if (name) main += ` (${name})`
  }
  if (type === 'contact_reply' && flow.trigger.tagIds?.length) {
    const names = flow.trigger.tagIds.map((id) => tags.find((t) => t.id === id)?.name || 'tag')
    main += ` (${names.join(', ')})`
  }

  const extras = flow.extraTriggers?.length ? flow.extraTriggers : extraTriggersFromConditions(flow.conditions)
  if (!extras.length) return main

  const extraParts = extras.map((e) => formatExtraTriggerLabel(e, tags, stages)).filter(Boolean)
  return extraParts.length ? `${main} + ${extraParts.join(' + ')}` : main
}

export function flowExtraTriggersValid(extraTriggers = []) {
  return (extraTriggers || []).every((extra) => {
    const type = String(extra?.type || '')
    if (type === 'has_tag' || type === 'tag_added' || type === 'not_has_tag') {
      return Boolean(String(extra.tagId || '').trim())
    }
    if (type === 'stage_change') return Boolean(extra.stageId)
    if (type === 'keyword') return (extra.keywords || []).length > 0
    if (type === 'no_reply') return resolveNoReplyMinutesFromExtra(extra) > 0
    if (type === 'contact_reply') return (extra.tagIds || []).length > 0
    return false
  })
}

export { resolveNoReplyMinutesFromExtra, buildNoReplyTriggerPatch, getNoReplyDelayUi }
