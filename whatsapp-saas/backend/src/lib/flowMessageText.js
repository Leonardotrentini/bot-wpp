/**
 * Texto de ações send_message: variáveis + sorteio de variações.
 */

function resolveContactDisplayName(contact) {
  const raw = String(contact?.name || contact?.pushName || "").trim()
  return raw
}

function resolveFirstName(fullName) {
  const name = String(fullName || "").trim()
  if (!name) return ""
  return name.split(/\s+/)[0] || ""
}

/**
 * Substitui {nome} / {primeiro_nome}.
 * Se o valor estiver vazio, remove vírgula/espaço sobrando ao redor do placeholder
 * (ex.: "Oi, {nome}!" → "Oi!" ; "Oi {nome}," → "Oi,").
 */
function interpolateFlowBody(template, contact) {
  const text = String(template || "")
  if (!text) return ""
  const nome = resolveContactDisplayName(contact)
  const primeiro = resolveFirstName(nome)
  const values = { nome, primeiro_nome: primeiro }

  return text.replace(/\{(nome|primeiro_nome)\}/gi, (match, key, offset, full) => {
    const value = values[String(key).toLowerCase()] || ""
    if (value) return value

    const before = full.slice(0, offset)
    const after = full.slice(offset + match.length)

    // "Oi, {nome}" / "Oi, {nome}!" → remove ", "
    if (/,\s*$/.test(before) && (/^[!.?…]/.test(after) || after === "" || /^\s/.test(after))) {
      return ""
    }
    // "{nome}, tudo bem" no início ou após espaço → remove o placeholder (vírgula fica no after)
    if (/^\s*,/.test(after) && (/^$|\s$/.test(before) || before === "" || /\s$/.test(before))) {
      return ""
    }
    // Espaço duplo / sobra ao redor
    if (/\s$/.test(before) && /^\s/.test(after)) return ""
    return ""
  })
    .replace(/,\s*([!.?…])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([!.?…,;:])/g, "$1")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .trim()
}

/** body + bodyVariants (até 2) → lista de 1–3 textos não vazios. */
function collectMessageBodies(action) {
  const primary = String(action?.body || "").trim()
  const variants = Array.isArray(action?.bodyVariants)
    ? action.bodyVariants.map((v) => String(v || "").trim()).filter(Boolean).slice(0, 2)
    : []
  const all = []
  if (primary) all.push(primary)
  for (const v of variants) {
    if (!all.includes(v)) all.push(v)
  }
  return all.slice(0, 3)
}

function pickMessageBody(action, rng = Math.random) {
  const bodies = collectMessageBodies(action)
  if (!bodies.length) return ""
  if (bodies.length === 1) return bodies[0]
  const idx = Math.floor(Number(rng()) * bodies.length) % bodies.length
  return bodies[Math.max(0, idx)]
}

function resolveSendMessageBody(action, contact, rng = Math.random) {
  const picked = pickMessageBody(action, rng)
  return interpolateFlowBody(picked, contact)
}

module.exports = {
  resolveContactDisplayName,
  resolveFirstName,
  interpolateFlowBody,
  collectMessageBodies,
  pickMessageBody,
  resolveSendMessageBody,
}
