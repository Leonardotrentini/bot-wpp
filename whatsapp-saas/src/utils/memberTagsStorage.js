export function normalizeTag(t) {
  return String(t || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
}

export function displayTag(t) {
  const n = normalizeTag(t)
  if (!n) return ''
  return n
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function storageKey(userId) {
  return `vg_members_tags_${userId || 'default'}`
}

export function loadMemberTagsStore(userId) {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return { catalogExtras: [], overrides: {} }
    const parsed = JSON.parse(raw)
    if (parsed?.v !== 1) return { catalogExtras: [], overrides: {} }
    const catalogExtras = Array.isArray(parsed.catalogExtras)
      ? parsed.catalogExtras.map(normalizeTag).filter(Boolean)
      : []
    const overrides =
      parsed.overrides && typeof parsed.overrides === 'object' ? parsed.overrides : {}
    return { catalogExtras, overrides }
  } catch {
    return { catalogExtras: [], overrides: {} }
  }
}

export function saveMemberTagsStore(userId, { catalogExtras, overrides }) {
  try {
    localStorage.setItem(
      storageKey(userId),
      JSON.stringify({
        v: 1,
        catalogExtras: catalogExtras.map(normalizeTag).filter(Boolean),
        overrides,
      }),
    )
  } catch {
    /* ignore quota */
  }
}

/** Mescla tags da API (ex.: admin) com tags customizadas salvas no navegador. */
export function mergeMemberTags(apiMember, overrides) {
  const entry = overrides[apiMember.id]
  const custom = Array.isArray(entry?.tags) ? entry.tags.map(normalizeTag).filter(Boolean) : []
  const fromApi = (apiMember.tags || []).map(normalizeTag).filter(Boolean)
  const system = fromApi.filter((t) => t === 'admin')
  return [...new Set([...system, ...custom])]
}

export function setMemberCustomTags(overrides, memberId, tags) {
  const norm = [...new Set(tags.map(normalizeTag).filter((t) => t && t !== 'admin'))]
  const next = { ...overrides }
  if (norm.length === 0) {
    if (next[memberId]) {
      const { tags: _t, ...rest } = next[memberId]
      if (Object.keys(rest).length === 0) delete next[memberId]
      else next[memberId] = rest
    }
  } else {
    next[memberId] = { ...(next[memberId] || {}), tags: norm }
  }
  return next
}
