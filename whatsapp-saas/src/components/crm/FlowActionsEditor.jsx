import { useState } from 'react'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { Button } from '../common/Button.jsx'
import { Select } from '../common/Select.jsx'
import { FlowActionDelay } from './FlowActionDelay.jsx'
import { FlowRecordingDelay } from './FlowRecordingDelay.jsx'
import { FlowMessageMedia } from './FlowMessageMedia.jsx'
import { emptyFlowMessageMedia } from '../../lib/flowMedia.js'

export function FlowActionsEditor({ actions, tags, stages, agents, onChange, onError }) {
  const [dragIdx, setDragIdx] = useState(null)
  const [overIdx, setOverIdx] = useState(null)

  const setAction = (i, patch) => {
    onChange(actions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)))
  }

  const moveAction = (from, to) => {
    if (from === to || from < 0 || to < 0 || from >= actions.length || to >= actions.length) return
    const next = [...actions]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onChange(next)
  }

  const addAction = () => {
    onChange([
      ...actions,
      { type: 'send_message', body: '', delayValue: 0, delayUnit: 'minutes', ...emptyFlowMessageMedia() },
    ])
  }

  const removeAction = (i) => {
    onChange(actions.filter((_, idx) => idx !== i))
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-stone-300">Então (ações)</p>
          <p className="text-[11px] text-stone-500">Arraste pelo ícone ≡ para reordenar a sequência.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={addAction} disabled={actions.length >= 10}>
          <Plus className="h-3.5 w-3.5" /> Ação
        </Button>
      </div>
      <div className="space-y-3">
        {actions.map((action, i) => (
          <div
            key={`flow-action-${i}`}
            draggable
            onDragStart={() => setDragIdx(i)}
            onDragEnd={() => {
              setDragIdx(null)
              setOverIdx(null)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setOverIdx(i)
            }}
            onDragLeave={() => setOverIdx((v) => (v === i ? null : v))}
            onDrop={(e) => {
              e.preventDefault()
              if (dragIdx != null) moveAction(dragIdx, i)
              setDragIdx(null)
              setOverIdx(null)
            }}
            className={`rounded-xl border bg-brand-900/50 p-3 transition ${
              dragIdx === i ? 'opacity-50' : ''
            } ${
              overIdx === i && dragIdx !== i
                ? 'border-accent-500/50 ring-1 ring-accent-500/30'
                : 'border-brand-700/70'
            }`}
          >
            <div className="mb-2 flex items-center gap-2">
              <button
                type="button"
                draggable={false}
                className="cursor-grab rounded p-1 text-stone-500 hover:bg-white/5 hover:text-stone-300 active:cursor-grabbing"
                title="Arrastar para reordenar"
                aria-label={`Reordenar ação ${i + 1}`}
              >
                <GripVertical className="h-4 w-4" />
              </button>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                Ação {i + 1}
              </span>
            </div>

            <FlowActionDelay action={action} onChange={(patch) => setAction(i, patch)} isFirst={i === 0} />

            <div className="mt-3 flex items-center gap-2">
              <div className="flex-1">
                <Select
                  value={action.type}
                  onChange={(e) =>
                    setAction(i, {
                      type: e.target.value,
                      body: '',
                      tagId: '',
                      stageId: '',
                      value: '',
                      ...emptyFlowMessageMedia(),
                    })
                  }
                >
                  <option value="send_message">Enviar mensagem</option>
                  <option value="add_tag">Adicionar tag ao contato</option>
                  <option value="remove_tag">Remover tag do contato</option>
                  <option value="move_stage">Mover no Kanban</option>
                  <option value="assign_ai">Ativar agente de IA</option>
                  <option value="set_status">Mudar status da conversa</option>
                  <option value="stop_flows">Parar automações (STOP)</option>
                </Select>
              </div>
              {actions.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeAction(i)}
                  className="rounded-lg p-2 text-stone-500 hover:bg-white/5 hover:text-red-400"
                  aria-label="Remover ação"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="mt-2">
              {action.type === 'send_message' && (
                <>
                  <FlowMessageMedia
                    action={action}
                    onChange={(patch) => setAction(i, patch)}
                    onError={onError}
                  />
                  {action.mediaType === 'audio' ? (
                    <FlowRecordingDelay action={action} onChange={(patch) => setAction(i, patch)} />
                  ) : null}
                </>
              )}
              {action.type === 'add_tag' && (
                <Select value={action.tagId || ''} onChange={(e) => setAction(i, { tagId: e.target.value })}>
                  <option value="">Escolha a tag…</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              )}
              {action.type === 'remove_tag' && (
                <Select value={action.tagId || ''} onChange={(e) => setAction(i, { tagId: e.target.value })}>
                  <option value="">Escolha a tag…</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              )}
              {action.type === 'move_stage' && (
                <Select value={action.stageId || ''} onChange={(e) => setAction(i, { stageId: e.target.value })}>
                  <option value="">Escolha o estágio…</option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
              {action.type === 'assign_ai' && (
                <Select
                  value={action.agentId || ''}
                  onChange={(e) => setAction(i, { agentId: e.target.value || undefined })}
                >
                  <option value="">Agente padrão</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              )}
              {action.type === 'set_status' && (
                <Select value={action.value || ''} onChange={(e) => setAction(i, { value: e.target.value })}>
                  <option value="">Escolha o status…</option>
                  <option value="open">Aberta</option>
                  <option value="pending">Pendente</option>
                  <option value="resolved">Resolvida</option>
                  <option value="archived">Arquivada</option>
                </Select>
              )}
              {action.type === 'stop_flows' && (
                <p className="text-xs leading-relaxed text-stone-500">
                  Interrompe <span className="text-stone-300">todos os fluxos</span> para este contato: cancela mensagens
                  na fila e impede novos disparos (follow-ups, palavra-chave, sem resposta, etc.).
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
