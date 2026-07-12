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
  'Evento Contact (não Lead) no clique em "Falar no WhatsApp" na LP',
  'Integração Vesto ativa com token salvo',
  'Botão "Enviar eventos de teste" com todos os eventos ✓',
  'Conversões personalizadas criadas no Events Manager (ConversationStarted, LeadQualified, Quote, Purchase)',
  'Ads Manager com colunas separadas por etapa do funil',
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
            Funil separado por evento — cada etapa mensurável no Ads Manager sem misturar clique, conversa,
            qualificação e orçamento.
          </p>
        </div>
        <ChevronDown className={`mt-1 h-5 w-5 shrink-0 text-stone-500 transition ${guideOpen ? 'rotate-180' : ''}`} />
      </button>

      {guideOpen ? (
        <div className="space-y-3 border-t border-brand-800 px-4 pb-4 pt-3">
          <Section title="O fluxo completo" defaultOpen>
            <FlowStep
              label="1. Anúncio Meta"
              detail="Pessoa clica no criativo. Campanha LP ou Click-to-WhatsApp (CTWA)."
            />
            <FlowStep
              label="2. Landing Page (se houver)"
              detail="Pixel dispara PageView + Contact no clique do WhatsApp. Não use Lead no botão — Lead polui a métrica de orçamento."
            />
            <FlowStep
              label="3. Primeira mensagem no WhatsApp"
              detail="Vesto envia ConversationStarted (1x por contato). CTWA: também aparece em Conversas iniciadas no Ads."
            />
            <FlowStep
              label="4. Tag QUALIFICADO"
              detail="Ao marcar o lead como qualificado, Vesto envia LeadQualified (1x por contato)."
            />
            <FlowStep
              label="5. Orçamento no chat"
              detail="Salvar orçamento envia Quote (1x por contato, com valor em BRL)."
            />
            <FlowStep label="6. Compra confirmada" detail="Vesto envia Purchase para a Meta." />
          </Section>

          <Section title="O que sua Landing Page precisa ter">
            <ul className="list-inside list-disc space-y-2">
              <li>
                <strong className="text-stone-400">Meta Pixel</strong> com ID{' '}
                <code className="rounded bg-brand-900 px-1 py-0.5 text-stone-300">{pixelHint}</code>
              </li>
              <li>
                <strong className="text-stone-400">PageView</strong> automático ao carregar.
              </li>
              <li>
                <strong className="text-stone-400">Contact</strong> ao clicar em &quot;Falar no WhatsApp&quot; —{' '}
                <em>não</em> dispare Lead no clique.
              </li>
              <li>
                <strong className="text-stone-400">UTMs</strong> no link do anúncio — use o gerador de URL acima.
              </li>
            </ul>
            <p className="mt-2">
              <strong className="text-stone-400">Snippet recomendado no botão:</strong>
            </p>
            <pre className="mt-1 overflow-x-auto rounded-lg bg-brand-950 p-3 text-[10px] text-stone-400">
{`fbq('track', 'Contact');`}
            </pre>
          </Section>

          <Section title="O que o Vesto envia automaticamente (API servidor)">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="border-b border-brand-800 text-stone-400">
                    <th className="pb-2 pr-3 font-medium">Ação no CRM</th>
                    <th className="pb-2 pr-3 font-medium">Evento Meta</th>
                    <th className="pb-2 font-medium">Frequência</th>
                  </tr>
                </thead>
                <tbody className="text-stone-500">
                  <tr className="border-b border-brand-800/60">
                    <td className="py-2 pr-3 text-stone-300">1ª mensagem inbound (contato novo)</td>
                    <td className="py-2 pr-3">ConversationStarted</td>
                    <td className="py-2">1x por contato</td>
                  </tr>
                  <tr className="border-b border-brand-800/60">
                    <td className="py-2 pr-3 text-stone-300">Tag QUALIFICADO</td>
                    <td className="py-2 pr-3">LeadQualified</td>
                    <td className="py-2">1x por contato</td>
                  </tr>
                  <tr className="border-b border-brand-800/60">
                    <td className="py-2 pr-3 text-stone-300">Salvar orçamento</td>
                    <td className="py-2 pr-3">Quote</td>
                    <td className="py-2">1x por contato</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-3 text-stone-300">Confirmar compra</td>
                    <td className="py-2 pr-3">Purchase</td>
                    <td className="py-2">Cada compra</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2">
              CTWA usa <code className="text-stone-400">business_messaging</code> + ctwa_clid. LP/orgânico usa{' '}
              <code className="text-stone-400">system_generated</code> + telefone (e fbc quando disponível).
            </p>
          </Section>

          <Section title="Conversões personalizadas no Events Manager">
            <p>Crie uma conversão por evento (sem regra de URL nos eventos servidor):</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>
                <strong className="text-stone-400">Vesto - Conversation Started</strong> → evento{' '}
                <code className="text-stone-400">ConversationStarted</code>
              </li>
              <li>
                <strong className="text-stone-400">Vesto - Lead Qualified</strong> →{' '}
                <code className="text-stone-400">LeadQualified</code> · otimização: Lead
              </li>
              <li>
                <strong className="text-stone-400">Vesto - Quote</strong> → <code className="text-stone-400">Quote</code>{' '}
                · otimização: Lead
              </li>
              <li>
                <strong className="text-stone-400">Vesto - Purchase</strong> →{' '}
                <code className="text-stone-400">Purchase</code> · otimização: Compra
              </li>
              <li>
                <strong className="text-stone-400">LP - Click WhatsApp</strong> →{' '}
                <code className="text-stone-400">Contact</code> (Pixel navegador)
              </li>
            </ul>
          </Section>

          <Section title="Colunas no Ads Manager">
            <ul className="list-inside list-disc space-y-1">
              <li>
                <strong className="text-stone-400">Campanha LP:</strong> PageView, Contact, conversões Vesto
                (ConversationStarted → LeadQualified → Quote → Purchase)
              </li>
              <li>
                <strong className="text-stone-400">Campanha mensagem (CTWA):</strong> Conversas por mensagem
                iniciadas + conversões Vesto acima
              </li>
              <li>
                <strong className="text-stone-400">Não use</strong> a coluna genérica Leads como métrica principal
                de orçamento
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
