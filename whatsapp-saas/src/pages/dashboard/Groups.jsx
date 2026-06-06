import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Settings2, Check } from 'lucide-react'
import { Card } from '../../components/common/Card.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Skeleton } from '../../components/common/Skeleton.jsx'
import { discoverGroups, getGroups, setGroupsStatus } from '../../services/api.js'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'

const DEFAULT_MAX_GROUPS = 50

function isMonitoredGroup(g) {
  return g.status === 'ativo' && g.monitoringEnabled
}

function isPendingGroup(g) {
  return g.status === 'pendente' || (g.status === 'ativo' && !g.monitoringEnabled)
}

function groupDisplayStatus(g) {
  if (isMonitoredGroup(g)) return 'ativo'
  if (g.status === 'inativo') return 'inativo'
  return 'pendente'
}

function groupStatusBadgeVariant(g) {
  if (isMonitoredGroup(g)) return 'success'
  if (g.status === 'inativo') return 'muted'
  return 'warning'
}

export function Groups() {
  const toast = useToast()
  const { user } = useAuth()
  const [groups, setGroups] = useState([])
  const [limits, setLimits] = useState(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('ativos')
  const [q, setQ] = useState('')
  const [sync, setSync] = useState(null)
  const [nowMs, setNowMs] = useState(0)
  const [actionLoading, setActionLoading] = useState(false)
  const [selected, setSelected] = useState(() => new Set())
  const initializedSelection = useRef(false)

  const applyData = useCallback((data) => {
    const nextGroups = data.groups || []
    setGroups(nextGroups)
    setSync(data.sync || null)
    if (data.limits) setLimits(data.limits)
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

  const changeStatus = useCallback(async (status) => {
    const groupIds = Array.from(selected)
    if (!groupIds.length) {
      toast.info('Selecione ao menos um grupo.')
      return
    }
    if (status === 'ativo') {
      const maxGroups = limits?.maxGroups ?? user?.plan?.maxGroups ?? DEFAULT_MAX_GROUPS
      const monitored = limits?.monitored ?? groups.filter(isMonitoredGroup).length
      const alreadyMonitored = new Set(groups.filter(isMonitoredGroup).map((g) => g.id))
      const newActivations = groupIds.filter((id) => !alreadyMonitored.has(id)).length
      const remaining = Math.max(0, maxGroups - monitored)
      if (newActivations > remaining && remaining >= 0) {
        toast.info(
          remaining === 0
            ? `Limite de ${maxGroups} grupos atingido. Desative um grupo para liberar vaga.`
            : `Serão ativados no máximo ${remaining} de ${newActivations} grupo(s) novo(s) (limite ${maxGroups}).`,
        )
        if (remaining === 0) return
      }
    }
    setActionLoading(true)
    try {
      const { data } = await setGroupsStatus(groupIds, status)
      applyData(data)
      setSelected(new Set())
      if (data.message) {
        if (data.meta?.skipped) {
          toast.info(data.message)
        } else {
          toast.success(data.message)
        }
      } else {
        toast.success(`${groupIds.length} grupo(s) marcado(s) como ${status}.`)
      }
    } catch (e) {
      const msg = e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Não foi possível atualizar o status.'
      toast.error(typeof msg === 'string' ? msg : 'Não foi possível atualizar o status.')
    } finally {
      setActionLoading(false)
    }
  }, [applyData, selected, toast, limits, user, groups])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    setNowMs(Date.now())
    const timer = window.setInterval(() => setNowMs(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  const discoverActive = ['QUEUED', 'DISCOVERING_GROUPS', 'FETCHING_GROUPS'].includes(sync?.status)
  const syncRetryMs = sync?.retryAfter ? new Date(sync.retryAfter).getTime() : 0
  const inCooldown = sync?.status === 'RATE_LIMITED' && syncRetryMs > nowMs
  const discoveredCount = sync?.groupsCount || groups.length
  const busy = discoverActive

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

  const groupCounts = useMemo(
    () => ({
      ativos: groups.filter(isMonitoredGroup).length,
      pendentes: groups.filter(isPendingGroup).length,
      inativos: groups.filter((g) => g.status === 'inativo').length,
    }),
    [groups],
  )

  const maxGroups = limits?.maxGroups ?? user?.plan?.maxGroups ?? DEFAULT_MAX_GROUPS
  const monitoredCount = limits?.monitored ?? groupCounts.ativos
  const remainingSlots = Math.max(0, maxGroups - monitoredCount)
  const atLimit = remainingSlots === 0

  const filtered = useMemo(() => {
    return groups.filter((g) => {
      if (filter === 'ativos' && !isMonitoredGroup(g)) return false
      if (filter === 'pendentes' && !isPendingGroup(g)) return false
      if (filter === 'inativos' && g.status !== 'inativo') return false
      if (q && !g.name.toLowerCase().includes(q.toLowerCase())) return false
      return true
    })
  }, [groups, filter, q])

  const selectAll = useCallback(() => setSelected(new Set(filtered.map((g) => g.id))), [filtered])
  const clearAll = useCallback(() => setSelected(new Set()), [])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-stone-50">Seus grupos</h2>
          <p className="text-sm text-stone-400 mt-1">
            1) Procure os grupos. 2) Selecione. 3) Marque como <strong className="text-stone-300">ativo</strong> para monitorar
            mensagens, entradas e saídas a partir de agora.
          </p>
          <p className={`text-xs mt-2 ${atLimit ? 'text-amber-300' : 'text-stone-500'}`}>
            {monitoredCount} / {maxGroups} grupos monitorados
            {atLimit ? ' · limite atingido — desative um grupo para ativar outro' : remainingSlots < maxGroups ? ` · ${remainingSlots} vaga(s) restante(s)` : ''}
          </p>
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
        </div>
      </div>

      {sync && (sync.status !== 'IDLE' || groups.length === 0) && (
        <Card className="border-brand-700/70 bg-brand-900/60">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-stone-100">
                Mapeamento: {sync.status === 'GROUPS_FOUND' ? 'grupos encontrados' : sync.status === 'RATE_LIMITED' ? 'em espera' : sync.status?.toLowerCase?.() || 'pendente'}
              </p>
              <p className="mt-1 text-xs text-stone-400">{sync.message || 'Clique em Procurar grupos para mapear sua conta.'}</p>
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

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          {[
            { id: 'ativos', label: `Ativos (${groupCounts.ativos})` },
            { id: 'pendentes', label: `Pendentes (${groupCounts.pendentes})` },
            { id: 'inativos', label: `Inativos (${groupCounts.inativos})` },
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
              {filter === 'ativos' && groupCounts.pendentes > 0
                ? 'Nenhum grupo ativo no momento.'
                : filter === 'pendentes'
                  ? 'Nenhum grupo pendente.'
                  : filter === 'inativos'
                    ? 'Nenhum grupo inativo.'
                    : 'Nenhum grupo encontrado ainda.'}
            </p>
            <p className="mt-2 text-sm text-stone-400">
              {filter === 'ativos' && groupCounts.pendentes > 0 ? (
                <>
                  Grupos encontrados ficam em <strong>Pendentes</strong> até você marcar como <strong>ativo</strong>.
                </>
              ) : filter === 'pendentes' ? (
                <>Clique em <strong>Procurar grupos</strong> para mapear sua conta do WhatsApp.</>
              ) : filter === 'inativos' ? (
                <>Use <strong>Marcar inativo</strong> em grupos que não quer mais monitorar.</>
              ) : (
                <>Se o WhatsApp acabou de conectar, clique em <strong>Procurar grupos</strong> e depois marque como ativo.</>
              )}
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((g) => {
            const isSelected = selected.has(g.id)
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
                      <Badge variant={groupStatusBadgeVariant(g)}>{groupDisplayStatus(g)}</Badge>
                      {g.monitoringEnabled && g.status === 'ativo' && <Badge variant="success">Monitorando</Badge>}
                    </div>
                    <p className="text-xs text-stone-500 mt-1">{g.memberCount} membros</p>
                    {g.activatedAt && (
                      <p className="text-xs text-stone-600 mt-0.5">
                        Ativo desde {new Date(g.activatedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                      </p>
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
