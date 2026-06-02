const MB = 1024 * 1024

export const IMAGE_MAX_BYTES = 5 * MB
/** Criativos de clientes costumam ficar entre ~45MB e ~430MB. */
export const VIDEO_MAX_BYTES = 512 * MB

export const imageMaxLabel = `${IMAGE_MAX_BYTES / MB}MB`
export const videoMaxLabel = `${VIDEO_MAX_BYTES / MB}MB`

export function mediaLimitLabel(kind) {
  return kind === 'video' ? videoMaxLabel : imageMaxLabel
}
