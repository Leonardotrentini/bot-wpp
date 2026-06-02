import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users, LayoutGrid, UserPlus, UserMinus, Check, RefreshCw } from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { Card } from '../../components/common/Card.jsx'
import { Skeleton } from '../../components/common/Skeleton.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { Button } from '../../components/common/Button.jsx'
import { getOverview, getGroups, refreshOverview } from '../../services/api.js'
import { useToast } from '../../contexts/ToastContext.jsx'

function DataBanner({ meta }) {
  if (!meta) return null
  if (!meta.hasActivity) {
    return (
      <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200/90">
        Ainda não há mensagens desde que o grupo foi ativado. Novas mensagens entram automaticamente; use{' '}
        <strong>Atualizar</strong> para sincronizar entradas e saídas de membros.
      </p>
    )
  }
  return null
}

function GroupFilterBar({ groups, selectedIds, onChange }) {
  const connected = useMemo(
    () => groups.filter((g) => g.status === 'ativo' || g.monitoringEnabled),
    [groups],
  )
  const allSelected = selectedIds.length === 0

  function toggle(id) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id))
    } else {
      onChange([...selectedIds, id])
    }
  }

  if (!connected.length) {
    return (
      <p className="text-sm text-stone-500">
        Nenhum grupo conectado.{' '}
        <Link to="/dashboard/groups" className="text-accent-400 hover:underline">
          Ative um grupo
        </Link>
      </p>
    )
  }

  return (
    <div className="rounded-2xl border border-brand-800/80 bg-brand-950/40 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500 mb-3">Filtrar por grupo</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange([])}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition ${
            allSelected
              ? 'border-accent-500/60 bg-accent-500/15 text-accent-300'
              : 'border-brand-700 bg-black/40 text-stone-300 hover:border-brand-600 hover:text-stone-100'
          }`}
        >
          {allSelected && <Check className="h-3.5 w-3.5" />}
          Todos os conectados
        </button>
        {connected.map((g) => {
          const active = selectedIds.includes(g.id)
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => toggle(g.id)}
              className={`inline-flex max-w-[220px] items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition truncate ${
                active
                  ? 'border-accent-500/60 bg-accent-500/15 text-accent-300'
                  : 'border-brand-700 bg-black/40 text-stone-300 hover:border-brand-600 hover:text-stone-100'
              }`}
              title={g.name}
            >
              {active && <Check className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{g.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function MetricCard({ label, value, hint, icon: Icon }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-stone-400">{label}</p>
          <p className="mt-2 text-2xl font-bold text-stone-50 font-heading tabular-nums">{value}</p>
          {hint ? <p className="mt-1.5 text-xs text-stone-500 line-clamp-2">{hint}</p> : null}
        </div>
        <div className="shrink-0 rounded-xl bg-accent-500/15 p-2 text-accent-400">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  )
}

export function Dashboard() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [groups, setGroups] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadOverview = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getOverview({
        groupIds: selectedIds.length ? selectedIds : [],
        period: '2d',
      })
      setData(res.data)
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao carregar a visão geral.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [selectedIds, toast])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await refreshOverview({
        groupIds: selectedIds.length ? selectedIds : [],
        period: '2d',
      })
      setData(res.data)
      const r = res.data?.refresh
      if (r?.synced != null) {
        toast.success(`Atualizado: ${r.synced} grupo(s) sincronizado(s).`)
      } else {
        toast.success('Visão geral atualizada.')
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao atualizar.')
    } finally {
      setRefreshing(false)
    }
  }, [selectedIds, toast])

  useEffect(() => {
    let ok = true
    getGroups()
      .then((res) => {
        if (ok) setGroups(res.data?.groups || [])
      })
      .catch(() => {})
    return () => {
      ok = false
    }
  }, [])

  useEffect(() => {
    loadOverview()
  }, [loadOverview])

  const retention = data?.meta?.messageRetentionDays ?? 2
  const topMembers = [...(data?.topMembers || [])].reverse()

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    )
  }

  if (!data) {
    return (
      <p className="rounded-xl border border-brand-800 bg-brand-900/40 px-4 py-8 text-sm text-stone-400">
        Não foi possível carregar a visão geral. Tente novamente em instantes.
      </p>
    )
  }

  const connectedCount = data.connectedGroupsCount ?? data.totalGroups ?? 0
  const activeLeadsPct = data.activeLeadsPct ?? 0

  const metrics = [
    {
      label: 'Grupos ativos',
      value: String(connectedCount),
      hint: data.connectedGroupsLabel ? `${data.connectedGroupsLabel} (monitorando)` : undefined,
      icon: LayoutGrid,
    },
    {
      label: 'Novos leads',
      value: String(data.newLeads ?? 0),
      hint: `Novos membros desde que o grupo foi ativado (${retention} dias)`,
      icon: UserPlus,
    },
    {
      label: 'Saída',
      value: String(data.exits ?? 0),
      hint: 'Saídas detectadas na última sincronização (use Atualizar)',
      icon: UserMinus,
    },
    {
      label: '% de membros ativos',
      value: `${Number(activeLeadsPct).toFixed(1)}%`,
      hint:
        (data.inactiveLeads ?? 0) > 0
          ? `${data.activeLeads ?? 0} membro(s) ativo(s) · ${data.inactiveLeads} inativo(s)`
          : `${data.activeLeads ?? 0} membro(s) ativo(s)`,
      icon: Users,
    },
  ]

  const hasConnected = groups.some((g) => g.status === 'ativo' || g.monitoringEnabled)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-stone-500">
          Dados desde a ativação do grupo · janela de {retention} dias ·{' '}
          <Link to="/dashboard/groups" className="text-accent-400 hover:underline">
            Gerenciar grupos
          </Link>
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="gap-2 shrink-0"
          onClick={handleRefresh}
          disabled={refreshing || loading}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Atualizando…' : 'Atualizar'}
        </Button>
      </div>

      <GroupFilterBar groups={groups} selectedIds={selectedIds} onChange={setSelectedIds} />

      {!hasConnected && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-8 text-sm text-amber-200/90">
          Conecte o WhatsApp e ative grupos em{' '}
          <Link to="/dashboard/connect" className="text-accent-400 underline">
            Conectar
          </Link>{' '}
          e{' '}
          <Link to="/dashboard/groups" className="text-accent-400 underline">
            Grupos
          </Link>{' '}
          para ver métricas de leads aqui.
        </p>
      )}

      <DataBanner meta={data.meta} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((m) => (
          <MetricCard key={m.label} {...m} />
        ))}
      </div>

      {data.connectedGroups?.length > 0 && data.connectedGroups.length <= 4 && (
        <div className="flex flex-wrap gap-2">
          {data.connectedGroups.map((g) => (
            <Link
              key={g.id}
              to={`/dashboard/groups/${encodeURIComponent(g.id)}`}
              className="rounded-lg border border-brand-800/90 bg-brand-950/50 px-3 py-1.5 text-xs text-stone-400 hover:border-accent-500/40 hover:text-accent-300 transition"
            >
              {g.name}
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="text-lg font-semibold text-stone-100 font-heading mb-4">Mensagens por dia</h2>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.messagesByDay || data.messagesLast7Days}>
                <defs>
                  <linearGradient id="gfColor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#eab308" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#eab308" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d4a38" opacity={0.5} />
                <XAxis dataKey="day" stroke="#a8a29e" fontSize={12} />
                <YAxis stroke="#a8a29e" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: '#0f1812', border: '1px solid #2d4a38', borderRadius: '12px' }}
                  labelStyle={{ color: '#fafaf9' }}
                />
                <Area type="monotone" dataKey="msgs" stroke="#eab308" fill="url(#gfColor)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-stone-100 font-heading mb-4">Grupos mais ativos (24h)</h2>
          <ul className="space-y-3">
            {(data.topGroups || []).length === 0 && (
              <li className="text-sm text-stone-500">Sem mensagens nas últimas 24h.</li>
            )}
            {(data.topGroups || []).map((g, i) => (
              <li key={g.id} className="flex items-center justify-between gap-2 text-sm">
                <Link to={`/dashboard/groups/${g.id}`} className="truncate text-stone-300 hover:text-accent-400 transition">
                  {i + 1}. {g.name}
                </Link>
                <Badge variant="muted">{g.messages24h} msg</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold text-stone-100 font-heading mb-4">Quem mais falou</h2>
          <div className="h-56">
            {topMembers.length === 0 ? (
              <p className="text-sm text-stone-500">Ative um grupo e aguarde mensagens de membros no período.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={topMembers} margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2d4a38" opacity={0.5} horizontal={false} />
                  <XAxis type="number" stroke="#a8a29e" fontSize={12} />
                  <YAxis type="category" dataKey="name" width={88} stroke="#a8a29e" fontSize={11} />
                  <Tooltip contentStyle={{ background: '#0f1812', border: '1px solid #2d4a38', borderRadius: '12px' }} />
                  <Bar dataKey="msgs" fill="#eab308" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-stone-100 font-heading mb-4">Mensagens com mais engajamento</h2>
          <p className="text-xs text-stone-500 mb-3">
            Interações = respostas no grupo + reações (emoji). Leituras = somente envios seus pela plataforma marcados como
            lidos.
          </p>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {(data.topMessages || []).length === 0 ? (
              <p className="text-sm text-stone-500">Sem destaques no período.</p>
            ) : (
              data.topMessages.slice(0, 8).map((msg) => (
                <div key={msg.id} className="rounded-lg border border-brand-800/90 bg-brand-950/30 px-3 py-2.5">
                  <p className="text-sm text-stone-100 leading-snug">{msg.title}</p>
                  <p className="text-xs text-stone-500 mt-1">
                    {msg.group}
                    {msg.senderName ? ` · ${msg.senderName}` : ''}
                  </p>
                  <p className="text-xs text-accent-400/90 mt-1">
                    {msg.interactions > 0
                      ? `${msg.interactions} interação(ões) (${msg.replies} resposta(s), ${msg.reactions} reação(ões))`
                      : 'Sem interações registradas'}
                    {msg.reads > 0 ? ` · ${msg.reads} leitura(s)` : ''}
                    {msg.isOutbound && msg.reads === 0 ? ' · envio plataforma' : ''}
                  </p>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {(data.groupComparison || []).length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold text-stone-100 font-heading mb-4">Resumo por grupo</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="text-stone-500 border-b border-brand-800">
                  <th className="py-2 pr-4">Grupo</th>
                  <th className="py-2 pr-4">Mensagens</th>
                  <th className="py-2 pr-4">Membros</th>
                  <th className="py-2">% LEADS ativos</th>
                </tr>
              </thead>
              <tbody>
                {data.groupComparison.map((g) => (
                  <tr key={g.id} className="border-b border-brand-800/60 text-stone-300">
                    <td className="py-2.5 pr-4">
                      <Link to={`/dashboard/groups/${g.id}`} className="hover:text-accent-400">
                        {g.name}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-4">{g.messages}</td>
                    <td className="py-2.5 pr-4">{g.members}</td>
                    <td className="py-2.5">{g.engagement}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <h2 className="text-lg font-semibold text-stone-100 font-heading mb-4">Atividades recentes</h2>
        <ul className="divide-y divide-brand-800">
          {(data.recentActivities || []).length === 0 && (
            <li className="py-3 text-sm text-stone-500">Nenhuma atividade recente registrada.</li>
          )}
          {(data.recentActivities || []).map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0">
              <span className="text-sm text-stone-300">{a.text}</span>
              <span className="text-xs text-stone-500">{a.time}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
