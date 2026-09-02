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
  Download,
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
  fetchAnalysisDefaults,
  previewAnalysisRun,
} from '../../services/api.js'
import { downloadGeneralReport, downloadSellerReport } from '../../lib/analysisReportExport.js'

function formatYmd(date) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

function presetRange(days) {
  const to = new Date()
  const from = new Date(Date.now() - days * 86400000)
  return { dateFrom: formatYmd(from), dateTo: formatYmd(to) }
}

function toPeriodIso(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return null
  const fromTs = new Date(`${dateFrom}T00:00:00`).getTime()
  const toTs = new Date(`${dateTo}T23:59:59.999`).getTime()
  if (Number.isNaN(fromTs) || Number.isNaN(toTs) || fromTs > toTs) return null
  return {
    periodFrom: new Date(fromTs).toISOString(),
    periodTo: new Date(toTs).toISOString(),
  }
}

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
  const { user, isOrgOwner, isImpersonating, impersonation } = useAuth()
  const [aiOk, setAiOk] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [profile, setProfile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [members, setMembers] = useState([])
  const [selectedSellers, setSelectedSellers] = useState([])
  const initialRange = presetRange(7)
  const [periodMode, setPeriodMode] = useState('7')
  const [dateFrom, setDateFrom] = useState(initialRange.dateFrom)
  const [dateTo, setDateTo] = useState(initialRange.dateTo)
  const [maxConversations, setMaxConversations] = useState('50')
  const [preview, setPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [run, setRun] = useState(null)
  const [results, setResults] = useState([])
  const [tab, setTab] = useState('summary')
  const [expandedId, setExpandedId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [exportingGeneral, setExportingGeneral] = useState(false)
  const [exportingSellerId, setExportingSellerId] = useState(null)

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

  const sellerIdsForRun = useMemo(
    () => (isOrgOwner ? selectedSellers : user?.id ? [user.id] : []),
    [isOrgOwner, selectedSellers, user?.id],
  )

  const periodIso = useMemo(() => toPeriodIso(dateFrom, dateTo), [dateFrom, dateTo])

  const parsedMaxConversations = useMemo(() => {
    const n = Number(maxConversations)
    if (!maxConversations.trim() || !Number.isFinite(n) || n < 1) return undefined
    return Math.min(500, Math.floor(n))
  }, [maxConversations])

  useEffect(() => {
    if (!profile?.id || !periodIso || !sellerIdsForRun.length) {
      setPreview(null)
      return undefined
    }
    let cancelled = false
    const t = setTimeout(async () => {
      setPreviewLoading(true)
      try {
        const data = await previewAnalysisRun({
          profileId: profile.id,
          sellerUserIds: sellerIdsForRun,
          periodFrom: periodIso.periodFrom,
          periodTo: periodIso.periodTo,
          maxConversations: parsedMaxConversations,
        })
        if (!cancelled) setPreview(data)
      } catch {
        if (!cancelled) setPreview(null)
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }, 450)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [profile?.id, periodIso, sellerIdsForRun, parsedMaxConversations])

  const applyPeriodPreset = (mode) => {
    setPeriodMode(mode)
    if (mode === 'custom') return
    const range = presetRange(Number(mode) || 7)
    setDateFrom(range.dateFrom)
    setDateTo(range.dateTo)
  }

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

  const handleRestoreDefaults = async () => {
    if (!profile) return
    try {
      const { criteria, systemPrompt } = await fetchAnalysisDefaults()
      setProfile({ ...profile, criteria, systemPrompt })
      toast.success('Critérios padrão carregados. Clique em Salvar para persistir.')
    } catch {
      toast.error('Falha ao carregar padrão.')
    }
  }

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
    if (!sellerIdsForRun.length) {
      toast.error('Selecione ao menos um vendedor.')
      return
    }
    if (!periodIso) {
      toast.error('Informe um período válido (data inicial e final).')
      return
    }
    if (preview && preview.willAnalyze === 0) {
      toast.error('Nenhuma conversa elegível no período selecionado.')
      return
    }
    try {
      const payload = {
        profileId: profile.id,
        sellerUserIds: sellerIdsForRun,
        periodFrom: periodIso.periodFrom,
        periodTo: periodIso.periodTo,
      }
      if (parsedMaxConversations) payload.maxConversations = parsedMaxConversations
      const { run: started } = await startAnalysisRun(payload)
      setRun(started)
      setResults([])
      setTab('summary')
      toast.info(
        `Análise iniciada — ${preview?.willAnalyze ?? '…'} conversa(s). Isso pode levar alguns minutos.`,
      )
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
  const accountName = impersonation?.name || user?.name || null

  const handleDownloadGeneral = async () => {
    if (!run?.id) return
    setExportingGeneral(true)
    try {
      const { results: allResults } = await getAnalysisRunResults(run.id, { limit: 500 })
      downloadGeneralReport({
        run,
        profile,
        results: allResults?.length ? allResults : results,
        accountName,
      })
      toast.success('Relatório geral baixado.')
    } catch {
      toast.error('Falha ao gerar relatório.')
    } finally {
      setExportingGeneral(false)
    }
  }

  const handleDownloadSeller = async (seller) => {
    if (!run?.id || !seller?.userId) return
    setExportingSellerId(seller.userId)
    try {
      const { results: sellerResults } = await getAnalysisRunResults(run.id, {
        sellerUserId: seller.userId,
        limit: 500,
      })
      downloadSellerReport({
        run,
        profile,
        seller,
        results: sellerResults || [],
        accountName,
      })
      toast.success(`Relatório de ${seller.sellerName} baixado.`)
    } catch {
      toast.error('Falha ao gerar relatório.')
    } finally {
      setExportingSellerId(null)
    }
  }

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

      {isImpersonating && (
        <div className="rounded-lg border border-accent-500/30 bg-accent-500/10 px-4 py-3 text-sm text-accent-100">
          Modo admin — analisando o atendimento da conta{' '}
          <strong>{impersonation?.name || user?.name}</strong>.
        </div>
      )}

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
                className="w-full rounded-md border border-white/10 bg-brand-900 px-2 py-1.5 text-xs min-h-[200px]"
                value={profile.systemPrompt || ''}
                onChange={(e) => setProfile({ ...profile, systemPrompt: e.target.value })}
                placeholder="Instruções gerais para a IA auditora"
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" type="button" onClick={handleRestoreDefaults}>
                  Restaurar padrão atacado
                </Button>
                <Button size="sm" onClick={handleSaveProfile} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  <span className="ml-1">Salvar critérios</span>
                </Button>
              </div>
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

          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Período</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {[
                  { id: '7', label: '7 dias' },
                  { id: '30', label: '30 dias' },
                  { id: '90', label: '90 dias' },
                  { id: 'custom', label: 'Personalizado' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => applyPeriodPreset(opt.id)}
                    className={`rounded-full px-3 py-1 text-sm border transition ${
                      periodMode === opt.id
                        ? 'border-accent-400 bg-accent-500/20 text-accent-100'
                        : 'border-white/10 text-slate-400 hover:border-white/20'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">De</label>
                  <input
                    type="date"
                    className="rounded-md border border-white/10 bg-brand-900 px-2 py-1.5 text-sm text-white"
                    value={dateFrom}
                    onChange={(e) => {
                      setDateFrom(e.target.value)
                      setPeriodMode('custom')
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Até</label>
                  <input
                    type="date"
                    className="rounded-md border border-white/10 bg-brand-900 px-2 py-1.5 text-sm text-white"
                    value={dateTo}
                    onChange={(e) => {
                      setDateTo(e.target.value)
                      setPeriodMode('custom')
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">Máx. conversas</label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    placeholder="Todas"
                    className="w-28 rounded-md border border-white/10 bg-brand-900 px-2 py-1.5 text-sm text-white"
                    value={maxConversations}
                    onChange={(e) => setMaxConversations(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Limite de até 500 conversas por execução. Deixe vazio ou 0 para analisar todas no período.
              </p>
            </div>

            {(previewLoading || preview) && (
              <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300">
                {previewLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Contando conversas…
                  </span>
                ) : preview?.willAnalyze === 0 ? (
                  'Nenhuma conversa elegível no período (mínimo 2 mensagens humanas).'
                ) : preview?.capped ? (
                  <>
                    <strong>{preview.willAnalyze}</strong> conversa(s) serão analisadas (de{' '}
                    <strong>{preview.totalEligible}</strong> elegíveis no período).
                  </>
                ) : (
                  <>
                    <strong>{preview?.willAnalyze ?? 0}</strong> conversa(s) elegíveis serão analisadas.
                  </>
                )}
              </div>
            )}

            <Button
              onClick={handleRun}
              disabled={!aiOk || run?.status === 'running' || previewLoading || !periodIso}
            >
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
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
            <div className="flex gap-2">
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
            <Button
              size="sm"
              variant="secondary"
              type="button"
              onClick={handleDownloadGeneral}
              disabled={exportingGeneral}
            >
              {exportingGeneral ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Download className="h-4 w-4 mr-1" />
              )}
              Baixar relatório geral
            </Button>
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
                    <div className="flex justify-between items-start mb-2 gap-2">
                      <h4 className="font-medium text-white">{s.sellerName}</h4>
                      <div className="flex items-center gap-2 shrink-0">
                        <ScoreBadge score={s.overallAvg} />
                        <Button
                          size="sm"
                          variant="ghost"
                          type="button"
                          title="Baixar relatório individual"
                          aria-label={`Baixar relatório de ${s.sellerName}`}
                          onClick={() => handleDownloadSeller(s)}
                          disabled={exportingSellerId === s.userId}
                        >
                          {exportingSellerId === s.userId ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
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
                    <div className="mt-4 pt-4 border-t border-white/10 space-y-4 text-sm">
                      {r.resumoGeral?.momentoCritico && (
                        <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3">
                          <p className="text-xs uppercase text-amber-200/80 mb-1">Momento crítico</p>
                          <p className="text-slate-200">{r.resumoGeral.momentoCritico}</p>
                        </div>
                      )}
                      {r.resumoGeral?.acaoPrioritaria && (
                        <div className="rounded-md border border-accent-500/20 bg-accent-500/10 p-3">
                          <p className="text-xs uppercase text-accent-200/80 mb-1">Ação prioritária</p>
                          <p className="text-slate-200">{r.resumoGeral.acaoPrioritaria}</p>
                        </div>
                      )}
                      {!r.resumoGeral?.momentoCritico && r.summary && (
                        <p className="text-slate-300">{r.summary}</p>
                      )}
                      {r.strengths?.length > 0 && (
                        <div>
                          <p className="text-xs uppercase text-slate-500 mb-1">Pontos fortes</p>
                          <ul className="list-disc pl-4 text-emerald-300/90">
                            {r.strengths.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        </div>
                      )}
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
                      {r.scores && Object.keys(r.scores).length > 0 && (
                        <div>
                          <p className="text-xs uppercase text-slate-500 mb-2">Notas por critério</p>
                          <ul className="space-y-1">
                            {(profile?.criteria || []).map((c) => {
                              const nota = r.scores[c.id]
                              if (nota == null) return null
                              return (
                                <li key={c.id} className="flex justify-between text-slate-300">
                                  <span>{c.label}</span>
                                  <ScoreBadge score={nota} />
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      )}
                      {r.failures?.length > 0 && (
                        <div>
                          <p className="text-xs uppercase text-slate-500 mb-2">Análise por critério</p>
                          <ul className="space-y-3">
                            {r.failures.map((f, i) => (
                              <li key={i} className="rounded-md bg-white/5 border border-white/10 p-3">
                                <div className="flex justify-between items-start gap-2 mb-1">
                                  <p className="font-medium text-white">{f.criterionName || f.criterionId}</p>
                                  {f.nota != null && <ScoreBadge score={f.nota} />}
                                </div>
                                {f.issue && <p className="text-slate-300">{f.issue}</p>}
                                {f.positiveQuote && (
                                  <p className="text-emerald-300/90 italic mt-2 text-xs">
                                    ✓ &ldquo;{f.positiveQuote}&rdquo;
                                  </p>
                                )}
                                {f.quote && (
                                  <p className="text-rose-300/90 italic mt-1 text-xs">
                                    ✗ &ldquo;{f.quote}&rdquo;
                                  </p>
                                )}
                                {f.suggestion && (
                                  <p className="text-accent-300/90 mt-2 text-xs">→ {f.suggestion}</p>
                                )}
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
