import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  UserCircle2,
  Zap,
  BarChart3,
  Plug,
  Settings,
  ChevronLeft,
  ChevronRight,
  Smartphone,
  Shield,
} from 'lucide-react'
import { useSidebar } from '../../contexts/SidebarContext.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { BrandLogo } from '../common/BrandLogo.jsx'

const nav = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/dashboard/connect', label: 'Conectar WhatsApp', icon: Smartphone },
  { to: '/dashboard/groups', label: 'Grupos', icon: Users },
  { to: '/dashboard/automations', label: 'Automações', icon: Zap },
  { to: '/dashboard/members', label: 'Membros', icon: UserCircle2 },
  { to: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/dashboard/integrations', label: 'Integrações', icon: Plug },
  { to: '/dashboard/settings', label: 'Configurações', icon: Settings },
]

export function DashboardSidebar() {
  const { collapsed, setCollapsed } = useSidebar()
  const { isAdmin } = useAuth()

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
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            title={item.label}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                isActive
                  ? 'bg-accent-500/10 text-accent-400 border border-accent-500/25 shadow-sm shadow-accent-900/20'
                  : 'text-stone-400 hover:bg-white/5 hover:text-stone-100 border border-transparent'
              }`
            }
          >
            <item.icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </NavLink>
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
