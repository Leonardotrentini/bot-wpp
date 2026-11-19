import { useEffect, useState } from 'react'

/**
 * Espelho do visualViewport (iOS Safari com teclado).
 * Usar com position:fixed + top/height para grudar o chat acima do teclado.
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
    const sync = () => {
      const nextHeight = Math.round(vv.height)
      const nextOffset = Math.round(vv.offsetTop || 0)
      // Teclado: viewport visual bem menor que a janela (com folga p/ URL bar).
      const open = nextHeight < window.innerHeight * 0.75
      setHeight(nextHeight)
      setOffsetTop(nextOffset)
      setKeyboardOpen(open)
    }
    sync()
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    window.addEventListener('focusin', sync)
    window.addEventListener('focusout', sync)
    window.addEventListener('orientationchange', sync)
    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
      window.removeEventListener('focusin', sync)
      window.removeEventListener('focusout', sync)
      window.removeEventListener('orientationchange', sync)
    }
  }, [enabled])

  return { height, offsetTop, keyboardOpen }
}
