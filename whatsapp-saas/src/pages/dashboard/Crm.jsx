import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Bot,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Kanban,
  Loader2,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  Send,
  Tag as TagIcon,
  Trash2,
  Unplug,
  Upload,
  Zap,
} from 'lucide-react'
import { Button } from '../../components/common/Button.jsx'
import { Card } from '../../components/common/Card.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { Modal, ConfirmModal } from '../../components/common/Modal.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Select } from '../../components/common/Select.jsx'
import { Toggle } from '../../components/common/Toggle.jsx'
import { Spinner } from '../../components/common/Spinner.jsx'
import { UserAvatar } from '../../components/common/UserAvatar.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { QuickReplyFormModal } from '../../components/crm/QuickReplyFormModal.jsx'
import { FlowMessageMedia } from '../../components/crm/FlowMessageMedia.jsx'
import { FlowPreview } from '../../components/crm/FlowPreview.jsx'
import { FlowTester } from '../../components/crm/FlowTester.jsx'
import { buildQuickReplyPayload, QUICK_REPLY_MEDIA_LABELS } from '../../lib/quickReplyMedia.js'
import { contactTitle, contactSubtitle, resolveContactPhone, formatPhoneBr } from '../../lib/contactDisplay.js'
import { useCrmAvatarAutoFetch } from '../../hooks/useCrmAvatarAutoFetch.js'
import {
  buildNoReplyTriggerPatch,
  formatNoReplyDelay,
  getNoReplyDelayUi,
  MAX_NO_REPLY_MINUTES,
} from '../../lib/flowNoReplyDelay.js'
import {
  flowMessageHasContent,
  stripFlowActionForSave,
  emptyFlowMessageMedia,
  FLOW_MEDIA_LABELS,
  buildFlowApiPayload,
  normalizeFlowCooldown,
  DEFAULT_FLOW_COOLDOWN_HOURS,
} from '../../lib/flowMedia.js'
import { onSocketEvent } from '../../services/socket.js'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { isConversationInScope } from '../../lib/crmConversationScope.js'
import { getCrmBootstrapCache, setCrmBootstrapCache } from '../../lib/crmBootstrapCache.js'
import {
  CRM_CONVERSATIONS_LIST_PARAMS,
  getBestCachedConversationsList,
  mirrorConversationsListCache,
} from '../../lib/conversationsListCache.js'
import {
  getCrmConversations,
  patchCrmConversation,
  patchCrmContact,
  addCrmContactTag,
  removeCrmContactTag,
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
  importCrmPack,
  getCrmAgents,
  createCrmAgent,
  updateCrmAgent,
  deleteCrmAgent,
  fetchOrgMembers,
  testCrmAgent,
  getWhatsAppStatus,
  refreshCrmContactAvatar,
} from '../../services/api.js'

const TABS = [
  { id: 'kanban', label: 'Kanban' },
  { id: 'flows', label: 'Fluxos' },
  { id: 'agents', label: 'Agentes IA' },
]

function readCrmInitialState() {
  const boot = getCrmBootstrapCache()
  const conversations = getBestCachedConversationsList() || []
  const stages = boot?.stages || []
  const hasCachedKanban = conversations.length > 0 || stages.length > 0
  return {
    conversations,
    stages,
    tags: boot?.tags || [],
    quickReplies: boot?.quickReplies || [],
    agents: boot?.agents || [],
    waConnected: boot?.waConnected ?? true,
    loading: !hasCachedKanban,
  }
}

function CrmSettingsToolBtn({ title, onClick, children }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded-lg border border-accent-500/35 bg-accent-500/10 p-2 text-accent-400 transition hover:border-accent-500/55 hover:bg-accent-500/20 hover:text-accent-300"
    >
      {children}
    </button>
  )
}

function CrmTabHeader({
  tab,
  onChange,
  onOpenSettings,
  refreshing,
  onImportPack,
  packImporting,
  showSellerFilter,
  sellerFilter,
  onSellerFilterChange,
  members,
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-brand-800 pb-2">
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === t.id
                ? 'border border-accent-500/30 bg-accent-500/15 text-accent-400'
                : 'text-stone-400 hover:bg-white/5 hover:text-stone-100'
            }`}
          >
            {t.label}
          </button>
        ))}
        {refreshing ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-stone-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            Atualizando…
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {showSellerFilter ? (
          <div className="min-w-[160px] sm:w-48">
            <Select
              value={sellerFilter || ''}
              onChange={(e) => onSellerFilterChange?.(e.target.value)}
              aria-label="Filtrar Kanban por vendedor"
              menuClassName="max-h-56"
            >
              <option value="">Vendedor: todos</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name || m.email}
                  {m.role === 'OWNER' ? ' (dono)' : ''}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          disabled={packImporting}
          onClick={onImportPack}
          title="Importar pack JSON (tags, estágios e fluxos)"
        >
          {packImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Importar pack
        </Button>
        <CrmSettingsToolBtn title="Tags" onClick={() => onOpenSettings('tags')}>
          <TagIcon className="h-4 w-4" />
        </CrmSettingsToolBtn>
        <CrmSettingsToolBtn title="Estágios do Kanban" onClick={() => onOpenSettings('stages')}>
          <Kanban className="h-4 w-4" />
        </CrmSettingsToolBtn>
        <CrmSettingsToolBtn title="Atalhos de mensagem" onClick={() => onOpenSettings('quickReplies')}>
          <MessageSquare className="h-4 w-4" />
        </CrmSettingsToolBtn>
      </div>
    </div>
  )
}

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

function KanbanActionBtn({ title, onClick, children, active }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-lg p-1.5 transition ${
        active
          ? 'bg-accent-500/20 text-accent-300'
          : 'text-stone-500 hover:bg-brand-800 hover:text-stone-200'
      }`}
    >
      {children}
    </button>
  )
}

function attendantInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function KanbanAttendantBadge({ attendant }) {
  if (!attendant) return null
  const label = attendant.name || attendant.email || 'Atendente'
  const src = attendant.avatarUrl || attendant.avatar || null
  return (
    <span
      title={`Atendendo: ${label}`}
      className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border-2 border-brand-900 bg-accent-500/90 text-[8px] font-bold leading-none text-brand-950 shadow-sm ring-1 ring-brand-950/40"
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden>{attendantInitials(label)}</span>
      )}
    </span>
  )
}

function KanbanCard({
  conversation: c,
  dragId,
  onDragStart,
  onDragEnd,
  onOpenChat,
  onEdit,
  onTags,
  onRefreshAvatar,
  attendant,
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`rounded-xl border border-brand-700/70 bg-brand-900/90 shadow-sm transition hover:border-accent-500/30 ${
        dragId === c.id ? 'opacity-40' : ''
      }`}
    >
      <div className="cursor-grab p-3 active:cursor-grabbing">
        <div className="flex items-start gap-2.5">
          <div className="relative shrink-0">
            <UserAvatar
              name={contactTitle(c.contact)}
              src={c.contact?.avatarUrl}
              size="sm"
              contactId={c.contact?.id}
              onRefreshAvatar={onRefreshAvatar}
            />
            <KanbanAttendantBadge attendant={attendant} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-stone-100">{contactTitle(c.contact)}</p>
            <p className="truncate text-[11px] text-stone-500">
              {contactSubtitle(c.contact) ||
                (resolveContactPhone(c.contact) ? formatPhoneBr(resolveContactPhone(c.contact)) : c.remoteJid?.split('@')[0])}
            </p>
          </div>
          {c.aiEnabled && <Bot className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" title="IA ativa" />}
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-stone-400">
          {c.lastMessageFromMe && <CheckCheck className="h-3 w-3 shrink-0 text-stone-500" />}
          <p className="line-clamp-2 min-w-0 flex-1 leading-snug">{c.lastMessagePreview || '—'}</p>
        </div>
        {(c.contact?.tags || []).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {(c.contact?.tags || []).slice(0, 3).map((t) => (
              <span
                key={t.id}
                className="rounded-full px-1.5 py-px text-[9px] font-semibold"
                style={{ backgroundColor: `${t.color}26`, color: t.color }}
              >
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-brand-700/50 px-2 py-1.5">
        <div className="flex items-center gap-0.5">
          <KanbanActionBtn title="Abrir conversa" onClick={() => onOpenChat(c)}>
            <MessageSquare className="h-3.5 w-3.5" />
          </KanbanActionBtn>
          <KanbanActionBtn title="Etiquetas" onClick={() => onTags(c)}>
            <TagIcon className="h-3.5 w-3.5" />
          </KanbanActionBtn>
          <KanbanActionBtn title="Editar contato" onClick={() => onEdit(c)}>
            <Pencil className="h-3.5 w-3.5" />
          </KanbanActionBtn>
        </div>
        <div className="flex items-center gap-1.5">
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
}

function KanbanColumn({ stage, stageId, cards, dragId, overStage, columnProps, renderCard }) {
  return (
    <div className="flex h-full w-[min(100%,300px)] shrink-0 flex-col" {...columnProps(stageId)}>
      <div className="mb-2 flex shrink-0 items-center gap-2 px-1">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: stage?.color || '#64748b' }}
        />
        <p className="truncate text-sm font-semibold text-stone-200">{stage?.name || 'Sem estágio'}</p>
        <span className="ml-auto rounded-full bg-brand-800 px-2 py-0.5 text-[11px] font-medium text-stone-400">
          {cards.length}
        </span>
      </div>
      <div
        className={`min-h-0 flex-1 space-y-2 overflow-y-auto vg-scrollbar rounded-xl p-1.5 transition ${
          overStage === stageId ? 'bg-accent-500/10 outline-dashed outline-1 outline-accent-500/40' : 'bg-brand-950/40'
        }`}
      >
        {cards.map(renderCard)}
        {cards.length === 0 && (
          <p className="px-2 py-8 text-center text-xs text-stone-600">Arraste conversas para cá</p>
        )}
      </div>
    </div>
  )
}

function KanbanQuickEditModal({ conversation, stages, open, onClose, onSaved }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState('open')
  const [stageId, setStageId] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!conversation) return
    setName(conversation.contact?.name || '')
    setNotes(conversation.contact?.notes || '')
    setStatus(conversation.status || 'open')
    setStageId(conversation.kanbanStageId || '')
  }, [conversation])

  const save = async () => {
    if (!conversation) return
    setSaving(true)
    try {
      const contactRes = await patchCrmContact(conversation.contact.id, {
        name: name.trim() || null,
        notes: notes.trim() || null,
      })
      const convoRes = await patchCrmConversation(conversation.id, {
        status,
        kanbanStageId: stageId || null,
      })
      onSaved({
        ...convoRes.data.conversation,
        contact: contactRes.data.contact || {
          ...conversation.contact,
          name: name.trim() || conversation.contact?.name,
          notes: notes.trim() || '',
        },
      })
      onClose()
      toast.success('Contato atualizado.')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  if (!open || !conversation) return null

  return (
    <Modal isOpen={open} onClose={onClose} title="Editar contato">
      <div className="space-y-3">
        <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
        <div>
          <label className="mb-1 block text-xs text-stone-400">Notas</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-brand-700 bg-brand-900/60 px-3 py-2 text-sm text-stone-100 outline-none focus:border-accent-500/60"
          />
        </div>
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Aberta</option>
          <option value="pending">Pendente</option>
          <option value="resolved">Resolvida</option>
          <option value="archived">Arquivada</option>
        </Select>
        <Select label="Estágio" value={stageId} onChange={(e) => setStageId(e.target.value)}>
          <option value="">Sem estágio</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function KanbanTagModal({ conversation, tags, open, onClose, onSaved }) {
  const toast = useToast()
  const [busy, setBusy] = useState(null)

  const contactTags = conversation?.contact?.tags || []
  const hasTag = (tagId) => contactTags.some((t) => t.id === tagId)

  const toggle = async (tag) => {
    if (!conversation?.contact?.id) return
    setBusy(tag.id)
    try {
      if (hasTag(tag.id)) {
        await removeCrmContactTag(conversation.contact.id, tag.id)
        onSaved({
          ...conversation,
          contact: {
            ...conversation.contact,
            tags: contactTags.filter((t) => t.id !== tag.id),
          },
        })
      } else {
        await addCrmContactTag(conversation.contact.id, tag.id)
        onSaved({
          ...conversation,
          contact: {
            ...conversation.contact,
            tags: [...contactTags, tag].sort((a, b) => a.name.localeCompare(b.name)),
          },
        })
      }
    } catch {
      toast.error('Falha ao atualizar tag.')
    } finally {
      setBusy(null)
    }
  }

  if (!open || !conversation) return null

  return (
    <Modal isOpen={open} onClose={onClose} title={`Etiquetas — ${conversation.contact?.name}`}>
      <div className="space-y-2">
        {tags.length === 0 ? (
          <p className="text-sm text-stone-500">Nenhuma tag criada. Use o botão de tags no topo do CRM.</p>
        ) : (
          tags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              disabled={busy === tag.id}
              onClick={() => toggle(tag)}
              className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition ${
                hasTag(tag.id)
                  ? 'border-accent-500/40 bg-accent-500/10 text-stone-100'
                  : 'border-brand-700 bg-brand-900/60 text-stone-300 hover:border-brand-600'
              }`}
            >
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: tag.color }} />
              <span className="flex-1">{tag.name}</span>
              {busy === tag.id ? <Loader2 className="h-4 w-4 animate-spin" /> : hasTag(tag.id) ? '✓' : null}
            </button>
          ))
        )}
      </div>
    </Modal>
  )
}

function KanbanBoard({ stages, conversations, onMove, onOpenChat, onEdit, onTags, onRefreshAvatar, attendantByUserId }) {
  const [dragId, setDragId] = useState(null)
  const [overStage, setOverStage] = useState(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const scrollRef = useRef(null)

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

  const updateScrollHints = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(max > 4 && el.scrollLeft < max - 4)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    updateScrollHints()
    const onScroll = () => updateScrollHints()
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateScrollHints) : null
    ro?.observe(el)
    window.addEventListener('resize', updateScrollHints)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro?.disconnect()
      window.removeEventListener('resize', updateScrollHints)
    }
  }, [updateScrollHints, stages, byStage.unstaged.length])

  const scrollByColumns = (dir) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.min(320, el.clientWidth * 0.7), behavior: 'smooth' })
  }

  const renderCard = (c) => (
    <KanbanCard
      key={c.id}
      conversation={c}
      dragId={dragId}
      attendant={c.userId ? attendantByUserId?.[c.userId] || null : null}
      onDragStart={(e) => {
        setDragId(c.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragEnd={() => {
        setDragId(null)
        setOverStage(null)
      }}
      onOpenChat={onOpenChat}
      onEdit={onEdit}
      onTags={onTags}
      onRefreshAvatar={onRefreshAvatar}
    />
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
    <div className="relative">
      {(canScrollLeft || canScrollRight) && (
        <div className="mb-2 flex items-center justify-end gap-2">
          {canScrollRight && (
            <span className="mr-auto text-xs text-stone-500">
              Há mais estágios à direita →
            </span>
          )}
          <button
            type="button"
            aria-label="Rolar Kanban para a esquerda"
            disabled={!canScrollLeft}
            onClick={() => scrollByColumns(-1)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-brand-700 bg-brand-900 text-stone-300 transition hover:border-accent-500/50 hover:text-accent-300 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Rolar Kanban para a direita"
            disabled={!canScrollRight}
            onClick={() => scrollByColumns(1)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-brand-700 bg-brand-900 text-stone-300 transition hover:border-accent-500/50 hover:text-accent-300 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="relative">
        {canScrollLeft && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-brand-950 via-brand-950/80 to-transparent"
          />
        )}
        {canScrollRight && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 z-10 w-14 bg-gradient-to-l from-brand-950 via-brand-950/85 to-transparent"
          />
        )}

        <div
          ref={scrollRef}
          className="flex h-[calc(100vh-13rem)] min-h-[420px] gap-3 overflow-x-scroll vg-scrollbar-board pb-1"
        >
          {byStage.unstaged.length > 0 && (
            <KanbanColumn
              stage={{ name: 'Sem estágio', color: '#64748b' }}
              stageId="__none__"
              cards={byStage.unstaged}
              dragId={dragId}
              overStage={overStage}
              columnProps={columnProps}
              renderCard={renderCard}
            />
          )}
          {stages.map((stage) => (
            <KanbanColumn
              key={stage.id}
              stage={stage}
              stageId={stage.id}
              cards={byStage.map.get(stage.id) || []}
              dragId={dragId}
              overStage={overStage}
              columnProps={columnProps}
              renderCard={renderCard}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================================ FLUXOS

const TRIGGER_LABELS = {
  new_conversation: 'Nova conversa',
  keyword: 'Palavra-chave',
  no_reply: 'Sem resposta',
  stage_change: 'Mudança de estágio',
  tag_added: 'Tag adicionada',
  contact_reply: 'Contato responde',
}

const ACTION_LABELS = {
  send_message: 'Enviar mensagem',
  add_tag: 'Adicionar tag',
  remove_tag: 'Remover tag',
  move_stage: 'Mover no Kanban',
  assign_ai: 'Ativar IA',
  set_status: 'Mudar status',
}

const EMPTY_FLOW = {
  name: '',
  enabled: false,
  trigger: { type: 'new_conversation' },
  actions: [{ type: 'send_message', body: '', ...emptyFlowMessageMedia() }],
  cooldownPerContactHours: DEFAULT_FLOW_COOLDOWN_HOURS,
}

function FlowModal({ isOpen, onClose, initial, tags, stages, agents, conversations, waConnected, onSave, saving }) {
  const toast = useToast()
  const [flow, setFlow] = useState(EMPTY_FLOW)

  useEffect(() => {
    if (isOpen) {
      setFlow(
        initial
          ? {
              ...JSON.parse(JSON.stringify(initial)),
              cooldownPerContactHours: normalizeFlowCooldown(initial.cooldownPerContactHours),
            }
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
    (flow.trigger.type !== 'tag_added' || Boolean(flow.trigger.tagId)) &&
    (flow.trigger.type !== 'contact_reply' || (flow.trigger.tagIds || []).length > 0) &&
    flow.actions.every((a) => {
      if (a.type === 'send_message') return flowMessageHasContent(a)
      if (a.type === 'add_tag' || a.type === 'remove_tag') return a.tagId
      if (a.type === 'move_stage') return a.stageId
      if (a.type === 'set_status') return a.value
      return true
    })

  const toggleContactReplyTag = (tagId) => {
    const id = String(tagId)
    const current = Array.isArray(flow.trigger.tagIds) ? flow.trigger.tagIds : []
    const next = current.includes(id) ? current.filter((t) => t !== id) : [...current, id]
    setTrigger({ tagIds: next })
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initial ? 'Editar fluxo' : 'Novo fluxo'}
      size="xl"
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
      <div className="grid gap-5 lg:grid-cols-[1fr,minmax(260px,320px)]">
        <div className="max-h-[min(70vh,640px)] space-y-4 overflow-y-auto pr-1">
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
            <option value="no_reply">Contato sem responder há um tempo</option>
            <option value="stage_change">Card movido no Kanban</option>
            <option value="tag_added">Quando a tag é adicionada</option>
            <option value="contact_reply">Quando o contato responde</option>
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
          {flow.trigger.type === 'no_reply' && (() => {
            const delay = getNoReplyDelayUi(flow.trigger)
            const max = delay.unit === 'minutes' ? MAX_NO_REPLY_MINUTES : 720
            return (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <div className="min-w-[120px] flex-1">
                  <Input
                    label="Tempo sem resposta"
                    type="number"
                    min={1}
                    max={max}
                    value={delay.value}
                    onChange={(e) => {
                      const n = Math.max(1, Number(e.target.value) || 1)
                      setTrigger(buildNoReplyTriggerPatch(n, delay.unit))
                    }}
                  />
                </div>
                <div className="w-36">
                  <p className="mb-1.5 text-sm font-medium text-stone-300">Unidade</p>
                  <Select
                    value={delay.unit}
                    onChange={(e) => {
                      const unit = e.target.value === 'minutes' ? 'minutes' : 'hours'
                      const n = Math.max(1, Number(delay.value) || 1)
                      setTrigger(buildNoReplyTriggerPatch(n, unit))
                    }}
                  >
                    <option value="minutes">Minutos</option>
                    <option value="hours">Horas</option>
                  </Select>
                </div>
                <p className="w-full text-[11px] text-stone-500">
                  Ex.: 30 minutos ou 24 horas após a última mensagem sua sem resposta do contato.
                </p>
              </div>
            )
          })()}
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
          {flow.trigger.type === 'tag_added' && (
            <div className="mt-2">
              <p className="mb-1.5 text-sm font-medium text-stone-300">Qual tag</p>
              <Select value={flow.trigger.tagId || ''} onChange={(e) => setTrigger({ tagId: e.target.value || '' })}>
                <option value="">Selecione a tag…</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
              <p className="mt-1.5 text-[11px] text-stone-500">
                Dispara quando essa tag é adicionada ao contato (manual, outro fluxo, orçamento/compra).
              </p>
            </div>
          )}
          {flow.trigger.type === 'contact_reply' && (
            <div className="mt-2">
              <p className="mb-1.5 text-sm font-medium text-stone-300">Somente se o contato tiver a(s) tag(s)</p>
              <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-xl border border-brand-700/70 bg-brand-950/40 p-2">
                {tags.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-stone-500">Crie tags no CRM antes de usar este gatilho.</p>
                ) : (
                  tags.map((t) => {
                    const checked = (flow.trigger.tagIds || []).includes(t.id)
                    return (
                      <label
                        key={t.id}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-stone-200 hover:bg-white/5"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleContactReplyTag(t.id)}
                          className="h-3.5 w-3.5 rounded border-brand-600 bg-brand-900 text-accent-500 focus:ring-accent-500/40"
                        />
                        <span className="truncate">{t.name}</span>
                      </label>
                    )
                  })
                )}
              </div>
              <p className="mt-1.5 text-[11px] text-stone-500">
                Dispara na resposta do lead (conversa já existente) se tiver qualquer uma das tags. Obrigatório escolher ao
                menos 1.
              </p>
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
              disabled={flow.actions.length >= 10}
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
                      <option value="remove_tag">Remover tag do contato</option>
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

        <div>
          <Input
            label="Cooldown por contato (horas)"
            type="number"
            min={1}
            max={720}
            value={flow.cooldownPerContactHours}
            onChange={(e) =>
              setFlow((f) => ({
                ...f,
                cooldownPerContactHours: e.target.value === '' ? '' : Math.max(1, Number(e.target.value) || 1),
              }))
            }
            onBlur={() =>
              setFlow((f) => ({
                ...f,
                cooldownPerContactHours: normalizeFlowCooldown(f.cooldownPerContactHours),
              }))
            }
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-stone-500">
            Padrão: <span className="text-stone-400">{DEFAULT_FLOW_COOLDOWN_HOURS}h</span> — evita que o mesmo contato
            receba este fluxo repetido (proteção anti-spam). Recomendado manter em 24h ou mais.
          </p>
        </div>
        </div>

        <div className="space-y-4 lg:sticky lg:top-0 lg:self-start">
          <FlowPreview flow={flow} tags={tags} stages={stages} agents={agents} />
          <FlowTester
            flow={flow}
            flowId={initial?.id}
            conversations={conversations}
            waConnected={waConnected}
            testDraft
          />
        </div>
      </div>
    </Modal>
  )
}

function FlowTestModal({ isOpen, onClose, flow, tags, stages, agents, conversations, waConnected }) {
  if (!flow) return null
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Testar: ${flow.name}`} size="md">
      <div className="space-y-4">
        <FlowPreview flow={flow} tags={tags} stages={stages} agents={agents} compact />
        <FlowTester
          flow={flow}
          flowId={flow.id}
          conversations={conversations}
          waConnected={waConnected}
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

function CrmSettingsPanels({ tags, setTags, stages, setStages, quickReplies, setQuickReplies, openPanel, onClosePanel }) {
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
    <>
      <Modal isOpen={openPanel === 'tags'} onClose={onClosePanel} title="Tags" size="lg">
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
      </Modal>

      <Modal isOpen={openPanel === 'stages'} onClose={onClosePanel} title="Estágios do Kanban" size="lg">
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
      </Modal>

      <Modal isOpen={openPanel === 'quickReplies'} onClose={onClosePanel} title="Atalhos de mensagem" size="xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs text-stone-500">
            Na aba Conversas, digite <span className="rounded bg-brand-800 px-1.5 py-0.5 font-mono text-accent-400">/atalho</span>{' '}
            no campo de mensagem.
          </p>
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
      </Modal>

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
    </>
  )
}

// ============================================================ PÁGINA

export function Crm() {
  const toast = useToast()
  const navigate = useNavigate()
  const { user, isOrgOwner } = useAuth()
  const [sellerFilter, setSellerFilter] = useState('')
  const [orgMembers, setOrgMembers] = useState([])
  const scopeRef = useRef({ userId: user?.id, isOrgOwner, filterSellerUserId: '' })
  scopeRef.current = { userId: user?.id, isOrgOwner, filterSellerUserId: sellerFilter || '' }
  const [tab, setTab] = useState('kanban')
  const initial = useMemo(() => readCrmInitialState(), [])

  const [conversations, setConversations] = useState(initial.conversations)
  const [stages, setStages] = useState(initial.stages)
  const [tags, setTags] = useState(initial.tags)
  const [quickReplies, setQuickReplies] = useState(initial.quickReplies)
  const [flows, setFlows] = useState([])
  const [agents, setAgents] = useState(initial.agents)
  const [aiConfigured, setAiConfigured] = useState(false)
  const [loading, setLoading] = useState(initial.loading)
  const [refreshing, setRefreshing] = useState(false)
  const [flowsLoading, setFlowsLoading] = useState(false)
  const [agentsLoading, setAgentsLoading] = useState(false)

  const conversationsRef = useRef(conversations)
  const flowsLoadedRef = useRef(false)
  const agentsLoadedRef = useRef(initial.agents.length > 0)
  const kanbanLoadSeq = useRef(0)

  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])

  const [flowModal, setFlowModal] = useState(false)
  const [flowEditing, setFlowEditing] = useState(null)
  const [flowSaving, setFlowSaving] = useState(false)
  const [flowTestTarget, setFlowTestTarget] = useState(null)
  const [packImporting, setPackImporting] = useState(false)
  const packFileRef = useRef(null)
  const [agentModal, setAgentModal] = useState(false)
  const [agentEditing, setAgentEditing] = useState(null)
  const [agentSaving, setAgentSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [kanbanEdit, setKanbanEdit] = useState(null)
  const [kanbanTags, setKanbanTags] = useState(null)
  const [settingsPanel, setSettingsPanel] = useState(null)
  const [waConnected, setWaConnected] = useState(initial.waConnected)
  useCrmAvatarAutoFetch(conversations, { enabled: waConnected && !loading })

  const kanbanListParams = useMemo(() => {
    const params = { ...CRM_CONVERSATIONS_LIST_PARAMS }
    if (isOrgOwner && sellerFilter) params.sellerUserId = sellerFilter
    return params
  }, [isOrgOwner, sellerFilter])

  const loadKanbanData = useCallback(async () => {
    const seq = ++kanbanLoadSeq.current
    const hasData = conversationsRef.current.length > 0
    if (!hasData) setLoading(true)
    else setRefreshing(true)
    try {
      const [convos, st, tg] = await Promise.allSettled([
        getCrmConversations(kanbanListParams),
        getCrmStages(),
        getCrmTags(),
      ])
      if (seq !== kanbanLoadSeq.current) return
      const nextBoot = { ...(getCrmBootstrapCache() || {}) }
      if (convos.status === 'fulfilled') {
        const rows = convos.value.data.conversations || []
        setConversations(rows)
        // Só espelha cache global da inbox quando não há filtro de vendedor
        if (!kanbanListParams.sellerUserId) {
          mirrorConversationsListCache(rows, CRM_CONVERSATIONS_LIST_PARAMS)
        }
      }
      if (st.status === 'fulfilled') {
        setStages(st.value.data.stages || [])
        nextBoot.stages = st.value.data.stages || []
      }
      if (tg.status === 'fulfilled') {
        setTags(tg.value.data.tags || [])
        nextBoot.tags = tg.value.data.tags || []
      }
      if (nextBoot.stages || nextBoot.tags) setCrmBootstrapCache(nextBoot)
    } finally {
      if (seq === kanbanLoadSeq.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [kanbanListParams])

  useEffect(() => {
    if (!isOrgOwner) {
      setOrgMembers([])
      setSellerFilter('')
      return
    }
    let cancelled = false
    fetchOrgMembers()
      .then((res) => {
        if (cancelled) return
        setOrgMembers(res?.members || [])
      })
      .catch(() => {
        if (!cancelled) setOrgMembers([])
      })
    return () => {
      cancelled = true
    }
  }, [isOrgOwner])

  const attendantByUserId = useMemo(() => {
    const map = {}
    for (const m of orgMembers) {
      if (!m?.userId) continue
      map[m.userId] = {
        name: m.name || m.email || 'Atendente',
        email: m.email || null,
        avatarUrl: m.avatarUrl || m.avatar || null,
      }
    }
    if (user?.id) {
      map[user.id] = {
        name: user.name || user.email || map[user.id]?.name || 'Eu',
        email: user.email || map[user.id]?.email || null,
        avatarUrl: user.avatar || user.avatarUrl || map[user.id]?.avatarUrl || null,
      }
    }
    return map
  }, [orgMembers, user])

  const loadSecondary = useCallback(async () => {
    const nextBoot = { ...(getCrmBootstrapCache() || {}) }
    const [qr, wa] = await Promise.allSettled([getCrmQuickReplies(), getWhatsAppStatus()])
    if (qr.status === 'fulfilled') {
      setQuickReplies(qr.value.data.quickReplies || [])
      nextBoot.quickReplies = qr.value.data.quickReplies || []
    }
    if (wa.status === 'fulfilled') {
      const connected = Boolean(wa.value.data?.connected)
      setWaConnected(connected)
      nextBoot.waConnected = connected
    }
    setCrmBootstrapCache(nextBoot)
  }, [])

  const loadFlows = useCallback(async () => {
    if (flowsLoadedRef.current) return
    flowsLoadedRef.current = true
    setFlowsLoading(true)
    try {
      const { data } = await getCrmFlows()
      setFlows(data.flows || [])
    } catch {
      flowsLoadedRef.current = false
      toast.error('Falha ao carregar fluxos.')
    } finally {
      setFlowsLoading(false)
    }
  }, [toast])

  const reloadFlowsForce = useCallback(async () => {
    flowsLoadedRef.current = false
    await loadFlows()
  }, [loadFlows])

  const handleImportPackFile = useCallback(
    async (file) => {
      if (!file) return
      setPackImporting(true)
      try {
        const text = await file.text()
        let pack
        try {
          pack = JSON.parse(text)
        } catch {
          throw new Error('Arquivo JSON inválido.')
        }
        const { data } = await importCrmPack(pack)
        const s = data.summary || {}
        toast.success(
          `Pack “${s.packName || 'CRM'}”: ${s.flowsCreated || 0} fluxo(s), ${s.tagsCreated || 0} tag(s) nova(s), ${s.stagesCreated || 0} estágio(s) novo(s).`,
        )
        // Atualiza listas locais
        const [tagsRes, stagesRes] = await Promise.all([getCrmTags(), getCrmStages()])
        setTags(tagsRes.data.tags || [])
        setStages(stagesRes.data.stages || [])
        setCrmBootstrapCache({
          ...(getCrmBootstrapCache() || {}),
          tags: tagsRes.data.tags || [],
          stages: stagesRes.data.stages || [],
        })
        await reloadFlowsForce()
      } catch (err) {
        toast.error(err?.response?.data?.message || err?.message || 'Falha ao importar pack.')
      } finally {
        setPackImporting(false)
        if (packFileRef.current) packFileRef.current.value = ''
      }
    },
    [toast, reloadFlowsForce],
  )

  const loadAgents = useCallback(async () => {
    if (agentsLoadedRef.current) return
    agentsLoadedRef.current = true
    setAgentsLoading(true)
    try {
      const { data } = await getCrmAgents()
      setAgents(data.agents || [])
      setAiConfigured(Boolean(data.aiConfigured))
      setCrmBootstrapCache({ agents: data.agents || [] })
    } catch {
      agentsLoadedRef.current = false
      toast.error('Falha ao carregar agentes.')
    } finally {
      setAgentsLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadKanbanData()
    loadSecondary()
  }, [loadKanbanData, loadSecondary])

  useEffect(() => {
    if (tab === 'flows') loadFlows()
    if (tab === 'agents') loadAgents()
  }, [tab, loadFlows, loadAgents])

  useEffect(() => {
    const offConvo = onSocketEvent('crm:conversation', ({ conversation }) => {
      if (!conversation || !isConversationInScope(conversation, scopeRef.current)) return
      setConversations((prev) => {
        const exists = prev.some((c) => c.id === conversation.id)
        if (!exists) return [conversation, ...prev]
        return prev.map((c) => (c.id === conversation.id ? conversation : c))
      })
    })
    const offMessage = onSocketEvent('crm:message', ({ conversation }) => {
      if (!conversation || !isConversationInScope(conversation, scopeRef.current)) return
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
      const normalizedStageId = stageId === '__none__' ? null : stageId
      const prev = conversations
      setConversations((cs) =>
        cs.map((c) => (c.id === conversationId ? { ...c, kanbanStageId: normalizedStageId } : c)),
      )
      try {
        await patchCrmConversation(conversationId, { kanbanStageId: normalizedStageId })
      } catch {
        setConversations(prev)
        toast.error('Falha ao mover o card.')
      }
    },
    [conversations, toast],
  )

  const updateConversation = useCallback((updated) => {
    if (!updated) return
    setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
  }, [])

  const refreshAvatar = useCallback(async (contactId) => {
    try {
      const { data } = await refreshCrmContactAvatar(contactId)
      if (data.contact) {
        setConversations((prev) =>
          prev.map((c) => (c.contact?.id === contactId ? { ...c, contact: data.contact } : c)),
        )
      }
      return data.avatarUrl || data.contact?.avatarUrl || null
    } catch {
      return null
    }
  }, [])

  const saveFlow = useCallback(
    async (flow) => {
      setFlowSaving(true)
      try {
        const payload = buildFlowApiPayload(flow)
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
      <div className="space-y-4">
        <input
          ref={packFileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleImportPackFile(file)
          }}
        />
        <CrmTabHeader
          tab={tab}
          onChange={setTab}
          onOpenSettings={setSettingsPanel}
          onImportPack={() => packFileRef.current?.click()}
          packImporting={packImporting}
        />
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <input
        ref={packFileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleImportPackFile(file)
        }}
      />
      <CrmTabHeader
        tab={tab}
        onChange={setTab}
        onOpenSettings={setSettingsPanel}
        refreshing={refreshing}
        onImportPack={() => packFileRef.current?.click()}
        packImporting={packImporting}
        showSellerFilter={tab === 'kanban' && isOrgOwner && orgMembers.length > 0}
        sellerFilter={sellerFilter}
        onSellerFilterChange={setSellerFilter}
        members={orgMembers}
      />

      {tab === 'kanban' && (
        <>
          {!waConnected && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-100">
              <Unplug className="h-4 w-4 shrink-0 text-amber-400" />
              <span className="flex-1">WhatsApp desconectado — reconecte para sincronizar fotos, mídia e envios.</span>
              <Link to="/dashboard/connect" className="shrink-0 font-medium text-accent-300 underline hover:text-accent-200">
                Conectar WhatsApp
              </Link>
            </div>
          )}
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
            onEdit={setKanbanEdit}
            onTags={setKanbanTags}
            onRefreshAvatar={refreshAvatar}
            attendantByUserId={attendantByUserId}
          />
          <KanbanQuickEditModal
            conversation={kanbanEdit}
            stages={stages}
            open={Boolean(kanbanEdit)}
            onClose={() => setKanbanEdit(null)}
            onSaved={updateConversation}
          />
          <KanbanTagModal
            conversation={kanbanTags}
            tags={tags}
            open={Boolean(kanbanTags)}
            onClose={() => setKanbanTags(null)}
            onSaved={updateConversation}
          />
        </>
      )}

      {tab === 'flows' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
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
          {flowsLoading ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : flows.length === 0 ? (
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
                        {flow.trigger?.type === 'no_reply' && (
                          <span className="text-stone-400"> ({formatNoReplyDelay(flow.trigger)})</span>
                        )}
                        {flow.trigger?.type === 'tag_added' && flow.trigger.tagId && (
                          <span className="text-stone-400">
                            {' '}
                            ({tags.find((t) => t.id === flow.trigger.tagId)?.name || 'tag'})
                          </span>
                        )}
                        {flow.trigger?.type === 'contact_reply' && (flow.trigger.tagIds || []).length > 0 && (
                          <span className="text-stone-400">
                            {' '}
                            (
                            {(flow.trigger.tagIds || [])
                              .map((id) => tags.find((t) => t.id === id)?.name || 'tag')
                              .join(', ')}
                            )
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-stone-500">
                        Ações:{' '}
                        <span className="text-stone-300">
                          {(flow.actions || [])
                            .map((a) => {
                              if (a.type === 'send_message' && a.mediaType && a.mediaType !== 'none') {
                                const label = FLOW_MEDIA_LABELS[a.mediaType] || a.mediaType
                                return `${ACTION_LABELS[a.type]} (${label.toLowerCase()})`
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
                  <div className="mt-3">
                    <FlowPreview flow={flow} tags={tags} stages={stages} agents={agents} compact />
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Badge variant={flow.enabled ? 'success' : 'muted'}>{flow.enabled ? 'Ativo' : 'Pausado'}</Badge>
                    <div className="ml-auto flex gap-1">
                      <button
                        type="button"
                        title="Testar fluxo"
                        onClick={() => setFlowTestTarget(flow)}
                        className="rounded-lg p-1.5 text-stone-500 transition hover:bg-accent-500/10 hover:text-accent-300"
                      >
                        <Play className="h-4 w-4" />
                      </button>
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
          {agentsLoading ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : agents.length === 0 ? (
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

      <CrmSettingsPanels
        tags={tags}
        setTags={setTags}
        stages={stages}
        setStages={setStages}
        quickReplies={quickReplies}
        setQuickReplies={setQuickReplies}
        openPanel={settingsPanel}
        onClosePanel={() => setSettingsPanel(null)}
      />

      <FlowModal
        isOpen={flowModal}
        onClose={() => setFlowModal(false)}
        initial={flowEditing}
        tags={tags}
        stages={stages}
        agents={agents}
        conversations={conversations}
        waConnected={waConnected}
        onSave={saveFlow}
        saving={flowSaving}
      />
      <FlowTestModal
        isOpen={Boolean(flowTestTarget)}
        onClose={() => setFlowTestTarget(null)}
        flow={flowTestTarget}
        tags={tags}
        stages={stages}
        agents={agents}
        conversations={conversations}
        waConnected={waConnected}
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
