import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Settings2, Check, Download } from 'lucide-react'
import { Card } from '../../components/common/Card.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Skeleton } from '../../components/common/Skeleton.jsx'
import { discoverGroups, getGroups, selectGroups, setGroupsStatus } from '../../services/api.js'
import { useToast } from '../../contexts/ToastContext.jsx'

const MESSAGE_SYNC_LABELS = {
  IDLE: null,
  QUEUED: { label: 'na fila', variant: 'muted' },
  SYNCING: { label: 'baixando…', variant: 'warning' },
  READY: { label: 'importado', variant: 'success' },
  RATE_LIMITED: { label: 'em espera', variant: 'warning' },
  ERROR: { label: 'erro', variant: 'muted' },
}

export function Groups() {
  const toast = useToast()
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('ativos')
  const [q, setQ] = useState('')
  const [sync, setSync] = useState(null)
  const [imp, setImp] = useState(null)
  const [nowMs, setNowMs] = useState(0)
  const [actionLoading, setActionLoading] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const initializedSelection = useRef(false)

  const applyData = useCallback((data) => {
    const nextGroups = data.groups || []
    setGroups(nextGroups)
    setSync(data.sync || null)
    setImp(data.import || null)
    if (!initializedSelection.current) {
      const monitored = nextGroups.filter((g) => g.monitoringEnabled && g.status === 'ativo').map((g) => g.id)
      if (monitored.length) setSelected(new Set(monitored))
      initializedSelection.current = true
    }
  }, [])

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    try {
      const { data } = await getGroups()
      applyData(data)
    } catch (e) {
      const msg = e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Não foi possível carregar os grupos.'
      toast.error(typeof msg === 'string' ? msg : 'Não foi possível carregar os grupos.')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [applyData, toast])

  const startDiscover = useCallback(async () => {
    setActionLoading(true)
    try {
      const { data } = await discoverGroups()
      applyData(data)
      toast.info(data.sync?.message || 'Busca de grupos iniciada.')
    } catch (e) {
      const msg = e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Não foi possível procurar grupos.'
      toast.error(typeof msg === 'string' ? msg : 'Não foi possível procurar grupos.')
    } finally {
      setActionLoading(false)
    }
  }, [applyData, toast])

  const startImport = useCallback(async () => {
    const groupIds = Array.from(selected)
    if (!groupIds.length) {
      toast.info('Selecione ao menos um grupo para conectar.')
      return
    }
    setActionLoading(true)
    try {
      const { data } = await selectGroups(groupIds)
      applyData(data)
      toast.info(data.import?.message || 'Importação de mensagens iniciada.')
    } catch (e) {
      const msg = e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Não foi possível iniciar a importação.'
      toast.error(typeof msg === 'string' ? msg : 'Não foi possível iniciar a importação.')
    } finally {
      setActionLoading(false)
    }
  }, [applyData, selected, toast])

  const changeStatus = useCallback(async (status) => {
    const groupIds = Array.from(selected)
    if (!groupIds.length) {
      toast.info('Selecione ao menos um grupo.')
      return
    }
    setActionLoading(true)
    try {
      const { data } = await setGroupsStatus(groupIds, status)
      applyData(data)
      setSelected(new Set())
      toast.success(`${groupIds.length} grupo(s) marcado(s) como ${status}.`)
    } catch (e) {
      const msg = e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Não foi possível atualizar o status.'
      toast.error(typeof msg === 'string' ? msg : 'Não foi possível atualizar o status.')
    } finally {
      setActionLoading(false)
    }
  }, [applyData, selected, toast])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    setNowMs(Date.now())
    const timer = window.setInterval(() => setNowMs(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  const discoverActive = ['QUEUED', 'DISCOVERING_GROUPS', 'FETCHING_GROUPS'].includes(sync?.status)
  const importActive = ['QUEUED', 'RUNNING'].includes(imp?.status)
  const syncRetryMs = sync?.retryAfter ? new Date(sync.retryAfter).getTime() : 0
  const importRetryMs = imp?.retryAfter ? new Date(imp.retryAfter).getTime() : 0
  const inCooldown =
    (sync?.status === 'RATE_LIMITED' && syncRetryMs > nowMs) ||
    (imp?.status === 'RATE_LIMITED' && importRetryMs > nowMs)
  const discoveredCount = sync?.groupsCount || groups.length
  const busy = discoverActive || importActive

  useEffect(() => {
    if (!busy) return undefined
    const timer = window.setInterval(() => load({ silent: true }), 3000)
    return () => window.clearInterval(timer)
  }, [busy, load])

  const toggleSelect = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const filtered = useMemo(() => {
    return groups.filter((g) => {
      if (filter === 'ativos' && g.status !== 'ativo') return false
      if (filter === 'inativos' && g.status !== 'inativo') return false
      if (q && !g.name.toLowerCase().includes(q.toLowerCase())) return false
      return true
    })
  }, [groups, filter, q])

  const selectAll = useCallback(() => setSelected(new Set(filtered.map((g) => g.id))), [filtered])
  const clearAll = useCallback(() => setSelected(new Set()), [])

  const importProgress = imp?.total ? Math.round((imp.done / imp.total) * 100) : 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-stone-50">Seus grupos</h2>
          <p className="text-sm text-stone-400 mt-1">1) Procure os grupos. 2) Selecione. 3) Conecte para importar os últimos {imp?.backfillDays || 2} dias.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="secondary"
            className="gap-2 shrink-0"
            onClick={startDiscover}
            disabled={loading || actionLoading || busy || inCooldown}
          >
            <RefreshCw className={`h-4 w-4 ${discoverActive || actionLoading ? 'animate-spin' : ''}`} />
            {discoverActive ? 'Procurando…' : inCooldown ? 'Aguardando cooldown' : 'Procurar grupos'}
          </Button>
          <Button
            className="gap-2 shrink-0"
            onClick={startImport}
            disabled={loading || actionLoading || busy || inCooldown || selected.size === 0}
          >
            <Download className={`h-4 w-4 ${importActive ? 'animate-pulse' : ''}`} />
            {importActive ? 'Importando…' : `Conectar e importar (${selected.size})`}
          </Button>
        </div>
      </div>

      {sync && (sync.status !== 'IDLE' || groups.length === 0) && (
        <Card className="border-brand-700/70 bg-brand-900/60">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-stone-100">
                Mapeamento: {sync.status === 'GROUPS_FOUND' ? 'grupos encontrados' : sync.status === 'RATE_LIMITED' ? 'em espera' : sync.status?.toLowerCase?.() || 'pendente'}
              </p>
              <p className="mt-1 text-xs text-stone-400">{sync.message || 'Clique em Procurar grupos para mapear sua conta sem baixar mensagens.'}</p>
              {sync.error && <p className="mt-1 break-words text-xs text-red-400">Detalhe do erro: {sync.error}</p>}
              {sync.status === 'RATE_LIMITED' && sync.retryAfter && (
                <p className="mt-1 text-xs text-amber-300">
                  Próxima tentativa: {new Date(sync.retryAfter).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
            <div className="min-w-40">
              <div className="h-2 overflow-hidden rounded-full bg-brand-800">
                <div className="h-full rounded-full bg-accent-400 transition-all" style={{ width: `${Math.max(0, Math.min(100, sync.progress || 0))}%` }} />
              </div>
              <p className="mt-1 text-right text-xs text-stone-500">{discoveredCount} grupos mapeados</p>
            </div>
          </div>
        </Card>
      )}

      {imp && imp.total > 0 && (
        <Card className="border-emerald-700/40 bg-emerald-950/20">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-stone-100">
                Importando mensagens — {imp.done}/{imp.total} grupos {importActive ? 'carregando…' : ''}
              </p>
              <p className="mt-1 text-xs text-stone-400">{imp.message || `Baixando os últimos ${imp.backfillDays || 2} dias, um grupo por vez.`}</p>
              {imp.error && <p className="mt-1 break-words text-xs text-red-400">Detalhe do erro: {imp.error}</p>}
              {imp.retryAfter && imp.status === 'RATE_LIMITED' && (
                <p className="mt-1 text-xs text-amber-300">
                  Pausado por limite do WhatsApp. Retomar após {new Date(imp.retryAfter).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
            <div className="min-w-40">
              <div className="h-2 overflow-hidden rounded-full bg-brand-800">
                <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${importProgress}%` }} />
              </div>
              <p className="mt-1 text-right text-xs text-stone-500">{importProgress}%</p>
            </div>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          {[
            { id: 'ativos', label: 'Ativos' },
            { id: 'inativos', label: 'Inativos' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                filter === f.id ? 'bg-accent-500/15 text-accent-400 border border-accent-500/30' : 'text-stone-400 border border-transparent hover:bg-white/5'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-1 items-center gap-2 sm:max-w-md">
          <Input placeholder="Buscar por nome..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-stone-400">
          <span>{selected.size} selecionado(s)</span>
          <button type="button" className="text-accent-400 hover:underline" onClick={selectAll}>Selecionar todos</button>
          <button type="button" className="text-stone-400 hover:underline" onClick={clearAll}>Limpar</button>
          {selected.size > 0 && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" disabled={actionLoading} onClick={() => changeStatus('ativo')}>
                Marcar ativo
              </Button>
              <Button size="sm" variant="ghost" className="border border-brand-700" disabled={actionLoading} onClick={() => changeStatus('inativo')}>
                Marcar inativo
              </Button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <div className="py-10 text-center">
            <p className="font-medium text-stone-200">
              {filter === 'ativos' && groups.some((g) => g.status !== 'ativo')
                ? 'Nenhum grupo ativo no momento.'
                : 'Nenhum grupo encontrado ainda.'}
            </p>
            <p className="mt-2 text-sm text-stone-400">
              {filter === 'ativos' && groups.some((g) => g.status !== 'ativo') ? (
                <>
                  Você tem grupos inativos na aba <strong>Inativos</strong>. Selecione um grupo lá e use{' '}
                  <strong>Marcar ativo</strong>, ou procure novos grupos.
                </>
              ) : (
                <>
                  Se o WhatsApp acabou de conectar, clique em Procurar grupos. Depois selecione e clique em Conectar e
                  importar.
                </>
              )}
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((g) => {
            const isSelected = selected.has(g.id)
            const msgStatus = MESSAGE_SYNC_LABELS[g.messageSyncStatus] || null
            return (
              <Card key={g.id} className={isSelected ? 'ring-1 ring-accent-500/40' : ''}>
                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => toggleSelect(g.id)}
                    aria-label={isSelected ? 'Remover seleção' : 'Selecionar grupo'}
                    className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition ${
                      isSelected ? 'border-accent-400 bg-accent-500/20 text-accent-300' : 'border-brand-600 text-transparent hover:border-brand-500'
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <img src={g.image} alt="" className="h-14 w-14 shrink-0 rounded-xl border border-brand-700 bg-brand-800" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-stone-50 truncate">{g.name}</h3>
                      <Badge variant={g.status === 'ativo' ? 'success' : g.status === 'pendente' ? 'warning' : 'muted'}>{g.status}</Badge>
                      {g.monitoringEnabled && msgStatus && <Badge variant={msgStatus.variant}>{msgStatus.label}</Badge>}
                    </div>
                    <p className="text-xs text-stone-500 mt-1">
                      {g.memberCount} membros{g.messagesSyncedCount ? ` · ${g.messagesSyncedCount} msgs` : ''}
                    </p>
                    {g.messageSyncStatus === 'SYNCING' && (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-800">
                        <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${Math.max(5, Math.min(100, g.messageSyncProgress || 0))}%` }} />
                      </div>
                    )}
                    <p className="text-sm text-stone-400 mt-2 line-clamp-2">&ldquo;{g.lastMessage}&rdquo;</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link to={`/dashboard/groups/${encodeURIComponent(g.id)}`}>
                        <Button size="sm" variant="secondary">Ver detalhes</Button>
                      </Link>
                      <Link to={`/dashboard/groups/${encodeURIComponent(g.id)}?tab=config`}>
                        <Button size="sm" variant="ghost" className="gap-1 border border-brand-700">
                          <Settings2 className="h-3.5 w-3.5" /> Configurar
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
