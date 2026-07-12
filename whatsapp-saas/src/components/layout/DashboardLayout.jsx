import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { DashboardSidebar } from './DashboardSidebar.jsx'
import { DashboardHeader } from './DashboardHeader.jsx'
import { ReminderAlertsProvider } from '../../contexts/ReminderAlertsContext.jsx'
import { MetaPixelLoader } from '../integrations/MetaPixelLoader.jsx'
import { useMemo } from 'react'
import { useSidebar } from '../../contexts/SidebarContext.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { resolveUseRealApi } from '../../lib/runtimeEnv.js'
import { Button } from '../common/Button.jsx'
import { Eye } from 'lucide-react'

const titles = {
  '/dashboard': 'Visão geral',
  '/dashboard/connect': 'Conectar WhatsApp',
  '/dashboard/groups': 'Grupos',
  '/dashboard/chat': 'Conversas',
  '/dashboard/crm': 'CRM',
  '/dashboard/messages': 'Mensagens',
  '/dashboard/automations': 'Automações',
  '/dashboard/members': 'Membros de grupos',
  '/dashboard/team': 'Equipe',
  '/dashboard/integrations': 'Integrações',
  '/dashboard/settings': 'Configurações',
  '/dashboard/admin': 'Administração',
}

export function DashboardLayout() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { width } = useSidebar()
  const { isImpersonating, impersonation, exitImpersonation } = useAuth()
  const demoMode = !resolveUseRealApi()

  const title = useMemo(() => {
    if (pathname.startsWith('/dashboard/groups/') && pathname !== '/dashboard/groups') return 'Detalhes do grupo'
    if (pathname.startsWith('/dashboard/automations/library')) return 'Automações · Biblioteca'
    if (pathname.startsWith('/dashboard/automations/cadences')) return 'Automações · Cadências'
    if (pathname.startsWith('/dashboard/automations')) return 'Automações'
    return titles[pathname] || 'Painel'
  }, [pathname])

  return (
    <ReminderAlertsProvider>
      <MetaPixelLoader />
      <div className="min-h-screen bg-brand-950">
        <DashboardSidebar />
        <div className="transition-[margin] duration-300" style={{ marginLeft: width }}>
        {demoMode && (
          <div className="sticky top-0 z-40 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 backdrop-blur-md lg:px-6">
            <p className="text-sm text-amber-100">
              Modo demonstração — dados simulados. Em produção o painel usa a API real automaticamente.
            </p>
          </div>
        )}
        {isImpersonating && (
          <div className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 border-b border-accent-500/30 bg-accent-500/10 px-4 py-2.5 backdrop-blur-md lg:px-6">
            <p className="inline-flex items-center gap-2 text-sm text-accent-200">
              <Eye className="h-4 w-4 shrink-0" />
              Visualizando conta de <strong className="font-semibold text-accent-100">{impersonation?.name}</strong>
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                exitImpersonation()
                navigate('/dashboard/admin')
              }}
            >
              Voltar ao admin
            </Button>
          </div>
        )}
        <DashboardHeader title={title} />
        <main className="p-4 lg:p-6">
          <Outlet />
        </main>
        </div>
      </div>
    </ReminderAlertsProvider>
  )
}
