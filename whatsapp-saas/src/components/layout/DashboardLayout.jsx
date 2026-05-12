import { Outlet, useLocation } from 'react-router-dom'
import { DashboardSidebar } from './DashboardSidebar.jsx'
import { DashboardHeader } from './DashboardHeader.jsx'
import { useMemo } from 'react'
import { useSidebar } from '../../contexts/SidebarContext.jsx'

const titles = {
  '/dashboard': 'Dashboard',
  '/dashboard/connect': 'Conectar WhatsApp',
  '/dashboard/groups': 'Grupos',
  '/dashboard/messages': 'Mensagens',
  '/dashboard/automations': 'Automações',
  '/dashboard/members': 'Membros',
  '/dashboard/analytics': 'Analytics',
  '/dashboard/integrations': 'Integrações',
  '/dashboard/settings': 'Configurações',
  '/dashboard/admin': 'Administração',
}

export function DashboardLayout() {
  const { pathname } = useLocation()
  const { width } = useSidebar()

  const title = useMemo(() => {
    if (pathname.startsWith('/dashboard/groups/') && pathname !== '/dashboard/groups') return 'Detalhes do grupo'
    return titles[pathname] || 'Painel'
  }, [pathname])

  return (
    <div className="min-h-screen bg-brand-950">
      <DashboardSidebar />
      <div className="transition-[margin] duration-300" style={{ marginLeft: width }}>
        <DashboardHeader title={title} />
        <main className="p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
