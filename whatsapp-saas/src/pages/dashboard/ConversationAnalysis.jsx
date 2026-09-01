import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Brain,
  Loader2,
  Play,
  Users,
  MessageSquare,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Save,
  Plus,
  Trash2,
} from 'lucide-react'
import { Card } from '../../components/common/Card.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Select } from '../../components/common/Select.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import {
  getAnalysisStatus,
  fetchAnalysisProfiles,
  createDefaultAnalysisProfile,
  saveAnalysisProfile,
  startAnalysisRun,
  getAnalysisRun,
  getAnalysisRunResults,
  fetchOrgMembers,
} from '../../services/api.js'

function ScoreBadge({ score }) {
  if (score == null) return <span className="text-slate-400">—</span>
  const n = Number(score)
  const color = n >= 4 ? 'text-emerald-400' : n >= 3 ? 'text-amber-300' : 'text-rose-400'
  return <span className={`font-semibold ${color}`}>{n.toFixed(1)}/5</span>
}

function CriteriaEditor({ criteria, onChange }) {
  const update = (index, patch) => {
    const next = criteria.map((c, i) => (i === index ? { ...c, ...patch } : c))
    onChange(next)
  }
  const add = () => {
    onChange([
      ...criteria,
      { id: `criterio_${criteria.length + 1}`, label: 'Novo critério', description: '', weight: 1 },
    ])
  }
  const remove = (index) => onChange(criteria.filter((_, i) => i !== index))

  return (
    <div className="space-y-3">
      {criteria.map((c, i) => (
        <div key={c.id || i} className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-md border border-white/10 bg-brand-900 px-2 py-1.5 text-sm"
              value={c.label}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder="Nome do critério"
            />
            <Button type="button" size="sm" variant="ghost" onClick={() => remove(i)} aria-label="Remover">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <textarea
            className="w-full rounded-md border border-white/10 bg-brand-900 px-2 py-1.5 text-sm min-h-[60px]"
            value={c.description || ''}
            onChange={(e) => update(i, { description: e.target.value })}
            placeholder="O que a IA deve avaliar neste critério?"
          />
        </div>
      ))}
      <Button type="button" size="sm" variant="secondary" onClick={add}>
        <Plus className="h-4 w-4 mr-1" /> Adicionar critério
      </Button>
    </div>
  )
}

