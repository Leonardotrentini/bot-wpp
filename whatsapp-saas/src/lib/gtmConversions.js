/**
 * Catálogo de conversões GTM (espelha backend gtmConversions.js).
 */

export const GTM_CONVERSION_CATALOG = [
  {
    key: 'contact',
    label: 'Clique WhatsApp',
    description: 'Disparado na LP no clique do botão WhatsApp (equivalente ao Contact do Pixel).',
    defaultEventName: 'vesto_contact',
    scope: 'lp',
  },
  {
    key: 'conversation_started',
    label: 'Mensagem iniciada',
    description: '1ª mensagem inbound de contato novo no WhatsApp.',
    defaultEventName: 'vesto_conversation_started',
    scope: 'server',
  },
  {
    key: 'lead_qualified',
    label: 'Lead qualificado',
    description: 'Tag QUALIFICADO aplicada no CRM (1x por contato).',
    defaultEventName: 'vesto_lead_qualified',
    scope: 'server',
  },
  {
    key: 'quote',
    label: 'Orçamento',
    description: 'Orçamento salvo no chat com valor.',
    defaultEventName: 'vesto_quote',
    scope: 'server',
  },
  {
    key: 'purchase',
    label: 'Compra',
    description: 'Compra confirmada no CRM com valor.',
    defaultEventName: 'vesto_purchase',
    scope: 'server',
  },
]

export function normalizeConversionTags(input) {
  const savedByKey = new Map()
  if (Array.isArray(input)) {
    for (const item of input) {
      if (item?.key) savedByKey.set(String(item.key), item)
    }
  }

  return GTM_CONVERSION_CATALOG.map((def) => {
    const saved = savedByKey.get(def.key) || {}
    return {
      key: def.key,
      label: def.label,
      description: def.description,
      scope: def.scope,
      defaultEventName: def.defaultEventName,
      enabled: saved.enabled === true,
      eventName: String(saved.eventName || def.defaultEventName).trim() || def.defaultEventName,
      tagName: String(saved.tagName || '').trim(),
    }
  })
}

export function scopeLabel(scope) {
  return scope === 'lp' ? 'Landing page' : 'CRM (GA4 MP)'
}
