import { useMemo, useState } from 'react'
import {
  Copy,
  Check,
  Sparkles,
  CheckCircle2,
  Plus,
  Trash2,
  X,
  AlertCircle,
  MessageCircle,
  Users,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { Button } from '../common/Button.jsx'
import { Textarea } from '../common/Textarea.jsx'
import { Input } from '../common/Input.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { resolveBackendOrigin } from '../../lib/runtimeEnv.js'
import { buildMetaLpPrompt, buildMetaLpGroupPrompt, normalizeGroupInviteUrl } from '../../lib/buildMetaLpPrompt.js'
import {
  normalizeBrazilPhone,
  isValidBrazilWhatsapp,
  formatPhoneExample,
  sellersToPayload,
  domainsToPayload,
  messagesToPayload,
  newDomainRow,
  newMessageRow,
  normalizeDomainInput,
} from '../../lib/lpSellers.js'

function normalizeDomainsKey(rowsOrArr) {
  const parts = Array.isArray(rowsOrArr)
    ? rowsOrArr.map((d) => (typeof d === 'string' ? d : d?.hostname))
    : String(rowsOrArr || '')
        .split(/[\n,;]+/)
        .map((line) => line.trim())
  return parts
    .map((d) => normalizeDomainInput(d))
    .filter(Boolean)
    .sort()
    .join('|')
}

function messagesKey(rows) {
  return messagesToPayload(rows)
    .map((m) => `${m.label}|${m.message}`)
    .join('||')
}

function sellersKey(rows) {
  return (rows || [])
    .filter((s) => String(s.phone || '').replace(/\D/g, ''))
    .map((s) => `${String(s.label || '').trim()}|${String(s.phone || '').replace(/\D/g, '')}`)
    .join(',')
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
  const toast = useToast()
  const [copied, setCopied] = useState(null)
  const [promptVariant, setPromptVariant] = useState('x1') // 'x1' | 'group'
  const [promptExpanded, setPromptExpanded] = useState(false)

  const backendOrigin = resolveBackendOrigin()
  const publicKey = meta?.vestoPublicKey || ''
  const pixelId = meta?.pixelId || ''
  const savedDomains = meta?.allowedOrigins || []
  const domainCount = savedDomains.length

  const savedSellers = useMemo(() => {
    const fromMeta = Array.isArray(meta?.lpSellers) ? meta.lpSellers : []
    return fromMeta.filter((s) => s?.phone)
  }, [meta?.lpSellers])

  const savedMessages = useMemo(() => {
    if (Array.isArray(meta?.lpMessages) && meta.lpMessages.length) {
      return meta.lpMessages.filter((m) => m?.message)
    }
    const legacy = String(meta?.lpWhatsappMsg || '').trim()
    return legacy ? [{ label: '', message: legacy }] : []
  }, [meta?.lpMessages, meta?.lpWhatsappMsg])

  const savedMessage = savedMessages[0]?.message || 'Olá! Vim pelo site e quero mais informações.'
  const rotatorMode = meta?.lpRotatorMode || form.lpRotatorMode || 'sequential'
  const draftInvite = normalizeGroupInviteUrl(form.lpGroupInviteUrl)
  const savedInvite = normalizeGroupInviteUrl(meta?.lpGroupInviteUrl)

  const activePrompt = useMemo(() => {
    if (promptVariant === 'group') {
      return buildMetaLpGroupPrompt({
        publicKey,
        backendOrigin,
        pixelId,
        domains: savedDomains,
        groupInviteUrl: savedInvite || draftInvite,
      })
    }
    return buildMetaLpPrompt({
      publicKey,
      backendOrigin,
      pixelId,
      domains: savedDomains,
      sellers: savedSellers,
      message: savedMessage,
      messages: savedMessages,
      rotatorMode,
    })
  }, [
    backendOrigin,
    draftInvite,
    pixelId,
    promptVariant,
    publicKey,
    rotatorMode,
    savedDomains,
    savedInvite,
    savedMessage,
    savedMessages,
    savedSellers,
  ])

  const promptReadyX1 = Boolean(publicKey && domainCount > 0 && savedSellers.length > 0 && pixelId)
  const promptReadyGroup = Boolean(publicKey && domainCount > 0 && pixelId && savedInvite)
  const promptReady = promptVariant === 'group' ? promptReadyGroup : promptReadyX1

  const hasUnsavedLp = useMemo(() => {
    if (!meta) return false
    if (normalizeDomainsKey(form.lpDomains || []) !== normalizeDomainsKey(meta.allowedOrigins)) return true
    if (promptVariant === 'group') {
      return normalizeGroupInviteUrl(form.lpGroupInviteUrl) !== normalizeGroupInviteUrl(meta.lpGroupInviteUrl)
    }
    const savedMsgKey = messagesKey(
      Array.isArray(meta.lpMessages) && meta.lpMessages.length
        ? meta.lpMessages
        : meta.lpWhatsappMsg
          ? [{ label: '', message: meta.lpWhatsappMsg }]
          : [],
    )
    if (messagesKey(form.lpMessages || []) !== savedMsgKey) return true
    return sellersKey(sellersToPayload(form.lpSellers || [])) !== sellersKey(meta.lpSellers || [])
  }, [form.lpDomains, form.lpGroupInviteUrl, form.lpMessages, form.lpSellers, meta, promptVariant])

  const copy = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(id)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      toast.error('Não foi possível copiar — use Ctrl+C no texto do prompt.')
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

  const updateDomain = (id, value) => {
    setForm((f) => ({
      ...f,
      lpDomains: (f.lpDomains || []).map((row) => (row.id === id ? { ...row, hostname: value } : row)),
    }))
  }

  const addDomain = () => {
    setForm((f) => ({
      ...f,
      lpDomains: [...(f.lpDomains || []), newDomainRow((f.lpDomains || []).length)],
    }))
  }

  const removeDomain = (id) => {
    setForm((f) => {
      const rows = (f.lpDomains || []).filter((row) => row.id !== id)
      return { ...f, lpDomains: rows.length ? rows : [newDomainRow(0)] }
    })
  }

  const blurDomain = (id) => {
    setForm((f) => ({
      ...f,
      lpDomains: (f.lpDomains || []).map((row) =>
        row.id === id ? { ...row, hostname: normalizeDomainInput(row.hostname) } : row,
      ),
    }))
  }

  const updateMessage = (id, field, value) => {
    setForm((f) => ({
      ...f,
      lpMessages: (f.lpMessages || []).map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    }))
  }

  const addMessage = () => {
    setForm((f) => ({
      ...f,
      lpMessages: [...(f.lpMessages || []), newMessageRow((f.lpMessages || []).length)],
    }))
  }

  const removeMessage = (id) => {
    setForm((f) => {
      const rows = (f.lpMessages || []).filter((row) => row.id !== id)
      return { ...f, lpMessages: rows.length ? rows : [newMessageRow(0)] }
    })
  }

  const handleSave = () => {
    if (typeof onSaveLp === 'function') onSaveLp({ mode: promptVariant })
  }

  return (
    <div
      id="lp-whatsapp"
      className="scroll-mt-24 space-y-4 rounded-xl border border-accent-500/25 bg-brand-950/30 p-4"
    >
      <div>
        <h4 className="text-sm font-semibold text-stone-100">Landing Page → WhatsApp</h4>
        <p className="mt-1 text-xs text-stone-500">
          Escolha a variante (1:1 ou Grupo), salve os dados e copie o prompt para o Codex/Cursor da LP.
        </p>
      </div>

      <div className="inline-flex flex-wrap gap-0.5 rounded-xl border border-brand-800 bg-brand-950/60 p-1">
        <button
          type="button"
          onClick={() => setPromptVariant('x1')}
          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            promptVariant === 'x1'
              ? 'bg-accent-500/20 text-accent-200'
              : 'text-stone-400 hover:bg-white/5 hover:text-stone-200'
          }`}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          LP → 1:1 (vendedores)
        </button>
        <button
          type="button"
          onClick={() => setPromptVariant('group')}
          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
            promptVariant === 'group'
              ? 'bg-sky-500/20 text-sky-200'
              : 'text-stone-400 hover:bg-white/5 hover:text-stone-200'
          }`}
        >
          <Users className="h-3.5 w-3.5" />
          LP → Grupo
        </button>
      </div>

      {promptVariant === 'group' ? (
        <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 px-3 py-2 text-xs text-sky-100/90">
          CTA abre o <strong className="font-medium">convite do grupo</strong> depois de gravar a atribuição Meta.
          QUALIFICADO / orçamento / venda continuam no CRM 1:1 quando a pessoa chamar o vendedor.
        </div>
      ) : (
        <div className="rounded-lg border border-accent-500/20 bg-accent-500/5 px-3 py-2 text-xs text-stone-400">
          Variante clássica: rodízio de vendedores no servidor + <code className="text-stone-300">wa.me</code> com mensagem
          limpa.
        </div>
      )}

      {savedSellers.length > 0 && promptVariant === 'x1' ? (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200/90">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <p>
            <strong>{savedSellers.length} vendedor(es) salvo(s)</strong> — edite abaixo e salve de novo para atualizar o
            prompt.
          </p>
        </div>
      ) : null}

      {savedInvite && promptVariant === 'group' ? (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200/90">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <p>
            <strong>Link do grupo salvo</strong> — o prompt usa o convite gravado no servidor.
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

      {hasUnsavedLp ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200/90">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p>
            <strong>Alterações não salvas.</strong> O prompt usa os dados gravados no servidor — salve antes de
            copiar.
          </p>
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-stone-300">Domínios da landing page</p>
            <p className="text-xs text-stone-500">
              Só hostname (sem path). Ex: <code className="text-stone-400">seusite.com.br</code>
            </p>
          </div>
          <Button variant="secondary" type="button" onClick={addDomain}>
            <Plus className="h-4 w-4" />
            Adicionar
          </Button>
        </div>
        <div className="space-y-2">
          {(form.lpDomains || []).map((row, index) => (
            <div
              key={row.id}
              className="flex items-end gap-2 rounded-lg border border-brand-800 bg-brand-950/40 p-3"
            >
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-xs text-stone-500">Domínio {index + 1}</label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-brand-800 bg-brand-950 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-600 focus:border-accent-500/50 focus:outline-none"
                  value={row.hostname}
                  onChange={(e) => updateDomain(row.id, e.target.value)}
                  onBlur={() => blurDomain(row.id)}
                  placeholder="ex: fabricante-basic.vercel.app"
                />
              </div>
              <button
                type="button"
                className="rounded-lg p-2 text-stone-500 hover:bg-brand-900 hover:text-red-400 disabled:opacity-30"
                onClick={() => removeDomain(row.id)}
                disabled={(form.lpDomains || []).length <= 1}
                title="Remover domínio"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {promptVariant === 'group' ? (
        <div className="space-y-2">
          <Input
            label="Link de convite do grupo WhatsApp"
            value={form.lpGroupInviteUrl || ''}
            onChange={(e) => setForm((f) => ({ ...f, lpGroupInviteUrl: e.target.value }))}
            placeholder="https://chat.whatsapp.com/XXXX…"
          />
          <p className="text-xs text-stone-500">
            Convite oficial do WhatsApp. Salve junto com os domínios para o prompt usar o link gravado.
          </p>
          {draftInvite ? (
            <p className="text-[11px] text-emerald-400/90">
              Destino normalizado: <code className="break-all text-emerald-300/90">{draftInvite}</code>
            </p>
          ) : null}
        </div>
      ) : (
        <>
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

          <div>
            <p className="text-sm font-medium text-stone-300">Rotacionador</p>
            <p className="mt-1 text-xs text-stone-500">
              Sequencial — distribui cliques igualmente entre todos os vendedores.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-stone-300">Mensagens do WhatsApp</p>
                <p className="text-xs text-stone-500">
                  Uma por LP (ex.: site / Instagram). A 1ª é a padrão do prompt e da API config.
                </p>
              </div>
              <Button variant="secondary" type="button" onClick={addMessage}>
                <Plus className="h-4 w-4" />
                Adicionar
              </Button>
            </div>
            <div className="space-y-2">
              {(form.lpMessages || []).map((row, index) => (
                <div
                  key={row.id}
                  className="grid gap-2 rounded-lg border border-brand-800 bg-brand-950/40 p-3 sm:grid-cols-[0.8fr_1.4fr_auto]"
                >
                  <div>
                    <label className="mb-1 block text-xs text-stone-500">
                      Rótulo {index === 0 ? '(padrão)' : '(opcional)'}
                    </label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-brand-800 bg-brand-950 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-600 focus:border-accent-500/50 focus:outline-none"
                      value={row.label}
                      onChange={(e) => updateMessage(row.id, 'label', e.target.value)}
                      placeholder={index === 0 ? 'Site / campanha' : 'Linkbio Instagram'}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-stone-500">Mensagem</label>
                    <textarea
                      rows={2}
                      className="w-full rounded-lg border border-brand-800 bg-brand-950 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-600 focus:border-accent-500/50 focus:outline-none"
                      value={row.message}
                      onChange={(e) => updateMessage(row.id, 'message', e.target.value)}
                      placeholder="Vim do site, e gostaria de comprar no atacado!"
                    />
                  </div>
                  <div className="flex items-end justify-end pb-0.5">
                    <button
                      type="button"
                      className="rounded-lg p-2 text-stone-500 hover:bg-brand-900 hover:text-red-400 disabled:opacity-30"
                      onClick={() => removeMessage(row.id)}
                      disabled={(form.lpMessages || []).length <= 1}
                      title="Remover mensagem"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" type="button" onClick={handleSave} disabled={savingLp || !onSaveLp}>
          {savingLp ? (
            <span className="text-sm">Salvando…</span>
          ) : promptVariant === 'group' ? (
            'Salvar domínios e link do grupo'
          ) : (
            'Salvar vendedores, domínios e mensagens'
          )}
        </Button>
        <p className="text-[11px] text-stone-500">
          Salve antes de copiar o prompt {promptVariant === 'group' ? 'Grupo' : '1:1'} — ele usa os dados gravados no
          servidor.
        </p>
      </div>

      <div className="space-y-2 border-t border-brand-800 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-stone-200">
              Prompt para IA — {promptVariant === 'group' ? 'LP → Grupo' : 'LP → 1:1'}
            </p>
            <p className="text-xs text-stone-500">
              {promptReady
                ? 'Pronto para copiar (dados salvos no servidor).'
                : 'Salve Pixel, domínios e ' +
                  (promptVariant === 'group' ? 'link do grupo' : 'vendedores') +
                  ' para liberar.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              type="button"
              disabled={!promptReady}
              onClick={() => setPromptExpanded((v) => !v)}
            >
              {promptExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {promptExpanded ? 'Ocultar' : 'Ver prompt'}
            </Button>
            <Button
              variant="primary"
              type="button"
              disabled={!promptReady}
              onClick={() => copy(activePrompt, 'prompt')}
            >
              {copied === 'prompt' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              Copiar prompt
            </Button>
          </div>
        </div>

        {publicKey ? (
          <div className="rounded-lg border border-brand-800 bg-brand-950/50 px-3 py-2 text-xs">
            <p className="text-stone-500">Chave pública Vesto</p>
            <code className="mt-1 block break-all text-stone-300">{publicKey}</code>
          </div>
        ) : (
          <p className="text-xs text-amber-300/90">
            A chave pública é gerada automaticamente no primeiro save da landing page.
          </p>
        )}

        {promptExpanded && promptReady ? (
          <Textarea readOnly value={activePrompt} rows={14} className="font-mono text-[11px] leading-relaxed" />
        ) : null}

        {!promptReady ? (
          <div className="flex items-start gap-2 rounded-lg border border-brand-800 bg-brand-950/40 px-3 py-2 text-xs text-stone-500">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-stone-600" />
            <p>Complete e salve os campos acima para gerar o prompt desta variante.</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
