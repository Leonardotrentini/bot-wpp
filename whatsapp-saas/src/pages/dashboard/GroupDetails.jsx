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
  Clock,
  UserCheck,
  Shield,
  BellRing,
  Save,
  RotateCcw,
  CalendarClock,
  Users2,
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
import { getGroupDetails } from '../../services/api.js'
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

const defaultStatusRules = () => ({
  inactiveAfterDays: 3,
  autoCheckEnabled: false,
})

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

const defaultX1Automation = () => ({
  enabled: true,
  sendX1OnJoin: true,
  sendX1OnLeave: true,
  joinTemplate: 'Olá {{nome}}, seja bem-vindo(a)! Me chama no X1 para receber o guia rápido.',
  leaveTemplate: 'Percebi que você saiu do grupo. Posso te ajudar por aqui no X1?',
  minDelaySec: 15,
  maxDelaySec: 75,
  maxX1PerUser24h: 2,
  quietHoursEnabled: true,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
})

function daysSince(iso) {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 0
  return (Date.now() - t) / (1000 * 60 * 60 * 24)
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
  const [routineModal, setRoutineModal] = useState(false)
  const [newRoutine, setNewRoutine] = useState({ type: 'privacidade', description: '' })
  const [newTagName, setNewTagName] = useState('')
  const [tagsToAdd, setTagsToAdd] = useState(() => new Set())
  const [tagsToRemove, setTagsToRemove] = useState(() => new Set())
  const [inlineNewTag, setInlineNewTag] = useState('')
  const [statusRules, setStatusRules] = useState(() => defaultStatusRules())
  const [playbookName, setPlaybookName] = useState('Onboarding D0-D7')
  const [newAdmin, setNewAdmin] = useState('')
  const [x1Automation, setX1Automation] = useState(() => defaultX1Automation())
  const catalogExtrasRef = useRef([])
  const statusRulesRef = useRef(defaultStatusRules())
  const governanceRef = useRef(defaultGovernance())
  const routinesRef = useRef(defaultRoutines())
  const auditLogRef = useRef(defaultAudit())
  const snapshotsRef = useRef(defaultSnapshots())
  const x1AutomationRef = useRef(defaultX1Automation())
  const toast = useToast()

  useEffect(() => {
    catalogExtrasRef.current = catalogExtras
  }, [catalogExtras])

  useEffect(() => {
    statusRulesRef.current = statusRules
  }, [statusRules])

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
    x1AutomationRef.current = x1Automation
  }, [x1Automation])

  const persistAll = useCallback(
    (nextMembers, nextExtras, nextRules, nextGovernance, nextRoutines, nextAudit, nextSnapshots, nextX1Automation) => {
      try {
        const ext = nextExtras !== undefined ? nextExtras : catalogExtrasRef.current
        const rules = nextRules !== undefined ? nextRules : statusRulesRef.current
        const gov = nextGovernance !== undefined ? nextGovernance : governanceRef.current
        const rts = nextRoutines !== undefined ? nextRoutines : routinesRef.current
        const aud = nextAudit !== undefined ? nextAudit : auditLogRef.current
        const snp = nextSnapshots !== undefined ? nextSnapshots : snapshotsRef.current
        const x1 = nextX1Automation !== undefined ? nextX1Automation : x1AutomationRef.current
        localStorage.setItem(
          membersStorageKey(id),
          JSON.stringify({
            v: 5,
            members: nextMembers,
            catalogExtras: ext,
            statusRules: rules,
            governance: gov,
            routines: rts,
            auditLog: aud,
            snapshots: snp,
            x1Automation: x1,
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
    getGroupDetails(id)
      .then((res) => {
        if (ok) {
          setPayload(res.data)
          if (res.data.settings) setSettings({ ...res.data.settings })
        }
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
      lastActivity: m.lastActivity || new Date().toISOString(),
      persona: m.persona || 'cliente',
    }))
    let initial = base
    let extras = []
    let rules = defaultStatusRules()
    let gov = defaultGovernance()
    let rts = defaultRoutines()
    let aud = defaultAudit()
    let snp = defaultSnapshots()
    let x1 = defaultX1Automation()
    try {
      const raw = localStorage.getItem(membersStorageKey(id))
      if (raw) {
        const saved = JSON.parse(raw)
        if ((saved?.v === 5 || saved?.v === 4 || saved?.v === 3 || saved?.v === 2) && Array.isArray(saved.members)) {
          const byId = new Map(saved.members.map((x) => [x.id, x]))
          initial = base.map((m) => {
            if (!byId.has(m.id)) return m
            const s = byId.get(m.id)
            return {
              ...m,
              ...s,
              tags: [...(s.tags || [])],
              lastActivity: s.lastActivity || m.lastActivity,
              persona: s.persona || m.persona,
              status: s.status === 'inativo' || s.status === 'ativo' ? s.status : m.status,
            }
          })
          if (Array.isArray(saved.catalogExtras)) extras = saved.catalogExtras.map(normalizeTag).filter(Boolean)
          if ((saved.v === 3 || saved.v === 4) && saved.statusRules && typeof saved.statusRules === 'object') {
            rules = { ...defaultStatusRules(), ...saved.statusRules }
          }
          if ((saved.v === 4 || saved.v === 5) && saved.governance && typeof saved.governance === 'object') {
            gov = { ...defaultGovernance(), ...saved.governance }
          }
          if ((saved.v === 4 || saved.v === 5) && Array.isArray(saved.routines)) rts = saved.routines
          if ((saved.v === 4 || saved.v === 5) && Array.isArray(saved.auditLog)) aud = saved.auditLog
          if ((saved.v === 4 || saved.v === 5) && Array.isArray(saved.snapshots)) snp = saved.snapshots
          if (saved.v === 5 && saved.x1Automation && typeof saved.x1Automation === 'object') {
            x1 = { ...defaultX1Automation(), ...saved.x1Automation }
          }
        } else if (Array.isArray(saved) && saved.length) {
          const byId = new Map(saved.map((x) => [x.id, x]))
          initial = base.map((m) => (byId.has(m.id) ? { ...m, ...byId.get(m.id), tags: [...(byId.get(m.id).tags || [])] } : m))
        }
      }
    } catch {
      /* use API */
    }
    setMembers(initial)
    setSelected(new Set())
    setCatalogExtras(extras)
    setStatusRules(rules)
    setGovernance(gov)
    setRoutines(rts)
    setAuditLog(aud)
    setSnapshots(snp)
    setX1Automation(x1)
  }, [payload, id])

  const tagCatalog = useMemo(() => {
    const s = new Set(catalogExtras.map(normalizeTag).filter(Boolean))
    members.forEach((m) => (m.tags || []).forEach((t) => s.add(normalizeTag(t))))
    return [...s].sort()
  }, [members, catalogExtras])

  const membersFiltered = useMemo(() => {
    return members.filter((m) => {
      if (memberFilter === 'ativos' && m.status !== 'ativo') return false
      if (memberFilter === 'inativos' && m.status !== 'inativo') return false
      if (memberFilter === 'admins' && m.role !== 'admin') return false
      if (memberQ && !m.name.toLowerCase().includes(memberQ.toLowerCase()) && !m.phone.includes(memberQ)) return false
      return true
    })
  }, [members, memberFilter, memberQ])

  const tabs = useMemo(
    () => [
      { id: 'visao', label: 'Visão geral' },
      { id: 'membros', label: 'Membros' },
      { id: 'governanca', label: 'Governança' },
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
    persistAll(members, nextExtras, statusRules, governance, routines, nextAudit.slice(0, 50), snapshots)
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
      persistAll(next, nextExtras, statusRules, governance, routines, nextAudit, snapshots)
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
      persistAll(next, catalogExtras, statusRules, governance, routines, nextAudit, snapshots)
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
      persistAll(next, catalogExtras, statusRules, governance, routines, nextAudit, snapshots)
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

  const setMemberStatus = (memberId, nextStatus) => {
    if (nextStatus !== 'ativo' && nextStatus !== 'inativo') return
    const cur = members.find((x) => x.id === memberId)
    if (cur?.status === nextStatus) return
    setMembers((prev) => {
      const next = prev.map((m) => (m.id === memberId ? { ...m, status: nextStatus } : m))
      const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'member.status', details: `${memberId} -> ${nextStatus}` }, ...auditLogRef.current].slice(0, 50)
      setAuditLog(nextAudit)
      persistAll(next, catalogExtras, statusRules, governance, routines, nextAudit, snapshots)
      return next
    })
    toast.success('Status atualizado.')
  }

  const setBulkStatus = (nextStatus) => {
    if (nextStatus !== 'ativo' && nextStatus !== 'inativo') return
    if (selected.size === 0) {
      toast.error('Selecione ao menos um membro.')
      return
    }
    setMembers((prev) => {
      const next = prev.map((m) => (selected.has(m.id) ? { ...m, status: nextStatus } : m))
      const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'member.status_bulk', details: `${selected.size} -> ${nextStatus}` }, ...auditLogRef.current].slice(0, 50)
      setAuditLog(nextAudit)
      persistAll(next, catalogExtras, statusRules, governance, routines, nextAudit, snapshots)
      return next
    })
    toast.success(`Status "${nextStatus}" aplicado a ${selected.size} membro(s).`)
  }

  const applyInactivityRule = () => {
    const days = Math.max(1, Math.min(365, Number(statusRules.inactiveAfterDays) || 3))
    const nextRules = { ...statusRules, inactiveAfterDays: days }
    let changed = 0
    const next = members.map((m) => {
      if (m.status === 'ativo' && daysSince(m.lastActivity) > days) {
        changed += 1
        return { ...m, status: 'inativo' }
      }
      return m
    })
    setStatusRules(nextRules)
    setMembers(next)
    const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'rule.inactivity_apply', details: `dias=${days}; alterados=${changed}` }, ...auditLogRef.current].slice(0, 50)
    setAuditLog(nextAudit)
    persistAll(next, catalogExtras, nextRules, governance, routines, nextAudit, snapshots)
    if (changed === 0) {
      toast.info('Nenhum membro ativo ultrapassou o limite de dias sem atividade (campo lastActivity).')
    } else {
      toast.success(`${changed} membro(s) marcado(s) como inativo por inatividade (> ${days} dia(s)).`)
    }
  }

  const executeBulkAction = (action) => {
    if (selected.size === 0) {
      toast.error('Selecione membros para executar ação em massa.')
      return
    }
    const msg =
      action === 'move'
        ? `${selected.size} membro(s) movidos para "Comunidade VIP" (simulado).`
        : `${selected.size} membro(s) adicionados ao playbook "${playbookName}" (simulado).`
    toast.success(msg)
    const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: `bulk.${action}`, details: msg }, ...auditLogRef.current].slice(0, 50)
    setAuditLog(nextAudit)
    persistAll(members, catalogExtras, statusRules, governance, routines, nextAudit, snapshots)
  }

  const createSnapshot = () => {
    const snap = {
      id: crypto.randomUUID(),
      at: nowIso(),
      title: `Snapshot ${new Date().toLocaleTimeString('pt-BR')}`,
      governance,
      settings,
      statusRules,
      routines,
      x1Automation,
    }
    const next = [snap, ...snapshots].slice(0, 20)
    setSnapshots(next)
    const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'snapshot.create', details: snap.title }, ...auditLogRef.current].slice(0, 50)
    setAuditLog(nextAudit)
    persistAll(members, catalogExtras, statusRules, governance, routines, nextAudit, next, x1Automation)
    toast.success('Snapshot de regras salvo.')
  }

  const rollbackSnapshot = (snapId) => {
    const snap = snapshots.find((s) => s.id === snapId)
    if (!snap) return
    setGovernance(snap.governance)
    setSettings(snap.settings)
    setStatusRules(snap.statusRules)
    setRoutines(snap.routines)
    setX1Automation(snap.x1Automation || defaultX1Automation())
    const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'snapshot.rollback', details: snap.title }, ...auditLogRef.current].slice(0, 50)
    setAuditLog(nextAudit)
    persistAll(
      members,
      catalogExtras,
      snap.statusRules,
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
    persistAll(members, catalogExtras, statusRules, governance, routines, nextAudit, snapshots)
    toast.success('Governança salva.')
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
    persistAll(members, catalogExtras, statusRules, nextGovernance, routines, nextAudit, snapshots, x1Automation)
  }

  const removeAdmin = (value) => {
    const nextGovernance = { ...governance, admins: governance.admins.filter((x) => x !== value) }
    setGovernance(nextGovernance)
    const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'admin.remove', details: value }, ...auditLogRef.current].slice(0, 50)
    setAuditLog(nextAudit)
    persistAll(members, catalogExtras, statusRules, nextGovernance, routines, nextAudit, snapshots, x1Automation)
  }

  const saveX1Automation = () => {
    const safe = {
      ...x1Automation,
      minDelaySec: Math.max(0, Number(x1Automation.minDelaySec) || 0),
      maxDelaySec: Math.max(0, Number(x1Automation.maxDelaySec) || 0),
      maxX1PerUser24h: Math.max(1, Number(x1Automation.maxX1PerUser24h) || 1),
    }
    if (safe.maxDelaySec < safe.minDelaySec) safe.maxDelaySec = safe.minDelaySec
    setX1Automation(safe)
    const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'x1.settings_save', details: 'Automação de entrada/saída atualizada' }, ...auditLogRef.current].slice(0, 50)
    setAuditLog(nextAudit)
    persistAll(members, catalogExtras, statusRules, governance, routines, nextAudit, snapshots, safe)
    toast.success('Automação X1 salva.')
  }

  const simulateX1Event = (kind) => {
    const message =
      kind === 'join'
        ? `Disparo X1 (entrada): ${x1Automation.joinTemplate.slice(0, 80)}...`
        : `Disparo X1 (saída): ${x1Automation.leaveTemplate.slice(0, 80)}...`
    toast.success(message)
    const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: `x1.simulate_${kind}`, details: message }, ...auditLogRef.current].slice(0, 50)
    setAuditLog(nextAudit)
    persistAll(members, catalogExtras, statusRules, governance, routines, nextAudit, snapshots, x1Automation)
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
    persistAll(members, catalogExtras, statusRules, governance, next, nextAudit, snapshots)
    toast.success('Rotina criada.')
  }

  const toggleRoutine = (routineId) => {
    const next = routines.map((r) => (r.id === routineId ? { ...r, enabled: !r.enabled } : r))
    setRoutines(next)
    const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'routine.toggle', details: routineId }, ...auditLogRef.current].slice(0, 50)
    setAuditLog(nextAudit)
    persistAll(members, catalogExtras, statusRules, governance, next, nextAudit, snapshots)
  }

  if (loading || !payload) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  const { group, activity } = payload
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

          <Card className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-accent-500/15 p-2 text-accent-400">
                <Clock className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-stone-100 font-heading">Regra: inatividade no grupo</h3>
                  <p className="mt-1 text-xs text-stone-500 leading-relaxed">
                    Compara a data de <strong className="text-stone-400">última atividade</strong> (mock) com hoje. Membros
                    <strong className="text-stone-400"> ativos</strong> com mais de N dias sem atividade passam a{' '}
                    <strong className="text-stone-400">inativo</strong>. Não reativa automaticamente quem já estava inativo.
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-28">
                    <Input
                      label="Dias sem atividade"
                      type="number"
                      min={1}
                      max={365}
                      value={statusRules.inactiveAfterDays}
                      onChange={(e) =>
                        setStatusRules((r) => ({
                          ...r,
                          inactiveAfterDays: Math.max(1, Math.min(365, Number(e.target.value) || 1)),
                        }))
                      }
                    />
                  </div>
                  <Button type="button" variant="secondary" onClick={applyInactivityRule}>
                    Aplicar regra agora
                  </Button>
                </div>
                <Toggle
                  checked={statusRules.autoCheckEnabled}
                  onChange={(v) => {
                    const n = { ...statusRules, autoCheckEnabled: v }
                    setStatusRules(n)
                    persistAll(members, catalogExtras, n, governance, routines, auditLog, snapshots, x1Automation)
                  }}
                  label="Preferir checagem automática diária (requer backend / cron)"
                />
                <p className="text-xs text-stone-600">
                  Em produção: job agendado lê último &quot;visto&quot; ou última mensagem no grupo via API do WhatsApp e aplica a mesma lógica.
                </p>
              </div>
            </div>
          </Card>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {['todos', 'ativos', 'inativos', 'admins'].map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setMemberFilter(f)
                    setSelected(new Set())
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize ${
                    memberFilter === f ? 'bg-accent-500/15 text-accent-400 border border-accent-500/30' : 'text-stone-400 border border-transparent hover:bg-white/5'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="max-w-xs w-full">
              <Input placeholder="Buscar nome ou telefone" value={memberQ} onChange={(e) => setMemberQ(e.target.value)} />
            </div>
          </div>

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
            <Select
              className="max-w-[180px]"
              value={playbookName}
              onChange={(e) => setPlaybookName(e.target.value)}
            >
              <option>Onboarding D0-D7</option>
              <option>Reativação 7 dias</option>
              <option>Oferta atacado 48h</option>
            </Select>
            <Button size="sm" variant="secondary" onClick={() => executeBulkAction('playbook')}>
              Aplicar playbook
            </Button>
            <Button size="sm" variant="outline" onClick={() => executeBulkAction('move')}>
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
                          {daysSince(m.lastActivity) > statusRules.inactiveAfterDays && m.status === 'ativo' && (
                            <Badge variant="warning">risco churn</Badge>
                          )}
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
                        {formatActivity(m.lastActivity)}
                        <button
                          type="button"
                          onClick={() =>
                            setMemberTimeline({
                              ...m,
                              joinedAt: m.joinedAt || new Date(Date.now() - 1000 * 60 * 60 * 24 * 12).toISOString(),
                            })
                          }
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
            onClose={() => setMemberTimeline(null)}
            title={memberTimeline ? `Timeline • ${memberTimeline.name}` : 'Timeline'}
            footer={<Button onClick={() => setMemberTimeline(null)}>Fechar</Button>}
          >
            {memberTimeline && (
              <ul className="space-y-2 text-sm text-stone-300">
                <li>Entrou no grupo em: {formatActivity(memberTimeline.joinedAt)}</li>
                <li>Última atividade: {formatActivity(memberTimeline.lastActivity)}</li>
                <li>Status atual: {memberTimeline.status}</li>
                <li>Tags: {(memberTimeline.tags || []).map(displayTag).join(', ') || 'sem tags'}</li>
                <li>Ações recentes: abertura de mensagem, reação e participação em tópico (mock).</li>
              </ul>
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
          <Card className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-stone-50">Mensagem de boas-vindas</p>
                <p className="text-xs text-stone-500">Enviada quando alguém entra no grupo</p>
              </div>
              <Toggle checked={settings.welcomeEnabled} onChange={(v) => setSettings((s) => ({ ...s, welcomeEnabled: v }))} />
            </div>
            {settings.welcomeEnabled && (
              <Textarea rows={4} value={settings.welcomeMessage} onChange={(e) => setSettings((s) => ({ ...s, welcomeMessage: e.target.value }))} />
            )}
            <div className="flex items-center justify-between gap-4 border-t border-brand-800 pt-6">
              <div>
                <p className="font-medium text-stone-50">Auto-moderação</p>
                <p className="text-xs text-stone-500">Filtros automáticos básicos</p>
              </div>
              <Toggle checked={settings.autoModEnabled} onChange={(v) => setSettings((s) => ({ ...s, autoModEnabled: v }))} />
            </div>
            <Textarea
              label="Palavras proibidas (uma por linha ou separadas por espaço)"
              value={settings.bannedWords}
              onChange={(e) => setSettings((s) => ({ ...s, bannedWords: e.target.value }))}
            />
            <Input
              label="Limite de mensagens por usuário (por hora)"
              type="number"
              value={settings.messageLimitPerUser}
              onChange={(e) => setSettings((s) => ({ ...s, messageLimitPerUser: Number(e.target.value) }))}
            />
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-medium text-stone-50">Permitir mídias</p>
                <p className="text-xs text-stone-500">Imagens, áudios e vídeos</p>
              </div>
              <Toggle checked={settings.allowMedia} onChange={(v) => setSettings((s) => ({ ...s, allowMedia: v }))} />
            </div>
            <Button
              onClick={() => {
                const nextAudit = [{ id: crypto.randomUUID(), at: nowIso(), action: 'group.settings_save', details: 'Configurações básicas salvas' }, ...auditLogRef.current].slice(0, 50)
                setAuditLog(nextAudit)
                persistAll(members, catalogExtras, statusRules, governance, routines, nextAudit, snapshots, x1Automation)
                toast.success('Configurações básicas salvas.')
              }}
            >
              Salvar configurações básicas
            </Button>
          </Card>

          <Card className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-stone-50 font-semibold font-heading">Automação de entrada e saída (X1)</h3>
                <p className="text-xs text-stone-500">
                  Disparo automático no X1 quando entra/sai do grupo, com limite e janela de envio.
                </p>
              </div>
              <Toggle
                checked={x1Automation.enabled}
                onChange={(v) => setX1Automation((s) => ({ ...s, enabled: v }))}
                label="Ativar"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Toggle
                checked={x1Automation.sendX1OnJoin}
                onChange={(v) => setX1Automation((s) => ({ ...s, sendX1OnJoin: v }))}
                label="Enviar X1 na entrada"
              />
              <Toggle
                checked={x1Automation.sendX1OnLeave}
                onChange={(v) => setX1Automation((s) => ({ ...s, sendX1OnLeave: v }))}
                label="Enviar X1 na saída"
              />
            </div>

            <Textarea
              label="Template X1 de entrada"
              rows={3}
              value={x1Automation.joinTemplate}
              onChange={(e) => setX1Automation((s) => ({ ...s, joinTemplate: e.target.value }))}
            />
            <Textarea
              label="Template X1 de saída"
              rows={3}
              value={x1Automation.leaveTemplate}
              onChange={(e) => setX1Automation((s) => ({ ...s, leaveTemplate: e.target.value }))}
            />

            <div className="grid gap-4 md:grid-cols-3">
              <Input
                label="Delay mínimo (seg)"
                type="number"
                value={x1Automation.minDelaySec}
                onChange={(e) => setX1Automation((s) => ({ ...s, minDelaySec: Number(e.target.value) || 0 }))}
              />
              <Input
                label="Delay máximo (seg)"
                type="number"
                value={x1Automation.maxDelaySec}
                onChange={(e) => setX1Automation((s) => ({ ...s, maxDelaySec: Number(e.target.value) || 0 }))}
              />
              <Input
                label="Limite X1 por usuário / 24h"
                type="number"
                value={x1Automation.maxX1PerUser24h}
                onChange={(e) => setX1Automation((s) => ({ ...s, maxX1PerUser24h: Number(e.target.value) || 1 }))}
              />
            </div>

            <Toggle
              checked={x1Automation.quietHoursEnabled}
              onChange={(v) => setX1Automation((s) => ({ ...s, quietHoursEnabled: v }))}
              label="Respeitar horário de silêncio"
            />
            {x1Automation.quietHoursEnabled && (
              <div className="grid gap-4 md:grid-cols-2">
                <Input
                  label="Início silêncio"
                  type="time"
                  value={x1Automation.quietHoursStart}
                  onChange={(e) => setX1Automation((s) => ({ ...s, quietHoursStart: e.target.value }))}
                />
                <Input
                  label="Fim silêncio"
                  type="time"
                  value={x1Automation.quietHoursEnd}
                  onChange={(e) => setX1Automation((s) => ({ ...s, quietHoursEnd: e.target.value }))}
                />
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={saveX1Automation}>
                Salvar automação X1
              </Button>
              <Button variant="outline" onClick={() => simulateX1Event('join')}>
                Simular entrada
              </Button>
              <Button variant="outline" onClick={() => simulateX1Event('leave')}>
                Simular saída
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
