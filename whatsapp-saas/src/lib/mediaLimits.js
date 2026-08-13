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
