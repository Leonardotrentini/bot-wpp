import { useEffect, useState } from 'react'
import { Film } from 'lucide-react'

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

  useEffect(() => {
    setFailed(!src)
  }, [src])

  if (!src || failed) {
    return <VideoFallback mediaName={mediaName} mediaSize={mediaSize} className={className} compact={compact} />
  }

  return (
    <video
      key={src}
      src={src}
      controls
      preload="metadata"
      playsInline
      className={className}
      onError={() => setFailed(true)}
    />
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
