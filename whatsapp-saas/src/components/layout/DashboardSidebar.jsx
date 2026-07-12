import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  UserCircle2,
  Zap,
  Settings,
  ChevronLeft,
  ChevronRight,
  Smartphone,
  Shield,
  MessageSquare,
  Kanban,
  Plug,
  Receipt,
} from 'lucide-react'
import { useMemo } from 'react'
import { useSidebar } from '../../contexts/SidebarContext.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { BrandLogo } from '../common/BrandLogo.jsx'

const navSections = [
  {
    label: 'Principal',
    items: [
      { to: '/dashboard', label: 'Visão geral', icon: LayoutDashboard, end: true },
      { to: '/dashboard/connect', label: 'Conectar WhatsApp', icon: Smartphone },
    ],
  },
  {
    label: 'Grupos',
    items: [
      { to: '/dashboard/groups', label: 'Grupos', icon: Users },
      {
        to: '/dashboard/members',
        label: 'Membros de grupos',
        icon: UserCircle2,
        title: 'Participantes dos grupos WhatsApp (leads), não a equipe de vendas',
      },
      { to: '/dashboard/automations', label: 'Automações', icon: Zap, beta: true },
    ],
  },
  {
    label: 'CRM',
    items: [
      { to: '/dashboard/chat', label: 'Conversas', icon: MessageSquare, beta: true },
      { to: '/dashboard/crm', label: 'CRM', icon: Kanban, beta: true },
      { to: '/dashboard/sales', label: 'Vendas', icon: Receipt, beta: true },
    ],
  },
  {
    label: 'Conta',
    items: [{ to: '/dashboard/settings', label: 'Configurações', icon: Settings }],
  },
  {
    label: 'Integrações',
    ownerOnly: true,
    items: [{ to: '/dashboard/integrations', label: 'Meta / Facebook', icon: Plug, beta: true }],
  },
]

export function DashboardSidebar() {
  const { collapsed, setCollapsed } = useSidebar()
  const { isAdmin, isOrgOwner, isOrgSeller } = useAuth()

  const visibleSections = useMemo(() => {
    return navSections
      .filter((section) => !section.ownerOnly || isOrgOwner)
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => !item.ownerOnly || isOrgOwner),
      }))
      .filter((section) => section.items.length > 0)
  }, [isOrgOwner])

  return (
    <aside
      className={`fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-brand-800 bg-brand-900/98 backdrop-blur-md transition-[width] duration-300 ${
        collapsed ? 'w-[72px]' : 'w-60'
      }`}
    >
      <div className="flex h-16 items-center justify-between gap-2 border-b border-brand-800 px-2">
        {!collapsed && (
          <NavLink to="/dashboard" className="flex min-w-0 items-center px-1 py-1">
            <BrandLogo />
          </NavLink>
        )}
        {collapsed && (
          <NavLink to="/dashboard" className="mx-auto flex justify-center py-1" title="Vesto Group">
            <BrandLogo collapsed />
          </NavLink>
        )}
      </div>
      {isOrgSeller && !collapsed && (
        <div className="mx-2 mt-2 rounded-lg border border-brand-800 bg-brand-950/50 px-2 py-1.5 text-[10px] text-stone-500">
          Conta de vendedor — você vê apenas seus dados.
        </div>
      )}
      <nav className="flex-1 space-y-3 overflow-y-auto p-2">
        {visibleSections.map((section) => (
          <div key={section.label}>
            {!collapsed && (
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-stone-600">
                {section.label}
              </p>
            )}
            <div className="space-y-1">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  title={item.title || (item.beta ? `${item.label} (BETA)` : item.label)}
                  className={({ isActive }) =>
                    `relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                      isActive
                        ? 'bg-accent-500/10 text-accent-400 border border-accent-500/25 shadow-sm shadow-accent-900/20'
                        : 'text-stone-400 hover:bg-white/5 hover:text-stone-100 border border-transparent'
                    }`
                  }
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  {!collapsed && (
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="truncate">{item.label}</span>
                      {item.beta && (
                        <span className="shrink-0 rounded-md border border-amber-500/35 bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-400">
                          Beta
                        </span>
                      )}
                    </span>
                  )}
                  {collapsed && item.beta && (
                    <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
        {isAdmin && (
          <NavLink
            to="/dashboard/admin"
            title="Administração"
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                isActive
                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/25 shadow-sm'
                  : 'text-stone-400 hover:bg-white/5 hover:text-stone-100 border border-transparent'
              }`
            }
          >
            <Shield className="h-5 w-5 shrink-0 text-amber-400/90" />
            {!collapsed && <span className="truncate">Administração</span>}
          </NavLink>
        )}
      </nav>
      <div className="border-t border-brand-800 p-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-2 text-stone-400 hover:bg-white/5 hover:text-stone-100 transition"
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
          {!collapsed && <span className="text-xs">Recolher</span>}
        </button>
      </div>
    </aside>
  )
}
