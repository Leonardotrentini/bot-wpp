import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bot,
  CheckCheck,
  Kanban,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Send,
  Tag as TagIcon,
  Trash2,
  Zap,
} from 'lucide-react'
import { Button } from '../../components/common/Button.jsx'
import { Card } from '../../components/common/Card.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { Modal, ConfirmModal } from '../../components/common/Modal.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Select } from '../../components/common/Select.jsx'
import { Toggle } from '../../components/common/Toggle.jsx'
import { Tabs } from '../../components/common/Tabs.jsx'
import { Spinner } from '../../components/common/Spinner.jsx'
import { UserAvatar } from '../../components/common/UserAvatar.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { QuickReplyFormModal } from '../../components/crm/QuickReplyFormModal.jsx'
import { FlowMessageMedia } from '../../components/crm/FlowMessageMedia.jsx'
import { buildQuickReplyPayload, QUICK_REPLY_MEDIA_LABELS } from '../../lib/quickReplyMedia.js'
import { flowMessageHasContent, stripFlowActionForSave, emptyFlowMessageMedia } from '../../lib/flowMedia.js'
import { onSocketEvent } from '../../services/socket.js'
import {
  getCrmConversations,
  patchCrmConversation,
  getCrmTags,
  createCrmTag,
  updateCrmTag,
  deleteCrmTag,
  getCrmStages,
  createCrmStage,
  updateCrmStage,
  deleteCrmStage,
  getCrmQuickReplies,
  createCrmQuickReply,
  updateCrmQuickReply,
  deleteCrmQuickReply,
  getCrmFlows,
  createCrmFlow,
  updateCrmFlow,
  toggleCrmFlow,
  deleteCrmFlow,
  getCrmAgents,
  createCrmAgent,
  updateCrmAgent,
  deleteCrmAgent,
  testCrmAgent,
} from '../../services/api.js'

const TABS = [
  { id: 'kanban', label: 'Kanban' },
  { id: 'flows', label: 'Fluxos' },
  { id: 'agents', label: 'Agentes IA' },
  { id: 'settings', label: 'Configurações' },
]

function timeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

// ============================================================ KANBAN

