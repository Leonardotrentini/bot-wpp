/** Tempo sem resposta do gatilho no_reply — suporta horas e minutos. */

export const MAX_NO_REPLY_MINUTES = 720 * 60
export const DEFAULT_NO_REPLY_MINUTES = 24 * 60

function clampMinutes(n) {
  return Math.min(MAX_NO_REPLY_MINUTES, Math.max(1, Math.round(n)))
}

/** Total em minutos (compatível com fluxos antigos que só tinham `hours`). */
export function resolveNoReplyMinutes(trigger) {
  if (!trigger) return DEFAULT_NO_REPLY_MINUTES
  const rawMinutes = Number(trigger.minutes)
  if (Number.isFinite(rawMinutes) && rawMinutes > 0) {
    return clampMinutes(rawMinutes)
  }
  if (trigger.delayUnit === 'minutes') {
    const v = Number(trigger.delayValue)
    if (Number.isFinite(v) && v > 0) return clampMinutes(v)
  }
  if (trigger.delayUnit === 'hours') {
    const v = Number(trigger.delayValue)
    if (Number.isFinite(v) && v > 0) return clampMinutes(v * 60)
  }
  const h = Number(trigger.hours)
  if (Number.isFinite(h) && h > 0) {
    return clampMinutes(h * 60)
  }
  return DEFAULT_NO_REPLY_MINUTES
}

/** Estado para os campos do formulário (valor + unidade). */
export function getNoReplyDelayUi(trigger) {
  if (trigger?.delayUnit === 'minutes') {
    return {
      value: Math.max(1, Number(trigger.delayValue) || resolveNoReplyMinutes(trigger)),
      unit: 'minutes',
    }
  }
  if (trigger?.delayUnit === 'hours') {
    return {
      value: Math.max(1, Number(trigger.delayValue) || Math.ceil(resolveNoReplyMinutes(trigger) / 60)),
      unit: 'hours',
    }
  }
  const total = resolveNoReplyMinutes(trigger)
  if (total < 60 || total % 60 !== 0) {
    return { value: total, unit: 'minutes' }
  }
  return { value: total / 60, unit: 'hours' }
}

export function buildNoReplyTriggerPatch(value, unit) {
  const n = Math.max(1, Number(value) || 1)
  const minutes = unit === 'minutes' ? clampMinutes(n) : clampMinutes(n * 60)
  const displayValue = unit === 'minutes' ? minutes : Math.max(1, Math.round(minutes / 60))
  return {
    minutes,
    hours: Math.ceil(minutes / 60),
    delayUnit: unit,
    delayValue: displayValue,
  }
}

export function formatNoReplyDelay(trigger) {
  const m = resolveNoReplyMinutes(trigger)
  if (m < 60) return `${m} min`
  if (m % 60 === 0) return `${m / 60}h`
  return `${Math.floor(m / 60)}h ${m % 60}min`
}
