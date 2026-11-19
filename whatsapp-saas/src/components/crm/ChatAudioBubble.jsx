import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { mediaSrcForPlayback, revokeMediaPreviewUrl } from '../common/MediaPreview.jsx'

function formatAudioTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const s = Math.floor(sec)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

/** Barras estáticas estilo WhatsApp (progresso preenche da esquerda). */
function StaticWave({ progress, fromMe }) {
  const bars = useMemo(() => {
    const pattern = [4, 10, 16, 8, 20, 12, 18, 6, 14, 22, 9, 17, 11, 19, 7, 15, 21, 10, 13, 8, 16, 12, 5, 18, 14, 9, 20, 11]
    return pattern
  }, [])
  const filled = Math.round(progress * bars.length)

  return (
    <div className="flex h-7 flex-1 items-center gap-[2px]" aria-hidden>
      {bars.map((h, i) => (
        <span
          key={i}
          className={`w-[2.5px] rounded-full ${
            i < filled ? (fromMe ? 'bg-emerald-200/90' : 'bg-sky-300/90') : fromMe ? 'bg-white/25' : 'bg-white/20'
          }`}
          style={{ height: `${h}px` }}
        />
      ))}
    </div>
  )
}

/**
 * Player de áudio estilo WhatsApp (bolha do chat).
 * @param {{ src: string, fromMe?: boolean, durationHint?: number }} props
 */
export function ChatAudioBubble({ src, fromMe = false, durationHint }) {
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(durationHint > 0 ? durationHint : 0)
  const [failed, setFailed] = useState(false)
  const [useRawSrc, setUseRawSrc] = useState(false)
  const blobRef = useRef(null)

  const playbackSrc = useMemo(() => {
    if (!src) return null
    if (useRawSrc) return src
    if (String(src).startsWith('blob:')) return src
    try {
      const next = mediaSrcForPlayback(src)
      return next || src
    } catch {
      return src
    }
  }, [src, useRawSrc])

  useEffect(() => {
    const prev = blobRef.current
    if (prev && prev !== src && prev !== playbackSrc && String(prev).startsWith('blob:')) {
      revokeMediaPreviewUrl(prev)
    }
    blobRef.current = playbackSrc?.startsWith('blob:') && playbackSrc !== src ? playbackSrc : null
    return () => {
      if (blobRef.current) {
        revokeMediaPreviewUrl(blobRef.current)
        blobRef.current = null
      }
    }
  }, [playbackSrc, src])

  useEffect(() => {
    setPlaying(false)
    setCurrent(0)
    setFailed(false)
    setUseRawSrc(false)
    if (durationHint > 0) setDuration(durationHint)
  }, [src, durationHint])

  function handleAudioError() {
    // 1ª falha com blob: tenta data URL original (alguns iOS falham só no blob)
    if (!useRawSrc && src && playbackSrc !== src) {
      setUseRawSrc(true)
      setFailed(false)
      return
    }
    setFailed(true)
  }

  function togglePlay(e) {
    e.stopPropagation()
    const el = audioRef.current
    if (!el || failed) return
    if (el.paused) {
      void el.play().catch(() => handleAudioError())
    } else {
      el.pause()
    }
  }

  function onSeek(e) {
    e.stopPropagation()
    const el = audioRef.current
    if (!el || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    el.currentTime = ratio * duration
    setCurrent(el.currentTime)
  }

  if (!src) {
    return (
      <div className="flex min-w-[200px] items-center gap-2 py-1 text-sm text-stone-400">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/25">
          <Play className="h-4 w-4" />
        </span>
        <span className="italic">Áudio indisponível</span>
      </div>
    )
  }

  if (failed) {
    return (
      <div className="flex min-w-[200px] items-center gap-2 py-1 text-sm text-stone-400">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/25">
          <Play className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="italic">Áudio indisponível</p>
          <button
            type="button"
            className="text-[11px] text-brand-300 underline"
            onClick={(e) => {
              e.stopPropagation()
              setFailed(false)
              setUseRawSrc((v) => !v)
            }}
          >
            Tentar novamente
          </button>
        </div>
      </div>
    )
  }

  const progress = duration > 0 ? Math.min(1, current / duration) : 0
  const timeLabel = playing || current > 0 ? formatAudioTime(current) : formatAudioTime(duration)

  return (
    <div className="flex min-w-[220px] max-w-[280px] items-center gap-2.5 py-0.5">
      <audio
        key={playbackSrc || src}
        ref={audioRef}
        src={playbackSrc || src}
        preload="metadata"
        playsInline
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setCurrent(0)
        }}
        onTimeUpdate={() => setCurrent(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => {
          const d = audioRef.current?.duration
          if (Number.isFinite(d) && d > 0) setDuration(d)
        }}
        onError={handleAudioError}
      />
      <button
        type="button"
        onClick={togglePlay}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-95 ${
          fromMe ? 'bg-white/15 text-stone-50' : 'bg-white/10 text-stone-100'
        }`}
        aria-label={playing ? 'Pausar áudio' : 'Reproduzir áudio'}
      >
        {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="ml-0.5 h-5 w-5 fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        <button type="button" className="flex w-full items-center" onClick={onSeek} aria-label="Posição do áudio">
          <StaticWave progress={progress} fromMe={fromMe} />
        </button>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="text-[11px] tabular-nums text-stone-400">{timeLabel}</span>
        </div>
      </div>
    </div>
  )
}
