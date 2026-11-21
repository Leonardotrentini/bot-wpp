/**
 * Horário silencioso dos fluxos CRM (America/Sao_Paulo).
 * Mensagens caem na fila e só saem após o fim do intervalo.
 */

const FLOW_QUIET_TZ = "America/Sao_Paulo"

function normalizeQuietHours(value) {
  if (!value || typeof value !== "object" || value.enabled !== true) return null
  const re = /^([01]?\d|2[0-3]):[0-5]\d$/
  const start = re.test(value.start) ? value.start : "22:00"
  const end = re.test(value.end) ? value.end : "08:00"
  return { enabled: true, start, end }
}

function parseTimeParts(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hh = Number(match[1])
  const mm = Number(match[2])
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return { hh, mm, minutes: hh * 60 + mm }
}

function spWallClockParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: FLOW_QUIET_TZ,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const get = (type) => parts.find((p) => p.type === type)?.value
  const hh = Number(get("hour"))
  const mm = Number(get("minute"))
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    hh,
    mm,
    minutes: hh * 60 + mm,
  }
}

function spDateAtLocal(y, m, d, hh, mm) {
  const guess = new Date(Date.UTC(y, m - 1, d, hh + 3, mm, 0, 0))
  for (let i = 0; i < 3; i += 1) {
    const wall = spWallClockParts(guess)
    const deltaMin = wall.hh * 60 + wall.mm - (hh * 60 + mm)
    if (deltaMin === 0) return guess
    guess.setUTCMinutes(guess.getUTCMinutes() - deltaMin)
  }
  return guess
}

function isWithinQuietHours(quietHours, now = new Date()) {
  const qh = normalizeQuietHours(quietHours)
  if (!qh) return false
  const start = parseTimeParts(qh.start)
  const end = parseTimeParts(qh.end)
  if (!start || !end) return false

  const nowMin = spWallClockParts(now).minutes
  const startMin = start.minutes
  const endMin = end.minutes
  if (startMin === endMin) return false
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin
  return nowMin >= startMin || nowMin < endMin
}

function nextAllowedAfterQuietHours(quietHours, at = new Date()) {
  const qh = normalizeQuietHours(quietHours)
  if (!qh) return at instanceof Date ? at : new Date(at)
  const end = parseTimeParts(qh.end)
  if (!end) return at instanceof Date ? at : new Date(at)

  const when = at instanceof Date ? at : new Date(at)
  const wall = spWallClockParts(when)
  let target = spDateAtLocal(wall.y, wall.m, wall.d, end.hh, end.mm)
  if (target <= when) target = new Date(target.getTime() + 24 * 3600 * 1000)
  return target
}

/** Se `at` cair no silêncio, devolve o instante do fim; senão devolve `at`. */
function bumpScheduledAtPastQuietHours(quietHours, at = new Date()) {
  const when = at instanceof Date ? new Date(at.getTime()) : new Date(at)
  if (!isWithinQuietHours(quietHours, when)) return when
  return nextAllowedAfterQuietHours(quietHours, when)
}

module.exports = {
  FLOW_QUIET_TZ,
  normalizeQuietHours,
  isWithinQuietHours,
  nextAllowedAfterQuietHours,
  bumpScheduledAtPastQuietHours,
}
