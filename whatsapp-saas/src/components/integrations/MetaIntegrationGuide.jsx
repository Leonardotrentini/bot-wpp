import { useState } from 'react'
import { BookOpen, ChevronDown, CheckCircle2 } from 'lucide-react'

function Section({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border border-brand-800 bg-brand-950/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-stone-200">{title}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-stone-500 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? <div className="space-y-3 border-t border-brand-800 px-4 pb-4 pt-3 text-xs text-stone-500">{children}</div> : null}
    </div>
  )
}

function FlowStep({ label, detail }) {
  return (
    <div className="flex gap-2">
      <span className="mt-0.5 text-accent-400">→</span>
      <div>
        <p className="font-medium text-stone-300">{label}</p>
        <p className="mt-0.5">{detail}</p>
      </div>
    </div>
  )
}

const CHECKLIST = [
  'Pixel na LP com o mesmo ID configurado aqui no Vesto',
  'PageView disparando na LP (confira com o Pixel Helper)',
  'Evento Lead na LP ao clicar em "Falar no WhatsApp"',
  'Integração Vesto ativa com token salvo',
  'Botão "Enviar evento de teste" com todos ✓',
  'Orçamento real no chat com mensagem de sucesso da Meta',
  'Ads Manager otimizando para Purchase quando houver vendas',
]

export function MetaIntegrationGuide({ pixelId }) {
  const [guideOpen, setGuideOpen] = useState(false)
  const pixelHint = pixelId?.trim() || 'SEU_PIXEL_ID'

  return (
    <div className="rounded-xl border border-brand-800 bg-brand-950/20">
      <button
        type="button"
        onClick={() => setGuideOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-4 text-left"
      >
        <div className="rounded-lg bg-accent-500/10 p-2 text-accent-300">
          <BookOpen className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-stone-100">Guia: LP + WhatsApp + Meta</p>
          <p className="mt-1 text-xs text-stone-500">
            O que sua landing page precisa ter e como rastrear o mesmo lead até a venda — incluindo criativo e
            conjunto de anúncios.
          </p>
        </div>
        <ChevronDown className={`mt-1 h-5 w-5 shrink-0 text-stone-500 transition ${guideOpen ? 'rotate-180' : ''}`} />
      </button>

      {guideOpen ? (
        <div className="space-y-3 border-t border-brand-800 px-4 pb-4 pt-3">
          <Section title="O fluxo completo" defaultOpen>
            <FlowStep
              label="1. Anúncio Meta"
              detail="Pessoa clica no criativo. A Meta registra campanha, conjunto e anúncio."
            />
            <FlowStep
              label="2. Landing Page"
              detail="Pixel dispara PageView e Lead (clique no WhatsApp). Use o mesmo Pixel ID do Vesto."
            />
            <FlowStep label="3. WhatsApp" detail="Conversa no CRM. O Vesto identifica o contato pelo número." />
            <FlowStep
              label="4. Vesto (orçamento / compra)"
              detail="Salvar orçamento envia Lead. Confirmar compra envia Purchase para a Meta."
            />
          </Section>

          <Section title="O que sua Landing Page precisa ter">
            <ul className="list-inside list-disc space-y-2">
              <li>
                <strong className="text-stone-400">Meta Pixel</strong> com ID{' '}
                <code className="rounded bg-brand-900 px-1 py-0.5 text-stone-300">{pixelHint}</code> — o mesmo desta
                tela.
              </li>
              <li>
                <strong className="text-stone-400">PageView</strong> automático ao carregar a página.
              </li>
              <li>
                <strong className="text-stone-400">Lead</strong> ao clicar em &quot;Falar no WhatsApp&quot; ou enviar
                formulário.
              </li>
              <li>
                <strong className="text-stone-400">UTMs na URL do anúncio</strong> para identificar campanha,
                conjunto e criativo — use o <strong className="text-stone-400">gerador de URL</strong> logo acima
                deste guia.
              </li>
            </ul>
            <p>
              <strong className="text-stone-400">Recomendado:</strong> peça nome + WhatsApp na LP antes do botão. Com o
              mesmo telefone no chat, a Meta une visita na LP com orçamento/venda no Vesto.
            </p>
          </Section>

          <Section title="O que o Vesto envia automaticamente">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="border-b border-brand-800 text-stone-400">
                    <th className="pb-2 pr-3 font-medium">Ação no chat</th>
                    <th className="pb-2 pr-3 font-medium">Evento Meta</th>
                    <th className="pb-2 font-medium">Modo</th>
                  </tr>
                </thead>
                <tbody className="text-stone-500">
                  <tr className="border-b border-brand-800/60">
                    <td className="py-2 pr-3 text-stone-300">Salvar orçamento</td>
                    <td className="py-2 pr-3">Lead</td>
                    <td className="py-2">CRM (LP → WhatsApp)</td>
                  </tr>
                  <tr className="border-b border-brand-800/60">
                    <td className="py-2 pr-3 text-stone-300">Confirmar compra</td>
                    <td className="py-2 pr-3">Purchase</td>
                    <td className="py-2">CRM</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-3 text-stone-300">Anúncio Click-to-WhatsApp</td>
                    <td className="py-2 pr-3">LeadSubmitted</td>
                    <td className="py-2">CTWA (automático)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Como saber qual criativo e conjunto gerou o lead">
            <p>
              <strong className="text-stone-400">Na Meta (automático):</strong> cliques e visitas na LP aparecem no{' '}
              <strong className="text-stone-400">Gerenciador de Anúncios</strong> por anúncio, conjunto e campanha —
              desde que o Pixel esteja na LP.
            </p>
            <p className="mt-2">
              <strong className="text-stone-400">Orçamento e venda no WhatsApp:</strong> o Vesto envia telefone + ID do
              contato. A Meta tenta associar ao mesmo usuário que clicou no anúncio (match estimado).
            </p>
            <p className="mt-2">
              <strong className="text-stone-400">Para atribuição mais forte:</strong>
            </p>
            <ul className="mt-1 list-inside list-disc space-y-1">
              <li>Colete o WhatsApp na LP (mesmo número que vai chamar)</li>
              <li>Use UTMs no link do anúncio (veja seção acima)</li>
              <li>Ou use anúncio Click-to-WhatsApp direto (melhor rastreio à campanha)</li>
            </ul>
          </Section>

          <Section title="Onde ver os resultados">
            <ul className="list-inside list-disc space-y-1">
              <li>
                <strong className="text-stone-400">Visitas na LP</strong> — Gerenciador de Eventos → PageView
              </li>
              <li>
                <strong className="text-stone-400">Leads na LP</strong> — Eventos → Lead (navegador)
              </li>
              <li>
                <strong className="text-stone-400">Orçamentos no chat</strong> — Eventos → Lead (servidor / CRM)
              </li>
              <li>
                <strong className="text-stone-400">Vendas</strong> — Eventos → Purchase
              </li>
              <li>
                <strong className="text-stone-400">Qual criativo performou</strong> — Gerenciador de Anúncios →
                colunas por anúncio e conjunto
              </li>
            </ul>
          </Section>

          <div className="rounded-xl border border-brand-800 bg-brand-950/40 p-4">
            <p className="text-sm font-medium text-stone-300">Checklist antes de rodar campanha</p>
            <ul className="mt-3 space-y-2">
              {CHECKLIST.map((item) => (
                <li key={item} className="flex gap-2 text-xs text-stone-500">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone-600" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  )
}
