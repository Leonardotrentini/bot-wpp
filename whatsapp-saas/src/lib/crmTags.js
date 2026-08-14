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
