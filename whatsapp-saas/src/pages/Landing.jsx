import { Link } from 'react-router-dom'
import {
  Zap,
  LayoutGrid,
  Shield,
  Sparkles,
  BarChart3,
  Users,
  Plug,
  GitBranch,
  Play,
  Check,
} from 'lucide-react'
import { LandingHeader } from '../components/layout/LandingHeader.jsx'
import { LandingFooter } from '../components/layout/LandingFooter.jsx'
import { Button } from '../components/common/Button.jsx'
import { Card } from '../components/common/Card.jsx'
import { Accordion } from '../components/common/Accordion.jsx'
import { featureCards, mockTestimonials, mockFaq, mockPlans, avatar } from '../utils/mockData.js'

const iconMap = { Zap, LayoutGrid, Shield, Sparkles, BarChart3, Users, Plug, GitBranch }

export function Landing() {
  return (
    <div className="min-h-screen bg-brand-950">
      <LandingHeader />

      <section className="relative overflow-hidden border-b border-brand-800">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-accent-500/10 via-brand-900/50 to-brand-950" />
        <div className="relative mx-auto max-w-6xl px-4 py-16 lg:px-6 lg:py-24">
          <div className="flex flex-wrap gap-2 mb-6">
            {['Automação', 'Dashboards', 'Segurança'].map((b) => (
              <span
                key={b}
                className="rounded-full border border-accent-500/30 bg-accent-500/10 px-3 py-1 text-xs font-medium text-accent-300"
              >
                {b}
              </span>
            ))}
          </div>
          <h1 className="max-w-4xl text-3xl font-bold leading-tight text-stone-50 sm:text-4xl lg:text-5xl">
            Automatize seus grupos e comunidades do WhatsApp para gerar vendas no piloto automático
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-stone-400 leading-relaxed">
            Disparos automáticos, IA para acelerar respostas, dashboards em tempo real e suporte que entende comunidade —
            na experiência premium <span className="text-accent-400 font-medium">Vesto Group</span>.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link to="/register">
              <Button size="lg" className="uppercase tracking-wide">
                Começar agora!
              </Button>
            </Link>
            <a href="#funcionalidades">
              <Button variant="outline" size="lg">
                Ver funcionalidades
              </Button>
            </a>
          </div>
          <div className="mt-16 aspect-video max-w-3xl overflow-hidden rounded-2xl border border-brand-800 bg-brand-900/60 shadow-2xl shadow-black/40 ring-1 ring-accent-500/10">
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-4 p-8 text-center sm:min-h-[320px]">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-500/20 text-accent-400">
                <Play className="h-8 w-8" fill="currentColor" />
              </div>
              <p className="text-sm text-stone-500">Vídeo demonstrativo — placeholder</p>
            </div>
          </div>
        </div>
      </section>

      <section id="funcionalidades" className="scroll-mt-20 border-b border-brand-800 py-20">
        <div className="mx-auto max-w-6xl px-4 lg:px-6">
          <h2 className="text-center text-2xl font-bold text-stone-50 sm:text-3xl">Funcionalidades</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-stone-400">
            Da captura ao pós-venda: ferramentas para escalar sem perder o toque humano.
          </p>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {featureCards.map((f) => {
              const Icon = iconMap[f.icon] || Sparkles
              return (
                <Card key={f.title} className="group hover:border-accent-500/20">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400 transition group-hover:bg-accent-500/25">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="font-semibold text-stone-100 font-heading">{f.title}</h3>
                  <p className="mt-2 text-sm text-stone-400 leading-relaxed">{f.desc}</p>
                </Card>
              )
            })}
          </div>
        </div>
      </section>

      <section id="integracoes" className="scroll-mt-20 border-b border-brand-800 py-20">
        <div className="mx-auto max-w-6xl px-4 lg:px-6">
          <h2 className="text-2xl font-bold text-stone-50 sm:text-3xl">Integrações nativas</h2>
          <p className="mt-3 max-w-2xl text-stone-400">
            Hotmart, Kiwify, Eduzz, Google Sheets, Zapier e API própria — conecte sua stack de vendas.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            {['Hotmart', 'Kiwify', 'Eduzz', 'Google Sheets', 'Zapier', 'API REST'].map((x) => (
              <span key={x} className="rounded-xl border border-brand-700 bg-brand-900/50 px-4 py-2 text-sm text-stone-300">
                {x}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-brand-800 py-20">
        <div className="mx-auto max-w-6xl px-4 lg:px-6">
          <h2 className="text-center text-2xl font-bold text-stone-50 sm:text-3xl">Quem usa, recomenda</h2>
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {mockTestimonials.map((t) => (
              <Card key={t.name}>
                <div className="flex items-center gap-3">
                  <img src={avatar(t.seed)} alt="" className="h-12 w-12 rounded-full border border-brand-700" />
                  <div>
                    <p className="font-medium text-stone-100">{t.name}</p>
                    <p className="text-xs text-stone-500">{t.role}</p>
                  </div>
                </div>
                <p className="mt-4 text-sm text-stone-400 leading-relaxed">&ldquo;{t.text}&rdquo;</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="planos" className="scroll-mt-20 border-b border-brand-800 py-20">
        <div className="mx-auto max-w-6xl px-4 lg:px-6">
          <h2 className="text-center text-2xl font-bold text-stone-50 sm:text-3xl">Planos e preços</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-stone-400">Escolha o plano ideal para o tamanho da sua operação.</p>
          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            {mockPlans.map((p) => (
              <Card
                key={p.name}
                className={`relative flex flex-col ${p.highlighted ? 'border-accent-500/40 ring-1 ring-accent-500/30' : ''}`}
              >
                {p.highlighted && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent-500 px-3 py-0.5 text-xs font-semibold text-brand-950">
                    Mais popular
                  </span>
                )}
                <h3 className="text-xl font-bold text-stone-50 font-heading">{p.name}</h3>
                <p className="text-sm text-stone-500">{p.desc}</p>
                <p className="mt-4 text-3xl font-bold text-accent-400">
                  {p.price}
                  <span className="text-base font-normal text-stone-500">{p.period}</span>
                </p>
                <ul className="mt-6 flex-1 space-y-2">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-stone-300">
                      <Check className="h-4 w-4 shrink-0 text-accent-500" /> {f}
                    </li>
                  ))}
                </ul>
                <Link to="/register" className="mt-8 block">
                  <Button variant={p.highlighted ? 'primary' : 'secondary'} className="w-full">
                    Assinar
                  </Button>
                </Link>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="mx-auto max-w-3xl px-4 lg:px-6">
          <h2 className="text-center text-2xl font-bold text-stone-50 sm:text-3xl">Perguntas frequentes</h2>
          <div className="mt-10">
            <Accordion items={mockFaq} />
          </div>
        </div>
      </section>

      <LandingFooter />
    </div>
  )
}
