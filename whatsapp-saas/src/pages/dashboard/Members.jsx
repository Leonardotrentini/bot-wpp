import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Tag, Download, RefreshCw, Plus, X, CheckSquare, Eraser, Pencil, Trash2, Check, MessageCircle, Users, Calendar, Loader2 } from 'lucide-react'
import { Card } from '../../components/common/Card.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Select } from '../../components/common/Select.jsx'
import { DarkDropdown } from '../../components/common/DarkDropdown.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { Modal } from '../../components/common/Modal.jsx'
import { DateRangeCalendar } from '../../components/common/DateRangeCalendar.jsx'
import { getMembers, syncMembersParticipants } from '../../services/api.js'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import {
  normalizeTag,
  displayTag,
  loadMemberTagsStore,
  saveMemberTagsStore,
  mergeMemberTags,
  setMemberCustomTags,
  removeTagGlobally,
  renameTagGlobally,
} from '../../utils/memberTagsStorage.js'

function fmtActivity(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return String(iso).replace('T', ' ')
  }
}

function todayYmd() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

function formatYmdShort(ymd) {
  if (!ymd) return ''
  const d = new Date(`${ymd}T12:00:00`)
  if (Number.isNaN(d.getTime())) return ymd
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function ymdDaysAgo(days) {
  if (!days) return todayYmd()
  // Ancora no calendário de São Paulo (evita drift de fuso com setDate local).
  const [y, m, d] = todayYmd().split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - days)
  return dt.toISOString().slice(0, 10)
}

const PERIOD_PRESETS = [
  { id: '1d', label: 'Hoje', days: 1 },
  { id: '7d', label: '7 dias', days: 7 },
  { id: '14d', label: '14 dias', days: 14 },
  { id: '30d', label: '30 dias', days: 30 },
  { id: 'custom', label: 'Personalizado', days: null },
]

function OriginBadge({ origin }) {
  if (origin === 'both') {
    return (
      <span
        className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-300"
        title="Tem conversa 1:1 no CRM e também está em pelo menos um grupo"
      >
        <MessageCircle className="h-3 w-3" />
        <Users className="h-3 w-3" />
        Nos dois
      </span>
    )
  }
  if (origin === 'x1') {
    return (
      <span
        className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-accent-500/40 bg-accent-500/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-300"
        title="Lead do chat 1:1 (WhatsApp direto) — ainda não aparece nos grupos listados"
      >
        <MessageCircle className="h-3 w-3" />
        Lead 1:1
      </span>
    )
  }
  return (
    <span
      className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-300"
      title="Participante de grupo — sem conversa 1:1 no CRM"
    >
      <Users className="h-3 w-3" />
      Só grupo
    </span>
  )
}


function applyStoreToMembers(apiMembers, store) {
  return apiMembers.map((m) => ({
    ...m,
    tags: mergeMemberTags(m, store.overrides),
  }))
}

