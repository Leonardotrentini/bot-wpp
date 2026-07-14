import { ChevronUp, ChevronDown, X } from 'lucide-react'
import { Card } from '../common/Card.jsx'
import {
  getMetricDef,
  getMetricSourceNote,
  resolveMetricData,
} from '../../lib/reportMetricCatalog.js'
import { getMetricVisual } from '../../lib/reportMetricVisuals.js'
import { KpiWidget } from './widgets/KpiWidget.jsx'
import { ChartWidget } from './widgets/ChartWidget.jsx'
import { TableWidget, ListWidget } from './widgets/TableWidget.jsx'
import { FunnelWidget, ConversionsWidget } from './widgets/FunnelWidget.jsx'

function WidgetBody({ def, payload, editing, funnelSteps, onFunnelStepsChange }) {
  if (payload?.empty) {
    return <p className="text-sm text-stone-500 py-4">Métrica não disponível.</p>
  }

  switch (def.chartType) {
    case 'kpi':
      return <KpiWidget payload={payload} format={def.format} />
    case 'area':
    case 'bar':
    case 'bar_horizontal':
      return <ChartWidget chartType={def.chartType} payload={payload} title={def.id} />
    case 'table':
      return <TableWidget payload={payload} />
    case 'list':
      return <ListWidget payload={payload} />
    case 'funnel':
      return <FunnelWidget payload={payload} />
    case 'conversions':
      return (
        <ConversionsWidget
          payload={payload}
          editing={editing}
          funnelSteps={funnelSteps}
          onFunnelStepsChange={onFunnelStepsChange}
        />
      )
    default:
      return <p className="text-sm text-stone-500">Tipo de widget não suportado.</p>
  }
}

function EditControls({ onMoveUp, onMoveDown, onRemove, isFirst, isLast }) {
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <button
        type="button"
        disabled={isFirst}
        onClick={onMoveUp}
        className="p-1.5 rounded-lg text-stone-500 hover:text-stone-200 hover:bg-white/5 disabled:opacity-30 transition"
        aria-label="Mover para cima"
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        disabled={isLast}
        onClick={onMoveDown}
        className="p-1.5 rounded-lg text-stone-500 hover:text-stone-200 hover:bg-white/5 disabled:opacity-30 transition"
        aria-label="Mover para baixo"
      >
        <ChevronDown className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="p-1.5 rounded-lg text-stone-500 hover:text-red-400 hover:bg-red-500/10 transition"
        aria-label="Remover widget"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

export function ReportWidget({
  widget,
  data,
  editing,
  variant = 'chart',
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  funnelSteps,
  onFunnelStepsChange,
}) {
  const def = getMetricDef(widget.metricId)
  if (!def) return null

  const payload = resolveMetricData(widget.metricId, data)
  const sourceNote = getMetricSourceNote(widget.metricId, data)
  const { accent, bg, border, Icon } = getMetricVisual(def.id, def.category)

  if (variant === 'kpi') {
    return (
      <div
        className={`group relative h-full rounded-2xl border ${border} bg-gradient-to-br from-brand-900/50 to-brand-950/80 p-5 transition hover:border-brand-700/80`}
      >
        {editing && (
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition">
            <EditControls
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              onRemove={onRemove}
              isFirst={isFirst}
              isLast={isLast}
            />
          </div>
        )}
        <div className="flex items-start justify-between gap-3">
          <div className={`rounded-xl border ${border} ${bg} p-2.5`}>
            <Icon className={`h-4 w-4 ${accent}`} />
          </div>
        </div>
        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-stone-500">{def.label}</p>
        <WidgetBody
          def={def}
          payload={payload}
          editing={editing}
          funnelSteps={funnelSteps}
          onFunnelStepsChange={onFunnelStepsChange}
        />
        {sourceNote && editing ? (
          <p className="mt-2 text-[10px] text-stone-600">{sourceNote}</p>
        ) : null}
      </div>
    )
  }

  return (
    <Card className="h-full !border-brand-800/50 !bg-brand-900/35 !shadow-none hover:!border-brand-700/60">
      <div className="flex items-start justify-between gap-2 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`shrink-0 rounded-lg border ${border} ${bg} p-2`}>
            <Icon className={`h-4 w-4 ${accent}`} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-stone-100 font-sans truncate">{def.label}</h2>
            {sourceNote && editing ? (
              <p className="text-[11px] text-stone-600 mt-0.5">{sourceNote}</p>
            ) : null}
          </div>
        </div>
        {editing && (
          <EditControls
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            onRemove={onRemove}
            isFirst={isFirst}
            isLast={isLast}
          />
        )}
      </div>
      <WidgetBody
        def={def}
        payload={payload}
        editing={editing}
        funnelSteps={funnelSteps}
        onFunnelStepsChange={onFunnelStepsChange}
      />
    </Card>
  )
}
