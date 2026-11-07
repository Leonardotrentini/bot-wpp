/**
 * Normalização de vendedores / WhatsApp para LP (Brasil).
 */

export function normalizeBrazilPhone(input) {
  const digits = String(input || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length >= 12 && digits.startsWith('55')) return digits
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  return digits
}

export function isValidBrazilWhatsapp(digits) {
  if (!digits) return false
  if (!digits.startsWith('55')) return false
  const rest = digits.slice(2)
  return rest.length === 10 || rest.length === 11
}

export function formatPhoneExample(digits) {
  if (!digits || digits.length < 12) return '5547996747378'
  const ddd = digits.slice(2, 4)
  const rest = digits.slice(4)
  if (rest.length === 9) {
    return `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`
  }
  return `+55 (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`
}

export function parseSellersFromIntegration(integration) {
  if (!integration) return [{ id: '1', label: '', phone: '' }]
  const raw = integration.lpSellers
  if (Array.isArray(raw) && raw.length) {
    return raw.map((s, i) => ({
      id: String(i + 1),
      label: s.label || '',
      phone: s.phone || '',
    }))
  }
  if (integration.lpWhatsapp) {
    return [{ id: '1', label: '', phone: integration.lpWhatsapp }]
  }
  return [{ id: '1', label: '', phone: '' }]
}

export function sellersToPayload(rows) {
  return rows
    .map((row) => ({
      label: String(row.label || '').trim(),
      phone: normalizeBrazilPhone(row.phone),
    }))
    .filter((s) => s.phone)
}

export function validateSellers(rows) {
  const errors = []
  rows.forEach((row, i) => {
    const phone = normalizeBrazilPhone(row.phone)
    if (!phone) {
      errors.push(`Vendedor ${i + 1}: informe o telefone.`)
      return
    }
    if (!isValidBrazilWhatsapp(phone)) {
      errors.push(
        `Vendedor ${i + 1}: formato inválido. Use DDI+DDD+número — ex: 5547996747378 ou (47) 99674-7378.`,
      )
    }
  })
  return errors
}

export function newDomainRow(index = 0, hostname = '') {
  return { id: `domain-${Date.now()}-${index}`, hostname: String(hostname || '') }
}

export function newMessageRow(index = 0, { label = '', message = '' } = {}) {
  return {
    id: `msg-${Date.now()}-${index}`,
    label: String(label || ''),
    message: String(message || ''),
  }
}

/** Extrai hostname de URL ou texto colado. */
export function normalizeDomainInput(raw) {
  let value = String(raw || '').trim().toLowerCase()
  if (!value) return ''
  try {
    if (value.includes('://')) value = new URL(value).hostname
    else value = value.split('/')[0].split('?')[0].split(':')[0]
  } catch {
    value = value.split('/')[0].split('?')[0].split(':')[0]
  }
  return value.replace(/^www\./, '')
}

export function parseDomainsFromIntegration(integration) {
  const origins = Array.isArray(integration?.allowedOrigins) ? integration.allowedOrigins : []
  if (!origins.length) return [newDomainRow(0)]
  return origins.map((host, i) => newDomainRow(i, host))
}

export function domainsToPayload(rows) {
  const seen = new Set()
  const out = []
  for (const row of rows || []) {
    const host = normalizeDomainInput(row?.hostname ?? row)
    if (!host || seen.has(host)) continue
    seen.add(host)
    out.push(host)
  }
  return out
}

export function parseMessagesFromIntegration(integration) {
  const raw = integration?.lpMessages
  if (Array.isArray(raw) && raw.length) {
    return raw
      .map((m, i) =>
        newMessageRow(i, {
          label: m?.label || '',
          message: m?.message || m?.text || '',
        }),
      )
      .filter((m) => m.message.trim())
  }
  const legacy = String(integration?.lpWhatsappMsg || '').trim()
  if (legacy) return [newMessageRow(0, { message: legacy })]
  return [newMessageRow(0, { message: 'Olá! Vim pelo site e quero mais informações.' })]
}

export function messagesToPayload(rows) {
  return (rows || [])
    .map((row) => ({
      label: String(row.label || '').trim(),
      message: String(row.message || '').trim().slice(0, 500),
    }))
    .filter((m) => m.message)
}

export function validateMessages(rows) {
  const errors = []
  const payload = messagesToPayload(rows)
  if (!payload.length) {
    errors.push('Informe ao menos uma mensagem do WhatsApp.')
    return errors
  }
  payload.forEach((row, i) => {
    if (!row.message) errors.push(`Mensagem ${i + 1}: texto obrigatório.`)
  })
  return errors
}
