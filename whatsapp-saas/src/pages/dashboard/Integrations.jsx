import { useCallback, useEffect, useState } from 'react'
import { Megaphone, Loader2, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react'
import { Card } from '../../components/common/Card.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { Toggle } from '../../components/common/Toggle.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { getMetaIntegration, saveMetaIntegration, testMetaIntegration } from '../../services/api.js'
import { initMetaPixel } from '../../lib/metaPixel.js'

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
  const [form, setForm] = useState({
    pixelId: '',
    accessToken: '',
    enabled: true,
    sendQuotes: true,
    sendPurchases: true,
    testEventCode: '',
  })
  const [meta, setMeta] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await getMetaIntegration()
      const integration = data.integration
      setMeta(integration)
      if (integration) {
        setForm({
          pixelId: integration.pixelId || '',
          accessToken: '',
          enabled: integration.enabled !== false,
          sendQuotes: integration.sendQuotes !== false,
          sendPurchases: integration.sendPurchases !== false,
          testEventCode: integration.testEventCode || '',
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
        enabled: form.enabled,
        sendQuotes: form.sendQuotes,
        sendPurchases: form.sendPurchases,
        testEventCode: form.testEventCode.trim() || null,
      }
      if (form.accessToken.trim()) {
        payload.accessToken = form.accessToken.trim()
      }
      const { data } = await saveMetaIntegration(payload)
      setMeta(data.integration)
      setForm((f) => ({ ...f, accessToken: '' }))
      if (data.integration?.pixelId) initMetaPixel(data.integration.pixelId)
      toast.success('Integração Meta salva.')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao salvar integração.')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    try {
      const { data } = await testMetaIntegration()
      toast.success(data.message || 'Evento de teste enviado.')
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
          Conecte o <strong className="text-stone-300">Meta Pixel</strong> para enviar orçamentos e vendas confirmadas no
          CRM direto para o Facebook — otimize campanhas para conversões reais no WhatsApp.
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
                API de Conversões — eventos automáticos ao salvar orçamento ou confirmar compra no chat.
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
            Usado apenas no botão &quot;Enviar evento de teste&quot;. Orçamentos e compras reais vão para produção
            (sem código de teste). Abra o Gerenciador de Eventos → aba <strong className="text-stone-400">Testar eventos</strong>.
          </p>

          <div className="space-y-3 rounded-xl border border-brand-800 bg-brand-950/40 p-4">
            <Toggle checked={form.enabled} onChange={(v) => setForm((f) => ({ ...f, enabled: v }))} label="Integração ativa" />
            <Toggle
              checked={form.sendQuotes}
              onChange={(v) => setForm((f) => ({ ...f, sendQuotes: v }))}
              label='Enviar evento "Lead" ao salvar orçamento'
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
                <strong className="text-stone-400">Lead</strong> — quando você salva um orçamento no card do cliente (com valor em R$)
              </li>
              <li>
                <strong className="text-stone-400">Purchase</strong> — quando confirma uma compra (valor + ticket opcional)
              </li>
            </ul>
            <p className="mt-2">
              No Ads Manager, otimize campanhas para o evento <strong className="text-stone-400">Purchase</strong> para
              vendas reais.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving || !form.pixelId.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar integração'}
            </Button>
            <Button variant="secondary" onClick={handleTest} disabled={testing || !meta?.hasAccessToken}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Enviar evento de teste'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
