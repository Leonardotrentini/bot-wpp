import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Send,
  Paperclip,
  X,
  Bot,
  CheckCheck,
  Tag as TagIcon,
  StickyNote,
  Zap,
  Loader2,
  MessageSquare,
  ChevronDown,
  ArrowLeft,
  User,
  UserPlus,
  Mic,
  Film,
  FileText,
  Unplug,
  Users,
  Pencil,
  Trash2,
} from 'lucide-react'
import { Button } from '../../components/common/Button.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { Modal, ConfirmModal } from '../../components/common/Modal.jsx'
import { Select } from '../../components/common/Select.jsx'
import { Toggle } from '../../components/common/Toggle.jsx'
import { UserAvatar } from '../../components/common/UserAvatar.jsx'
import { Spinner } from '../../components/common/Spinner.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { onSocketEvent } from '../../services/socket.js'
import { isConversationInScope } from '../../lib/crmConversationScope.js'
import { hasSeenChatOnboarding } from '../../lib/chatOnboarding.js'
import { useCrmAvatarAutoFetch } from '../../hooks/useCrmAvatarAutoFetch.js'
import { runBackgroundAvatarSweep } from '../../lib/crmAvatarEnqueue.js'
import { ChatOnboardingModal } from '../../components/dashboard/ChatOnboardingModal.jsx'
import { ChatSyncBar } from '../../components/dashboard/ChatSyncBar.jsx'
import { ChatConversationFilters } from '../../components/dashboard/ChatConversationFilters.jsx'
import { ChatMessageContent, primeCrmMessageMediaCache } from '../../components/crm/ChatMessageContent.jsx'
import { ChatQuickRepliesMenu } from '../../components/crm/ChatQuickRepliesMenu.jsx'
import { ContactLeadActions } from '../../components/crm/ContactLeadActions.jsx'
import { AudioRecorderButton } from '../../components/crm/AudioRecorderButton.jsx'
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
  updateCrmTag,
  deleteCrmTag,
  addCrmContactTag,
  removeCrmContactTag,
  getCrmStages,
  getCrmQuickReplies,
  getCrmQuickReplyContent,
  getCrmAgents,
  startCrmSync,
  getCrmSyncStatus,
  refreshCrmProfiles,
  refreshCrmContactAvatar,
  getWhatsAppStatus,
  getGroups,
  getGroupMessages,
  sendMessage,
  fetchOrgMembers,
} from '../../services/api.js'

import { contactTitle, contactSubtitle, contactNeedsIdentification, resolveContactPhone, formatPhoneBr, isSelfOrGenericPushName } from '../../lib/contactDisplay.js'
import { toastMetaTracking } from '../../lib/metaTrackingFeedback.js'
import {
  groupChatId,
  groupToListItem,
  isGroupChatId,
  isMonitoredGroup,
  mapGroupMessageToChat,
  parseGroupChatId,
  sortChatListItems,
} from '../../lib/chatGroups.js'
import { revokeAudioPreview, warmUpAudioRecording } from '../../lib/audioRecorder.js'
import {
  appendCachedMessage,
  fetchConversationMessagesCached,
  getCachedConversationMessages,
  prefetchConversationMessages,
  removeCachedMessage,
  replaceCachedMessage,
  setCachedConversationMessages,
} from '../../lib/conversationMessagesCache.js'
import { getCachedConversationsList, mirrorConversationsListCache, setCachedConversationsList } from '../../lib/conversationsListCache.js'
import {
  getCrmBootstrapCache,
  markProfilesRefreshDone,
  profilesRefreshDoneThisSession,
  setCrmBootstrapCache,
} from '../../lib/crmBootstrapCache.js'

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

function mediaTypeFromMime(mime, name = '') {
  if (!mime && name) {
    if (/\.pdf$/i.test(name)) return 'document'
  }
  if (!mime) return 'none'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf') return 'document'
  return 'none'
}

