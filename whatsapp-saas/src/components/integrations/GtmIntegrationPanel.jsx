import { useState, useEffect, useMemo } from 'react'
import { Tag, Loader2, ExternalLink, Copy, Check, Link2 } from 'lucide-react'
import { Card } from '../common/Card.jsx'
import { Button } from '../common/Button.jsx'
import { Input } from '../common/Input.jsx'
import { Badge } from '../common/Badge.jsx'
import { Toggle } from '../common/Toggle.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { buildGtmHeadSnippet, buildGtmBodySnippet } from '../../lib/gtmSnippets.js'
import { normalizeConversionTags, scopeLabel } from '../../lib/gtmConversions.js'

export function GtmIntegrationPanel({ gtm, onSave, saving }) {
  const toast = useToast()
  const [containerId, setContainerId] = useState(gtm?.containerId || '')
  const [enabled, setEnabled] = useState(gtm?.enabled !== false)
  const [conversionTags, setConversionTags] = useState(() => normalizeConversionTags(gtm?.conversionTags))
  const [ga4MeasurementId, setGa4MeasurementId] = useState(gtm?.ga4MeasurementId || '')
  const [ga4ApiSecret, setGa4ApiSecret] = useState('')
  const [copied, setCopied] = useState(null)

  useEffect(() => {
    setContainerId(gtm?.containerId || '')
    setEnabled(gtm?.enabled !== false)
    setConversionTags(normalizeConversionTags(gtm?.conversionTags))
    setGa4MeasurementId(gtm?.ga4MeasurementId || '')
    setGa4ApiSecret('')
  }, [gtm?.containerId, gtm?.enabled, gtm?.conversionTags, gtm?.ga4MeasurementId])

  const connected = Boolean(gtm?.connected)
  const linkedCount = useMemo(() => conversionTags.filter((t) => t.enabled).length, [conversionTags])
  const needsGa4 = useMemo(
    () => conversionTags.some((t) => t.enabled && t.scope === 'server'),
    [conversionTags],
  )

  const updateTag = (key, patch) => {
    setConversionTags((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  const handleCopy = async (e, key, text) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      toast.error('Não foi possível copiar.')
    }
  }

  const handleSave = () => {
    const payload = {
      containerId: containerId.trim(),
      enabled,
      conversionTags,
      ga4MeasurementId: ga4MeasurementId.trim() || null,
    }
    if (ga4ApiSecret.trim()) payload.ga4ApiSecret = ga4ApiSecret.trim()
    onSave(payload)
  }

  const headSnippet = buildGtmHeadSnippet(containerId)
  const bodySnippet = buildGtmBodySnippet(containerId)

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-brand-800 pb-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-[#4285F4]/15 p-2.5 text-[#6BA3FF]">
            <Tag className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-stone-50">Google Tag Manager</h3>
            <p className="mt-1 text-sm text-stone-500">
              Vincule o container e as tags de conversão do funil. O Vesto dispara eventos no dataLayer (LP) e via
              GA4 (CRM).
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant={connected ? 'success' : 'muted'}>{connected ? 'Conectado' : 'Não configurado'}</Badge>
              {linkedCount > 0 ? (
                <Badge variant="muted" className="border-accent-500/30 text-accent-300">
                  {linkedCount} tag(s) vinculada(s)
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
        <a
          href="https://tagmanager.google.com/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-accent-400 hover:text-accent-300"
        >
          Tag Manager <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      <div className="mt-5 space-y-4">
        <Input
          label="ID do container"
          placeholder="GTM-XXXXXXX"
          value={containerId}
          onChange={(e) => setContainerId(e.target.value.toUpperCase())}
        />
        <p className="-mt-2 text-xs text-stone-500">
          Encontre em{' '}
          <a
            href="https://tagmanager.google.com/"
            target="_blank"
            rel="noreferrer"
            className="text-accent-400 hover:underline"
          >
            tagmanager.google.com
          </a>{' '}
          → seu container → ID no canto superior (formato <code className="text-stone-400">GTM-</code>…).
        </p>

        <Toggle checked={enabled} onChange={setEnabled} label="GTM ativo na LP" />

        {containerId.trim() ? (
          <div className="space-y-3 rounded-xl border border-brand-800 bg-brand-950/40 p-4">
            <div>
              <p className="text-sm font-medium text-stone-200">Vincular tags de conversão</p>
              <p className="mt-1 text-xs text-stone-500">
                Para cada etapa do funil, ative a tag e informe o nome do evento. No GTM, crie uma tag com gatilho{' '}
                <strong className="text-stone-400">Evento personalizado</strong> usando o mesmo nome.
              </p>
            </div>

            <div className="space-y-3">
              {conversionTags.map((tag) => (
                <div
                  key={tag.key}
                  className={`rounded-xl border p-4 transition-colors ${
                    tag.enabled ? 'border-accent-500/35 bg-accent-500/5' : 'border-brand-800 bg-brand-950/30'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-stone-100">{tag.label}</p>
                        <Badge variant="muted" className="text-[10px]">
                          {scopeLabel(tag.scope)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-stone-500">{tag.description}</p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={tag.enabled ? 'primary' : 'outline'}
                      className="shrink-0 gap-1.5"
                      onClick={() => updateTag(tag.key, { enabled: !tag.enabled })}
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      {tag.enabled ? 'Vinculada' : 'Vincular tag'}
                    </Button>
                  </div>

                  {tag.enabled ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Input
                        label="Nome da tag no GTM (referência)"
                        placeholder="Ex.: GA4 — Lead qualificado LP"
                        value={tag.tagName}
                        onChange={(e) => updateTag(tag.key, { tagName: e.target.value })}
                      />
                      <Input
                        label="Evento dataLayer / GA4"
                        placeholder={tag.defaultEventName || 'vesto_event'}
                        value={tag.eventName}
                        onChange={(e) => updateTag(tag.key, { eventName: e.target.value })}
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {needsGa4 ? (
          <div className="space-y-3 rounded-xl border border-[#4285F4]/25 bg-[#4285F4]/5 p-4">
            <div>
              <p className="text-sm font-medium text-stone-200">GA4 — conversões do CRM</p>
              <p className="mt-1 text-xs text-stone-500">
                Etapas do funil após o clique (mensagem, qualificado, orçamento, compra) são enviadas ao GA4 via
                Measurement Protocol. Crie o secret em GA4 → Administrador → Fluxos de dados → Measurement Protocol.
              </p>
            </div>
            <Input
              label="ID de medição GA4"
              placeholder="G-XXXXXXXXXX"
              value={ga4MeasurementId}
              onChange={(e) => setGa4MeasurementId(e.target.value.toUpperCase())}
            />
            <Input
              label="Secret da API (Measurement Protocol)"
              type="password"
              placeholder={
                gtm?.hasGa4ApiSecret
                  ? `Salvo (${gtm.ga4ApiSecretHint}) — deixe vazio para manter`
                  : 'Cole o secret gerado no GA4'
              }
              value={ga4ApiSecret}
              onChange={(e) => setGa4ApiSecret(e.target.value)}
            />
          </div>
        ) : null}

        {headSnippet ? (
          <div className="space-y-3 rounded-xl border border-brand-800 bg-brand-950/40 p-4">
            <p className="text-xs font-medium text-stone-400">Snippet para a LP</p>
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[11px] text-stone-500">Cole no &lt;head&gt;</span>
                <button
                  type="button"
                  onClick={(e) => handleCopy(e, 'head', headSnippet)}
                  className="inline-flex items-center gap-1 text-[11px] text-accent-400 hover:text-accent-300"
                >
                  {copied === 'head' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  Copiar
                </button>
              </div>
              <pre className="max-h-32 overflow-auto rounded-lg bg-brand-950 p-3 text-[10px] text-stone-400">
                {headSnippet}
              </pre>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[11px] text-stone-500">Cole após abrir &lt;body&gt;</span>
                <button
                  type="button"
                  onClick={(e) => handleCopy(e, 'body', bodySnippet)}
                  className="inline-flex items-center gap-1 text-[11px] text-accent-400 hover:text-accent-300"
                >
                  {copied === 'body' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  Copiar
                </button>
              </div>
              <pre className="max-h-24 overflow-auto rounded-lg bg-brand-950 p-3 text-[10px] text-stone-400">
                {bodySnippet}
              </pre>
            </div>
            <p className="text-[11px] text-stone-500">
              No GTM, crie tags com gatilho de evento personalizado para cada conversão vinculada acima. O prompt da LP
              (seção Meta) inclui os nomes dos eventos quando salvo.
            </p>
          </div>
        ) : null}

        <Button onClick={handleSave} disabled={saving || !containerId.trim()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar GTM'}
        </Button>
      </div>
    </Card>
  )
}
