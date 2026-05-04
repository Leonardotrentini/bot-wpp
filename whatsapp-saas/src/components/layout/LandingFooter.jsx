import { Link } from 'react-router-dom'
import { BrandLogo } from '../common/BrandLogo.jsx'

export function LandingFooter() {
  return (
    <footer className="border-t border-brand-800 bg-brand-950">
      <div className="mx-auto max-w-6xl px-4 py-12 lg:px-6">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="mb-4">
              <BrandLogo />
            </div>
            <p className="text-sm text-stone-400 max-w-md leading-relaxed">
              Automação, analytics e gestão de comunidades no WhatsApp — solução Vesto Group para infoprodutores, agências e operações que vendem em escala.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-stone-100 mb-3 font-heading">Produto</p>
            <ul className="space-y-2 text-sm text-stone-400">
              <li><a href="#funcionalidades" className="hover:text-accent-400 transition">Funcionalidades</a></li>
              <li><a href="#planos" className="hover:text-accent-400 transition">Preços</a></li>
              <li><Link to="/login" className="hover:text-accent-400 transition">Entrar</Link></li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-stone-100 mb-3 font-heading">Legal</p>
            <ul className="space-y-2 text-sm text-stone-400">
              <li><span className="cursor-default">Termos de uso</span></li>
              <li><span className="cursor-default">Privacidade</span></li>
              <li><span className="cursor-default">LGPD</span></li>
            </ul>
          </div>
        </div>
        <p className="mt-10 border-t border-brand-800 pt-8 text-center text-xs text-stone-500">
          © {new Date().getFullYear()} Vesto Group. Todos os direitos reservados.
        </p>
      </div>
    </footer>
  )
}
