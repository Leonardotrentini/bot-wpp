import {
  AUDIO_MAX_BYTES,
  DOCUMENT_MAX_BYTES,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  audioMaxLabel,
  documentMaxLabel,
  imageMaxLabel,
  videoMaxLabel,
} from './mediaLimits.js'
import { revokeMediaPreviewUrl } from '../components/common/MediaPreview.jsx'

export const QUICK_REPLY_FILE_ACCEPT =
  'image/*,video/mp4,.mp4,audio/*,.mp3,.ogg,.m4a,.aac,.wav,.opus,application/pdf,.pdf'

export function emptyQuickReplyMedia() {
  return {
    mediaType: 'none',
    mediaBase64: null,
    mediaMime: null,
    mediaName: null,
    mediaPreviewUrl: null,
    mediaSize: null,
  }
}

export function quickReplyHasContent(form) {
  const body = String(form?.body || '').trim()
  const mediaType = form?.mediaType || 'none'
  return Boolean(body) || mediaType !== 'none'
}

function isMp4Video(file) {
  if (/\.mp4$/i.test(file.name || '')) return true
  const t = (file.type || '').toLowerCase()
  return t === 'video/mp4' || t === 'application/mp4'
}

function isAudioFile(file) {
  if ((file.type || '').startsWith('audio/')) return true
  return /\.(mp3|ogg|m4a|aac|wav|opus|mpeg|oga)$/i.test(file.name || '')
}

function isPdfFile(file) {
  const t = (file.type || '').toLowerCase()
  if (t === 'application/pdf') return true
  return /\.pdf$/i.test(file.name || '')
}

export function quickReplyMediaKind(file) {
  if (!file) return 'unsupported'
  if (file.type.startsWith('image/')) return 'image'
  if (isMp4Video(file)) return 'video'
  if (file.type.startsWith('video/') || /\.(mov|avi|mkv|webm|m4v)$/i.test(file.name || '')) {
    return 'unsupported-video'
  }
  if (isAudioFile(file)) return 'audio'
  if (isPdfFile(file)) return 'document'
  return 'unsupported'
}

export function quickReplyMediaMaxBytes(kind) {
  if (kind === 'video') return VIDEO_MAX_BYTES
  if (kind === 'audio') return AUDIO_MAX_BYTES
  if (kind === 'document') return DOCUMENT_MAX_BYTES
  if (kind === 'image') return IMAGE_MAX_BYTES
  return 0
}

export function quickReplyMediaLimitLabel(kind) {
  if (kind === 'video') return videoMaxLabel
  if (kind === 'audio') return audioMaxLabel
  if (kind === 'document') return documentMaxLabel
  return imageMaxLabel
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export async function attachQuickReplyMediaFromFile(file) {
  const kind = quickReplyMediaKind(file)
  if (kind === 'unsupported-video') {
    return { error: 'Use vídeo em MP4 (H.264). Converta MOV/AVI antes de anexar.' }
  }
  if (kind === 'unsupported') {
    return { error: 'Tipo não suportado. Use imagem, vídeo MP4, áudio ou PDF.' }
  }
  const max = quickReplyMediaMaxBytes(kind)
  if (file.size > max) {
    return { error: `Arquivo grande demais. Limite: ${quickReplyMediaLimitLabel(kind)}.` }
  }

  const dataUrl = await readFileAsDataUrl(file)
  let previewUrl = null
  if (kind === 'image' || kind === 'video' || kind === 'audio') {
    previewUrl = URL.createObjectURL(file)
  }

  let mime = file.type || 'application/octet-stream'
  if (kind === 'video') mime = 'video/mp4'
  if (kind === 'document') mime = 'application/pdf'

  return {
    patch: {
      mediaType: kind,
      mediaBase64: dataUrl,
      mediaMime: mime,
      mediaName: file.name,
      mediaPreviewUrl: previewUrl,
      mediaSize: file.size,
    },
  }
}

export function clearQuickReplyMedia(form) {
  revokeMediaPreviewUrl(form?.mediaPreviewUrl)
  return { ...form, ...emptyQuickReplyMedia() }
}

export function buildQuickReplyPayload(form) {
  const mediaType = form.mediaType || 'none'
  const payload = {
    shortcut: form.shortcut.trim().toLowerCase(),
    title: form.title.trim(),
    body: form.body.trim(),
    mediaType,
    mediaBase64: null,
    mediaMime: null,
    mediaName: null,
  }
  if (mediaType !== 'none') {
    payload.mediaBase64 = form.mediaBase64
    payload.mediaMime = form.mediaMime
    payload.mediaName = form.mediaName
  }
  return payload
}

export const QUICK_REPLY_MEDIA_LABELS = {
  image: 'Imagem',
  video: 'Vídeo',
  audio: 'Áudio',
  document: 'PDF',
}
