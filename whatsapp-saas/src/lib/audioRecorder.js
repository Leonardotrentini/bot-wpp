import { AUDIO_MAX_BYTES } from './mediaLimits.js'

export function pickAudioMimeType() {
  if (typeof MediaRecorder === 'undefined') return null
  const candidates = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || null
}

export function formatRecordSeconds(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function extensionForMime(mime) {
  if (String(mime || '').includes('ogg')) return 'ogg'
  if (String(mime || '').includes('mp4')) return 'm4a'
  return 'webm'
}

export async function blobToAudioAttachment(blob) {
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
  return {
    type: 'audio',
    mime,
    base64,
    name: `gravacao-${Date.now()}.${ext}`,
  }
}
