/** Delay configurável antes de cada ação do fluxo (a partir da 2ª). */

const MAX_ACTION_DELAY_SECONDS = 3600
const MAX_ACTION_DELAY_MINUTES = 24 * 60
const MAX_ACTION_DELAY_HOURS = 24

function resolveActionDelayMs(action) {
  if (!action) return 0
  const v = Number(action.delayValue)
  if (!Number.isFinite(v) || v <= 0) return 0
  const unit = action.delayUnit || "minutes"
  if (unit === "seconds") return Math.min(v, MAX_ACTION_DELAY_SECONDS) * 1000
  if (unit === "hours") return Math.min(v, MAX_ACTION_DELAY_HOURS) * 3600 * 1000
  return Math.min(v, MAX_ACTION_DELAY_MINUTES) * 60 * 1000
}

module.exports = { resolveActionDelayMs }