export function Members() {
  const toast = useToast()
  const { user } = useAuth()
  const userId = user?.id || user?.email || 'default'

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadProgress, setLoadProgress] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [apiMembers, setApiMembers] = useState([])
  const [members, setMembers] = useState([])
  const [catalogExtras, setCatalogExtras] = useState([])
  const [tagOverrides, setTagOverrides] = useState({})
  const [groups, setGroups] = useState([])
  const [meta, setMeta] = useState(null)
  const [groupId, setGroupId] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [originFilter, setOriginFilter] = useState('') // '' | x1 | group | both
  const [activeGroupsOnly, setActiveGroupsOnly] = useState(true)
  const [period, setPeriod] = useState('') // '' = todo período | 1d | 7d | 14d | 30d | custom
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [calendarOpen, setCalendarOpen] = useState(false)
  const calendarRef = useRef(null)
  const membersAbortRef = useRef(null)
  const hasLoadedOnceRef = useRef(false)
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')

  const maxDate = todayYmd()

  const [selected, setSelected] = useState(() => new Set())
  const [tagsModal, setTagsModal] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [applyTagValue, setApplyTagValue] = useState('')
  const [editingTag, setEditingTag] = useState('')
  const [editingTagName, setEditingTagName] = useState('')

  const overridesRef = useRef(tagOverrides)
  const catalogRef = useRef(catalogExtras)
  overridesRef.current = tagOverrides
  catalogRef.current = catalogExtras

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 400)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    if (!calendarOpen) return undefined
    const onDoc = (e) => {
      if (calendarRef.current && !calendarRef.current.contains(e.target)) {
        setCalendarOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [calendarOpen])

  function selectPeriod(id) {
    if (id !== 'custom' && id === period) return
    setPeriod(id)
    if (id === 'custom') {
      setCalendarOpen(true)
      return
    }
    setCalendarOpen(false)
    if (!id) {
      setDateFrom('')
      setDateTo('')
      return
    }
    const preset = PERIOD_PRESETS.find((p) => p.id === id)
    if (!preset?.days) return
    // Datas no mesmo tick → uma só requisição (evita corrida com filtro anterior).
    setDateFrom(ymdDaysAgo(preset.days - 1))
    setDateTo(todayYmd())
  }

  const persistStore = useCallback(
    (nextOverrides, nextCatalog) => {
      const overrides = nextOverrides !== undefined ? nextOverrides : overridesRef.current
      const catalog = nextCatalog !== undefined ? nextCatalog : catalogRef.current
      saveMemberTagsStore(userId, { catalogExtras: catalog, overrides })
    },
    [userId],
  )

  useEffect(() => {
    const store = loadMemberTagsStore(userId)
    setCatalogExtras(store.catalogExtras)
    setTagOverrides(store.overrides)
  }, [userId])

  const loadMembers = useCallback(async () => {
    membersAbortRef.current?.abort()
    const controller = new AbortController()
    membersAbortRef.current = controller
    const soft = hasLoadedOnceRef.current
    if (soft) {
      setRefreshing(true)
      setLoadProgress((p) => (p > 0 ? p : 8))
    } else {
      setLoading(true)
      setLoadProgress(6)
    }
    try {
      const params = { activeGroupsOnly: activeGroupsOnly ? '1' : '0' }
      if (groupId) params.groupId = groupId
      if (tagFilter) params.tag = tagFilter
      if (originFilter) params.origin = originFilter
      if (dateFrom) params.dateFrom = dateFrom
      if (dateTo) params.dateTo = dateTo
      if (debouncedQ.trim()) params.q = debouncedQ.trim()
      const { data } = await getMembers(params, { signal: controller.signal })
      if (controller.signal.aborted) return
      setLoadProgress(96)
      const list = data.members || []
      setApiMembers(list)
      setGroups(data.groups || [])
      setMeta(data.meta || null)
      const store = loadMemberTagsStore(userId)
      setCatalogExtras(store.catalogExtras)
      setTagOverrides(store.overrides)
      setMembers(applyStoreToMembers(list, store))
      hasLoadedOnceRef.current = true
      setLoadProgress(100)
    } catch (err) {
      if (controller.signal.aborted || err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return
      toast.error(err?.response?.data?.message || 'Falha ao carregar leads.')
      if (!hasLoadedOnceRef.current) {
        setApiMembers([])
        setMembers([])
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false)
        setRefreshing(false)
        window.setTimeout(() => setLoadProgress(0), 450)
      }
    }
  }, [activeGroupsOnly, groupId, tagFilter, originFilter, dateFrom, dateTo, debouncedQ, toast, userId])

  useEffect(() => {
    // Feedback imediato ao mudar filtro (antes do debounce da API).
    if (hasLoadedOnceRef.current) {
      setRefreshing(true)
      setLoadProgress((p) => (p > 0 ? p : 5))
    }
    const delay = hasLoadedOnceRef.current ? 120 : 0
    const t = setTimeout(() => {
      loadMembers()
    }, delay)
    return () => {
      clearTimeout(t)
      membersAbortRef.current?.abort()
    }
  }, [loadMembers])

  useEffect(() => {
    if (!loading && !refreshing) return undefined
    const id = window.setInterval(() => {
      setLoadProgress((p) => {
        if (p <= 0) return 8
        if (p >= 90) return p
        const step = p < 35 ? 6 : p < 65 ? 3.5 : 1.2
        return Math.min(90, p + step)
      })
    }, 220)
    return () => window.clearInterval(id)
  }, [loading, refreshing])

  useEffect(() => {
    setMembers(applyStoreToMembers(apiMembers, { overrides: tagOverrides, catalogExtras }))
  }, [apiMembers, tagOverrides])

  const tagCatalog = useMemo(() => {
    const s = new Set(catalogExtras.map(normalizeTag).filter(Boolean))
    members.forEach((m) => {
      ;(m.tags || []).forEach((t) => s.add(normalizeTag(t)))
      ;(m.crmTags || []).forEach((t) => s.add(normalizeTag(t)))
    })
    return [...s].sort()
  }, [members, catalogExtras])

  const allTags = tagCatalog

  const manageableTags = useMemo(() => tagCatalog.filter((t) => t !== 'admin'), [tagCatalog])

  const applyTagStoreUpdate = useCallback(
    (nextOverrides, nextCatalog) => {
      setTagOverrides(nextOverrides)
      setCatalogExtras(nextCatalog)
      persistStore(nextOverrides, nextCatalog)
      setMembers(applyStoreToMembers(apiMembers, { overrides: nextOverrides, catalogExtras: nextCatalog }))
    },
    [apiMembers, persistStore],
  )

  // Enquanto a API responde, pré-filtra a lista local (feedback imediato no "Hoje", etc.).
  const displayedMembers = useMemo(() => {
    if (!refreshing) return members
    let list = members
    if (dateFrom || dateTo) {
      const from = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null
      const to = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null
      list = list.filter((m) => {
        const last = new Date(m.lastActivity).getTime()
        if (Number.isNaN(last)) return false
        if (from != null && last < from) return false
        if (to != null && last > to) return false
        return true
      })
    }
    if (originFilter) list = list.filter((m) => (m.origin || (m.hasX1 ? 'x1' : 'group')) === originFilter)
    if (tagFilter) {
      const t = tagFilter.toLowerCase()
      list = list.filter(
        (m) =>
          (m.tags || []).some((x) => String(x).toLowerCase() === t) ||
          (m.crmTags || []).some((x) => String(x).toLowerCase() === t),
      )
    }
    if (debouncedQ.trim()) {
      const qn = debouncedQ.trim().toLowerCase()
      list = list.filter((m) => {
        const hay = [m.name, m.phone, ...(m.groupNames || m.groups || [])].join(' ').toLowerCase()
        return hay.includes(qn)
      })
    }
    return list
  }, [members, refreshing, dateFrom, dateTo, originFilter, tagFilter, debouncedQ])

  const allVisibleSelected =
    displayedMembers.length > 0 && displayedMembers.every((m) => selected.has(m.id))

  const selectAll = () => {
    setSelected(new Set(displayedMembers.map((m) => m.id)))
  }

  const clearAll = () => {
    setSelected(new Set())
  }

  const toggleRow = (memberId) => {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(memberId)) n.delete(memberId)
      else n.add(memberId)
      return n
    })
  }

  const toggleSelectAllHeader = () => {
    if (allVisibleSelected) clearAll()
    else selectAll()
  }

  const createTag = () => {
    const norm = normalizeTag(newTagName)
    if (!norm) {
      toast.error('Digite um nome para a tag.')
      return
    }
    if (tagCatalog.includes(norm)) {
      toast.info('Essa tag já existe.')
      setNewTagName('')
      return
    }
    const nextCatalog = [...catalogExtras, norm]
    setCatalogExtras(nextCatalog)
    persistStore(tagOverrides, nextCatalog)
    setNewTagName('')
    toast.success(`Tag "${displayTag(norm)}" criada.`)
  }

  const closeTagsModal = () => {
    setTagsModal(false)
    setEditingTag('')
    setEditingTagName('')
  }

  const deleteTag = (tag) => {
    const norm = normalizeTag(tag)
    if (norm === 'admin') {
      toast.info('A tag admin vem do WhatsApp e não pode ser excluída.')
      return
    }
    const { overrides: nextOverrides, catalogExtras: nextCatalog } = removeTagGlobally(
      tagOverrides,
      catalogExtras,
      norm,
    )
    applyTagStoreUpdate(nextOverrides, nextCatalog)
    if (normalizeTag(tagFilter) === norm) setTagFilter('')
    if (normalizeTag(applyTagValue) === norm) setApplyTagValue('')
    if (editingTag === norm) {
      setEditingTag('')
      setEditingTagName('')
    }
    toast.success(`Tag "${displayTag(norm)}" excluída.`)
  }

  const startEditTag = (tag) => {
    setEditingTag(tag)
    setEditingTagName(displayTag(tag))
  }

  const cancelEditTag = () => {
    setEditingTag('')
    setEditingTagName('')
  }

  const saveEditTag = () => {
    const newNorm = normalizeTag(editingTagName)
    if (!newNorm) {
      toast.error('Digite um nome para a tag.')
      return
    }
    if (newNorm === 'admin') {
      toast.error('O nome "admin" é reservado para admins do WhatsApp.')
      return
    }
    if (newNorm !== editingTag && tagCatalog.includes(newNorm)) {
      toast.error('Já existe uma tag com esse nome.')
      return
    }
    const result = renameTagGlobally(tagOverrides, catalogExtras, editingTag, newNorm)
    if (!result) {
      toast.error('Não foi possível renomear esta tag.')
      return
    }
    applyTagStoreUpdate(result.overrides, result.catalogExtras)
    if (normalizeTag(tagFilter) === editingTag) setTagFilter(newNorm)
    if (normalizeTag(applyTagValue) === editingTag) setApplyTagValue(newNorm)
    toast.success(`Tag renomeada para "${displayTag(newNorm)}".`)
    cancelEditTag()
  }

  const applyTagToSelected = (tagRaw) => {
    const norm = normalizeTag(tagRaw || applyTagValue)
    if (!norm) {
      toast.error('Selecione uma tag para aplicar.')
      return
    }
    if (selected.size === 0) {
      toast.error('Selecione ao menos um membro.')
      return
    }
    let nextCatalog = [...catalogExtras]
    if (!tagCatalog.includes(norm) && !nextCatalog.includes(norm)) {
      nextCatalog = [...nextCatalog, norm]
      setCatalogExtras(nextCatalog)
    }
    let nextOverrides = { ...tagOverrides }
    selected.forEach((memberId) => {
      const m = members.find((x) => x.id === memberId)
      const current = (m?.tags || []).filter((t) => normalizeTag(t) !== 'admin')
      const merged = [...new Set([...current.map(normalizeTag), norm])]
      nextOverrides = setMemberCustomTags(nextOverrides, memberId, merged)
    })
    setTagOverrides(nextOverrides)
    persistStore(nextOverrides, nextCatalog)
    setMembers(
      applyStoreToMembers(apiMembers, { overrides: nextOverrides, catalogExtras: nextCatalog }),
    )
    toast.success(`Tag "${displayTag(norm)}" aplicada a ${selected.size} membro(s).`)
    setApplyTagValue('')
  }

  const removeTagFromMember = (memberId, tag) => {
    const norm = normalizeTag(tag)
    if (norm === 'admin') {
      toast.info('A tag admin vem do WhatsApp e não pode ser removida aqui.')
      return
    }
    const m = members.find((x) => x.id === memberId)
    const custom = (m?.tags || []).map(normalizeTag).filter((t) => t !== 'admin' && t !== norm)
    const nextOverrides = setMemberCustomTags(tagOverrides, memberId, custom)
    setTagOverrides(nextOverrides)
    persistStore(nextOverrides)
    setMembers(applyStoreToMembers(apiMembers, { overrides: nextOverrides }))
    toast.success(`Tag "${displayTag(norm)}" removida.`)
  }

  async function onSyncParticipants() {
    setSyncing(true)
    try {
      const { data } = await syncMembersParticipants(12)
      toast.success(`Participantes atualizados em ${data.synced || 0} grupo(s).`)
      await loadMembers()
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao sincronizar participantes.')
    } finally {
      setSyncing(false)
    }
  }

  function exportCsv() {
    const toExport =
      selected.size > 0
        ? displayedMembers.filter((m) => selected.has(m.id))
        : displayedMembers
    if (!toExport.length) {
      return toast.info(
        selected.size > 0
          ? 'Nenhum dos selecionados está visível com os filtros atuais.'
          : 'Nenhum lead para exportar.',
      )
    }
    const header = ['nome', 'telefone', 'origem', 'grupos', 'tags', 'ultima_atividade']
    const rows = toExport.map((m) =>
      [
        m.name,
        m.phone,
        m.origin === 'both' ? 'nos_dois' : m.origin === 'x1' ? 'lead_1x1' : 'so_grupo',
        (m.groupNames || (m.groups || []).filter((g) => g !== 'WhatsApp direto')).join('; '),
        [...(m.crmTags || []), ...(m.tags || [])].join('; '),
        m.lastActivity || '',
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(','),
    )
    const blob = new Blob([`\uFEFF${header.join(',')}\n${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const suffix = selected.size > 0 ? `-${toExport.length}-selecionados` : ''
    a.download = `lista-leads${suffix}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(
      selected.size > 0
        ? `CSV exportado com ${toExport.length} lead(s) selecionado(s).`
        : `CSV exportado com ${toExport.length} lead(s).`,
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-brand-800/80 bg-brand-900/40 px-4 py-3 text-sm text-stone-400">
        <strong className="text-stone-200">Lista de Leads</strong> — todos os contatos do WhatsApp 1:1 e participantes
        dos grupos, mesclados por telefone.
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded-full border border-accent-500/40 bg-accent-500/10 px-2 py-0.5 text-accent-300">
            <MessageCircle className="h-3 w-3" /> Lead 1:1 — falou no chat direto
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-sky-300">
            <Users className="h-3 w-3" /> Só grupo — está no grupo, sem 1:1
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-violet-300">
            <MessageCircle className="h-3 w-3" />
            <Users className="h-3 w-3" /> Nos dois — 1:1 e grupo
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => setTagsModal(true)}>
          <Tag className="h-4 w-4" /> Gerenciar tags
        </Button>
        <Button
          size="sm"
          variant={selected.size > 0 ? 'primary' : 'outline'}
          className="gap-1.5"
          onClick={exportCsv}
          disabled={!displayedMembers.length}
          title={
            selected.size > 0
              ? `Exportar ${selected.size} lead(s) selecionado(s)`
              : 'Exportar todos os leads visíveis'
          }
        >
          <Download className="h-4 w-4" />
          {selected.size > 0 ? `Exportar ${selected.size}` : 'Exportar'}
        </Button>
        <span className="hidden h-6 w-px bg-brand-700 sm:inline" aria-hidden />
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onSyncParticipants} disabled={syncing}>
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Sincronizando…' : 'Sincronizar'}
        </Button>
      </div>

      <div className="rounded-2xl border border-brand-800/90 bg-brand-900/50 shadow-sm shadow-black/20">
        <div className="flex flex-col gap-3 p-3 sm:p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5 border-brand-700"
              onClick={selectAll}
              disabled={!displayedMembers.length}
            >
              <CheckSquare className="h-4 w-4 shrink-0" />
              Selecionar todos
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1.5 text-stone-400 hover:text-stone-100"
              onClick={clearAll}
              disabled={selected.size === 0}
            >
              <Eraser className="h-4 w-4 shrink-0" />
              Limpar
            </Button>
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                selected.size > 0
                  ? 'border-accent-500/35 bg-accent-500/10 text-accent-300'
                  : 'border-brand-700/80 bg-brand-950/40 text-stone-400'
              }`}
              aria-live="polite"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  selected.size > 0 ? 'bg-accent-400 shadow-[0_0_6px_rgba(212,175,55,0.6)]' : 'bg-stone-600'
                }`}
              />
              {selected.size === 0
                ? 'Nenhum membro selecionado'
                : `${selected.size} de ${displayedMembers.length} selecionado${selected.size === 1 ? '' : 's'}`}
            </span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:shrink-0">
            <p className="text-xs text-stone-500 sm:hidden">Aplicar tag aos selecionados</p>
            <div className="flex w-full items-stretch gap-2 sm:w-auto">
              <DarkDropdown
                className="min-w-0 flex-1 sm:min-w-[220px] sm:flex-initial"
                value={applyTagValue}
                onChange={(e) => setApplyTagValue(e.target.value)}
                disabled={!tagCatalog.length || selected.size === 0}
                ariaLabel="Tag para aplicar"
                leadingIcon={<Tag className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />}
                placeholder={tagCatalog.length ? 'Escolher tag…' : 'Crie uma tag primeiro'}
                options={[
                  { value: '', label: tagCatalog.length ? 'Escolher tag…' : 'Crie uma tag primeiro' },
                  ...tagCatalog.map((t) => ({ value: t, label: displayTag(t) })),
                ]}
              />
              <Button
                type="button"
                size="sm"
                variant="primary"
                className="shrink-0 px-4"
                disabled={!applyTagValue || selected.size === 0}
                onClick={() => applyTagToSelected(applyTagValue)}
              >
                Aplicar tag
              </Button>
            </div>
          </div>
        </div>
      </div>

      {(meta?.filteredTotal != null || meta?.crmLeadsTotal > 0) && (
        <div className="rounded-xl border border-accent-500/20 bg-accent-500/5 px-4 py-3 text-sm text-stone-300">
          <p>
            <strong className="text-accent-200">{meta.filteredTotal ?? displayedMembers.length}</strong> lead(s) com os
            filtros atuais
            {tagFilter ? (
              <>
                {' '}
                · tag <strong className="text-accent-200">{displayTag(tagFilter)}</strong>
              </>
            ) : null}
            {dateFrom || dateTo ? (
              <>
                {' '}
                · período{' '}
                <strong className="text-accent-200">
                  {dateFrom && dateTo && dateFrom === dateTo
                    ? formatYmdShort(dateFrom)
                    : `${dateFrom ? formatYmdShort(dateFrom) : '…'} → ${dateTo ? formatYmdShort(dateTo) : '…'}`}
                </strong>
              </>
            ) : null}
          </p>
          <p className="mt-1 text-xs text-stone-500">
            <span className="text-accent-300/90">{meta.filteredX1Only ?? 0} só 1:1</span>
            {' · '}
            <span className="text-sky-300/90">{meta.filteredGroupOnly ?? 0} só grupo</span>
            {' · '}
            <span className="text-violet-300/90">{meta.filteredBoth ?? 0} nos dois</span>
            {meta.crmLeadsTotal != null ? (
              <span className="text-stone-600"> · base CRM: {meta.crmLeadsTotal}</span>
            ) : null}
          </p>
        </div>
      )}

      {meta && meta.groupsTotal > 0 && meta.groupsWithParticipants === 0 && meta.crmLeadsTotal === 0 && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200/90">
          Ainda não há participantes importados. Clique em <strong>Sincronizar</strong> ou abra cada grupo em{' '}
          <strong>Grupos</strong> para carregar a lista do WhatsApp.
        </p>
      )}

      <Card className="overflow-visible">
        <div className="relative z-30 mb-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Período</span>
            <div className="inline-flex flex-wrap items-center gap-0.5 rounded-xl border border-brand-800 bg-brand-950/60 p-1">
              <button
                type="button"
                onClick={() => selectPeriod('')}
                className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150 active:scale-[0.97] ${
                  !period
                    ? 'bg-accent-500/20 text-accent-200 shadow-sm shadow-accent-500/10'
                    : 'text-stone-400 hover:bg-white/5 hover:text-stone-200'
                }`}
              >
                Tudo
              </button>
              {PERIOD_PRESETS.filter((p) => p.id !== 'custom').map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectPeriod(p.id)}
                  className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150 active:scale-[0.97] ${
                    period === p.id
                      ? 'bg-accent-500/20 text-accent-200 shadow-sm shadow-accent-500/10'
                      : 'text-stone-400 hover:bg-white/5 hover:text-stone-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <div className="relative" ref={calendarRef}>
                <button
                  type="button"
                  onClick={() => {
                    if (period === 'custom') {
                      setCalendarOpen((v) => !v)
                    } else {
                      selectPeriod('custom')
                    }
                  }}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150 active:scale-[0.97] ${
                    period === 'custom'
                      ? 'bg-accent-500/20 text-accent-200 shadow-sm shadow-accent-500/10'
                      : 'text-stone-400 hover:bg-white/5 hover:text-stone-200'
                  }`}
                  aria-expanded={calendarOpen}
                  aria-haspopup="dialog"
                >
                  <Calendar className="h-3 w-3 shrink-0" />
                  {period === 'custom' && dateFrom && dateTo
                    ? `${formatYmdShort(dateFrom)} – ${formatYmdShort(dateTo)}`
                    : 'Personalizado'}
                </button>
                {calendarOpen && period === 'custom' ? (
                  <div className="absolute left-0 top-[calc(100%+8px)] z-[60]">
                    <div
                      className="absolute -top-1.5 left-6 h-3 w-3 rotate-45 border-l border-t border-brand-600/80 bg-[#0b1511]"
                      aria-hidden
                    />
                    <DateRangeCalendar
                      start={dateFrom}
                      end={dateTo}
                      maxDate={maxDate}
                      onChange={({ start, end }) => {
                        setDateFrom(start || '')
                        setDateTo(end || '')
                        if (start && end) setCalendarOpen(false)
                      }}
                      onApply={
                        dateFrom
                          ? () => {
                              if (!dateTo) setDateTo(dateFrom)
                              setCalendarOpen(false)
                            }
                          : undefined
                      }
                    />
                  </div>
                ) : null}
              </div>
            </div>
            {refreshing || loadProgress > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] tabular-nums text-stone-400" aria-live="polite">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-400" />
                {Math.round(loadProgress)}%
              </span>
            ) : null}
          </div>

          {(loading || refreshing || loadProgress > 0) && (
            <div className="space-y-1.5" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(loadProgress)} aria-label="Progresso do carregamento">
              <div className="flex items-center justify-between gap-3 text-[11px] text-stone-400">
                <span>
                  {loading ? 'Carregando leads…' : refreshing ? 'Filtrando e sincronizando com o servidor…' : 'Concluído'}
                </span>
                <span className="tabular-nums text-accent-300/90">{Math.round(loadProgress)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-brand-800/90">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent-600 via-accent-400 to-accent-300 transition-[width] duration-200 ease-out"
                  style={{ width: `${Math.max(loadProgress, 4)}%` }}
                />
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <Select value={originFilter} onChange={(e) => setOriginFilter(e.target.value)} aria-label="Origem do lead">
              <option value="">Todas as origens</option>
              <option value="x1">Só Lead 1:1</option>
              <option value="group">Só grupo</option>
              <option value="both">Nos dois (1:1 + grupo)</option>
            </Select>
            <Select value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="Filtrar por grupo">
              <option value="">Todos os grupos</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} {g.status !== 'ativo' ? '(inativo)' : ''}
                </option>
              ))}
            </Select>
            <Select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} aria-label="Filtrar por tag">
              <option value="">Todas as tags</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  {displayTag(t)}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-2 rounded-xl border border-brand-800 px-3 py-2 text-xs text-stone-300">
              <input
                type="checkbox"
                checked={activeGroupsOnly}
                onChange={(e) => setActiveGroupsOnly(e.target.checked)}
                className="vg-checkbox"
              />
              Só grupos ativos ({groups.filter((g) => g.status === 'ativo').length})
            </label>
            <div className="sm:col-span-2 xl:col-span-2">
              <Input placeholder="Buscar nome ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
        </div>
        {(period || tagFilter || originFilter) && (
          <p className="mb-3 text-xs text-stone-500">
            Dica: combine <strong className="text-stone-400">tag QUALIFICADO</strong> + período para ver quantos
            qualificados tiveram atividade nessas datas.
            {period ? (
              <button
                type="button"
                className="ml-2 cursor-pointer text-accent-400 hover:underline"
                onClick={() => selectPeriod('')}
              >
                Limpar período
              </button>
            ) : null}
          </p>
        )}

        {loading ? (
          <div className="flex items-center gap-2 px-5 py-10 text-sm text-stone-500">
            <Loader2 className="h-4 w-4 animate-spin text-accent-400" />
            Carregando leads…
          </div>
        ) : displayedMembers.length === 0 && !refreshing ? (
          <p className="px-5 py-8 text-sm text-stone-500">
            {period === '1d'
              ? 'Nenhum lead com atividade hoje.'
              : period
                ? 'Nenhum lead com atividade no período selecionado.'
                : 'Nenhum lead encontrado com os filtros atuais.'}
            {!period && groups.length === 0 && meta?.crmLeadsTotal === 0
              ? ' Sincronize seus grupos em Conectar WhatsApp → Grupos.'
              : null}
            {!period && meta?.crmLeadsTotal > 0
              ? ' Leads do WhatsApp direto aparecem aqui assim que chegam no CRM.'
              : null}
          </p>
        ) : (
          <div
            className={`relative -mx-5 overflow-x-auto transition-opacity duration-150 ${
              refreshing ? 'pointer-events-none opacity-55' : 'opacity-100'
            }`}
          >
            {refreshing ? (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-500/35 bg-brand-950/95 px-3 py-1 text-[11px] text-accent-200 shadow-lg shadow-black/40">
                  <Loader2 className="h-3 w-3 animate-spin text-accent-400" />
                  Aplicando filtro… {Math.round(loadProgress)}%
                </span>
              </div>
            ) : null}
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-y border-brand-800 text-left text-stone-400">
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllHeader}
                      className="vg-checkbox"
                      title="Selecionar todos visíveis"
                      aria-label="Selecionar todos"
                    />
                  </th>
                  <th className="px-5 py-3">Pessoa</th>
                  <th className="px-5 py-3">Telefone</th>
                  <th className="px-5 py-3">Origem</th>
                  <th className="px-5 py-3">Grupos</th>
                  <th className="px-5 py-3">Tags</th>
                  <th className="px-5 py-3">Última atividade</th>
                </tr>
              </thead>
              <tbody>
                {displayedMembers.map((m) => (
                  <tr key={m.id} className="border-b border-brand-800/80 hover:bg-white/[0.02]">
                    <td className="px-3 py-3 align-middle">
                      <input
                        type="checkbox"
                        checked={selected.has(m.id)}
                        onChange={() => toggleRow(m.id)}
                        className="vg-checkbox"
                        aria-label={`Selecionar ${m.name}`}
                      />
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <img src={m.avatar} alt="" className="h-9 w-9 rounded-full border border-brand-700" />
                        <div className="min-w-0">
                          {m.conversationId ? (
                            <Link
                              to={`/dashboard/chat?c=${encodeURIComponent(m.conversationId)}`}
                              className="font-medium text-stone-100 hover:text-accent-300 hover:underline"
                            >
                              {m.name}
                            </Link>
                          ) : (
                            <span className="font-medium text-stone-100">{m.name}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-stone-400">{m.phone}</td>
                    <td className="px-5 py-3">
                      <OriginBadge origin={m.origin || (m.hasX1 ? 'x1' : 'group')} />
                    </td>
                    <td className="max-w-[200px] px-5 py-3 text-stone-300">
                      <span className="line-clamp-2">
                        {(m.groupNames || (m.groups || []).filter((g) => g !== 'WhatsApp direto')).join(', ') || '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(m.crmTags || []).map((t) => (
                          <Badge key={`${m.id}-crm-${t}`} variant="success" title="Tag do CRM (chat)">
                            {displayTag(normalizeTag(t))}
                          </Badge>
                        ))}
                        {(m.tags || []).length ? (
                          m.tags.map((t) => {
                            const norm = normalizeTag(t)
                            if (norm === 'admin') {
                              return (
                                <Badge key={`${m.id}-admin`} variant="warning">
                                  admin
                                </Badge>
                              )
                            }
                            return (
                              <span
                                key={`${m.id}-${norm}`}
                                className="inline-flex items-center gap-0.5 rounded-full border border-brand-600 bg-brand-800/80 py-0.5 pl-2.5 pr-1 text-xs text-stone-200"
                              >
                                {displayTag(norm)}
                                <button
                                  type="button"
                                  className="cursor-pointer rounded p-0.5 text-stone-500 hover:bg-white/10 hover:text-accent-400"
                                  aria-label={`Remover tag ${displayTag(norm)}`}
                                  onClick={() => removeTagFromMember(m.id, norm)}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            )
                          })
                        ) : !(m.crmTags || []).length ? (
                          <span className="text-stone-600">—</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-xs text-stone-500">{fmtActivity(m.lastActivity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {displayedMembers.length === 0 && refreshing ? (
              <p className="px-5 py-8 text-center text-sm text-stone-500">Filtrando leads…</p>
            ) : null}
          </div>
        )}
        {!loading && displayedMembers.length > 0 && (
          <p className="mt-3 px-5 text-xs text-stone-500">
            {displayedMembers.length} lead(s) listado(s)
            {meta?.filteredX1Only != null
              ? ` · ${meta.filteredX1Only} 1:1 · ${meta.filteredGroupOnly} grupo · ${meta.filteredBoth} nos dois`
              : ''}
            {refreshing ? ' · atualizando…' : ''}
          </p>
        )}
      </Card>

      <Modal
        isOpen={tagsModal}
        onClose={closeTagsModal}
        title="Gerenciar tags"
        size="md"
        footer={
          <Button variant="ghost" onClick={closeTagsModal}>
            Fechar
          </Button>
        }
      >
        <p className="text-sm text-stone-400 mb-4">
          Crie, edite ou exclua tags. Selecione membros na tabela e use &quot;Aplicar tag&quot; acima da lista.
        </p>
        <div className="space-y-2 mb-4 min-h-[28px]">
          {tagCatalog.includes('admin') && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="warning">admin</Badge>
              <span className="text-xs text-stone-500">Reservada — vem do WhatsApp (não editável)</span>
            </div>
          )}
          {manageableTags.length === 0 && !tagCatalog.includes('admin') && (
            <span className="text-xs text-stone-500">Nenhuma tag ainda.</span>
          )}
          {manageableTags.map((t) =>
            editingTag === t ? (
              <div key={t} className="flex flex-wrap items-center gap-2">
                <Input
                  className="max-w-[220px]"
                  value={editingTagName}
                  onChange={(e) => setEditingTagName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      saveEditTag()
                    }
                    if (e.key === 'Escape') cancelEditTag()
                  }}
                  autoFocus
                />
                <Button type="button" size="sm" variant="primary" className="gap-1" onClick={saveEditTag}>
                  <Check className="h-3.5 w-3.5" /> Salvar
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={cancelEditTag}>
                  Cancelar
                </Button>
              </div>
            ) : (
              <div
                key={t}
                className="inline-flex items-center gap-1 rounded-full border border-brand-600 bg-brand-800/80 pl-3 pr-1.5 py-1 text-sm text-stone-100"
              >
                <span>{displayTag(t)}</span>
                <button
                  type="button"
                  className="rounded p-1 text-stone-400 hover:bg-white/10 hover:text-accent-300"
                  aria-label={`Editar tag ${displayTag(t)}`}
                  onClick={() => startEditTag(t)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-stone-400 hover:bg-red-500/15 hover:text-red-300"
                  aria-label={`Excluir tag ${displayTag(t)}`}
                  onClick={() => deleteTag(t)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ),
          )}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Nome da nova tag (ex: lead-quente)"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), createTag())}
          />
          <Button type="button" variant="secondary" className="gap-1 shrink-0" onClick={createTag}>
            <Plus className="h-4 w-4" /> Criar
          </Button>
        </div>
      </Modal>
    </div>
  )
}
