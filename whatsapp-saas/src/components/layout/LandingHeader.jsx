import { Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { useState } from 'react'
import { BrandLogo } from '../common/BrandLogo.jsx'

const links = [
  { href: '#funcionalidades', label: 'Funcionalidades' },
  { href: '#integracoes', label: 'Integrações' },
  { href: '#planos', label: 'Planos' },
]

export function LandingHeader() {
  const [open, setOpen] = useState(false)
  return (
    <header className="sticky top-0 z-50 border-b border-brand-800/80 bg-brand-950/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 lg:px-6">
        <Link to="/" className="flex items-center gap-2 min-w-0">
          <BrandLogo />
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="text-sm text-stone-300 hover:text-accent-400 transition">
              {l.label}
            </a>
          ))}
          <Link
            to="/login"
            className="rounded-xl border border-brand-700/80 px-4 py-2 text-sm font-medium text-stone-100 hover:border-accent-500/50 hover:text-accent-400 transition"
          >
            Login
          </Link>
        </nav>
        <button
          type="button"
          className="rounded-lg p-2 text-stone-100 md:hidden"
          onClick={() => setOpen(!open)}
          aria-label="Menu"
        >
          {open ? <X /> : <Menu />}
        </button>
      </div>
      {open && (
        <div className="border-t border-brand-800 bg-brand-950 px-4 py-4 md:hidden flex flex-col gap-3">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="text-stone-200" onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
          <Link to="/login" className="text-accent-400 font-medium" onClick={() => setOpen(false)}>
            Login
          </Link>
        </div>
      )}
    </header>
  )
}
