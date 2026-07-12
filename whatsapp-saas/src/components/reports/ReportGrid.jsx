import { ReportWidget } from './ReportWidget.jsx'

export function ReportGrid({ widgets, data, editing, onRemove, onMove }) {
  if (!widgets.length) {
    return (
      <p className="rounded-xl border border-brand-800 bg-brand-900/40 px-4 py-8 text-sm text-stone-400 text-center">
        Nenhum widget no painel. Clique em <strong>Personalizar</strong> e adicione métricas.
      </p>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {widgets.map((widget, index) => (
        <div
          key={widget.id}
          className={widget.colSpan >= 2 ? 'sm:col-span-2 lg:col-span-2' : ''}
        >
          <ReportWidget
            widget={widget}
            data={data}
            editing={editing}
            onRemove={() => onRemove(widget.id)}
            onMoveUp={() => onMove(widget.id, 'up')}
            onMoveDown={() => onMove(widget.id, 'down')}
            isFirst={index === 0}
            isLast={index === widgets.length - 1}
          />
        </div>
      ))}
    </div>
  )
}
