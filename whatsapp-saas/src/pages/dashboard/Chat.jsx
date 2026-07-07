import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Search,
  Send,
  Paperclip,
  X,
  RefreshCw,
  Bot,
  CheckCheck,
  Clock,
  Tag as TagIcon,
  StickyNote,
  Zap,
  Loader2,
  MessageSquare,
  ChevronDown,
  User,
  UserPlus,
} from 'lucide-react'
import { Button } from '../../components/common/Button.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { Modal } from '../../components/common/Modal.jsx'
import { Select } from '../../components/common/Select.jsx'
import { Toggle } from '../../components/common/Toggle.jsx'
import { UserAvatar } from '../../components/common/UserAvatar.jsx'
import { Spinner } from '../../components/common/Spinner.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { onSocketEvent } from '../../services/socket.js'
import { hasSeenChatOnboarding } from '../../lib/chatOnboarding.js'
import { ChatOnboardingModal } from '../../components/dashboard/ChatOnboardingModal.jsx'
import {
  getCrmConversations,
  getCrmConversationMessages,
  sendCrmMessage,
  markCrmConversationRead,
  patchCrmConversation,
  patchCrmContact,
  saveCrmContact,
  getCrmTags,
  createCrmTag,
  addCrmContactTag,
  removeCrmContactTag,
  getCrmStages,
  getCrmQuickReplies,
  getCrmQuickReplyContent,
  getCrmAgents,
  startCrmSync,
  getCrmSyncStatus,
  refreshCrmProfiles,
} from '../../services/api.js'

// ---------------------------------------------------------------- helpers

function formatChatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function formatMsgTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function dayLabel(iso) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Hoje'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

function formatEta(seconds) {
  if (seconds == null) return null
  if (seconds < 60) return `~${seconds}s restantes`
  const min = Math.round(seconds / 60)
  return `~${min}min restantes`
}

function mediaTypeFromMime(mime) {
  if (!mime) return 'none'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  return 'none'
}

const STATUS_LABELS = {
  open: 'Aberta',
  pending: 'Pendente',
  resolved: 'Resolvida',
  archived: 'Arquivada',
}

// ---------------------------------------------------------------- sync banner

