import { useEffect, useState } from 'react'

/**
 * Altura útil do visualViewport (iOS Safari com teclado).
 * Retorna null quando a API não existe ou não há offset relevante.
 */
export function useVisualViewportHeight(enabled = true) {
  const [height, setHeight] = useState(null)
  const [offsetTop, setOffsetTop] = useState(0)

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !window.visualViewport) {
      setHeight(null)
      setOffsetTop(0)
      return undefined
    }

    const vv = window.visualViewport
    const sync = () => {
      setHeight(Math.round(vv.height))
      setOffsetTop(Math.round(vv.offsetTop || 0))
    }
    sync()
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    window.addEventListener('focusin', sync)
    window.addEventListener('focusout', sync)
    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
      window.removeEventListener('focusin', sync)
      window.removeEventListener('focusout', sync)
    }
  }, [enabled])

  return { height, offsetTop }
}
