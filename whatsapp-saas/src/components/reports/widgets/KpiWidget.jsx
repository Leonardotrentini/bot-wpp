import { formatMetricValue } from '../../../lib/reportMetricCatalog.js'

export function KpiWidget({ payload, format }) {
  if (payload?.unavailable) {
    return (
      <div className="mt-1">
        <p className="text-3xl font-semibold text-stone-600 tabular-nums tracking-tight">—</p>
        <p className="mt-1.5 text-xs text-stone-500">Fonte indisponível</p>
      </div>
    )
  }

  return (
    <div className="mt-1">
      <p className="text-3xl font-semibold text-stone-50 tabular-nums tracking-tight leading-none">
        {formatMetricValue(payload?.value, format)}
      </p>
      {payload?.hint ? (
        <p className="mt-2 text-xs leading-relaxed text-stone-500 line-clamp-3">{payload.hint}</p>
      ) : null}
    </div>
  )
}
