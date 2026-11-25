import {
  AUDIO_MAX_BYTES,
  DOCUMENT_MAX_BYTES,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  VIDEO_FILE_ACCEPT,
  audioMaxLabel,
  documentMaxLabel,
  imageMaxLabel,
  videoMaxLabel,
  isAcceptedChatVideo,
} from './mediaLimits.js'
import { revokeMediaPreviewUrl } from '../components/common/MediaPreview.jsx'

export const QUICK_REPLY_FILE_ACCEPT =
  `image/*,${VIDEO_FILE_ACCEPT},audio/*,.mp3,.ogg,.m4a,.aac,.wav,.opus,application/pdf,.pdf`

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
  if ((file.type || '').startsWith('image/')) return 'image'
  if (isAcceptedChatVideo(file)) return 'video'
  if ((file.type || '').startsWith('video/') || /\.(avi|mkv|webm)$/i.test(file.name || '')) {
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
    return { error: 'Use vídeo em MP4 ou MOV.' }
  }
  if (kind === 'unsupported') {
    return { error: 'Tipo não suportado. Use imagem, vídeo (MP4/MOV), áudio ou PDF.' }
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
  if (kind === 'video') {
    if (/\.mov$/i.test(file.name || '') || mime.includes('quicktime')) mime = mime || 'video/quicktime'
    else if (/\.m4v$/i.test(file.name || '')) mime = mime || 'video/x-m4v'
    else mime = mime && mime.startsWith('video/') ? mime : 'video/mp4'
  }
  if (kind === 'document') mime = 'application/pdf'
  if (kind === 'image' && (/\.jfif$/i.test(file.name || '') || mime.includes('jfif'))) {
    mime = 'image/jpeg'
  }

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
