/**
 * Configuração do funil de conversão da Visão geral (etapas por tags da conta).
 */

export const DEFAULT_FUNNEL_STEPS = [
  { id: 'leads', label: 'Leads', systemKey: 'leads', tagIds: [] },
  { id: 'qualified', label: 'Lead qualificado', systemKey: 'qualified', tagIds: [] },
  { id: 'quote', label: 'Orçamento', systemKey: 'quote', tagIds: [] },
  { id: 'purchase', label: 'Compra', systemKey: 'purchase', tagIds: [] },
]

export function createFunnelStepId() {
  return `fs_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

/** Normaliza etapas salvas no layout. */
export function normalizeFunnelSteps(raw) {
  if (!Array.isArray(raw) || !raw.length) {
    return DEFAULT_FUNNEL_STEPS.map((s) => ({ ...s, tagIds: [] }))
  }
  return raw
    .map((step, index) => {
      const id = String(step?.id || createFunnelStepId())
      const tagIds = Array.isArray(step?.tagIds)
        ? [...new Set(step.tagIds.map((t) => String(t).trim()).filter(Boolean))]
        : []
      const systemKey = tagIds.length
        ? null
        : step?.systemKey || DEFAULT_FUNNEL_STEPS[index]?.systemKey || null
      const label =
        String(step?.label || '').trim() ||
        DEFAULT_FUNNEL_STEPS[index]?.label ||
        `Etapa ${index + 1}`
      return { id, label, systemKey, tagIds }
    })
    .slice(0, 12)
}

/** Grupos de tags enviados à API (só etapas com tags). */
export function funnelStepsToTagGroups(steps) {
  return normalizeFunnelSteps(steps)
    .map((s) => s.tagIds)
    .filter((ids) => ids.length > 0)
}

export function encodeFunnelTagGroups(groups) {
  if (!groups?.length) return ''
  return groups.map((ids) => ids.join(',')).join(';')
}

export function resolveSystemFunnelValue(systemKey, data) {
  const c = data?.crm
  const conv = c?.conversions || data?.meta?.conversions || {}
  switch (systemKey) {
    case 'leads':
      return data?.leads?.total ?? conv.conversationStarted ?? 0
    case 'qualified':
      return conv.leadQualified ?? 0
    case 'quote':
      return conv.quote ?? c?.quotes?.count ?? 0
    case 'purchase':
      return conv.purchase ?? c?.sales?.summary?.count ?? 0
    default:
      return 0
  }
}
