import { useMemo, useState } from 'react'
import { getMetricDef } from '../../lib/reportMetricCatalog.js'
import { inferWidgetGroup } from '../../lib/reportLayoutStorage.js'
import { ReportWidget } from './ReportWidget.jsx'

const KPI_SECTIONS = [
  { id: 'main', title: 'Resumo executivo', hint: 'Arraste um card para mudar a ordem ou soltar em outro bloco.' },
  { id: 'new', title: 'Clientes novos', hint: 'Vendas marcadas como cliente novo.' },
  { id: 'returning', title: 'Clientes recorrentes', hint: 'Vendas marcadas como cliente antigo, a base.' },
]

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
  draggable,
  draggingId,
  dragOverId,
  onDragStart,
  onDragEnd,
  onDragOverCard,
  onDropCard,
}) {
  const def = getMetricDef(widget.metricId)
  const isKpi = def?.chartType === 'kpi'
  const wide = !isKpi && widget.colSpan >= 2

  return (
    <div className={wide ? 'sm:col-span-2' : ''} data-widget-id={widget.id}>
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
        draggable={draggable}
        dragging={draggingId === widget.id}
        dragOver={dragOverId === widget.id && draggingId !== widget.id}
        onDragStart={(event) => onDragStart(event, widget.id)}
        onDragEnd={onDragEnd}
        onDragOver={(event) => onDragOverCard(event, widget.id)}
        onDrop={(event) => onDropCard(event, widget)}
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
  onPlace,
  funnelSteps,
  onFunnelStepsChange,
}) {
  const [draggingId, setDraggingId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const [dragOverGroup, setDragOverGroup] = useState(null)
  const dataWithFunnel = useMemo(
    () => (data ? { ...data, funnelSteps } : data),
    [data, funnelSteps],
  )

  const { sections, charts } = useMemo(() => {
    const grouped = { main: [], new: [], returning: [] }
    const chartList = []
    for (const widget of widgets) {
      const def = getMetricDef(widget.metricId)
      if (def?.chartType === 'kpi') grouped[inferWidgetGroup(widget)].push(widget)
      else chartList.push(widget)
    }
    return { sections: grouped, charts: chartList }
  }, [widgets])

  const startDrag = (event, widgetId) => {
    if (event.target?.closest?.('button')) {
      event.preventDefault()
      return
    }
    event.dataTransfer.setData('text/plain', widgetId)
    event.dataTransfer.effectAllowed = 'move'
    requestAnimationFrame(() => setDraggingId(widgetId))
  }

  const endDrag = () => {
    setDraggingId(null)
    setDragOverId(null)
    setDragOverGroup(null)
  }

  const dragOverCard = (event, widgetId) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDragOverId((current) => (current === widgetId ? current : widgetId))
    setDragOverGroup(null)
  }

  const dropOnCard = (event, widget) => {
    event.preventDefault()
    event.stopPropagation()
    const activeId = event.dataTransfer.getData('text/plain')
    endDrag()
    if (!activeId || activeId === widget.id) return
    onPlace?.(activeId, { overId: widget.id, group: inferWidgetGroup(widget) })
  }

  const dropOnSection = (event, group) => {
    if (event.target?.closest?.('[data-widget-id]')) return
    event.preventDefault()
    const activeId = event.dataTransfer.getData('text/plain')
    endDrag()
    if (!activeId) return
    onPlace?.(activeId, { group })
  }

  if (!widgets.length) {
    return (
      <div className="rounded-2xl border border-dashed border-brand-700/60 bg-brand-900/20 px-6 py-16 text-center">
        <p className="text-sm text-stone-400">Nenhum widget no painel.</p>
        <p className="mt-2 text-sm text-stone-500">
          Clique em <strong className="text-stone-300">Personalizar</strong> para adicionar métricas.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {KPI_SECTIONS.map((section) => {
        const items = sections[section.id]
        if (!items.length && draggingId == null) return null
        const activeDrop = dragOverGroup === section.id
        return (
          <section
            key={section.id}
            onDragOver={(event) => {
              event.preventDefault()
              if (event.target?.closest?.('[data-widget-id]')) return
              setDragOverGroup((current) => (current === section.id ? current : section.id))
              setDragOverId(null)
            }}
            onDrop={(event) => dropOnSection(event, section.id)}
            className={`transition max-lg:space-y-3 max-lg:border-0 max-lg:bg-transparent max-lg:p-0 lg:rounded-3xl lg:border lg:p-5 ${
              activeDrop
                ? 'border-accent-400/70 bg-accent-400/5 max-lg:rounded-2xl max-lg:border max-lg:bg-accent-400/5 max-lg:p-3'
                : 'lg:border-brand-800/50 lg:bg-brand-950/35'
            }`}
          >
            <div className="mb-3 lg:mb-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-300 lg:text-xs lg:tracking-widest lg:text-stone-500">
                {section.title}
              </h3>
              {editing ? (
                <p className="mt-1 text-xs text-stone-500 max-lg:text-[11px]">{section.hint}</p>
              ) : null}
            </div>
            <div className="grid min-h-[40px] grid-cols-1 gap-2.5 max-lg:gap-2 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
              {items.map((widget, index) => (
                <WidgetSlot
                  key={widget.id}
                  widget={widget}
                  data={dataWithFunnel}
                  editing={editing}
                  onRemove={onRemove}
                  onMove={onMove}
                  index={index}
                  total={items.length}
                  funnelSteps={funnelSteps}
                  onFunnelStepsChange={onFunnelStepsChange}
                  draggable
                  draggingId={draggingId}
                  dragOverId={dragOverId}
                  onDragStart={startDrag}
                  onDragEnd={endDrag}
                  onDragOverCard={dragOverCard}
                  onDropCard={dropOnCard}
                />
              ))}
            </div>
          </section>
        )
      })}

      {charts.length > 0 && (
        <section>
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-300 lg:mb-4 lg:text-xs lg:tracking-widest lg:text-stone-500">
            Análises e detalhes
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
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
