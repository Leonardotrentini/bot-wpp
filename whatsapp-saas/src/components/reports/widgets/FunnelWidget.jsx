import { Fragment, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, ChevronUp, ChevronDown, Tags } from 'lucide-react'
import {
  DEFAULT_FUNNEL_STEPS,
  createFunnelStepId,
  normalizeFunnelSteps,
} from '../../../lib/reportFunnelConfig.js'
import { Button } from '../../common/Button.jsx'

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

function FunnelTagEditor({ steps, tags, onChange }) {
  const availableTags = tags || []

  const updateStep = (index, patch) => {
    const next = steps.map((s, i) => (i === index ? { ...s, ...patch } : s))
    onChange(normalizeFunnelSteps(next))
  }

  const toggleTag = (index, tagId) => {
    const step = steps[index]
    const has = step.tagIds.includes(tagId)
    const tagIds = has ? step.tagIds.filter((id) => id !== tagId) : [...step.tagIds, tagId]
    const selected = availableTags.filter((t) => tagIds.includes(t.id))
    const label =
      selected.length > 0
        ? selected.map((t) => t.name).join(' · ')
        : step.systemKey
          ? DEFAULT_FUNNEL_STEPS.find((d) => d.systemKey === step.systemKey)?.label || step.label
          : step.label
    updateStep(index, {
      tagIds,
      label,
      systemKey: tagIds.length ? null : step.systemKey || DEFAULT_FUNNEL_STEPS[index]?.systemKey || null,
    })
  }

  const moveStep = (index, direction) => {
    const nextIdx = direction === 'up' ? index - 1 : index + 1
    if (nextIdx < 0 || nextIdx >= steps.length) return
    const next = [...steps]
    const [item] = next.splice(index, 1)
    next.splice(nextIdx, 0, item)
    onChange(normalizeFunnelSteps(next))
  }

  const removeStep = (index) => {
    if (steps.length <= 1) return
    onChange(normalizeFunnelSteps(steps.filter((_, i) => i !== index)))
  }

  const addStep = () => {
    onChange(
      normalizeFunnelSteps([
        ...steps,
        {
          id: createFunnelStepId(),
          label: `Etapa ${steps.length + 1}`,
          systemKey: null,
          tagIds: [],
        },
      ]),
    )
  }

  return (
    <div className="mt-4 rounded-xl border border-brand-800/60 bg-brand-950/50 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-stone-400 inline-flex items-center gap-1.5">
          <Tags className="h-3.5 w-3.5" />
          Etapas por tags da conta
        </p>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FUNNEL_STEPS.map((s) => ({ ...s, tagIds: [] })))}
          className="text-[11px] text-stone-500 hover:text-accent-400 transition"
        >
          Restaurar padrão
        </button>
      </div>

      {!availableTags.length ? (
        <p className="text-xs text-stone-500">
          Nenhuma tag criada nesta conta. Crie tags no CRM/Chat para montar o funil.
        </p>
      ) : null}

      {steps.map((step, index) => (
        <div key={step.id} className="rounded-lg border border-brand-800/50 bg-brand-900/40 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-stone-500 tabular-nums w-4">{index + 1}.</span>
            <input
              type="text"
              value={step.label}
              onChange={(e) => updateStep(index, { label: e.target.value })}
              className="flex-1 min-w-0 rounded-lg border border-brand-800/70 bg-brand-950/60 px-2.5 py-1.5 text-sm text-stone-200 focus:outline-none focus:border-accent-500/50"
              placeholder="Nome da etapa"
            />
            <button
              type="button"
              disabled={index === 0}
              onClick={() => moveStep(index, 'up')}
              className="p-1 rounded text-stone-500 hover:text-stone-200 disabled:opacity-30"
              aria-label="Subir etapa"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={index === steps.length - 1}
              onClick={() => moveStep(index, 'down')}
              className="p-1 rounded text-stone-500 hover:text-stone-200 disabled:opacity-30"
              aria-label="Descer etapa"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={steps.length <= 1}
              onClick={() => removeStep(index)}
              className="p-1 rounded text-stone-500 hover:text-red-400 disabled:opacity-30"
              aria-label="Remover etapa"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          {step.systemKey && !step.tagIds.length ? (
            <p className="text-[10px] text-stone-600 pl-5">
              Métrica padrão do sistema ({step.systemKey}). Selecione tags para sobrescrever.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-1.5 pl-5">
            {availableTags.map((tag) => {
              const selected = step.tagIds.includes(tag.id)
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(index, tag.id)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                    selected
                      ? 'border-accent-500/50 bg-accent-500/15 text-accent-300'
                      : 'border-brand-700/70 text-stone-400 hover:border-brand-600 hover:text-stone-200'
                  }`}
                >
                  <span
                    className="mr-1.5 inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: tag.color || '#a8a29e' }}
                  />
                  {tag.name}
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <Button type="button" variant="ghost" size="sm" className="gap-1.5 w-full" onClick={addStep}>
        <Plus className="h-4 w-4" />
        Adicionar etapa
      </Button>
    </div>
  )
}

export function ConversionsWidget({ payload, editing, funnelSteps, onFunnelStepsChange }) {
  const [editorOpen, setEditorOpen] = useState(Boolean(editing))
  const steps = payload?.steps || []
  const tags = payload?.tags || []

  const editorSteps = useMemo(
    () => normalizeFunnelSteps(funnelSteps),
    [funnelSteps],
  )

  useEffect(() => {
    if (editing) setEditorOpen(true)
  }, [editing])

  if (!steps.length && !editing) {
    return <p className="text-sm text-stone-500 py-4">Sem conversões no período.</p>
  }

  const topValue = steps[0]?.value ?? 0
  const bottomValue = steps[steps.length - 1]?.value ?? 0
  const overallRate = conversionRate(topValue, bottomValue)

  return (
    <div className="space-y-1">
      {editing && onFunnelStepsChange ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-[11px] text-stone-500">
            Personalize as etapas com as tags desta conta.
          </p>
          <button
            type="button"
            onClick={() => setEditorOpen((v) => !v)}
            className="text-[11px] font-medium text-accent-400 hover:text-accent-300 transition"
          >
            {editorOpen ? 'Ocultar editor' : 'Editar etapas'}
          </button>
        </div>
      ) : null}

      {editing && editorOpen && onFunnelStepsChange ? (
        <FunnelTagEditor steps={editorSteps} tags={tags} onChange={onFunnelStepsChange} />
      ) : null}

      {overallRate != null && steps.length > 1 && (
        <p className="text-xs text-stone-500 mb-3">
          Taxa geral (1ª → última etapa):{' '}
          <span className="text-accent-400 font-semibold tabular-nums">{formatPct(overallRate)}</span>
        </p>
      )}

      {steps.map((step, i) => {
        const prev = i > 0 ? steps[i - 1] : null
        const stepRate = prev ? conversionRate(prev.value, step.value) : null
        const fromTop = topValue > 0 ? conversionRate(topValue, step.value) : null
        const barWidth = topValue > 0 ? Math.max((step.value / topValue) * 100, step.value > 0 ? 6 : 0) : 0

        return (
          <Fragment key={`${step.label}-${i}`}>
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
                      {formatPct(fromTop)} da 1ª etapa
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
