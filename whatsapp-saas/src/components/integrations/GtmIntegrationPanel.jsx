import { useState, useEffect } from 'react'
import { Tag, Loader2, ExternalLink, Copy, Check } from 'lucide-react'
import { Card } from '../common/Card.jsx'
import { Button } from '../common/Button.jsx'
import { Input } from '../common/Input.jsx'
import { Badge } from '../common/Badge.jsx'
import { Toggle } from '../common/Toggle.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { buildGtmHeadSnippet, buildGtmBodySnippet } from '../../lib/gtmSnippets.js'

export function GtmIntegrationPanel({ gtm, onSave, saving }) {
  const toast = useToast()
  const [containerId, setContainerId] = useState(gtm?.containerId || '')
  const [enabled, setEnabled] = useState(gtm?.enabled !== false)
  const [copied, setCopied] = useState(null)

  useEffect(() => {
    setContainerId(gtm?.containerId || '')
    setEnabled(gtm?.enabled !== false)
  }, [gtm?.containerId, gtm?.enabled])

  const connected = Boolean(gtm?.connected)

  const handleCopy = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
      toast.success('Copiado.')
    } catch {
      toast.error('Não foi possível copiar.')
    }
  }

  const handleSave = () => {
    onSave({
      containerId: containerId.trim(),
      enabled,
    })
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
              Vincule o container GTM à landing page. Tags GA4, Google Ads e outros pixels ficam no painel do Google.
            </p>
            <Badge variant={connected ? 'success' : 'muted'} className="mt-2">
              {connected ? 'Conectado' : 'Não configurado'}
            </Badge>
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

        {headSnippet ? (
          <div className="space-y-3 rounded-xl border border-brand-800 bg-brand-950/40 p-4">
            <p className="text-xs font-medium text-stone-400">Snippet para a LP</p>
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[11px] text-stone-500">Cole no &lt;head&gt;</span>
                <button
                  type="button"
                  onClick={() => handleCopy('head', headSnippet)}
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
                  onClick={() => handleCopy('body', bodySnippet)}
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
              O prompt da LP (seção Meta abaixo) também inclui o GTM quando salvo. O script Vesto e o Pixel Meta
              continuam obrigatórios.
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
