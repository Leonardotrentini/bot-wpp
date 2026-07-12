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

function ConversionCard({ name, event, rule, optimization, note }) {
  return (
    <div className="rounded-lg border border-brand-800 bg-brand-950/50 p-3">
      <p className="font-medium text-stone-300">{name}</p>
      <dl className="mt-2 space-y-1 text-[11px]">
        <div className="flex gap-2">
          <dt className="shrink-0 text-stone-500">Evento:</dt>
          <dd>
            <code className="text-stone-400">{event}</code>
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-stone-500">Regra:</dt>
          <dd className="text-stone-400">{rule}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 text-stone-500">Otimização:</dt>
          <dd className="text-stone-400">{optimization}</dd>
        </div>
        {note ? <p className="mt-1 text-stone-500">{note}</p> : null}
      </dl>
    </div>
  )
}

const CHECKLIST = [
  'Pixel na LP com o mesmo ID configurado aqui no Vesto',
  'PageView + Contact (não Lead) no clique do WhatsApp na LP',
  'Integração Vesto ativa com token salvo',
  'Botão "Enviar eventos de teste" com todos ✓',
  'Conversões personalizadas criadas (passo a passo abaixo)',
  'Visão geral do Events Manager mostrando eventos via API de Conversões',
  'Colunas do funil no Ads Manager',
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
            Funil completo, padrão de dados do Vesto e como criar cada conversão personalizada no Events Manager.
          </p>
        </div>
        <ChevronDown className={`mt-1 h-5 w-5 shrink-0 text-stone-500 transition ${guideOpen ? 'rotate-180' : ''}`} />
      </button>

      {guideOpen ? (
        <div className="space-y-3 border-t border-brand-800 px-4 pb-4 pt-3">
          <Section title="O fluxo completo" defaultOpen>
            <FlowStep label="1. Anúncio Meta" detail="Campanha LP ou Click-to-WhatsApp (CTWA)." />
            <FlowStep
              label="2. Landing Page"
              detail="PageView + Contact no clique do WhatsApp. Nunca Lead no botão."
            />
            <FlowStep
              label="3. Primeira mensagem"
              detail="Vesto → ConversationStarted (1x por contato). CTWA: coluna Conversas iniciadas no Ads."
            />
            <FlowStep label="4. Tag QUALIFICADO" detail="Vesto → LeadQualified (1x por contato)." />
            <FlowStep label="5. Orçamento" detail="Vesto → Quote (1x por contato, valor em BRL)." />
            <FlowStep label="6. Compra" detail="Vesto → Purchase." />
          </Section>

          <Section title="Padrão de dados que o Vesto envia (sempre igual)">
            <p>
              Todos os eventos do funil via <strong className="text-stone-400">API de Conversões</strong> incluem:
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>
                <code className="text-stone-400">lead_event_source</code>: Vesto
              </li>
              <li>
                <code className="text-stone-400">event_source</code>: crm ou ctwa
              </li>
              <li>
                <code className="text-stone-400">content_category</code>: ver tabela abaixo
              </li>
              <li>
                <code className="text-stone-400">event_source_url</code>: https://vesto.group/dashboard/chat
              </li>
              <li>Telefone hasheado + external_id do contato</li>
              <li>CTWA: ctwa_clid + page_id · CRM: fbc quando disponível</li>
            </ul>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="border-b border-brand-800 text-stone-400">
                    <th className="pb-2 pr-3 font-medium">Evento</th>
                    <th className="pb-2 pr-3 font-medium">content_category</th>
                    <th className="pb-2 font-medium">Quando</th>
                  </tr>
                </thead>
                <tbody className="text-stone-500">
                  <tr className="border-b border-brand-800/60">
                    <td className="py-2 pr-3 text-stone-300">ConversationStarted</td>
                    <td className="py-2 pr-3">
                      <code>conversation_started</code>
                    </td>
                    <td className="py-2">1ª msg inbound · 1x</td>
                  </tr>
                  <tr className="border-b border-brand-800/60">
                    <td className="py-2 pr-3 text-stone-300">LeadQualified</td>
                    <td className="py-2 pr-3">
                      <code>qualified_lead</code>
                    </td>
                    <td className="py-2">Tag QUALIFICADO · 1x</td>
                  </tr>
                  <tr className="border-b border-brand-800/60">
                    <td className="py-2 pr-3 text-stone-300">Quote</td>
                    <td className="py-2 pr-3">
                      <code>quote</code>
                    </td>
                    <td className="py-2">Orçamento salvo · 1x</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-3 text-stone-300">Purchase</td>
                    <td className="py-2 pr-3">
                      <code>purchase</code>
                    </td>
                    <td className="py-2">Compra confirmada</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Landing Page — script Vesto + Pixel" defaultOpen>
            <ol className="list-inside list-decimal space-y-2">
              <li>
                Em <strong className="text-stone-400">Integrações → Meta</strong>, cadastre os domínios da LP (um por
                linha) e salve.
              </li>
              <li>Copie o <strong className="text-stone-400">script Vesto</strong> gerado automaticamente.</li>
              <li>
                Cole na LP antes de <code className="text-stone-400">&lt;/body&gt;</code> e adicione{' '}
                <code className="text-stone-400">data-vesto-whatsapp</code> no botão WhatsApp.
              </li>
              <li>
                Mantenha o Pixel <code className="text-stone-400">{pixelHint}</code> com PageView +{' '}
                <strong className="text-stone-400">Contact</strong> no clique.
              </li>
              <li>
                O script envia <code className="text-stone-400">fbc</code>/<code className="text-stone-400">fbp</code>{' '}
                ao Vesto e inclui <code className="text-stone-400">(vst_...)</code> na mensagem do WhatsApp.
              </li>
            </ol>
            <p className="mt-2 text-stone-500">
              CORS é liberado só para os domínios salvos na conta — cada cliente configura os seus, sem suporte manual.
            </p>
          </Section>

          <Section title="Landing Page — Pixel {pixelHint}" defaultOpen>
            <ul className="list-inside list-disc space-y-2">
              <li>
                Mesmo Pixel ID:{' '}
                <code className="rounded bg-brand-900 px-1 py-0.5 text-stone-300">{pixelHint}</code>
              </li>
              <li>PageView automático ao carregar</li>
              <li>
                <strong className="text-stone-400">Contact</strong> no clique do WhatsApp — use a ferramenta de
                eventos da Meta ou:
              </li>
            </ul>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-brand-950 p-3 text-[10px] text-stone-400">
              {`fbq('track', 'Contact');`}
            </pre>
          </Section>

          <Section title="Como criar cada conversão personalizada" defaultOpen>
            <p className="text-stone-400">
              Events Manager → seu pixel → <strong>Conversões personalizadas</strong> → Criar.
            </p>
            <p className="mt-2">
              Para eventos do <strong className="text-stone-400">Vesto (servidor)</strong>: fonte da ação = Site (única
              opção). Na regra, troque <strong className="text-stone-400">URL</strong> por{' '}
              <strong className="text-stone-400">Parâmetro do evento</strong> →{' '}
              <code className="text-stone-400">content_category</code> → contém → valor abaixo.
            </p>
            <p className="mt-2 text-stone-500">
              Se a Meta obrigar regra e não mostrar parâmetro: use URL contém{' '}
              <code className="text-stone-400">vesto.group</code> (o Vesto envia event_source_url com esse domínio).
            </p>

            <div className="mt-3 space-y-2">
              <ConversionCard
                name="Mensagem Iniciada"
                event="ConversationStarted"
                rule="content_category contém conversation_started"
                optimization="Contato"
              />
              <ConversionCard
                name="Lead Qualificado"
                event="LeadQualified"
                rule="content_category contém qualified_lead"
                optimization="Lead"
              />
              <ConversionCard
                name="Orçamento"
                event="Quote"
                rule="content_category contém quote"
                optimization="Lead"
                note="Inclui value em BRL quando há valor no orçamento."
              />
              <ConversionCard
                name="Compra"
                event="Compra (Purchase)"
                rule="content_category contém purchase — ou sem regra se permitir"
                optimization="Compra"
              />
              <ConversionCard
                name="Clique WhatsApp (LP)"
                event="Entrar em contato (Contact)"
                rule="URL contém o domínio da sua LP (ex.: baseset.vercel.app)"
                optimization="Contato"
                note="Evento do navegador na LP — não vem do Vesto."
              />
            </div>

            <p className="mt-3 rounded-lg border border-brand-800 bg-brand-950/40 p-3 text-stone-500">
              <strong className="text-stone-400">Total 0 na conversão?</strong> Normal com eventos de teste (código
              TEST…). Acompanhe em <strong className="text-stone-400">Visão geral</strong> do Events Manager. Ações
              reais (sem código de teste) alimentam campanhas.
            </p>
          </Section>

          <Section title="Testar integração">
            <ol className="list-inside list-decimal space-y-2">
              <li>
                Cole o código de teste no campo acima (ex.: TEST69842) e salve — use o{' '}
                <strong className="text-stone-400">mesmo código</strong> no Events Manager.
              </li>
              <li>
                Events Manager → <strong className="text-stone-400">Testar eventos</strong> → canal{' '}
                <strong className="text-stone-400">Offline</strong> → cole o código.
              </li>
              <li>Clique em &quot;Enviar eventos de teste&quot; no Vesto.</li>
              <li>
                Confira em <strong className="text-stone-400">Visão geral</strong> — eventos com integração &quot;API de
                Conversões&quot;.
              </li>
              <li>
                LP: canal <strong className="text-stone-400">Site</strong> → abra a LP → Contact no clique.
              </li>
            </ol>
          </Section>

          <Section title="Colunas no Ads Manager">
            <ul className="list-inside list-disc space-y-1">
              <li>
                <strong className="text-stone-400">LP:</strong> PageView, Contact, Mensagem Iniciada, Lead Qualificado,
                Orçamento, Compra
              </li>
              <li>
                <strong className="text-stone-400">Mensagem direta:</strong> Conversas por mensagem iniciadas + funil
                Vesto acima
              </li>
              <li>
                <strong className="text-stone-400">Evite</strong> a coluna genérica Leads como métrica de orçamento
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
