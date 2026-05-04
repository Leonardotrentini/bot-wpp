import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const KEY = 'vg_sidebar_collapsed'
const SidebarContext = createContext(null)

export function SidebarProvider({ children }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(KEY) === '1')

  useEffect(() => {
    localStorage.setItem(KEY, collapsed ? '1' : '0')
  }, [collapsed])

  const width = collapsed ? 72 : 240

  const value = useMemo(() => ({ collapsed, setCollapsed, width }), [collapsed, width])

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
}

export function useSidebar() {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error('useSidebar outside SidebarProvider')
  return ctx
}
