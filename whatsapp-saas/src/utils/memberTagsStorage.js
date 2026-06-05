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

/** Remove tag do catálogo e de todos os membros (exceto admin do WhatsApp). */
export function removeTagGlobally(overrides, catalogExtras, tag) {
  const norm = normalizeTag(tag)
  if (!norm || norm === 'admin') return { overrides, catalogExtras }

  const nextCatalog = catalogExtras.filter((t) => normalizeTag(t) !== norm)
  let nextOverrides = { ...overrides }

  for (const memberId of Object.keys(nextOverrides)) {
    const entry = nextOverrides[memberId]
    if (!Array.isArray(entry?.tags)) continue
    const filtered = entry.tags.map(normalizeTag).filter((t) => t !== norm)
    nextOverrides = setMemberCustomTags(nextOverrides, memberId, filtered)
  }

  return { overrides: nextOverrides, catalogExtras: nextCatalog }
}

/** Renomeia tag no catálogo e em todos os membros. Retorna null se inválido. */
export function renameTagGlobally(overrides, catalogExtras, oldTag, newTag) {
  const oldNorm = normalizeTag(oldTag)
  const newNorm = normalizeTag(newTag)
  if (!oldNorm || !newNorm || oldNorm === 'admin' || newNorm === 'admin') return null
  if (oldNorm === newNorm) return { overrides, catalogExtras }

  const nextCatalog = [
    ...new Set(
      catalogExtras
        .map((t) => (normalizeTag(t) === oldNorm ? newNorm : normalizeTag(t)))
        .filter(Boolean),
    ),
  ]

  let nextOverrides = { ...overrides }
  for (const memberId of Object.keys(nextOverrides)) {
    const entry = nextOverrides[memberId]
    if (!Array.isArray(entry?.tags)) continue
    const tags = entry.tags.map(normalizeTag).map((t) => (t === oldNorm ? newNorm : t))
    nextOverrides = setMemberCustomTags(nextOverrides, memberId, tags)
  }

  return { overrides: nextOverrides, catalogExtras: nextCatalog }
}
