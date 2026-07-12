import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Skeleton } from '../../components/common/Skeleton.jsx'
import { getGroups } from '../../services/api.js'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useReportLayout } from '../../hooks/useReportLayout.js'
import { useReportDashboard } from '../../hooks/useReportDashboard.js'
import { mapPeriodToMetaPeriod } from '../../lib/reportPeriod.js'
import { GroupFilterBar } from '../../components/reports/GroupFilterBar.jsx'
import { ReportToolbar } from '../../components/reports/ReportToolbar.jsx'
import { ReportGrid } from '../../components/reports/ReportGrid.jsx'
import { MetricPickerModal } from '../../components/reports/MetricPickerModal.jsx'

function DataBanner({ meta }) {
  if (!meta) return null
  if (!meta.hasActivity) {
    return (
      <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200/90">
        Ainda não há mensagens desde que o grupo foi ativado. Novas mensagens entram automaticamente; use{' '}
        <strong>Atualizar</strong> para sincronizar entradas e saídas de membros.
      </p>
    )
  }
  return null
}

export function Dashboard() {
  const toast = useToast()
  const { user } = useAuth()
  const [groups, setGroups] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [pickerOpen, setPickerOpen] = useState(false)

  const {
    layout,
    editing,
    setEditing,
    setFilters,
    addWidget,
    removeWidget,
    moveWidget,
    restoreDefault,
  } = useReportLayout(user?.id)

  const onRefreshDone = useCallback(() => {
    toast.success('Dados sincronizados e painel atualizado.')
  }, [toast])

  const { data, loading, refreshing, load, refresh } = useReportDashboard({
    filters: layout.filters,
    groupIds: selectedIds,
    onRefreshDone,
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
    if (layout.filters.period === 'custom' && (!layout.filters.startDate || !layout.filters.endDate)) {
      return
    }
    load()
  }, [load, layout.filters.period, layout.filters.startDate, layout.filters.endDate, selectedIds])

  const handleFiltersChange = useCallback(
    (patch) => {
      const next = { ...layout.filters, ...patch }
      if (patch.period && patch.period !== 'custom') {
        next.metaPeriod = mapPeriodToMetaPeriod(patch.period)
      }
      setFilters(next)
    },
    [layout.filters, setFilters],
  )

  const handleRefresh = useCallback(async () => {
    try {
      await refresh()
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao atualizar.')
    }
  }, [refresh, toast])

  const hasConnected = groups.some((g) => g.status === 'ativo' && g.monitoringEnabled)
  const existingMetricIds = layout.widgets.map((w) => w.metricId)
  const partialErrors = data?.meta_info?.partialErrors || []

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16" />
        <Skeleton className="h-24" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-stone-500">
          Painel editável · layout salvo neste navegador ·{' '}
          <Link to="/dashboard/groups" className="text-accent-400 hover:underline">
            Gerenciar grupos
          </Link>
        </span>
      </div>

      <ReportToolbar
        filters={layout.filters}
        onFiltersChange={handleFiltersChange}
        editing={editing}
        onToggleEditing={() => setEditing((v) => !v)}
        onAddWidget={() => setPickerOpen(true)}
        onRestoreDefault={restoreDefault}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        loading={loading}
        partialErrors={partialErrors}
        metaInfo={data?.meta_info}
      />

      <GroupFilterBar groups={groups} selectedIds={selectedIds} onChange={setSelectedIds} />

      {!hasConnected && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-8 text-sm text-amber-200/90">
          Conecte o WhatsApp e ative grupos em{' '}
          <Link to="/dashboard/connect" className="text-accent-400 underline">
            Conectar
          </Link>{' '}
          e{' '}
          <Link to="/dashboard/groups" className="text-accent-400 underline">
            Grupos
          </Link>{' '}
          para ver métricas de grupos. CRM e Meta funcionam independentemente.
        </p>
      )}

      {data?.groups?.meta && <DataBanner meta={data.groups.meta} />}

      {!data && !loading && (
        <p className="rounded-xl border border-brand-800 bg-brand-900/40 px-4 py-8 text-sm text-stone-400">
          Não foi possível carregar o painel. Tente novamente em instantes.
        </p>
      )}

      {data && (
        <ReportGrid
          widgets={layout.widgets}
          data={data}
          editing={editing}
          onRemove={removeWidget}
          onMove={moveWidget}
        />
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
