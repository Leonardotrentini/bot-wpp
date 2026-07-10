export function formatPhoneBr(digits) {
  const d = String(digits || '').replace(/\D/g, '')
  if (!d) return ''
  if (d.length === 13 && d.startsWith('55')) {
    return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`
  }
  if (d.length === 12 && d.startsWith('55')) {
    return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`
  }
  if (d.length === 11) return `+55 (${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `+55 (${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `+${d}`
}

function phoneFromRemoteJid(remoteJid) {
  const jid = String(remoteJid || '')
  if (/@lid$/i.test(jid)) return null
  const digits = jid.split('@')[0].replace(/\D/g, '')
  if (digits.length >= 10 && digits.length <= 15) return digits
  return null
}

export function resolveContactPhone(contact) {
  if (!contact) return null
  return contact.phone || phoneFromRemoteJid(contact.remoteJid) || null
}

export function isSelfOrGenericPushName(name) {
  const n = String(name || '').trim().toLowerCase()
  if (!n) return true
  if (n === 'você' || n === 'voce' || n === 'you' || n === 'me') return true
  if (n === 'contato') return true
  return false
}

export function isGenericContactName(name) {
  const n = String(name || '').trim()
  return !n || n === 'Contato' || n.startsWith('Contato #') || /^#\d+$/.test(n) || isSelfOrGenericPushName(n)
}

/** Nome salvo (Vesto) → telefone → nome WhatsApp válido → "Contato". */
export function contactTitle(contact) {
  if (!contact) return 'Contato'

  const saved = String(contact.savedName || '').trim()
  if (saved && !isGenericContactName(saved)) return saved

  const phone = resolveContactPhone(contact)
  if (phone) return formatPhoneBr(phone)

  const push = String(contact.pushName || '').trim()
  if (push && !isSelfOrGenericPushName(push)) return push

  const resolved = String(contact.name || '').trim()
  if (resolved && !isGenericContactName(resolved)) return resolved

  return 'Contato'
}

/** Subtítulo: telefone quando o título é nome, ou aviso. */
export function contactSubtitle(contact) {
  const phone = resolveContactPhone(contact)
  const title = contactTitle(contact)
  const phoneFormatted = phone ? formatPhoneBr(phone) : null

  if (phoneFormatted && title !== phoneFormatted && !isSelfOrGenericPushName(title)) {
    return phoneFormatted
  }
  if (contact?.needsIdentification) {
    return contact?.isLid ? 'Buscando número…' : 'Salve um nome para identificar'
  }
  return null
}

export function contactNeedsIdentification(contact) {
  if (!contact) return true
  if (contact.needsIdentification != null) return Boolean(contact.needsIdentification)
  const saved = String(contact.savedName || '').trim()
  if (saved && !isGenericContactName(saved)) return false
  if (resolveContactPhone(contact)) return false
  const push = String(contact.pushName || '').trim()
  if (push && !isSelfOrGenericPushName(push)) return false
  return true
}
