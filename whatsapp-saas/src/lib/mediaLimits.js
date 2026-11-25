const MB = 1024 * 1024

export const IMAGE_MAX_BYTES = 16 * MB
/** Criativos de clientes costumam ficar entre ~45MB e ~430MB. */
export const VIDEO_MAX_BYTES = 512 * MB
/** Áudios de voz / PTT — limite conservador do WhatsApp. */
export const AUDIO_MAX_BYTES = 16 * MB
/** Catálogos e PDFs na biblioteca / atalhos. */
export const DOCUMENT_MAX_BYTES = 64 * MB

export const imageMaxLabel = `${IMAGE_MAX_BYTES / MB}MB`
export const videoMaxLabel = `${VIDEO_MAX_BYTES / MB}MB`
export const audioMaxLabel = `${AUDIO_MAX_BYTES / MB}MB`
export const documentMaxLabel = `${DOCUMENT_MAX_BYTES / MB}MB`

/** FileReader gera `data:audio/webm;codecs=opus;base64,...` — o regex antigo parava no primeiro `;`. */
export function stripBase64Payload(value) {
  const s = String(value || '')
  const idx = s.toLowerCase().indexOf('base64,')
  if (s.trimStart().toLowerCase().startsWith('data:') && idx !== -1) {
    return s.slice(idx + 'base64,'.length).replace(/\s/g, '')
  }
  return s.replace(/\s/g, '')
}

export function mediaLimitLabel(kind) {
  if (kind === 'video') return videoMaxLabel
  if (kind === 'audio') return audioMaxLabel
  if (kind === 'document') return documentMaxLabel
  return imageMaxLabel
}

/** accept= do input — iPhone manda galeria como quicktime/.MOV mesmo quando o usuário acha que é MP4. */
export const VIDEO_FILE_ACCEPT = 'video/*,video/mp4,video/quicktime,.mp4,.mov,.m4v'

const ACCEPTED_VIDEO_MIME = new Set([
  'video/mp4',
  'application/mp4',
  'video/quicktime',
  'video/x-quicktime',
  'video/x-m4v',
  'video/m4v',
])

/** MP4 / MOV / M4V — backend converte para H.264 MP4 antes de enviar ao WhatsApp. */
export function isAcceptedChatVideo(fileOrMime, fileName = '') {
  const name = String(fileOrMime?.name || fileName || '')
  const mime = String(fileOrMime?.type || (typeof fileOrMime === 'string' ? fileOrMime : '') || '').toLowerCase()
  if (/\.(mp4|mov|m4v)$/i.test(name)) return true
  if (ACCEPTED_VIDEO_MIME.has(mime)) return true
  // Alguns Android/iOS reportam só "video/*" genérico com extensão correta já coberta acima.
  return false
}

export function isChatVideoMimeOrName(mime, name = '') {
  return isAcceptedChatVideo({ type: mime, name }, name)
}
