import { useEffect, useState } from 'react'
import { Film, Image as ImageIcon, PauseCircle, PlayCircle, Plus, Trash2, Upload, X } from 'lucide-react'
import { Tabs } from '../../components/common/Tabs.jsx'
import { Card } from '../../components/common/Card.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Textarea } from '../../components/common/Textarea.jsx'
import { Select } from '../../components/common/Select.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { Modal } from '../../components/common/Modal.jsx'
import { getGroups, sendMessage, scheduleMessage, getScheduledMessages, getMessageHistory } from '../../services/api.js'
import { useToast } from '../../contexts/ToastContext.jsx'

function fileKind(file) {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  return 'file'
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function extractUrls(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s]+/gi) || []
  return [...new Set(matches.map((u) => u.replace(/[),.;!?]+$/, '')))]
}

function createTrackingCode() {
  return Math.random().toString(36).slice(2, 8)
}

function formatDelayLabel(delay) {
  const normalized = String(delay || '').trim().toUpperCase()
  const match = normalized.match(/^D\+?(\d+)$/)
  if (!match) return delay
  return `Dia +${match[1]}`
}

export function Messages() {
  const toast = useToast()
  const [tab, setTab] = useState('agora')
  const [groups, setGroups] = useState([])
  const [selected, setSelected] = useState([])
  const [body, setBody] = useState('')
  const [when, setWhen] = useState('')
  const [recurrence, setRecurrence] = useState('unico')
  const [timezone] = useState('America/Sao_Paulo')
  const [retryPolicy, setRetryPolicy] = useState('2x')
  const [scheduled, setScheduled] = useState([])
  const [history, setHistory] = useState([])
  const [histFilter, setHistFilter] = useState({ group: '', status: '' })
  const [assets, setAssets] = useState([])
  const [editSchedule, setEditSchedule] = useState(null)
  const [trackedLinks, setTrackedLinks] = useState(() => {
    try {
      const raw = localStorage.getItem('vg_tracked_links')
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })
  const [cadences, setCadences] = useState([
    {
      id: 'cad-1',
      name: 'Aquecimento 5 dias',
      groups: ['g1', 'g2'],
      active: true,
      pauseOnReply: true,
      skipWeekend: true,
      windowStart: '09:00',
      windowEnd: '20:00',
      steps: [
        { id: 's1', delay: 'D+0', type: 'texto', content: 'Bem-vindo! Hoje 20h teremos conteúdo exclusivo.' },
        { id: 's2', delay: 'D+1', type: 'imagem', content: 'Banner de resultados da semana.' },
        { id: 's3', delay: 'D+3', type: 'vídeo', content: 'Vídeo curto com prova social.' },
      ],
    },
  ])
  const [cadenceModal, setCadenceModal] = useState(false)
  const cadenceTemplates = [
    {
      id: 'tpl-oferta',
      title: 'Template de Oferta',
      intro: 'Fluxo pensado para lançamento ou campanha com urgência e prova social.',
      howItWorks: 'Entrega valor no Dia 0, reforça benefício no Dia 1 e fecha com CTA forte no Dia 3.',
      suggestions: 'Use por 5 a 7 dias em grupos novos e combine com gatilho de escassez real.',
      cadence: {
        name: 'Régua de oferta 4 dias',
        pauseOnReply: true,
        skipWeekend: false,
        windowStart: '09:00',
        windowEnd: '20:00',
        steps: [
          { delay: 'D+0', type: 'texto', content: 'Boas-vindas + proposta: explique a transformação da oferta em 3 linhas.' },
          { delay: 'D+1', type: 'imagem', content: 'Criativo com benefícios principais + bônus e prazo final.' },
          { delay: 'D+3', type: 'video', content: 'Depoimento curto (30-60s) + CTA: "Responder QUERO para receber o link".' },
        ],
      },
    },
    {
      id: 'tpl-vip-retencao',
      title: 'Template VIP (Foco em Retenção)',
      intro: 'Fluxo para manter alunos/clientes ativos, reduzindo silêncio e evasão no grupo.',
      howItWorks: 'Alterna conteúdo útil, engajamento e convite para ação leve sem pressionar.',
      suggestions: 'Use continuamente, pausando para quem responder e revisando os passos a cada 15 dias.',
      cadence: {
        name: 'Régua VIP de retenção 7 dias',
        pauseOnReply: true,
        skipWeekend: true,
        windowStart: '09:00',
        windowEnd: '20:00',
        steps: [
          { delay: 'D+0', type: 'texto', content: 'Check-in rápido: "Qual seu maior desafio desta semana?"' },
          { delay: 'D+2', type: 'imagem', content: 'Resumo visual com 3 boas práticas para aplicar hoje.' },
          { delay: 'D+4', type: 'video', content: 'Vídeo curto de orientação com passo a passo objetivo.' },
          { delay: 'D+6', type: 'texto', content: 'Convite para interação: peça feedback + próximo micro compromisso.' },
        ],
      },
    },
  ]
  const [cadenceForm, setCadenceForm] = useState({
    name: '',
    groups: [],
    pauseOnReply: true,
    skipWeekend: true,
    windowStart: '09:00',
    windowEnd: '20:00',
    steps: [{ id: crypto.randomUUID(), delay: 'D+0', type: 'texto', content: '' }],
  })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    localStorage.setItem('vg_tracked_links', JSON.stringify(trackedLinks))
  }, [trackedLinks])

  useEffect(() => {
    getGroups().then((r) => setGroups((r.data.groups || []).filter((g) => g.status === 'ativo')))
    getScheduledMessages().then((r) =>
      setScheduled(
        r.data.items.map((x) => ({
          ...x,
          recurrence: 'unico',
          timezone: 'America/Sao_Paulo',
          retryPolicy: '2x',
          status: x.status || 'pendente',
        })),
      ),
    )
    getMessageHistory().then((r) => setHistory(r.data.items))
  }, [])

  function toggleGroup(id) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  const preview = body || 'Sua mensagem aparecerá aqui...'
  const selectedNames = groups.filter((g) => selected.includes(g.id)).map((g) => g.name)

  function onPickFiles(ev) {
    const incoming = Array.from(ev.target.files || [])
    if (!incoming.length) return
    const valid = []
    for (const f of incoming) {
      const kind = fileKind(f)
      const max = kind === 'video' ? 35 * 1024 * 1024 : 8 * 1024 * 1024
      if (kind === 'file') {
        toast.error(`Tipo não suportado: ${f.name}`)
        continue
      }
      if (f.size > max) {
        toast.error(`Arquivo grande demais (${f.name}). Limite: ${kind === 'video' ? '35MB' : '8MB'}.`)
        continue
      }
      valid.push({
        id: crypto.randomUUID(),
        file: f,
        kind,
        name: f.name,
        size: f.size,
        previewUrl: URL.createObjectURL(f),
        caption: '',
      })
    }
    setAssets((prev) => [...prev, ...valid])
    ev.target.value = ''
  }

  function removeAsset(id) {
    setAssets((prev) => {
      const item = prev.find((x) => x.id === id)
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
      return prev.filter((x) => x.id !== id)
    })
  }

  function registerTrackedLinks({ content, groupIds, origin }) {
    const urls = extractUrls(content)
    if (!urls.length) return
    const groupNames = groups.filter((g) => groupIds.includes(g.id)).map((g) => g.name)
    const createdAt = new Date().toISOString()
    const rows = urls.map((url) => ({
      id: crypto.randomUUID(),
      originalUrl: url,
      shortUrl: `https://vesto.link/${createTrackingCode()}`,
      origin,
      createdAt,
      clicks: 0,
      recipients: groupNames.length || 1,
      groupNames,
      lastClickedAt: null,
    }))
    setTrackedLinks((prev) => [...rows, ...prev])
    toast.success(`Rastreamento ativado para ${rows.length} link(s).`)
  }

  function simulateLinkClick(id) {
    setTrackedLinks((prev) =>
      prev.map((row) =>
        row.id === id
          ? { ...row, clicks: row.clicks + 1, lastClickedAt: new Date().toISOString() }
          : row,
      ),
    )
  }

  async function handleSend() {
    if (!selected.length || !body.trim()) {
      toast.error('Selecione ao menos um grupo e escreva a mensagem.')
      return
    }
    setLoading(true)
    try {
      await sendMessage({
        groupIds: selected,
        body,
        assets: assets.map((a) => ({ name: a.name, kind: a.kind, caption: a.caption })),
      })
      registerTrackedLinks({ content: body, groupIds: selected, origin: 'envio imediato' })
      toast.success('Mensagem enviada (simulado).')
      setBody('')
      setAssets((prev) => {
        prev.forEach((a) => a.previewUrl && URL.revokeObjectURL(a.previewUrl))
        return []
      })
    } catch {
      toast.error('Falha ao enviar.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSchedule() {
    if (!selected.length || !body.trim() || !when) {
      toast.error('Preencha grupos, mensagem e data/hora.')
      return
    }
    setLoading(true)
    try {
      const newRow = {
        id: `sch-local-${Date.now()}`,
        groupNames: groups.filter((g) => selected.includes(g.id)).map((g) => g.name),
        body,
        scheduledAt: when,
        recurrence,
        timezone,
        retryPolicy,
        status: 'pendente',
      }
      await scheduleMessage({ groupIds: selected, body, scheduledAt: when, recurrence, timezone, retryPolicy })
      registerTrackedLinks({ content: body, groupIds: selected, origin: 'agendamento' })
      setScheduled((prev) => [newRow, ...prev])
      toast.success('Mensagem agendada.')
      setBody('')
      setWhen('')
    } catch {
      toast.error('Falha ao agendar.')
    } finally {
      setLoading(false)
    }
  }

  function toggleScheduleStatus(id) {
    setScheduled((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, status: s.status === 'pausado' ? 'pendente' : 'pausado' } : s,
      ),
    )
  }

  function deleteSchedule(id) {
    setScheduled((prev) => prev.filter((s) => s.id !== id))
    toast.success('Agendamento removido.')
  }

  function saveScheduleEdit() {
    if (!editSchedule) return
    setScheduled((prev) => prev.map((s) => (s.id === editSchedule.id ? editSchedule : s)))
    setEditSchedule(null)
    toast.success('Agendamento atualizado.')
  }

  function addCadenceStep() {
    setCadenceForm((prev) => ({
      ...prev,
      steps: [...prev.steps, { id: crypto.randomUUID(), delay: `D+${prev.steps.length}`, type: 'texto', content: '' }],
    }))
  }

  function createCadence() {
    if (!cadenceForm.name.trim() || !cadenceForm.groups.length || cadenceForm.steps.some((s) => !s.content.trim())) {
      toast.error('Preencha nome, grupos e conteúdo de todos os passos.')
      return
    }
    setCadences((prev) => [{ ...cadenceForm, id: crypto.randomUUID(), active: true }, ...prev])
    setCadenceModal(false)
    setCadenceForm({
      name: '',
      groups: [],
      pauseOnReply: true,
      skipWeekend: true,
      windowStart: '09:00',
      windowEnd: '20:00',
      steps: [{ id: crypto.randomUUID(), delay: 'D+0', type: 'texto', content: '' }],
    })
    toast.success('Cadência criada.')
  }

  function applyCadenceTemplate(template) {
    setCadenceForm({
      name: template.cadence.name,
      groups: [],
      pauseOnReply: template.cadence.pauseOnReply,
      skipWeekend: template.cadence.skipWeekend,
      windowStart: template.cadence.windowStart,
      windowEnd: template.cadence.windowEnd,
      steps: template.cadence.steps.map((step) => ({ ...step, id: crypto.randomUUID() })),
    })
    setCadenceModal(true)
    toast.success('Template aplicado. Selecione o grupo novo e ajuste o conteúdo.')
  }

  const histFiltered = history.filter((h) => {
    if (histFilter.group && !h.group.toLowerCase().includes(histFilter.group.toLowerCase())) return false
    if (histFilter.status && h.status !== histFilter.status) return false
    return true
  })

  return (
    <div className="space-y-6">
      <Tabs
        tabs={[
          { id: 'agora', label: 'Enviar agora' },
          { id: 'agendar', label: 'Agendar' },
          { id: 'cadencia', label: 'Cadência' },
          { id: 'historico', label: 'Histórico' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {(tab === 'agora' || tab === 'agendar') && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="space-y-4">
            <h3 className="font-semibold text-stone-50">Grupos</h3>
            <p className="text-xs text-stone-500">Selecione um ou mais grupos (somente ativos)</p>
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {groups.length === 0 && (
                <p className="rounded-lg border border-brand-800 px-3 py-2 text-xs text-stone-400">
                  Nenhum grupo ativo. Vá em Grupos, selecione e clique em Marcar ativo.
                </p>
              )}
              {groups.map((g) => (
                <label key={g.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-brand-800 px-3 py-2 hover:bg-white/5">
                  <input
                    type="checkbox"
                    checked={selected.includes(g.id)}
                    onChange={() => toggleGroup(g.id)}
                    className="rounded border-brand-600 text-accent-500 focus:ring-accent-500/30"
                  />
                  <span className="text-sm text-stone-200">{g.name}</span>
                </label>
              ))}
            </div>
            <Textarea label="Mensagem" rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Olá, comunidade! ..." />
            <div className="space-y-2">
              <p className="text-sm text-stone-200 flex items-center gap-2"><Upload className="h-4 w-4 text-accent-400" /> Mídia (imagem/vídeo)</p>
              <label className="flex cursor-pointer items-center justify-center rounded-xl border border-dashed border-brand-700 px-4 py-4 text-sm text-stone-400 hover:bg-white/5">
                Clique para adicionar imagens ou vídeos
                <input type="file" accept="image/*,video/*" multiple className="hidden" onChange={onPickFiles} />
              </label>
              {assets.length > 0 && (
                <div className="grid gap-2">
                  {assets.map((a) => (
                    <div key={a.id} className="rounded-lg border border-brand-800 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-stone-300 truncate">{a.name} • {formatBytes(a.size)}</p>
                        <button type="button" onClick={() => removeAsset(a.id)} className="text-stone-500 hover:text-red-300">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-2">
                        {a.kind === 'image' ? (
                          <img src={a.previewUrl} alt="" className="h-24 rounded object-cover border border-brand-700" />
                        ) : (
                          <video src={a.previewUrl} className="h-24 rounded border border-brand-700" />
                        )}
                      </div>
                      <Input
                        className="mt-2"
                        placeholder="Legenda opcional"
                        value={a.caption}
                        onChange={(e) =>
                          setAssets((prev) => prev.map((x) => (x.id === a.id ? { ...x, caption: e.target.value } : x)))
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
            {tab === 'agendar' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Data e hora" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                <Select label="Recorrência" value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
                  <option value="unico">Único</option>
                  <option value="diario">Diário</option>
                  <option value="semanal">Semanal</option>
                  <option value="mensal">Mensal</option>
                </Select>
                <Input label="Timezone" value="America/Sao_Paulo" readOnly />
                <Select label="Tentativas" value={retryPolicy} onChange={(e) => setRetryPolicy(e.target.value)}>
                  <option value="0x">Sem retry</option>
                  <option value="2x">2 tentativas</option>
                  <option value="5x">5 tentativas</option>
                </Select>
              </div>
            )}
            <Button onClick={tab === 'agora' ? handleSend : handleSchedule} disabled={loading}>
              {loading ? '...' : tab === 'agora' ? 'Enviar' : 'Agendar envio'}
            </Button>
          </Card>
          <Card>
            <h3 className="font-semibold text-stone-50 mb-4">Preview</h3>
            <div className="rounded-xl border border-brand-700 bg-brand-900/60 p-4 text-sm text-stone-300 whitespace-pre-wrap min-h-[200px]">
              {preview}
            </div>
            {assets.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {assets.map((a) => (
                  <Badge key={a.id} variant="default" className="gap-1">
                    {a.kind === 'image' ? <ImageIcon className="h-3.5 w-3.5" /> : <Film className="h-3.5 w-3.5" />}
                    {a.name}
                  </Badge>
                ))}
              </div>
            )}
            {selectedNames.length > 0 && (
              <p className="mt-3 text-xs text-stone-500">
                Grupos alvo: {selectedNames.join(', ')}
              </p>
            )}
            {tab === 'agendar' && (
              <div className="mt-6">
                <h4 className="text-sm font-medium text-stone-50 mb-2">Agendadas</h4>
                <ul className="space-y-2 text-sm text-stone-400">
                  {scheduled.map((s) => (
                    <li key={s.id} className="rounded-lg border border-brand-800 p-3">
                      <p className="text-stone-50 text-xs">{s.scheduledAt?.replace('T', ' ')} • {s.recurrence || 'unico'}</p>
                      <p>{s.body}</p>
                      <p className="text-xs mt-1">{s.groupNames.join(', ')} • {s.timezone || 'America/Sao_Paulo'} • retry {s.retryPolicy || '2x'}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge variant={s.status === 'pausado' ? 'muted' : 'warning'}>{s.status}</Badge>
                        <button type="button" onClick={() => setEditSchedule({ ...s })} className="text-xs text-accent-400 hover:underline">Editar</button>
                        <button type="button" onClick={() => toggleScheduleStatus(s.id)} className="text-xs text-stone-300 hover:underline inline-flex items-center gap-1">
                          {s.status === 'pausado' ? <PlayCircle className="h-3.5 w-3.5" /> : <PauseCircle className="h-3.5 w-3.5" />}
                          {s.status === 'pausado' ? 'Retomar' : 'Pausar'}
                        </button>
                        <button type="button" onClick={() => deleteSchedule(s.id)} className="text-xs text-red-300 hover:underline inline-flex items-center gap-1">
                          <Trash2 className="h-3.5 w-3.5" /> Cancelar
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'cadencia' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-stone-400">Crie réguas de mensagens com passos automáticos e linguagem padronizada.</p>
            <Button variant="secondary" className="gap-2" onClick={() => setCadenceModal(true)}>
              <Plus className="h-4 w-4" /> Nova régua
            </Button>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {cadenceTemplates.map((template) => (
              <Card key={template.id} className="space-y-3">
                <h3 className="font-semibold text-stone-50">{template.title}</h3>
                <p className="text-sm text-stone-300">{template.intro}</p>
                <p className="text-xs text-stone-400"><span className="text-stone-200">Como funciona:</span> {template.howItWorks}</p>
                <p className="text-xs text-stone-400"><span className="text-stone-200">Sugestão:</span> {template.suggestions}</p>
                <div className="rounded-lg border border-brand-800 bg-brand-900/40 px-3 py-2 text-xs text-stone-300">
                  <p className="text-stone-200 mb-1">Como usar esse template em grupo novo</p>
                  <p>1) Clique em usar template  2) marque o grupo novo  3) revise textos e horários  4) crie e ative.</p>
                </div>
                <Button variant="ghost" onClick={() => applyCadenceTemplate(template)}>Usar template</Button>
              </Card>
            ))}
          </div>
          <div className="grid gap-4">
            {cadences.map((c) => (
              <Card key={c.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-stone-50">{c.name}</h3>
                    <p className="text-xs text-stone-500 mt-1">
                      Janela {c.windowStart}–{c.windowEnd} • {c.pauseOnReply ? 'Pausa se responder' : 'Não pausa'}
                    </p>
                    <p className="text-xs text-stone-500">{groups.filter((g) => c.groups.includes(g.id)).map((g) => g.name).join(', ')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={c.active ? 'success' : 'muted'}>{c.active ? 'ativa' : 'pausada'}</Badge>
                    <button
                      type="button"
                      className="text-xs text-accent-400 hover:underline"
                      onClick={() => setCadences((prev) => prev.map((x) => (x.id === c.id ? { ...x, active: !x.active } : x)))}
                    >
                      {c.active ? 'Pausar' : 'Retomar'}
                    </button>
                  </div>
                </div>
                <ul className="mt-3 space-y-2">
                  {c.steps.map((s) => (
                    <li key={s.id} className="rounded-lg border border-brand-800 px-3 py-2 text-sm text-stone-300">
                      <span className="text-accent-400 font-medium mr-2">{formatDelayLabel(s.delay)}</span>
                      <span className="mr-2 capitalize">{s.type}</span>
                      {s.content}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </div>
      )}

      {tab === 'historico' && (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end mb-4">
              <Input placeholder="Filtrar por grupo" value={histFilter.group} onChange={(e) => setHistFilter((f) => ({ ...f, group: e.target.value }))} />
              <Select value={histFilter.status} onChange={(e) => setHistFilter((f) => ({ ...f, status: e.target.value }))}>
                <option value="">Todos os status</option>
                <option value="entregue">Entregue</option>
                <option value="parcial">Parcial</option>
              </Select>
            </div>
            <ul className="divide-y divide-brand-800">
              {histFiltered.map((h) => (
                <li key={h.id} className="py-4 flex flex-wrap justify-between gap-2">
                  <div>
                    <p className="text-stone-50 font-medium">{h.group}</p>
                    <p className="text-sm text-stone-400 mt-1">{h.body}</p>
                  </div>
                  <div className="text-right text-xs text-stone-500">
                    <p>{h.sentAt?.replace('T', ' ')}</p>
                    <Badge variant={h.status === 'entregue' ? 'success' : 'warning'} className="mt-2">{h.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <h3 className="font-semibold text-stone-50 mb-2">Rastreamento de cliques em links</h3>
            <p className="text-xs text-stone-500 mb-4">
              Sempre que sua mensagem tiver URL, criamos um link rastreável para medir cliques.
            </p>
            {trackedLinks.length === 0 ? (
              <p className="text-sm text-stone-400">Ainda não há links rastreados. Envie ou agende uma mensagem com link.</p>
            ) : (
              <div className="space-y-2">
                {trackedLinks.map((row) => {
                  const ctr = row.recipients > 0 ? (row.clicks / row.recipients) * 100 : 0
                  return (
                    <div key={row.id} className="rounded-lg border border-brand-800 p-3">
                      <p className="text-sm text-stone-100 truncate">{row.originalUrl}</p>
                      <p className="text-xs text-stone-500 mt-1">
                        Link rastreável: {row.shortUrl} • Origem: {row.origin}
                      </p>
                      <p className="text-xs text-stone-400 mt-1">
                        Grupos: {row.groupNames.join(', ') || 'n/a'} • Cliques: {row.clicks} • CTR: {ctr.toFixed(1)}%
                      </p>
                      <div className="mt-2 flex items-center gap-3">
                        <button
                          type="button"
                          className="text-xs text-accent-400 hover:underline"
                          onClick={() => simulateLinkClick(row.id)}
                        >
                          Simular clique
                        </button>
                        {row.lastClickedAt && (
                          <span className="text-xs text-stone-500">
                            Último clique: {row.lastClickedAt.replace('T', ' ').slice(0, 16)}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </div>
      )}

      <Modal
        isOpen={!!editSchedule}
        onClose={() => setEditSchedule(null)}
        title="Editar agendamento"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditSchedule(null)}>Cancelar</Button>
            <Button onClick={saveScheduleEdit}>Salvar</Button>
          </>
        }
      >
        {editSchedule && (
          <div className="space-y-3">
            <Input
              label="Mensagem"
              value={editSchedule.body}
              onChange={(e) => setEditSchedule((s) => ({ ...s, body: e.target.value }))}
            />
            <Input
              label="Data e hora"
              type="datetime-local"
              value={editSchedule.scheduledAt}
              onChange={(e) => setEditSchedule((s) => ({ ...s, scheduledAt: e.target.value }))}
            />
            <Select
              label="Recorrência"
              value={editSchedule.recurrence || 'unico'}
              onChange={(e) => setEditSchedule((s) => ({ ...s, recurrence: e.target.value }))}
            >
              <option value="unico">Único</option>
              <option value="diario">Diário</option>
              <option value="semanal">Semanal</option>
              <option value="mensal">Mensal</option>
            </Select>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={cadenceModal}
        onClose={() => setCadenceModal(false)}
        title="Nova régua de mensagens"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCadenceModal(false)}>Cancelar</Button>
            <Button onClick={createCadence}>Criar</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Nome da régua"
            value={cadenceForm.name}
            onChange={(e) => setCadenceForm((s) => ({ ...s, name: e.target.value }))}
          />
          <div>
            <p className="text-sm text-stone-300 mb-2">Grupos alvo</p>
            <div className="max-h-36 overflow-y-auto space-y-2 rounded-xl border border-brand-800 p-2">
              {groups.map((g) => (
                <label key={g.id} className="flex items-center gap-2 text-sm text-stone-300">
                  <input
                    type="checkbox"
                    checked={cadenceForm.groups.includes(g.id)}
                    onChange={() =>
                      setCadenceForm((prev) => ({
                        ...prev,
                        groups: prev.groups.includes(g.id) ? prev.groups.filter((x) => x !== g.id) : [...prev.groups, g.id],
                      }))
                    }
                  />
                  {g.name}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Janela início"
              type="time"
              value={cadenceForm.windowStart}
              onChange={(e) => setCadenceForm((s) => ({ ...s, windowStart: e.target.value }))}
            />
            <Input
              label="Janela fim"
              type="time"
              value={cadenceForm.windowEnd}
              onChange={(e) => setCadenceForm((s) => ({ ...s, windowEnd: e.target.value }))}
            />
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="text-sm text-stone-300 inline-flex items-center gap-2">
              <input type="checkbox" checked={cadenceForm.pauseOnReply} onChange={(e) => setCadenceForm((s) => ({ ...s, pauseOnReply: e.target.checked }))} />
              Pausar se responder
            </label>
            <label className="text-sm text-stone-300 inline-flex items-center gap-2">
              <input type="checkbox" checked={cadenceForm.skipWeekend} onChange={(e) => setCadenceForm((s) => ({ ...s, skipWeekend: e.target.checked }))} />
              Pular fim de semana
            </label>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm text-stone-200">Passos</p>
              <button type="button" className="text-xs text-accent-400 hover:underline inline-flex items-center gap-1" onClick={addCadenceStep}>
                <Plus className="h-3.5 w-3.5" /> adicionar etapa
              </button>
            </div>
            {cadenceForm.steps.map((s, idx) => (
              <div key={s.id} className="rounded-xl border border-brand-800 p-3 space-y-2">
                <div className="grid gap-2 sm:grid-cols-3">
                  <Input
                    label="Dia relativo"
                    value={s.delay}
                    onChange={(e) =>
                      setCadenceForm((prev) => ({
                        ...prev,
                        steps: prev.steps.map((x) => (x.id === s.id ? { ...x, delay: e.target.value } : x)),
                      }))
                    }
                  />
                  <Select
                    label="Tipo"
                    value={s.type}
                    onChange={(e) =>
                      setCadenceForm((prev) => ({
                        ...prev,
                        steps: prev.steps.map((x) => (x.id === s.id ? { ...x, type: e.target.value } : x)),
                      }))
                    }
                  >
                    <option value="texto">Texto</option>
                    <option value="imagem">Imagem</option>
                    <option value="video">Vídeo</option>
                  </Select>
                  <div className="flex items-end justify-end">
                    {cadenceForm.steps.length > 1 && (
                      <button
                        type="button"
                        className="text-xs text-red-300 hover:underline inline-flex items-center gap-1"
                        onClick={() =>
                          setCadenceForm((prev) => ({
                            ...prev,
                            steps: prev.steps.filter((x) => x.id !== s.id),
                          }))
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" /> remover
                      </button>
                    )}
                  </div>
                </div>
                <Textarea
                  rows={2}
                  label={`Conteúdo da etapa ${idx + 1}`}
                  value={s.content}
                  onChange={(e) =>
                    setCadenceForm((prev) => ({
                      ...prev,
                      steps: prev.steps.map((x) => (x.id === s.id ? { ...x, content: e.target.value } : x)),
                    }))
                  }
                />
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  )
}
