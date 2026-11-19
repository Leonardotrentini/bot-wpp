import { formatMetricValue } from '../../../lib/reportMetricCatalog.js'

export function KpiWidget({ payload, format, compact = false }) {
  if (payload?.unavailable) {
    return (
      <div className={compact ? 'text-right' : 'mt-1'}>
        <p
          className={`font-semibold text-stone-600 tabular-nums tracking-tight ${
            compact ? 'text-xl leading-none max-lg:text-lg' : 'text-3xl max-lg:text-2xl'
          }`}
        >
          —
        </p>
        <p className={`text-stone-500 ${compact ? 'mt-1 text-[10px]' : 'mt-1.5 text-xs'}`}>Fonte indisponível</p>
      </div>
    )
  }

  return (
    <div className={compact ? 'min-w-0 text-right' : 'mt-1 min-w-0'}>
      <p
        className={`font-semibold text-stone-50 tabular-nums tracking-tight leading-none ${
          compact ? 'text-xl max-lg:text-[1.15rem]' : 'text-3xl max-lg:text-2xl'
        }`}
      >
        {formatMetricValue(payload?.value, format)}
      </p>
      {payload?.hint ? (
        <p
          className={`leading-snug text-stone-500 ${
            compact ? 'mt-1 text-[10px] line-clamp-2' : 'mt-2 text-xs leading-relaxed line-clamp-3'
          }`}
        >
          {payload.hint}
        </p>
      ) : null}
    </div>
  )
}
