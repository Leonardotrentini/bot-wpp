import { useCallback, useEffect, useState } from 'react'
import { Loader2, Mic, Film, ImageIcon, FileText } from 'lucide-react'
import { getCrmMessageMedia } from '../../services/api.js'
import { DocumentMediaPreview, ImageMediaPreview, VideoMediaPreview } from '../common/MediaPreview.jsx'

const mediaCache = new Map()

function mediaDataUrlFromParts(mimetype, base64) {
  const clean = String(base64 || '').replace(/^data:[^;]+;base64,/, '')
  const mime = (mimetype || 'application/octet-stream').split(';')[0].trim()
  return `data:${mime};base64,${clean}`
}

/** Pré-carrega mídia recém-enviada para exibir miniatura sem esperar o download. */
export function primeCrmMessageMediaCache(messageId, mimetype, base64) {
  if (!messageId || !base64) return
  const src = mediaDataUrlFromParts(mimetype, base64)
  const mime = (mimetype || 'application/octet-stream').split(';')[0].trim()
  mediaCache.set(messageId, { loading: false, error: null, src, mimetype: mime })
}

function inferMediaKind(message) {
  if (message?.mediaKind) return message.mediaKind
  const t = String(message?.type || '').toLowerCase()
  if (t.includes('image') || t.includes('sticker')) return 'image'
  if (t.includes('video')) return 'video'
  if (t.includes('audio') || t.includes('ptt')) return 'audio'
  if (t.includes('document')) return 'document'
  return null
}

function documentFileNameFromRaw(message) {
  if (message?.mediaName) return message.mediaName
  const raw = message?.raw
  const local = raw?._localMedia
  if (local?.fileName) return local.fileName
  const doc =
    raw?.message?.documentMessage ||
    raw?.message?.documentWithCaptionMessage?.message?.documentMessage ||
    null
  return doc?.fileName || doc?.title || null
}

function documentDisplayName(message) {
  return documentFileNameFromRaw(message) || String(message?.body || '').trim() || 'Documento'
}

function documentCaption(message) {
  const fileName = documentFileNameFromRaw(message)
  const body = String(message?.body || '').trim()
  if (!body) return ''
  if (!fileName || body === fileName) return ''
  return body
}

function mediaDataUrl(mimetype, base64) {
  return mediaDataUrlFromParts(mimetype, base64)
}

function MediaFallback({ kind, error }) {
  const labels = {
    audio: { icon: Mic, text: '🎤 Áudio' },
    video: { icon: Film, text: '🎬 Vídeo' },
    image: { icon: ImageIcon, text: '📷 Imagem' },
    document: { icon: FileText, text: '📄 Documento' },
  }
  const meta = labels[kind] || { icon: FileText, text: '📎 Mídia' }
  const Icon = meta.icon
  return (
    <div className="flex items-center gap-2 text-sm italic text-stone-400">
      <Icon className="h-4 w-4 shrink-0" />
      <span>{error ? 'Não foi possível carregar' : meta.text}</span>
    </div>
  )
}

function useCrmMessageMedia(message) {
  const kind = inferMediaKind(message)
  const [retryKey, setRetryKey] = useState(0)
  const [state, setState] = useState(() => {
    const cached = mediaCache.get(message.id)
    if (cached) return { ...cached, loading: false }
    return { loading: Boolean(kind), error: null, src: null, mimetype: message.mediaMime || null }
  })

  const retry = useCallback(() => {
    mediaCache.delete(message.id)
    setRetryKey((n) => n + 1)
  }, [message.id])

  useEffect(() => {
    if (!kind || !message?.id) return undefined
    const cached = mediaCache.get(message.id)
    if (cached && retryKey === 0) {
      setState({ ...cached, loading: false })
      return undefined
    }

    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))

    getCrmMessageMedia(message.id)
      .then(({ data }) => {
        if (cancelled) return
        if (!data?.base64) {
          setState({ loading: false, error: 'Mídia vazia', src: null, mimetype: null })
          return
        }
        const src = mediaDataUrl(data.mimetype, data.base64)
        const next = { loading: false, error: null, src, mimetype: data.mimetype }
        mediaCache.set(message.id, next)
        setState(next)
      })
      .catch((err) => {
        if (cancelled) return
        const status = err?.response?.status
        const code = err?.response?.data?.error
        let msg = err?.response?.data?.message || err?.message || 'Falha ao carregar mídia'
        if (status === 404) {
          msg = 'Servidor sem suporte a mídia — é necessário atualizar o backend.'
        } else if (code === 'WHATSAPP_DISCONNECTED') {
          msg = 'WhatsApp desconectado — reconecte em Conectar WhatsApp para baixar mídia.'
        }
        setState({ loading: false, error: msg, src: null, mimetype: null })
      })

    return () => {
      cancelled = true
    }
  }, [message.id, kind, retryKey])

  return { kind, retry, ...state }
}

export function ChatMessageContent({ message }) {
  const { kind, loading, error, src, retry, mimetype } = useCrmMessageMedia(message)
  const fileName = kind === 'document' ? documentDisplayName(message) : null
  const body = kind === 'document' ? documentCaption(message) : String(message?.body || '').trim()

  if (!kind) {
    return body ? <p className="whitespace-pre-wrap break-words">{message.body}</p> : null
  }

  return (
    <div className="space-y-2">
      {loading ? (
        <div className="flex items-center gap-2 py-1 text-xs text-stone-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando mídia…
        </div>
      ) : error || !src ? (
        <div className="space-y-1">
          <MediaFallback kind={kind} error={Boolean(error || !src)} />
          {error ? <p className="text-[11px] text-stone-500">{error}</p> : null}
          <button
            type="button"
            onClick={retry}
            className="text-[11px] text-brand-300 underline hover:text-brand-200"
          >
            Tentar novamente
          </button>
        </div>
      ) : kind === 'audio' ? (
        <audio src={src} controls preload="metadata" className="h-9 w-full min-w-[220px] max-w-sm" />
      ) : kind === 'video' ? (
        <VideoMediaPreview src={src} className="max-h-56 w-full rounded-lg border border-brand-700/80 object-contain" compact />
      ) : kind === 'image' ? (
        <ImageMediaPreview src={src} alt="" className="max-h-56 w-full rounded-lg border border-brand-700/80 object-contain" />
      ) : kind === 'document' ? (
        <DocumentMediaPreview src={src} mediaName={fileName} mimetype={mimetype || message.mediaMime} />
      ) : (
        <MediaFallback kind={kind} />
      )}
      {body ? <p className="whitespace-pre-wrap break-words text-stone-200">{message.body}</p> : null}
    </div>
  )
}