export function ConversationAnalysis() {
  const toast = useToast()
  const { user, isOrgOwner } = useAuth()
  const [aiOk, setAiOk] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [profile, setProfile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [members, setMembers] = useState([])
  const [selectedSellers, setSelectedSellers] = useState([])
  const [periodDays, setPeriodDays] = useState('30')
  const [run, setRun] = useState(null)
  const [results, setResults] = useState([])
  const [tab, setTab] = useState('summary')
  const [expandedId, setExpandedId] = useState(null)
  const [loading, setLoading] = useState(true)

  const sellers = useMemo(() => {
    if (!isOrgOwner) return [{ userId: user?.id, name: user?.name || 'Você' }]
    return members.filter((m) => m.role === 'SELLER' || m.role === 'OWNER')
  }, [isOrgOwner, members, user])

  const loadProfiles = useCallback(async () => {
    let data = await fetchAnalysisProfiles()
    if (!data.profiles?.length) {
      const created = await createDefaultAnalysisProfile()
      if (created.profile) data = { profiles: [created.profile] }
    }
    setProfiles(data.profiles || [])
    if (data.profiles?.[0]) setProfile(data.profiles[0])
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [status, mem] = await Promise.all([
          getAnalysisStatus(),
          isOrgOwner ? fetchOrgMembers() : Promise.resolve({ members: [] }),
        ])
        if (cancelled) return
        setAiOk(status.aiConfigured)
        setMembers(mem.members || [])
        await loadProfiles()
      } catch (err) {
        toast.error(err?.response?.data?.message || 'Falha ao carregar análise.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isOrgOwner, loadProfiles, toast])

  useEffect(() => {
    if (!isOrgOwner && user?.id) setSelectedSellers([user.id])
  }, [isOrgOwner, user?.id])

  useEffect(() => {
    if (!run?.id || run.status !== 'running') return undefined
    const t = setInterval(async () => {
      try {
        const { run: fresh } = await getAnalysisRun(run.id)
        setRun(fresh)
        if (fresh?.status === 'done') {
          const res = await getAnalysisRunResults(fresh.id)
          setResults(res.results || [])
          toast.success('Análise concluída.')
        } else if (fresh?.status === 'error') {
          toast.error(fresh.error || 'Erro na análise.')
        }
      } catch {
        /* poll */
      }
    }, 2500)
    return () => clearInterval(t)
  }, [run, toast])

  const handleSaveProfile = async () => {
    if (!profile) return
    setSaving(true)
    try {
      const payload = {
        name: profile.name,
        criteria: profile.criteria,
        systemPrompt: profile.systemPrompt,
        model: profile.model,
        temperature: profile.temperature,
        minMessages: profile.minMessages,
        maxMessages: profile.maxMessages,
        locale: profile.locale,
      }
      const { profile: saved } = await saveAnalysisProfile(profile.id, payload)
      setProfile(saved)
      toast.success('Critérios salvos.')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  const handleRun = async () => {
    if (!profile?.id) return
    if (!aiOk) {
      toast.error('IA não configurada no servidor (OPENAI_API_KEY).')
      return
    }
    const sellerIds = isOrgOwner ? selectedSellers : [user.id]
    if (isOrgOwner && !sellerIds.length) {
      toast.error('Selecione ao menos um vendedor.')
      return
    }
    const days = Number(periodDays) || 30
    const periodTo = new Date().toISOString()
    const periodFrom = new Date(Date.now() - days * 86400000).toISOString()
    try {
      const { run: started } = await startAnalysisRun({
        profileId: profile.id,
        sellerUserIds: sellerIds,
        periodFrom,
        periodTo,
      })
      setRun(started)
      setResults([])
      setTab('summary')
      toast.info('Análise iniciada — isso pode levar alguns minutos.')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao iniciar análise.')
    }
  }

  const toggleSeller = (userId) => {
    setSelectedSellers((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    )
  }

  const narrative = run?.sellerSummaries?.narrative
  const sellerRows = run?.sellerSummaries?.sellers || []
  const orgIssues = run?.sellerSummaries?.orgTopIssues || []

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin mr-2" /> Carregando…
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-white">
            <Brain className="h-6 w-6 text-accent-400" />
            Análise de conversas (IA)
          </h1>
          <p className="mt-1 text-sm text-slate-400 max-w-2xl">
            A IA analisa cada conversa dos vendedores selecionados, critério a critério, gera um resumo individual e um
            panorama geral de onde a equipe está errando.
          </p>
        </div>
        {!aiOk && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            Configure <code className="text-amber-200">OPENAI_API_KEY</code> no backend.
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1 space-y-4 p-4">
          <h2 className="font-medium text-white">Critérios de avaliação</h2>
          {profiles.length > 1 && (
            <Select
              value={profile?.id || ''}
              onChange={(e) => setProfile(profiles.find((p) => p.id === e.target.value))}
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
          {profile && (
            <>
              <CriteriaEditor
                criteria={profile.criteria || []}
                onChange={(criteria) => setProfile({ ...profile, criteria })}
              />
              <textarea
                className="w-full rounded-md border border-white/10 bg-brand-900 px-2 py-1.5 text-xs min-h-[80px]"
                value={profile.systemPrompt || ''}
                onChange={(e) => setProfile({ ...profile, systemPrompt: e.target.value })}
                placeholder="Instruções gerais para a IA auditora"
              />
              <Button size="sm" onClick={handleSaveProfile} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                <span className="ml-1">Salvar critérios</span>
              </Button>
            </>
          )}
        </Card>

        <Card className="lg:col-span-2 space-y-4 p-4">
          <h2 className="font-medium text-white flex items-center gap-2">
            <Users className="h-4 w-4" /> Vendedores e execução
          </h2>

          {isOrgOwner && (
            <div className="flex flex-wrap gap-2">
              {sellers.map((s) => (
                <button
                  key={s.userId}
                  type="button"
                  onClick={() => toggleSeller(s.userId)}
                  className={`rounded-full px-3 py-1 text-sm border transition ${
                    selectedSellers.includes(s.userId)
                      ? 'border-accent-400 bg-accent-500/20 text-accent-100'
                      : 'border-white/10 text-slate-400 hover:border-white/20'
                  }`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Período</label>
              <Select value={periodDays} onChange={(e) => setPeriodDays(e.target.value)}>
                <option value="7">Últimos 7 dias</option>
                <option value="30">Últimos 30 dias</option>
                <option value="90">Últimos 90 dias</option>
              </Select>
            </div>
            <Button onClick={handleRun} disabled={!aiOk || run?.status === 'running'}>
              {run?.status === 'running' ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Play className="h-4 w-4 mr-1" />
              )}
              Analisar conversas
            </Button>
          </div>

          {run && (
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
              <div className="flex justify-between text-slate-300 mb-2">
                <span>Status: {run.status}</span>
                <span>
                  {run.doneConversations}/{run.totalConversations} conversas
                </span>
              </div>
              {run.totalConversations > 0 && (
                <div className="h-2 rounded-full bg-brand-800 overflow-hidden">
                  <div
                    className="h-full bg-accent-500 transition-all"
                    style={{ width: `${Math.min(100, (run.doneConversations / run.totalConversations) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {run?.status === 'done' && (
        <>
          <div className="flex gap-2 border-b border-white/10 pb-2">
            <button
              type="button"
              className={`px-3 py-1.5 text-sm rounded-md ${tab === 'summary' ? 'bg-accent-500/20 text-accent-100' : 'text-slate-400'}`}
              onClick={() => setTab('summary')}
            >
              Resumo geral
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 text-sm rounded-md ${tab === 'conversations' ? 'bg-accent-500/20 text-accent-100' : 'text-slate-400'}`}
              onClick={() => setTab('conversations')}
            >
              Por conversa ({results.length})
            </button>
          </div>

          {tab === 'summary' && (
            <div className="space-y-4">
              {narrative && (
                <Card className="p-4">
                  <h3 className="font-medium text-white mb-2">Onde a equipe está errando</h3>
                  <p className="text-sm text-slate-300 whitespace-pre-line">{narrative}</p>
                </Card>
              )}
              {orgIssues.length > 0 && (
                <Card className="p-4">
                  <h3 className="font-medium text-white mb-3 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                    Falhas mais frequentes
                  </h3>
                  <ul className="space-y-2">
                    {orgIssues.map((issue) => (
                      <li key={issue.criterionId} className="flex justify-between text-sm text-slate-300">
                        <span>{issue.label}</span>
                        <span className="text-rose-300">{issue.count} ocorrências</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                {sellerRows.map((s) => (
                  <Card key={s.userId} className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-medium text-white">{s.sellerName}</h4>
                      <ScoreBadge score={s.overallAvg} />
                    </div>
                    <p className="text-xs text-slate-500 mb-2">{s.conversationCount} conversa(s) analisada(s)</p>
                    {s.topFailureAreas?.length > 0 && (
                      <ul className="text-sm text-slate-400 space-y-1">
                        {s.topFailureAreas.slice(0, 4).map((f) => (
                          <li key={f.criterionId}>
                            {f.label}: <span className="text-rose-300">{f.count}x</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          )}

          {tab === 'conversations' && (
            <div className="space-y-3">
              {results.length === 0 && (
                <p className="text-slate-500 text-sm">Nenhum resultado neste lote.</p>
              )}
              {results.map((r) => (
                <Card key={r.id} className="p-4">
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-slate-500" />
                        <span className="font-medium text-white">{r.contactName || 'Contato'}</span>
                        <ScoreBadge score={r.overallScore} />
                      </div>
                      <div className="flex items-center gap-2 text-slate-500 text-xs">
                        {r.messageCount} msgs
                        {expandedId === r.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-slate-400 line-clamp-2">{r.summary}</p>
                  </button>
                  {expandedId === r.id && (
                    <div className="mt-4 pt-4 border-t border-white/10 space-y-3 text-sm">
                      <p className="text-slate-300">{r.summary}</p>
                      {r.weaknesses?.length > 0 && (
                        <div>
                          <p className="text-xs uppercase text-slate-500 mb-1">Pontos fracos</p>
                          <ul className="list-disc pl-4 text-slate-400">
                            {r.weaknesses.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {r.failures?.length > 0 && (
                        <div>
                          <p className="text-xs uppercase text-slate-500 mb-1">Falhas identificadas</p>
                          <ul className="space-y-2">
                            {r.failures.map((f, i) => (
                              <li key={i} className="rounded-md bg-rose-500/10 border border-rose-500/20 p-2">
                                <p className="text-rose-200">{f.issue}</p>
                                {f.quote && <p className="text-slate-500 italic mt-1">&ldquo;{f.quote}&rdquo;</p>}
                                {f.suggestion && <p className="text-emerald-300/90 mt-1">→ {f.suggestion}</p>}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <Link
                        to={`/dashboard/chat?conversation=${r.conversationId}`}
                        className="text-accent-400 hover:underline text-xs"
                      >
                        Abrir conversa no chat
                      </Link>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
