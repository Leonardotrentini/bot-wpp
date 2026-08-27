/** Delay configurável antes de cada ação do fluxo. */

export const MAX_ACTION_DELAY_SECONDS = 3600
export const MAX_ACTION_DELAY_MINUTES = 24 * 60
export const MAX_ACTION_DELAY_HOURS = 24

export function resolveActionDelayMs(action) {
  if (!action) return 0
  const v = Number(action.delayValue)
  if (!Number.isFinite(v) || v <= 0) return 0
  const unit = action.delayUnit || 'minutes'
  if (unit === 'seconds') return Math.min(v, MAX_ACTION_DELAY_SECONDS) * 1000
  if (unit === 'hours') return Math.min(v, MAX_ACTION_DELAY_HOURS) * 3600 * 1000
  return Math.min(v, MAX_ACTION_DELAY_MINUTES) * 60 * 1000
}

export function getActionDelayUi(action) {
  const unit =
    action?.delayUnit === 'seconds' || action?.delayUnit === 'hours' ? action.delayUnit : 'minutes'
  return {
    value: Math.max(0, Number(action?.delayValue) || 0),
    unit,
  }
}

export function buildActionDelayPatch(value, unit) {
  const n = Math.max(0, Number(value) || 0)
  if (n <= 0) return { delayValue: 0, delayUnit: unit }
  return { delayValue: n, delayUnit: unit }
}

export function formatActionDelay(action) {
  const ms = resolveActionDelayMs(action)
  if (ms <= 0) return null
  const unit = action.delayUnit || 'minutes'
  const v = Number(action.delayValue) || 0
  if (unit === 'seconds') return v === 1 ? '1 segundo' : `${v} segundos`
  if (unit === 'hours') return v === 1 ? '1 hora' : `${v} horas`
  return v === 1 ? '1 minuto' : `${v} minutos`
}

export function maxDelayForUnit(unit) {
  if (unit === 'seconds') return MAX_ACTION_DELAY_SECONDS
  if (unit === 'hours') return MAX_ACTION_DELAY_HOURS
  return MAX_ACTION_DELAY_MINUTES
}
