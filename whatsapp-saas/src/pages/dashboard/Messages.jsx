import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Film,
  Image as ImageIcon,
  FileText,
  Pencil,
  Plus,
  Send,
  Trash2,
  X,
  Clock,
  PauseCircle,
  PlayCircle,
  Zap,
  Search,
  Copy,
  CheckCheck,
  AlertTriangle,
  Layers,
  ListChecks,
} from 'lucide-react'
import { Tabs } from '../../components/common/Tabs.jsx'
import { Card } from '../../components/common/Card.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Textarea } from '../../components/common/Textarea.jsx'
import { Select } from '../../components/common/Select.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { Modal, ConfirmModal } from '../../components/common/Modal.jsx'
import {
  getGroups,
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getAutomations,
  createAutomation,
  putAutomation,
  updateAutomation,
  deleteAutomation,
  getMessageHistory,
  getSendJob,
  getCadences,
  createCadence,
  renameCadence,
  deleteCadence,
  setCadenceAutomations,
  setCadenceStatus,
} from '../../services/api.js'
import { useToast } from '../../contexts/ToastContext.jsx'

const IMAGE_MAX = 5 * 1024 * 1024
const VIDEO_MAX = 16 * 1024 * 1024
const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
const HIST_PAGE_SIZE = 20

function fileKind(file) {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  return 'file'
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function emptyTemplateForm() {
  return { id: null, name: '', body: '', mediaType: 'none', mediaBase64: null, mediaMime: null, mediaName: null }
}

function emptyAutomationForm() {
  return {
    name: '',
    source: 'template',
    templateId: '',
    body: '',
    groupIds: [],
    frequency: 'now',
    scheduledAt: '',
    timeOfDay: '09:00',
    weekday: 1,
  }
}

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sp = new Date(d.getTime() - 3 * 3600 * 1000)
  return sp.toISOString().slice(0, 16)
}

function frequencyLabel(a) {
  if (a.frequency === 'now') return 'Envio imediato'
  if (a.frequency === 'once') return `Uma vez • ${fmtDate(a.scheduledAt)}`
  if (a.frequency === 'daily') return `Diariamente • ${a.timeOfDay}`
  if (a.frequency === 'weekly') return `Toda ${WEEKDAYS[a.weekday ?? 0]} • ${a.timeOfDay}`
  return a.frequency
}

function statusBadge(status) {
  if (status === 'lido') return { variant: 'success', label: 'lido' }
  if (status === 'entregue') return { variant: 'success', label: 'entregue' }
  if (status === 'falhou') return { variant: 'warning', label: 'falhou' }
  return { variant: 'muted', label: status || 'enviado' }
}

function PreviewBubble({ content }) {
  const hasMedia = content.mediaType === 'image' || content.mediaType === 'video'
  if (!hasMedia && !content.body?.trim()) {
    return <p className="text-sm text-stone-500">A prévia da mensagem aparece aqui.</p>
  }
  return (
    <div className="max-w-xs rounded-2xl rounded-tl-sm bg-[#075E54]/30 border border-[#128C7E]/30 p-2.5">
      {content.mediaType === 'image' && content.mediaBase64 && (
        <img src={content.mediaBase64} alt="" className="mb-2 max-h-44 w-full rounded-lg object-cover" />
      )}
      {content.mediaType === 'video' && content.mediaBase64 && (
        <video src={content.mediaBase64} controls className="mb-2 max-h-44 w-full rounded-lg" />
      )}
      {content.body?.trim() ? (
        <p className="whitespace-pre-wrap text-sm text-stone-100">{content.body}</p>
      ) : (
        <p className="text-xs italic text-stone-400">(sem legenda)</p>
      )}
    </div>
  )
}

