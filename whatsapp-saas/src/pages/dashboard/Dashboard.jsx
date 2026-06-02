import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users, MessageSquare, TrendingUp, LayoutGrid } from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { Card } from '../../components/common/Card.jsx'
import { Skeleton } from '../../components/common/Skeleton.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { getDashboardSummary } from '../../services/api.js'
import { useToast } from '../../contexts/ToastContext.jsx'

export function Dashboard() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ok = true
    getDashboardSummary()
      .then((res) => {
        if (ok) setData(res.data)
      })
      .catch((err) => {
        if (ok) {
          toast.error(err?.response?.data?.message || 'Falha ao carregar o dashboard.')
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
        Não foi possível carregar o dashboard. Tente novamente em instantes.
      </p>
    )
  }

  if (!data.totalGroups && !data.messagesToday) {
    return (
      <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-8 text-sm text-amber-200/90">
        Conecte o WhatsApp e sincronize seus grupos em <strong>Conectar WhatsApp</strong> e <strong>Grupos</strong> para
        ver métricas reais aqui.
      </p>
    )
  }

  const metrics = [
    { label: 'Grupos gerenciados', value: data.totalGroups, icon: LayoutGrid },
    { label: 'Total de membros', value: data.totalMembers.toLocaleString('pt-BR'), icon: Users },
    { label: 'Mensagens hoje', value: data.messagesToday.toLocaleString('pt-BR'), icon: MessageSquare },
    { label: 'Taxa de engajamento', value: `${data.engagementRate}%`, icon: TrendingUp },
  ]

  return (
    <div className="space-y-8">
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
          <h2 className="text-lg font-semibold text-stone-100 font-heading mb-4">
            Mensagens (últimos {data.meta?.messageRetentionDays ?? 2} dias)
          </h2>
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
                <Area type="monotone" dataKey="count" stroke="#eab308" fill="url(#gfColor)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-stone-100 font-heading mb-4">Grupos mais ativos</h2>
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
