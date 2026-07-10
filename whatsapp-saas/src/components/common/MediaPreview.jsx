import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, FileText, Film } from 'lucide-react'

export function formatMediaSize(bytes) {
  if (!bytes || bytes < 1) return ''
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

/** Revoga blob URL criada no upload local. */
export function revokeMediaPreviewUrl(url) {
  if (url && String(url).startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url)
    } catch {
      /* ignore */
    }
  }
}

function VideoFallback({ mediaName, mediaSize, className, compact }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border border-brand-700 bg-brand-900/70 text-center ${compact ? 'p-3' : 'p-4'} ${className || ''}`}
    >
      <Film className={compact ? 'h-6 w-6 text-accent-400' : 'h-8 w-8 text-accent-400'} />
      <p className="max-w-full truncate text-xs font-medium text-stone-200">{mediaName || 'Vídeo anexado'}</p>
      {mediaSize ? <p className="text-[10px] text-stone-500">{formatMediaSize(mediaSize)}</p> : null}
      <p className="max-w-[220px] text-[10px] leading-snug text-stone-500">Não foi possível carregar a prévia deste vídeo.</p>
    </div>
  )
}

export function VideoMediaPreview({ src, mediaName, mediaSize, className, compact }) {
  const [failed, setFailed] = useState(!src)
  const playbackSrc = useMemo(() => (src ? mediaSrcForPlayback(src) : null), [src])

  useEffect(() => {
    setFailed(!src)
  }, [src])

  useEffect(() => {
    return () => {
      if (playbackSrc?.startsWith('blob:') && playbackSrc !== src) revokeMediaPreviewUrl(playbackSrc)
    }
  }, [playbackSrc, src])

  if (!src || failed) {
    return <VideoFallback mediaName={mediaName} mediaSize={mediaSize} className={className} compact={compact} />
  }

  return (
    <video
      key={playbackSrc}
      src={playbackSrc}
      controls
      preload="metadata"
      playsInline
      className={className}
      onError={() => setFailed(true)}
    />
  )
}

function dataUrlToBlobUrl(dataUrl) {
  if (!dataUrl || !String(dataUrl).startsWith('data:')) return dataUrl
  try {
    const [header, b64] = String(dataUrl).split(',')
    const mime = header.match(/data:([^;]+)/)?.[1] || 'application/octet-stream'
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return URL.createObjectURL(new Blob([bytes], { type: mime }))
  } catch {
    return dataUrl
  }
}

export function mediaSrcForPlayback(dataUrl) {
  return dataUrlToBlobUrl(dataUrl)
}

function isPdfDocument(mimetype, fileName) {
  const mime = String(mimetype || '').toLowerCase()
  if (mime.includes('pdf')) return true
  return /\.pdf$/i.test(fileName || '')
}

export function openDocumentPreview(src, fileName) {
  if (!src) return
  const url = dataUrlToBlobUrl(src)
  const opened = window.open(url, '_blank', 'noopener,noreferrer')
  if (!opened && url.startsWith('blob:')) {
    const link = document.createElement('a')
    link.href = url
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    if (fileName) link.download = fileName
    link.click()
  }
  if (url.startsWith('blob:') && url !== src) {
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url)
      } catch {
        /* ignore */
      }
    }, 120_000)
  }
}

export function DocumentMediaPreview({ src, mediaName, mimetype, className }) {
  const [failed, setFailed] = useState(!src)
  const label = mediaName || 'Documento'
  const pdf = isPdfDocument(mimetype, mediaName)
  const previewUrl = useMemo(() => (pdf && src ? dataUrlToBlobUrl(src) : null), [pdf, src])

  useEffect(() => {
    setFailed(!src)
  }, [src])

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith('blob:')) revokeMediaPreviewUrl(previewUrl)
    }
  }, [previewUrl])

  if (!src || failed) {
    return (
      <div
        className={`flex items-center gap-3 rounded-lg border border-brand-700 bg-brand-900/70 p-3 ${className || ''}`}
      >
        <FileText className="h-8 w-8 shrink-0 text-accent-400" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-stone-200">{label}</p>
          <p className="text-[11px] text-stone-500">Prévia indisponível</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`space-y-2 ${className || ''}`}>
      <button
        type="button"
        onClick={() => openDocumentPreview(src, mediaName)}
        className="flex w-full min-w-[220px] max-w-sm items-center gap-3 rounded-lg border border-brand-700 bg-brand-900/70 p-3 text-left transition hover:border-accent-500/40 hover:bg-brand-900"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-500/15 text-accent-300">
          <FileText className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-stone-100">{label}</p>
          <p className="text-[11px] text-accent-300">{pdf ? 'Clique para visualizar o PDF' : 'Clique para abrir o arquivo'}</p>
        </div>
        <ExternalLink className="h-4 w-4 shrink-0 text-stone-500" />
      </button>
      {pdf && previewUrl ? (
        <button
          type="button"
          onClick={() => openDocumentPreview(src, mediaName)}
          className="block w-full min-w-[220px] max-w-sm overflow-hidden rounded-lg border border-brand-700 bg-white/5 text-left transition hover:border-accent-500/40"
        >
          <iframe
            src={previewUrl}
            title={label}
            className="pointer-events-none h-44 w-full bg-white"
            onError={() => setFailed(true)}
          />
          <p className="border-t border-brand-800 px-2 py-1 text-center text-[10px] text-stone-500">
            Toque para abrir em tela cheia
          </p>
        </button>
      ) : null}
    </div>
  )
}

export function ImageMediaPreview({ src, alt, className }) {
  const [failed, setFailed] = useState(!src)

  useEffect(() => {
    setFailed(!src)
  }, [src])

  if (!src || failed) {
    return (
      <div className={`flex items-center justify-center rounded-lg border border-brand-700 bg-brand-900/70 p-4 text-xs text-stone-500 ${className || ''}`}>
        Imagem anexada (prévia indisponível)
      </div>
    )
  }

  return <img src={src} alt={alt || ''} className={className} onError={() => setFailed(true)} />
}
