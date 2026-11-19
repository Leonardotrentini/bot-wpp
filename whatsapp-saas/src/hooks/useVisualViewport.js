import { useEffect, useState } from 'react'

/**
 * Espelho estável do visualViewport (iOS Safari + teclado).
 * Evita “tremor”: não reage a scroll do VV, só resize; top fixo em 0 no Chat.
 */
export function useVisualViewportHeight(enabled = true) {
  const [height, setHeight] = useState(null)
  const [offsetTop, setOffsetTop] = useState(0)
  const [keyboardOpen, setKeyboardOpen] = useState(false)

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !window.visualViewport) {
      setHeight(null)
      setOffsetTop(0)
      setKeyboardOpen(false)
      return undefined
    }

    const vv = window.visualViewport
    let raf = 0
    let lastH = -1
    let lastOpen = false

    const apply = () => {
      raf = 0
      const nextHeight = Math.max(1, Math.round(vv.height))
      // Teclado: viewport bem menor que a janela (folga p/ URL bar).
      const open = nextHeight < window.innerHeight * 0.78

      // Só atualiza se mudou de verdade — evita re-render a cada frame do teclado
      if (Math.abs(nextHeight - lastH) >= 2 || open !== lastOpen) {
        lastH = nextHeight
        lastOpen = open
        setHeight(nextHeight)
        setKeyboardOpen(open)
      }
      // offsetTop: reporta mas o Chat mobile usa top:0 (offset causa tremor no iOS)
      const nextOffset = Math.max(0, Math.round(vv.offsetTop || 0))
      setOffsetTop((prev) => (prev === nextOffset ? prev : nextOffset))
    }

    const schedule = () => {
      if (raf) return
      raf = window.requestAnimationFrame(apply)
    }

    apply()
    // NÃO escutar vv.scroll — no iOS dispara em loop com o teclado e treme a UI
    vv.addEventListener('resize', schedule)
    window.addEventListener('orientationchange', schedule)
    return () => {
      if (raf) window.cancelAnimationFrame(raf)
      vv.removeEventListener('resize', schedule)
      window.removeEventListener('orientationchange', schedule)
    }
  }, [enabled])

  return { height, offsetTop, keyboardOpen }
}
