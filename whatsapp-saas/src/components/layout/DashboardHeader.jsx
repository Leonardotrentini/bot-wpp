import { Bell, ChevronDown, LogOut, User } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { UserAvatar } from '../common/UserAvatar.jsx'

export function DashboardHeader({ title }) {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    const fn = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('click', fn)
    return () => document.removeEventListener('click', fn)
  }, [])

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-brand-800 bg-brand-950/90 px-4 backdrop-blur-md lg:px-6">
      <h1 className="text-lg font-semibold text-stone-100 font-heading truncate">{title || 'Painel'}</h1>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="relative rounded-xl p-2 text-stone-400 hover:bg-white/5 hover:text-stone-100 transition"
          aria-label="Notificações"
        >
          <Bell className="h-5 w-5" />
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent-500" />
        </button>
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
