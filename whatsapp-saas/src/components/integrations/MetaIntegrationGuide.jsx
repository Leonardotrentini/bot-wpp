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
  'Conversões personalizadas no dataset WhatsApp (CTWA) ou no Pixel (LP)',
  'Visão geral do Events Manager mostrando eventos via API de Conversões',
  'Colunas do funil no Ads Manager',
]

export function MetaIntegrationGuide({ pixelId, wabaId, wabaDatasetId, wabaDatasetError }) {
  const [guideOpen, setGuideOpen] = useState(false)
  const pixelHint = pixelId?.trim() || 'SEU_PIXEL_ID'
  const wabaHint = wabaId?.trim() || 'SEU_WABA_ID'
  const datasetHint = wabaDatasetId?.trim() || null

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
              <li>CTWA: ctwa_clid + whatsapp_business_account_id (WABA) · CRM: fbc quando disponível</li>
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

          <Section title="Landing Page — prompt Vesto + mensagem limpa" defaultOpen>
            <ol className="list-inside list-decimal space-y-2">
              <li>
                Cadastre <strong className="text-stone-400">domínios</strong>,{' '}
                <strong className="text-stone-400">vendedores</strong> e mensagem → salve.
              </li>
              <li>
                Copie o <strong className="text-stone-400">prompt para IA</strong> e cole no projeto da LP.
              </li>
              <li>
                A mensagem do WhatsApp fica <strong className="text-stone-400">limpa</strong> — sem códigos
                técnicos. A atribuição Meta é silenciosa (POST no clique + CRM na 1ª mensagem).
              </li>
              <li>
                Botões com <code className="text-stone-400">data-vesto-whatsapp</code> — só o script Vesto, sem JS
                custom.
              </li>
              <li>
                Pixel <code className="text-stone-400">{pixelHint}</code>: PageView + Contact no clique.
              </li>
            </ol>
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

          <Section title="⚠️ Anúncio WhatsApp (CTWA): use o dataset do WABA, não o Pixel" defaultOpen>
            <p>
              Se seus anúncios são <strong className="text-stone-400">Click-to-WhatsApp</strong>, o Vesto envia Lead
              Qualificado, Orçamento e Compra para o <strong className="text-stone-400">dataset da conta WhatsApp</strong>
              , não para o Pixel da LP.
            </p>
            <p className="mt-2">
              Por isso <strong className="text-stone-400">Compra</strong> pode aparecer no Ads Manager (métrica padrão da
              Meta) enquanto <strong className="text-stone-400">Lead Qualificado</strong> e{' '}
              <strong className="text-stone-400">Orçamento</strong> ficam &quot;—&quot;: as conversões personalizadas
              foram criadas no Pixel errado.
            </p>
            <ol className="mt-3 list-inside list-decimal space-y-2">
              <li>
                Events Manager → <strong className="text-stone-400">Fontes de dados</strong>
              </li>
              <li>
                Selecione a conta WhatsApp (WABA{' '}
                <code className="text-stone-400">{wabaHint}</code>
                ) — não o Pixel <code className="text-stone-400">{pixelHint}</code>
              </li>
              <li>
                Aba <strong className="text-stone-400">Conversões personalizadas</strong> → crie Lead Qualificado e
                Orçamento com regra <code className="text-stone-400">content_category</code> (passo a passo abaixo)
              </li>
              <li>
                No Ads Manager → Personalizar colunas → busque o nome da conversão criada no{' '}
                <strong className="text-stone-400">dataset WhatsApp</strong>
              </li>
            </ol>
            {datasetHint ? (
              <p className="mt-3 rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-3 text-stone-400">
                <strong className="text-emerald-200/90">Dataset WhatsApp desta conta:</strong>{' '}
                <code className="text-stone-300">{datasetHint}</code> — use esta fonte no Events Manager.
              </p>
            ) : wabaId?.trim() ? (
              <p className="mt-3 rounded-lg border border-amber-900/40 bg-amber-950/20 p-3 text-stone-500">
                {wabaDatasetError ||
                  'Salve o token e o WABA acima para o Vesto buscar o ID do dataset WhatsApp automaticamente.'}
              </p>
            ) : (
              <p className="mt-3 rounded-lg border border-amber-900/40 bg-amber-950/20 p-3 text-stone-500">
                Configure o <strong className="text-stone-400">ID da conta WhatsApp (WABA)</strong> acima — sem ele,
                eventos de anúncio WhatsApp não são enviados corretamente.
              </p>
            )}
          </Section>

          <Section title="Como criar cada conversão personalizada" defaultOpen>
            <p className="text-stone-400">
              Events Manager → fonte de dados correta (Pixel da LP <strong>ou</strong> dataset WhatsApp acima) →{' '}
              <strong>Conversões personalizadas</strong> → Criar.
            </p>
            <p className="mt-2">
              Para eventos do <strong className="text-stone-400">Vesto (servidor)</strong>: na regra use{' '}
              <strong className="text-stone-400">Parâmetro do evento</strong> →{' '}
              <code className="text-stone-400">content_category</code> → contém → valor abaixo. Assim vale para LP e
              anúncio WhatsApp (CTWA).
            </p>
            <p className="mt-2 rounded-lg border border-amber-900/40 bg-amber-950/20 p-3 text-stone-500">
              <strong className="text-amber-200/90">Anúncio Click-to-WhatsApp:</strong> a Meta não aceita os nomes{' '}
              <code className="text-stone-400">LeadQualified</code> / <code className="text-stone-400">Quote</code>.
              O Vesto envia <code className="text-stone-400">QualifiedLead</code> e{' '}
              <code className="text-stone-400">InitiateCheckout</code> — mas o{' '}
              <code className="text-stone-400">content_category</code> continua igual. Se a conversão personalizada
              filtrar só pelo nome <code className="text-stone-400">Quote</code>, orçamento fica &quot;—&quot; na
              campanha. <strong className="text-stone-400">Purchase</strong> funciona nos dois fluxos (mesmo nome).
            </p>
            <p className="mt-2 text-stone-500">
              LP (servidor, modo CRM): fonte da ação costuma aparecer como Site. CTWA: mensagem (business_messaging).
              Por isso a regra por <code className="text-stone-400">content_category</code> é mais confiável que filtrar
              só pelo nome do evento.
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
                event="LeadQualified (LP) · QualifiedLead (anúncio WhatsApp)"
                rule="content_category contém qualified_lead — não filtre só LeadQualified"
                optimization="Lead"
              />
              <ConversionCard
                name="Orçamento"
                event="Quote (LP) · InitiateCheckout (anúncio WhatsApp)"
                rule="content_category contém quote — não filtre só Quote"
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
