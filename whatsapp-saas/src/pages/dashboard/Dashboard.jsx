import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users, MessageSquare, LayoutGrid, Send } from 'lucide-react'
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
import { getOverview } from '../../services/api.js'
import { useToast } from '../../contexts/ToastContext.jsx'

function DataBanner({ meta }) {
  if (!meta) return null
  if (meta.onlyPlatformOutbound) {
    return (
      <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200/90">
        Só há envios pela plataforma no período. Em <strong>Grupos</strong>, marque o grupo como{' '}
        <strong>ativo</strong> (importa 2 dias automaticamente) ou use <strong>Reimportar 2 dias</strong>.
      </p>
    )
  }
  if (!meta.hasActivity) {
    return (
      <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200/90">
        Nenhuma mensagem nos últimos {meta.messageRetentionDays ?? 2} dias. Ative um grupo em{' '}
        <strong>Grupos</strong> para importar o histórico e receber novas mensagens pelo webhook.
      </p>
    )
  }
  return null
}

export function Dashboard() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ok = true
    getOverview()
      .then((res) => {
        if (ok) setData(res.data)
      })
      .catch((err) => {
        if (ok) {
          toast.error(err?.response?.data?.message || 'Falha ao carregar a visão geral.')
          setData(null)
        }
      })
      .finally(() => {
        if (ok) setLoading(false)
      })
    return () => {
      ok = false
    }
  }, [toast])

  if (loading) {
    return (
      <div className="space-y-6">
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

  const retention = data.meta?.messageRetentionDays ?? 2
  const activeLeadsPct = data.activeLeadsPct ?? data.engagementRate ?? 0
  const topMembers = [...(data.topMembers || [])].reverse()

  if (!data.totalGroups && !data.messagesToday && !data.totalMessagesInPeriod) {
    return (
      <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-8 text-sm text-amber-200/90">
        Conecte o WhatsApp e ative grupos em <Link to="/dashboard/connect" className="text-accent-400 underline">Conectar</Link>{' '}
        e <Link to="/dashboard/groups" className="text-accent-400 underline">Grupos</Link> para ver métricas aqui.
      </p>
    )
  }

  const metrics = [
    { label: 'Grupos conectados', value: data.totalGroups, icon: LayoutGrid },
    {
      label: `Mensagens (${retention} dias)`,
      value: (data.totalMessagesInPeriod ?? 0).toLocaleString('pt-BR'),
      icon: MessageSquare,
    },
    {
      label: 'Mensagens hoje',
      value: data.messagesToday.toLocaleString('pt-BR'),
      icon: Send,
    },
    { label: '% de LEADS ativos', value: `${Number(activeLeadsPct).toFixed(1)}%`, icon: Users },
  ]

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-2 text-xs text-stone-500">
        <span>
          Visão geral · últimos {retention} dias ·{' '}
          <Link to="/dashboard/groups" className="text-accent-400 hover:underline">
            Gerenciar grupos
          </Link>
        </span>
      </div>

      <DataBanner meta={data.meta} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((m) => (
          <Card key={m.label}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-stone-400">{m.label}</p>
                <p className="mt-2 text-2xl font-bold text-stone-50 font-heading">{m.value}</p>
              </div>
              <div className="rounded-xl bg-accent-500/15 p-2 text-accent-400">
                <m.icon className="h-5 w-5" />
              </div>
            </div>
          </Card>
        ))}
      </div>

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
