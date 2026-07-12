import { Fragment } from 'react'

function conversionRate(from, to) {
  if (!from || from <= 0) return null
  return Math.round((to / from) * 1000) / 10
}

function formatPct(value) {
  if (value == null) return '—'
  return `${value}%`
}

export function FunnelWidget({ payload }) {
  const stages = payload?.stages || []
  if (!stages.length) {
    return <p className="text-sm text-stone-500 py-4">Nenhum estágio configurado.</p>
  }

  const max = Math.max(...stages.map((s) => s.count), 1)

  return (
    <div className="space-y-4">
      {stages.map((stage) => (
        <div key={stage.stageId}>
          <div className="flex items-center justify-between text-sm mb-1.5">
            <span className="text-stone-300 font-medium">{stage.stageName}</span>
            <span className="text-stone-400 tabular-nums text-xs">{stage.count}</span>
          </div>
          <div className="h-2.5 rounded-full bg-brand-800/60 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.max((stage.count / max) * 100, stage.count > 0 ? 6 : 0)}%`,
                backgroundColor: stage.color || '#34d399',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export function ConversionsWidget({ payload }) {
  const steps = payload?.steps || []
  if (!steps.length) {
    return <p className="text-sm text-stone-500 py-4">Sem conversões no período.</p>
  }

  const topValue = steps[0]?.value ?? 0
  const bottomValue = steps[steps.length - 1]?.value ?? 0
  const overallRate = conversionRate(topValue, bottomValue)

  return (
    <div className="space-y-1">
      {overallRate != null && steps.length > 1 && (
        <p className="text-xs text-stone-500 mb-3">
          Taxa geral (lead → venda):{' '}
          <span className="text-accent-400 font-semibold tabular-nums">{formatPct(overallRate)}</span>
        </p>
      )}

      {steps.map((step, i) => {
        const prev = i > 0 ? steps[i - 1] : null
        const stepRate = prev ? conversionRate(prev.value, step.value) : null
        const fromTop = topValue > 0 ? conversionRate(topValue, step.value) : null
        const barWidth = topValue > 0 ? Math.max(((step.value / topValue) * 100), step.value > 0 ? 6 : 0) : 0

        return (
          <Fragment key={step.label}>
            {i > 0 && (
              <div className="flex items-center gap-3 py-2 pl-6">
                <div className="flex flex-col items-center">
                  <div className="w-px h-3 bg-brand-700/80" />
                  <span className="text-[11px] font-semibold text-accent-400 tabular-nums px-2 py-0.5 rounded-full bg-accent-500/10 border border-accent-500/20">
                    {stepRate != null ? formatPct(stepRate) : '—'}
                  </span>
                  <div className="w-px h-3 bg-brand-700/80" />
                </div>
                <span className="text-[11px] text-stone-600">
                  conversão de {prev.label.toLowerCase()} → {step.label.toLowerCase()}
                </span>
              </div>
            )}

            <div className="rounded-xl border border-brand-800/50 bg-brand-950/40 px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-stone-500 mb-1">
                    {i + 1}. {step.label}
                  </p>
                  <p className="text-2xl font-semibold text-stone-50 tabular-nums">{step.value}</p>
                  {i > 0 && fromTop != null && (
                    <p className="mt-1 text-[10px] text-stone-600 tabular-nums">
                      {formatPct(fromTop)} do total de leads
                    </p>
                  )}
                </div>
                <div className="w-20 shrink-0 pt-5">
                  <div className="h-2 rounded-full bg-brand-800/60 overflow-hidden">
                    <div
                      className="h-full bg-accent-500 rounded-full transition-all duration-500"
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
