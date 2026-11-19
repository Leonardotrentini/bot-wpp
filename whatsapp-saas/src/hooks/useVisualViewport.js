import { useEffect, useState } from 'react'

/**
 * iOS Safari + teclado: sincroniza um shell `position:fixed` com o visualViewport.
 * - Aplica top/height no DOM via ref (sem re-render a cada frame → sem tremor)
 * - Expõe só `keyboardOpen` no React (padding do composer etc.)
 *
 * @param {boolean} enabled
 * @param {React.RefObject<HTMLElement|null>} [shellRef]
 */
export function useVisualViewportHeight(enabled = true, shellRef = null) {
  const [keyboardOpen, setKeyboardOpen] = useState(false)

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setKeyboardOpen(false)
      return undefined
    }

    const vv = window.visualViewport
    if (!vv) {
      setKeyboardOpen(false)
      return undefined
    }

    let raf = 0
    let lastOpen = false
    let settleTimer = 0

    const applyToDom = () => {
      const el = shellRef?.current
      if (!el) return
      const h = Math.max(1, Math.round(vv.height))
      const top = Math.max(0, Math.round(vv.offsetTop || 0))
      el.style.top = `${top}px`
      el.style.height = `${h}px`
      el.style.maxHeight = `${h}px`
    }

    const apply = () => {
      raf = 0
      applyToDom()

      const h = Math.max(1, Math.round(vv.height))
      // Com interactive-widget=resizes-content, innerHeight também encolhe —
      // comparar com screen.height é mais estável no iOS.
      const baseline = Math.max(window.innerHeight, window.screen?.height ? window.screen.height * 0.5 : 0)
      const open = h < baseline * 0.82

      if (open !== lastOpen) {
        lastOpen = open
        setKeyboardOpen(open)
      }
    }

    const schedule = () => {
      if (raf) return
      raf = window.requestAnimationFrame(apply)
      // Reaplica ao final da animação do teclado (valores finais do Safari)
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        applyToDom()
        apply()
      }, 180)
    }

    apply()
    vv.addEventListener('resize', schedule)
    // scroll do VV é necessário p/ offsetTop (grudar no teclado); DOM direto evita tremor do React
    vv.addEventListener('scroll', schedule)
    window.addEventListener('orientationchange', schedule)
    // Foco no input: iOS desloca o VV — reaplica já na hora
    window.addEventListener('focusin', schedule)
    window.addEventListener('focusout', schedule)

    return () => {
      if (raf) window.cancelAnimationFrame(raf)
      window.clearTimeout(settleTimer)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      window.removeEventListener('orientationchange', schedule)
      window.removeEventListener('focusin', schedule)
      window.removeEventListener('focusout', schedule)
      const el = shellRef?.current
      if (el) {
        el.style.top = ''
        el.style.height = ''
        el.style.maxHeight = ''
      }
    }
  }, [enabled, shellRef])

  return { keyboardOpen }
}
