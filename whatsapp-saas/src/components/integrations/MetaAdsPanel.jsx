import { useCallback, useState } from 'react'
import {
  BarChart3,
  Loader2,
  RefreshCw,
  Image as ImageIcon,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react'
import { Input } from '../common/Input.jsx'
import { Button } from '../common/Button.jsx'
import { Toggle } from '../common/Toggle.jsx'
import { Badge } from '../common/Badge.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { getMetaAdsDashboard, testMetaAdsConnection } from '../../services/api.js'

const PERIODS = [
  { id: 'today', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'month', label: 'Este mês' },
]

function formatMoney(value, currency = 'BRL') {
  if (value == null) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value)
}

function formatNumber(value) {
  if (value == null) return '—'
  return new Intl.NumberFormat('pt-BR').format(value)
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

function statusVariant(status) {
  const s = String(status || '').toUpperCase()
  if (s === 'ACTIVE' || s === 'ENABLED') return 'success'
  if (s === 'PAUSED') return 'muted'
  return 'muted'
}

function adsBadge(meta) {
  if (meta?.adsConnected) return { variant: 'success', label: 'Anúncios ativo' }
  if (meta?.adsVerified) return { variant: 'success', label: 'Conta verificada' }
  if (meta?.adsConfigured) return { variant: 'muted', label: 'Credenciais salvas' }
  return { variant: 'muted', label: 'Anúncios não configurado' }
}

export function MetaAdsPanel({ form, setForm, meta, onSaved }) {
  const toast = useToast()
  const [period, setPeriod] = useState('7d')
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(false)
  const [dashboard, setDashboard] = useState(null)

  const canFetch = Boolean(meta?.adsConnected || (form.adAccountId?.trim() && meta?.adsConfigured))

  const loadDashboard = useCallback(async (overridePeriod) => {
    if (!meta?.adsEnabled) return
    const activePeriod = overridePeriod || period
    setLoading(true)
    try {
      const { data } = await getMetaAdsDashboard(activePeriod)
      setDashboard(data)
    } catch (err) {
      setDashboard(null)
      toast.error(err?.response?.data?.message || 'Falha ao carregar dados de anúncios.')
    } finally {
      setLoading(false)
    }
  }, [meta?.adsEnabled, period, toast])

  const handleTest = async () => {
    setTesting(true)
    try {
      const { data } = await testMetaAdsConnection()
      toast.success(data.message || 'Conta de anúncios conectada.')
      onSaved?.()
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao testar conta de anúncios.')
    } finally {
      setTesting(false)
    }
  }

  const currency = dashboard?.account?.currency || 'BRL'
  const badge = adsBadge(meta)

  return (
    <div className="space-y-4 rounded-xl border border-brand-800 bg-brand-950/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-[#1877F2]/10 p-2 text-[#4d9fff]">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-stone-100">Conta de Anúncios</h4>
            <p className="mt-1 text-xs text-stone-500">
              Leia gastos, campanhas e criativos via Marketing API (token manual).
            </p>
            <Badge variant={badge.variant} className="mt-2">
              {badge.label}
            </Badge>
            {meta?.adsVerified && !meta?.adsEnabled ? (
              <p className="mt-1 text-[11px] text-stone-500">
                Ative o toggle abaixo e salve para sincronizar gastos e criativos.
              </p>
            ) : null}
          </div>
        </div>
        <a
          href="https://business.facebook.com/settings/system-users"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-accent-400 hover:text-accent-300"
        >
          System Users <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      <Input
        label="ID da conta de anúncios"
        placeholder="Ex.: act_123456789 ou só os números"
        value={form.adAccountId}
        onChange={(e) => setForm((f) => ({ ...f, adAccountId: e.target.value }))}
      />
      <p className="-mt-2 text-xs text-stone-500">
        Encontre em{' '}
        <strong className="text-stone-400">Gerenciador de Anúncios → Configurações da conta</strong> — ID no formato{' '}
        <code className="text-stone-400">act_XXXXXXXXX</code>.
      </p>

      <Input
        label="Token da Marketing API (opcional)"
        type="password"
        placeholder={
          meta?.hasAdsAccessToken
            ? `Salvo (${meta.adsAccessTokenHint}) — deixe vazio para manter`
            : 'Cole token com ads_read — ou use o mesmo da CAPI se tiver a permissão'
        }
        value={form.adsAccessToken}
        onChange={(e) => setForm((f) => ({ ...f, adsAccessToken: e.target.value }))}
      />
      <p className="-mt-2 text-xs text-stone-500">
        No Business Manager: System User → Gerar token → permissão <strong className="text-stone-400">ads_read</strong>{' '}
        na conta de anúncios. Se o token da CAPI já tiver <code className="text-stone-400">ads_read</code>, não precisa
        colar outro.
      </p>

      <Toggle
        checked={form.adsEnabled}
        onChange={(v) => setForm((f) => ({ ...f, adsEnabled: v }))}
        label="Ativar leitura de gastos e criativos"
      />

      {meta?.lastAdsSyncAt && (
        <div className="flex items-start gap-2 rounded-xl border border-brand-800 bg-brand-900/40 px-3 py-2.5 text-xs">
          {meta.lastAdsError ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          )}
          <div>
            <p className="text-stone-300">Última sincronização: {formatWhen(meta.lastAdsSyncAt)}</p>
            {meta.lastAdsError ? <p className="mt-1 text-red-300">{meta.lastAdsError}</p> : null}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={handleTest} disabled={testing || !form.adAccountId.trim()}>
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Testar conta de anúncios'}
        </Button>
        <Button
          variant="secondary"
          onClick={loadDashboard}
          disabled={loading || !meta?.adsEnabled || !canFetch}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Atualizar dados
        </Button>
      </div>

      {meta?.adsEnabled && dashboard?.summary ? (
        <div className="space-y-4 border-t border-brand-800 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-stone-200">{dashboard.account?.name}</p>
              <p className="text-xs text-stone-500">
                {dashboard.account?.id} · {currency} · sincronizado {formatWhen(dashboard.syncedAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {PERIODS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setPeriod(p.id)
                    if (dashboard) loadDashboard(p.id)
                  }}
                  className={`rounded-lg px-2.5 py-1 text-xs transition ${
                    period === p.id
                      ? 'bg-accent-500/20 text-accent-300'
                      : 'text-stone-500 hover:bg-brand-900 hover:text-stone-300'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Gasto', value: formatMoney(dashboard.summary.spend, currency) },
              { label: 'Impressões', value: formatNumber(dashboard.summary.impressions) },
              { label: 'Cliques', value: formatNumber(dashboard.summary.clicks) },
              { label: 'CPC', value: formatMoney(dashboard.summary.cpc, currency) },
            ].map((card) => (
              <div key={card.label} className="rounded-lg border border-brand-800 bg-brand-950/50 p-3">
                <p className="text-xs text-stone-500">{card.label}</p>
                <p className="mt-1 text-lg font-semibold text-stone-100">{card.value}</p>
              </div>
            ))}
          </div>

          {dashboard.campaigns?.length > 0 ? (
            <div>
              <p className="mb-2 text-sm font-medium text-stone-300">Campanhas</p>
              <div className="overflow-x-auto rounded-lg border border-brand-800">
                <table className="w-full min-w-[520px] text-left text-xs">
                  <thead className="bg-brand-950/60 text-stone-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Nome</th>
                      <th className="px-3 py-2 font-medium">Gasto</th>
                      <th className="px-3 py-2 font-medium">Impressões</th>
                      <th className="px-3 py-2 font-medium">Cliques</th>
                      <th className="px-3 py-2 font-medium">CPC</th>
                    </tr>
                  </thead>
                  <tbody className="text-stone-400">
                    {dashboard.campaigns.map((c) => (
                      <tr key={c.id} className="border-t border-brand-800/60">
                        <td className="px-3 py-2 text-stone-300">{c.name}</td>
                        <td className="px-3 py-2">{formatMoney(c.spend, currency)}</td>
                        <td className="px-3 py-2">{formatNumber(c.impressions)}</td>
                        <td className="px-3 py-2">{formatNumber(c.clicks)}</td>
                        <td className="px-3 py-2">{formatMoney(c.cpc, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {dashboard.creatives?.length > 0 ? (
            <div>
              <p className="mb-2 text-sm font-medium text-stone-300">Criativos recentes</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {dashboard.creatives.map((creative) => (
                  <div
                    key={creative.id}
                    className="flex gap-3 rounded-lg border border-brand-800 bg-brand-950/40 p-3"
                  >
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-brand-900">
                      {creative.thumbnailUrl ? (
                        <img
                          src={creative.thumbnailUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <ImageIcon className="h-6 w-6 text-stone-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-stone-200">{creative.name}</p>
                        <Badge variant={statusVariant(creative.status)}>{creative.status}</Badge>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-stone-500">{creative.campaignName}</p>
                      {creative.title ? (
                        <p className="mt-1 truncate text-xs text-stone-400">{creative.title}</p>
                      ) : null}
                      {creative.body ? (
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-stone-500">{creative.body}</p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : meta?.adsEnabled ? (
        <p className="text-xs text-stone-500">
          Salve a integração e clique em <strong className="text-stone-400">Atualizar dados</strong> para carregar
          gastos e criativos.
        </p>
      ) : null}
    </div>
  )
}
