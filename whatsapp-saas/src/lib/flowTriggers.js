/** Gatilhos adicionais combináveis (AND) com o gatilho principal. */

export const PRIMARY_TRIGGER_LABELS = {
  new_conversation: 'Nova conversa',
  keyword: 'Palavra-chave',
  no_reply: 'Sem resposta',
  stage_change: 'Mudança de estágio',
  tag_added: 'Tag adicionada',
  contact_reply: 'Contato responde',
}

export const EXTRA_TRIGGER_TYPES = [
  { type: 'has_tag', label: 'Contém a tag' },
  { type: 'not_has_tag', label: 'Não contém a tag' },
]

const TAG_CONDITION_TYPES = new Set(['has_tag', 'not_has_tag'])

/** Converte conditions da API → gatilhos extras na UI. */
export function extraTriggersFromConditions(conditions = []) {
  return (Array.isArray(conditions) ? conditions : [])
    .filter((c) => TAG_CONDITION_TYPES.has(String(c?.type || '')))
    .map((c) => ({
      type: String(c.type),
      tagId: String(c.value || ''),
    }))
    .filter((c) => c.tagId)
}

/** Monta conditions para API a partir do gatilho principal + extras. */
export function buildFlowConditions(flow) {
  const preserved = (Array.isArray(flow?.conditions) ? flow.conditions : []).filter(
    (c) => !TAG_CONDITION_TYPES.has(String(c?.type || '')),
  )
  const extras = (Array.isArray(flow?.extraTriggers) ? flow.extraTriggers : extraTriggersFromConditions(flow?.conditions))
    .filter((t) => t.tagId && TAG_CONDITION_TYPES.has(String(t.type)))
    .map((t) => ({ type: t.type, value: String(t.tagId) }))
  return [...preserved, ...extras]
}

export function emptyExtraTrigger(type = 'has_tag') {
  return { type, tagId: '' }
}

/** Prepara fluxo ao abrir modal (garante extraTriggers). */
export function hydrateFlowForEditor(flow) {
  const base = flow ? JSON.parse(JSON.stringify(flow)) : null
  if (!base) return null
  base.extraTriggers = extraTriggersFromConditions(base.conditions)
  if (!Array.isArray(base.conditions)) base.conditions = []
  return base
}

export function formatExtraTriggerLabel(extra, tags = []) {
  const typeLabel = EXTRA_TRIGGER_TYPES.find((t) => t.type === extra.type)?.label || extra.type
  const tagName = tags.find((t) => t.id === extra.tagId)?.name || 'tag'
  return `${typeLabel}: ${tagName}`
}

/** Resumo legível: "Sem resposta (4h) + Contém a tag: RECEBEU LINK" */
export function formatFlowTriggerSummary(flow, tags = [], { formatNoReplyDelay } = {}) {
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

  const extras = flow.extraTriggers?.length
    ? flow.extraTriggers
    : extraTriggersFromConditions(flow.conditions)

  if (!extras.length) return main

  const extraParts = extras
    .filter((e) => e.tagId)
    .map((e) => formatExtraTriggerLabel(e, tags))

  return extraParts.length ? `${main} + ${extraParts.join(' + ')}` : main
}

export function flowExtraTriggersValid(extraTriggers = []) {
  return extraTriggers.every((t) => {
    if (!TAG_CONDITION_TYPES.has(String(t.type))) return false
    return Boolean(String(t.tagId || '').trim())
  })
}
