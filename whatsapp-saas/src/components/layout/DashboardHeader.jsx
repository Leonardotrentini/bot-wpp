import { Bell, ChevronDown, LogOut, Menu, User } from 'lucide-react'
import { useSidebar } from '../../contexts/SidebarContext.jsx'
import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useReminderAlerts } from '../../contexts/ReminderAlertsContext.jsx'
import { UserAvatar } from '../common/UserAvatar.jsx'
import { ensureNotificationPermission } from '../../lib/browserNotifications.js'

function formatWhen(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function DashboardHeader({ title }) {
  const { user, logout } = useAuth()
  const { isDesktop, setMobileOpen } = useSidebar()
  const { alerts, unreadCount, dismissAlert, goToConversation, loading } = useReminderAlerts()
  const [open, setOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const ref = useRef(null)
  const notifRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    const fn = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false)
    }
    document.addEventListener('click', fn)
    return () => document.removeEventListener('click', fn)
  }, [])

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-brand-800 bg-brand-950/90 px-4 backdrop-blur-md lg:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {!isDesktop && (
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="shrink-0 rounded-xl p-2 text-stone-400 transition hover:bg-white/5 hover:text-stone-100"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        <h1 className="truncate text-lg font-semibold text-stone-100 font-heading">{title || 'Painel'}</h1>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => {
              setNotifOpen((v) => !v)
              void ensureNotificationPermission()
            }}
            className="relative rounded-xl p-2 text-stone-400 hover:bg-white/5 hover:text-stone-100 transition"
            aria-label="Notificações"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-brand-950">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          {notifOpen && (
            <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-brand-700 bg-brand-900 py-2 shadow-xl">
              <div className="border-b border-brand-800 px-3 pb-2">
                <p className="text-sm font-semibold text-stone-100">Notificações</p>
                <p className="text-xs text-stone-500">Lembretes de leads</p>
              </div>
              {loading && alerts.length === 0 ? (
                <p className="px-3 py-4 text-sm text-stone-500">Carregando…</p>
              ) : alerts.length === 0 ? (
                <p className="px-3 py-4 text-sm text-stone-500">Nenhum lembrete pendente.</p>
              ) : (
                <ul className="max-h-80 overflow-y-auto">
                  {alerts.map((alert) => (
                    <li key={alert.reminderId || alert.id} className="border-b border-brand-800/80 last:border-0">
                      <button
                        type="button"
                        className="w-full px-3 py-2.5 text-left hover:bg-white/5"
                        onClick={() => {
                          goToConversation(alert)
                          setNotifOpen(false)
                        }}
                      >
                        <p className="text-sm font-medium text-stone-100">{alert.contactName || 'Lead'}</p>
                        <p className="text-xs text-stone-500">{formatWhen(alert.scheduledAt)}</p>
                        {alert.note ? <p className="mt-1 text-xs text-stone-400 line-clamp-2">{alert.note}</p> : null}
                      </button>
                      <div className="flex justify-end gap-2 px-3 pb-2">
                        <button
                          type="button"
                          className="text-[11px] text-stone-500 hover:text-stone-300"
                          onClick={() => dismissAlert(alert)}
                        >
                          Marcar como lida
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="relative" ref={ref}>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex items-center gap-2 rounded-xl border border-brand-700 bg-brand-900/60 py-1.5 pl-2 pr-2 text-left hover:border-accent-500/30 transition"
          >
            <UserAvatar name={user?.name} src={user?.avatar} size="sm" className="rounded-lg" />
            <span className="hidden max-w-[120px] truncate text-sm text-stone-100 sm:block">{user?.name}</span>
            <ChevronDown className={`h-4 w-4 text-stone-400 transition ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <div className="absolute right-0 mt-2 w-52 rounded-xl border border-brand-700 bg-brand-900 py-1 shadow-xl">
              <Link
                to="/dashboard/settings"
                className="flex items-center gap-2 px-3 py-2 text-sm text-stone-200 hover:bg-white/5"
                onClick={() => setOpen(false)}
              >
                <User className="h-4 w-4" /> Perfil
              </Link>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10"
                onClick={() => {
                  logout()
                  setOpen(false)
                  navigate('/login')
                }}
              >
                <LogOut className="h-4 w-4" /> Sair
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
