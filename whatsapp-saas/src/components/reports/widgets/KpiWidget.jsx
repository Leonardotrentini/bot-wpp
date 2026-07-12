import { formatMetricValue } from '../../../lib/reportMetricCatalog.js'

export function KpiWidget({ payload, format }) {
  if (payload?.unavailable) {
    return (
      <div className="py-2">
        <p className="text-2xl font-bold text-stone-600 font-heading tabular-nums">—</p>
        <p className="mt-1 text-xs text-stone-500">Fonte indisponível</p>
      </div>
    )
  }

  return (
    <div className="py-2">
      <p className="text-2xl font-bold text-stone-50 font-heading tabular-nums">
        {formatMetricValue(payload?.value, format)}
      </p>
      {payload?.hint ? <p className="mt-1.5 text-xs text-stone-500 line-clamp-2">{payload.hint}</p> : null}
    </div>
  )
}
