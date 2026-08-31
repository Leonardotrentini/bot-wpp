import { X } from 'lucide-react'
import { Button } from '../common/Button.jsx'
import { Input } from '../common/Input.jsx'
import { Select } from '../common/Select.jsx'
import {
  EXTRA_TRIGGER_OPTIONS,
  extraTriggerOptionsForPrimary,
  emptyExtraTrigger,
  buildNoReplyTriggerPatch,
  getNoReplyDelayUi,
} from '../../lib/flowTriggers.js'
import { MAX_NO_REPLY_MINUTES } from '../../lib/flowNoReplyDelay.js'

export function FlowExtraTriggerRow({
  extra,
  index,
  primaryType,
  tags,
  stages,
  onChange,
  onRemove,
  KeywordChipsInput,
}) {
  const options = extraTriggerOptionsForPrimary(primaryType)

  const setType = (type) => {
    onChange(index, emptyExtraTrigger(type))
  }

  const patch = (data) => onChange(index, data)

  const type = extra?.type || 'has_tag'

  return (
    <div className="space-y-2 rounded-lg border border-brand-800/60 bg-brand-900/30 p-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[180px] flex-1">
          <p className="mb-1 text-xs font-medium text-stone-400">Gatilho</p>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {options.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-stone-400 hover:text-red-300"
          aria-label="Remover gatilho adicional"
          onClick={() => onRemove(index)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {(type === 'has_tag' || type === 'not_has_tag' || type === 'tag_added') && (
        <div>
          <p className="mb-1 text-xs font-medium text-stone-400">Tag</p>
          <Select value={extra.tagId || ''} onChange={(e) => patch({ tagId: e.target.value || '' })}>
            <option value="">Selecione a tag…</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          {type === 'tag_added' ? (
            <p className="mt-1 text-[11px] text-stone-500">Verifica se o contato possui essa tag no momento do disparo.</p>
          ) : null}
        </div>
      )}

      {type === 'keyword' && KeywordChipsInput ? (
        <KeywordChipsInput keywords={extra.keywords || []} onChange={(keywords) => patch({ keywords })} />
      ) : null}

      {type === 'no_reply' && (() => {
        const delay = getNoReplyDelayUi(extra)
        const max = delay.unit === 'minutes' ? MAX_NO_REPLY_MINUTES : 720
        return (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[100px] flex-1">
              <Input
                label="Tempo sem resposta"
                type="number"
                min={1}
                max={max}
                value={delay.value}
                onChange={(e) => {
                  const n = Math.max(1, Number(e.target.value) || 1)
                  patch(buildNoReplyTriggerPatch(n, delay.unit))
                }}
              />
            </div>
            <div className="w-32">
              <p className="mb-1 text-xs font-medium text-stone-400">Unidade</p>
              <Select
                value={delay.unit}
                onChange={(e) => {
                  const unit = e.target.value === 'minutes' ? 'minutes' : 'hours'
                  patch(buildNoReplyTriggerPatch(Math.max(1, Number(delay.value) || 1), unit))
                }}
              >
                <option value="minutes">Minutos</option>
                <option value="hours">Horas</option>
              </Select>
            </div>
          </div>
        )
      })()}

      {type === 'stage_change' && (
        <div>
          <p className="mb-1 text-xs font-medium text-stone-400">Estágio</p>
          <Select value={extra.stageId || ''} onChange={(e) => patch({ stageId: e.target.value || '' })}>
            <option value="">Selecione…</option>
            <option value="__none__">Sem estágio</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      {type === 'contact_reply' && (
        <div>
          <p className="mb-1 text-xs font-medium text-stone-400">Tag(s) obrigatória(s)</p>
          <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-brand-700/70 bg-brand-950/40 p-2">
            {tags.length === 0 ? (
              <p className="text-xs text-stone-500">Crie tags no CRM.</p>
            ) : (
              tags.map((t) => {
                const checked = (extra.tagIds || []).includes(t.id)
                return (
                  <label
                    key={t.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-stone-200 hover:bg-white/5"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const current = extra.tagIds || []
                        const next = current.includes(t.id)
                          ? current.filter((id) => id !== t.id)
                          : [...current, t.id]
                        patch({ tagIds: next })
                      }}
                      className="h-3.5 w-3.5 rounded border-brand-600 bg-brand-900 text-accent-500"
                    />
                    <span className="truncate">{t.name}</span>
                  </label>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
