export function tagNameKey(name) {
  return String(name || '').trim().toLowerCase()
}

/** Chip da org e tag do contato podem ter IDs diferentes (um por vendedor). */
export function contactHasTag(contactTags, tag) {
  const list = contactTags || []
  if (tag?.id && list.some((t) => t.id === tag.id)) return true
  const key = tagNameKey(tag?.name)
  if (!key) return false
  return list.some((t) => tagNameKey(t.name) === key)
}

/**
 * Catálogo de chips na UI: um por nome (case-insensitive).
 * Evita QUALIFICADO/Comprou duplicados quando o contato traz a tag do vendedor
 * e a lista já tem a do dono (ou vice-versa).
 */
export function mergeCrmTagCatalog(existing = [], incoming = []) {
  const byKey = new Map()
  for (const tag of existing || []) {
    const key = tagNameKey(tag?.name)
    if (!key || byKey.has(key)) continue
    byKey.set(key, tag)
  }
  for (const tag of incoming || []) {
    const key = tagNameKey(tag?.name)
    if (!key || byKey.has(key)) continue
    byKey.set(key, tag)
  }
  return [...byKey.values()].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'pt'),
  )
}