function KanbanBoard({ stages, conversations, onMove, onOpenChat }) {
  const [dragId, setDragId] = useState(null)
  const [overStage, setOverStage] = useState(null)

  const byStage = useMemo(() => {
    const map = new Map()
    for (const s of stages) map.set(s.id, [])
    const unstaged = []
    for (const c of conversations) {
      if (c.kanbanStageId && map.has(c.kanbanStageId)) map.get(c.kanbanStageId).push(c)
      else unstaged.push(c)
    }
    return { map, unstaged }
  }, [stages, conversations])

  const renderCard = (c) => (
    <div
      key={c.id}
      draggable
      onDragStart={(e) => {
        setDragId(c.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragEnd={() => {
        setDragId(null)
        setOverStage(null)
      }}
      onClick={() => onOpenChat(c)}
      className={`cursor-grab rounded-xl border border-brand-700/70 bg-brand-900/80 p-3 shadow transition hover:border-accent-500/40 active:cursor-grabbing ${
        dragId === c.id ? 'opacity-40' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <UserAvatar name={c.contact?.name} src={c.contact?.avatarUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-stone-100">{c.contact?.name}</p>
          <p className="truncate text-[11px] text-stone-500">
            {c.contact?.phone ? `+${c.contact.phone}` : c.remoteJid?.split('@')[0]}
          </p>
        </div>
        {c.aiEnabled && <Bot className="h-4 w-4 shrink-0 text-sky-400" />}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs text-stone-400">
        {c.lastMessageFromMe && <CheckCheck className="h-3 w-3 shrink-0" />}
        <p className="truncate">{c.lastMessagePreview || '—'}</p>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap gap-1">
          {(c.contact?.tags || []).slice(0, 2).map((t) => (
            <span
              key={t.id}
              className="rounded-full px-1.5 py-px text-[9px] font-semibold"
              style={{ backgroundColor: `${t.color}26`, color: t.color }}
            >
              {t.name}
            </span>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {c.unreadCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-brand-950">
              {c.unreadCount}
            </span>
          )}
          <span className="text-[10px] text-stone-500">{timeAgo(c.lastMessageAt)}</span>
        </div>
      </div>
    </div>
  )

  const columnProps = (stageId) => ({
    onDragOver: (e) => {
      e.preventDefault()
      setOverStage(stageId)
    },
    onDragLeave: () => setOverStage((s) => (s === stageId ? null : s)),
    onDrop: (e) => {
      e.preventDefault()
      if (dragId) onMove(dragId, stageId)
      setDragId(null)
      setOverStage(null)
    },
  })

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {byStage.unstaged.length > 0 && (
        <div className="w-72 shrink-0">
          <div className="mb-2 flex items-center gap-2 px-1">
            <span className="h-2.5 w-2.5 rounded-full bg-stone-600" />
            <p className="text-sm font-semibold text-stone-300">Sem estágio</p>
            <span className="text-xs text-stone-500">{byStage.unstaged.length}</span>
          </div>
          <div className="space-y-2">{byStage.unstaged.map(renderCard)}</div>
        </div>
      )}
      {stages.map((stage) => {
        const cards = byStage.map.get(stage.id) || []
        return (
          <div key={stage.id} className="w-72 shrink-0" {...columnProps(stage.id)}>
            <div className="mb-2 flex items-center gap-2 px-1">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
              <p className="text-sm font-semibold text-stone-200">{stage.name}</p>
              <span className="text-xs text-stone-500">{cards.length}</span>
            </div>
            <div
              className={`min-h-32 space-y-2 rounded-xl p-1 transition ${
                overStage === stage.id ? 'bg-accent-500/10 outline-dashed outline-1 outline-accent-500/40' : ''
              }`}
            >
              {cards.map(renderCard)}
              {cards.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-stone-600">Arraste conversas para cá</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ============================================================ FLUXOS

const TRIGGER_LABELS = {
  new_conversation: 'Nova conversa',
  keyword: 'Palavra-chave',
  no_reply: 'Sem resposta',
  stage_change: 'Mudança de estágio',
}

const ACTION_LABELS = {
  send_message: 'Enviar mensagem',
  add_tag: 'Adicionar tag',
  move_stage: 'Mover no Kanban',
  assign_ai: 'Ativar IA',
  set_status: 'Mudar status',
}

const EMPTY_FLOW = {
  name: '',
  enabled: false,
  trigger: { type: 'new_conversation' },
  actions: [{ type: 'send_message', body: '', ...emptyFlowMessageMedia() }],
  cooldownPerContactHours: 24,
}

function FlowModal({ isOpen, onClose, initial, tags, stages, agents, onSave, saving }) {
  const toast = useToast()
  const [flow, setFlow] = useState(EMPTY_FLOW)

  useEffect(() => {
    if (isOpen) {
      setFlow(
        initial
          ? JSON.parse(JSON.stringify(initial))
          : { ...EMPTY_FLOW, actions: [{ type: 'send_message', body: '', ...emptyFlowMessageMedia() }] },
      )
    }
  }, [isOpen, initial])

  const setTrigger = (patch) => setFlow((f) => ({ ...f, trigger: { ...f.trigger, ...patch } }))
  const setAction = (i, patch) =>
    setFlow((f) => ({ ...f, actions: f.actions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)) }))

  const valid =
    flow.name.trim() &&
    flow.actions.length > 0 &&
    (flow.trigger.type !== 'keyword' || (flow.trigger.keywords || []).length > 0) &&
    flow.actions.every((a) => {
      if (a.type === 'send_message') return flowMessageHasContent(a)
      if (a.type === 'add_tag') return a.tagId
      if (a.type === 'move_stage') return a.stageId
      if (a.type === 'set_status') return a.value
      return true
    })

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initial ? 'Editar fluxo' : 'Novo fluxo'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => onSave(flow)} disabled={!valid || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Salvar fluxo
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Nome do fluxo"
          value={flow.name}
          onChange={(e) => setFlow((f) => ({ ...f, name: e.target.value }))}
          placeholder="Ex.: Boas-vindas automáticas"
        />

        <div>
          <p className="mb-1.5 text-sm font-medium text-stone-300">Quando (gatilho)</p>
          <Select value={flow.trigger.type} onChange={(e) => setFlow((f) => ({ ...f, trigger: { type: e.target.value } }))}>
            <option value="new_conversation">Nova conversa iniciada</option>
            <option value="keyword">Contato envia palavra-chave</option>
            <option value="no_reply">Contato sem responder há X horas</option>
            <option value="stage_change">Card movido no Kanban</option>
          </Select>
          {flow.trigger.type === 'keyword' && (
            <div className="mt-2">
              <Input
                label="Palavras-chave (separadas por vírgula)"
                value={(flow.trigger.keywords || []).join(', ')}
                onChange={(e) =>
                  setTrigger({
                    keywords: e.target.value
                      .split(',')
                      .map((k) => k.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="preço, orçamento, valor"
              />
            </div>
          )}
          {flow.trigger.type === 'no_reply' && (
            <div className="mt-2">
              <Input
                label="Horas sem resposta"
                type="number"
                min={1}
                max={720}
                value={flow.trigger.hours || 24}
                onChange={(e) => setTrigger({ hours: Math.max(1, Number(e.target.value) || 24) })}
              />
            </div>
          )}
          {flow.trigger.type === 'stage_change' && (
            <div className="mt-2">
              <p className="mb-1.5 text-sm font-medium text-stone-300">Para o estágio</p>
              <Select value={flow.trigger.stageId || ''} onChange={(e) => setTrigger({ stageId: e.target.value || null })}>
                <option value="">Qualquer estágio</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-sm font-medium text-stone-300">Então (ações)</p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setFlow((f) => ({
                  ...f,
                  actions: [...f.actions, { type: 'send_message', body: '', ...emptyFlowMessageMedia() }],
                }))
              }
              disabled={flow.actions.length >= 5}
            >
              <Plus className="h-3.5 w-3.5" /> Ação
            </Button>
          </div>
          <div className="space-y-3">
            {flow.actions.map((action, i) => (
              <div key={i} className="rounded-xl border border-brand-700/70 bg-brand-900/50 p-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <Select value={action.type} onChange={(e) => setAction(i, { type: e.target.value, body: '', tagId: '', stageId: '', value: '', ...emptyFlowMessageMedia() })}>
                      <option value="send_message">Enviar mensagem</option>
                      <option value="add_tag">Adicionar tag ao contato</option>
                      <option value="move_stage">Mover no Kanban</option>
                      <option value="assign_ai">Ativar agente de IA</option>
                      <option value="set_status">Mudar status da conversa</option>
                    </Select>
                  </div>
                  {flow.actions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setFlow((f) => ({ ...f, actions: f.actions.filter((_, idx) => idx !== i) }))}
                      className="rounded-lg p-2 text-stone-500 hover:bg-white/5 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="mt-2">
                  {action.type === 'send_message' && (
                    <FlowMessageMedia
                      action={action}
                      onChange={(patch) => setAction(i, patch)}
                      onError={(msg) => toast.error(msg)}
                    />
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
                    <Select value={action.agentId || ''} onChange={(e) => setAction(i, { agentId: e.target.value || undefined })}>
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
                </div>
              </div>
            ))}
          </div>
        </div>

        <Input
          label="Cooldown por contato (horas) — evita repetir o fluxo para a mesma pessoa"
          type="number"
          min={0}
          max={720}
          value={flow.cooldownPerContactHours}
          onChange={(e) => setFlow((f) => ({ ...f, cooldownPerContactHours: Math.max(0, Number(e.target.value) || 0) }))}
        />
      </div>
    </Modal>
  )
}

// ============================================================ AGENTES

const EMPTY_AGENT = {
  name: '',
  enabled: false,
  systemPrompt: '',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 400,
  maxRepliesPerConversation: 10,
  handoffKeywords: ['humano', 'atendente'],
  replyDelayMinSec: 5,
  replyDelayMaxSec: 20,
}

function AgentModal({ isOpen, onClose, initial, onSave, saving }) {
  const [agent, setAgent] = useState(EMPTY_AGENT)

  useEffect(() => {
    if (isOpen) setAgent(initial ? { ...initial } : { ...EMPTY_AGENT })
  }, [isOpen, initial])

  const valid = agent.name.trim() && agent.systemPrompt.trim().length >= 10

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initial ? 'Editar agente' : 'Novo agente de IA'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => onSave(agent)} disabled={!valid || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Salvar agente
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Nome do agente"
          value={agent.name}
          onChange={(e) => setAgent((a) => ({ ...a, name: e.target.value }))}
          placeholder="Ex.: Atendente virtual"
        />
        <div>
          <p className="mb-1.5 text-sm font-medium text-stone-300">Instruções (prompt do sistema)</p>
          <textarea
            value={agent.systemPrompt}
            onChange={(e) => setAgent((a) => ({ ...a, systemPrompt: e.target.value }))}
            rows={6}
            placeholder="Você é o atendente da loja X. Responda dúvidas sobre produtos, preços e prazos de entrega. Seja simpático e objetivo…"
            className="w-full resize-none rounded-xl border border-brand-700 bg-brand-900/60 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/60"
          />
          <p className="mt-1 text-xs text-stone-500">Mínimo 10 caracteres. Descreva o negócio, o tom e o que a IA pode ou não fazer.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Modelo"
            value={agent.model}
            onChange={(e) => setAgent((a) => ({ ...a, model: e.target.value }))}
            placeholder="gpt-4o-mini"
          />
          <Input
            label="Máx. respostas por conversa/dia"
            type="number"
            min={1}
            max={100}
            value={agent.maxRepliesPerConversation}
            onChange={(e) => setAgent((a) => ({ ...a, maxRepliesPerConversation: Math.max(1, Number(e.target.value) || 10) }))}
          />
          <Input
            label="Delay mín. de resposta (s)"
            type="number"
            min={1}
            max={120}
            value={agent.replyDelayMinSec}
            onChange={(e) => setAgent((a) => ({ ...a, replyDelayMinSec: Math.max(1, Number(e.target.value) || 5) }))}
          />
          <Input
            label="Delay máx. de resposta (s)"
            type="number"
            min={1}
            max={300}
            value={agent.replyDelayMaxSec}
            onChange={(e) => setAgent((a) => ({ ...a, replyDelayMaxSec: Math.max(1, Number(e.target.value) || 20) }))}
          />
        </div>
        <Input
          label="Palavras de transferência para humano (separadas por vírgula)"
          value={(agent.handoffKeywords || []).join(', ')}
          onChange={(e) =>
            setAgent((a) => ({
              ...a,
              handoffKeywords: e.target.value
                .split(',')
                .map((k) => k.trim())
                .filter(Boolean),
            }))
          }
          placeholder="humano, atendente, falar com alguém"
        />
      </div>
    </Modal>
  )
}

function AgentTester({ agent }) {
  const toast = useToast()
  const [message, setMessage] = useState('')
  const [reply, setReply] = useState('')
  const [testing, setTesting] = useState(false)

  const runTest = async () => {
    if (!message.trim()) return
    setTesting(true)
    setReply('')
    try {
      const { data } = await testCrmAgent(agent.id, message)
      setReply(data.reply || '(sem resposta)')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha no teste da IA.')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-brand-700/60 bg-brand-950/50 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Testar agente</p>
      <div className="flex gap-2">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runTest()}
          placeholder="Simule uma mensagem de cliente…"
          className="flex-1 rounded-xl border border-brand-700 bg-brand-900/60 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/60"
        />
        <Button size="sm" onClick={runTest} disabled={testing || !message.trim()}>
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
      {reply && (
        <div className="mt-2 rounded-xl bg-brand-800/70 px-3 py-2 text-sm text-stone-200">
          <Bot className="mr-1.5 inline h-3.5 w-3.5 text-sky-400" />
          {reply}
        </div>
      )}
    </div>
  )
}

// ============================================================ CONFIGURAÇÕES

function SettingsTab({ tags, setTags, stages, setStages, quickReplies, setQuickReplies }) {
  const toast = useToast()
  const [tagName, setTagName] = useState('')
  const [tagColor, setTagColor] = useState('#22c55e')
  const [stageName, setStageName] = useState('')
  const [stageColor, setStageColor] = useState('#64748b')
  const [qrModal, setQrModal] = useState(false)
  const [qrEditing, setQrEditing] = useState(null)
  const [qrSaving, setQrSaving] = useState(false)
  const [tagModal, setTagModal] = useState(false)
  const [tagEditing, setTagEditing] = useState(null)
  const [tagForm, setTagForm] = useState({ name: '', color: '#22c55e' })
  const [tagSaving, setTagSaving] = useState(false)
  const [stageModal, setStageModal] = useState(false)
  const [stageEditing, setStageEditing] = useState(null)
  const [stageForm, setStageForm] = useState({ name: '', color: '#64748b' })
  const [stageSaving, setStageSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null) // { kind, id, label }

  const addTag = async () => {
    if (!tagName.trim()) return
    try {
      const { data } = await createCrmTag({ name: tagName.trim(), color: tagColor })
      setTags((prev) => [...prev, data.tag].sort((a, b) => a.name.localeCompare(b.name)))
      setTagName('')
      toast.success('Tag criada.')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao criar tag.')
    }
  }

  const addStage = async () => {
    if (!stageName.trim()) return
    try {
      const { data } = await createCrmStage({ name: stageName.trim(), color: stageColor })
      setStages((prev) => [...prev, data.stage])
      setStageName('')
      toast.success('Estágio criado.')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao criar estágio.')
    }
  }

  const openEditTag = (tag) => {
    setTagEditing(tag)
    setTagForm({ name: tag.name, color: tag.color || '#22c55e' })
    setTagModal(true)
  }

  const saveTagEdit = async () => {
    if (!tagEditing || !tagForm.name.trim()) return
    setTagSaving(true)
    try {
      const { data } = await updateCrmTag(tagEditing.id, {
        name: tagForm.name.trim(),
        color: tagForm.color,
      })
      setTags((prev) =>
        prev.map((t) => (t.id === tagEditing.id ? data.tag : t)).sort((a, b) => a.name.localeCompare(b.name)),
      )
      setTagModal(false)
      toast.success('Tag atualizada.')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao atualizar tag.')
    } finally {
      setTagSaving(false)
    }
  }

  const openEditStage = (stage) => {
    setStageEditing(stage)
    setStageForm({ name: stage.name, color: stage.color || '#64748b' })
    setStageModal(true)
  }

  const saveStageEdit = async () => {
    if (!stageEditing || !stageForm.name.trim()) return
    setStageSaving(true)
    try {
      const { data } = await updateCrmStage(stageEditing.id, {
        name: stageForm.name.trim(),
        color: stageForm.color,
      })
      setStages((prev) => prev.map((s) => (s.id === stageEditing.id ? data.stage : s)))
      setStageModal(false)
      toast.success('Estágio atualizado.')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao atualizar estágio.')
    } finally {
      setStageSaving(false)
    }
  }

  const saveQr = async (form) => {
    const payload = buildQuickReplyPayload(form)
    setQrSaving(true)
    try {
      if (qrEditing) {
        const { data } = await updateCrmQuickReply(qrEditing.id, payload)
        setQuickReplies((prev) => prev.map((q) => (q.id === qrEditing.id ? data.quickReply : q)))
      } else {
        const { data } = await createCrmQuickReply(payload)
        setQuickReplies((prev) => [...prev, data.quickReply].sort((a, b) => a.shortcut.localeCompare(b.shortcut)))
      }
      setQrModal(false)
      toast.success('Atalho salvo.')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao salvar atalho.')
    } finally {
      setQrSaving(false)
    }
  }

  const runDelete = async () => {
    const target = confirmDelete
    if (!target) return
    try {
      if (target.kind === 'tag') {
        await deleteCrmTag(target.id)
        setTags((prev) => prev.filter((t) => t.id !== target.id))
      } else if (target.kind === 'stage') {
        await deleteCrmStage(target.id)
        setStages((prev) => prev.filter((s) => s.id !== target.id))
      } else if (target.kind === 'qr') {
        await deleteCrmQuickReply(target.id)
        setQuickReplies((prev) => prev.filter((q) => q.id !== target.id))
      }
      toast.success('Removido.')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao remover.')
    } finally {
      setConfirmDelete(null)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h3 className="mb-3 flex items-center gap-2 font-heading text-base font-semibold text-stone-100">
          <TagIcon className="h-4 w-4 text-accent-400" /> Tags
        </h3>
        <div className="flex gap-2">
          <input
            value={tagName}
            onChange={(e) => setTagName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTag()}
            placeholder="Nova tag…"
            className="flex-1 rounded-xl border border-brand-700 bg-brand-900/60 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/60"
          />
          <input
            type="color"
            value={tagColor}
            onChange={(e) => setTagColor(e.target.value)}
            className="h-10 w-12 cursor-pointer rounded-lg border border-brand-700 bg-brand-900"
            title="Cor da tag"
          />
          <Button size="sm" onClick={addTag} disabled={!tagName.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {tags.length === 0 && <p className="text-sm text-stone-500">Nenhuma tag criada.</p>}
          {tags.map((t) => (
            <span
              key={t.id}
              className="group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
              style={{ borderColor: `${t.color}66`, backgroundColor: `${t.color}1a`, color: t.color }}
            >
              {t.name}
              <button
                type="button"
                onClick={() => openEditTag(t)}
                className="opacity-40 transition hover:opacity-100"
                title="Editar tag"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete({ kind: 'tag', id: t.id, label: `tag "${t.name}"` })}
                className="opacity-40 transition hover:opacity-100"
                title="Excluir tag"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 flex items-center gap-2 font-heading text-base font-semibold text-stone-100">
          <Kanban className="h-4 w-4 text-accent-400" /> Estágios do Kanban
        </h3>
        <div className="flex gap-2">
          <input
            value={stageName}
            onChange={(e) => setStageName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addStage()}
            placeholder="Novo estágio…"
            className="flex-1 rounded-xl border border-brand-700 bg-brand-900/60 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/60"
          />
          <input
            type="color"
            value={stageColor}
            onChange={(e) => setStageColor(e.target.value)}
            className="h-10 w-12 cursor-pointer rounded-lg border border-brand-700 bg-brand-900"
            title="Cor do estágio"
          />
          <Button size="sm" onClick={addStage} disabled={!stageName.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {stages.map((s) => (
            <div key={s.id} className="flex items-center gap-2 rounded-xl border border-brand-700/60 bg-brand-900/50 px-3 py-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="flex-1 truncate text-sm text-stone-200">{s.name}</span>
              {s.isDefault && <Badge variant="muted">padrão</Badge>}
              <button
                type="button"
                onClick={() => openEditStage(s)}
                className="rounded-lg p-1.5 text-stone-500 transition hover:bg-white/5 hover:text-stone-200"
                title="Editar estágio"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete({ kind: 'stage', id: s.id, label: `estágio "${s.name}"` })}
                className="rounded-lg p-1.5 text-stone-500 transition hover:bg-white/5 hover:text-red-400"
                title="Excluir estágio"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </Card>

      <Card className="lg:col-span-2">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-heading text-base font-semibold text-stone-100">
            <MessageSquare className="h-4 w-4 text-accent-400" /> Atalhos de mensagem
          </h3>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setQrEditing(null)
              setQrModal(true)
            }}
          >
            <Plus className="h-4 w-4" /> Novo atalho
          </Button>
        </div>
        <p className="mb-3 text-xs text-stone-500">
          Na aba Conversas, digite <span className="rounded bg-brand-800 px-1.5 py-0.5 font-mono text-accent-400">/atalho</span> no
          campo de mensagem para inserir o texto salvo.
        </p>
        {quickReplies.length === 0 ? (
          <p className="text-sm text-stone-500">Nenhum atalho criado ainda.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {quickReplies.map((q) => (
              <div key={q.id} className="flex items-start gap-2 rounded-xl border border-brand-700/60 bg-brand-900/50 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-accent-400">/{q.shortcut}</p>
                  {q.title && <p className="text-xs text-stone-400">{q.title}</p>}
                  <p className="mt-0.5 truncate text-xs text-stone-500">
                    {q.body || (q.hasMedia ? `Anexo: ${QUICK_REPLY_MEDIA_LABELS[q.mediaType] || q.mediaType}` : '')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setQrEditing(q)
                    setQrModal(true)
                  }}
                  className="rounded-lg p-1.5 text-stone-500 transition hover:bg-white/5 hover:text-stone-200"
                  title="Editar atalho"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete({ kind: 'qr', id: q.id, label: `atalho "/${q.shortcut}"` })}
                  className="rounded-lg p-1.5 text-stone-500 transition hover:bg-white/5 hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        isOpen={tagModal}
        onClose={() => setTagModal(false)}
        title="Editar tag"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTagModal(false)} disabled={tagSaving}>
              Cancelar
            </Button>
            <Button onClick={saveTagEdit} disabled={!tagForm.name.trim() || tagSaving}>
              {tagSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="Nome da tag"
            value={tagForm.name}
            onChange={(e) => setTagForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Ex.: Qualificado"
          />
          <div>
            <p className="mb-1.5 text-sm font-medium text-stone-300">Cor</p>
            <input
              type="color"
              value={tagForm.color}
              onChange={(e) => setTagForm((f) => ({ ...f, color: e.target.value }))}
              className="h-10 w-full cursor-pointer rounded-lg border border-brand-700 bg-brand-900"
            />
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={stageModal}
        onClose={() => setStageModal(false)}
        title="Editar estágio"
        footer={
          <>
            <Button variant="ghost" onClick={() => setStageModal(false)} disabled={stageSaving}>
              Cancelar
            </Button>
            <Button onClick={saveStageEdit} disabled={!stageForm.name.trim() || stageSaving}>
              {stageSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="Nome do estágio"
            value={stageForm.name}
            onChange={(e) => setStageForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Ex.: Em negociação"
          />
          <div>
            <p className="mb-1.5 text-sm font-medium text-stone-300">Cor</p>
            <input
              type="color"
              value={stageForm.color}
              onChange={(e) => setStageForm((f) => ({ ...f, color: e.target.value }))}
              className="h-10 w-full cursor-pointer rounded-lg border border-brand-700 bg-brand-900"
            />
          </div>
        </div>
      </Modal>

      <QuickReplyFormModal
        isOpen={qrModal}
        onClose={() => setQrModal(false)}
        initial={qrEditing}
        onSave={saveQr}
        saving={qrSaving}
        onError={(msg) => toast.error(msg)}
      />

      <ConfirmModal
        isOpen={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        onConfirm={runDelete}
        title="Remover"
        message={`Tem certeza que deseja remover ${confirmDelete?.label || 'este item'}?`}
      />
    </div>
  )
}

// ============================================================ PÁGINA

export function Crm() {
  const toast = useToast()
  const navigate = useNavigate()
  const [tab, setTab] = useState('kanban')

  const [conversations, setConversations] = useState([])
  const [stages, setStages] = useState([])
  const [tags, setTags] = useState([])
  const [quickReplies, setQuickReplies] = useState([])
  const [flows, setFlows] = useState([])
  const [agents, setAgents] = useState([])
  const [aiConfigured, setAiConfigured] = useState(false)
  const [loading, setLoading] = useState(true)

  const [flowModal, setFlowModal] = useState(false)
  const [flowEditing, setFlowEditing] = useState(null)
  const [flowSaving, setFlowSaving] = useState(false)
  const [agentModal, setAgentModal] = useState(false)
  const [agentEditing, setAgentEditing] = useState(null)
  const [agentSaving, setAgentSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const loadAll = useCallback(async () => {
    try {
      const [convos, st, tg, qr, fl, ag] = await Promise.allSettled([
        getCrmConversations({ limit: 200 }),
        getCrmStages(),
        getCrmTags(),
        getCrmQuickReplies(),
        getCrmFlows(),
        getCrmAgents(),
      ])
      if (convos.status === 'fulfilled') setConversations(convos.value.data.conversations || [])
      if (st.status === 'fulfilled') setStages(st.value.data.stages || [])
      if (tg.status === 'fulfilled') setTags(tg.value.data.tags || [])
      if (qr.status === 'fulfilled') setQuickReplies(qr.value.data.quickReplies || [])
      if (fl.status === 'fulfilled') setFlows(fl.value.data.flows || [])
      if (ag.status === 'fulfilled') {
        setAgents(ag.value.data.agents || [])
        setAiConfigured(Boolean(ag.value.data.aiConfigured))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    const offConvo = onSocketEvent('crm:conversation', ({ conversation }) => {
      if (!conversation) return
      setConversations((prev) => prev.map((c) => (c.id === conversation.id ? conversation : c)))
    })
    const offMessage = onSocketEvent('crm:message', ({ conversation }) => {
      if (!conversation) return
      setConversations((prev) => {
        const exists = prev.some((c) => c.id === conversation.id)
        return exists ? prev.map((c) => (c.id === conversation.id ? conversation : c)) : [conversation, ...prev]
      })
    })
    return () => {
      offConvo()
      offMessage()
    }
  }, [])

  const handleMove = useCallback(
    async (conversationId, stageId) => {
      const prev = conversations
      setConversations((cs) => cs.map((c) => (c.id === conversationId ? { ...c, kanbanStageId: stageId } : c)))
      try {
        await patchCrmConversation(conversationId, { kanbanStageId: stageId })
      } catch {
        setConversations(prev)
        toast.error('Falha ao mover o card.')
      }
    },
    [conversations, toast],
  )

  const saveFlow = useCallback(
    async (flow) => {
      setFlowSaving(true)
      try {
        const payload = {
          name: flow.name.trim(),
          enabled: flow.enabled,
          trigger: flow.trigger,
          conditions: flow.conditions || [],
          actions: flow.actions.map(stripFlowActionForSave),
          cooldownPerContactHours: flow.cooldownPerContactHours,
        }
        if (flowEditing) {
          const { data } = await updateCrmFlow(flowEditing.id, payload)
          setFlows((prev) => prev.map((f) => (f.id === flowEditing.id ? data.flow : f)))
        } else {
          const { data } = await createCrmFlow(payload)
          setFlows((prev) => [data.flow, ...prev])
        }
        setFlowModal(false)
        toast.success('Fluxo salvo.')
      } catch (err) {
        toast.error(err?.response?.data?.message || 'Falha ao salvar fluxo.')
      } finally {
        setFlowSaving(false)
      }
    },
    [flowEditing, toast],
  )

  const saveAgent = useCallback(
    async (agent) => {
      setAgentSaving(true)
      try {
        const payload = {
          name: agent.name.trim(),
          enabled: agent.enabled,
          systemPrompt: agent.systemPrompt.trim(),
          model: agent.model.trim() || 'gpt-4o-mini',
          temperature: agent.temperature,
          maxTokens: agent.maxTokens,
          maxRepliesPerConversation: agent.maxRepliesPerConversation,
          handoffKeywords: agent.handoffKeywords,
          replyDelayMinSec: agent.replyDelayMinSec,
          replyDelayMaxSec: Math.max(agent.replyDelayMinSec, agent.replyDelayMaxSec),
        }
        if (agentEditing) {
          const { data } = await updateCrmAgent(agentEditing.id, payload)
          setAgents((prev) => prev.map((a) => (a.id === agentEditing.id ? data.agent : a)))
        } else {
          const { data } = await createCrmAgent(payload)
          setAgents((prev) => [...prev, data.agent])
        }
        setAgentModal(false)
        toast.success('Agente salvo.')
      } catch (err) {
        toast.error(err?.response?.data?.message || 'Falha ao salvar agente.')
      } finally {
        setAgentSaving(false)
      }
    },
    [agentEditing, toast],
  )

  const runDelete = useCallback(async () => {
    const target = confirmDelete
    if (!target) return
    try {
      if (target.kind === 'flow') {
        await deleteCrmFlow(target.id)
        setFlows((prev) => prev.filter((f) => f.id !== target.id))
      } else if (target.kind === 'agent') {
        await deleteCrmAgent(target.id)
        setAgents((prev) => prev.filter((a) => a.id !== target.id))
      }
      toast.success('Removido.')
    } catch {
      toast.error('Falha ao remover.')
    } finally {
      setConfirmDelete(null)
    }
  }, [confirmDelete, toast])

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'kanban' && (
        <>
          {conversations.length === 0 && (
            <Card className="flex flex-col items-center gap-3 py-5 text-center sm:flex-row sm:justify-between sm:px-6 sm:text-left">
              <div className="flex items-center gap-3">
                <Kanban className="h-8 w-8 shrink-0 text-stone-600" />
                <div>
                  <p className="text-sm text-stone-300">Nenhuma conversa no CRM ainda.</p>
                  <p className="text-xs text-stone-500">
                    Vá em Conversas e sincronize o histórico, ou aguarde novas mensagens. Elas aparecem aqui como cards.
                  </p>
                </div>
              </div>
              <Button variant="secondary" onClick={() => navigate('/dashboard/chat')}>
                <MessageSquare className="h-4 w-4" /> Abrir Conversas
              </Button>
            </Card>
          )}
          <KanbanBoard
            stages={stages}
            conversations={conversations}
            onMove={handleMove}
            onOpenChat={(c) => navigate(`/dashboard/chat?c=${c.id}`)}
          />
        </>
      )}

      {tab === 'flows' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-stone-400">
              Automações que reagem a eventos das conversas — sempre com cooldown e limites anti-spam.
            </p>
            <Button
              onClick={() => {
                setFlowEditing(null)
                setFlowModal(true)
              }}
            >
              <Plus className="h-4 w-4" /> Novo fluxo
            </Button>
          </div>
          {flows.length === 0 ? (
            <Card className="py-12 text-center">
              <Zap className="mx-auto h-10 w-10 text-stone-600" />
              <p className="mt-3 text-sm text-stone-400">Nenhum fluxo criado.</p>
              <p className="mt-1 text-xs text-stone-500">Ex.: boas-vindas em nova conversa, resposta a palavra-chave.</p>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {flows.map((flow) => (
                <Card key={flow.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-stone-100">{flow.name}</p>
                      <p className="mt-0.5 text-xs text-stone-500">
                        Quando: <span className="text-stone-300">{TRIGGER_LABELS[flow.trigger?.type] || '—'}</span>
                        {flow.trigger?.type === 'keyword' && flow.trigger.keywords?.length > 0 && (
                          <span className="text-stone-400"> ({flow.trigger.keywords.join(', ')})</span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-stone-500">
                        Ações:{' '}
                        <span className="text-stone-300">
                          {(flow.actions || [])
                            .map((a) => {
                              if (a.type === 'send_message' && a.mediaType && a.mediaType !== 'none') {
                                return `${ACTION_LABELS[a.type]} (${a.mediaType === 'audio' ? 'áudio' : 'vídeo'})`
                              }
                              return ACTION_LABELS[a.type] || a.type
                            })
                            .join(' → ')}
                        </span>
                      </p>
                    </div>
                    <Toggle
                      checked={flow.enabled}
                      onChange={async (v) => {
                        try {
                          const { data } = await toggleCrmFlow(flow.id, v)
                          setFlows((prev) => prev.map((f) => (f.id === flow.id ? data.flow : f)))
                        } catch {
                          toast.error('Falha ao alterar o fluxo.')
                        }
                      }}
                    />
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Badge variant={flow.enabled ? 'success' : 'muted'}>{flow.enabled ? 'Ativo' : 'Pausado'}</Badge>
                    <div className="ml-auto flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setFlowEditing(flow)
                          setFlowModal(true)
                        }}
                        className="rounded-lg p-1.5 text-stone-500 transition hover:bg-white/5 hover:text-stone-200"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete({ kind: 'flow', id: flow.id, label: `fluxo "${flow.name}"` })}
                        className="rounded-lg p-1.5 text-stone-500 transition hover:bg-white/5 hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'agents' && (
        <div className="space-y-3">
          {!aiConfigured && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              <Bot className="mr-1.5 inline h-4 w-4" />
              A chave de IA ainda não foi configurada no servidor (OPENAI_API_KEY). Você já pode criar e configurar os
              agentes — eles começam a responder assim que a chave for adicionada.
            </div>
          )}
          <div className="flex items-center justify-between">
            <p className="text-sm text-stone-400">
              Agentes respondem conversas automaticamente (ative a IA por conversa na aba Conversas).
            </p>
            <Button
              onClick={() => {
                setAgentEditing(null)
                setAgentModal(true)
              }}
            >
              <Plus className="h-4 w-4" /> Novo agente
            </Button>
          </div>
          {agents.length === 0 ? (
            <Card className="py-12 text-center">
              <Bot className="mx-auto h-10 w-10 text-stone-600" />
              <p className="mt-3 text-sm text-stone-400">Nenhum agente criado.</p>
              <p className="mt-1 text-xs text-stone-500">Crie um agente com instruções do seu negócio.</p>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {agents.map((agent) => (
                <Card key={agent.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-medium text-stone-100">
                        <Bot className="h-4 w-4 text-sky-400" />
                        <span className="truncate">{agent.name}</span>
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs text-stone-500">{agent.systemPrompt}</p>
                      <p className="mt-1 text-[11px] text-stone-500">
                        {agent.model} · máx {agent.maxRepliesPerConversation} respostas/dia · delay {agent.replyDelayMinSec}–
                        {agent.replyDelayMaxSec}s
                      </p>
                    </div>
                    <Toggle
                      checked={agent.enabled}
                      onChange={async (v) => {
                        try {
                          const { data } = await updateCrmAgent(agent.id, {
                            name: agent.name,
                            enabled: v,
                            systemPrompt: agent.systemPrompt,
                            model: agent.model,
                            temperature: agent.temperature,
                            maxTokens: agent.maxTokens,
                            maxRepliesPerConversation: agent.maxRepliesPerConversation,
                            handoffKeywords: agent.handoffKeywords,
                            replyDelayMinSec: agent.replyDelayMinSec,
                            replyDelayMaxSec: agent.replyDelayMaxSec,
                          })
                          setAgents((prev) => prev.map((a) => (a.id === agent.id ? data.agent : a)))
                        } catch {
                          toast.error('Falha ao alterar o agente.')
                        }
                      }}
                    />
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Badge variant={agent.enabled ? 'success' : 'muted'}>{agent.enabled ? 'Ativo' : 'Pausado'}</Badge>
                    <div className="ml-auto flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setAgentEditing(agent)
                          setAgentModal(true)
                        }}
                        className="rounded-lg p-1.5 text-stone-500 transition hover:bg-white/5 hover:text-stone-200"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete({ kind: 'agent', id: agent.id, label: `agente "${agent.name}"` })}
                        className="rounded-lg p-1.5 text-stone-500 transition hover:bg-white/5 hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {aiConfigured && <AgentTester agent={agent} />}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'settings' && (
        <SettingsTab
          tags={tags}
          setTags={setTags}
          stages={stages}
          setStages={setStages}
          quickReplies={quickReplies}
          setQuickReplies={setQuickReplies}
        />
      )}

      <FlowModal
        isOpen={flowModal}
        onClose={() => setFlowModal(false)}
        initial={flowEditing}
        tags={tags}
        stages={stages}
        agents={agents}
        onSave={saveFlow}
        saving={flowSaving}
      />
      <AgentModal
        isOpen={agentModal}
        onClose={() => setAgentModal(false)}
        initial={agentEditing}
        onSave={saveAgent}
        saving={agentSaving}
      />
      <ConfirmModal
        isOpen={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        onConfirm={runDelete}
        title="Remover"
        message={`Tem certeza que deseja remover ${confirmDelete?.label || 'este item'}?`}
      />
    </div>
  )
}
