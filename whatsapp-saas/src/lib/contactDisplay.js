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

export function contactTitle(contact) {
  const name = String(contact?.name || '').trim()
  const generic = !name || name === 'Contato' || name.startsWith('Contato #')
  if (!generic) return name
  if (contact?.phone) return formatPhoneBr(contact.phone)
  return name || 'Contato'
}

export function isGenericContactName(name) {
  const n = String(name || '').trim()
  return !n || n === 'Contato' || n.startsWith('Contato #')
}
