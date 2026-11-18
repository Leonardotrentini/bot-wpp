import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const KEY = 'vg_sidebar_collapsed'
const MOBILE_MQ = '(max-width: 1023px)'
const SidebarContext = createContext(null)

export function SidebarProvider({ children }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(KEY) === '1')
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(MOBILE_MQ).matches
      : false,
  )
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem(KEY, collapsed ? '1' : '0')
  }, [collapsed])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mql = window.matchMedia(MOBILE_MQ)
    const onChange = () => {
      const next = mql.matches
      setIsMobile(next)
      if (!next) setMobileOpen(false)
    }
    onChange()
    if (mql.addEventListener) mql.addEventListener('change', onChange)
    else mql.addListener(onChange)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange)
      else mql.removeListener(onChange)
    }
  }, [])

  useEffect(() => {
    if (!isMobile || !mobileOpen) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [isMobile, mobileOpen])

  const openMobile = useCallback(() => setMobileOpen(true), [])
  const closeMobile = useCallback(() => setMobileOpen(false), [])
  const toggleMobile = useCallback(() => setMobileOpen((v) => !v), [])

  /** Largura reservada no layout: no mobile a sidebar é overlay (0). Desktop inalterado. */
  const width = isMobile ? 0 : collapsed ? 72 : 240

  const value = useMemo(
    () => ({
      collapsed,
      setCollapsed,
      width,
      isMobile,
      mobileOpen,
      setMobileOpen,
      openMobile,
      closeMobile,
      toggleMobile,
    }),
    [collapsed, width, isMobile, mobileOpen, openMobile, closeMobile, toggleMobile],
  )

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
}

export function useSidebar() {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error('useSidebar outside SidebarProvider')
  return ctx
}
