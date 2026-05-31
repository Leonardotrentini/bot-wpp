import { useCallback, useEffect, useState } from 'react'
import { Film, Image as ImageIcon, FileText, Pencil, Plus, Send, Trash2, X, Clock, PauseCircle, PlayCircle, Zap } from 'lucide-react'
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
  updateAutomation,
  deleteAutomation,
  getMessageHistory,
} from '../../services/api.js'
import { useToast } from '../../contexts/ToastContext.jsx'

const IMAGE_MAX = 5 * 1024 * 1024
const VIDEO_MAX = 16 * 1024 * 1024
const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

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

function frequencyLabel(a) {
  if (a.frequency === 'now') return 'Envio imediato'
  if (a.frequency === 'once') return `Uma vez • ${fmtDate(a.scheduledAt)}`
  if (a.frequency === 'daily') return `Diariamente • ${a.timeOfDay}`
  if (a.frequency === 'weekly') return `Toda ${WEEKDAYS[a.weekday ?? 0]} • ${a.timeOfDay}`
  return a.frequency
}

export function Messages({ defaultTab = 'criar' }) {
  const toast = useToast()
  const [tab, setTab] = useState(defaultTab)
  const [groups, setGroups] = useState([])
  const [templates, setTemplates] = useState([])
  const [automations, setAutomations] = useState([])
  const [history, setHistory] = useState([])

  const [tplModal, setTplModal] = useState(false)
  const [tplForm, setTplForm] = useState(emptyTemplateForm)
  const [tplSaving, setTplSaving] = useState(false)
  const [confirmTpl, setConfirmTpl] = useState(null)

  const [autoForm, setAutoForm] = useState(emptyAutomationForm)
  const [autoSaving, setAutoSaving] = useState(false)
  const [confirmAuto, setConfirmAuto] = useState(null)

  useEffect(() => {
    setTab(defaultTab)
  }, [defaultTab])

  const refreshTemplates = useCallback(() => getTemplates().then((r) => setTemplates(r.data.templates || [])), [])
  const refreshAutomations = useCallback(() => getAutomations().then((r) => setAutomations(r.data.automations || [])), [])
  const refreshHistory = useCallback(() => getMessageHistory().then((r) => setHistory(r.data.items || [])), [])

  useEffect(() => {
    getGroups().then((r) => setGroups((r.data.groups || []).filter((g) => g.status === 'ativo')))
    refreshTemplates()
    refreshAutomations()
    refreshHistory()
  }, [refreshTemplates, refreshAutomations, refreshHistory])

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
    if (!tplForm.name.trim()) {
      toast.error('Dê um nome para a mensagem.')
      return
    }
    if (tplForm.mediaType === 'none' && !tplForm.body.trim()) {
      toast.error('Escreva um texto ou anexe uma mídia.')
      return
    }
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

  // ---------- Automações ----------
  function toggleAutoGroup(id) {
    setAutoForm((f) => ({
      ...f,
      groupIds: f.groupIds.includes(id) ? f.groupIds.filter((x) => x !== id) : [...f.groupIds, id],
    }))
  }

  async function saveAutomation() {
    const f = autoForm
    if (!f.name.trim()) return toast.error('Dê um nome para a automação.')
    if (!f.groupIds.length) return toast.error('Selecione ao menos um grupo.')
    if (f.source === 'template' && !f.templateId) return toast.error('Selecione uma mensagem da biblioteca.')
    if (f.source === 'inline' && !f.body.trim()) return toast.error('Escreva o texto da mensagem.')
    if (f.frequency === 'once' && !f.scheduledAt) return toast.error('Informe a data e hora do agendamento.')

    setAutoSaving(true)
    try {
      const payload = {
        name: f.name.trim(),
        groupIds: f.groupIds,
        frequency: f.frequency,
      }
      if (f.source === 'template') payload.templateId = f.templateId
      else payload.body = f.body
      if (f.frequency === 'once') payload.scheduledAt = f.scheduledAt
      if (f.frequency === 'daily' || f.frequency === 'weekly') payload.timeOfDay = f.timeOfDay
      if (f.frequency === 'weekly') payload.weekday = Number(f.weekday)

      const res = await createAutomation(payload)
      if (f.frequency === 'now') {
        const sent = res?.data?.sent ?? 0
        const failed = res?.data?.failed ?? 0
        if (failed > 0) toast.error(`Enviado para ${sent} grupo(s), ${failed} falharam.`)
        else toast.success(`Mensagem enviada para ${sent} grupo(s).`)
      } else {
        toast.success('Automação criada e agendada.')
      }
      setAutoForm(emptyAutomationForm())
      refreshAutomations()
      refreshHistory()
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao criar a automação.')
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
      refreshAutomations()
    } catch {
      toast.error('Falha ao remover.')
    } finally {
      setConfirmAuto(null)
    }
  }

  const sendableTemplates = templates

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-stone-50">Mensagens</h2>
        <p className="text-sm text-stone-400 mt-1">Crie mensagens reutilizáveis e dispare em grupos com horário e frequência.</p>
      </div>

      <Tabs
        tabs={[
          { id: 'criar', label: 'Criar mensagem' },
          { id: 'automacoes', label: 'Automações' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'criar' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-stone-400">Sua biblioteca de mensagens (texto, imagem ou vídeo) para reutilizar nas automações.</p>
            <Button className="gap-2" onClick={openNewTemplate}>
              <Plus className="h-4 w-4" /> Nova mensagem
            </Button>
          </div>

          {templates.length === 0 ? (
            <Card>
              <p className="text-sm text-stone-400">Nenhuma mensagem ainda. Clique em "Nova mensagem" para criar a primeira.</p>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {templates.map((t) => (
                <Card key={t.id} className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {t.mediaType === 'image' ? (
                        <ImageIcon className="h-4 w-4 text-accent-400" />
                      ) : t.mediaType === 'video' ? (
                        <Film className="h-4 w-4 text-accent-400" />
                      ) : (
                        <FileText className="h-4 w-4 text-accent-400" />
                      )}
                      <h3 className="font-semibold text-stone-50">{t.name}</h3>
                    </div>
                    <div className="flex gap-1">
                      <button type="button" className="p-1.5 rounded-lg text-stone-400 hover:bg-white/5 hover:text-stone-50" aria-label="Editar" onClick={() => openEditTemplate(t)}>
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" className="p-1.5 rounded-lg text-stone-400 hover:bg-red-500/10 hover:text-red-300" aria-label="Excluir" onClick={() => setConfirmTpl(t.id)}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {t.mediaType === 'image' && t.mediaBase64 && (
                    <img src={t.mediaBase64} alt="" className="h-28 w-full rounded-lg object-cover border border-brand-800" />
                  )}
                  {t.mediaType === 'video' && t.mediaBase64 && (
                    <video src={t.mediaBase64} controls className="h-28 w-full rounded-lg border border-brand-800" />
                  )}
                  {t.body && <p className="text-sm text-stone-400 whitespace-pre-wrap line-clamp-4">{t.body}</p>}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'automacoes' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="space-y-4">
            <h3 className="font-semibold text-stone-50">Nova automação</h3>

            <Input label="Nome" value={autoForm.name} onChange={(e) => setAutoForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex: Lembrete da live" />

            <Select label="Mensagem" value={autoForm.source} onChange={(e) => setAutoForm((f) => ({ ...f, source: e.target.value }))}>
              <option value="template">Selecionar da biblioteca</option>
              <option value="inline">Escrever texto rápido</option>
            </Select>

            {autoForm.source === 'template' ? (
              sendableTemplates.length === 0 ? (
                <p className="rounded-lg border border-brand-800 px-3 py-2 text-xs text-stone-400">
                  Você ainda não tem mensagens. Crie uma na aba "Criar mensagem".
                </p>
              ) : (
                <Select label="Escolha a mensagem" value={autoForm.templateId} onChange={(e) => setAutoForm((f) => ({ ...f, templateId: e.target.value }))}>
                  <option value="">— selecione —</option>
                  {sendableTemplates.map((t) => (
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
              <p className="text-sm font-medium text-stone-300 mb-2">Grupos alvo (ativos)</p>
              <div className="max-h-40 space-y-2 overflow-y-auto rounded-xl border border-brand-800 p-2">
                {groups.length === 0 && (
                  <p className="px-1 py-1 text-xs text-stone-400">Nenhum grupo ativo. Vá em Grupos e marque como ativo.</p>
                )}
                {groups.map((g) => (
                  <label key={g.id} className="flex cursor-pointer items-center gap-2 text-sm text-stone-300">
                    <input type="checkbox" checked={autoForm.groupIds.includes(g.id)} onChange={() => toggleAutoGroup(g.id)} className="rounded border-brand-600 text-accent-500 focus:ring-accent-500/30" />
                    {g.name}
                  </label>
                ))}
              </div>
            </div>

            <Select label="Quando disparar" value={autoForm.frequency} onChange={(e) => setAutoForm((f) => ({ ...f, frequency: e.target.value }))}>
              <option value="now">Enviar agora</option>
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

            <Button className="gap-2" onClick={saveAutomation} disabled={autoSaving}>
              {autoForm.frequency === 'now' ? <Send className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
              {autoSaving ? 'Processando…' : autoForm.frequency === 'now' ? 'Enviar agora' : 'Salvar automação'}
            </Button>
            {autoForm.frequency === 'daily' || autoForm.frequency === 'weekly' || autoForm.frequency === 'once' ? (
              <p className="text-xs text-stone-500">Horário no fuso de São Paulo (UTC-3).</p>
            ) : null}
          </Card>

          <div className="space-y-4">
            <Card>
              <h3 className="font-semibold text-stone-50 mb-3">Automações salvas</h3>
              {automations.length === 0 ? (
                <p className="text-sm text-stone-400">Nenhuma automação ainda.</p>
              ) : (
                <div className="space-y-3">
                  {automations.map((a) => (
                    <div key={a.id} className="rounded-xl border border-brand-800 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex gap-2">
                          <div className="rounded-lg bg-accent-500/15 p-1.5 text-accent-400 h-fit">
                            <Zap className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-medium text-stone-50">{a.name}</p>
                            <p className="text-xs text-stone-500 mt-0.5">{frequencyLabel(a)}</p>
                            <p className="text-xs text-stone-500">{a.groupNames?.length || 0} grupo(s)</p>
                            {a.nextRunAt && a.status === 'ativa' && (
                              <p className="text-xs text-accent-400/80 mt-0.5">Próximo: {fmtDate(a.nextRunAt)}</p>
                            )}
                          </div>
                        </div>
                        <Badge variant={a.status === 'ativa' ? 'success' : a.status === 'concluida' ? 'default' : 'muted'}>{a.status}</Badge>
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        {a.frequency !== 'now' && a.status !== 'concluida' && (
                          <button type="button" onClick={() => toggleAutomation(a)} className="text-xs text-stone-300 hover:underline inline-flex items-center gap-1">
                            {a.status === 'pausada' ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
                            {a.status === 'pausada' ? 'Retomar' : 'Pausar'}
                          </button>
                        )}
                        <button type="button" onClick={() => setConfirmAuto(a.id)} className="text-xs text-red-300 hover:underline inline-flex items-center gap-1">
                          <Trash2 className="h-3.5 w-3.5" /> Excluir
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <h3 className="font-semibold text-stone-50 mb-3">Histórico de envios</h3>
              {history.length === 0 ? (
                <p className="text-sm text-stone-400">Nenhum envio ainda.</p>
              ) : (
                <ul className="divide-y divide-brand-800 max-h-72 overflow-y-auto">
                  {history.map((h) => (
                    <li key={h.id} className="py-3 flex flex-wrap justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-stone-50 font-medium text-sm">{h.group}</p>
                        {h.body && <p className="text-xs text-stone-400 mt-0.5 line-clamp-2">{h.body}</p>}
                        {h.error && <p className="text-xs text-red-300 mt-0.5">{h.error}</p>}
                      </div>
                      <div className="text-right text-xs text-stone-500 shrink-0">
                        <p>{fmtDate(h.sentAt)}</p>
                        <Badge variant={h.status === 'entregue' ? 'success' : 'warning'} className="mt-1">{h.status}</Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
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
                  <p className="text-xs text-stone-300 truncate inline-flex items-center gap-2">
                    {tplForm.mediaType === 'image' ? <ImageIcon className="h-4 w-4" /> : <Film className="h-4 w-4" />}
                    {tplForm.mediaName || tplForm.mediaType}
                  </p>
                  <button type="button" onClick={clearMedia} className="text-stone-500 hover:text-red-300"><X className="h-4 w-4" /></button>
                </div>
                <div className="mt-2">
                  {tplForm.mediaType === 'image' ? (
                    <img src={tplForm.mediaBase64} alt="" className="h-28 rounded object-cover border border-brand-700" />
                  ) : (
                    <video src={tplForm.mediaBase64} controls className="h-28 rounded border border-brand-700" />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!confirmTpl}
        onClose={() => setConfirmTpl(null)}
        onConfirm={removeTemplate}
        title="Excluir mensagem"
        message="Tem certeza que deseja excluir esta mensagem da biblioteca?"
      />
      <ConfirmModal
        isOpen={!!confirmAuto}
        onClose={() => setConfirmAuto(null)}
        onConfirm={removeAutomation}
        title="Excluir automação"
        message="Tem certeza que deseja excluir esta automação? Ela deixará de disparar."
      />
    </div>
  )
}
