import { Bell, ChevronDown, LogOut, Menu, User } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useReminderAlerts } from '../../contexts/ReminderAlertsContext.jsx'
import { useSidebar } from '../../contexts/SidebarContext.jsx'
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

export function DashboardHeader({ title, hideOnMobileChatThread = false }) {
  const { user, logout } = useAuth()
  const { alerts, unreadCount, dismissAlert, goToConversation, loading } = useReminderAlerts()
  const { isMobile, toggleMobile } = useSidebar()
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

  if (hideOnMobileChatThread) return null

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-brand-800 bg-brand-950/90 px-3 backdrop-blur-md max-lg:pt-[env(safe-area-inset-top)] sm:gap-3 lg:h-16 lg:gap-4 lg:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
        {isMobile && (
          <button
            type="button"
            onClick={toggleMobile}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-stone-400 transition hover:bg-white/5 hover:text-stone-100 lg:hidden"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        <h1 className="min-w-0 truncate font-sans text-base font-semibold text-stone-100 sm:text-lg">{title || 'Painel'}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            onClick={() => {
              setNotifOpen((v) => !v)
              void ensureNotificationPermission()
            }}
            className="relative flex h-11 w-11 items-center justify-center rounded-xl text-stone-400 transition hover:bg-white/5 hover:text-stone-100"
            aria-label="Notificações"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-brand-950">
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
            className="flex min-h-11 items-center gap-1.5 rounded-xl border border-brand-700 bg-brand-900/60 py-1 pl-1.5 pr-2 text-left transition hover:border-accent-500/30 sm:gap-2 sm:py-1.5 sm:pl-2"
          >
            <UserAvatar name={user?.name} src={user?.avatar} size="sm" className="rounded-lg" />
            <span className="hidden max-w-[120px] truncate text-sm text-stone-100 sm:block">{user?.name}</span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-stone-400 transition ${open ? 'rotate-180' : ''}`} />
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
