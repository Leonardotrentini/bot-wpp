import { useMemo, useState } from 'react'
import { Copy, Check, Sparkles, CheckCircle2, Plus, Trash2, X } from 'lucide-react'
import { Button } from '../common/Button.jsx'
import { Textarea } from '../common/Textarea.jsx'
import { Select } from '../common/Select.jsx'
import { resolveBackendOrigin } from '../../lib/runtimeEnv.js'
import { buildMetaLpPrompt, buildVestoRotatorSnippet } from '../../lib/buildMetaLpPrompt.js'
import {
  normalizeBrazilPhone,
  isValidBrazilWhatsapp,
  formatPhoneExample,
  sellersToPayload,
} from '../../lib/lpSellers.js'

function parseDomains(text) {
  return String(text || '')
    .split(/[\n,;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function newSellerRow(index) {
  return { id: `seller-${Date.now()}-${index}`, label: '', phone: '' }
}

function phoneFieldStatus(phone, showErrors) {
  const normalized = normalizeBrazilPhone(phone)
  const hasInput = Boolean(String(phone || '').trim())
  if (normalized && isValidBrazilWhatsapp(normalized)) {
    return { status: 'ok', normalized }
  }
  if (!hasInput) {
    return { status: showErrors ? 'error' : 'idle', normalized: '', message: 'Informe o WhatsApp' }
  }
  return { status: 'error', normalized, message: 'Formato inválido' }
}

export function MetaLpAttributionPanel({ form, setForm, meta, showSellerErrors = false, onSaveLp, savingLp = false }) {
  const [copied, setCopied] = useState(null)

  const backendOrigin = resolveBackendOrigin()
  const publicKey = meta?.vestoPublicKey || ''
  const pixelId = meta?.pixelId || form.pixelId || ''
  const savedDomains = meta?.allowedOrigins || []
  const domainCount = savedDomains.length

  const savedSellers = useMemo(() => {
    const fromMeta = Array.isArray(meta?.lpSellers) ? meta.lpSellers : []
    return fromMeta.filter((s) => s?.phone)
  }, [meta?.lpSellers])

  const savedMessage = meta?.lpWhatsappMsg || 'Olá! Vim pelo site e quero mais informações.'
  const rotatorMode = meta?.lpRotatorMode || form.lpRotatorMode || 'sequential'

  const lpPrompt = useMemo(() => {
    return buildMetaLpPrompt({
      publicKey,
      backendOrigin,
      pixelId,
      domains: savedDomains,
      sellers: savedSellers,
      message: savedMessage,
      rotatorMode,
    })
  }, [backendOrigin, pixelId, publicKey, rotatorMode, savedDomains, savedMessage, savedSellers])

  const embedCode = useMemo(() => {
    return buildVestoRotatorSnippet({ backendOrigin, publicKey })
  }, [backendOrigin, publicKey])

  const promptReady = Boolean(publicKey && domainCount > 0 && savedSellers.length > 0)

  const copy = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(id)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      /* ignore */
    }
  }

  const updateSeller = (id, field, value) => {
    setForm((f) => ({
      ...f,
      lpSellers: (f.lpSellers || []).map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    }))
  }

  const addSeller = () => {
    setForm((f) => ({
      ...f,
      lpSellers: [...(f.lpSellers || []), newSellerRow((f.lpSellers || []).length)],
    }))
  }

  const removeSeller = (id) => {
    setForm((f) => {
      const rows = (f.lpSellers || []).filter((row) => row.id !== id)
      return { ...f, lpSellers: rows.length ? rows : [newSellerRow(0)] }
    })
  }

  return (
    <div className="space-y-4 rounded-xl border border-brand-800 bg-brand-950/20 p-4">
      <div>
        <h4 className="text-sm font-semibold text-stone-100">Landing Page → WhatsApp</h4>
        <p className="mt-1 text-xs text-stone-500">
          Salve domínios e vendedores → copie o prompt → cole no Codex/Cursor do projeto da LP.
        </p>
      </div>

      {savedSellers.length > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200/90">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <p>
            <strong>{savedSellers.length} vendedor(es) salvo(s)</strong> — edite abaixo e salve de novo para atualizar o
            prompt.
          </p>
        </div>
      ) : null}

      {domainCount > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200/90">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <p>
            <strong>{domainCount} domínio(s) ativo(s)</strong> no servidor.
          </p>
        </div>
      ) : null}

      <Textarea
        label="Domínios da landing page (um por linha)"
        placeholder={'baseset.vercel.app\nwww.seusite.com.br\n*.vercel.app'}
        value={form.allowedOriginsText}
        onChange={(e) => setForm((f) => ({ ...f, allowedOriginsText: e.target.value }))}
        rows={3}
      />
      <p className="-mt-2 text-xs text-stone-500">
        Só hostname (sem slug). Ex: <code className="text-stone-400">seusite.com.br</code> cobre /promo, /oferta, etc.
      </p>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-stone-300">Vendedores (WhatsApp)</p>
            <p className="text-xs text-stone-500">
              Formato: DDI+DDD+número — ex: <code className="text-stone-400">5547996747378</code>
            </p>
          </div>
          <Button variant="secondary" type="button" onClick={addSeller}>
            <Plus className="h-4 w-4" />
            Adicionar
          </Button>
        </div>

        <div className="space-y-2">
          {(form.lpSellers || []).map((row, index) => {
            const field = phoneFieldStatus(row.phone, showSellerErrors)
            const borderClass =
              field.status === 'ok'
                ? 'border-emerald-600/70 focus:border-emerald-500'
                : field.status === 'error'
                  ? 'border-red-600/80 focus:border-red-500'
                  : 'border-brand-800 focus:border-accent-500/50'

            return (
              <div
                key={row.id}
                className={`grid gap-2 rounded-lg border bg-brand-950/40 p-3 sm:grid-cols-[1fr_1.2fr_auto] ${
                  field.status === 'ok'
                    ? 'border-emerald-900/40'
                    : field.status === 'error'
                      ? 'border-red-900/40'
                      : 'border-brand-800'
                }`}
              >
                <div>
                  <label className="mb-1 block text-xs text-stone-500">Nome (opcional)</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-brand-800 bg-brand-950 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-600 focus:border-accent-500/50 focus:outline-none"
                    value={row.label}
                    onChange={(e) => updateSeller(row.id, 'label', e.target.value)}
                    placeholder={`Vendedor ${index + 1}`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-stone-500">WhatsApp</label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="tel"
                      className={`w-full rounded-lg border bg-brand-950 py-2 pl-3 pr-9 text-sm text-stone-100 placeholder:text-stone-600 focus:outline-none ${borderClass}`}
                      value={row.phone}
                      onChange={(e) => updateSeller(row.id, 'phone', e.target.value)}
                      placeholder="Ex: 5547996747378"
                    />
                    {field.status === 'ok' ? (
                      <Check className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-400" />
                    ) : null}
                    {field.status === 'error' ? (
                      <X className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-red-400" />
                    ) : null}
                  </div>
                  {field.status === 'ok' ? (
                    <p className="mt-1 flex items-center gap-1 text-[10px] text-emerald-400/90">
                      <Check className="h-3 w-3" />
                      {formatPhoneExample(field.normalized)}
                    </p>
                  ) : null}
                  {field.status === 'error' ? (
                    <p className="mt-1 text-[10px] text-red-400/90">{field.message}</p>
                  ) : null}
                </div>
                <div className="flex items-end justify-end pb-0.5">
                  <button
                    type="button"
                    className="rounded-lg p-2 text-stone-500 hover:bg-brand-900 hover:text-red-400 disabled:opacity-30"
                    onClick={() => removeSeller(row.id)}
                    disabled={(form.lpSellers || []).length <= 1}
                    title="Remover vendedor"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <Select
        label="Rotacionador"
        value={form.lpRotatorMode || 'sequential'}
        onChange={(value) => setForm((f) => ({ ...f, lpRotatorMode: value }))}
      >
        <option value="sequential">Sequencial — distribui cliques igual entre todos</option>
      </Select>

      <Textarea
        label="Mensagem padrão do WhatsApp"
        value={form.lpWhatsappMsg}
        onChange={(e) => setForm((f) => ({ ...f, lpWhatsappMsg: e.target.value }))}
        rows={2}
        placeholder="Olá! Vim pelo site e quero mais informações."
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" type="button" onClick={onSaveLp} disabled={savingLp || !onSaveLp}>
          {savingLp ? <span className="text-sm">Salvando…</span> : 'Salvar vendedores e domínios'}
        </Button>
        <p className="text-xs text-stone-500">Salve antes de copiar o prompt — ele usa os dados gravados no servidor.</p>
      </div>

      {publicKey ? (
        <div className="rounded-lg border border-brand-800 bg-brand-950/40 p-3 text-xs">
          <p className="text-stone-500">Chave pública · Backend LP</p>
          <code className="mt-1 block break-all text-stone-300">{publicKey}</code>
          <code className="mt-1 block break-all text-stone-500">{backendOrigin}/vesto-attribution.js</code>
        </div>
      ) : null}

      <div className="rounded-lg border border-accent-500/30 bg-accent-500/5 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent-400" />
            <p className="text-sm font-medium text-stone-200">Prompt para IA (Codex / Cursor)</p>
          </div>
          <Button
            variant="primary"
            type="button"
            disabled={!promptReady}
            onClick={() => copy(lpPrompt, 'prompt')}
          >
            {copied === 'prompt' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            Copiar prompt
          </Button>
        </div>
        <p className="mb-2 text-xs text-stone-500">
          {promptReady
            ? 'Pronto — cole no chat da LP. Inclui domínios, vendedores, rotacionador e instruções de atribuição Meta.'
            : 'Salve domínios + vendedores primeiro. O prompt só usa dados já gravados.'}
        </p>
        <pre className="max-h-96 overflow-auto rounded-lg bg-brand-950 p-3 text-[10px] leading-relaxed text-stone-400 whitespace-pre-wrap">
          {lpPrompt}
        </pre>
      </div>

      {promptReady ? (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-stone-500">HTML mínimo (referência rápida)</p>
            <Button variant="secondary" type="button" onClick={() => copy(embedCode, 'embed')}>
              {copied === 'embed' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              Copiar HTML
            </Button>
          </div>
          <pre className="max-h-32 overflow-auto rounded-lg bg-brand-950 p-3 text-[10px] text-stone-500 whitespace-pre-wrap">
            {embedCode}
          </pre>
        </div>
      ) : null}
    </div>
  )
}
