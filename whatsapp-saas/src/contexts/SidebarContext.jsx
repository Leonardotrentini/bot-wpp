import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useMediaQuery } from '../hooks/useMediaQuery.js'

const KEY = 'vg_sidebar_collapsed'
const SidebarContext = createContext(null)

export function SidebarProvider({ children }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(KEY) === '1')
  const [mobileOpen, setMobileOpen] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  useEffect(() => {
    localStorage.setItem(KEY, collapsed ? '1' : '0')
  }, [collapsed])

  useEffect(() => {
    if (isDesktop) setMobileOpen(false)
  }, [isDesktop])

  useEffect(() => {
    if (!mobileOpen || isDesktop) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [mobileOpen, isDesktop])

  const width = isDesktop ? (collapsed ? 72 : 240) : 0

  const value = useMemo(
    () => ({
      collapsed,
      setCollapsed,
      width,
      mobileOpen,
      setMobileOpen,
      isDesktop,
      closeMobile: () => setMobileOpen(false),
    }),
    [collapsed, width, mobileOpen, isDesktop],
  )

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
}

export function useSidebar() {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error('useSidebar outside SidebarProvider')
  return ctx
}
