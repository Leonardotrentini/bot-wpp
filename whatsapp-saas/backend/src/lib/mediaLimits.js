const MB = 1024 * 1024

/** Binário máximo (bytes) antes do base64. */
const IMAGE_MAX_BYTES = Number(process.env.MEDIA_MAX_IMAGE_BYTES || 5 * MB)
const VIDEO_MAX_BYTES = Number(process.env.MEDIA_MAX_VIDEO_BYTES || 512 * MB)

const AUDIO_MAX_BYTES = Number(process.env.MEDIA_MAX_AUDIO_BYTES || 16 * MB)

/** Tamanho da string base64/data-URL aceita no JSON. */
const IMAGE_MAX_BASE64_LEN = Number(
  process.env.MEDIA_MAX_IMAGE_BASE64_LEN || Math.ceil((IMAGE_MAX_BYTES * 4) / 3) + 512,
)
const VIDEO_MAX_BASE64_LEN = Number(
  process.env.MEDIA_MAX_VIDEO_BASE64_LEN || Math.ceil((VIDEO_MAX_BYTES * 4) / 3) + 4096,
)

const AUDIO_MAX_BASE64_LEN = Number(
  process.env.MEDIA_MAX_AUDIO_BASE64_LEN || Math.ceil((AUDIO_MAX_BYTES * 4) / 3) + 512,
)

const DOCUMENT_MAX_BYTES = Number(process.env.MEDIA_MAX_DOCUMENT_BYTES || 20 * MB)

const DOCUMENT_MAX_BASE64_LEN = Number(
  process.env.MEDIA_MAX_DOCUMENT_BASE64_LEN || Math.ceil((DOCUMENT_MAX_BYTES * 4) / 3) + 1024,
)

function mbLabel(bytes) {
  return `${Math.round(bytes / MB)}MB`
}

function validateMediaContentSize(content) {
  const mediaType = content.mediaType || "none"
  const hasMedia = ["image", "video", "audio", "document"].includes(mediaType)
  if (!hasMedia && !content.body?.trim()) return "Escreva um texto ou anexe uma mídia."
  if (!hasMedia) return null
  if (!content.mediaBase64 || typeof content.mediaBase64 !== "string") {
    return "Mídia ausente para o tipo selecionado."
  }

  const len = content.mediaBase64.length
  if (mediaType === "video") {
    const mime = (content.mediaMime || "").toLowerCase()
    const name = content.mediaName || ""
    if (mime && mime !== "video/mp4" && mime !== "application/mp4" && !/\.mp4$/i.test(name)) {
      return "Use vídeo em formato MP4."
    }
    if (len > VIDEO_MAX_BASE64_LEN) {
      return `Vídeo grande demais. Limite: ${mbLabel(VIDEO_MAX_BYTES)}.`
    }
  }
  if (mediaType === "audio" && len > AUDIO_MAX_BASE64_LEN) {
    return `Áudio grande demais. Limite: ${mbLabel(AUDIO_MAX_BYTES)}.`
  }
  if (mediaType === "document") {
    const mime = (content.mediaMime || "").toLowerCase()
    const name = content.mediaName || ""
    if (mime && mime !== "application/pdf" && !/\.pdf$/i.test(name)) {
      return "Use arquivo em formato PDF."
    }
    if (len > DOCUMENT_MAX_BASE64_LEN) {
      return `Arquivo grande demais. Limite: ${mbLabel(DOCUMENT_MAX_BYTES)}.`
    }
  }
  if (mediaType === "image" && len > IMAGE_MAX_BASE64_LEN) {
    return `Imagem grande demais. Limite: ${mbLabel(IMAGE_MAX_BYTES)}.`
  }
  return null
}

module.exports = {
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  AUDIO_MAX_BYTES,
  DOCUMENT_MAX_BYTES,
  IMAGE_MAX_BASE64_LEN,
  VIDEO_MAX_BASE64_LEN,
  AUDIO_MAX_BASE64_LEN,
  DOCUMENT_MAX_BASE64_LEN,
  mbLabel,
  validateMediaContentSize,
}