function SyncBanner({ job, onStartSync, syncStarting, onRefreshProfiles, profileRefreshing }) {
  const [days, setDays] = useState('30')
  if (!job || ['done', 'error', 'cancelled'].includes(job.status)) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-brand-800 bg-brand-900/60 px-3 py-2">
        <RefreshCw className="h-4 w-4 text-stone-400" />
        <span className="text-xs text-stone-400">
          {job?.status === 'done'
            ? `Última sincronização: ${formatChatTime(job.finishedAt)} · ${job.totalMessages} msgs de ${job.doneChats} conversas`
            : job?.status === 'error'
              ? 'Última sincronização falhou.'
              : 'Importe as conversas antigas do seu WhatsApp.'}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onRefreshProfiles} disabled={profileRefreshing || syncStarting}>
            {profileRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <User className="h-3.5 w-3.5" />}
            Nomes e fotos
          </Button>
          <select
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="rounded-lg border border-brand-700 bg-brand-900 px-2 py-1 text-xs text-stone-200"
          >
            <option value="7">7 dias</option>
            <option value="30">30 dias</option>
            <option value="90">90 dias</option>
            <option value="180">180 dias</option>
          </select>
          <Button size="sm" variant="secondary" onClick={() => onStartSync(Number(days))} disabled={syncStarting || profileRefreshing}>
            {syncStarting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sincronizar
          </Button>
        </div>
      </div>
    )
  }

  const pct = job.totalChats > 0 ? Math.round((job.doneChats / job.totalChats) * 100) : 0
  const rateLimited = job.status === 'rate_limited'
  return (
    <div className={`border-b px-3 py-2 ${rateLimited ? 'border-amber-500/30 bg-amber-500/10' : 'border-accent-500/25 bg-accent-500/10'}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {rateLimited ? (
          <Clock className="h-4 w-4 text-amber-400" />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-accent-400" />
        )}
        <span className={rateLimited ? 'text-amber-200' : 'text-accent-200'}>
          {rateLimited
            ? `WhatsApp limitou consultas. Retomada após ${job.retryAfter ? new Date(job.retryAfter).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'alguns minutos'}.`
            : `Sincronizando ${job.doneChats}/${job.totalChats} conversas · ${job.totalMessages} msgs importadas`}
        </span>
        {!rateLimited && job.currentChat && <span className="text-stone-400">· {job.currentChat}</span>}
        {!rateLimited && formatEta(job.etaSeconds) && <span className="text-stone-400">· {formatEta(job.etaSeconds)}</span>}
        <span className="ml-auto text-stone-400">
          início {new Date(job.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {!rateLimited && (
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-brand-800">
          <div className="h-full rounded-full bg-accent-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- página

export function Chat() {
  const toast = useToast()
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  const [conversations, setConversations] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')

  const [activeId, setActiveId] = useState(searchParams.get('c') || null)
  const [messages, setMessages] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [attachment, setAttachment] = useState(null) // { base64, mime, name, type }

  const [tags, setTags] = useState([])
  const [stages, setStages] = useState([])
  const [agents, setAgents] = useState([])
  const [quickReplies, setQuickReplies] = useState([])
  const [qrOpen, setQrOpen] = useState(false)
  const [qrFilter, setQrFilter] = useState('')

  const [syncJob, setSyncJob] = useState(null)
  const [syncStarting, setSyncStarting] = useState(false)
  const [profileRefreshing, setProfileRefreshing] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)

  const [showPanel, setShowPanel] = useState(true)
  const [notesDraft, setNotesDraft] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [saveOnWhatsapp, setSaveOnWhatsapp] = useState(true)
  const [savingContact, setSavingContact] = useState(false)
  const [newTagModal, setNewTagModal] = useState(false)
  const [newTagName, setNewTagName] = useState('')

  const listEndRef = useRef(null)
  const threadRef = useRef(null)
  const inputRef = useRef(null)
  const fileRef = useRef(null)
  const activeIdRef = useRef(activeId)
  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  const active = useMemo(() => conversations.find((c) => c.id === activeId) || null, [conversations, activeId])

  // ------------------------------------------------ carregamento

  useEffect(() => {
    if (!user) return
    if (!hasSeenChatOnboarding(user)) setShowOnboarding(true)
  }, [user])

  const loadConversations = useCallback(async () => {
    try {
      const params = {}
      if (query.trim()) params.q = query.trim()
      if (statusFilter) params.status = statusFilter
      if (tagFilter) params.tagId = tagFilter
      const { data } = await getCrmConversations(params)
      setConversations(data.conversations || [])
    } catch {
      toast.error('Falha ao carregar conversas.')
    } finally {
      setLoadingList(false)
    }
  }, [query, statusFilter, tagFilter, toast])

  useEffect(() => {
    const t = setTimeout(loadConversations, query ? 350 : 0)
    return () => clearTimeout(t)
  }, [loadConversations, query])

  useEffect(() => {
    Promise.allSettled([getCrmTags(), getCrmStages(), getCrmAgents(), getCrmQuickReplies(), getCrmSyncStatus()]).then(
      ([t, s, a, q, sync]) => {
        if (t.status === 'fulfilled') setTags(t.value.data.tags || [])
        if (s.status === 'fulfilled') setStages(s.value.data.stages || [])
        if (a.status === 'fulfilled') setAgents(a.value.data.agents || [])
        if (q.status === 'fulfilled') setQuickReplies(q.value.data.quickReplies || [])
        if (sync.status === 'fulfilled') setSyncJob(sync.value.data.job || null)
      },
    )
  }, [])

  const openConversation = useCallback(
    async (id) => {
      setActiveId(id)
      setSearchParams(id ? { c: id } : {}, { replace: true })
      setMessages([])
      setLoadingMessages(true)
      try {
        const { data } = await getCrmConversationMessages(id, { limit: 50 })
        setMessages(data.messages || [])
        setHasMore(Boolean(data.hasMore))
        markCrmConversationRead(id)
          .then(({ data: d }) => {
            if (d.conversation) {
              setConversations((prev) => prev.map((c) => (c.id === id ? d.conversation : c)))
            }
          })
          .catch(() => {})
      } catch {
        toast.error('Falha ao carregar mensagens.')
      } finally {
        setLoadingMessages(false)
      }
    },
    [setSearchParams, toast],
  )

  useEffect(() => {
    const fromUrl = searchParams.get('c')
    if (fromUrl && fromUrl !== activeIdRef.current) openConversation(fromUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadOlder = useCallback(async () => {
    if (!activeId || !messages.length || loadingOlder) return
    setLoadingOlder(true)
    try {
      const before = messages[0]?.timestamp
      const { data } = await getCrmConversationMessages(activeId, { limit: 50, before })
      setMessages((prev) => [...(data.messages || []), ...prev])
      setHasMore(Boolean(data.hasMore))
    } catch {
      toast.error('Falha ao carregar histórico.')
    } finally {
      setLoadingOlder(false)
    }
  }, [activeId, messages, loadingOlder, toast])

  // ------------------------------------------------ tempo real

  useEffect(() => {
    const offMessage = onSocketEvent('crm:message', ({ conversationId, message, conversation }) => {
      if (conversation) {
        setConversations((prev) => {
          const rest = prev.filter((c) => c.id !== conversation.id)
          return [conversation, ...rest]
        })
      }
      if (conversationId === activeIdRef.current && message) {
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]))
        markCrmConversationRead(conversationId).catch(() => {})
      }
    })
    const offConvo = onSocketEvent('crm:conversation', ({ conversation }) => {
      if (!conversation) return
      setConversations((prev) => prev.map((c) => (c.id === conversation.id ? conversation : c)))
    })
    const offSync = onSocketEvent('crm:sync', ({ job }) => {
      setSyncJob(job)
      if (job?.status === 'done') {
        toast.success('Sincronização concluída.')
        loadConversations()
      }
    })
    const offHandoff = onSocketEvent('crm:handoff', () => {
      toast.info('Uma conversa foi transferida da IA para atendimento humano.', 'Transferência')
      loadConversations()
    })
    return () => {
      offMessage()
      offConvo()
      offSync()
      offHandoff()
    }
  }, [loadConversations, toast])

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, activeId])

  useEffect(() => {
    setNotesDraft(active?.contact?.notes || '')
    setNameDraft(active?.contact?.savedName || '')
  }, [activeId, active?.contact?.notes, active?.contact?.savedName])

  // ------------------------------------------------ ações

  const handleSend = useCallback(async () => {
    const body = draft.trim()
    if ((!body && !attachment) || !activeId || sending) return
    setSending(true)
    try {
      const payload = { body }
      if (attachment) {
        payload.mediaType = attachment.type
        payload.mediaBase64 = attachment.base64
        payload.mediaMime = attachment.mime
        payload.mediaName = attachment.name
      }
      const { data } = await sendCrmMessage(activeId, payload)
      if (data.message) {
        setMessages((prev) => (prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]))
      }
      if (data.conversation) {
        setConversations((prev) => {
          const rest = prev.filter((c) => c.id !== data.conversation.id)
          return [data.conversation, ...rest]
        })
      }
      setDraft('')
      setAttachment(null)
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao enviar mensagem.')
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }, [draft, attachment, activeId, sending, toast])

  const handleFile = useCallback(
    (file) => {
      if (!file) return
      const type = mediaTypeFromMime(file.type)
      if (type === 'none') {
        toast.error('Envie apenas imagem ou vídeo MP4.')
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = String(reader.result || '').replace(/^data:[^;]+;base64,/, '')
        setAttachment({ base64, mime: file.type, name: file.name, type })
      }
      reader.readAsDataURL(file)
    },
    [toast],
  )

  const updateConversation = useCallback(
    async (payload) => {
      if (!activeId) return
      try {
        const { data } = await patchCrmConversation(activeId, payload)
        if (data.conversation) {
          setConversations((prev) => prev.map((c) => (c.id === data.conversation.id ? data.conversation : c)))
        }
      } catch (err) {
        toast.error(err?.response?.data?.message || 'Falha ao atualizar conversa.')
      }
    },
    [activeId, toast],
  )

  const saveNotes = useCallback(async () => {
    if (!active?.contact?.id) return
    try {
      const { data } = await patchCrmContact(active.contact.id, { notes: notesDraft })
      if (data.contact) {
        setConversations((prev) =>
          prev.map((c) => (c.id === activeId ? { ...c, contact: { ...c.contact, ...data.contact } } : c)),
        )
        toast.success('Notas salvas.')
      }
    } catch {
      toast.error('Falha ao salvar notas.')
    }
  }, [active, notesDraft, activeId, toast])

  const saveContactName = useCallback(async () => {
    const name = nameDraft.trim()
    if (!active?.contact?.id || !name) return
    setSavingContact(true)
    try {
      const { data } = await saveCrmContact(active.contact.id, { name, saveOnWhatsapp })
      if (data.contact) {
        setConversations((prev) =>
          prev.map((c) => (c.id === activeId ? { ...c, contact: { ...c.contact, ...data.contact } } : c)),
        )
        setNameDraft(data.contact.savedName || name)
      }
      if (data.whatsappSaved) toast.success(data.message || 'Contato salvo.')
      else if (data.message?.includes('apenas no Vesto')) toast.info(data.message)
      else toast.success(data.message || 'Nome salvo no Vesto.')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao salvar contato.')
    } finally {
      setSavingContact(false)
    }
  }, [active, nameDraft, saveOnWhatsapp, activeId, toast])

  const toggleContactTag = useCallback(
    async (tag) => {
      if (!active?.contact) return
      const has = (active.contact.tags || []).some((t) => t.id === tag.id)
      try {
        const { data } = has
          ? await removeCrmContactTag(active.contact.id, tag.id)
          : await addCrmContactTag(active.contact.id, tag.id)
        if (data.contact) {
          setConversations((prev) => prev.map((c) => (c.id === activeId ? { ...c, contact: data.contact } : c)))
        }
      } catch {
        toast.error('Falha ao atualizar tags.')
      }
    },
    [active, activeId, toast],
  )

  const handleCreateTag = useCallback(async () => {
    const name = newTagName.trim()
    if (!name) return
    try {
      const { data } = await createCrmTag({ name })
      setTags((prev) => [...prev, data.tag].sort((a, b) => a.name.localeCompare(b.name)))
      setNewTagModal(false)
      setNewTagName('')
      toast.success('Tag criada.')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao criar tag.')
    }
  }, [newTagName, toast])

  const handleRefreshProfiles = useCallback(async () => {
    setProfileRefreshing(true)
    try {
      const { data } = await refreshCrmProfiles()
      await loadConversations()
      if (data.enriched || data.queued) {
        toast.success(data.message || 'Nomes e fotos atualizados.')
      } else {
        toast.info(data.message || 'Nenhum perfil novo encontrado.')
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao atualizar nomes e fotos.')
    } finally {
      setProfileRefreshing(false)
    }
  }, [loadConversations, toast])

  const handleStartSync = useCallback(
    async (days) => {
      setSyncStarting(true)
      try {
        const { data } = await startCrmSync({ days })
        if (data.job) setSyncJob(data.job)
        if (data.alreadyRunning) toast.info('Sincronização já está em andamento.')
        else toast.success('Sincronização iniciada.')
      } catch (err) {
        toast.error(err?.response?.data?.message || 'Falha ao iniciar sincronização.')
      } finally {
        setSyncStarting(false)
      }
    },
    [toast],
  )

  const applyQuickReply = useCallback(
    async (qr) => {
      setQrOpen(false)
      // remove o "/texto" digitado
      setDraft((prev) => prev.replace(/\/[a-z0-9_-]*$/i, '').trimEnd())
      if (qr.hasMedia) {
        try {
          const { data } = await getCrmQuickReplyContent(qr.id)
          const full = data.quickReply
          if (full?.mediaBase64) {
            setAttachment({
              base64: full.mediaBase64.replace(/^data:[^;]+;base64,/, ''),
              mime: full.mediaMime || 'image/jpeg',
              name: full.mediaName || 'midia',
              type: full.mediaType,
            })
          }
        } catch {
          toast.error('Falha ao carregar a mídia do atalho.')
        }
      }
      setDraft((prev) => (prev ? `${prev} ${qr.body}` : qr.body))
      inputRef.current?.focus()
    },
    [toast],
  )

  const onDraftChange = useCallback((value) => {
    setDraft(value)
    const match = value.match(/(?:^|\s)\/([a-z0-9_-]*)$/i)
    if (match) {
      setQrFilter(match[1].toLowerCase())
      setQrOpen(true)
    } else {
      setQrOpen(false)
    }
  }, [])

  const filteredQuickReplies = useMemo(() => {
    if (!qrFilter) return quickReplies
    return quickReplies.filter(
      (q) => q.shortcut.includes(qrFilter) || (q.title || '').toLowerCase().includes(qrFilter),
    )
  }, [quickReplies, qrFilter])

  // ------------------------------------------------ agrupamento por dia

  const groupedMessages = useMemo(() => {
    const groups = []
    let currentDay = null
    for (const msg of messages) {
      const day = msg.timestamp ? new Date(msg.timestamp).toDateString() : 'unknown'
      if (day !== currentDay) {
        currentDay = day
        groups.push({ type: 'day', id: `day-${day}`, label: msg.timestamp ? dayLabel(msg.timestamp) : '' })
      }
      groups.push({ type: 'msg', id: msg.id, msg })
    }
    return groups
  }, [messages])

  // ------------------------------------------------ render

  return (
    <>
      <ChatOnboardingModal
        isOpen={showOnboarding}
        user={user}
        onComplete={() => setShowOnboarding(false)}
      />
      <div className="flex h-[calc(100vh-7.5rem)] min-h-[480px] overflow-hidden rounded-2xl border border-brand-800 bg-brand-900/40">
      {/* Lista de conversas */}
      <div className="flex w-full max-w-xs shrink-0 flex-col border-r border-brand-800">
        <SyncBanner
          job={syncJob}
          onStartSync={handleStartSync}
          syncStarting={syncStarting}
          onRefreshProfiles={handleRefreshProfiles}
          profileRefreshing={profileRefreshing}
        />
        <div className="space-y-2 border-b border-brand-800 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar conversa…"
              className="w-full rounded-xl border border-brand-700 bg-brand-900/60 py-2 pl-9 pr-3 text-sm text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/60"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="flex-1 rounded-lg border border-brand-700 bg-brand-900 px-2 py-1.5 text-xs text-stone-200"
            >
              <option value="">Todas</option>
              <option value="open">Abertas</option>
              <option value="pending">Pendentes</option>
              <option value="resolved">Resolvidas</option>
              <option value="archived">Arquivadas</option>
            </select>
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="flex-1 rounded-lg border border-brand-700 bg-brand-900 px-2 py-1.5 text-xs text-stone-200"
            >
              <option value="">Todas as tags</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingList ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <MessageSquare className="mx-auto h-8 w-8 text-stone-600" />
              <p className="mt-2 text-sm text-stone-400">Nenhuma conversa ainda.</p>
              <p className="mt-1 text-xs text-stone-500">
                Sincronize o histórico acima ou aguarde novas mensagens chegarem.
              </p>
            </div>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => openConversation(c.id)}
                className={`flex w-full items-center gap-3 border-b border-brand-800/60 px-3 py-3 text-left transition hover:bg-white/5 ${
                  c.id === activeId ? 'bg-accent-500/10' : ''
                }`}
              >
                <UserAvatar name={c.contact?.name} src={c.contact?.avatarUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-stone-100">{c.contact?.name}</p>
                    <span className="shrink-0 text-[10px] text-stone-500">{formatChatTime(c.lastMessageAt)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {c.lastMessageFromMe && <CheckCheck className="h-3 w-3 shrink-0 text-stone-500" />}
                    <p className="truncate text-xs text-stone-400">{c.lastMessagePreview || '—'}</p>
                    {c.unreadCount > 0 && (
                      <span className="ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-brand-950">
                        {c.unreadCount}
                      </span>
                    )}
                    {c.aiEnabled && <Bot className="h-3.5 w-3.5 shrink-0 text-sky-400" />}
                  </div>
                  {(c.contact?.tags || []).length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.contact.tags.slice(0, 3).map((t) => (
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
              </button>
            ))
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!active ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-stone-500">
            <MessageSquare className="h-10 w-10" />
            <p className="text-sm">Selecione uma conversa para começar.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-brand-800 px-4 py-3">
              <UserAvatar name={active.contact?.name} src={active.contact?.avatarUrl} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-stone-100">{active.contact?.name}</p>
                <p className="text-xs text-stone-500">
                  {active.contact?.phone ? `+${active.contact.phone}` : active.remoteJid.split('@')[0]}
                </p>
              </div>
              {active.aiEnabled && (
                <Badge variant="default" className="border-sky-500/30 bg-sky-500/10 text-sky-300">
                  <Bot className="mr-1 h-3 w-3" /> IA ativa
                </Badge>
              )}
              <Badge variant={active.status === 'open' ? 'success' : active.status === 'pending' ? 'warning' : 'muted'}>
                {STATUS_LABELS[active.status] || active.status}
              </Badge>
              <button
                type="button"
                onClick={() => setShowPanel((v) => !v)}
                className="rounded-lg p-2 text-stone-400 transition hover:bg-white/5 hover:text-stone-100"
                title="Painel do contato"
              >
                <ChevronDown className={`h-4 w-4 transition ${showPanel ? 'rotate-90' : '-rotate-90'}`} />
              </button>
            </div>

            <div ref={threadRef} className="flex-1 space-y-1 overflow-y-auto px-4 py-3">
              {hasMore && (
                <div className="flex justify-center pb-2">
                  <Button size="sm" variant="ghost" onClick={loadOlder} disabled={loadingOlder}>
                    {loadingOlder ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Carregar mensagens antigas'}
                  </Button>
                </div>
              )}
              {loadingMessages ? (
                <div className="flex justify-center py-10">
                  <Spinner />
                </div>
              ) : (
                groupedMessages.map((item) =>
                  item.type === 'day' ? (
                    <div key={item.id} className="flex justify-center py-2">
                      <span className="rounded-full bg-brand-800/80 px-3 py-1 text-[10px] font-medium text-stone-400">
                        {item.label}
                      </span>
                    </div>
                  ) : (
                    <div key={item.id} className={`flex ${item.msg.fromMe ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow ${
                          item.msg.fromMe
                            ? 'rounded-br-md bg-accent-500/20 text-stone-100'
                            : 'rounded-bl-md bg-brand-800 text-stone-200'
                        }`}
                      >
                        {item.msg.type !== 'text' && !item.msg.body && (
                          <p className="italic text-stone-400">
                            {item.msg.type.includes('image')
                              ? '📷 Imagem'
                              : item.msg.type.includes('video')
                                ? '🎬 Vídeo'
                                : item.msg.type.includes('audio')
                                  ? '🎤 Áudio'
                                  : '📎 Mídia'}
                          </p>
                        )}
                        {item.msg.body && <p className="whitespace-pre-wrap break-words">{item.msg.body}</p>}
                        <div className="mt-1 flex items-center justify-end gap-1">
                          {item.msg.source === 'ai' && <Bot className="h-3 w-3 text-sky-400" />}
                          {item.msg.source === 'flow' && <Zap className="h-3 w-3 text-amber-400" />}
                          <span className="text-[10px] text-stone-500">{formatMsgTime(item.msg.timestamp)}</span>
                          {item.msg.fromMe && <CheckCheck className="h-3 w-3 text-stone-500" />}
                        </div>
                      </div>
                    </div>
                  ),
                )
              )}
              <div ref={listEndRef} />
            </div>

            {/* Composer */}
            <div className="relative border-t border-brand-800 p-3">
              {qrOpen && filteredQuickReplies.length > 0 && (
                <div className="absolute bottom-full left-3 z-20 mb-1 max-h-56 w-80 overflow-y-auto rounded-xl border border-brand-700 bg-brand-900 shadow-2xl">
                  {filteredQuickReplies.map((qr) => (
                    <button
                      key={qr.id}
                      type="button"
                      onClick={() => applyQuickReply(qr)}
                      className="flex w-full flex-col gap-0.5 border-b border-brand-800/60 px-3 py-2 text-left transition hover:bg-white/5"
                    >
                      <span className="text-xs font-semibold text-accent-400">/{qr.shortcut}</span>
                      <span className="truncate text-xs text-stone-400">{qr.title || qr.body}</span>
                    </button>
                  ))}
                </div>
              )}
              {attachment && (
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-brand-700 bg-brand-800/60 px-3 py-1.5 text-xs text-stone-300">
                  <Paperclip className="h-3.5 w-3.5" />
                  <span className="truncate">{attachment.name}</span>
                  <button type="button" onClick={() => setAttachment(null)} className="ml-auto text-stone-500 hover:text-stone-200">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <div className="flex items-end gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,video/mp4"
                  className="hidden"
                  onChange={(e) => {
                    handleFile(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="rounded-xl p-2.5 text-stone-400 transition hover:bg-white/5 hover:text-stone-100"
                  title="Anexar imagem ou vídeo"
                >
                  <Paperclip className="h-5 w-5" />
                </button>
                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => onDraftChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                    if (e.key === 'Escape') setQrOpen(false)
                  }}
                  rows={1}
                  placeholder="Digite uma mensagem… (use / para atalhos)"
                  className="max-h-32 min-h-[42px] flex-1 resize-none rounded-xl border border-brand-700 bg-brand-900/60 px-4 py-2.5 text-sm text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/60"
                />
                <Button onClick={handleSend} disabled={sending || (!draft.trim() && !attachment)}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Painel do contato */}
      {active && showPanel && (
        <div className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-brand-800 lg:flex">
          <div className="flex flex-col items-center gap-2 border-b border-brand-800 px-4 py-5">
            <UserAvatar name={active.contact?.name} src={active.contact?.avatarUrl} size="md" />
            <p className="text-center text-sm font-semibold text-stone-100">{active.contact?.name}</p>
            {active.contact?.pushName && active.contact.pushName !== active.contact?.savedName && (
              <p className="text-center text-xs text-stone-500">WhatsApp: {active.contact.pushName}</p>
            )}
            <p className="text-xs text-stone-500">
              {active.contact?.phone ? `+${active.contact.phone}` : active.remoteJid.split('@')[0]}
            </p>
          </div>

          <div className="space-y-4 p-4">
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
                <UserPlus className="mr-1 inline h-3 w-3" />
                Salvar contato
              </p>
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Nome para identificar este contato"
                className="w-full rounded-xl border border-brand-700 bg-brand-900/60 px-3 py-2 text-xs text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/60"
              />
              {active.contact?.phone && (
                <label className="mt-2 flex cursor-pointer items-start gap-2 text-[11px] leading-snug text-stone-400">
                  <input
                    type="checkbox"
                    checked={saveOnWhatsapp}
                    onChange={(e) => setSaveOnWhatsapp(e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-brand-600 bg-brand-900 text-accent-500"
                  />
                  Salvar também na agenda do WhatsApp conectado
                </label>
              )}
              <Button
                size="sm"
                variant="secondary"
                className="mt-2 w-full"
                onClick={saveContactName}
                disabled={savingContact || !nameDraft.trim()}
              >
                {savingContact ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                Salvar contato
              </Button>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">Status</p>
              <Select
                value={active.status}
                onChange={(e) => updateConversation({ status: e.target.value })}
              >
                <option value="open">Aberta</option>
                <option value="pending">Pendente</option>
                <option value="resolved">Resolvida</option>
                <option value="archived">Arquivada</option>
              </Select>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">Estágio (CRM)</p>
              <Select
                value={active.kanbanStageId || ''}
                onChange={(e) => updateConversation({ kanbanStageId: e.target.value || null })}
              >
                <option value="">Sem estágio</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                  <TagIcon className="mr-1 inline h-3 w-3" />
                  Tags
                </p>
                <button
                  type="button"
                  onClick={() => setNewTagModal(true)}
                  className="text-xs text-accent-400 hover:text-accent-300"
                >
                  + Nova
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tags.length === 0 && <p className="text-xs text-stone-500">Nenhuma tag criada.</p>}
                {tags.map((t) => {
                  const selected = (active.contact?.tags || []).some((x) => x.id === t.id)
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleContactTag(t)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                        selected ? '' : 'opacity-45 hover:opacity-80'
                      }`}
                      style={{
                        borderColor: `${t.color}66`,
                        backgroundColor: selected ? `${t.color}26` : 'transparent',
                        color: t.color,
                      }}
                    >
                      {t.name}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
                <Bot className="mr-1 inline h-3 w-3" />
                Atendimento por IA
              </p>
              <Toggle
                checked={active.aiEnabled}
                onChange={(v) => updateConversation({ aiEnabled: v })}
                label={active.aiEnabled ? 'IA respondendo' : 'Desligada'}
              />
              {active.aiEnabled && agents.length > 0 && (
                <div className="mt-2">
                  <Select
                    value={active.aiAgentId || ''}
                    onChange={(e) => updateConversation({ aiAgentId: e.target.value || null })}
                  >
                    <option value="">Agente padrão</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
                <StickyNote className="mr-1 inline h-3 w-3" />
                Notas internas
              </p>
              <textarea
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={4}
                placeholder="Anotações sobre este contato…"
                className="w-full resize-none rounded-xl border border-brand-700 bg-brand-900/60 px-3 py-2 text-xs text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/60"
              />
              <Button size="sm" variant="secondary" className="mt-1.5 w-full" onClick={saveNotes}>
                Salvar notas
              </Button>
            </div>

            {active.syncedCount > 0 && (
              <p className="text-[10px] text-stone-500">
                {active.syncedCount} msgs importadas
                {active.oldestSyncedAt ? ` · desde ${new Date(active.oldestSyncedAt).toLocaleDateString('pt-BR')}` : ''}
              </p>
            )}
          </div>
        </div>
      )}

      <Modal
        isOpen={newTagModal}
        onClose={() => setNewTagModal(false)}
        title="Nova tag"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewTagModal(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateTag} disabled={!newTagName.trim()}>
              Criar tag
            </Button>
          </>
        }
      >
        <input
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreateTag()}
          placeholder="Nome da tag (ex.: Lead quente)"
          className="w-full rounded-xl border border-brand-700 bg-brand-900/60 px-4 py-2.5 text-sm text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/60"
        />
      </Modal>
    </div>
    </>
  )
}
