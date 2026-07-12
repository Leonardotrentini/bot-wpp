import { RefreshCw, Settings2, RotateCcw, Plus } from 'lucide-react'
import { Button } from '../common/Button.jsx'
import { DateRangeCalendar } from '../common/DateRangeCalendar.jsx'

const PERIOD_OPTIONS = [
  { id: 'hoje', label: 'Hoje' },
  { id: '2d', label: '2 dias' },
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'custom', label: 'Personalizado' },
]

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
}) {
  const retention = metaInfo?.groupsRetentionDays ?? 2

  const retentionMinDate = (() => {
    const d = new Date()
    d.setDate(d.getDate() - retention)
    return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  })()

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

  function setPeriod(period) {
    onFiltersChange({ period })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs text-stone-500 leading-relaxed max-w-xl">
            Grupos: mensagens limitadas a {retention} dias · CRM: histórico completo · Meta Ads: integração
            necessária · Atribuição LP: TTL 14 dias
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editing && (
            <>
              <Button type="button" variant="secondary" size="sm" className="gap-1.5" onClick={onAddWidget}>
                <Plus className="h-4 w-4" />
                Adicionar
              </Button>
              <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={onRestoreDefault}>
                <RotateCcw className="h-4 w-4" />
                Restaurar
              </Button>
            </>
          )}
          <Button
            type="button"
            variant={editing ? 'primary' : 'secondary'}
            size="sm"
            className="gap-1.5"
            onClick={onToggleEditing}
          >
            <Settings2 className="h-4 w-4" />
            {editing ? 'Concluir' : 'Personalizar'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="gap-2"
            onClick={onRefresh}
            disabled={refreshing || loading}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Atualizando…' : 'Atualizar'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {PERIOD_OPTIONS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                filters.period === p.id
                  ? 'bg-accent-500/15 text-accent-400 border border-accent-500/30'
                  : 'text-stone-400 border border-transparent hover:bg-white/5'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {filters.period === 'custom' && (
          <DateRangeCalendar
            start={filters.startDate || ''}
            end={filters.endDate || ''}
            minDate={retentionMinDate}
            maxDate={todayStr}
            onChange={({ start, end }) => onFiltersChange({ startDate: start, endDate: end })}
          />
        )}
      </div>

      {partialErrors?.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200/90 space-y-1">
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
