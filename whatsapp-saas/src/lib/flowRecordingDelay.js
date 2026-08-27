/** Simula "gravando áudio…" antes de enviar nota de voz no fluxo. */

export const MAX_RECORDING_DELAY_SECONDS = 120

export function resolveRecordingDelayMs(action) {
  if (!action || action.mediaType !== 'audio') return 0
  const v = Number(action.recordingDelayValue)
  if (!Number.isFinite(v) || v <= 0) return 0
  return Math.min(v, MAX_RECORDING_DELAY_SECONDS) * 1000
}

export function getRecordingDelayUi(action) {
  return Math.max(0, Math.min(MAX_RECORDING_DELAY_SECONDS, Number(action?.recordingDelayValue) || 0))
}

export function buildRecordingDelayPatch(seconds) {
  const n = Math.max(0, Math.min(MAX_RECORDING_DELAY_SECONDS, Number(seconds) || 0))
  return { recordingDelayValue: n }
}

export function formatRecordingDelay(action) {
  const v = getRecordingDelayUi(action)
  if (v <= 0) return null
  return v === 1 ? '1 segundo gravando' : `${v} segundos gravando`
}
