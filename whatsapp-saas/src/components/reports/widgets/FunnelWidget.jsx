export function FunnelWidget({ payload }) {
  const stages = payload?.stages || []
  if (!stages.length) {
    return <p className="text-sm text-stone-500 py-4">Nenhum estágio configurado.</p>
  }

  const max = Math.max(...stages.map((s) => s.count), 1)

  return (
    <div className="space-y-3">
      {stages.map((stage) => (
        <div key={stage.stageId}>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-stone-300">{stage.stageName}</span>
            <span className="text-stone-500 tabular-nums">{stage.count}</span>
          </div>
          <div className="h-2 rounded-full bg-brand-800/80 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max((stage.count / max) * 100, stage.count > 0 ? 8 : 0)}%`,
                backgroundColor: stage.color || '#22c55e',
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

  const max = Math.max(...steps.map((s) => s.value), 1)

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((step, i) => (
        <div key={step.label} className="rounded-xl border border-brand-800/80 bg-brand-950/30 p-4">
          <p className="text-xs text-stone-500 mb-1">
            {i + 1}. {step.label}
          </p>
          <p className="text-2xl font-bold text-stone-50 tabular-nums">{step.value}</p>
          <div className="mt-2 h-1 rounded-full bg-brand-800/80 overflow-hidden">
            <div
              className="h-full bg-accent-500 rounded-full"
              style={{ width: `${Math.max((step.value / max) * 100, step.value > 0 ? 10 : 0)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
