import { ChevronUp, ChevronDown, X } from 'lucide-react'
import { Card } from '../common/Card.jsx'
import {
  getMetricDef,
  getMetricSourceNote,
  resolveMetricData,
} from '../../lib/reportMetricCatalog.js'
import { KpiWidget } from './widgets/KpiWidget.jsx'
import { ChartWidget } from './widgets/ChartWidget.jsx'
import { TableWidget, ListWidget } from './widgets/TableWidget.jsx'
import { FunnelWidget, ConversionsWidget } from './widgets/FunnelWidget.jsx'

function WidgetBody({ def, payload }) {
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
      return <ConversionsWidget payload={payload} />
    default:
      return <p className="text-sm text-stone-500">Tipo de widget não suportado.</p>
  }
}

export function ReportWidget({
  widget,
  data,
  editing,
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}) {
  const def = getMetricDef(widget.metricId)
  if (!def) return null

  const payload = resolveMetricData(widget.metricId, data)
  const sourceNote = getMetricSourceNote(widget.metricId, data)

  return (
    <Card className="h-full">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-stone-100 font-heading">{def.label}</h2>
          {sourceNote && editing ? <p className="text-[11px] text-stone-600 mt-0.5">{sourceNote}</p> : null}
        </div>
        {editing && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              disabled={isFirst}
              onClick={onMoveUp}
              className="p-1 rounded text-stone-500 hover:text-stone-200 disabled:opacity-30"
              aria-label="Mover para cima"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={isLast}
              onClick={onMoveDown}
              className="p-1 rounded text-stone-500 hover:text-stone-200 disabled:opacity-30"
              aria-label="Mover para baixo"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="p-1 rounded text-stone-500 hover:text-red-400"
              aria-label="Remover widget"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      <WidgetBody def={def} payload={payload} />
    </Card>
  )
}
