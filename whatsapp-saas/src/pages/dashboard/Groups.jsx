import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Settings2 } from 'lucide-react'
import { Card } from '../../components/common/Card.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Skeleton } from '../../components/common/Skeleton.jsx'
import { discoverGroups, getGroups, syncGroups } from '../../services/api.js'
import { useToast } from '../../contexts/ToastContext.jsx'

export function Groups() {
  const toast = useToast()
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('todos')
  const [q, setQ] = useState('')
  const [sync, setSync] = useState(null)
  const [nowMs, setNowMs] = useState(0)
  const [actionLoading, setActionLoading] = useState(false)

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    try {
      const { data } = await getGroups()
      setGroups(data.groups || [])
      setSync(data.sync || null)
    } catch (e) {
      const msg =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        'Não foi possível carregar os grupos.'
      toast.error(typeof msg === 'string' ? msg : 'Não foi possível carregar os grupos.')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [toast])

  const startDiscover = useCallback(async () => {
    setActionLoading(true)
    try {
      const { data } = await discoverGroups()
      setGroups(data.groups || [])
      setSync(data.sync || null)
      toast.info(data.sync?.message || 'Busca de grupos iniciada.')
    } catch (e) {
      const msg =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        'Não foi possível procurar grupos.'
      toast.error(typeof msg === 'string' ? msg : 'Não foi possível procurar grupos.')
    } finally {
      setActionLoading(false)
    }
  }, [toast])

  const startSync = useCallback(async () => {
    setActionLoading(true)
    try {
      const { data } = await syncGroups()
      setGroups(data.groups || [])
      setSync(data.sync || null)
      toast.info(data.sync?.message || 'Sincronização de grupos iniciada.')
    } catch (e) {
      const msg =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        'Não foi possível iniciar a sincronização.'
      toast.error(typeof msg === 'string' ? msg : 'Não foi possível iniciar a sincronização.')
    } finally {
      setActionLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    setNowMs(Date.now())
    if (!sync?.retryAfter) return undefined
    const timer = window.setInterval(() => setNowMs(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [sync?.retryAfter])

  const discoverActive = ['QUEUED', 'DISCOVERING_GROUPS', 'FETCHING_GROUPS'].includes(sync?.status)
  const cacheSyncActive = ['SAVING_GROUPS', 'SYNCING_GROUPS'].includes(sync?.status)
  const syncActive = discoverActive || cacheSyncActive
  const retryAtMs = sync?.retryAfter ? new Date(sync.retryAfter).getTime() : 0
  const inCooldown = sync?.status === 'RATE_LIMITED' && retryAtMs > nowMs
  const discoveredCount = sync?.groupsCount || groups.length

  useEffect(() => {
    if (!syncActive) return undefined
    const timer = window.setInterval(() => {
      load({ silent: true })
    }, 3000)
    return () => window.clearInterval(timer)
  }, [load, syncActive])

  const filtered = useMemo(() => {
    return groups.filter((g) => {
      if (filter === 'ativos' && g.status !== 'ativo') return false
      if (filter === 'inativos' && g.status !== 'inativo') return false
      if (q && !g.name.toLowerCase().includes(q.toLowerCase())) return false
      return true
    })
  }, [groups, filter, q])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-stone-50">Seus grupos</h2>
          <p className="text-sm text-stone-400 mt-1">Gerencie comunidades e acompanhe a última atividade.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="secondary"
            className="gap-2 shrink-0"
            onClick={startDiscover}
            disabled={loading || actionLoading || syncActive || inCooldown}
          >
            <RefreshCw className={`h-4 w-4 ${discoverActive || actionLoading ? 'animate-spin' : ''}`} />
            {discoverActive ? 'Procurando...' : inCooldown ? 'Aguardando cooldown' : 'Procurar grupos'}
          </Button>
          <Button
            className="gap-2 shrink-0"
            onClick={startSync}
            disabled={loading || actionLoading || syncActive || !discoveredCount}
          >
            <RefreshCw className={`h-4 w-4 ${cacheSyncActive ? 'animate-spin' : ''}`} />
            {cacheSyncActive ? 'Sincronizando...' : `Sincronizar ${discoveredCount || 0} grupos`}
          </Button>
        </div>
      </div>

      {sync && (
        <Card className="border-brand-700/70 bg-brand-900/60">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-stone-100">
                Grupos: {sync.status === 'GROUPS_FOUND' ? 'encontrados' : sync.status === 'READY' ? 'sincronizados' : sync.status === 'RATE_LIMITED' ? 'em espera' : sync.status?.toLowerCase?.() || 'pendente'}
              </p>
              <p className="mt-1 text-xs text-stone-400">
                {sync.message || 'O Vesto usa cache local para evitar excesso de chamadas à Evolution.'}
              </p>
              {sync.retryAfter && (
                <p className="mt-1 text-xs text-amber-300">
                  Próxima tentativa recomendada: {new Date(sync.retryAfter).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
              {syncActive && (
                <p className="mt-1 text-xs text-emerald-300">
                  Os grupos aparecerão abaixo conforme forem salvos no cache.
                </p>
              )}
              <p className="mt-1 text-xs text-stone-500">
                Não puxamos histórico antigo. Mensagens novas ficam para eventos/webhook a partir da conexão.
              </p>
            </div>
            <div className="min-w-40">
              <div className="h-2 overflow-hidden rounded-full bg-brand-800">
                <div className="h-full rounded-full bg-accent-400 transition-all" style={{ width: `${Math.max(0, Math.min(100, sync.progress || 0))}%` }} />
              </div>
              <p className="mt-1 text-right text-xs text-stone-500">{sync.groupsCount || groups.length} grupos em cache</p>
            </div>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex gap-2">
          {[
            { id: 'todos', label: 'Todos' },
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
        <div className="flex-1 max-w-md">
          <Input placeholder="Buscar por nome..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <div className="py-10 text-center">
            <p className="font-medium text-stone-200">Nenhum grupo encontrado ainda.</p>
            <p className="mt-2 text-sm text-stone-400">
              Se o WhatsApp acabou de conectar, clique em Procurar grupos. Depois o Vesto libera Sincronizar X grupos.
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((g) => (
            <Card key={g.id}>
              <div className="flex gap-4">
                <img src={g.image} alt="" className="h-14 w-14 shrink-0 rounded-xl border border-brand-700 bg-brand-800" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-stone-50 truncate">{g.name}</h3>
                    <Badge variant={g.status === 'ativo' ? 'success' : g.status === 'pendente' ? 'warning' : 'muted'}>{g.status}</Badge>
                  </div>
                  <p className="text-xs text-stone-500 mt-1">{g.memberCount} membros</p>
                  <p className="text-sm text-stone-400 mt-2 line-clamp-2">&ldquo;{g.lastMessage}&rdquo;</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link to={`/dashboard/groups/${encodeURIComponent(g.id)}`}>
                      <Button size="sm" variant="secondary">
                        Ver detalhes
                      </Button>
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
          ))}
        </div>
      )}
    </div>
  )
}
