/** Simula "gravando áudio…" antes de enviar nota de voz no fluxo. */

const MAX_RECORDING_DELAY_SECONDS = 120
const AUTO_RECORDING_MIN_SEC = 3
const AUTO_RECORDING_MAX_SEC = 20

function resolveRecordingDelayMs(action, options = {}) {
  if (!action || action.mediaType !== "audio") return 0
  const audioSec = Number(options.audioDurationSec)
  let v = Number(action.recordingDelayValue)

  if (!Number.isFinite(v) || v <= 0) {
    if (Number.isFinite(audioSec) && audioSec > 0) {
      v = Math.min(AUTO_RECORDING_MAX_SEC, Math.max(AUTO_RECORDING_MIN_SEC, Math.ceil(audioSec)))
    } else {
      return 0
    }
  }

  return Math.min(v, MAX_RECORDING_DELAY_SECONDS) * 1000
}

module.exports = {
  resolveRecordingDelayMs,
  MAX_RECORDING_DELAY_SECONDS,
  AUTO_RECORDING_MIN_SEC,
  AUTO_RECORDING_MAX_SEC,
}
