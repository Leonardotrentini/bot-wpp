import { AUDIO_MAX_BYTES } from './mediaLimits.js'

const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

let warmPromise = null
let micReady = false

async function microphonePermissionGranted() {
  try {
    if (navigator.permissions?.query) {
      const status = await navigator.permissions.query({ name: 'microphone' })
      return status.state === 'granted'
    }
  } catch {
    /* Permissions API indisponível (Safari) */
  }
  return false
}

/** Inicializa microfone/AudioContext em background (após F5) para o 1º clique ser rápido. */
export function warmUpAudioRecording() {
  if (micReady) return Promise.resolve()
  if (warmPromise) return warmPromise

  warmPromise = (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return
      const granted = await microphonePermissionGranted()
      if (!granted) return

      const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS })
      stream.getTracks().forEach((t) => t.stop())

      try {
        const ctx = new AudioContext()
        if (ctx.state === 'suspended') await ctx.resume()
        await ctx.close()
      } catch {
        /* ignore */
      }

      micReady = true
    } catch {
      micReady = false
    } finally {
      warmPromise = null
    }
  })()

  return warmPromise
}

export function markMicrophoneReady() {
  micReady = true
}

export function isMicrophoneWarmed() {
  return micReady
}

export async function openRecordingStream() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS })
  markMicrophoneReady()
  return stream
}

export function getAudioConstraints() {
  return AUDIO_CONSTRAINTS
}

export function pickAudioMimeType() {
  if (typeof MediaRecorder === 'undefined') return null
  const candidates = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || null
}

export function formatRecordSeconds(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function extensionForMime(mime) {
  const m = String(mime || '').toLowerCase()
  if (m.includes('ogg')) return 'ogg'
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a'
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3'
  return 'webm'
}

/** MIME enviado à Evolution (WhatsApp prefere ogg/opus; webm vai com encoding no backend). */
export function mimeForWhatsAppSend(mime) {
  const m = String(mime || '').toLowerCase()
  if (m.includes('ogg')) return 'audio/ogg; codecs=opus'
  if (m.includes('webm')) return 'audio/webm'
  if (m.includes('mp4') || m.includes('m4a')) return 'audio/mp4'
  if (m.includes('mpeg') || m.includes('mp3')) return 'audio/mpeg'
  return mime || 'audio/webm'
}

export async function blobToAudioAttachment(blob, { durationSeconds } = {}) {
  if (!blob || blob.size < 1) throw new Error('Gravação vazia.')
  if (blob.size > AUDIO_MAX_BYTES) throw new Error('Áudio grande demais. Limite: 16MB.')

  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const raw = String(reader.result || '')
      resolve(raw.replace(/^data:[^;]+;base64,/, ''))
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })

  const mime = blob.type || 'audio/webm'
  const ext = extensionForMime(mime)
  const previewUrl = URL.createObjectURL(blob)

  return {
    type: 'audio',
    mime: mimeForWhatsAppSend(mime),
    base64,
    name: `gravacao-${Date.now()}.${ext}`,
    previewUrl,
    durationSeconds: durationSeconds || null,
  }
}

export function revokeAudioPreview(attachment) {
  if (attachment?.previewUrl) {
    URL.revokeObjectURL(attachment.previewUrl)
  }
}
