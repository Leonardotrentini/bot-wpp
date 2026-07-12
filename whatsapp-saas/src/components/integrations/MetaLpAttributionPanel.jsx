import { useMemo, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { Button } from '../common/Button.jsx'
import { Textarea } from '../common/Textarea.jsx'
import { resolveApiBaseURL } from '../../lib/runtimeEnv.js'

function backendOriginFromApi() {
  const api = resolveApiBaseURL().replace(/\/+$/, '')
  return api.replace(/\/api\/?$/i, '') || api
}

export function MetaLpAttributionPanel({ form, setForm, meta }) {
  const [copied, setCopied] = useState(null)

  const apiBase = resolveApiBaseURL().replace(/\/+$/, '')
  const backendOrigin = backendOriginFromApi()
  const publicKey = meta?.vestoPublicKey || ''
  const whatsappDigits = String(form.lpWhatsapp || '').replace(/\D/g, '')

  const snippet = useMemo(() => {
    if (!publicKey) return ''
    const wa = whatsappDigits || '5547999999999'
    return `<!-- Vesto: atribuição LP → WhatsApp -->
<script
  src="${backendOrigin}/vesto-attribution.js"
  data-vesto-key="${publicKey}"
  data-api="${apiBase}"
  data-whatsapp="${wa}"
  data-whatsapp-msg="${form.lpWhatsappMsg || 'Olá! Vim pelo site e quero mais informações.'}"
  data-selector="[data-vesto-whatsapp]"
  defer
></script>
<!-- No botão WhatsApp: data-vesto-whatsapp -->
<a href="#" data-vesto-whatsapp>Falar no WhatsApp</a>`
  }, [apiBase, backendOrigin, form.lpWhatsappMsg, publicKey, whatsappDigits])

  const copy = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(id)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-brand-800 bg-brand-950/20 p-4">
      <div>
        <h4 className="text-sm font-semibold text-stone-100">Landing Page → WhatsApp</h4>
        <p className="mt-1 text-xs text-stone-500">
          Cadastre os domínios da sua LP e cole o script na página. Cada conta usa sua chave pública — sem
          configuração manual no servidor.
        </p>
      </div>

      <Textarea
        label="Domínios da landing page (um por linha)"
        placeholder={'baseset.vercel.app\nwww.seusite.com.br\n*.vercel.app'}
        value={form.allowedOriginsText}
        onChange={(e) => setForm((f) => ({ ...f, allowedOriginsText: e.target.value }))}
        rows={4}
      />
      <p className="-mt-2 text-xs text-stone-500">
        Use só o hostname (sem https://). Wildcard: <code className="text-stone-400">*.vercel.app</code>. Salve após
        editar.
      </p>

      {publicKey ? (
        <div className="rounded-lg border border-brand-800 bg-brand-950/40 p-3 text-xs">
          <p className="text-stone-500">Chave pública (automática)</p>
          <code className="mt-1 block break-all text-stone-300">{publicKey}</code>
        </div>
      ) : (
        <p className="text-xs text-stone-500">Salve a integração Meta para gerar a chave pública.</p>
      )}

      <div>
        <label className="mb-1.5 block text-sm font-medium text-stone-300">WhatsApp no script (DDI+DDD+número)</label>
        <input
          type="text"
          className="w-full rounded-lg border border-brand-800 bg-brand-950 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-600 focus:border-accent-500/50 focus:outline-none"
          value={form.lpWhatsapp}
          onChange={(e) => setForm((f) => ({ ...f, lpWhatsapp: e.target.value }))}
          placeholder="5547996747378"
        />
      </div>

      <Textarea
        label="Mensagem padrão do WhatsApp"
        value={form.lpWhatsappMsg}
        onChange={(e) => setForm((f) => ({ ...f, lpWhatsappMsg: e.target.value }))}
        rows={2}
      />

      {snippet ? (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-stone-300">Script para colar na LP</p>
            <Button variant="secondary" type="button" onClick={() => copy(snippet, 'snippet')}>
              {copied === 'snippet' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              Copiar script
            </Button>
          </div>
          <pre className="max-h-64 overflow-auto rounded-lg bg-brand-950 p-3 text-[10px] text-stone-400">{snippet}</pre>
        </div>
      ) : null}
    </div>
  )
}
