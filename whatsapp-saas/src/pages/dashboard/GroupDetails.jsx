import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import {
  ArrowLeft,
  Tag,
  UserMinus,
  Plus,
  X,
  UserCheck,
  Shield,
  BellRing,
  Save,
  RotateCcw,
  CalendarClock,
  Users2,
  AlertTriangle,
  Send,
  RefreshCw,
  ListChecks,
} from 'lucide-react'
import { Card } from '../../components/common/Card.jsx'
import { Tabs } from '../../components/common/Tabs.jsx'
import { Toggle } from '../../components/common/Toggle.jsx'
import { Textarea } from '../../components/common/Textarea.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { Skeleton } from '../../components/common/Skeleton.jsx'
import { Modal } from '../../components/common/Modal.jsx'
import { Select } from '../../components/common/Select.jsx'
import { getGroupDetails, getGroupMemberTimeline, getGroupX1Deliveries, setGroupParticipantsStatus, syncGroupMessages, testGroupX1, updateGroupConfig } from '../../services/api.js'
import { resolveUseRealApi } from '../../lib/runtimeEnv.js'
import { useToast } from '../../contexts/ToastContext.jsx'
import { avatar, mockGroupSettings } from '../../utils/mockData.js'

function normalizeTag(t) {
  return String(t || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
}

function displayTag(t) {
  const n = normalizeTag(t)
  if (!n) return ''
  return n
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function membersStorageKey(groupId) {
  return `vg_group_members_${groupId}`
}

function nowIso() {
  return new Date().toISOString()
}

const defaultGovernance = () => ({
  postingWindowEnabled: true,
  postingStart: '08:00',
  postingEnd: '22:00',
  adminsFullAccess: true,
  admins: ['+55 (11) 99876-5432'],
  mediaPolicies: {
    text: true,
    image: true,
    audio: true,
    video: true,
    document: false,
  },
  antiFloodPerMinute: 6,
  removeForeignNumbers: true,
  blockedDdis: ['+1', '+44', '+91'],
  whitelist: '',
  blacklist: '',
  keywordRules: [
    { id: 'kr1', keyword: 'spam', action: 'deletar' },
    { id: 'kr2', keyword: 'golpe', action: 'remover' },
  ],
})

const defaultRoutines = () => [
  { id: 'r1', type: 'privacidade', description: 'Fechar grupo 22:00 e abrir 08:00', enabled: true },
  { id: 'r2', type: 'mensagem-fixada', description: 'Atualizar mensagem fixada toda manhã', enabled: false },
]

const defaultAudit = () => []

const defaultSnapshots = () => []

const defaultStatusRules = () => ({
  enabled: false,
  inactiveAfterHours: 72,
})

function normalizeStatusRules(raw) {
  const base = defaultStatusRules()
  if (!raw || typeof raw !== 'object') return { ...base }

  if (Array.isArray(raw.rules)) {
    const first = raw.rules.find((r) => r && r.enabled !== false) || raw.rules[0]
    if (!first || typeof first !== 'object') return { ...base }
    const fromDays =
      first.days != null && Number.isFinite(Number(first.days)) ? Math.round(Number(first.days) * 24) : null
    return {
      enabled: Boolean(raw.rules.some((r) => r && r.enabled !== false)),
      inactiveAfterHours: Math.max(
        1,
        Math.min(8760, Number(first.inactiveAfterHours) || fromDays || base.inactiveAfterHours),
      ),
    }
  }

  return {
    enabled: raw.enabled === true,
    inactiveAfterHours: Math.max(1, Math.min(8760, Number(raw.inactiveAfterHours) || base.inactiveAfterHours)),
  }
}

function hoursWithoutActivity(member, nowMs = Date.now()) {
  const raw = member?.lastActivity || member?.joinedAt
  if (!raw) return Infinity
  const t = new Date(raw).getTime()
  if (Number.isNaN(t)) return Infinity
  return (nowMs - t) / (60 * 60 * 1000)
}

function memberMatchesInactivityRule(member, rules, nowMs = Date.now()) {
  if (!rules?.enabled) return false
  if (member?.role === 'admin' || member?.role === 'superadmin') return false
  if (member?.status === 'saiu' || member?.status === 'inativo') return false
  return hoursWithoutActivity(member, nowMs) >= rules.inactiveAfterHours
}

const defaultX1KindSettings = (template) => ({
  template,
  minDelaySec: 15,
  maxDelaySec: 75,
  maxX1PerUser24h: 2,
  quietHoursEnabled: true,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
})

const defaultX1Automation = () => ({
  enabled: false,
  sendX1OnJoin: false,
  sendX1OnLeave: false,
  join: defaultX1KindSettings(
    'Olá! Seja bem-vindo(a)! Me chama no privado para receber o guia rápido.',
  ),
  leave: defaultX1KindSettings('Percebi que você saiu do grupo. Posso te ajudar por aqui no X1?'),
})

function stripNomePlaceholder(template) {
  return String(template || '')
    .replace(/\{\{\s*nome\s*\}\}/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([!?.,:;])/g, '$1')
    .trim()
}

function sanitizeX1KindBlock(block) {
  const safe = {
    ...block,
    template: stripNomePlaceholder(block?.template || ''),
    minDelaySec: Math.max(0, Number(block?.minDelaySec) || 0),
    maxDelaySec: Math.max(0, Number(block?.maxDelaySec) || 0),
    maxX1PerUser24h: Math.max(1, Number(block?.maxX1PerUser24h) || 1),
    quietHoursEnabled: block?.quietHoursEnabled !== false,
    quietHoursStart: block?.quietHoursStart || '22:00',
    quietHoursEnd: block?.quietHoursEnd || '08:00',
  }
  if (safe.maxDelaySec < safe.minDelaySec) safe.maxDelaySec = safe.minDelaySec
  return safe
}

function migrateX1Automation(raw) {
  const base = defaultX1Automation()
  if (!raw || typeof raw !== 'object') return base

  const join = sanitizeX1KindBlock({
    ...base.join,
    ...(raw.join || {}),
    template: raw.join?.template ?? raw.joinTemplate ?? base.join.template,
    minDelaySec: raw.join?.minDelaySec ?? raw.minDelaySec ?? base.join.minDelaySec,
    maxDelaySec: raw.join?.maxDelaySec ?? raw.maxDelaySec ?? base.join.maxDelaySec,
    maxX1PerUser24h: raw.join?.maxX1PerUser24h ?? raw.maxX1PerUser24h ?? base.join.maxX1PerUser24h,
    quietHoursEnabled: raw.join?.quietHoursEnabled ?? raw.quietHoursEnabled ?? base.join.quietHoursEnabled,
    quietHoursStart: raw.join?.quietHoursStart ?? raw.quietHoursStart ?? base.join.quietHoursStart,
    quietHoursEnd: raw.join?.quietHoursEnd ?? raw.quietHoursEnd ?? base.join.quietHoursEnd,
  })

  const leave = sanitizeX1KindBlock({
    ...base.leave,
    ...(raw.leave || {}),
    template: raw.leave?.template ?? raw.leaveTemplate ?? base.leave.template,
    minDelaySec: raw.leave?.minDelaySec ?? raw.minDelaySec ?? base.leave.minDelaySec,
    maxDelaySec: raw.leave?.maxDelaySec ?? raw.maxDelaySec ?? base.leave.maxDelaySec,
    maxX1PerUser24h: raw.leave?.maxX1PerUser24h ?? raw.maxX1PerUser24h ?? base.leave.maxX1PerUser24h,
    quietHoursEnabled: raw.leave?.quietHoursEnabled ?? raw.quietHoursEnabled ?? base.leave.quietHoursEnabled,
    quietHoursStart: raw.leave?.quietHoursStart ?? raw.quietHoursStart ?? base.leave.quietHoursStart,
    quietHoursEnd: raw.leave?.quietHoursEnd ?? raw.quietHoursEnd ?? base.leave.quietHoursEnd,
  })

  return {
    enabled: raw.enabled === true,
    sendX1OnJoin: raw.sendX1OnJoin === true,
    sendX1OnLeave: raw.sendX1OnLeave === true,
    join,
    leave,
  }
}

function patchX1Kind(setter, kind, patch) {
  setter((s) => ({ ...s, [kind]: { ...s[kind], ...patch } }))
}

function formatActivity(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

export function GroupDetails() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') === 'config' ? 'config' : 'visao'
  const [tab, setTab] = useState(initialTab)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [payload, setPayload] = useState(null)
  const [memberFilter, setMemberFilter] = useState('todos')
  const [memberQ, setMemberQ] = useState('')
  const [settings, setSettings] = useState(mockGroupSettings)
  const [members, setMembers] = useState([])
  const [selected, setSelected] = useState(() => new Set())
  const [catalogExtras, setCatalogExtras] = useState([])
  const [governance, setGovernance] = useState(defaultGovernance)
  const [routines, setRoutines] = useState(defaultRoutines)
  const [auditLog, setAuditLog] = useState(defaultAudit)
  const [snapshots, setSnapshots] = useState(defaultSnapshots)
  const [addTagModal, setAddTagModal] = useState(false)
  const [removeTagModal, setRemoveTagModal] = useState(false)
  const [memberTimeline, setMemberTimeline] = useState(null)
  const [timelineMemberId, setTimelineMemberId] = useState(null)
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [timelineSyncing, setTimelineSyncing] = useState(false)
  const [timelineError, setTimelineError] = useState(null)
  const [routineModal, setRoutineModal] = useState(false)
  const [newRoutine, setNewRoutine] = useState({ type: 'privacidade', description: '' })
  const [newTagName, setNewTagName] = useState('')
  const [tagsToAdd, setTagsToAdd] = useState(() => new Set())
  const [tagsToRemove, setTagsToRemove] = useState(() => new Set())
  const [inlineNewTag, setInlineNewTag] = useState('')
  const [newAdmin, setNewAdmin] = useState('')
  const [x1Automation, setX1Automation] = useState(() => defaultX1Automation())
  const [statusRules, setStatusRules] = useState(() => defaultStatusRules())
  const [statusRulesSaving, setStatusRulesSaving] = useState(false)
  const [x1Deliveries, setX1Deliveries] = useState([])
  const [x1DeliveriesLoading, setX1DeliveriesLoading] = useState(false)
  const [testParticipantJid, setTestParticipantJid] = useState('')
  const [x1Testing, setX1Testing] = useState(null)
  const catalogExtrasRef = useRef([])
  const governanceRef = useRef(defaultGovernance())
  const routinesRef = useRef(defaultRoutines())
  const auditLogRef = useRef(defaultAudit())
  const snapshotsRef = useRef(defaultSnapshots())
  const x1AutomationRef = useRef(defaultX1Automation())
  const statusRulesRef = useRef(defaultStatusRules())
  const toast = useToast()

  useEffect(() => {
    catalogExtrasRef.current = catalogExtras
  }, [catalogExtras])

  useEffect(() => {
    governanceRef.current = governance
  }, [governance])

  useEffect(() => {
    routinesRef.current = routines
  }, [routines])

  useEffect(() => {
    auditLogRef.current = auditLog
  }, [auditLog])

  useEffect(() => {
    snapshotsRef.current = snapshots
  }, [snapshots])

  useEffect(() => {
    statusRulesRef.current = statusRules
  }, [statusRules])

  useEffect(() => {
    if (tab !== 'config' || !id || !resolveUseRealApi()) return
    let ok = true
    setX1DeliveriesLoading(true)
    getGroupX1Deliveries(id, 30)
      .then((res) => {
        if (!ok) return
        setX1Deliveries(Array.isArray(res.data?.deliveries) ? res.data.deliveries : [])
      })
      .catch(() => {
        if (ok) setX1Deliveries([])
      })
      .finally(() => {
        if (ok) setX1DeliveriesLoading(false)
      })
    return () => {
      ok = false
    }
  }, [tab, id, x1Automation.enabled])

  useEffect(() => {
    if (!members.length) return
    if (testParticipantJid && members.some((m) => m.participantJid === testParticipantJid || m.id === testParticipantJid)) return
    const first = members.find((m) => m.status !== 'saiu')
    if (first) setTestParticipantJid(first.participantJid || first.id || '')
  }, [members, testParticipantJid])

  useEffect(() => {
    x1AutomationRef.current = x1Automation
  }, [x1Automation])

  const persistAll = useCallback(
    (nextMembers, nextExtras, nextGovernance, nextRoutines, nextAudit, nextSnapshots, nextX1Automation, nextStatusRules) => {
      try {
        const ext = nextExtras !== undefined ? nextExtras : catalogExtrasRef.current
        const gov = nextGovernance !== undefined ? nextGovernance : governanceRef.current
        const rts = nextRoutines !== undefined ? nextRoutines : routinesRef.current
        const aud = nextAudit !== undefined ? nextAudit : auditLogRef.current
        const snp = nextSnapshots !== undefined ? nextSnapshots : snapshotsRef.current
        const x1 = nextX1Automation !== undefined ? nextX1Automation : x1AutomationRef.current
        const rules = nextStatusRules !== undefined ? nextStatusRules : statusRulesRef.current
        localStorage.setItem(
          membersStorageKey(id),
          JSON.stringify({
            v: 6,
            members: nextMembers,
            catalogExtras: ext,
            governance: gov,
            routines: rts,
            auditLog: aud,
            snapshots: snp,
            x1Automation: x1,
            statusRules: rules,
          }),
        )
      } catch {
        /* ignore */
      }
    },
    [id],
  )

  useEffect(() => {
    let ok = true
    setLoading(true)
    setLoadError(null)
    getGroupDetails(id)
      .then((res) => {
        if (!ok) return
        setPayload(res.data)
        if (res.data.settings) setSettings({ ...res.data.settings })
      })
      .catch((err) => {
        if (!ok) return
        const msg =
          err?.response?.data?.message ||
          err?.response?.data?.error ||
          err?.message ||
          'Não foi possível carregar os detalhes do grupo.'
        setLoadError(typeof msg === 'string' ? msg : 'Não foi possível carregar os detalhes do grupo.')
        setPayload(null)
      })
      .finally(() => {
        if (ok) setLoading(false)
      })
    return () => {
      ok = false
    }
  }, [id])

  useEffect(() => {
    if (!payload?.members) return
    const base = payload.members.map((m) => ({
      ...m,
      tags: [...(m.tags || [])],
      lastActivity: m.lastActivity || null,
      joinedAt: m.joinedAt || null,
      messageCount: m.messageCount ?? null,
      persona: m.persona || 'cliente',
    }))
    let initial = base
    let extras = []
    let gov = defaultGovernance()
    let rts = defaultRoutines()
    let aud = defaultAudit()
    let snp = defaultSnapshots()
    let x1 = defaultX1Automation()
    let groupSettings = { ...mockGroupSettings }

    if (payload?.settings && typeof payload.settings === 'object') {
      groupSettings = { ...groupSettings, ...payload.settings }
    }
    if (payload?.config && typeof payload.config === 'object') {
      if (Array.isArray(payload.config.catalogExtras)) extras = payload.config.catalogExtras.map(normalizeTag).filter(Boolean)
      if (payload.config.governance && typeof payload.config.governance === 'object') {
        gov = { ...defaultGovernance(), ...payload.config.governance }
      }
      if (Array.isArray(payload.config.routines)) rts = payload.config.routines
      if (Array.isArray(payload.config.auditLog)) aud = payload.config.auditLog
      if (Array.isArray(payload.config.snapshots)) snp = payload.config.snapshots
      if (payload.config.x1Automation && typeof payload.config.x1Automation === 'object') {
        x1 = migrateX1Automation(payload.config.x1Automation)
      }
    }
    let statusRulesLocal = payload?.config?.statusRules
      ? normalizeStatusRules(payload.config.statusRules)
      : defaultStatusRules()
    if (!resolveUseRealApi()) {
      try {
        const raw = localStorage.getItem(membersStorageKey(id))
        if (raw) {
          const saved = JSON.parse(raw)
          if ((saved?.v === 6 || saved?.v === 5 || saved?.v === 4 || saved?.v === 3 || saved?.v === 2) && Array.isArray(saved.members)) {
            const byId = new Map(saved.members.map((x) => [x.id, x]))
            initial = base.map((m) => {
              if (!byId.has(m.id)) return m
              const s = byId.get(m.id)
              return {
                ...m,
                tags: [...(s.tags || [])],
                lastActivity: s.lastActivity || m.lastActivity,
                persona: s.persona || m.persona,
                status: s.status === 'inativo' || s.status === 'ativo' ? s.status : m.status,
              }
            })
            if (Array.isArray(saved.catalogExtras)) extras = saved.catalogExtras.map(normalizeTag).filter(Boolean)
            if ((saved.v === 4 || saved.v === 5 || saved.v === 6) && saved.governance && typeof saved.governance === 'object') {
              gov = { ...defaultGovernance(), ...saved.governance }
            }
            if ((saved.v === 4 || saved.v === 5 || saved.v === 6) && Array.isArray(saved.routines)) rts = saved.routines
            if ((saved.v === 4 || saved.v === 5 || saved.v === 6) && Array.isArray(saved.auditLog)) aud = saved.auditLog
            if ((saved.v === 4 || saved.v === 5 || saved.v === 6) && Array.isArray(saved.snapshots)) snp = saved.snapshots
            if ((saved.v === 5 || saved.v === 6) && saved.x1Automation && typeof saved.x1Automation === 'object') {
              x1 = migrateX1Automation(saved.x1Automation)
            }
            if (saved.v === 6 && saved.statusRules) {
              statusRulesLocal = normalizeStatusRules(saved.statusRules)
            }
          } else if (Array.isArray(saved) && saved.length) {
            const byId = new Map(saved.map((x) => [x.id, x]))
            initial = base.map((m) => {
              if (!byId.has(m.id)) return m
              const s = byId.get(m.id)
              return {
                ...m,
                tags: [...(s.tags || [])],
                lastActivity: s.lastActivity || m.lastActivity,
                persona: s.persona || m.persona,
              }
            })
          }
        }
      } catch {
        /* use API */
      }
    }
    setSettings(groupSettings)
    setMembers(initial)
    setSelected(new Set())
    setCatalogExtras(extras)
    setGovernance(gov)
    setRoutines(rts)
    setAuditLog(aud)
    setSnapshots(snp)
    setX1Automation(x1)
    setStatusRules(statusRulesLocal)

    if (!resolveUseRealApi() || !id) return

    const pending = initial
      .filter((m) => {
        const apiMember = base.find((b) => b.id === m.id)
        return apiMember && apiMember.status !== m.status && (m.status === 'ativo' || m.status === 'inativo')
      })
      .map((m) => ({ id: m.id, status: m.status }))

    if (!pending.length) return

    const byStatus = { ativo: [], inativo: [] }
    pending.forEach(({ id: memberId, status }) => byStatus[status].push(memberId))

    void (async () => {
      try {
        if (byStatus.ativo.length) await setGroupParticipantsStatus(id, byStatus.ativo, 'ativo')
        if (byStatus.inativo.length) await setGroupParticipantsStatus(id, byStatus.inativo, 'inativo')
      } catch {
        /* mantém UI local; usuário pode salvar de novo */
      }
    })()
  }, [payload, id])

  const tagCatalog = useMemo(() => {
    const s = new Set(catalogExtras.map(normalizeTag).filter(Boolean))
    members.forEach((m) => (m.tags || []).forEach((t) => s.add(normalizeTag(t))))
    return [...s].sort()
  }, [members, catalogExtras])

  const membersFiltered = useMemo(() => {
    if (memberFilter === 'regras') return []
    return members.filter((m) => {
      if (memberFilter === 'ativos' && m.status !== 'ativo') return false
      if (memberFilter === 'inativos' && m.status !== 'inativo') return false
      if (memberFilter === 'admins' && m.role !== 'admin' && m.role !== 'superadmin') return false
      if (memberQ && !m.name.toLowerCase().includes(memberQ.toLowerCase()) && !m.phone.includes(memberQ)) return false
      return true
    })
  }, [members, memberFilter, memberQ])

  const statusRulesPreviewCount = useMemo(() => {
    if (!statusRules.enabled) return 0
    const now = Date.now()
    return members.filter((m) => memberMatchesInactivityRule(m, statusRules, now)).length
  }, [statusRules, members])

  const tabs = useMemo(
    () => [
      { id: 'visao', label: 'Visão geral' },
      { id: 'membros', label: 'Membros' },
      { id: 'config', label: 'Configurações' },
    ],
    [],
  )

  const allFilteredSelected =
    membersFiltered.length > 0 && membersFiltered.every((m) => selected.has(m.id))

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const n = new Set(prev)
      if (allFilteredSelected) {
        membersFiltered.forEach((m) => n.delete(m.id))
      } else {
        membersFiltered.forEach((m) => n.add(m.id))
      }
      return n
    })
  }

  const toggleRow = (memberId) => {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(memberId)) n.delete(memberId)
      else n.add(memberId)
      return n
    })
  }

  async function openMemberTimeline(member) {
    setTimelineError(null)
    setTimelineLoading(true)
    setTimelineMemberId(member.id)
    setMemberTimeline({
      name: member.name,
      phone: member.phone,
      status: member.status,
      tags: member.tags || [],
      joinedAt: member.joinedAt || null,
      lastActivity: member.lastActivity || null,
      messageCount: member.messageCount ?? null,
      events: [],
      meta: null,
    })
    try {
      const { data } = await getGroupMemberTimeline(id, member.id)
      setMemberTimeline({
        name: data.member?.name || member.name,
        phone: data.member?.phone || member.phone,
        status: data.member?.status || member.status,
        tags: member.tags || [],
        joinedAt: data.member?.joinedAt || member.joinedAt || null,
        leftAt: data.member?.leftAt || null,
        lastActivity: data.member?.lastActivity || member.lastActivity || null,
        lastSyncedAt: data.member?.lastSyncedAt || member.lastSyncedAt || null,
        messageCount: data.member?.messageCount ?? member.messageCount ?? 0,
        events: Array.isArray(data.events) ? data.events : [],
        meta: data.meta || null,
      })
    } catch (err) {
      const status = err?.response?.status
      const apiMsg = err?.response?.data?.message
      const msg =
        apiMsg ||
        (status === 404
          ? 'Histórico indisponível no servidor (faça deploy/restart do backend).'
          : status === 409
            ? 'WhatsApp desconectado. Conecte e tente de novo.'
            : 'Não foi possível carregar o histórico.')
      setTimelineError(msg)
      toast.error(msg)
    } finally {
      setTimelineLoading(false)
    }
  }

  async function syncMemberTimeline() {
    if (!id || !timelineMemberId) return
    setTimelineSyncing(true)
    setTimelineError(null)
    try {
      const { data } = await syncGroupMessages(id)
      toast.success(data?.message || 'Sincronização iniciada. Aguarde e atualize o histórico.')
      // Pequena espera para o import começar a gravar, depois recarrega timeline.
      await new Promise((r) => setTimeout(r, 2500))
      const member = members.find((m) => m.id === timelineMemberId)
      if (member) await openMemberTimeline(member)
      else {
        const { data: tl } = await getGroupMemberTimeline(id, timelineMemberId)
        setMemberTimeline((prev) => ({
          ...(prev || {}),
          name: tl.member?.name || prev?.name,
          phone: tl.member?.phone || prev?.phone,
          status: tl.member?.status || prev?.status,
          joinedAt: tl.member?.joinedAt || prev?.joinedAt || null,
          leftAt: tl.member?.leftAt || null,
          lastActivity: tl.member?.lastActivity || prev?.lastActivity || null,
          lastSyncedAt: tl.member?.lastSyncedAt || null,
          messageCount: tl.member?.messageCount ?? 0,
          events: Array.isArray(tl.events) ? tl.events : [],
          meta: tl.meta || null,
        }))
      }
    } catch (err) {
      const msg = err?.response?.data?.message || 'Falha ao sincronizar mensagens do grupo.'
      setTimelineError(msg)
      toast.error(msg)
    } finally {
      setTimelineSyncing(false)
    }
  }

  const createGroupTag = () => {
    const norm = normalizeTag(newTagName)
    if (!norm) {
      toast.error('Digite um nome para a tag.')
      return
    }
    if (tagCatalog.includes(norm)) {
      toast.info('Essa tag já existe no catálogo.')
      setNewTagName('')
      return
    }
    const nextExtras = [...catalogExtras, norm]
    setCatalogExtras(nextExtras)
    const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'tag.create', details: norm }, ...auditLog]
    setAuditLog(nextAudit.slice(0, 50))
    persistAll(members, nextExtras, governance, routines, nextAudit.slice(0, 50), snapshots)
    setNewTagName('')
    toast.success(`Tag "${displayTag(norm)}" criada. Você pode atribuí-la aos membros.`)
  }

  const applyAddTags = () => {
    if (selected.size === 0) {
      toast.error('Selecione ao menos um membro.')
      return
    }
    const extra = normalizeTag(inlineNewTag)
    const fromCheck = [...tagsToAdd].map(normalizeTag).filter(Boolean)
    const toAdd = [...new Set([...fromCheck, extra].filter(Boolean))]
    if (toAdd.length === 0) {
      toast.error('Selecione ou digite ao menos uma tag.')
      return
    }
    let nextExtras = [...catalogExtras]
    toAdd.forEach((t) => {
      if (!tagCatalog.includes(t) && !nextExtras.includes(t)) nextExtras.push(t)
    })
    setCatalogExtras(nextExtras)
    setMembers((prev) => {
      const next = prev.map((m) => {
        if (!selected.has(m.id)) return m
        const set = new Set((m.tags || []).map(normalizeTag))
        toAdd.forEach((t) => set.add(t))
        return { ...m, tags: [...set] }
      })
      const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'tag.bulk_add', details: toAdd.join(', ') }, ...auditLogRef.current].slice(0, 50)
      setAuditLog(nextAudit)
      persistAll(next, nextExtras, governance, routines, nextAudit, snapshots)
      return next
    })
    toast.success(`Tag(s) aplicada(s) a ${selected.size} membro(s).`)
    setAddTagModal(false)
    setTagsToAdd(new Set())
    setInlineNewTag('')
  }

  const applyRemoveTags = () => {
    if (selected.size === 0) {
      toast.error('Selecione ao menos um membro.')
      return
    }
    if (tagsToRemove.size === 0) {
      toast.error('Selecione ao menos uma tag para remover.')
      return
    }
    const toDel = new Set([...tagsToRemove].map(normalizeTag))
    setMembers((prev) => {
      const next = prev.map((m) => {
        if (!selected.has(m.id)) return m
        return { ...m, tags: (m.tags || []).map(normalizeTag).filter((t) => !toDel.has(t)) }
      })
      const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'tag.bulk_remove', details: [...toDel].join(', ') }, ...auditLogRef.current].slice(0, 50)
      setAuditLog(nextAudit)
      persistAll(next, catalogExtras, governance, routines, nextAudit, snapshots)
      return next
    })
    toast.success('Tag(s) removida(s) dos membros selecionados.')
    setRemoveTagModal(false)
    setTagsToRemove(new Set())
  }

  const removeTagFromMember = (memberId, tag) => {
    const norm = normalizeTag(tag)
    setMembers((prev) => {
      const next = prev.map((m) =>
        m.id === memberId ? { ...m, tags: (m.tags || []).map(normalizeTag).filter((t) => t !== norm) } : m,
      )
      const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'tag.remove_single', details: norm }, ...auditLogRef.current].slice(0, 50)
      setAuditLog(nextAudit)
      persistAll(next, catalogExtras, governance, routines, nextAudit, snapshots)
      return next
    })
    toast.success(`Tag "${displayTag(norm)}" removida.`)
  }

  const openAddModal = () => {
    if (selected.size === 0) {
      toast.error('Selecione ao menos um membro na tabela.')
      return
    }
    setTagsToAdd(new Set())
    setInlineNewTag('')
    setAddTagModal(true)
  }

  const openRemoveModal = () => {
    if (selected.size === 0) {
      toast.error('Selecione ao menos um membro na tabela.')
      return
    }
    setTagsToRemove(new Set())
    setRemoveTagModal(true)
  }

  const setMemberStatus = async (memberId, nextStatus) => {
    if (nextStatus !== 'ativo' && nextStatus !== 'inativo') return
    const cur = members.find((x) => x.id === memberId)
    if (cur?.status === nextStatus) return
    const prevStatus = cur?.status
    setMembers((prev) => {
      const next = prev.map((m) => (m.id === memberId ? { ...m, status: nextStatus } : m))
      const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'member.status', details: `${memberId} -> ${nextStatus}` }, ...auditLogRef.current].slice(0, 50)
      setAuditLog(nextAudit)
      persistAll(next, catalogExtras, governance, routines, nextAudit, snapshots)
      return next
    })
    toast.success('Status atualizado.')

    if (!id) return

    try {
      const res = await setGroupParticipantsStatus(id, [memberId], nextStatus)
      if (!res.data?.updated) {
        throw new Error('Participante não encontrado no servidor. Sincronize o grupo e tente de novo.')
      }
    } catch (e) {
      setMembers((prev) => {
        const next = prev.map((m) => (m.id === memberId ? { ...m, status: prevStatus || m.status } : m))
        persistAll(next, catalogExtras, governance, routines, auditLogRef.current, snapshots)
        return next
      })
      toast.error(e?.response?.data?.message || e?.message || 'Falha ao salvar status no servidor.')
    }
  }

  const setBulkStatus = (nextStatus) => {
    if (nextStatus !== 'ativo' && nextStatus !== 'inativo') return
    if (selected.size === 0) {
      toast.error('Selecione ao menos um membro.')
      return
    }
    const memberIds = [...selected]
    const prevById = new Map(members.filter((m) => selected.has(m.id)).map((m) => [m.id, m.status]))
    setMembers((prev) => {
      const next = prev.map((m) => (selected.has(m.id) ? { ...m, status: nextStatus } : m))
      const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'member.status_bulk', details: `${selected.size} -> ${nextStatus}` }, ...auditLogRef.current].slice(0, 50)
      setAuditLog(nextAudit)
      persistAll(next, catalogExtras, governance, routines, nextAudit, snapshots)
      return next
    })
    toast.success(`Status "${nextStatus}" aplicado a ${selected.size} membro(s).`)

    if (!id) return
    void setGroupParticipantsStatus(id, memberIds, nextStatus).catch(() => {
      setMembers((prev) => {
        const next = prev.map((m) => {
          if (!prevById.has(m.id)) return m
          return { ...m, status: prevById.get(m.id) }
        })
        persistAll(next, catalogExtras, governance, routines, auditLogRef.current, snapshots)
        return next
      })
      toast.error('Falha ao salvar status no servidor.')
    })
  }

  const executeMoveBulk = () => {
    toast.error('Mover membros entre grupos ainda não está disponível. Use o WhatsApp para reorganizar participantes.')
  }

  const createSnapshot = () => {
    const snap = {
      id: crypto.randomUUID(),
      at: nowIso(),
      title: `Snapshot ${new Date().toLocaleTimeString('pt-BR')}`,
      governance,
      settings,
      routines,
      x1Automation,
    }
    const next = [snap, ...snapshots].slice(0, 20)
    setSnapshots(next)
    const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'snapshot.create', details: snap.title }, ...auditLogRef.current].slice(0, 50)
    setAuditLog(nextAudit)
    persistAll(members, catalogExtras, governance, routines, nextAudit, next, x1Automation)
    toast.success('Snapshot de regras salvo.')
  }

  const rollbackSnapshot = (snapId) => {
    const snap = snapshots.find((s) => s.id === snapId)
    if (!snap) return
    setGovernance(snap.governance)
    setSettings(snap.settings)
    setRoutines(snap.routines)
    setX1Automation(snap.x1Automation || defaultX1Automation())
    const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'snapshot.rollback', details: snap.title }, ...auditLogRef.current].slice(0, 50)
    setAuditLog(nextAudit)
    persistAll(
      members,
      catalogExtras,
      snap.governance,
      snap.routines,
      nextAudit,
      snapshots,
      snap.x1Automation || defaultX1Automation(),
    )
    toast.success(`Rollback aplicado: ${snap.title}`)
  }

  const addKeywordRule = () => {
    setGovernance((prev) => ({
      ...prev,
      keywordRules: [...prev.keywordRules, { id: crypto.randomUUID(), keyword: '', action: 'avisar' }],
    }))
  }

  const updateKeywordRule = (ruleId, key, value) => {
    setGovernance((prev) => ({
      ...prev,
      keywordRules: prev.keywordRules.map((r) => (r.id === ruleId ? { ...r, [key]: value } : r)),
    }))
  }

  const removeKeywordRule = (ruleId) => {
    setGovernance((prev) => ({
      ...prev,
      keywordRules: prev.keywordRules.filter((r) => r.id !== ruleId),
    }))
  }

  const saveGovernance = () => {
    const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'governance.save', details: 'Regras de governança atualizadas' }, ...auditLogRef.current].slice(0, 50)
    setAuditLog(nextAudit)
    persistAll(members, catalogExtras, governance, routines, nextAudit, snapshots)
    if (resolveUseRealApi() && id) {
      void updateGroupConfig(id, {
        governance,
        routines,
        auditLog: nextAudit,
        snapshots,
        catalogExtras,
      }).catch((e) => {
        toast.error(e?.response?.data?.message || 'Falha ao salvar governança no servidor.')
      })
    }
    toast.success('Governança salva.')
  }

  async function saveStatusRules() {
    const normalized = normalizeStatusRules(statusRules)
    setStatusRules(normalized)
    setStatusRulesSaving(true)
    const nextAudit = [
      {
        id: crypto.randomUUID(),
        at: nowIso(),
        action: 'statusRules.save',
        details: normalized.enabled
          ? `Inativo após ${normalized.inactiveAfterHours}h sem atividade`
          : 'Regra de inatividade desligada',
      },
      ...auditLogRef.current,
    ].slice(0, 50)
    setAuditLog(nextAudit)
    persistAll(members, catalogExtras, governance, routines, nextAudit, snapshots, undefined, normalized)
    try {
      let applied = 0
      if (resolveUseRealApi() && id) {
        const res = await updateGroupConfig(id, { statusRules: normalized, auditLog: nextAudit })
        applied = Number(res?.data?.statusRulesApplied?.updated) || 0
        if (applied > 0) {
          const appliedIds = new Set(res?.data?.statusRulesApplied?.participantJids || [])
          if (appliedIds.size) {
            setMembers((prev) =>
              prev.map((m) => (appliedIds.has(m.id) || appliedIds.has(m.participantJid) ? { ...m, status: 'inativo' } : m)),
            )
          } else {
            // fallback: recalcula localmente
            const now = Date.now()
            setMembers((prev) =>
              prev.map((m) => (memberMatchesInactivityRule(m, normalized, now) ? { ...m, status: 'inativo' } : m)),
            )
          }
        }
      } else if (normalized.enabled) {
        const now = Date.now()
        const toInativo = members.filter((m) => memberMatchesInactivityRule(m, normalized, now))
        if (toInativo.length) {
          applied = toInativo.length
          const ids = new Set(toInativo.map((m) => m.id))
          const nextMembers = members.map((m) => (ids.has(m.id) ? { ...m, status: 'inativo' } : m))
          setMembers(nextMembers)
          persistAll(nextMembers, catalogExtras, governance, routines, nextAudit, snapshots, undefined, normalized)
        }
      }
      toast.success(
        applied > 0 ? `Regra salva. ${applied} membro(s) marcado(s) inativo.` : 'Regra salva.',
      )
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Falha ao salvar regra.')
    } finally {
      setStatusRulesSaving(false)
    }
  }

  const addAdmin = () => {
    const value = newAdmin.trim()
    if (!value) {
      toast.error('Informe e-mail ou número do admin.')
      return
    }
    if (governance.admins.includes(value)) {
      toast.info('Esse admin já está vinculado.')
      return
    }
    const nextGovernance = { ...governance, admins: [...governance.admins, value] }
    setGovernance(nextGovernance)
    setNewAdmin('')
    const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'admin.add', details: value }, ...auditLogRef.current].slice(0, 50)
    setAuditLog(nextAudit)
    persistAll(members, catalogExtras, nextGovernance, routines, nextAudit, snapshots, x1Automation)
  }

  const removeAdmin = (value) => {
    const nextGovernance = { ...governance, admins: governance.admins.filter((x) => x !== value) }
    setGovernance(nextGovernance)
    const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'admin.remove', details: value }, ...auditLogRef.current].slice(0, 50)
    setAuditLog(nextAudit)
    persistAll(members, catalogExtras, nextGovernance, routines, nextAudit, snapshots, x1Automation)
  }

  const refreshX1Deliveries = useCallback(() => {
    if (!id || !resolveUseRealApi()) return Promise.resolve()
    return getGroupX1Deliveries(id, 30)
      .then((res) => setX1Deliveries(Array.isArray(res.data?.deliveries) ? res.data.deliveries : []))
      .catch(() => setX1Deliveries([]))
  }, [id])

  const saveX1Automation = () => {
    const monitoringActive = payload?.group?.status === 'ativo' && payload?.group?.monitoringEnabled
    const safe = migrateX1Automation({
      ...x1Automation,
      ...(monitoringActive ? {} : { enabled: false, sendX1OnJoin: false, sendX1OnLeave: false }),
      join: sanitizeX1KindBlock(x1Automation.join),
      leave: sanitizeX1KindBlock(x1Automation.leave),
    })
    setX1Automation(safe)
    const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'x1.settings_save', details: 'Automação de entrada/saída atualizada' }, ...auditLogRef.current].slice(0, 50)
    setAuditLog(nextAudit)
    persistAll(members, catalogExtras, governance, routines, nextAudit, snapshots, safe)
    if (resolveUseRealApi() && id) {
      void updateGroupConfig(id, { x1Automation: safe, auditLog: nextAudit }).catch((e) => {
        toast.error(e?.response?.data?.message || 'Falha ao salvar automação X1 no servidor.')
      })
    }
    toast.success('Automação X1 salva.')
  }

  const testX1Event = async (kind) => {
    if (!testParticipantJid) {
      toast.error('Selecione um membro para testar o X1.')
      return
    }
    setX1Testing(kind)
    try {
      const res = await testGroupX1(id, { kind, participantJid: testParticipantJid })
      const delivery = res.data?.delivery
      if (delivery?.status === 'sent') {
        toast.success(`X1 de ${kind === 'join' ? 'entrada' : 'saída'} enviado no privado.`)
      } else if (delivery?.status === 'pending') {
        toast.success('X1 enfileirado — será enviado em instantes.')
      } else {
        toast.success('Teste X1 registrado.')
      }
      const nextAudit = [
        {
          id: crypto.randomUUID(),
          at: nowIso(),
          action: `x1.test_${kind}`,
          details: `${testParticipantJid} → ${delivery?.status || 'ok'}`,
        },
        ...auditLogRef.current,
      ].slice(0, 50)
      setAuditLog(nextAudit)
      persistAll(members, catalogExtras, governance, routines, nextAudit, snapshots, x1Automation)
      await refreshX1Deliveries()
    } catch (err) {
      const msg = err?.response?.data?.message || err?.response?.data?.delivery?.error || err?.message || 'Falha ao testar X1.'
      toast.error(msg)
      if (err?.response?.data?.delivery) {
        await refreshX1Deliveries()
      }
    } finally {
      setX1Testing(null)
    }
  }

  const addRoutine = () => {
    if (!newRoutine.description.trim()) {
      toast.error('Informe a descrição da rotina.')
      return
    }
    const routine = { id: crypto.randomUUID(), ...newRoutine, enabled: true }
    const next = [routine, ...routines]
    setRoutines(next)
    setRoutineModal(false)
    setNewRoutine({ type: 'privacidade', description: '' })
    const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'routine.add', details: routine.description }, ...auditLogRef.current].slice(0, 50)
    setAuditLog(nextAudit)
    persistAll(members, catalogExtras, governance, next, nextAudit, snapshots)
    toast.success('Rotina criada.')
  }

  const toggleRoutine = (routineId) => {
    const next = routines.map((r) => (r.id === routineId ? { ...r, enabled: !r.enabled } : r))
    setRoutines(next)
    const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'routine.toggle', details: routineId }, ...auditLogRef.current].slice(0, 50)
    setAuditLog(nextAudit)
    persistAll(members, catalogExtras, governance, next, nextAudit, snapshots)
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (loadError || !payload) {
    return (
      <div className="space-y-4">
        <Link to="/dashboard/groups" className="inline-flex items-center gap-2 text-sm text-accent-400 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Voltar aos grupos
        </Link>
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-6 text-sm text-red-200/90">
          {loadError || 'Grupo não encontrado.'}
        </p>
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Tentar novamente
        </Button>
      </div>
    )
  }

  const { group, activity } = payload
  const monitoringActive = group.status === 'ativo' && group.monitoringEnabled
  const x1ControlsDisabled = !monitoringActive
  const inactiveCount = members.filter((m) => m.status === 'inativo').length
  const healthScore = Math.max(0, Math.min(100, Math.round(((members.length - inactiveCount) / Math.max(1, members.length)) * 100)))
  const alertList = [
    ...(inactiveCount > Math.max(3, members.length * 0.3) ? ['Alta taxa de inatividade no grupo'] : []),
    ...(governance.removeForeignNumbers ? ['Remoção de DDIs estrangeiros ativa'] : []),
    ...(governance.keywordRules.some((r) => r.action === 'remover') ? ['Há regras com remoção automática'] : []),
  ]

  return (
    <div className="space-y-6">
      <Link to="/dashboard/groups" className="inline-flex items-center gap-2 text-sm text-accent-400 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Voltar aos grupos
      </Link>

      <div className="flex flex-wrap items-start gap-4">
        <img src={group.image} alt="" className="h-16 w-16 rounded-2xl border border-brand-700" />
        <div>
          <h2 className="text-2xl font-bold text-stone-50">{group.name}</h2>
          <p className="text-sm text-stone-400">
            {group.memberCount} membros · Status: <Badge variant={group.status === 'ativo' ? 'success' : 'muted'}>{group.status}</Badge>
          </p>
        </div>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'visao' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <h3 className="font-semibold text-stone-50 mb-4">Informações</h3>
            <dl className="grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <dt className="text-stone-500">Mensagens / dia (média)</dt>
                <dd className="text-stone-50 font-medium">{group.messagesPerDay}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Membros ativos</dt>
                <dd className="text-stone-50 font-medium">{group.activeMembers}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Horário de pico</dt>
                <dd className="text-stone-50 font-medium">{group.peakHour}</dd>
              </div>
              <div>
                <dt className="text-stone-500">Última mensagem</dt>
                <dd className="text-stone-300">{group.lastMessage}</dd>
              </div>
            </dl>
          </Card>
          <Card>
            <h3 className="font-semibold text-stone-50 mb-4">Estatísticas rápidas</h3>
            <ul className="space-y-2 text-sm text-stone-400">
              <li>Engajamento estimado: {Math.round((group.activeMembers / group.memberCount) * 100)}%</li>
              <li>Volume moderado para automações de boas-vindas.</li>
              <li>
                Health score: <span className="text-accent-400 font-semibold">{healthScore}/100</span>
              </li>
            </ul>
            <div className="mt-4 space-y-1">
              {alertList.length === 0 ? (
                <p className="text-xs text-emerald-400">Sem alertas críticos no momento.</p>
              ) : (
                alertList.map((a) => (
                  <p key={a} className="text-xs text-amber-300">
                    • {a}
                  </p>
                ))
              )}
            </div>
          </Card>
          <Card className="lg:col-span-3">
            <h3 className="font-semibold text-stone-50 mb-4">Atividade (últimos dias)</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activity}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2d4a38" opacity={0.5} />
                  <XAxis dataKey="day" stroke="#a8a29e" fontSize={12} />
                  <YAxis stroke="#a8a29e" fontSize={12} />
                  <Tooltip contentStyle={{ background: '#0f1812', border: '1px solid #2d4a38', borderRadius: '12px' }} />
                  <Bar dataKey="msgs" fill="#eab308" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {tab === 'membros' && (
        <div className="space-y-4">
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-stone-200 font-heading">Tags do grupo</h3>
              <p className="text-xs text-stone-500">Crie tags aqui; depois atribua aos membros selecionados.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {tagCatalog.map((t) => (
                <Badge key={t} variant="default">
                  {displayTag(t)}
                </Badge>
              ))}
              {tagCatalog.length === 0 && <span className="text-xs text-stone-500">Nenhuma tag ainda.</span>}
            </div>
            <div className="flex flex-wrap items-end gap-2 pt-1">
              <div className="min-w-[200px] flex-1 max-w-md">
                <Input
                  placeholder="Nome da nova tag (ex: lead-quente)"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), createGroupTag())}
                />
              </div>
              <Button type="button" variant="secondary" className="gap-1 shrink-0" onClick={createGroupTag}>
                <Plus className="h-4 w-4" /> Criar tag
              </Button>
            </div>
          </Card>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'todos', label: 'Todos' },
                { id: 'ativos', label: 'Ativos' },
                { id: 'inativos', label: 'Inativos' },
                { id: 'admins', label: 'Admins' },
                { id: 'regras', label: 'Regras' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setMemberFilter(f.id)
                    setSelected(new Set())
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                    memberFilter === f.id
                      ? 'bg-accent-500/15 text-accent-400 border border-accent-500/30'
                      : 'text-stone-400 border border-transparent hover:bg-white/5'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {memberFilter !== 'regras' && (
              <div className="max-w-xs w-full">
                <Input placeholder="Buscar nome ou telefone" value={memberQ} onChange={(e) => setMemberQ(e.target.value)} />
              </div>
            )}
          </div>

          {memberFilter === 'regras' ? (
            <Card className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-200 font-heading">
                    <ListChecks className="h-4 w-4 text-accent-400" />
                    Inatividade automática
                  </h3>
                  <p className="mt-1 text-xs text-stone-500 max-w-xl">
                    Sem atividade por X horas → inativo. Qualquer mensagem no grupo → volta para ativo. Admins são ignorados.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={statusRulesSaving}
                  onClick={() => void saveStatusRules()}
                >
                  {statusRulesSaving ? 'Salvando…' : 'Salvar'}
                </Button>
              </div>

              <div className="rounded-xl border border-brand-700 bg-brand-900/50 p-4 space-y-4">
                <Toggle
                  checked={statusRules.enabled}
                  onChange={(v) => setStatusRules((prev) => ({ ...prev, enabled: v }))}
                  label={statusRules.enabled ? 'Regra ativa' : 'Regra desligada'}
                />

                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-28">
                    <Input
                      label="Horas sem atividade"
                      type="number"
                      min={1}
                      max={8760}
                      disabled={!statusRules.enabled}
                      value={statusRules.inactiveAfterHours}
                      onChange={(e) =>
                        setStatusRules((prev) => ({
                          ...prev,
                          inactiveAfterHours: Math.max(1, Math.min(8760, Number(e.target.value) || 1)),
                        }))
                      }
                    />
                  </div>
                  <p className="pb-2.5 text-xs text-stone-500">
                    {statusRules.inactiveAfterHours >= 24
                      ? `≈ ${(statusRules.inactiveAfterHours / 24).toFixed(1).replace(/\.0$/, '')} dia(s)`
                      : 'menos de 1 dia'}
                  </p>
                </div>

                <ul className="space-y-1 text-xs text-stone-400 list-disc pl-4">
                  <li>
                    Após <span className="text-stone-200">{statusRules.inactiveAfterHours}h</span> sem mensagem → status{' '}
                    <span className="text-stone-200">inativo</span>
                  </li>
                  <li>
                    Qualquer mensagem do membro no grupo → status <span className="text-stone-200">ativo</span>
                  </li>
                </ul>

                {statusRules.enabled && (
                  <p className="text-xs text-stone-500">
                    Prévia agora: {statusRulesPreviewCount} membro(s) ativo(s) elegível(is) para inativo.
                  </p>
                )}
              </div>
            </Card>
          ) : (
            <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-stone-500 mr-2">
              {selected.size === 0 ? 'Nenhum membro selecionado.' : `${selected.size} selecionado(s)`}
            </p>
            <Button size="sm" variant="secondary" className="gap-1" onClick={openAddModal}>
              <Tag className="h-3.5 w-3.5" /> Adicionar tag
            </Button>
            <Button size="sm" variant="outline" className="gap-1" onClick={openRemoveModal}>
              <UserMinus className="h-3.5 w-3.5" /> Remover tags
            </Button>
            <span className="mx-1 hidden text-stone-600 sm:inline">|</span>
            <Button size="sm" variant="secondary" className="gap-1" onClick={() => setBulkStatus('ativo')}>
              <UserCheck className="h-3.5 w-3.5" /> Marcar ativo
            </Button>
            <Button size="sm" variant="outline" className="gap-1" onClick={() => setBulkStatus('inativo')}>
              Marcar inativo
            </Button>
            <Button size="sm" variant="outline" onClick={executeMoveBulk} disabled title="Em breve">
              Mover de grupo
            </Button>
          </div>

          <Card padding={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-brand-800 text-left text-stone-400">
                    <th className="w-10 p-3">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAll}
                        className="rounded border-brand-600 text-accent-500 focus:ring-accent-500/30"
                        title="Selecionar todos (lista filtrada)"
                        aria-label="Selecionar todos visíveis"
                      />
                    </th>
                    <th className="p-4">Membro</th>
                    <th className="p-4">Telefone</th>
                    <th className="p-4 min-w-[120px]">Status</th>
                    <th className="p-4 hidden sm:table-cell">Última atividade</th>
                    <th className="p-4">Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {membersFiltered.map((m) => (
                    <tr key={m.id} className="border-b border-brand-800/80 hover:bg-white/[0.02]">
                      <td className="p-3 align-middle">
                        <input
                          type="checkbox"
                          checked={selected.has(m.id)}
                          onChange={() => toggleRow(m.id)}
                          className="rounded border-brand-600 text-accent-500 focus:ring-accent-500/30"
                          aria-label={`Selecionar ${m.name}`}
                        />
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <img src={avatar(m.name)} alt="" className="h-8 w-8 rounded-full" />
                          <span className="text-stone-50">{m.name}</span>
                          {m.role === 'admin' && <Badge variant="warning">admin</Badge>}
                        </div>
                      </td>
                      <td className="p-4 text-stone-400">{m.phone}</td>
                      <td className="p-4">
                        <select
                          value={m.status}
                          onChange={(e) => setMemberStatus(m.id, e.target.value)}
                          className="w-full max-w-[130px] rounded-lg border border-brand-700 bg-brand-900 px-2 py-1.5 text-xs text-stone-200 outline-none focus:border-accent-500/50"
                          aria-label={`Status de ${m.name}`}
                        >
                          <option value="ativo">Ativo</option>
                          <option value="inativo">Inativo</option>
                        </select>
                      </td>
                      <td className="p-4 hidden text-stone-500 text-xs sm:table-cell whitespace-nowrap">
                        {m.lastActivity ? formatActivity(m.lastActivity) : 'Sem msgs no período'}
                        <button
                          type="button"
                          onClick={() => openMemberTimeline(m)}
                          className="ml-2 text-accent-400 hover:underline"
                        >
                          histórico
                        </button>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-1.5">
                          {m.tags?.length ? (
                            m.tags.map((t) => {
                              const norm = normalizeTag(t)
                              return (
                                <span
                                  key={norm}
                                  className="inline-flex items-center gap-0.5 rounded-full border border-brand-600 bg-brand-800/80 pl-2.5 pr-1 py-0.5 text-xs text-stone-200"
                                >
                                  {displayTag(norm)}
                                  <button
                                    type="button"
                                    className="rounded p-0.5 text-stone-500 hover:bg-white/10 hover:text-accent-400"
                                    aria-label={`Remover tag ${displayTag(norm)}`}
                                    onClick={() => removeTagFromMember(m.id, norm)}
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </span>
                              )
                            })
                          ) : (
                            <span className="text-stone-600">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
            </>
          )}

          <Modal
            isOpen={addTagModal}
            onClose={() => setAddTagModal(false)}
            title="Adicionar tags aos selecionados"
            size="md"
            footer={
              <>
                <Button variant="ghost" onClick={() => setAddTagModal(false)}>
                  Cancelar
                </Button>
                <Button onClick={applyAddTags}>Aplicar</Button>
              </>
            }
          >
            <p className="text-sm text-stone-400 mb-4">
              {selected.size} membro(s) selecionado(s). Marque tags existentes ou digite uma nova abaixo.
            </p>
            <div className="mb-4">
              <Input
                label="Nova tag (opcional, aplicada junto com as marcadas)"
                placeholder="ex: lead-quente"
                value={inlineNewTag}
                onChange={(e) => setInlineNewTag(e.target.value)}
              />
            </div>
            <div className="max-h-52 space-y-2 overflow-y-auto rounded-xl border border-brand-800 p-3">
              {tagCatalog.length === 0 ? (
                <p className="text-sm text-stone-500">Nenhuma tag no catálogo ainda — use o campo acima ou &quot;Criar tag&quot; na página.</p>
              ) : (
                tagCatalog.map((t) => (
                  <label key={t} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5">
                    <input
                      type="checkbox"
                      checked={tagsToAdd.has(t)}
                      onChange={() =>
                        setTagsToAdd((prev) => {
                          const n = new Set(prev)
                          if (n.has(t)) n.delete(t)
                          else n.add(t)
                          return n
                        })
                      }
                      className="rounded border-brand-600 text-accent-500"
                    />
                    <span className="text-stone-200">{displayTag(t)}</span>
                  </label>
                ))
              )}
            </div>
          </Modal>

          <Modal
            isOpen={removeTagModal}
            onClose={() => setRemoveTagModal(false)}
            title="Remover tags dos selecionados"
            size="md"
            footer={
              <>
                <Button variant="ghost" onClick={() => setRemoveTagModal(false)}>
                  Cancelar
                </Button>
                <Button variant="danger" onClick={applyRemoveTags}>
                  Remover
                </Button>
              </>
            }
          >
            <p className="text-sm text-stone-400 mb-4">
              {selected.size} membro(s). A tag será removida apenas de quem a possuir.
            </p>
            <div className="max-h-52 space-y-2 overflow-y-auto rounded-xl border border-brand-800 p-3">
              {tagCatalog.length === 0 ? (
                <p className="text-sm text-stone-500">Não há tags para remover.</p>
              ) : (
                tagCatalog.map((t) => (
                  <label key={t} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5">
                    <input
                      type="checkbox"
                      checked={tagsToRemove.has(t)}
                      onChange={() =>
                        setTagsToRemove((prev) => {
                          const n = new Set(prev)
                          if (n.has(t)) n.delete(t)
                          else n.add(t)
                          return n
                        })
                      }
                      className="rounded border-brand-600 text-accent-500"
                    />
                    <span className="text-stone-200">{displayTag(t)}</span>
                  </label>
                ))
              )}
            </div>
          </Modal>

          <Modal
            isOpen={!!memberTimeline}
            onClose={() => {
              setMemberTimeline(null)
              setTimelineMemberId(null)
              setTimelineError(null)
              setTimelineLoading(false)
              setTimelineSyncing(false)
            }}
            title={memberTimeline ? `Timeline • ${memberTimeline.name}` : 'Timeline'}
            footer={
              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={timelineSyncing || timelineLoading}
                  onClick={syncMemberTimeline}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${timelineSyncing ? 'animate-spin' : ''}`} />
                  {timelineSyncing ? 'Sincronizando…' : 'Sincronizar'}
                </Button>
                <Button
                  onClick={() => {
                    setMemberTimeline(null)
                    setTimelineMemberId(null)
                    setTimelineError(null)
                  }}
                >
                  Fechar
                </Button>
              </div>
            }
          >
            {memberTimeline && (
              <div className="space-y-4 text-sm text-stone-300">
                <ul className="space-y-1.5 text-xs text-stone-400">
                  <li>
                    <span className="text-stone-500">Telefone:</span> {memberTimeline.phone || '—'}
                  </li>
                  <li>
                    <span className="text-stone-500">Registrado em:</span>{' '}
                    {formatActivity(memberTimeline.joinedAt)}
                  </li>
                  {memberTimeline.leftAt ? (
                    <li>
                      <span className="text-stone-500">Saiu em:</span> {formatActivity(memberTimeline.leftAt)}
                    </li>
                  ) : null}
                  <li>
                    <span className="text-stone-500">Última mensagem:</span>{' '}
                    {formatActivity(memberTimeline.lastActivity)}
                  </li>
                  <li>
                    <span className="text-stone-500">Status:</span> {memberTimeline.status}
                  </li>
                  <li>
                    <span className="text-stone-500">Tags:</span>{' '}
                    {(memberTimeline.tags || []).map(displayTag).join(', ') || 'sem tags'}
                  </li>
                  <li>
                    <span className="text-stone-500">Mensagens no período:</span>{' '}
                    {memberTimeline.messageCount ?? 0}
                    {memberTimeline.meta?.retentionDays
                      ? ` (últimos ~${memberTimeline.meta.retentionDays} dias / desde ativação)`
                      : ''}
                  </li>
                  {memberTimeline.meta?.messageSyncStatus ? (
                    <li>
                      <span className="text-stone-500">Sync do grupo:</span>{' '}
                      {memberTimeline.meta.messageSyncStatus}
                      {memberTimeline.meta.messagesSyncedCount != null
                        ? ` · ${memberTimeline.meta.messagesSyncedCount} msgs salvas`
                        : ''}
                    </li>
                  ) : null}
                </ul>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                      Atividade recente
                    </h4>
                    <button
                      type="button"
                      disabled={timelineLoading || timelineSyncing || !timelineMemberId}
                      onClick={() => {
                        const member = members.find((m) => m.id === timelineMemberId)
                        if (member) openMemberTimeline(member)
                      }}
                      className="text-[11px] text-accent-400 hover:underline disabled:opacity-40"
                    >
                      Atualizar
                    </button>
                  </div>
                  {timelineLoading ? (
                    <p className="text-xs text-stone-500">Carregando histórico…</p>
                  ) : timelineError ? (
                    <div className="space-y-2">
                      <p className="text-xs text-red-300">{timelineError}</p>
                      <p className="text-[11px] text-stone-500">
                        Use <strong className="text-stone-300">Sincronizar</strong> para importar mensagens deste grupo
                        e depois clique em Atualizar.
                      </p>
                    </div>
                  ) : !memberTimeline.events?.length ? (
                    <div className="space-y-2">
                      <p className="text-xs text-stone-500">
                        Nenhuma mensagem deste membro no período sincronizado.
                      </p>
                      <p className="text-[11px] text-stone-500">
                        Clique em <strong className="text-stone-300">Sincronizar</strong> para puxar o histórico do
                        WhatsApp. Novas mensagens após a sync também entram sozinhas.
                      </p>
                    </div>
                  ) : (
                    <ul className="max-h-72 space-y-2 overflow-y-auto vg-scrollbar pr-1">
                      {memberTimeline.events.map((ev, idx) => (
                        <li
                          key={`${ev.type}-${ev.at}-${ev.messageId || idx}`}
                          className="rounded-lg border border-brand-800/80 bg-brand-900/40 px-3 py-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="min-w-0 text-sm text-stone-200">
                              {ev.type === 'message' && (
                                <Badge variant="muted" className="mr-1.5 align-middle">
                                  msg
                                </Badge>
                              )}
                              {ev.type === 'joined' && (
                                <Badge variant="success" className="mr-1.5 align-middle">
                                  entrada
                                </Badge>
                              )}
                              {ev.type === 'left' && (
                                <Badge variant="warning" className="mr-1.5 align-middle">
                                  saída
                                </Badge>
                              )}
                              {ev.type === 'status' && (
                                <Badge variant="default" className="mr-1.5 align-middle">
                                  status
                                </Badge>
                              )}
                              {ev.label}
                            </p>
                            <span className="shrink-0 text-[11px] text-stone-500">{formatActivity(ev.at)}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </Modal>
        </div>
      )}

      {tab === 'governanca' && (
        <div className="space-y-6">
          <Card className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg text-stone-100 font-heading">Governança de grupo</h3>
              <Button variant="secondary" className="gap-2" onClick={saveGovernance}>
                <Save className="h-4 w-4" /> Salvar governança
              </Button>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="space-y-4">
                <h4 className="text-sm text-stone-200 font-semibold flex items-center gap-2">
                  <Users2 className="h-4 w-4 text-accent-400" /> Admins com função total
                </h4>
                <Toggle
                  checked={governance.adminsFullAccess}
                  onChange={(v) => setGovernance((prev) => ({ ...prev, adminsFullAccess: v }))}
                  label="Admins têm acesso total ao grupo (send, moderate, export, settings)"
                />
                <div className="flex flex-wrap gap-2">
                  {governance.admins.map((admin) => (
                    <span
                      key={admin}
                      className="inline-flex items-center gap-1 rounded-full border border-brand-600 bg-brand-800 px-3 py-1 text-xs text-stone-200"
                    >
                      {admin}
                      <button
                        type="button"
                        className="rounded p-0.5 text-stone-500 hover:bg-white/10 hover:text-red-300"
                        onClick={() => removeAdmin(admin)}
                        aria-label={`Remover admin ${admin}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex items-end gap-2">
                  <Input
                    label="Vincular novo admin (e-mail ou número)"
                    placeholder="ex: +55 (11) 99999-0000"
                    value={newAdmin}
                    onChange={(e) => setNewAdmin(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addAdmin())}
                  />
                  <Button variant="secondary" onClick={addAdmin}>
                    Adicionar
                  </Button>
                </div>
                <p className="text-xs text-stone-500">
                  Simplificado para seu modelo atual: admins vinculados controlam tudo neste grupo.
                </p>
              </Card>

              <Card className="space-y-4">
                <h4 className="text-sm text-stone-200 font-semibold flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-accent-400" /> Janela e mídia
                </h4>
                <Toggle
                  checked={governance.postingWindowEnabled}
                  onChange={(v) => setGovernance((prev) => ({ ...prev, postingWindowEnabled: v }))}
                  label="Ativar janela de postagem"
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label="Início"
                    type="time"
                    value={governance.postingStart}
                    onChange={(e) => setGovernance((prev) => ({ ...prev, postingStart: e.target.value }))}
                  />
                  <Input
                    label="Fim"
                    type="time"
                    value={governance.postingEnd}
                    onChange={(e) => setGovernance((prev) => ({ ...prev, postingEnd: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(governance.mediaPolicies).map(([k, v]) => (
                    <Toggle
                      key={k}
                      checked={v}
                      onChange={(val) =>
                        setGovernance((prev) => ({
                          ...prev,
                          mediaPolicies: { ...prev.mediaPolicies, [k]: val },
                        }))
                      }
                      label={`Permitir ${k}`}
                    />
                  ))}
                </div>
              </Card>
            </div>
          </Card>

          <Card className="space-y-4">
            <h4 className="text-sm text-stone-200 font-semibold flex items-center gap-2">
              <Shield className="h-4 w-4 text-accent-400" /> Moderação e segurança
            </h4>
            <div className="grid md:grid-cols-2 gap-4">
              <Input
                label="Anti-flood (msg por minuto)"
                type="number"
                value={governance.antiFloodPerMinute}
                onChange={(e) => setGovernance((prev) => ({ ...prev, antiFloodPerMinute: Number(e.target.value) || 1 }))}
              />
              <Input
                label="DDIs bloqueados (separados por vírgula)"
                value={governance.blockedDdis.join(', ')}
                onChange={(e) =>
                  setGovernance((prev) => ({
                    ...prev,
                    blockedDdis: e.target.value.split(',').map((x) => x.trim()).filter(Boolean),
                  }))
                }
              />
            </div>
            <Toggle
              checked={governance.removeForeignNumbers}
              onChange={(v) => setGovernance((prev) => ({ ...prev, removeForeignNumbers: v }))}
              label="Remover números estrangeiros automaticamente"
            />
            <div className="grid md:grid-cols-2 gap-4">
              <Textarea
                label="Whitelist (números ou IDs, um por linha)"
                rows={4}
                value={governance.whitelist}
                onChange={(e) => setGovernance((prev) => ({ ...prev, whitelist: e.target.value }))}
              />
              <Textarea
                label="Blacklist (números ou IDs, um por linha)"
                rows={4}
                value={governance.blacklist}
                onChange={(e) => setGovernance((prev) => ({ ...prev, blacklist: e.target.value }))}
              />
            </div>
          </Card>

          <Card className="space-y-4">
            <h4 className="text-sm text-stone-200 font-semibold">Regras por palavra-chave</h4>
            <div className="space-y-2">
              {governance.keywordRules.map((rule) => (
                <div key={rule.id} className="grid grid-cols-12 gap-2 items-end border border-brand-700 rounded-lg p-2">
                  <div className="col-span-6">
                    <Input
                      label="Palavra-chave"
                      value={rule.keyword}
                      onChange={(e) => updateKeywordRule(rule.id, 'keyword', e.target.value)}
                    />
                  </div>
                  <div className="col-span-4">
                    <Select
                      label="Ação"
                      value={rule.action}
                      onChange={(e) => updateKeywordRule(rule.id, 'action', e.target.value)}
                    >
                      <option value="avisar">Avisar</option>
                      <option value="deletar">Deletar mensagem</option>
                      <option value="silenciar">Silenciar membro</option>
                      <option value="remover">Remover membro</option>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Button variant="danger" className="w-full" onClick={() => removeKeywordRule(rule.id)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <Button variant="secondary" onClick={addKeywordRule} className="gap-2">
              <Plus className="h-4 w-4" /> Adicionar regra
            </Button>
          </Card>

          <Card className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm text-stone-200 font-semibold flex items-center gap-2">
                <BellRing className="h-4 w-4 text-accent-400" /> Rotinas agendadas
              </h4>
              <Button variant="secondary" onClick={() => setRoutineModal(true)}>
                Nova rotina
              </Button>
            </div>
            <ul className="space-y-2">
              {routines.map((r) => (
                <li key={r.id} className="border border-brand-700 rounded-lg p-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-stone-200 capitalize">{r.type}</p>
                    <p className="text-xs text-stone-500">{r.description}</p>
                  </div>
                  <Toggle checked={r.enabled} onChange={() => toggleRoutine(r.id)} />
                </li>
              ))}
            </ul>
          </Card>

          <Card className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm text-stone-200 font-semibold">Snapshots e rollback</h4>
              <Button variant="secondary" className="gap-2" onClick={createSnapshot}>
                <Save className="h-4 w-4" /> Criar snapshot
              </Button>
            </div>
            <ul className="space-y-2">
              {snapshots.length === 0 && <li className="text-xs text-stone-500">Nenhum snapshot salvo.</li>}
              {snapshots.map((s) => (
                <li key={s.id} className="border border-brand-700 rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-stone-200">{s.title}</p>
                    <p className="text-xs text-stone-500">{formatActivity(s.at)}</p>
                  </div>
                  <Button variant="outline" className="gap-2" onClick={() => rollbackSnapshot(s.id)}>
                    <RotateCcw className="h-4 w-4" /> Rollback
                  </Button>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <h4 className="text-sm text-stone-200 font-semibold mb-3">Audit log (últimas 50 ações)</h4>
            <ul className="space-y-2 max-h-72 overflow-y-auto">
              {auditLog.length === 0 && <li className="text-xs text-stone-500">Sem eventos ainda.</li>}
              {auditLog.map((ev) => (
                <li key={ev.id} className="text-xs text-stone-400 border-b border-brand-800 pb-2">
                  <span className="text-stone-500">{formatActivity(ev.at)}</span> — <span className="text-accent-400">{ev.action}</span> — {ev.details}
                </li>
              ))}
            </ul>
          </Card>

          <Modal
            isOpen={routineModal}
            onClose={() => setRoutineModal(false)}
            title="Nova rotina agendada"
            footer={
              <>
                <Button variant="ghost" onClick={() => setRoutineModal(false)}>Cancelar</Button>
                <Button onClick={addRoutine}>Criar</Button>
              </>
            }
          >
            <Select
              label="Tipo"
              value={newRoutine.type}
              onChange={(e) => setNewRoutine((prev) => ({ ...prev, type: e.target.value }))}
            >
              <option value="privacidade">Privacidade (abre/fecha)</option>
              <option value="mensagem-fixada">Mensagem fixada</option>
              <option value="limpeza">Limpeza de mensagens</option>
              <option value="alerta">Alerta operacional</option>
            </Select>
            <Textarea
              label="Descrição / cron"
              rows={3}
              value={newRoutine.description}
              onChange={(e) => setNewRoutine((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Ex: 22:00 fechar, 08:00 abrir (America/Sao_Paulo)"
            />
          </Modal>
        </div>
      )}

      {tab === 'config' && (
        <div className="max-w-4xl space-y-6">
          {!monitoringActive && (
            <Card className="border-amber-700/60 bg-amber-950/20">
              <div className="flex gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-200">Monitoramento inativo</p>
                  <p className="text-xs text-amber-200/80 mt-1">
                    A automação de entrada e saída está desligada. Marque o grupo como ativo na lista de grupos para
                    habilitar os disparos X1.
                  </p>
                </div>
              </div>
            </Card>
          )}

          <Card className={`relative z-10 space-y-5 ${x1ControlsDisabled ? 'opacity-90' : ''}`}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-stone-50 font-semibold font-heading">Automação de entrada e saída (X1)</h3>
                <p className="text-xs text-stone-500">
                  Disparo automático no X1 quando entra/sai do grupo, com limite e janela de envio.
                  {!monitoringActive && ' Desligada enquanto o grupo não estiver ativo.'}
                </p>
              </div>
              <Toggle
                checked={monitoringActive && x1Automation.enabled}
                disabled={x1ControlsDisabled}
                onChange={(v) => setX1Automation((s) => ({ ...s, enabled: v }))}
                label="Ativar"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Toggle
                checked={monitoringActive && x1Automation.sendX1OnJoin}
                disabled={x1ControlsDisabled}
                onChange={(v) => setX1Automation((s) => ({ ...s, sendX1OnJoin: v }))}
                label="Enviar X1 na entrada"
              />
              <Toggle
                checked={monitoringActive && x1Automation.sendX1OnLeave}
                disabled={x1ControlsDisabled}
                onChange={(v) => setX1Automation((s) => ({ ...s, sendX1OnLeave: v }))}
                label="Enviar X1 na saída"
              />
            </div>

            <div className="space-y-4 rounded-xl border border-emerald-900/50 bg-emerald-950/10 p-4">
              <p className="text-sm font-semibold text-emerald-300">Mensagem de entrada</p>
              <Textarea
                label="Texto enviado no privado quando alguém entra"
                rows={3}
                value={x1Automation.join?.template || ''}
                onChange={(e) => patchX1Kind(setX1Automation, 'join', { template: e.target.value })}
                placeholder="Mensagem enviada no privado quando alguém entra no grupo"
              />
              <div className="grid gap-4 md:grid-cols-3">
                <Input
                  label="Delay mínimo (seg)"
                  type="number"
                  value={x1Automation.join?.minDelaySec ?? 0}
                  onChange={(e) => patchX1Kind(setX1Automation, 'join', { minDelaySec: Number(e.target.value) || 0 })}
                />
                <Input
                  label="Delay máximo (seg)"
                  type="number"
                  value={x1Automation.join?.maxDelaySec ?? 0}
                  onChange={(e) => patchX1Kind(setX1Automation, 'join', { maxDelaySec: Number(e.target.value) || 0 })}
                />
                <Input
                  label="Limite por usuário / 24h"
                  type="number"
                  value={x1Automation.join?.maxX1PerUser24h ?? 1}
                  onChange={(e) =>
                    patchX1Kind(setX1Automation, 'join', { maxX1PerUser24h: Number(e.target.value) || 1 })
                  }
                />
              </div>
              <Toggle
                checked={x1Automation.join?.quietHoursEnabled !== false}
                onChange={(v) => patchX1Kind(setX1Automation, 'join', { quietHoursEnabled: v })}
                label="Respeitar horário de silêncio (entrada)"
              />
              {x1Automation.join?.quietHoursEnabled !== false && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Input
                    label="Início silêncio"
                    type="time"
                    value={x1Automation.join?.quietHoursStart || '22:00'}
                    onChange={(e) => patchX1Kind(setX1Automation, 'join', { quietHoursStart: e.target.value })}
                  />
                  <Input
                    label="Fim silêncio"
                    type="time"
                    value={x1Automation.join?.quietHoursEnd || '08:00'}
                    onChange={(e) => patchX1Kind(setX1Automation, 'join', { quietHoursEnd: e.target.value })}
                  />
                </div>
              )}
            </div>

            <div className="space-y-4 rounded-xl border border-amber-900/40 bg-amber-950/10 p-4">
              <p className="text-sm font-semibold text-amber-200">Mensagem de saída</p>
              <Textarea
                label="Texto enviado no privado quando alguém sai"
                rows={3}
                value={x1Automation.leave?.template || ''}
                onChange={(e) => patchX1Kind(setX1Automation, 'leave', { template: e.target.value })}
                placeholder="Mensagem enviada no privado quando alguém sai do grupo"
              />
              <div className="grid gap-4 md:grid-cols-3">
                <Input
                  label="Delay mínimo (seg)"
                  type="number"
                  value={x1Automation.leave?.minDelaySec ?? 0}
                  onChange={(e) => patchX1Kind(setX1Automation, 'leave', { minDelaySec: Number(e.target.value) || 0 })}
                />
                <Input
                  label="Delay máximo (seg)"
                  type="number"
                  value={x1Automation.leave?.maxDelaySec ?? 0}
                  onChange={(e) => patchX1Kind(setX1Automation, 'leave', { maxDelaySec: Number(e.target.value) || 0 })}
                />
                <Input
                  label="Limite por usuário / 24h"
                  type="number"
                  value={x1Automation.leave?.maxX1PerUser24h ?? 1}
                  onChange={(e) =>
                    patchX1Kind(setX1Automation, 'leave', { maxX1PerUser24h: Number(e.target.value) || 1 })
                  }
                />
              </div>
              <Toggle
                checked={x1Automation.leave?.quietHoursEnabled !== false}
                onChange={(v) => patchX1Kind(setX1Automation, 'leave', { quietHoursEnabled: v })}
                label="Respeitar horário de silêncio (saída)"
              />
              {x1Automation.leave?.quietHoursEnabled !== false && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Input
                    label="Início silêncio"
                    type="time"
                    value={x1Automation.leave?.quietHoursStart || '22:00'}
                    onChange={(e) => patchX1Kind(setX1Automation, 'leave', { quietHoursStart: e.target.value })}
                  />
                  <Input
                    label="Fim silêncio"
                    type="time"
                    value={x1Automation.leave?.quietHoursEnd || '08:00'}
                    onChange={(e) => patchX1Kind(setX1Automation, 'leave', { quietHoursEnd: e.target.value })}
                  />
                </div>
              )}
            </div>

            <div className="relative z-10 border-t border-brand-800 pt-5 space-y-4">
              <p className="text-sm text-stone-300 font-medium">Testar envio real no privado</p>
              <Select
                label="Membro de teste"
                placement="top"
                value={testParticipantJid}
                onChange={(e) => setTestParticipantJid(e.target.value)}
              >
                <option value="">Selecione um membro</option>
                {members
                  .filter((m) => m.status !== 'saiu')
                  .map((m) => (
                    <option key={m.id || m.participantJid} value={m.participantJid || m.id}>
                      {m.name || m.phone || m.participantJid || m.id}
                    </option>
                  ))}
              </Select>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={saveX1Automation}>
                  Salvar automação X1
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  disabled={!testParticipantJid || x1Testing === 'join'}
                  onClick={() => testX1Event('join')}
                >
                  <Send className="h-4 w-4" />
                  {x1Testing === 'join' ? 'Enviando…' : 'Testar entrada'}
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  disabled={!testParticipantJid || x1Testing === 'leave'}
                  onClick={() => testX1Event('leave')}
                >
                  <Send className="h-4 w-4" />
                  {x1Testing === 'leave' ? 'Enviando…' : 'Testar saída'}
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm text-stone-200 font-semibold">Histórico de envios X1</h4>
              <Button variant="ghost" className="text-xs" onClick={() => refreshX1Deliveries()}>
                Atualizar
              </Button>
            </div>
            {x1DeliveriesLoading && <p className="text-xs text-stone-500">Carregando…</p>}
            {!x1DeliveriesLoading && x1Deliveries.length === 0 && (
              <p className="text-xs text-stone-500">Nenhum envio X1 registrado ainda.</p>
            )}
            <ul className="space-y-2 max-h-80 overflow-y-auto">
              {x1Deliveries.map((d) => (
                <li key={d.id} className="text-xs border border-brand-800 rounded-lg p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-accent-400 font-medium">{d.kind}</span>
                    <span className="text-stone-500">·</span>
                    <span className={d.status === 'sent' ? 'text-emerald-400' : d.status === 'failed' ? 'text-red-400' : 'text-stone-400'}>
                      {d.status}
                    </span>
                    <span className="text-stone-500">· {d.source}</span>
                  </div>
                  <p className="text-stone-300 mt-1">{d.participantName || d.participantJid}</p>
                  {d.bodyPreview && <p className="text-stone-500 mt-1 truncate">{d.bodyPreview}</p>}
                  {d.error && <p className="text-red-400/90 mt-1">{d.error}</p>}
                  <p className="text-stone-600 mt-1">{formatActivity(d.sentAt || d.createdAt)}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  )
}
