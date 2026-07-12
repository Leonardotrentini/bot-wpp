import { useMemo, useState } from 'react'
import { Copy, Check, Sparkles } from 'lucide-react'
import { Button } from '../common/Button.jsx'

const META_PRESET = {
  utm_source: 'meta',
  utm_medium: 'paid_social',
  utm_campaign: '{{campaign.name}}',
  utm_content: '{{ad.name}}',
  utm_term: '{{adset.name}}',
}

const FIELDS = [
  {
    key: 'baseUrl',
    label: 'URL da Landing Page',
    hint: 'Endereço completo da sua página de destino (sem UTMs no final).',
    placeholder: 'https://seusite.com.br/promocao',
    required: true,
  },
  {
    key: 'utm_source',
    label: 'utm_source — Origem',
    hint: 'De onde vem o clique. Para Meta Ads use meta, facebook ou instagram.',
    placeholder: 'meta',
  },
  {
    key: 'utm_medium',
    label: 'utm_medium — Mídia',
    hint: 'Tipo de tráfego pago. Ex.: paid_social, cpc ou cpm.',
    placeholder: 'paid_social',
  },
  {
    key: 'utm_campaign',
    label: 'utm_campaign — Campanha',
    hint: 'Nome da campanha. No Ads Manager pode usar {{campaign.name}} para preencher automaticamente.',
    placeholder: '{{campaign.name}}',
  },
  {
    key: 'utm_content',
    label: 'utm_content — Criativo / anúncio',
    hint: 'Identifica o anúncio (criativo). Use {{ad.name}} para a Meta substituir pelo nome real.',
    placeholder: '{{ad.name}}',
  },
  {
    key: 'utm_term',
    label: 'utm_term — Conjunto de anúncios',
    hint: 'Identifica o conjunto (ad set). Use {{adset.name}} para rastrear qual conjunto gerou o clique.',
    placeholder: '{{adset.name}}',
  },
]

function normalizeBaseUrl(raw) {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function buildUtmUrl(baseUrl, params) {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) return { url: '', error: null }

  try {
    const url = new URL(normalized)
    for (const [key, value] of Object.entries(params)) {
      const v = String(value || '').trim()
      if (v) url.searchParams.set(key, v)
    }
    return { url: url.toString(), error: null }
  } catch {
    return { url: '', error: 'URL inválida. Use um endereço completo, ex.: https://seusite.com.br/pagina' }
  }
}

export function UtmUrlGenerator() {
  const [values, setValues] = useState({
    baseUrl: '',
    utm_source: 'meta',
    utm_medium: 'paid_social',
    utm_campaign: '{{campaign.name}}',
    utm_content: '{{ad.name}}',
    utm_term: '{{adset.name}}',
  })
  const [copied, setCopied] = useState(false)

  const { url: generatedUrl, error } = useMemo(
    () =>
      buildUtmUrl(values.baseUrl, {
        utm_source: values.utm_source,
        utm_medium: values.utm_medium,
        utm_campaign: values.utm_campaign,
        utm_content: values.utm_content,
        utm_term: values.utm_term,
      }),
    [values],
  )

  const applyMetaPreset = () => {
    setValues((prev) => ({ ...prev, ...META_PRESET }))
  }

  const update = (key, next) => {
    setValues((prev) => ({ ...prev, [key]: next }))
    setCopied(false)
  }

  const handleCopy = async () => {
    if (!generatedUrl) return
    try {
      await navigator.clipboard.writeText(generatedUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-accent-500/20 bg-brand-950/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-stone-200">Gerador de URL com UTM</p>
          <p className="mt-1 text-[11px] leading-relaxed text-stone-500">
            Preencha os campos abaixo e cole a URL final no campo &quot;URL do site&quot; do seu anúncio na Meta.
          </p>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={applyMetaPreset}>
          <Sparkles className="h-3.5 w-3.5" />
          Modelo Meta Ads
        </Button>
      </div>

      <div className="space-y-3">
        {FIELDS.map((field) => (
          <label key={field.key} className="block">
            <span className="text-xs font-medium text-stone-300">{field.label}</span>
            <p className="mt-0.5 text-[10px] leading-relaxed text-stone-600">{field.hint}</p>
            <input
              type="text"
              value={values[field.key]}
              onChange={(e) => update(field.key, e.target.value)}
              placeholder={field.placeholder}
              className="mt-1.5 w-full rounded-lg border border-brand-700 bg-brand-900/60 px-3 py-2 text-xs text-stone-100 placeholder:text-stone-600 outline-none focus:border-accent-500/50"
            />
          </label>
        ))}
      </div>

      <div>
        <p className="text-xs font-medium text-stone-300">URL final (com UTMs)</p>
        <p className="mt-0.5 text-[10px] text-stone-600">
          Copie e cole no Gerenciador de Anúncios → anúncio → Destino → URL do site.
        </p>
        <div className="mt-2 flex gap-2">
          <pre className="min-h-[2.75rem] flex-1 overflow-x-auto rounded-lg border border-brand-800 bg-brand-950/80 px-3 py-2 text-[11px] leading-relaxed text-accent-300/90">
            {error ? (
              <span className="text-amber-400/90">{error}</span>
            ) : generatedUrl ? (
              generatedUrl
            ) : (
              <span className="text-stone-600">Informe a URL da landing page para gerar o link.</span>
            )}
          </pre>
          <Button type="button" size="sm" variant="secondary" onClick={handleCopy} disabled={!generatedUrl || Boolean(error)}>
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copiado' : 'Copiar'}
          </Button>
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-stone-600">
        <strong className="text-stone-500">Dica:</strong> os valores entre chaves duplas (ex.{' '}
        <code className="text-stone-500">{'{{campaign.name}}'}</code>) são preenchidos automaticamente pela Meta no
        momento do clique — não precisa trocar manualmente a cada campanha.
      </p>
    </div>
  )
}
