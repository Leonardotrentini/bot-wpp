import { RefreshCw, Settings2, RotateCcw, Plus } from 'lucide-react'
import { Button } from '../common/Button.jsx'
import { DateRangeCalendar } from '../common/DateRangeCalendar.jsx'
import { Select } from '../common/Select.jsx'

const PERIOD_OPTIONS = [
  { id: 'hoje', label: 'Hoje' },
  { id: '2d', label: '2 dias' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'custom', label: 'Personalizado' },
]

function formatLastUpdated(date) {
  if (!date) return null
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function ReportToolbar({
  filters,
  onFiltersChange,
  editing,
  onToggleEditing,
  onAddWidget,
  onRestoreDefault,
  onRefresh,
  refreshing,
  loading,
  partialErrors,
  metaInfo,
  lastUpdatedAt,
  sellers = [],
  sellerUserId = '',
  onSellerChange,
}) {
  const retentionMode = metaInfo?.groupsRetentionMode || 'rolling'
  const retention = metaInfo?.groupsRetentionDays ?? 2
  const groupsDataNote =
    retentionMode === 'activation'
      ? 'Grupos: mensagens guardadas desde a ativação'
      : `Grupos ${retention}d de mensagens`

  const retentionMinDate = (() => {
    const d = new Date()
    const daysBack = retentionMode === 'activation' ? 365 : retention
    d.setDate(d.getDate() - daysBack)
    return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  })()

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const periodLabel = PERIOD_OPTIONS.find((p) => p.id === filters.period)?.label || 'Período'
  const updatedLabel = formatLastUpdated(lastUpdatedAt)

  return (
    <div className="w-full min-w-0 space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-widest text-accent-500/80">Relatórios</p>
          <h2 className="mt-1 font-sans text-xl font-semibold tracking-tight text-stone-50 sm:text-2xl">
            Visão geral · {periodLabel}
          </h2>
          <div className="mt-1 space-y-0.5 text-sm leading-snug text-stone-500">
            <p>{updatedLabel ? `Atualizado às ${updatedLabel}` : 'Carregando dados…'}</p>
            <p className="max-lg:hidden">
              CRM histórico completo
              <span className="mx-1.5 text-stone-700">·</span>
              {groupsDataNote}
            </p>
            <p className="lg:hidden text-stone-500/90">{groupsDataNote}</p>
          </div>
        </div>

        <div className="grid w-full grid-cols-2 gap-2 max-lg:min-h-11 lg:flex lg:w-auto lg:flex-wrap lg:items-center">
          {editing && (
            <>
              <Button type="button" variant="ghost" size="sm" className="gap-1.5 max-lg:min-h-11" onClick={onAddWidget}>
                <Plus className="h-4 w-4" />
                Adicionar
              </Button>
              <Button type="button" variant="ghost" size="sm" className="gap-1.5 max-lg:min-h-11" onClick={onRestoreDefault}>
                <RotateCcw className="h-4 w-4" />
                Restaurar
              </Button>
            </>
          )}
          <Button
            type="button"
            variant={editing ? 'primary' : 'ghost'}
            size="sm"
            className="gap-1.5 max-lg:min-h-11"
            onClick={onToggleEditing}
          >
            <Settings2 className="h-4 w-4" />
            {editing ? 'Concluir' : 'Personalizar'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="gap-2 max-lg:min-h-11 lg:min-w-[120px]"
            onClick={onRefresh}
            disabled={refreshing || loading}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Atualizando…' : 'Atualizar'}
          </Button>
        </div>
      </div>

      {/* Filter card */}
      <div className="overflow-hidden rounded-2xl border border-brand-800/60 bg-brand-900/30">
        <div className="flex flex-col gap-4 p-3 sm:p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex w-full flex-wrap gap-1 rounded-xl border border-brand-800/50 bg-brand-950/60 p-1 sm:inline-flex sm:w-auto">
            {PERIOD_OPTIONS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onFiltersChange({ period: p.id })}
                className={`rounded-lg px-3 py-2.5 text-sm font-medium transition-all max-lg:min-h-11 sm:px-3.5 sm:py-2 ${
                  filters.period === p.id
                    ? 'bg-accent-500 text-brand-950 shadow-sm shadow-accent-500/20'
                    : 'text-stone-400 hover:bg-white/5 hover:text-stone-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {sellers.length > 0 && onSellerChange && (
            <div className="w-full min-w-0 sm:min-w-[180px] sm:w-auto">
              <Select
                value={sellerUserId}
                onChange={(e) => onSellerChange(e.target.value)}
                aria-label="Filtrar por vendedor"
              >
                <option value="">Vendedor: Todos</option>
                {sellers.map((s) => (
                  <option key={s.userId} value={s.userId}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>

        {filters.period === 'custom' && (
          <div className="px-4 pb-4 border-t border-brand-800/40 pt-4">
            <DateRangeCalendar
              start={filters.startDate || ''}
              end={filters.endDate || ''}
              minDate={retentionMinDate}
              maxDate={todayStr}
              onChange={({ start, end }) => onFiltersChange({ startDate: start, endDate: end })}
            />
          </div>
        )}
      </div>

      {partialErrors?.length > 0 && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-sm text-amber-100/90 space-y-1">
          {partialErrors.map((err) => (
            <p key={`${err.source}-${err.message}`}>
              <strong className="capitalize">{err.source}:</strong> {err.message}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
