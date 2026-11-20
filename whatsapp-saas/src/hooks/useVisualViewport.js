import { useEffect, useState } from 'react'

/**
 * iOS Safari + teclado: sincroniza altura do shell fixed com o visualViewport.
 * - top sempre 0 (aplicar offsetTop causava “sobe e volta”)
 * - height acompanha vv.height via rAF
 * - se o Safari deslocar a página, zera scrollY (sem mexer no top do shell)
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
    let lastH = -1

    const applyToDom = () => {
      const el = shellRef?.current
      if (!el) return
      const h = Math.max(1, Math.round(vv.height))
      // top fixo 0 — offsetTop no iOS gera o salto sobe/volta ao focar o input
      el.style.top = '0px'
      if (Math.abs(h - lastH) >= 1) {
        lastH = h
        el.style.height = `${h}px`
        el.style.maxHeight = `${h}px`
      }
    }

    const apply = () => {
      raf = 0
      // Evita buraco preto se o Safari scrollar o layout por baixo do fixed
      if (window.scrollY !== 0) window.scrollTo(0, 0)
      applyToDom()

      const h = Math.max(1, Math.round(vv.height))
      const baseline = Math.max(window.innerHeight, (window.screen?.height || 0) * 0.5)
      const open = h < baseline * 0.82
      if (open !== lastOpen) {
        lastOpen = open
        setKeyboardOpen(open)
      }
    }

    const schedule = () => {
      if (raf) return
      raf = window.requestAnimationFrame(apply)
    }

    apply()
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    window.addEventListener('orientationchange', schedule)

    return () => {
      if (raf) window.cancelAnimationFrame(raf)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      window.removeEventListener('orientationchange', schedule)
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
