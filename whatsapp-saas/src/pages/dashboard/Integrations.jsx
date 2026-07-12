import { useCallback, useEffect, useState } from 'react'
import { Megaphone, Loader2, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react'
import { Card } from '../../components/common/Card.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { Toggle } from '../../components/common/Toggle.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { getMetaIntegration, saveMetaIntegration, saveMetaLpSettings, testMetaIntegration } from '../../services/api.js'
import { initMetaPixel } from '../../lib/metaPixel.js'
import { MetaIntegrationGuide } from '../../components/integrations/MetaIntegrationGuide.jsx'
import { MetaAdsPanel } from '../../components/integrations/MetaAdsPanel.jsx'
import { MetaLpAttributionPanel } from '../../components/integrations/MetaLpAttributionPanel.jsx'
import { UtmUrlGenerator } from '../../components/integrations/UtmUrlGenerator.jsx'
import { parseSellersFromIntegration, sellersToPayload, validateSellers } from '../../lib/lpSellers.js'

function originsToText(origins) {
  if (!Array.isArray(origins) || !origins.length) return ''
  return origins.join('\n')
}

function parseOriginsText(text) {
  return String(text || '')
    .split(/[\n,;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function formatWhen(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function Integrations() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResults, setTestResults] = useState(null)
  const [form, setForm] = useState({
    pixelId: '',
    facebookPageId: '',
    accessToken: '',
    enabled: true,
    sendQuotes: true,
    sendPurchases: true,
    testEventCode: '',
    adAccountId: '',
    adsAccessToken: '',
    adsEnabled: false,
    allowedOriginsText: '',
    lpSellers: [{ id: '1', label: '', phone: '' }],
    lpRotatorMode: 'sequential',
    lpWhatsappMsg: 'Olá! Vim pelo site e quero mais informações.',
  })
  const [meta, setMeta] = useState(null)
  const [showSellerErrors, setShowSellerErrors] = useState(false)
  const [savingLp, setSavingLp] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await getMetaIntegration()
      const integration = data.integration
      setMeta(integration)
      if (integration) {
        setForm({
          pixelId: integration.pixelId || '',
          facebookPageId: integration.facebookPageId || '',
          accessToken: '',
          enabled: integration.enabled !== false,
          sendQuotes: integration.sendQuotes !== false,
          sendPurchases: integration.sendPurchases !== false,
          testEventCode: integration.testEventCode || '',
          adAccountId: integration.adAccountId || '',
          adsAccessToken: '',
          adsEnabled: integration.adsEnabled === true,
          allowedOriginsText: originsToText(integration.allowedOrigins),
          lpSellers: parseSellersFromIntegration(integration),
          lpRotatorMode: integration.lpRotatorMode || 'sequential',
          lpWhatsappMsg: integration.lpWhatsappMsg || 'Olá! Vim pelo site e quero mais informações.',
        })
        if (integration.enabled && integration.pixelId) {
          initMetaPixel(integration.pixelId)
        }
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao carregar integração.')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload = {
        pixelId: form.pixelId.trim(),
        facebookPageId: form.facebookPageId.trim() || null,
        enabled: form.enabled,
        sendQuotes: form.sendQuotes,
        sendPurchases: form.sendPurchases,
        testEventCode: form.testEventCode.trim() || null,
        adAccountId: form.adAccountId.trim() || null,
        adsEnabled: form.adsEnabled,
      }
      if (form.accessToken.trim()) {
        payload.accessToken = form.accessToken.trim()
      }
      if (form.adsAccessToken.trim()) {
        payload.adsAccessToken = form.adsAccessToken.trim()
      }
      const { data } = await saveMetaIntegration(payload)
      const integration = data.integration
      setMeta(integration)
      setForm((f) => ({
        ...f,
        accessToken: '',
        adsAccessToken: '',
      }))
      if (integration?.pixelId) initMetaPixel(integration.pixelId)
      toast.success('Integração Meta salva.')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao salvar integração.')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveLp = async () => {
    const domains = parseOriginsText(form.allowedOriginsText)
    if (!domains.length) {
      toast.error('Informe ao menos um domínio da landing page.')
      return
    }

    setShowSellerErrors(true)
    const sellerErrors = validateSellers(form.lpSellers || [])
    if (sellerErrors.length) {
      toast.error(sellerErrors[0])
      return
    }

    const sellersPayload = sellersToPayload(form.lpSellers || [])

    setSavingLp(true)
    try {
      const { data } = await saveMetaLpSettings({
        allowedOrigins: parseOriginsText(form.allowedOriginsText),
        lpSellers: sellersPayload,
        lpRotatorMode: form.lpRotatorMode || 'sequential',
        lpWhatsappMsg: form.lpWhatsappMsg.trim() || null,
      })
      const integration = data.integration
      setMeta((prev) => ({ ...prev, ...integration }))
      setForm((f) => ({
        ...f,
        allowedOriginsText: originsToText(integration?.allowedOrigins),
        lpSellers: parseSellersFromIntegration(integration),
        lpRotatorMode: integration?.lpRotatorMode || 'sequential',
        lpWhatsappMsg: integration?.lpWhatsappMsg || f.lpWhatsappMsg,
      }))
      setShowSellerErrors(false)
      toast.success(`${sellersPayload.length} vendedor(es) e domínios salvos.`)
    } catch (err) {
      const status = err?.response?.status
      const code = err?.response?.data?.error
      const msg = err?.response?.data?.message
      if (status === 400 && code === 'NOT_CONFIGURED') {
        toast.error(msg || 'Salve o Pixel e o token da Meta antes de configurar a landing page.')
      } else {
        toast.error(msg || 'Falha ao salvar landing page.')
      }
    } finally {
      setSavingLp(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResults(null)
    try {
      const { data } = await testMetaIntegration()
      setTestResults(data.results || [])
      toast.success(data.message || 'Eventos de teste enviados.')
      await load()
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao testar integração.')
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-accent-400" />
      </div>
    )
  }

  const connected = Boolean(meta?.connected)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-stone-50 font-heading">Integrações</h2>
        <p className="mt-2 text-sm text-stone-400 max-w-2xl">
          Conecte o <strong className="text-stone-300">Meta Pixel</strong> para enviar cada etapa do funil WhatsApp
          (conversa iniciada, qualificado, orçamento e compra) via API de Conversões.
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-brand-800 pb-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-[#1877F2]/15 p-2.5 text-[#4d9fff]">
              <Megaphone className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-stone-50">Meta (Facebook)</h3>
              <p className="mt-1 text-sm text-stone-500">
                API de Conversões — funil automático: ConversationStarted, LeadQualified, Quote e Purchase.
              </p>
              <Badge variant={connected ? 'success' : 'muted'} className="mt-2">
                {connected ? 'Conectado' : 'Não configurado'}
              </Badge>
            </div>
          </div>
          <a
            href="https://business.facebook.com/events_manager"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-accent-400 hover:text-accent-300"
          >
            Gerenciador de Eventos <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        <div className="mt-5 space-y-4">
          <Input
            label="ID do Pixel"
            placeholder="Ex.: 123456789012345"
            value={form.pixelId}
            onChange={(e) => setForm((f) => ({ ...f, pixelId: e.target.value }))}
          />

          <div className="space-y-3 rounded-xl border border-[#25D366]/30 bg-[#25D366]/5 p-4">
            <div>
              <p className="text-sm font-medium text-stone-200">Anúncios Click-to-WhatsApp (CTWA)</p>
              <p className="mt-1 text-xs text-stone-500">
                Obrigatório para leads que vieram de anúncio direto no WhatsApp. Campanhas LP → WhatsApp não precisam.
              </p>
            </div>
            <Input
              label="ID da conta WhatsApp Business (WABA)"
              placeholder="Ex.: 538521692670287"
              value={form.facebookPageId}
              onChange={(e) => setForm((f) => ({ ...f, facebookPageId: e.target.value }))}
            />
            <p className="-mt-2 text-xs text-stone-500">
              Meta Business Suite → <strong className="text-stone-400">Contas do WhatsApp</strong> → Configurações →{' '}
              <strong className="text-stone-400">ID da conta</strong>. Não use ID da Página nem do Pixel.
            </p>
            {form.facebookPageId ? (
              <p className="text-xs text-emerald-400/90">WABA configurado: {form.facebookPageId}</p>
            ) : (
              <p className="text-xs text-amber-400/90">Sem WABA — eventos de anúncio WhatsApp falham na Meta.</p>
            )}
          </div>
          <Input
            label="Token da API de Conversões"
            type="password"
            placeholder={meta?.hasAccessToken ? `Salvo (${meta.accessTokenHint}) — deixe vazio para manter` : 'Cole o token gerado no Events Manager'}
            value={form.accessToken}
            onChange={(e) => setForm((f) => ({ ...f, accessToken: e.target.value }))}
          />
          <Input
            label="Código de teste (opcional)"
            placeholder="TEST12345 — ex.: TEST20643"
            value={form.testEventCode}
            onChange={(e) => setForm((f) => ({ ...f, testEventCode: e.target.value }))}
          />
          <p className="-mt-2 text-xs text-stone-500">
            Só para o botão &quot;Enviar eventos de teste&quot;. Ações reais vão para produção (sem código). No Events
            Manager → <strong className="text-stone-400">Testar eventos</strong> → canal{' '}
            <strong className="text-stone-400">Offline</strong> → use o <strong className="text-stone-400">mesmo</strong>{' '}
            código. Contagens do funil: aba <strong className="text-stone-400">Visão geral</strong>.
          </p>

          <div className="space-y-3 rounded-xl border border-brand-800 bg-brand-950/40 p-4">
            <Toggle checked={form.enabled} onChange={(v) => setForm((f) => ({ ...f, enabled: v }))} label="Integração ativa" />
            <Toggle
              checked={form.sendQuotes}
              onChange={(v) => setForm((f) => ({ ...f, sendQuotes: v }))}
              label='Enviar evento "Quote" ao salvar orçamento (1x por contato)'
            />
            <Toggle
              checked={form.sendPurchases}
              onChange={(v) => setForm((f) => ({ ...f, sendPurchases: v }))}
              label='Enviar evento "Purchase" ao confirmar compra'
            />
          </div>

          {meta?.lastEventAt && (
            <div className="flex items-start gap-2 rounded-xl border border-brand-800 bg-brand-900/40 px-3 py-2.5 text-sm">
              {meta.lastError ? (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              )}
              <div>
                <p className="text-stone-300">
                  Último envio: <span className="text-stone-100">{meta.lastEventName || '—'}</span> ·{' '}
                  {formatWhen(meta.lastEventAt)}
                </p>
                {meta.lastError ? <p className="mt-1 text-xs text-red-300">{meta.lastError}</p> : null}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-brand-800 bg-brand-950/30 px-4 py-3 text-xs text-stone-500">
            <p className="font-medium text-stone-400">Eventos enviados automaticamente</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>
                <strong className="text-stone-400">ConversationStarted</strong> — 1ª mensagem inbound de contato novo
                (com integração ativa)
              </li>
              <li>
                <strong className="text-stone-400">LeadQualified</strong> — tag QUALIFICADO aplicada (1x por contato)
              </li>
              <li>
                <strong className="text-stone-400">Quote</strong> — orçamento salvo no chat (1x por contato, se toggle
                ativo)
              </li>
              <li>
                <strong className="text-stone-400">Purchase</strong> — compra confirmada (se toggle ativo)
              </li>
            </ul>
            <p className="mt-2">
              Na LP: <strong className="text-stone-400">Contact</strong> no clique — não Lead. Detalhes no guia abaixo.
            </p>
          </div>

          {testResults?.length > 0 && (
            <div className="rounded-xl border border-brand-800 bg-brand-950/40 px-4 py-3 text-xs">
              <p className="font-medium text-stone-400">Último teste de eventos</p>
              <ul className="mt-2 space-y-1">
                {testResults.map((r) => (
                  <li key={r.name} className="flex items-center gap-2 text-stone-500">
                    {r.ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
                    )}
                    <span className={r.ok ? 'text-stone-300' : 'text-red-300'}>
                      {r.name}
                      {r.ok && r.eventsReceived != null ? ` (${r.eventsReceived} recebido)` : ''}
                      {!r.ok && r.error ? ` — ${r.error}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving || !form.pixelId.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar integração'}
            </Button>
            <Button variant="secondary" onClick={handleTest} disabled={testing || !meta?.hasAccessToken}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Enviar eventos de teste'}
            </Button>
          </div>

          <UtmUrlGenerator />

          <MetaLpAttributionPanel
            form={form}
            setForm={setForm}
            meta={meta}
            showSellerErrors={showSellerErrors}
            onSaveLp={handleSaveLp}
            savingLp={savingLp}
          />

          <MetaAdsPanel form={form} setForm={setForm} meta={meta} onSaved={load} />

          <MetaIntegrationGuide pixelId={form.pixelId || meta?.pixelId} />
        </div>
      </Card>
    </div>
  )
}
