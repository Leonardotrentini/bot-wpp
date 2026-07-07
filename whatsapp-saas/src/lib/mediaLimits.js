const MB = 1024 * 1024

export const IMAGE_MAX_BYTES = 5 * MB
/** Criativos de clientes costumam ficar entre ~45MB e ~430MB. */
export const VIDEO_MAX_BYTES = 512 * MB
/** Áudios de voz / PTT — limite conservador do WhatsApp. */
export const AUDIO_MAX_BYTES = 16 * MB
/** Catálogos e PDFs nos atalhos. */
export const DOCUMENT_MAX_BYTES = 20 * MB

export const imageMaxLabel = `${IMAGE_MAX_BYTES / MB}MB`
export const videoMaxLabel = `${VIDEO_MAX_BYTES / MB}MB`
export const audioMaxLabel = `${AUDIO_MAX_BYTES / MB}MB`
export const documentMaxLabel = `${DOCUMENT_MAX_BYTES / MB}MB`

export function mediaLimitLabel(kind) {
  if (kind === 'video') return videoMaxLabel
  if (kind === 'audio') return audioMaxLabel
  if (kind === 'document') return documentMaxLabel
  return imageMaxLabel
}
