/** Simula "gravando áudio…" antes de enviar nota de voz no fluxo. */

const MAX_RECORDING_DELAY_SECONDS = 120

function resolveRecordingDelayMs(action) {
  if (!action || action.mediaType !== "audio") return 0
  const v = Number(action.recordingDelayValue)
  if (!Number.isFinite(v) || v <= 0) return 0
  return Math.min(v, MAX_RECORDING_DELAY_SECONDS) * 1000
}

module.exports = { resolveRecordingDelayMs, MAX_RECORDING_DELAY_SECONDS }