export function Messages({ defaultTab = 'criar' }) {
  const toast = useToast()
  const [tab, setTab] = useState(defaultTab)
  const [groups, setGroups] = useState([])
  const [templates, setTemplates] = useState([])
  const [automations, setAutomations] = useState([])
  const [history, setHistory] = useState([])
  const [histTotal, setHistTotal] = useState(0)
  const [histOffset, setHistOffset] = useState(0)
  const [histFilter, setHistFilter] = useState({ status: '', group: '' })
  const [loadingInit, setLoadingInit] = useState(true)

  const [tplModal, setTplModal] = useState(false)
  const [tplForm, setTplForm] = useState(emptyTemplateForm)
  const [tplSaving, setTplSaving] = useState(false)
  const [confirmTpl, setConfirmTpl] = useState(null)
  const [tplSearch, setTplSearch] = useState('')
  const [tplTypeFilter, setTplTypeFilter] = useState('all')

  const [autoForm, setAutoForm] = useState(emptyAutomationForm)
  const [autoSaving, setAutoSaving] = useState(false)
  const [editingAutoId, setEditingAutoId] = useState(null)
  const [confirmAuto, setConfirmAuto] = useState(null)
  const [groupSearch, setGroupSearch] = useState('')
  const [sendConfirm, setSendConfirm] = useState(false)

  const [sendJobId, setSendJobId] = useState(null)
  const [sendJob, setSendJob] = useState(null)
  const formRef = useRef(null)

  const [cadences, setCadences] = useState([])
  const [cadenceModal, setCadenceModal] = useState(false)
  const [cadenceForm, setCadenceForm] = useState({ id: null, name: '' })
  const [confirmCad, setConfirmCad] = useState(null)
  const [manageCad, setManageCad] = useState(null)
  const [manageSel, setManageSel] = useState([])

  const refreshTemplates = useCallback(() => getTemplates().then((r) => setTemplates(r.data.templates || [])), [])
  const refreshAutomations = useCallback(() => getAutomations().then((r) => setAutomations(r.data.automations || [])), [])
  const refreshCadences = useCallback(() => getCadences().then((r) => setCadences(r.data.cadences || [])), [])

  const refreshHistory = useCallback(
    (offset = 0) => {
      const params = { limit: HIST_PAGE_SIZE, offset }
      if (histFilter.status) params.status = histFilter.status
      if (histFilter.group) params.group = histFilter.group
      return getMessageHistory(params).then((r) => {
        setHistory(r.data.items || [])
        setHistTotal(r.data.total || 0)
        setHistOffset(offset)
      })
    },
    [histFilter],
  )

  useEffect(() => {
    setTab(defaultTab)
  }, [defaultTab])

  useEffect(() => {
    Promise.all([
      getGroups().then((r) => setGroups((r.data.groups || []).filter((g) => g.status === 'ativo'))),
      refreshTemplates(),
      refreshAutomations(),
      refreshCadences(),
      refreshHistory(0),
    ]).finally(() => setLoadingInit(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    refreshHistory(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [histFilter])

  // Polling do job de envio
  useEffect(() => {
    if (!sendJobId) return undefined
    let active = true
    const tick = async () => {
      try {
        const r = await getSendJob(sendJobId)
        if (!active) return
        setSendJob(r.data.job)
        if (r.data.job.status !== 'running') {
          active = false
          clearInterval(iv)
          if (r.data.job.status === 'done') {
            if (r.data.job.failed > 0) toast.error(`Envio concluído: ${r.data.job.sent} ok, ${r.data.job.failed} falha(s).`)
            else toast.success(`Mensagem enviada para ${r.data.job.sent} grupo(s).`)
          } else {
            toast.error('Falha no envio.')
          }
          refreshHistory(0)
          refreshAutomations()
          setTimeout(() => {
            setSendJobId(null)
            setSendJob(null)
          }, 5000)
        }
      } catch {
        /* ignore polling errors */
      }
    }
    const iv = setInterval(tick, 1500)
    tick()
    return () => {
      active = false
      clearInterval(iv)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendJobId])

  // ---------- Criar mensagem (biblioteca) ----------
  function openNewTemplate() {
    setTplForm(emptyTemplateForm())
    setTplModal(true)
  }

  function openEditTemplate(t) {
    setTplForm({
      id: t.id,
      name: t.name,
      body: t.body || '',
      mediaType: t.mediaType || 'none',
      mediaBase64: t.mediaBase64 || null,
      mediaMime: t.mediaMime || null,
      mediaName: t.mediaName || null,
    })
    setTplModal(true)
  }

  async function onPickMedia(ev) {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file) return
    const kind = fileKind(file)
    if (kind === 'file') {
      toast.error('Tipo não suportado. Use imagem ou vídeo.')
      return
    }
    const max = kind === 'video' ? VIDEO_MAX : IMAGE_MAX
    if (file.size > max) {
      toast.error(`Arquivo grande demais. Limite: ${kind === 'video' ? '16MB' : '5MB'}.`)
      return
    }
    const dataUrl = await readFileAsDataUrl(file)
    setTplForm((f) => ({ ...f, mediaType: kind, mediaBase64: dataUrl, mediaMime: file.type, mediaName: file.name }))
  }

  function clearMedia() {
    setTplForm((f) => ({ ...f, mediaType: 'none', mediaBase64: null, mediaMime: null, mediaName: null }))
  }

  async function saveTemplate() {
    if (!tplForm.name.trim()) return toast.error('Dê um nome para a mensagem.')
    if (tplForm.mediaType === 'none' && !tplForm.body.trim()) return toast.error('Escreva um texto ou anexe uma mídia.')
    setTplSaving(true)
    try {
      const payload = {
        name: tplForm.name.trim(),
        body: tplForm.body,
        mediaType: tplForm.mediaType,
        mediaBase64: tplForm.mediaBase64,
        mediaMime: tplForm.mediaMime,
        mediaName: tplForm.mediaName,
      }
      if (tplForm.id) await updateTemplate(tplForm.id, payload)
      else await createTemplate(payload)
      toast.success('Mensagem salva.')
      setTplModal(false)
      refreshTemplates()
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao salvar a mensagem.')
    } finally {
      setTplSaving(false)
    }
  }

  async function duplicateTemplate(t) {
    try {
      await createTemplate({
        name: `${t.name} (cópia)`,
        body: t.body,
        mediaType: t.mediaType,
        mediaBase64: t.mediaBase64,
        mediaMime: t.mediaMime,
        mediaName: t.mediaName,
      })
      toast.success('Mensagem duplicada.')
      refreshTemplates()
    } catch {
      toast.error('Falha ao duplicar.')
    }
  }

  async function removeTemplate() {
    if (!confirmTpl) return
    try {
      await deleteTemplate(confirmTpl)
      toast.success('Mensagem removida.')
      refreshTemplates()
    } catch {
      toast.error('Falha ao remover.')
    } finally {
      setConfirmTpl(null)
    }
  }

  const filteredTemplates = templates.filter((t) => {
    if (tplTypeFilter !== 'all') {
      if (tplTypeFilter === 'text' && t.mediaType !== 'none') return false
      if (tplTypeFilter !== 'text' && t.mediaType !== tplTypeFilter) return false
    }
    if (tplSearch.trim()) {
      const q = tplSearch.toLowerCase()
      return t.name.toLowerCase().includes(q) || (t.body || '').toLowerCase().includes(q)
    }
    return true
  })

  // ---------- Automações ----------
  function currentAutoContent() {
    if (autoForm.source === 'template') {
      const t = templates.find((x) => x.id === autoForm.templateId)
      if (!t) return { body: '', mediaType: 'none', mediaBase64: null }
      return { body: t.body, mediaType: t.mediaType, mediaBase64: t.mediaBase64 }
    }
    return { body: autoForm.body, mediaType: 'none', mediaBase64: null }
  }

  const filteredGroups = groups.filter((g) => (groupSearch.trim() ? g.name.toLowerCase().includes(groupSearch.toLowerCase()) : true))

  function toggleAutoGroup(id) {
    setAutoForm((f) => ({
      ...f,
      groupIds: f.groupIds.includes(id) ? f.groupIds.filter((x) => x !== id) : [...f.groupIds, id],
    }))
  }

  function selectAllGroups() {
    setAutoForm((f) => ({ ...f, groupIds: [...new Set([...f.groupIds, ...filteredGroups.map((g) => g.id)])] }))
  }

  function clearGroups() {
    setAutoForm((f) => ({ ...f, groupIds: [] }))
  }

  function resetAutoForm() {
    setAutoForm(emptyAutomationForm())
    setEditingAutoId(null)
    setGroupSearch('')
  }

  function openEditAuto(a) {
    setEditingAutoId(a.id)
    setAutoForm({
      name: a.name,
      source: a.templateId ? 'template' : 'inline',
      templateId: a.templateId || '',
      body: a.body || '',
      groupIds: a.groupJids || [],
      frequency: a.frequency === 'now' ? 'once' : a.frequency,
      scheduledAt: toLocalInput(a.scheduledAt),
      timeOfDay: a.timeOfDay || '09:00',
      weekday: a.weekday ?? 1,
    })
    if (tab !== 'automacoes') setTab('automacoes')
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function validateAutoForm() {
    const f = autoForm
    if (!f.name.trim()) return 'Dê um nome para a automação.'
    if (!f.groupIds.length) return 'Selecione ao menos um grupo.'
    if (f.source === 'template' && !f.templateId) return 'Selecione uma mensagem da biblioteca.'
    if (f.source === 'inline' && !f.body.trim()) return 'Escreva o texto da mensagem.'
    if (f.frequency === 'once' && !f.scheduledAt) return 'Informe a data e hora do agendamento.'
    return null
  }

  function buildAutoPayload() {
    const f = autoForm
    const payload = { name: f.name.trim(), groupIds: f.groupIds, frequency: f.frequency }
    if (f.source === 'template') payload.templateId = f.templateId
    else payload.body = f.body
    if (f.frequency === 'once') payload.scheduledAt = f.scheduledAt
    if (f.frequency === 'daily' || f.frequency === 'weekly') payload.timeOfDay = f.timeOfDay
    if (f.frequency === 'weekly') payload.weekday = Number(f.weekday)
    return payload
  }

  function onSubmitAuto() {
    const err = validateAutoForm()
    if (err) return toast.error(err)
    if (autoForm.frequency === 'now') {
      setSendConfirm(true)
      return
    }
    saveScheduledAutomation()
  }

  async function saveScheduledAutomation() {
    setAutoSaving(true)
    try {
      const payload = buildAutoPayload()
      if (editingAutoId) {
        await putAutomation(editingAutoId, payload)
        toast.success('Automação atualizada.')
      } else {
        await createAutomation(payload)
        toast.success('Automação criada e agendada.')
      }
      resetAutoForm()
      refreshAutomations()
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao salvar a automação.')
    } finally {
      setAutoSaving(false)
    }
  }

  async function confirmSendNow() {
    setSendConfirm(false)
    setAutoSaving(true)
    try {
      const res = await createAutomation(buildAutoPayload())
      const jobId = res?.data?.job?.id
      resetAutoForm()
      if (jobId) {
        setSendJob(res.data.job)
        setSendJobId(jobId)
      } else {
        toast.success('Envio iniciado.')
        refreshHistory(0)
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao enviar.')
    } finally {
      setAutoSaving(false)
    }
  }

  async function toggleAutomation(a) {
    const next = a.status === 'pausada' ? 'ativa' : 'pausada'
    try {
      await updateAutomation(a.id, { status: next })
      refreshAutomations()
    } catch {
      toast.error('Falha ao atualizar automação.')
    }
  }

  async function removeAutomation() {
    if (!confirmAuto) return
    try {
      await deleteAutomation(confirmAuto)
      toast.success('Automação removida.')
      if (editingAutoId === confirmAuto) resetAutoForm()
      refreshAutomations()
    } catch {
      toast.error('Falha ao remover.')
    } finally {
      setConfirmAuto(null)
    }
  }

  // ---------- Cadências ----------
  function openNewCadence() {
    setCadenceForm({ id: null, name: '' })
    setCadenceModal(true)
  }

  function openRenameCadence(c) {
    setCadenceForm({ id: c.id, name: c.name })
    setCadenceModal(true)
  }

  async function saveCadence() {
    if (!cadenceForm.name.trim()) return toast.error('Dê um nome para a cadência.')
    try {
      if (cadenceForm.id) await renameCadence(cadenceForm.id, cadenceForm.name.trim())
      else await createCadence(cadenceForm.name.trim())
      toast.success('Cadência salva.')
      setCadenceModal(false)
      refreshCadences()
    } catch {
      toast.error('Falha ao salvar a cadência.')
    }
  }

  async function removeCadence() {
    if (!confirmCad) return
    try {
      await deleteCadence(confirmCad)
      toast.success('Cadência removida.')
      refreshCadences()
      refreshAutomations()
    } catch {
      toast.error('Falha ao remover.')
    } finally {
      setConfirmCad(null)
    }
  }

  function openManage(c) {
    setManageCad(c)
    setManageSel(automations.filter((a) => a.cadenceId === c.id).map((a) => a.id))
  }

  function toggleManage(id) {
    setManageSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  async function saveManage() {
    if (!manageCad) return
    try {
      const res = await setCadenceAutomations(manageCad.id, manageSel)
      setAutomations(res.data.automations || [])
      toast.success('Automações da cadência atualizadas.')
      setManageCad(null)
    } catch {
      toast.error('Falha ao atualizar.')
    }
  }

  async function cadenceBulkStatus(c, status) {
    try {
      const res = await setCadenceStatus(c.id, status)
      setAutomations(res.data.automations || [])
      toast.success(status === 'ativa' ? 'Automações ativadas.' : 'Automações pausadas.')
    } catch {
      toast.error('Falha ao atualizar a cadência.')
    }
  }

  const activeCount = automations.filter((a) => a.status === 'ativa').length
  const orphanAutomations = automations.filter((a) => !a.cadenceId)
  const previewContent = currentAutoContent()
  const histPages = Math.ceil(histTotal / HIST_PAGE_SIZE) || 1
  const histPage = Math.floor(histOffset / HIST_PAGE_SIZE) + 1

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-stone-50">Mensagens</h2>
          <p className="text-sm text-stone-400 mt-1">Crie mensagens reutilizáveis e dispare em grupos com horário e frequência.</p>
        </div>
        <div className="flex gap-2 text-xs">
          <span className="rounded-lg border border-brand-800 px-3 py-1.5 text-stone-300">{templates.length} mensagens</span>
          <span className="rounded-lg border border-brand-800 px-3 py-1.5 text-stone-300">{activeCount} automações ativas</span>
        </div>
      </div>

      <Tabs
        tabs={[
          { id: 'criar', label: 'Criar mensagem' },
          { id: 'automacoes', label: 'Automações' },
          { id: 'cadencia', label: 'Cadência' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* Barra de progresso de envio */}
      {sendJob && (
        <Card className="border-accent-500/30">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-stone-100 inline-flex items-center gap-2">
              <Send className="h-4 w-4 text-accent-400" />
              {sendJob.label || 'Enviando'} — {sendJob.done}/{sendJob.total} grupos
              {sendJob.failed > 0 && <span className="text-red-300">({sendJob.failed} falha)</span>}
            </p>
            <Badge variant={sendJob.status === 'running' ? 'warning' : sendJob.status === 'done' ? 'success' : 'muted'}>
              {sendJob.status === 'running' ? 'enviando…' : sendJob.status === 'done' ? 'concluído' : 'erro'}
            </Badge>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-brand-800">
            <div
              className="h-full rounded-full bg-accent-500 transition-all"
              style={{ width: `${sendJob.total ? Math.round((sendJob.done / sendJob.total) * 100) : 0}%` }}
            />
          </div>
        </Card>
      )}

      {tab === 'criar' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
                <Input className="pl-9" placeholder="Buscar mensagem" value={tplSearch} onChange={(e) => setTplSearch(e.target.value)} />
              </div>
              <Select value={tplTypeFilter} onChange={(e) => setTplTypeFilter(e.target.value)} className="w-auto">
                <option value="all">Todos os tipos</option>
                <option value="text">Texto</option>
                <option value="image">Imagem</option>
                <option value="video">Vídeo</option>
              </Select>
            </div>
            <Button className="gap-2" onClick={openNewTemplate}>
              <Plus className="h-4 w-4" /> Nova mensagem
            </Button>
          </div>

          {loadingInit ? (
            <div className="grid gap-4 md:grid-cols-2">
              {[0, 1].map((i) => (
                <Card key={i} className="animate-pulse">
                  <div className="h-4 w-1/3 rounded bg-brand-800" />
                  <div className="mt-3 h-20 w-full rounded bg-brand-800/60" />
                </Card>
              ))}
            </div>
          ) : filteredTemplates.length === 0 ? (
            <Card>
              <p className="text-sm text-stone-400">
                {templates.length === 0 ? 'Nenhuma mensagem ainda. Clique em "Nova mensagem" para criar a primeira.' : 'Nenhuma mensagem encontrada com esse filtro.'}
              </p>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {filteredTemplates.map((t) => (
                <Card key={t.id} className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {t.mediaType === 'image' ? (
                        <ImageIcon className="h-4 w-4 shrink-0 text-accent-400" />
                      ) : t.mediaType === 'video' ? (
                        <Film className="h-4 w-4 shrink-0 text-accent-400" />
                      ) : (
                        <FileText className="h-4 w-4 shrink-0 text-accent-400" />
                      )}
                      <h3 className="truncate font-semibold text-stone-50">{t.name}</h3>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button type="button" className="p-1.5 rounded-lg text-stone-400 hover:bg-white/5 hover:text-stone-50" aria-label="Editar" title="Editar" onClick={() => openEditTemplate(t)}>
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" className="p-1.5 rounded-lg text-stone-400 hover:bg-white/5 hover:text-stone-50" aria-label="Duplicar" title="Duplicar" onClick={() => duplicateTemplate(t)}>
                        <Copy className="h-4 w-4" />
                      </button>
                      <button type="button" className="p-1.5 rounded-lg text-stone-400 hover:bg-red-500/10 hover:text-red-300" aria-label="Excluir" title="Excluir" onClick={() => setConfirmTpl(t.id)}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {t.mediaType === 'image' && t.mediaBase64 && <img src={t.mediaBase64} alt="" className="h-28 w-full rounded-lg object-cover border border-brand-800" />}
                  {t.mediaType === 'video' && t.mediaBase64 && <video src={t.mediaBase64} controls className="h-28 w-full rounded-lg border border-brand-800" />}
                  {t.body && <p className="text-sm text-stone-400 whitespace-pre-wrap line-clamp-4">{t.body}</p>}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'automacoes' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div ref={formRef}>
          <Card className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-stone-50">{editingAutoId ? 'Editar automação' : 'Nova automação'}</h3>
              {editingAutoId && (
                <button type="button" className="text-xs text-stone-400 hover:underline" onClick={resetAutoForm}>
                  Cancelar edição
                </button>
              )}
            </div>

            <Input label="Nome" value={autoForm.name} onChange={(e) => setAutoForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex: Lembrete da live" />

            <Select label="Mensagem" value={autoForm.source} onChange={(e) => setAutoForm((f) => ({ ...f, source: e.target.value }))}>
              <option value="template">Selecionar da biblioteca</option>
              <option value="inline">Escrever texto rápido</option>
            </Select>

            {autoForm.source === 'template' ? (
              templates.length === 0 ? (
                <p className="rounded-lg border border-brand-800 px-3 py-2 text-xs text-stone-400">Você ainda não tem mensagens. Crie uma na aba "Criar mensagem".</p>
              ) : (
                <Select label="Escolha a mensagem" value={autoForm.templateId} onChange={(e) => setAutoForm((f) => ({ ...f, templateId: e.target.value }))}>
                  <option value="">— selecione —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} {t.mediaType !== 'none' ? `(${t.mediaType})` : ''}
                    </option>
                  ))}
                </Select>
              )
            ) : (
              <Textarea label="Texto" rows={4} value={autoForm.body} onChange={(e) => setAutoForm((f) => ({ ...f, body: e.target.value }))} placeholder="Olá, comunidade! ..." />
            )}

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-stone-300">Grupos alvo ({autoForm.groupIds.length} selecionados)</p>
                <div className="flex gap-2 text-xs">
                  <button type="button" className="text-accent-400 hover:underline" onClick={selectAllGroups}>Selecionar todos</button>
                  <button type="button" className="text-stone-400 hover:underline" onClick={clearGroups}>Limpar</button>
                </div>
              </div>
              {groups.length > 6 && (
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
                  <Input className="pl-9" placeholder="Buscar grupo" value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)} />
                </div>
              )}
              <div className="max-h-40 space-y-2 overflow-y-auto rounded-xl border border-brand-800 p-2">
                {groups.length === 0 && <p className="px-1 py-1 text-xs text-stone-400">Nenhum grupo ativo. Vá em Grupos e marque como ativo.</p>}
                {filteredGroups.map((g) => (
                  <label key={g.id} className="flex cursor-pointer items-center gap-2 text-sm text-stone-300">
                    <input type="checkbox" checked={autoForm.groupIds.includes(g.id)} onChange={() => toggleAutoGroup(g.id)} className="rounded border-brand-600 text-accent-500 focus:ring-accent-500/30" />
                    {g.name}
                  </label>
                ))}
              </div>
            </div>

            <Select label="Quando disparar" value={autoForm.frequency} onChange={(e) => setAutoForm((f) => ({ ...f, frequency: e.target.value }))}>
              {!editingAutoId && <option value="now">Enviar agora</option>}
              <option value="once">Agendar (uma vez)</option>
              <option value="daily">Diariamente</option>
              <option value="weekly">Semanalmente</option>
            </Select>

            {autoForm.frequency === 'once' && (
              <Input label="Data e hora" type="datetime-local" value={autoForm.scheduledAt} onChange={(e) => setAutoForm((f) => ({ ...f, scheduledAt: e.target.value }))} />
            )}
            {autoForm.frequency === 'daily' && (
              <Input label="Horário (todo dia)" type="time" value={autoForm.timeOfDay} onChange={(e) => setAutoForm((f) => ({ ...f, timeOfDay: e.target.value }))} />
            )}
            {autoForm.frequency === 'weekly' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Dia da semana" value={autoForm.weekday} onChange={(e) => setAutoForm((f) => ({ ...f, weekday: e.target.value }))}>
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i}>{d}</option>
                  ))}
                </Select>
                <Input label="Horário" type="time" value={autoForm.timeOfDay} onChange={(e) => setAutoForm((f) => ({ ...f, timeOfDay: e.target.value }))} />
              </div>
            )}

            <div>
              <p className="mb-1 text-xs font-medium text-stone-400">Prévia</p>
              <PreviewBubble content={previewContent} />
            </div>

            <Button className="gap-2" onClick={onSubmitAuto} disabled={autoSaving}>
              {autoForm.frequency === 'now' ? <Send className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
              {autoSaving ? 'Processando…' : editingAutoId ? 'Salvar alterações' : autoForm.frequency === 'now' ? 'Enviar agora' : 'Salvar automação'}
            </Button>
            {autoForm.frequency !== 'now' && <p className="text-xs text-stone-500">Horário no fuso de São Paulo (UTC-3).</p>}
          </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <h3 className="mb-3 font-semibold text-stone-50">Automações salvas</h3>
              {loadingInit ? (
                <div className="space-y-2">
                  {[0, 1].map((i) => (
                    <div key={i} className="h-16 animate-pulse rounded-xl bg-brand-800/50" />
                  ))}
                </div>
              ) : automations.length === 0 ? (
                <p className="text-sm text-stone-400">Nenhuma automação ainda.</p>
              ) : (
                <div className="space-y-3">
                  {automations.map((a) => (
                    <div key={a.id} className="rounded-xl border border-brand-800 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex gap-2 min-w-0">
                          <div className="h-fit rounded-lg bg-accent-500/15 p-1.5 text-accent-400">
                            <Zap className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-stone-50">{a.name}</p>
                            <p className="mt-0.5 text-xs text-stone-500">{frequencyLabel(a)}</p>
                            <p className="text-xs text-stone-500">{a.groupNames?.length || 0} grupo(s)</p>
                            {a.body && <p className="mt-0.5 truncate text-xs text-stone-400">“{a.body}”</p>}
                            {a.nextRunAt && a.status === 'ativa' && <p className="mt-0.5 text-xs text-accent-400/80">Próximo: {fmtDate(a.nextRunAt)}</p>}
                          </div>
                        </div>
                        <Badge variant={a.status === 'ativa' ? 'success' : a.status === 'concluida' ? 'default' : 'muted'}>{a.status}</Badge>
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        {a.frequency !== 'now' && a.status !== 'concluida' && (
                          <>
                            <button type="button" onClick={() => openEditAuto(a)} className="inline-flex items-center gap-1 text-xs text-accent-400 hover:underline">
                              <Pencil className="h-3.5 w-3.5" /> Editar
                            </button>
                            <button type="button" onClick={() => toggleAutomation(a)} className="inline-flex items-center gap-1 text-xs text-stone-300 hover:underline">
                              {a.status === 'pausada' ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
                              {a.status === 'pausada' ? 'Retomar' : 'Pausar'}
                            </button>
                          </>
                        )}
                        <button type="button" onClick={() => setConfirmAuto(a.id)} className="inline-flex items-center gap-1 text-xs text-red-300 hover:underline">
                          <Trash2 className="h-3.5 w-3.5" /> Excluir
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-stone-50">Histórico de envios</h3>
                <div className="flex gap-2">
                  <Input className="h-9 w-32 text-sm" placeholder="Grupo" value={histFilter.group} onChange={(e) => setHistFilter((f) => ({ ...f, group: e.target.value }))} />
                  <Select className="h-9 w-auto text-sm" value={histFilter.status} onChange={(e) => setHistFilter((f) => ({ ...f, status: e.target.value }))}>
                    <option value="">Todos</option>
                    <option value="enviado">Enviado</option>
                    <option value="entregue">Entregue</option>
                    <option value="lido">Lido</option>
                    <option value="falhou">Falhou</option>
                  </Select>
                </div>
              </div>
              {history.length === 0 ? (
                <p className="text-sm text-stone-400">Nenhum envio encontrado.</p>
              ) : (
                <>
                  <ul className="divide-y divide-brand-800">
                    {history.map((h) => {
                      const sb = statusBadge(h.status)
                      return (
                        <li key={h.id} className="flex flex-wrap justify-between gap-2 py-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-stone-50">{h.group}</p>
                            {h.body && <p className="mt-0.5 line-clamp-2 text-xs text-stone-400">{h.body}</p>}
                            {h.error && <p className="mt-0.5 text-xs text-red-300">{h.error}</p>}
                          </div>
                          <div className="shrink-0 text-right text-xs text-stone-500">
                            <p>{fmtDate(h.sentAt)}</p>
                            <Badge variant={sb.variant} className="mt-1 inline-flex items-center gap-1">
                              {h.status === 'lido' && <CheckCheck className="h-3 w-3" />}
                              {sb.label}
                            </Badge>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                  {histPages > 1 && (
                    <div className="mt-3 flex items-center justify-between text-xs text-stone-400">
                      <button type="button" disabled={histOffset === 0} onClick={() => refreshHistory(Math.max(0, histOffset - HIST_PAGE_SIZE))} className="rounded-lg border border-brand-800 px-3 py-1 disabled:opacity-40 hover:bg-white/5">
                        Anterior
                      </button>
                      <span>Página {histPage} de {histPages}</span>
                      <button type="button" disabled={histPage >= histPages} onClick={() => refreshHistory(histOffset + HIST_PAGE_SIZE)} className="rounded-lg border border-brand-800 px-3 py-1 disabled:opacity-40 hover:bg-white/5">
                        Próxima
                      </button>
                    </div>
                  )}
                </>
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === 'cadencia' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-stone-400">Agrupe automações em cadências (ex.: “Segunda-feira”) e ative ou pause todas de uma vez.</p>
            <Button className="gap-2" onClick={openNewCadence}>
              <Plus className="h-4 w-4" /> Nova cadência
            </Button>
          </div>

          {loadingInit ? (
            <div className="space-y-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl bg-brand-800/50" />
              ))}
            </div>
          ) : cadences.length === 0 ? (
            <Card>
              <p className="text-sm text-stone-400">Nenhuma cadência ainda. Crie uma para organizar suas automações por dia, campanha, etc.</p>
            </Card>
          ) : (
            <div className="space-y-4">
              {cadences.map((c) => {
                const members = automations.filter((a) => a.cadenceId === c.id)
                const active = members.filter((m) => m.status === 'ativa').length
                const inactive = members.length - active
                return (
                  <Card key={c.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex gap-3 min-w-0">
                        <div className="h-fit rounded-xl bg-accent-500/15 p-2 text-accent-400">
                          <Layers className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate font-semibold text-stone-50">{c.name}</h3>
                          <p className="mt-1 text-xs text-stone-500">
                            {members.length} automação(ões) • <span className="text-emerald-400">{active} ativa(s)</span> • <span className="text-stone-400">{inactive} inativa(s)</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => cadenceBulkStatus(c, 'ativa')}>
                          <PlayCircle className="h-3.5 w-3.5" /> Ativar todas
                        </Button>
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => cadenceBulkStatus(c, 'pausada')}>
                          <PauseCircle className="h-3.5 w-3.5" /> Pausar todas
                        </Button>
                        <button type="button" className="p-2 rounded-lg text-stone-400 hover:bg-white/5 hover:text-stone-50" aria-label="Renomear" title="Renomear" onClick={() => openRenameCadence(c)}>
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button type="button" className="p-2 rounded-lg text-stone-400 hover:bg-red-500/10 hover:text-red-300" aria-label="Excluir" title="Excluir" onClick={() => setConfirmCad(c.id)}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      {members.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-brand-800 px-3 py-3 text-xs text-stone-500">
                          Nenhuma automação nesta cadência. Clique em “Gerenciar automações” para adicionar.
                        </p>
                      ) : (
                        members.map((a) => (
                          <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-brand-800 px-3 py-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm text-stone-100">{a.name}</p>
                              <p className="text-xs text-stone-500">{frequencyLabel(a)}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge variant={a.status === 'ativa' ? 'success' : a.status === 'concluida' ? 'default' : 'muted'}>{a.status}</Badge>
                              {a.frequency !== 'now' && a.status !== 'concluida' && (
                                <button type="button" onClick={() => toggleAutomation(a)} className="text-xs text-stone-300 hover:underline" title={a.status === 'pausada' ? 'Retomar' : 'Pausar'}>
                                  {a.status === 'pausada' ? <PlayCircle className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <button type="button" className="mt-3 inline-flex items-center gap-1 text-xs text-accent-400 hover:underline" onClick={() => openManage(c)}>
                      <ListChecks className="h-4 w-4" /> Gerenciar automações
                    </button>
                  </Card>
                )
              })}
            </div>
          )}

          {orphanAutomations.length > 0 && (
            <Card>
              <h3 className="mb-2 text-sm font-semibold text-stone-300">Sem cadência ({orphanAutomations.length})</h3>
              <div className="space-y-2">
                {orphanAutomations.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-brand-800 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-stone-100">{a.name}</p>
                      <p className="text-xs text-stone-500">{frequencyLabel(a)}</p>
                    </div>
                    <Badge variant={a.status === 'ativa' ? 'success' : a.status === 'concluida' ? 'default' : 'muted'}>{a.status}</Badge>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-stone-500">Use “Gerenciar automações” dentro de uma cadência para incluí-las.</p>
            </Card>
          )}
        </div>
      )}

      {/* Editor de mensagem (biblioteca) */}
      <Modal
        isOpen={tplModal}
        onClose={() => setTplModal(false)}
        title={tplForm.id ? 'Editar mensagem' : 'Nova mensagem'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTplModal(false)}>Cancelar</Button>
            <Button onClick={saveTemplate} disabled={tplSaving}>{tplSaving ? 'Salvando…' : 'Salvar'}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Nome" value={tplForm.name} onChange={(e) => setTplForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex: Promo da semana" />
          <Textarea label={tplForm.mediaType === 'none' ? 'Mensagem' : 'Legenda (opcional)'} rows={5} value={tplForm.body} onChange={(e) => setTplForm((f) => ({ ...f, body: e.target.value }))} placeholder="Escreva sua mensagem..." />
          <div className="space-y-2">
            <p className="text-sm text-stone-200">Mídia (imagem até 5MB ou vídeo até 16MB)</p>
            {tplForm.mediaType === 'none' ? (
              <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-brand-700 px-4 py-4 text-sm text-stone-400 hover:bg-white/5">
                Clique para anexar imagem ou vídeo
                <input type="file" accept="image/*,video/*" className="hidden" onChange={onPickMedia} />
              </label>
            ) : (
              <div className="rounded-lg border border-brand-800 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="inline-flex items-center gap-2 truncate text-xs text-stone-300">
                    {tplForm.mediaType === 'image' ? <ImageIcon className="h-4 w-4" /> : <Film className="h-4 w-4" />}
                    {tplForm.mediaName || tplForm.mediaType}
                  </p>
                  <button type="button" onClick={clearMedia} className="text-stone-500 hover:text-red-300" aria-label="Remover mídia">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-2">
                  {tplForm.mediaType === 'image' ? (
                    <img src={tplForm.mediaBase64} alt="" className="h-28 rounded border border-brand-700 object-cover" />
                  ) : (
                    <video src={tplForm.mediaBase64} controls className="h-28 rounded border border-brand-700" />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Confirmação de envio imediato */}
      <Modal
        isOpen={sendConfirm}
        onClose={() => setSendConfirm(false)}
        title="Confirmar envio agora"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSendConfirm(false)}>Cancelar</Button>
            <Button onClick={confirmSendNow} disabled={autoSaving}>{autoSaving ? 'Enviando…' : 'Enviar agora'}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <p>Você vai enviar esta mensagem para <strong>{autoForm.groupIds.length} grupo(s)</strong> agora. Isso não pode ser desfeito.</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-stone-400">Prévia</p>
            <PreviewBubble content={previewContent} />
          </div>
        </div>
      </Modal>

      {/* Criar / renomear cadência */}
      <Modal
        isOpen={cadenceModal}
        onClose={() => setCadenceModal(false)}
        title={cadenceForm.id ? 'Renomear cadência' : 'Nova cadência'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCadenceModal(false)}>Cancelar</Button>
            <Button onClick={saveCadence}>Salvar</Button>
          </>
        }
      >
        <Input label="Nome da cadência" value={cadenceForm.name} onChange={(e) => setCadenceForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex: Segunda-feira" />
      </Modal>

      {/* Gerenciar automações da cadência */}
      <Modal
        isOpen={!!manageCad}
        onClose={() => setManageCad(null)}
        title={manageCad ? `Automações de “${manageCad.name}”` : 'Automações'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setManageCad(null)}>Cancelar</Button>
            <Button onClick={saveManage}>Salvar</Button>
          </>
        }
      >
        <div className="space-y-2">
          {automations.length === 0 ? (
            <p className="text-sm text-stone-400">Você ainda não tem automações. Crie na aba “Automações”.</p>
          ) : (
            <>
              <p className="text-xs text-stone-500">Marque as automações que fazem parte desta cadência.</p>
              <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-brand-800 p-2">
                {automations.map((a) => {
                  const otherCad = a.cadenceId && manageCad && a.cadenceId !== manageCad.id
                  const otherName = otherCad ? cadences.find((c) => c.id === a.cadenceId)?.name : null
                  return (
                    <label key={a.id} className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm text-stone-200 hover:bg-white/5">
                      <span className="flex items-center gap-2 min-w-0">
                        <input type="checkbox" checked={manageSel.includes(a.id)} onChange={() => toggleManage(a.id)} className="rounded border-brand-600 text-accent-500 focus:ring-accent-500/30" />
                        <span className="truncate">{a.name}</span>
                        <span className="text-xs text-stone-500">{frequencyLabel(a)}</span>
                      </span>
                      {otherName && <span className="shrink-0 text-xs text-amber-400/80">em “{otherName}”</span>}
                    </label>
                  )
                })}
              </div>
              <p className="text-xs text-stone-500">Uma automação pertence a uma cadência por vez — marcá-la aqui a move para esta.</p>
            </>
          )}
        </div>
      </Modal>

      <ConfirmModal isOpen={!!confirmTpl} onClose={() => setConfirmTpl(null)} onConfirm={removeTemplate} title="Excluir mensagem" message="Tem certeza que deseja excluir esta mensagem da biblioteca?" />
      <ConfirmModal isOpen={!!confirmAuto} onClose={() => setConfirmAuto(null)} onConfirm={removeAutomation} title="Excluir automação" message="Tem certeza que deseja excluir esta automação? Ela deixará de disparar." />
      <ConfirmModal isOpen={!!confirmCad} onClose={() => setConfirmCad(null)} onConfirm={removeCadence} title="Excluir cadência" message="Excluir a cadência? As automações dela não serão apagadas, apenas ficarão sem cadência." />
    </div>
  )
}
