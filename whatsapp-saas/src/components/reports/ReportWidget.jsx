import { ChevronUp, ChevronDown, GripVertical, X } from 'lucide-react'
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

function WidgetBody({ def, payload, editing, funnelSteps, onFunnelStepsChange, compact = false }) {
  if (payload?.empty) {
    return <p className="py-4 text-sm text-stone-500">Métrica não disponível.</p>
  }

  switch (def.chartType) {
    case 'kpi':
      return <KpiWidget payload={payload} format={def.format} compact={compact} />
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
  draggable = false,
  dragging = false,
  dragOver = false,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}) {
  const def = getMetricDef(widget.metricId)
  if (!def) return null

  const payload = resolveMetricData(widget.metricId, data)
  const sourceNote = getMetricSourceNote(widget.metricId, data)
  const { accent, bg, border, Icon } = getMetricVisual(def.id, def.category)

  if (variant === 'kpi') {
    return (
      <div
        draggable={draggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className={`group relative rounded-2xl border ${border} bg-gradient-to-br from-brand-900/55 to-brand-950/85 transition hover:border-brand-700/80 max-lg:min-h-0 max-lg:p-3.5 lg:h-full lg:min-h-[148px] lg:p-5 ${
          draggable ? 'cursor-grab active:cursor-grabbing' : ''
        } ${dragging ? 'opacity-40' : ''} ${dragOver ? 'ring-2 ring-accent-400/70' : ''}`}
      >
        {editing && (
          <div className="absolute right-2 top-2 z-10 opacity-100 transition lg:opacity-0 lg:group-hover:opacity-100">
            <EditControls
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              onRemove={onRemove}
              isFirst={isFirst}
              isLast={isLast}
            />
          </div>
        )}

        {/* Mobile: linha horizontal (ícone + label | valor) */}
        <div className="flex items-center gap-3 lg:hidden">
          {draggable && editing ? <GripVertical className="h-4 w-4 shrink-0 text-stone-600" /> : null}
          <div className={`shrink-0 rounded-xl border ${border} ${bg} p-2`}>
            <Icon className={`h-4 w-4 ${accent}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium leading-snug text-stone-400 line-clamp-2">{def.label}</p>
            {sourceNote && editing ? (
              <p className="mt-0.5 text-[10px] text-stone-600 line-clamp-1">{sourceNote}</p>
            ) : null}
          </div>
          <div className="shrink-0 pl-1">
            <WidgetBody
              def={def}
              payload={payload}
              editing={editing}
              funnelSteps={funnelSteps}
              onFunnelStepsChange={onFunnelStepsChange}
              compact
            />
          </div>
        </div>

        {/* Desktop: tile vertical (inalterado) */}
        <div className="hidden lg:block">
          <div className="flex items-center gap-2">
            {draggable ? <GripVertical className="h-4 w-4 shrink-0 text-stone-600" /> : null}
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
