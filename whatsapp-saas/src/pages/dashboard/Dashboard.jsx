import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Skeleton } from '../../components/common/Skeleton.jsx'
import { getGroups, fetchOrgSellers } from '../../services/api.js'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useReportLayout } from '../../hooks/useReportLayout.js'
import { useReportDashboard, EMPTY_GROUP_IDS } from '../../hooks/useReportDashboard.js'
import { mapPeriodToMetaPeriod } from '../../lib/reportPeriod.js'
import { ReportToolbar } from '../../components/reports/ReportToolbar.jsx'
import { ReportGrid } from '../../components/reports/ReportGrid.jsx'
import { MetricPickerModal } from '../../components/reports/MetricPickerModal.jsx'

function DataBanner({ meta }) {
  if (!meta) return null
  if (!meta.hasActivity) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-sm text-amber-100/90">
        Ainda não há mensagens desde que o grupo foi ativado. Novas mensagens entram automaticamente; use{' '}
        <strong>Atualizar</strong> para sincronizar entradas e saídas de membros.
      </div>
    )
  }
  return null
}

export function Dashboard() {
  const toast = useToast()
  const { user, isOrgOwner } = useAuth()
  const [groups, setGroups] = useState([])
  const [sellerUserId, setSellerUserId] = useState('')
  const [sellers, setSellers] = useState([])
  const [pickerOpen, setPickerOpen] = useState(false)

  const {
    layout,
    editing,
    setEditing,
    setFilters,
    setFunnelSteps,
    addWidget,
    removeWidget,
    moveWidget,
    restoreDefault,
  } = useReportLayout(user?.id)

  const { data, loading, refreshing, load, refresh, lastUpdatedAt, error } = useReportDashboard({
    filters: layout.filters,
    groupIds: EMPTY_GROUP_IDS,
    sellerUserId: sellerUserId || undefined,
    funnelSteps: layout.funnelSteps,
  })

  useEffect(() => {
    let ok = true
    getGroups()
      .then((res) => {
        if (ok) setGroups(res.data?.groups || [])
      })
      .catch(() => {})
    return () => {
      ok = false
    }
  }, [])

  useEffect(() => {
    if (!isOrgOwner) return
    let ok = true
    fetchOrgSellers()
      .then((res) => {
        if (ok) setSellers(res.sellers || [])
      })
      .catch(() => {})
    return () => {
      ok = false
    }
  }, [isOrgOwner])

  useEffect(() => {
    if (layout.filters.period === 'custom' && (!layout.filters.startDate || !layout.filters.endDate)) {
      return
    }
    load()
  }, [load])

  const handleFiltersChange = useCallback(
    (patch) => {
      const next = { ...layout.filters, ...patch }
      if (patch.period) {
        next.metaPeriod = mapPeriodToMetaPeriod(patch.period)
        // Evita startDate/endDate de um personalizado antigo contaminarem hoje/7d/etc.
        if (patch.period !== 'custom') {
          next.startDate = undefined
          next.endDate = undefined
        }
      } else if (patch.startDate || patch.endDate) {
        // Personalizado: garante metaPeriod=custom e o backend usa since/until
        next.metaPeriod = 'custom'
      }
      setFilters(next)
    },
    [layout.filters, setFilters],
  )

  const handleRefresh = useCallback(async () => {
    try {
      const result = await refresh()
      const note = result?.syncNote
      if (note === 'whatsapp_offline') {
        toast.success('Painel atualizado. WhatsApp desconectado — métricas de CRM e Meta foram recarregadas.')
      } else if (note === 'sync_failed') {
        toast.success('Painel atualizado. Sincronização de grupos parcial — demais métricas recarregadas.')
      } else {
        toast.success('Dados sincronizados e painel atualizado.')
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao carregar o painel.')
    }
  }, [refresh, toast])

  const hasConnected = groups.some((g) => g.status === 'ativo' && g.monitoringEnabled)
  const existingMetricIds = layout.widgets.map((w) => w.metricId)
  const partialErrors = data?.meta_info?.partialErrors || []
  const showInitialSkeleton = loading && !data

  if (showInitialSkeleton) {
    return (
      <div className="space-y-6 max-w-[1400px]">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-16 rounded-2xl" />
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <ReportToolbar
        filters={layout.filters}
        onFiltersChange={handleFiltersChange}
        editing={editing}
        onToggleEditing={() => setEditing((v) => !v)}
        onAddWidget={() => setPickerOpen(true)}
        onRestoreDefault={restoreDefault}
        onRefresh={handleRefresh}
        refreshing={refreshing || (loading && Boolean(data))}
        loading={loading && !data}
        partialErrors={partialErrors}
        metaInfo={data?.meta_info}
        lastUpdatedAt={lastUpdatedAt}
        sellers={isOrgOwner ? sellers : []}
        sellerUserId={sellerUserId}
        onSellerChange={setSellerUserId}
      />

      {!hasConnected && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-4 py-4 text-sm text-amber-100/90">
          Conecte o WhatsApp e ative grupos em{' '}
          <Link to="/dashboard/connect" className="text-accent-400 underline hover:text-accent-300">
            Conectar
          </Link>{' '}
          e{' '}
          <Link to="/dashboard/groups" className="text-accent-400 underline hover:text-accent-300">
            Grupos
          </Link>{' '}
          para ver métricas de grupos. CRM e Meta funcionam independentemente.
        </div>
      )}

      {data?.groups?.meta && <DataBanner meta={data.groups.meta} />}

      {!data && !loading && (
        <div className="rounded-2xl border border-brand-800/60 bg-brand-900/30 px-6 py-12 text-center">
          <p className="text-sm text-stone-400">{error || 'Não foi possível carregar o painel.'}</p>
          <button
            type="button"
            onClick={handleRefresh}
            className="mt-3 text-sm text-accent-400 hover:text-accent-300 underline"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {data && error && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-sm text-amber-100/90">
          Não foi possível atualizar agora. Exibindo o último painel carregado.{' '}
          <button type="button" onClick={handleRefresh} className="underline text-accent-400 hover:text-accent-300">
            Tentar de novo
          </button>
        </div>
      )}

      {data && (
        <div className={loading || refreshing ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
          <ReportGrid
            widgets={layout.widgets}
            data={data}
            editing={editing}
            funnelSteps={layout.funnelSteps}
            onFunnelStepsChange={setFunnelSteps}
            onRemove={removeWidget}
            onMove={moveWidget}
          />
        </div>
      )}

      {editing && (
        <p className="text-center text-xs text-stone-600 pb-4">
          Layout salvo neste navegador ·{' '}
          <Link to="/dashboard/groups" className="text-stone-500 hover:text-accent-400">
            Gerenciar grupos
          </Link>
        </p>
      )}

      <MetricPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={addWidget}
        existingMetricIds={existingMetricIds}
      />
    </div>
  )
}
