import { AUDIO_MAX_BYTES, VIDEO_MAX_BYTES, audioMaxLabel, videoMaxLabel } from './mediaLimits.js'
import { revokeMediaPreviewUrl } from '../components/common/MediaPreview.jsx'

export const FLOW_FILE_ACCEPT = 'audio/*,video/mp4,.mp4,.mpeg,.mp3,.ogg,.m4a,.aac,.wav,.opus'

export function emptyFlowMessageMedia() {
  return {
    mediaType: 'none',
    mediaBase64: null,
    mediaMime: null,
    mediaName: null,
    mediaPreviewUrl: null,
    mediaSize: null,
  }
}

export function flowMessageHasContent(action) {
  const body = String(action?.body || '').trim()
  const mediaType = action?.mediaType || 'none'
  return Boolean(body) || mediaType === 'audio' || mediaType === 'video'
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

export function flowMediaKind(file) {
  if (!file) return 'unsupported'
  if (isAudioFile(file)) return 'audio'
  if (isMp4Video(file)) return 'video'
  if (file.type.startsWith('video/') || /\.(mov|avi|mkv|webm|m4v)$/i.test(file.name || '')) {
    return 'unsupported-video'
  }
  return 'unsupported'
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function flowMediaLimitLabel(kind) {
  return kind === 'video' ? videoMaxLabel : audioMaxLabel
}

export function flowMediaMaxBytes(kind) {
  if (kind === 'video') return VIDEO_MAX_BYTES
  if (kind === 'audio') return AUDIO_MAX_BYTES
  return 0
}

export async function attachFlowMediaFromFile(file) {
  const kind = flowMediaKind(file)
  if (kind === 'unsupported-video') {
    return { error: 'Use vídeo em MP4 (H.264). Converta MOV/AVI antes de anexar.' }
  }
  if (kind === 'unsupported') {
    return { error: 'Tipo não suportado. Use áudio (MP3, OGG, M4A…) ou vídeo MP4.' }
  }
  const max = flowMediaMaxBytes(kind)
  if (file.size > max) {
    return { error: `Arquivo grande demais. Limite: ${flowMediaLimitLabel(kind)}.` }
  }
  const dataUrl = await readFileAsDataUrl(file)
  const previewUrl = URL.createObjectURL(file)
  const mime =
    kind === 'video'
      ? 'video/mp4'
      : file.type || (file.name?.endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg')
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

export function clearFlowMessageMedia(action) {
  revokeMediaPreviewUrl(action?.mediaPreviewUrl)
  return { ...action, body: action?.body || '', ...emptyFlowMessageMedia() }
}

export function stripFlowActionForSave(action) {
  if (action.type !== 'send_message') return action
  const { mediaPreviewUrl, mediaSize, ...rest } = action
  return rest
}
