import { useMemo } from 'react'
import { getMetricDef } from '../../lib/reportMetricCatalog.js'
import { ReportWidget } from './ReportWidget.jsx'

function WidgetSlot({
  widget,
  data,
  editing,
  onRemove,
  onMove,
  index,
  total,
  funnelSteps,
  onFunnelStepsChange,
}) {
  const def = getMetricDef(widget.metricId)
  const isKpi = def?.chartType === 'kpi'
  const wide = !isKpi && widget.colSpan >= 2

  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <ReportWidget
        widget={widget}
        data={data}
        editing={editing}
        variant={isKpi ? 'kpi' : 'chart'}
        onRemove={() => onRemove(widget.id)}
        onMoveUp={() => onMove(widget.id, 'up')}
        onMoveDown={() => onMove(widget.id, 'down')}
        isFirst={index === 0}
        isLast={index === total - 1}
        funnelSteps={funnelSteps}
        onFunnelStepsChange={onFunnelStepsChange}
      />
    </div>
  )
}

export function ReportGrid({
  widgets,
  data,
  editing,
  onRemove,
  onMove,
  funnelSteps,
  onFunnelStepsChange,
}) {
  const dataWithFunnel = useMemo(
    () => (data ? { ...data, funnelSteps } : data),
    [data, funnelSteps],
  )

  const { kpis, charts } = useMemo(() => {
    const kpiList = []
    const chartList = []
    for (const w of widgets) {
      const def = getMetricDef(w.metricId)
      if (def?.chartType === 'kpi') kpiList.push(w)
      else chartList.push(w)
    }
    return { kpis: kpiList, charts: chartList }
  }, [widgets])

  if (!widgets.length) {
    return (
      <div className="rounded-2xl border border-dashed border-brand-700/60 bg-brand-900/20 px-6 py-16 text-center">
        <p className="text-stone-400 text-sm">
          Nenhum widget no painel.
        </p>
        <p className="mt-2 text-stone-500 text-sm">
          Clique em <strong className="text-stone-300">Personalizar</strong> para adicionar métricas.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {kpis.length > 0 && (
        <section>
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest text-stone-500">
            Resumo executivo
          </h3>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            {kpis.map((widget, index) => (
              <WidgetSlot
                key={widget.id}
                widget={widget}
                data={dataWithFunnel}
                editing={editing}
                onRemove={onRemove}
                onMove={onMove}
                index={index}
                total={kpis.length}
                funnelSteps={funnelSteps}
                onFunnelStepsChange={onFunnelStepsChange}
              />
            ))}
          </div>
        </section>
      )}

      {charts.length > 0 && (
        <section>
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest text-stone-500">
            Análises e detalhes
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {charts.map((widget, index) => (
              <WidgetSlot
                key={widget.id}
                widget={widget}
                data={dataWithFunnel}
                editing={editing}
                onRemove={onRemove}
                onMove={onMove}
                index={index}
                total={charts.length}
                funnelSteps={funnelSteps}
                onFunnelStepsChange={onFunnelStepsChange}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
