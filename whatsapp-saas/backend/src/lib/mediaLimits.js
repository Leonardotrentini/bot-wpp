const MB = 1024 * 1024

/** Binário máximo (bytes) antes do base64. */
const IMAGE_MAX_BYTES = Number(process.env.MEDIA_MAX_IMAGE_BYTES || 5 * MB)
const VIDEO_MAX_BYTES = Number(process.env.MEDIA_MAX_VIDEO_BYTES || 512 * MB)

/** Tamanho da string base64/data-URL aceita no JSON. */
const IMAGE_MAX_BASE64_LEN = Number(
  process.env.MEDIA_MAX_IMAGE_BASE64_LEN || Math.ceil((IMAGE_MAX_BYTES * 4) / 3) + 512,
)
const VIDEO_MAX_BASE64_LEN = Number(
  process.env.MEDIA_MAX_VIDEO_BASE64_LEN || Math.ceil((VIDEO_MAX_BYTES * 4) / 3) + 4096,
)

function mbLabel(bytes) {
  return `${Math.round(bytes / MB)}MB`
}

function validateMediaContentSize(content) {
  const hasMedia = content.mediaType === "image" || content.mediaType === "video"
  if (!hasMedia && !content.body?.trim()) return "Escreva um texto ou anexe uma mídia."
  if (!hasMedia) return null
  if (!content.mediaBase64 || typeof content.mediaBase64 !== "string") {
    return "Mídia ausente para o tipo selecionado."
  }

  const len = content.mediaBase64.length
  if (content.mediaType === "video") {
    const mime = (content.mediaMime || "").toLowerCase()
    const name = content.mediaName || ""
    if (mime && mime !== "video/mp4" && mime !== "application/mp4" && !/\.mp4$/i.test(name)) {
      return "Use vídeo em formato MP4."
    }
    if (len > VIDEO_MAX_BASE64_LEN) {
      return `Vídeo grande demais. Limite: ${mbLabel(VIDEO_MAX_BYTES)}.`
    }
  }
  if (content.mediaType === "image" && len > IMAGE_MAX_BASE64_LEN) {
    return `Imagem grande demais. Limite: ${mbLabel(IMAGE_MAX_BYTES)}.`
  }
  return null
}

module.exports = {
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  IMAGE_MAX_BASE64_LEN,
  VIDEO_MAX_BASE64_LEN,
  mbLabel,
  validateMediaContentSize,
}
