import { useEffect, useRef } from 'react'

/** Barras de nível de áudio durante a gravação (Web Audio API). */
export function AudioWaveform({ stream, active, barCount = 16, className = '' }) {
  const barsRef = useRef(null)
  const rafRef = useRef(null)
  const ctxRef = useRef(null)

  useEffect(() => {
    if (!active || !stream) return undefined

    let cancelled = false
    let audioCtx = null

    try {
      audioCtx = new AudioContext()
      ctxRef.current = audioCtx
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {})
      }
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 64
      analyser.smoothingTimeConstant = 0.65
      source.connect(analyser)

      const data = new Uint8Array(analyser.frequencyBinCount)

      const tick = () => {
        if (cancelled) return
        analyser.getByteFrequencyData(data)
        const bars = barsRef.current?.children
        if (bars?.length) {
          const step = Math.max(1, Math.floor(data.length / barCount))
          for (let i = 0; i < bars.length; i += 1) {
            const idx = Math.min(data.length - 1, i * step)
            const norm = data[idx] / 255
            const h = Math.max(4, Math.round(norm * 28))
            bars[i].style.height = `${h}px`
            bars[i].style.opacity = norm > 0.04 ? '1' : '0.35'
          }
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch {
      /* analyser indisponível — barras ficam estáticas */
    }

    return () => {
      cancelled = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      audioCtx?.close?.().catch(() => {})
      ctxRef.current = null
    }
  }, [active, stream, barCount])

  return (
    <div
      ref={barsRef}
      className={`flex h-8 flex-1 items-center justify-center gap-0.5 ${className}`}
      aria-hidden
    >
      {Array.from({ length: barCount }, (_, i) => (
        <span
          key={i}
          className="w-1 rounded-full bg-red-400/90 transition-[height,opacity] duration-75"
          style={{ height: 4 }}
        />
      ))}
    </div>
  )
}