const ConversationListItem = memo(function ConversationListItem({
  conversation: c,
  active,
  onOpen,
  onPrefetch,
  onRefreshAvatar,
}) {
  const isGroup = c.kind === 'group'
  const subtitle = isGroup ? null : contactSubtitle(c.contact)
  const unidentified = !isGroup && contactNeedsIdentification(c.contact)
  return (
    <button
      type="button"
      onClick={() => onOpen(c.id)}
      onMouseEnter={() => onPrefetch(c.id)}
      onFocus={() => onPrefetch(c.id)}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
        c.id === active
          ? 'bg-accent-500/12 ring-1 ring-inset ring-accent-500/30'
          : 'hover:bg-white/[0.04]'
      }`}
    >
      <UserAvatar
        name={contactTitle(c.contact)}
        src={c.contact?.avatarUrl}
        size="sm"
        contactId={isGroup ? undefined : c.contact?.id}
        onRefreshAvatar={isGroup ? undefined : onRefreshAvatar}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-medium text-stone-100">{contactTitle(c.contact)}</p>
          <span className="shrink-0 text-[10px] text-stone-500">{formatChatTime(c.lastMessageAt)}</span>
        </div>
        {subtitle && (
          <p className={`truncate text-[10px] ${unidentified ? 'text-amber-400/90' : 'text-stone-500'}`}>{subtitle}</p>
        )}
        <div className="mt-0.5 flex items-center gap-1.5">
          {c.lastMessageFromMe && <CheckCheck className="h-3 w-3 shrink-0 text-stone-500" />}
          <p className="truncate text-xs text-stone-400">{c.lastMessagePreview || '—'}</p>
          {unidentified && (
            <span className="ml-auto shrink-0 rounded px-1 py-px text-[9px] font-semibold text-amber-200 bg-amber-500/20">
              ?
            </span>
          )}
          {c.unreadCount > 0 && (
            <span className="ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-brand-950">
              {c.unreadCount}
            </span>
          )}
          {c.aiEnabled && <Bot className="h-3.5 w-3.5 shrink-0 text-sky-400" />}
        </div>
        {!isGroup && (c.contact?.tags || []).length > 0 && (
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
  )
})

// ---------------------------------------------------------------- página

export function Chat() {
  const toastApi = useToast()
  const toastRef = useRef(toastApi)
  toastRef.current = toastApi
  const { user, isImpersonating, isOrgOwner } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  const [conversations, setConversations] = useState([])
  const [monitoredGroups, setMonitoredGroups] = useState([])
  const [allMonitoredGroups, setAllMonitoredGroups] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [refreshingList, setRefreshingList] = useState(false)
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [sellerFilter, setSellerFilter] = useState('')
  const [orgMembers, setOrgMembers] = useState([])
  const [groupsOnly, setGroupsOnly] = useState(false)
  const [unidentifiedOnly, setUnidentifiedOnly] = useState(false)

  const scopeRef = useRef({ userId: user?.id, isOrgOwner, filterSellerUserId: '' })
  scopeRef.current = { userId: user?.id, isOrgOwner, filterSellerUserId: sellerFilter || '' }

  const [activeId, setActiveId] = useState(() => {
    // URLSearchParams já devolve decodificado — não usar encodeURIComponent ao gravar
    const raw = searchParams.get('c')
    if (!raw) return null
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  })
  /** Evita limpar a thread na 1ª montagem (só ao trocar filtro de membro/tag/estágio). */
  const filtersMountedRef = useRef(false)
  const [messages, setMessages] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [refreshingMessages, setRefreshingMessages] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [attachment, setAttachment] = useState(null) // { base64, mime, name, type }
  const [isRecording, setIsRecording] = useState(false)

  const [tags, setTags] = useState([])
  const [stages, setStages] = useState([])
  const [agents, setAgents] = useState([])
  const [quickReplies, setQuickReplies] = useState([])
  const [qrOpen, setQrOpen] = useState(false)
  const [qrFilter, setQrFilter] = useState('')

  const [syncJob, setSyncJob] = useState(null)
  const [syncStarting, setSyncStarting] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [waConnected, setWaConnected] = useState(true)
  useCrmAvatarAutoFetch(conversations, { enabled: waConnected && !loadingList })
  const listLoadSeq = useRef(0)
  const listErrorAt = useRef(0)

  const [showPanel, setShowPanel] = useState(true)
  const [notesDraft, setNotesDraft] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [savingContact, setSavingContact] = useState(false)
  const [newTagModal, setNewTagModal] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#22c55e')
  const [tagEditModal, setTagEditModal] = useState(false)
  const [tagEditing, setTagEditing] = useState(null)
  const [tagForm, setTagForm] = useState({ name: '', color: '#22c55e' })
  const [tagSaving, setTagSaving] = useState(false)
  const [tagToDelete, setTagToDelete] = useState(null)

  const listEndRef = useRef(null)
  const threadRef = useRef(null)
  const inputRef = useRef(null)
  const fileRef = useRef(null)
  const activeIdRef = useRef(activeId)
  const conversationsRef = useRef(conversations)
  const loadConversationsRef = useRef(() => {})
  const scrollToEndRef = useRef(true)
  const loadingOlderRef = useRef(false)
  const lastReadAtRef = useRef(new Map())
  useEffect(() => {
    activeIdRef.current = activeId
    scrollToEndRef.current = true
  }, [activeId])

  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])

  const listParams = useMemo(() => {
    const params = { includeTotal: 0 }
    if (query.trim()) params.q = query.trim()
    if (tagFilter) params.tagId = tagFilter
    if (stageFilter) params.stageId = stageFilter
    if (isOrgOwner && sellerFilter) params.sellerUserId = sellerFilter
    return params
  }, [query, tagFilter, stageFilter, sellerFilter, isOrgOwner])

  const markReadDebounced = useCallback((conversationId) => {
    if (isGroupChatId(conversationId)) return
    const conv = conversationsRef.current.find((c) => c.id === conversationId)
    if (!conv?.unreadCount) return
    const now = Date.now()
    const last = lastReadAtRef.current.get(conversationId) || 0
    if (now - last < 2000) return
    lastReadAtRef.current.set(conversationId, now)
    markCrmConversationRead(conversationId)
      .then(({ data: d }) => {
        if (d.conversation) {
          setConversations((prev) => prev.map((c) => (c.id === conversationId ? d.conversation : c)))
        }
      })
      .catch(() => {})
  }, [])

  const chatList = useMemo(() => {
    const groupItems = monitoredGroups.map(groupToListItem)
    return sortChatListItems([...conversations, ...groupItems])
  }, [conversations, monitoredGroups])

  const active = useMemo(() => chatList.find((c) => c.id === activeId) || null, [chatList, activeId])
  const activeIsGroup = active?.kind === 'group'

  const monitoredGroupCount = monitoredGroups.length

  const displayedConversations = useMemo(() => {
    const term = query.trim().toLowerCase()
    const scope = { userId: user?.id, isOrgOwner, filterSellerUserId: sellerFilter || '' }

    const filterGroup = (c) => {
      if (sellerFilter && c.ownerUserId && c.ownerUserId !== sellerFilter) return false
      if (!term) return true
      const name = (c.contact?.name || '').toLowerCase()
      const preview = (c.lastMessagePreview || '').toLowerCase()
      return name.includes(term) || preview.includes(term)
    }

    if (groupsOnly) {
      return sortChatListItems(monitoredGroups.map(groupToListItem).filter(filterGroup))
    }

    let direct = conversations.filter((c) => isConversationInScope(c, scope))
    if (unidentifiedOnly) {
      direct = direct.filter((c) => contactNeedsIdentification(c.contact))
    }

    const groups = monitoredGroups.map(groupToListItem).filter(filterGroup)
    return sortChatListItems([...groups, ...direct])
  }, [monitoredGroups, conversations, groupsOnly, unidentifiedOnly, query, sellerFilter, user?.id, isOrgOwner])

  const unidentifiedCount = useMemo(
    () => conversations.filter((c) => contactNeedsIdentification(c.contact)).length,
    [conversations],
  )

  // ------------------------------------------------ carregamento

  useEffect(() => {
    if (!user) return
    if (!hasSeenChatOnboarding(user)) setShowOnboarding(true)
  }, [user])

  const loadConversations = useCallback(async () => {
    const seq = ++listLoadSeq.current
    const hasData = conversationsRef.current.length > 0
    if (!hasData) setLoadingList(true)
    else setRefreshingList(true)
    try {
      const [convRes, groupsRes] = await Promise.allSettled([getCrmConversations(listParams), getGroups()])
      if (seq !== listLoadSeq.current) return
      if (convRes.status === 'fulfilled') {
        const rows = convRes.value.data.conversations || []
        setConversations(rows)
        mirrorConversationsListCache(rows, listParams)
      }
      if (groupsRes.status === 'fulfilled') {
        setAllMonitoredGroups((groupsRes.value.data.groups || []).filter(isMonitoredGroup))
      }
      if (convRes.status === 'rejected') throw convRes.reason
    } catch {
      if (seq !== listLoadSeq.current) return
      const now = Date.now()
      if (now - listErrorAt.current > 10000) {
        listErrorAt.current = now
        toastRef.current.error('Falha ao carregar conversas.')
      }
    } finally {
      if (seq === listLoadSeq.current) {
        setLoadingList(false)
        setRefreshingList(false)
      }
    }
  }, [listParams])

  loadConversationsRef.current = loadConversations

  useEffect(() => {
    const refreshGroups = () => {
      getGroups()
        .then(({ data }) => setAllMonitoredGroups((data.groups || []).filter(isMonitoredGroup)))
        .catch(() => {})
    }
    refreshGroups()
    const id = setInterval(refreshGroups, 30000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!sellerFilter) {
      setMonitoredGroups(allMonitoredGroups)
      return
    }
    // Sem ownerUserId não mistura — só grupos daquele membro
    setMonitoredGroups(allMonitoredGroups.filter((g) => g.ownerUserId === sellerFilter))
  }, [allMonitoredGroups, sellerFilter])

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

  // Troca de membro/tag/estágio: zera lista e thread (não na digitação da busca).
  // Não depende de setSearchParams — no RR7 a referência muda com a URL e re-disparava
  // este efeito ao abrir conversa (limpava activeId e a lista 1:1; sobravam só grupos).
  useEffect(() => {
    if (!filtersMountedRef.current) {
      filtersMountedRef.current = true
      return
    }
    setConversations([])
    setActiveId(null)
    setMessages([])
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('c')
        return next
      },
      { replace: true },
    )
    setLoadingList(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setSearchParams propositalmente omitido
  }, [sellerFilter, tagFilter, stageFilter])

  useEffect(() => {
    const cached = getCachedConversationsList(listParams)
    if (cached?.length) {
      setConversations(cached)
      setLoadingList(false)
    }
    const t = setTimeout(loadConversations, query ? 350 : 0)
    return () => clearTimeout(t)
  }, [loadConversations, query, listParams])

  useEffect(() => {
    const boot = getCrmBootstrapCache()
    if (boot) {
      if (boot.tags) setTags(boot.tags)
      if (boot.stages) setStages(boot.stages)
      if (boot.agents) setAgents(boot.agents)
      if (boot.quickReplies) setQuickReplies(boot.quickReplies)
      if (boot.waConnected != null) setWaConnected(boot.waConnected)
    }
    Promise.allSettled([getCrmTags(), getCrmStages(), getCrmAgents(), getCrmQuickReplies(), getCrmSyncStatus(), getWhatsAppStatus()]).then(
      ([t, s, a, q, sync, wa]) => {
        const next = {}
        if (t.status === 'fulfilled') {
          setTags(t.value.data.tags || [])
          next.tags = t.value.data.tags || []
        }
        if (s.status === 'fulfilled') {
          setStages(s.value.data.stages || [])
          next.stages = s.value.data.stages || []
        }
        if (a.status === 'fulfilled') {
          setAgents(a.value.data.agents || [])
          next.agents = a.value.data.agents || []
        }
        if (q.status === 'fulfilled') {
          setQuickReplies(q.value.data.quickReplies || [])
          next.quickReplies = q.value.data.quickReplies || []
        }
        if (sync.status === 'fulfilled') setSyncJob(sync.value.data.job || null)
        if (wa.status === 'fulfilled') {
          const connected = Boolean(wa.value.data?.connected)
          setWaConnected(connected)
          next.waConnected = connected
        }
        setCrmBootstrapCache(next)
      },
    )
  }, [])

  useEffect(() => {
    if (!waConnected || profilesRefreshDoneThisSession()) return
    markProfilesRefreshDone()
    const t = setTimeout(() => {
      refreshCrmProfiles().catch(() => {})
    }, 4000)
    return () => clearTimeout(t)
  }, [waConnected])

  useEffect(() => {
    if (!activeId || !waConnected) return undefined
    const t = setTimeout(() => {
      warmUpAudioRecording().catch(() => {})
    }, 600)
    return () => clearTimeout(t)
  }, [activeId, waConnected])

  // Poll do status de sync enquanto job ativo (fallback se socket cair)
  useEffect(() => {
    const active = syncJob && ['running', 'rate_limited'].includes(syncJob.status)
    if (!active) return undefined
    const poll = () => {
      getCrmSyncStatus()
        .then(({ data }) => {
          if (data.job) setSyncJob(data.job)
        })
        .catch(() => {})
    }
    poll()
    const id = setInterval(poll, 5000)
    return () => clearInterval(id)
  }, [syncJob?.id, syncJob?.status])

  const fetchMessagesPage = useCallback(async (conversationId, params = {}) => {
    const { data } = await getCrmConversationMessages(conversationId, params)
    return { messages: data.messages || [], hasMore: Boolean(data.hasMore) }
  }, [])

  const fetchGroupMessagesPage = useCallback(async (groupJid) => {
    const { data } = await getGroupMessages(groupJid, 100)
    const rows = (data.messages || []).map(mapGroupMessageToChat).reverse()
    return { messages: rows, hasMore: false, groupName: data.groupName }
  }, [])

  const refreshGroupInList = useCallback((groupJid, patch) => {
    setAllMonitoredGroups((prev) =>
      prev.map((g) => (g.id === groupJid ? { ...g, ...patch } : g)),
    )
  }, [])

  const prefetchConversation = useCallback(
    (conversationId) => {
      if (isGroupChatId(conversationId)) return
      prefetchConversationMessages(conversationId, (id, params) => fetchMessagesPage(id, params))
    },
    [fetchMessagesPage],
  )

  const openConversation = useCallback(
    async (id) => {
      setActiveId(id)
      // Passar o id cru: o router codifica uma vez. encodeURIComponent duplo quebrava o ?c=
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (id) next.set('c', id)
          else next.delete('c')
          return next
        },
        { replace: true },
      )

      if (isGroupChatId(id)) {
        const groupJid = parseGroupChatId(id)
        setMessages([])
        setHasMore(false)
        setLoadingMessages(true)
        setRefreshingMessages(false)
        try {
          const fresh = await fetchGroupMessagesPage(groupJid)
          if (activeIdRef.current !== id) return
          setMessages(fresh.messages)
          setHasMore(false)
        } catch {
          if (activeIdRef.current === id) {
            toastRef.current.error('Falha ao carregar mensagens do grupo.')
          }
        } finally {
          if (activeIdRef.current === id) {
            setLoadingMessages(false)
            setRefreshingMessages(false)
          }
        }
        return
      }

      const cached = getCachedConversationMessages(id)
      if (cached?.messages?.length) {
        setMessages(cached.messages)
        setHasMore(cached.hasMore)
        setLoadingMessages(false)
        setRefreshingMessages(true)
      } else {
        setMessages([])
        setHasMore(false)
        setLoadingMessages(true)
        setRefreshingMessages(false)
      }

      try {
        const fresh = await fetchConversationMessagesCached(
          id,
          (convId, params) => fetchMessagesPage(convId, params),
          {
            onUpdated: (entry) => {
              if (activeIdRef.current !== id) return
              setMessages(entry.messages)
              setHasMore(entry.hasMore)
            },
          },
        )
        if (activeIdRef.current !== id) return
        setMessages(fresh.messages)
        setHasMore(fresh.hasMore)
        markReadDebounced(id)
      } catch {
        if (activeIdRef.current === id && !cached?.messages?.length) {
          toastRef.current.error('Falha ao carregar mensagens.')
        }
      } finally {
        if (activeIdRef.current === id) {
          setLoadingMessages(false)
          setRefreshingMessages(false)
        }
      }
    },
    [setSearchParams, fetchMessagesPage, fetchGroupMessagesPage, markReadDebounced],
  )

  const closeMobileThread = useCallback(() => {
    setActiveId(null)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('c')
        return next
      },
      { replace: true },
    )
  }, [setSearchParams])

  useEffect(() => {
    const raw = searchParams.get('c')
    if (!raw) return
    let fromUrl = raw
    try {
      fromUrl = decodeURIComponent(raw)
    } catch {
      /* raw já ok */
    }
    if (fromUrl && fromUrl !== activeIdRef.current) openConversation(fromUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!activeId || !isGroupChatId(activeId)) return undefined
    const groupJid = parseGroupChatId(activeId)
    const poll = () => {
      fetchGroupMessagesPage(groupJid)
        .then((fresh) => {
          if (activeIdRef.current !== activeId) return
          setMessages(fresh.messages)
        })
        .catch(() => {})
      getGroups()
        .then(({ data }) => {
          const group = (data.groups || []).find((g) => g.id === groupJid)
          if (group && isMonitoredGroup(group)) {
            refreshGroupInList(groupJid, {
              lastMessage: group.lastMessage,
              lastMessageAt: group.lastMessageAt,
              name: group.name,
              image: group.image,
              memberCount: group.memberCount,
            })
          }
        })
        .catch(() => {})
    }
    const intervalId = setInterval(poll, 10000)
    return () => clearInterval(intervalId)
  }, [activeId, fetchGroupMessagesPage, refreshGroupInList])

  const loadOlder = useCallback(async () => {
    if (!activeId || activeIsGroup || !messages.length || loadingOlder) return
    loadingOlderRef.current = true
    scrollToEndRef.current = false
    setLoadingOlder(true)
    try {
      const before = messages[0]?.timestamp
      const result = await fetchMessagesPage(activeId, { limit: 50, before })
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id))
        const unique = result.messages.filter((m) => !ids.has(m.id))
        const next = [...unique, ...prev]
        setCachedConversationMessages(activeId, { messages: next, hasMore: result.hasMore })
        return next
      })
      setHasMore(result.hasMore)
    } catch {
      toastRef.current.error('Falha ao carregar histórico.')
    } finally {
      loadingOlderRef.current = false
      setLoadingOlder(false)
    }
  }, [activeId, activeIsGroup, messages, loadingOlder, fetchMessagesPage])

  // ------------------------------------------------ tempo real

  useEffect(() => {
    const offMessage = onSocketEvent('crm:message', ({ conversationId, message, conversation }) => {
      if (conversation && !isConversationInScope(conversation, scopeRef.current)) return
      if (conversation) {
        setConversations((prev) => {
          const rest = prev.filter((c) => c.id !== conversation.id)
          return [conversation, ...rest]
        })
      }
      if (conversationId === activeIdRef.current && message) {
        // Sem conversation no payload: só aplica se o chat ativo já está na lista do usuário.
        if (!conversation) {
          const activeKnown = conversationsRef.current.some((c) => c.id === conversationId)
          if (!activeKnown) return
        }
        scrollToEndRef.current = true
        setMessages((prev) => {
          if (prev.some((m) => m.id === message.id)) return prev
          appendCachedMessage(conversationId, message)
          return [...prev, message]
        })
        markReadDebounced(conversationId)
      }
    })
    const offConvo = onSocketEvent('crm:conversation', ({ conversation }) => {
      if (!conversation || !isConversationInScope(conversation, scopeRef.current)) return
      setConversations((prev) => {
        const exists = prev.some((c) => c.id === conversation.id)
        if (!exists) return [conversation, ...prev]
        return prev.map((c) => (c.id === conversation.id ? conversation : c))
      })
    })
    const offSync = onSocketEvent('crm:sync', ({ job }) => {
      setSyncJob(job)
      if (job?.status === 'done') {
        toastRef.current.success('Sincronização concluída.')
        loadConversationsRef.current()
        runBackgroundAvatarSweep(conversationsRef.current)
      }
    })
    const offHandoff = onSocketEvent('crm:handoff', () => {
      toastRef.current.info('Uma conversa foi transferida da IA para atendimento humano.', 'Transferência')
      loadConversationsRef.current()
    })
    return () => {
      offMessage()
      offConvo()
      offSync()
      offHandoff()
    }
  }, [markReadDebounced])

  useEffect(() => {
    scrollToEndRef.current = true
    requestAnimationFrame(() => {
      listEndRef.current?.scrollIntoView({ behavior: 'auto' })
    })
  }, [activeId])

  useEffect(() => {
    if (!messages.length || loadingOlderRef.current || !scrollToEndRef.current) return
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  useEffect(() => {
    setNotesDraft(active?.contact?.notes || '')
    setNameDraft(active?.contact?.savedName || '')
  }, [activeId, active?.contact?.notes, active?.contact?.savedName])

  // ------------------------------------------------ ações

  const handleSend = useCallback(async () => {
    const body = draft.trim()
    if ((!body && !attachment) || !activeId || sending) return

    if (isGroupChatId(activeId)) {
      const groupJid = parseGroupChatId(activeId)
      if (attachment && !['image', 'video'].includes(attachment.type)) {
        toastRef.current.error('Em grupos envie texto, imagem ou vídeo MP4.')
        return
      }

      const tempId = `temp-${Date.now()}`
      const optimistic = {
        id: tempId,
        fromMe: true,
        type: attachment?.type || 'text',
        body: body || attachment?.name || '',
        timestamp: new Date().toISOString(),
        source: 'group',
      }

      scrollToEndRef.current = true
      setMessages((prev) => [...prev, optimistic])

      const savedDraft = draft
      const savedAttachment = attachment
      setDraft('')
      if (attachment) revokeAudioPreview(attachment)
      setAttachment(null)
      setSending(true)

      try {
        await sendMessage({
          groupIds: [groupJid],
          body,
          mediaType: attachment?.type || 'none',
          mediaBase64: savedAttachment?.base64,
          mediaMime: savedAttachment?.mime,
          mediaName: savedAttachment?.name,
        })
        toastRef.current.success('Mensagem enviada ao grupo.')
        refreshGroupInList(groupJid, {
          lastMessage: body || savedAttachment?.name || 'Mídia',
          lastMessageAt: new Date().toISOString(),
        })
        window.setTimeout(async () => {
          try {
            const fresh = await fetchGroupMessagesPage(groupJid)
            if (activeIdRef.current !== groupChatId(groupJid)) return
            setMessages(fresh.messages)
          } catch {
            setMessages((prev) => prev.filter((m) => m.id !== tempId))
          }
        }, 2500)
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId))
        setDraft(savedDraft)
        if (savedAttachment) setAttachment(savedAttachment)
        toastRef.current.error(err?.response?.data?.message || 'Falha ao enviar mensagem ao grupo.')
      } finally {
        setSending(false)
        inputRef.current?.focus()
      }
      return
    }

    const tempId = `temp-${Date.now()}`
    const optimistic = {
      id: tempId,
      conversationId: activeId,
      fromMe: true,
      type: attachment?.type || 'text',
      mediaKind: attachment?.type || null,
      body: body || attachment?.name || '',
      mediaMime: attachment?.mime || null,
      status: 'pending',
      timestamp: new Date().toISOString(),
    }

    scrollToEndRef.current = true
    setMessages((prev) => [...prev, optimistic])
    appendCachedMessage(activeId, optimistic)

    const savedDraft = draft
    const savedAttachment = attachment
    setDraft('')
    if (attachment) revokeAudioPreview(attachment)
    setAttachment(null)
    setSending(true)

    try {
      const payload = { body }
      if (savedAttachment) {
        payload.mediaType = savedAttachment.type
        payload.mediaBase64 = savedAttachment.base64
        payload.mediaMime = savedAttachment.mime
        payload.mediaName = savedAttachment.name
      }
      const { data } = await sendCrmMessage(activeId, payload)
      if (data.message) {
        if (savedAttachment?.base64) {
          primeCrmMessageMediaCache(data.message.id, savedAttachment.mime, savedAttachment.base64)
        }
        setMessages((prev) => {
          const withoutTemp = prev.filter((m) => m.id !== tempId)
          if (withoutTemp.some((m) => m.id === data.message.id)) return withoutTemp
          replaceCachedMessage(activeId, tempId, data.message)
          return [...withoutTemp, data.message]
        })
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== tempId))
        removeCachedMessage(activeId, tempId)
      }
      if (data.conversation) {
        setConversations((prev) => {
          const rest = prev.filter((c) => c.id !== data.conversation.id)
          return [data.conversation, ...rest]
        })
      }
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      removeCachedMessage(activeId, tempId)
      setDraft(savedDraft)
      if (savedAttachment) setAttachment(savedAttachment)
      toastRef.current.error(err?.response?.data?.message || 'Falha ao enviar mensagem.')
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }, [draft, attachment, activeId, sending, fetchGroupMessagesPage, refreshGroupInList])

  const handleFile = useCallback(
    (file) => {
      if (!file) return
      const type = mediaTypeFromMime(file.type, file.name)
      if (type === 'none') {
        toastRef.current.error('Envie imagem, vídeo MP4, áudio ou PDF.')
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = String(reader.result || '').replace(/^data:[^;]+;base64,/, '')
        setAttachment({ base64, mime: file.type, name: file.name, type })
      }
      reader.readAsDataURL(file)
    },
    [],
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
        toastRef.current.error(err?.response?.data?.message || 'Falha ao atualizar conversa.')
      }
    },
    [activeId],
  )

  const saveNotes = useCallback(async () => {
    if (!active?.contact?.id) return
    try {
      const { data } = await patchCrmContact(active.contact.id, { notes: notesDraft })
      if (data.contact) {
        setConversations((prev) =>
          prev.map((c) => (c.id === activeId ? { ...c, contact: { ...c.contact, ...data.contact } } : c)),
        )
        toastRef.current.success('Notas salvas.')
      }
    } catch {
      toastRef.current.error('Falha ao salvar notas.')
    }
  }, [active, notesDraft, activeId])

  const saveContactName = useCallback(async () => {
    const name = nameDraft.trim()
    if (!active?.contact?.id || !name) return
    setSavingContact(true)
    try {
      const { data } = await saveCrmContact(active.contact.id, { name })
      if (data.contact) {
        setConversations((prev) =>
          prev.map((c) => (c.id === activeId ? { ...c, contact: { ...c.contact, ...data.contact } } : c)),
        )
        setNameDraft(data.contact.savedName || name)
      }
      if (data.whatsappSaved) toastRef.current.success(data.message || 'Contato salvo.')
      else toastRef.current.success(data.message || 'Nome salvo.')
    } catch (err) {
      toastRef.current.error(err?.response?.data?.message || 'Falha ao salvar contato.')
    } finally {
      setSavingContact(false)
    }
  }, [active, nameDraft, activeId])

  const applyTagToConversations = useCallback((updater) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (!c.contact?.tags?.length) return c
        const nextTags = updater(c.contact.tags)
        if (nextTags === c.contact.tags) return c
        return { ...c, contact: { ...c.contact, tags: nextTags } }
      }),
    )
  }, [])

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
        if (!has && data.metaTracking) {
          toastMetaTracking(toastRef.current, data.metaTracking)
        }
      } catch {
        toastRef.current.error('Falha ao atualizar tags.')
      }
    },
    [active, activeId],
  )

  const handleCreateTag = useCallback(async () => {
    const name = newTagName.trim()
    if (!name) return
    try {
      const { data } = await createCrmTag({ name, color: newTagColor })
      setTags((prev) => [...prev, data.tag].sort((a, b) => a.name.localeCompare(b.name)))
      setNewTagModal(false)
      setNewTagName('')
      setNewTagColor('#22c55e')
      toastRef.current.success('Tag criada.')
    } catch (err) {
      toastRef.current.error(err?.response?.data?.message || 'Falha ao criar tag.')
    }
  }, [newTagName, newTagColor])

  const openEditTag = useCallback((tag) => {
    setTagEditing(tag)
    setTagForm({ name: tag.name, color: tag.color || '#22c55e' })
    setTagEditModal(true)
  }, [])

  const handleSaveTagEdit = useCallback(async () => {
    if (!tagEditing || !tagForm.name.trim()) return
    setTagSaving(true)
    try {
      const { data } = await updateCrmTag(tagEditing.id, {
        name: tagForm.name.trim(),
        color: tagForm.color,
      })
      const updated = data.tag
      setTags((prev) => prev.map((t) => (t.id === updated.id ? updated : t)).sort((a, b) => a.name.localeCompare(b.name)))
      applyTagToConversations((contactTags) =>
        contactTags.some((t) => t.id === updated.id)
          ? contactTags.map((t) => (t.id === updated.id ? updated : t))
          : contactTags,
      )
      setTagEditModal(false)
      setTagEditing(null)
      toastRef.current.success('Tag atualizada.')
    } catch (err) {
      toastRef.current.error(err?.response?.data?.message || 'Falha ao atualizar tag.')
    } finally {
      setTagSaving(false)
    }
  }, [tagEditing, tagForm, applyTagToConversations])

  const handleDeleteTag = useCallback(async () => {
    if (!tagToDelete) return
    try {
      await deleteCrmTag(tagToDelete.id)
      setTags((prev) => prev.filter((t) => t.id !== tagToDelete.id))
      applyTagToConversations((contactTags) => contactTags.filter((t) => t.id !== tagToDelete.id))
      toastRef.current.success('Tag excluída.')
    } catch (err) {
      toastRef.current.error(err?.response?.data?.message || 'Falha ao excluir tag.')
    } finally {
      setTagToDelete(null)
    }
  }, [tagToDelete, applyTagToConversations])

  const refreshAvatar = useCallback(
    async (contactId) => {
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
    },
    [],
  )

  const handleStartSync = useCallback(async (days) => {
    setSyncStarting(true)
    try {
      const { data } = await startCrmSync({ days })
      if (data.job) setSyncJob(data.job)
      if (data.rateLimited) {
        toastRef.current.info('WhatsApp limitou consultas. Aguarde antes de sincronizar de novo.')
        return true
      }
      if (data.alreadyRunning) {
        toastRef.current.info('Sincronização já está em andamento.')
        return true
      }
      toastRef.current.success('Sincronização iniciada.')
      return true
    } catch (err) {
      const status = err?.response?.status
      const body = err?.response?.data
      if (body?.job) setSyncJob(body.job)
      if (status === 429) {
        toastRef.current.info(body?.message || 'WhatsApp limitou consultas. Aguarde antes de sincronizar de novo.')
        return true
      }
      toastRef.current.error(body?.message || 'Falha ao iniciar sincronização.')
      return false
    } finally {
      setSyncStarting(false)
    }
  }, [])

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
          toastRef.current.error('Falha ao carregar a mídia do atalho.')
        }
      }
      setDraft((prev) => (qr.body ? (prev ? `${prev} ${qr.body}` : qr.body) : prev))
      inputRef.current?.focus()
    },
    [],
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
      <div
        className={`-mx-4 -mb-4 flex overflow-hidden border-y border-brand-800/80 bg-brand-900/35 lg:mx-0 lg:mb-0 lg:rounded-2xl lg:border ${
          isImpersonating
            ? 'h-[calc(100dvh-9.25rem)] min-h-[420px] lg:h-[calc(100vh-9.75rem)]'
            : 'h-[calc(100dvh-7.25rem)] min-h-[420px] lg:h-[calc(100vh-7.5rem)]'
        }`}
      >
      {/* Lista de conversas */}
      <div
        className={`flex w-full flex-col border-r border-brand-800/80 lg:max-w-[min(100%,360px)] lg:shrink-0 ${
          activeId ? 'hidden lg:flex' : 'flex'
        }`}
      >
        <ChatSyncBar job={syncJob} onStartSync={handleStartSync} syncStarting={syncStarting} />
        {!waConnected && (
          <div className="flex items-center gap-2 border-b border-amber-500/25 bg-amber-500/8 px-3 py-2 text-xs text-amber-100">
            <Unplug className="h-4 w-4 shrink-0 text-amber-400" />
            <span className="min-w-0 flex-1">WhatsApp desconectado — reconecte para fotos e mídia.</span>
            <Link to="/dashboard/connect" className="shrink-0 font-medium text-accent-300 underline hover:text-accent-200">
              Conectar
            </Link>
          </div>
        )}
        <ChatConversationFilters
          query={query}
          onQueryChange={setQuery}
          tagFilter={tagFilter}
          onTagFilterChange={setTagFilter}
          stageFilter={stageFilter}
          onStageFilterChange={setStageFilter}
          sellerFilter={sellerFilter}
          onSellerFilterChange={setSellerFilter}
          members={orgMembers}
          showSellerFilter={isOrgOwner && orgMembers.length > 0}
          tags={tags}
          stages={stages}
          groupsOnly={groupsOnly}
          onToggleGroupsOnly={() => {
            setGroupsOnly((v) => {
              const next = !v
              if (next) setUnidentifiedOnly(false)
              return next
            })
          }}
          unidentifiedOnly={unidentifiedOnly}
          onToggleUnidentifiedOnly={() => {
            setUnidentifiedOnly((v) => {
              const next = !v
              if (next) setGroupsOnly(false)
              return next
            })
          }}
          unidentifiedCount={unidentifiedCount}
          monitoredGroupCount={monitoredGroupCount}
        />
        {displayedConversations.length > 0 && (
          <p className="shrink-0 px-3 pt-2 text-[10px] font-semibold uppercase tracking-widest text-stone-600">
            {displayedConversations.length} conversa{displayedConversations.length !== 1 ? 's' : ''}
          </p>
        )}
        <div className="flex-1 overflow-y-auto vg-scrollbar px-1.5 py-1">
          {refreshingList && !loadingList && (
            <div className="flex justify-center py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-stone-500" />
            </div>
          )}
          {loadingList && chatList.length === 0 ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : displayedConversations.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <div className="mb-4 rounded-2xl border border-brand-800/60 bg-brand-950/50 p-4">
                <MessageSquare className="h-8 w-8 text-stone-500" />
              </div>
              <p className="text-sm font-medium text-stone-300">
                {groupsOnly
                  ? 'Nenhum grupo ativo'
                  : unidentifiedOnly
                    ? 'Nenhuma conversa sem identificação'
                    : 'Nenhuma conversa ainda'}
              </p>
              <p className="mt-1.5 max-w-[220px] text-xs text-stone-500">
                {groupsOnly
                  ? 'Ative grupos na aba Grupos para vê-los aqui.'
                  : 'Sincronize o histórico ou aguarde novas mensagens.'}
              </p>
            </div>
          ) : (
            displayedConversations.map((c) => (
              <ConversationListItem
                key={c.id}
                conversation={c}
                active={activeId}
                onOpen={openConversation}
                onPrefetch={prefetchConversation}
                onRefreshAvatar={refreshAvatar}
              />
            ))
          )}
        </div>
      </div>

      {/* Thread */}
      <div className={`min-w-0 flex-1 flex-col ${activeId ? 'flex' : 'hidden lg:flex'}`}>
        {!active ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-stone-500">
            <div className="rounded-2xl border border-brand-800/50 bg-brand-950/40 p-5">
              <MessageSquare className="h-10 w-10 text-stone-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-stone-400">Selecione uma conversa</p>
              <p className="mt-1 text-xs text-stone-600">Escolha um contato na lista para ver mensagens e responder.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-brand-800/80 bg-brand-950/30 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
              <button
                type="button"
                onClick={closeMobileThread}
                className="lg:hidden shrink-0 rounded-xl p-2 text-stone-400 transition hover:bg-white/5 hover:text-stone-100"
                aria-label="Voltar para conversas"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <UserAvatar
                name={contactTitle(active.contact)}
                src={active.contact?.avatarUrl}
                size="sm"
                contactId={activeIsGroup ? undefined : active.contact?.id}
                onRefreshAvatar={activeIsGroup ? undefined : refreshAvatar}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-stone-100">{contactTitle(active.contact)}</p>
                {activeIsGroup ? (
                  <p className="flex items-center gap-1 text-xs text-stone-500">
                    <Users className="h-3 w-3 shrink-0" />
                    {active.contact?.memberCount || 0} membros
                  </p>
                ) : (
                  <p className="text-xs text-stone-500">
                    {(() => {
                      const phone = resolveContactPhone(active.contact)
                      if (phone) return formatPhoneBr(phone)
                      if (active.contact?.isLid) return `ID ${active.remoteJid.split('@')[0]}`
                      return active.remoteJid.split('@')[0]
                    })()}
                  </p>
                )}
              </div>
              {activeIsGroup && (
                <Link
                  to={`/dashboard/groups/${encodeURIComponent(active.groupJid)}`}
                  className="shrink-0 rounded-lg border border-brand-700 px-2.5 py-1 text-xs text-stone-300 transition hover:bg-white/5"
                >
                  Detalhes
                </Link>
              )}
              {!activeIsGroup && active.aiEnabled && (
                <Badge variant="default" className="border-sky-500/30 bg-sky-500/10 text-sky-300">
                  <Bot className="mr-1 h-3 w-3" /> IA ativa
                </Badge>
              )}
              <button
                type="button"
                onClick={() => setShowPanel((v) => !v)}
                className={`rounded-lg p-2 transition hover:bg-white/5 ${
                  showPanel ? 'text-accent-300' : 'text-stone-400 hover:text-stone-100'
                }`}
                title={showPanel ? 'Ocultar painel (histórico, orçamento, compra)' : 'Abrir painel do contato'}
                aria-pressed={showPanel}
              >
                <ChevronDown className={`h-4 w-4 transition ${showPanel ? 'rotate-90' : '-rotate-90'}`} />
              </button>
            </div>

            <div ref={threadRef} className="flex-1 space-y-1 overflow-y-auto vg-scrollbar px-3 py-3 sm:px-4">
              {refreshingMessages && !loadingMessages && (
                <div className="flex justify-center pb-1">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-800/80 px-2.5 py-0.5 text-[10px] text-stone-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Atualizando…
                  </span>
                </div>
              )}
              {hasMore && !loadingMessages && (
                <div className="flex justify-center pb-2">
                  <Button size="sm" variant="ghost" onClick={loadOlder} disabled={loadingOlder}>
                    {loadingOlder ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Carregar mensagens antigas'}
                  </Button>
                </div>
              )}
              {loadingMessages && messages.length === 0 ? (
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
                        {!item.msg.fromMe && activeIsGroup && item.msg.senderName && (
                          <p className="mb-0.5 text-[10px] font-semibold text-accent-400/90">{item.msg.senderName}</p>
                        )}
                        <ChatMessageContent message={item.msg} />
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
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-brand-700 bg-brand-800/60 px-3 py-2 text-xs text-stone-300">
                  {attachment.type === 'audio' ? (
                    <Mic className="h-3.5 w-3.5 shrink-0" />
                  ) : attachment.type === 'video' ? (
                    <Film className="h-3.5 w-3.5 shrink-0" />
                  ) : attachment.type === 'document' ? (
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <Paperclip className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <span className="block truncate">{attachment.name}</span>
                    {attachment.type === 'audio' && (
                      <audio
                        src={attachment.previewUrl || `data:${attachment.mime};base64,${attachment.base64}`}
                        controls
                        className="mt-1 h-8 w-full max-w-xs"
                        preload="auto"
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      revokeAudioPreview(attachment)
                      setAttachment(null)
                    }}
                    className="shrink-0 text-stone-500 hover:text-stone-200"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <div className="flex min-h-[42px] items-end gap-2">
                {!isRecording && (
                  <ChatQuickRepliesMenu
                    quickReplies={quickReplies}
                    onQuickRepliesChange={setQuickReplies}
                    onApply={applyQuickReply}
                    draft={draft}
                  />
                )}
                {!isRecording && (
                  <>
                    <input
                      ref={fileRef}
                      type="file"
                      accept={activeIsGroup ? 'image/*,video/mp4,.mp4' : 'image/*,video/mp4,.mp4,audio/*,.mp3,.ogg,.m4a,.pdf,application/pdf'}
                      className="hidden"
                      onChange={(e) => {
                        handleFile(e.target.files?.[0])
                        e.target.value = ''
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={Boolean(attachment)}
                      className="rounded-xl p-2.5 text-stone-400 transition hover:bg-white/5 hover:text-stone-100 disabled:opacity-40"
                      title={activeIsGroup ? 'Anexar imagem ou vídeo MP4' : 'Anexar imagem, vídeo, áudio ou PDF'}
                    >
                      <Paperclip className="h-5 w-5" />
                    </button>
                  </>
                )}
                {!activeIsGroup && (
                  <AudioRecorderButton
                    disabled={sending || (!isRecording && Boolean(attachment))}
                    onRecorded={setAttachment}
                    onError={(msg) => toastRef.current.error(msg)}
                    onRecordingChange={setIsRecording}
                  />
                )}
                {!isRecording && (
                  <>
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
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Painel do contato — lg+ coluna fixa; abaixo disso drawer sobre o chat */}
      {active && showPanel && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-30 bg-black/45 lg:hidden"
            onClick={() => setShowPanel(false)}
            aria-label="Fechar painel do contato"
          />
          <div className="fixed inset-y-0 right-0 z-40 flex w-[min(100vw,20rem)] flex-col overflow-y-auto vg-scrollbar border-l border-brand-800/80 bg-brand-950 shadow-2xl lg:static lg:z-auto lg:w-72 lg:shrink-0 lg:shadow-none lg:bg-brand-950/20">
          <div className="flex flex-col items-center gap-2 border-b border-brand-800 px-4 py-5">
            <UserAvatar
              name={contactTitle(active.contact)}
              src={active.contact?.avatarUrl}
              size="md"
              contactId={activeIsGroup ? undefined : active.contact?.id}
              onRefreshAvatar={activeIsGroup ? undefined : refreshAvatar}
            />
            <p className="text-center text-sm font-semibold text-stone-100">{contactTitle(active.contact)}</p>
            {activeIsGroup ? (
              <p className="flex items-center gap-1 text-xs text-stone-500">
                <Users className="h-3 w-3" />
                {active.contact?.memberCount || 0} membros · Grupo ativo
              </p>
            ) : (
              <>
                {active.contact?.pushName && !isSelfOrGenericPushName(active.contact.pushName) && active.contact.pushName !== active.contact?.savedName && (
                  <p className="text-center text-xs text-stone-500">WhatsApp: {active.contact.pushName}</p>
                )}
                <p className="text-xs text-stone-500">
                  {(() => {
                    const phone = resolveContactPhone(active.contact)
                    if (phone) return formatPhoneBr(phone)
                    if (active.contact?.isLid) return `ID ${active.remoteJid.split('@')[0]}`
                    return active.remoteJid.split('@')[0]
                  })()}
                </p>
              </>
            )}
          </div>

          {activeIsGroup ? (
            <div className="space-y-4 p-4">
              <p className="text-xs leading-relaxed text-stone-400">
                Este é um grupo monitorado. Mensagens aparecem aqui em tempo quase real; use a aba Grupos para
                automações e configurações.
              </p>
              <Link to={`/dashboard/groups/${encodeURIComponent(active.groupJid)}`}>
                <Button variant="secondary" className="w-full">
                  <Users className="h-4 w-4" />
                  Abrir detalhes do grupo
                </Button>
              </Link>
            </div>
          ) : (
            <>
          {contactNeedsIdentification(active.contact) && (
            <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
              <p className="font-medium">Contato não identificado</p>
              <p className="mt-1 text-amber-200/80">
                Salve um nome abaixo para não perder este contato no CRM. O WhatsApp não expôs telefone ou nome de perfil.
              </p>
            </div>
          )}

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

            <ContactLeadActions
              contact={active.contact}
              conversationId={active.id}
              onContactUpdate={(contact) => {
                setConversations((prev) =>
                  prev.map((c) => (c.id === activeId ? { ...c, contact: { ...c.contact, ...contact } } : c)),
                )
                setTags((prev) => {
                  const ids = new Set(prev.map((t) => t.id))
                  const merged = [...prev]
                  for (const t of contact.tags || []) {
                    if (!ids.has(t.id)) merged.push(t)
                  }
                  return merged.sort((a, b) => a.name.localeCompare(b.name))
                })
              }}
              onConversationUpdate={(conversation) => {
                setConversations((prev) => prev.map((c) => (c.id === conversation.id ? conversation : c)))
              }}
            />

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
                    <span
                      key={t.id}
                      className={`group inline-flex max-w-full items-center gap-0.5 rounded-full border text-[11px] font-medium transition ${
                        selected ? '' : 'opacity-45'
                      }`}
                      style={{
                        borderColor: `${t.color}66`,
                        backgroundColor: selected ? `${t.color}26` : 'transparent',
                        color: t.color,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleContactTag(t)}
                        className="truncate px-2 py-1 pl-2.5 hover:opacity-90"
                        title={selected ? 'Remover do lead' : 'Aplicar ao lead'}
                      >
                        {t.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditTag(t)}
                        className="rounded-full p-1 opacity-50 transition hover:bg-white/10 hover:opacity-100"
                        title="Editar tag"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setTagToDelete(t)}
                        className="rounded-full p-1 pr-1.5 opacity-50 transition hover:bg-white/10 hover:text-red-300 hover:opacity-100"
                        title="Excluir tag"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  )
                })}
              </div>
              <p className="mt-1.5 text-[10px] text-stone-600">
                Clique no nome para aplicar ou remover do lead. Editar ou excluir altera a tag em todo o CRM.
              </p>
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
            </>
          )}
          </div>
        </>
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
        <div className="space-y-3">
          <input
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateTag()}
            placeholder="Nome da tag (ex.: Lead quente)"
            className="w-full rounded-xl border border-brand-700 bg-brand-900/60 px-4 py-2.5 text-sm text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/60"
          />
          <div>
            <p className="mb-1.5 text-xs font-medium text-stone-500">Cor</p>
            <input
              type="color"
              value={newTagColor}
              onChange={(e) => setNewTagColor(e.target.value)}
              className="h-10 w-full cursor-pointer rounded-lg border border-brand-700 bg-brand-900"
            />
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={tagEditModal}
        onClose={() => setTagEditModal(false)}
        title="Editar tag"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTagEditModal(false)} disabled={tagSaving}>
              Cancelar
            </Button>
            <Button onClick={handleSaveTagEdit} disabled={!tagForm.name.trim() || tagSaving}>
              {tagSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <input
            value={tagForm.name}
            onChange={(e) => setTagForm((f) => ({ ...f, name: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveTagEdit()}
            placeholder="Nome da tag"
            className="w-full rounded-xl border border-brand-700 bg-brand-900/60 px-4 py-2.5 text-sm text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/60"
          />
          <div>
            <p className="mb-1.5 text-xs font-medium text-stone-500">Cor</p>
            <input
              type="color"
              value={tagForm.color}
              onChange={(e) => setTagForm((f) => ({ ...f, color: e.target.value }))}
              className="h-10 w-full cursor-pointer rounded-lg border border-brand-700 bg-brand-900"
            />
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={Boolean(tagToDelete)}
        onClose={() => setTagToDelete(null)}
        onConfirm={handleDeleteTag}
        title="Excluir tag"
        message={`Excluir a tag "${tagToDelete?.name || ''}"? Ela será removida de todos os leads.`}
      />
    </div>
    </>
  )
}
