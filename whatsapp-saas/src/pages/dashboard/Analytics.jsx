import { useEffect, useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts'
import { Card } from '../../components/common/Card.jsx'
import { Skeleton } from '../../components/common/Skeleton.jsx'
import { Input } from '../../components/common/Input.jsx'
import { getAnalytics } from '../../services/api.js'

const PIE_COLORS = ['#eab308', '#3b82f6', '#22c55e', '#a855f7', '#f97316']

export function Analytics() {
  const [period, setPeriod] = useState('7d')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedGroups, setSelectedGroups] = useState([])
  const [customRange, setCustomRange] = useState({ start: '', end: '' })
  const [visibleSections, setVisibleSections] = useState({
    engagementByGroup: true,
    topMessages: true,
    groupComparison: true,
  })

  useEffect(() => {
    setLoading(true)
    getAnalytics(period).then((r) => {
      setData(r.data)
      setLoading(false)
    })
  }, [period])

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-80" />
      </div>
    )
  }

  const topHorizontal = [...data.topMembers].reverse()
  const availableGroups = data.groupComparison || []
  const effectiveGroupIds = selectedGroups.length ? selectedGroups : availableGroups.map((g) => g.id)
  const idSet = new Set(effectiveGroupIds)
  const groupNameToId = new Map(availableGroups.map((g) => [g.name, g.id]))

  const filteredGroupComparison = availableGroups.filter((g) => idSet.has(g.id))
  const filteredEngagementByGroup = (data.engagementByGroup || []).filter((g) => idSet.has(groupNameToId.get(g.name)))

  const totalMessages = filteredGroupComparison.reduce((sum, g) => sum + g.messages, 0)
  const totalMembers = filteredGroupComparison.reduce((sum, g) => sum + g.members, 0)
  const weightedEngagement =
    totalMembers > 0
      ? filteredGroupComparison.reduce((sum, g) => sum + g.engagement * g.members, 0) / totalMembers
      : data.responseRate
  const activeMembers = Math.round(totalMembers * (weightedEngagement / 100))
  const inactiveMembers = Math.max(totalMembers - activeMembers, 0)

  const topEngagedMessages = filteredGroupComparison
    .slice(0, 6)
    .map((g, idx) => ({
      id: `msg-top-${g.id}`,
      title: idx % 2 === 0 ? 'Chamada para ação com bônus' : 'Lembrete de conteúdo do dia',
      group: g.name,
      engagementRate: Number((g.engagement - idx * 1.3).toFixed(1)),
      reactions: 120 - idx * 11,
      replies: 58 - idx * 6,
    }))
    .sort((a, b) => b.engagementRate - a.engagementRate)

  function toggleGroup(groupId) {
    setSelectedGroups((prev) => (prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]))
  }

  function toggleSection(sectionKey) {
    setVisibleSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }))
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-stone-50">Analytics</h2>
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'hoje', label: 'Hoje' },
            { id: '7d', label: '7 dias' },
            { id: '30d', label: '30 dias' },
            { id: 'custom', label: 'Custom' },
          ].map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                period === p.id ? 'bg-accent-500/15 text-accent-400 border border-accent-500/30' : 'text-stone-400 border border-transparent hover:bg-white/5'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {period === 'custom' && (
        <Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Data inicial"
              type="date"
              value={customRange.start}
              onChange={(e) => setCustomRange((prev) => ({ ...prev, start: e.target.value }))}
            />
            <Input
              label="Data final"
              type="date"
              value={customRange.end}
              onChange={(e) => setCustomRange((prev) => ({ ...prev, end: e.target.value }))}
            />
          </div>
          <p className="mt-2 text-xs text-stone-500">
            Intervalo selecionado: {customRange.start || '...'} até {customRange.end || '...'}.
          </p>
        </Card>
      )}

      <Card className="space-y-4">
        <h3 className="font-semibold text-stone-50">Setup de visualização</h3>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-sm text-stone-300 mb-2">Seleção de grupos</p>
            <div className="max-h-40 overflow-y-auto rounded-xl border border-brand-800 p-3 space-y-2">
              {availableGroups.map((group) => (
                <label key={group.id} className="flex items-center gap-2 text-sm text-stone-300">
                  <input
                    type="checkbox"
                    checked={effectiveGroupIds.includes(group.id)}
                    onChange={() => toggleGroup(group.id)}
                  />
                  {group.name}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-stone-500">
              Se nenhum grupo for marcado, exibimos todos automaticamente.
            </p>
          </div>
          <div>
            <p className="text-sm text-stone-300 mb-2">O que deseja visualizar</p>
            <div className="rounded-xl border border-brand-800 p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm text-stone-300">
                <input
                  type="checkbox"
                  checked={visibleSections.engagementByGroup}
                  onChange={() => toggleSection('engagementByGroup')}
                />
                Engajamento por grupo
              </label>
              <label className="flex items-center gap-2 text-sm text-stone-300">
                <input
                  type="checkbox"
                  checked={visibleSections.topMessages}
                  onChange={() => toggleSection('topMessages')}
                />
                Mensagens com mais engajamento
              </label>
              <label className="flex items-center gap-2 text-sm text-stone-300">
                <input
                  type="checkbox"
                  checked={visibleSections.groupComparison}
                  onChange={() => toggleSection('groupComparison')}
                />
                Comparativo de grupos
              </label>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-sm text-stone-400">Total de mensagens</p>
          <p className="mt-2 text-2xl font-bold text-stone-50">{totalMessages.toLocaleString('pt-BR')}</p>
        </Card>
        <Card>
          <p className="text-sm text-stone-400">Taxa de resposta</p>
          <p className="mt-2 text-2xl font-bold text-accent-400">{weightedEngagement.toFixed(1)}%</p>
        </Card>
        <Card>
          <p className="text-sm text-stone-400">Membros ativos / inativos</p>
          <p className="mt-2 text-2xl font-bold text-stone-50">
            {activeMembers} <span className="text-stone-500 text-lg">/ {inactiveMembers}</span>
          </p>
        </Card>
        <Card>
          <p className="text-sm text-stone-400">Crescimento de membros</p>
          <p className="mt-2 text-2xl font-bold text-emerald-400">+{data.memberGrowthPct}%</p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="font-semibold text-stone-50 mb-4">Mensagens por dia</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.messagesByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d4a38" opacity={0.5} />
                <XAxis dataKey="day" stroke="#a8a29e" fontSize={12} />
                <YAxis stroke="#a8a29e" fontSize={12} />
                <Tooltip contentStyle={{ background: '#0f1812', border: '1px solid #2d4a38', borderRadius: '12px' }} />
                <Line type="monotone" dataKey="count" stroke="#eab308" strokeWidth={2} dot={{ fill: '#eab308' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <h3 className="font-semibold text-stone-50 mb-4">Distribuição por horário</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.messagesByHour.filter((_, i) => i % 2 === 0)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d4a38" opacity={0.5} />
                <XAxis dataKey="hour" stroke="#a8a29e" fontSize={10} />
                <YAxis stroke="#a8a29e" fontSize={12} />
                <Tooltip contentStyle={{ background: '#0f1812', border: '1px solid #2d4a38', borderRadius: '12px' }} />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {(visibleSections.engagementByGroup || visibleSections.topMessages) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {visibleSections.engagementByGroup && (
            <Card>
              <h3 className="font-semibold text-stone-50 mb-4">Engajamento por grupo</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={filteredEngagementByGroup} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name }) => (name || '').split(/\s+/)[0]}>
                      {filteredEngagementByGroup.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#0f1812', border: '1px solid #2d4a38', borderRadius: '12px' }} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
          {visibleSections.topMessages && (
            <Card>
              <h3 className="font-semibold text-stone-50 mb-4">Mensagens com mais engajamento</h3>
              <div className="space-y-2">
                {topEngagedMessages.map((msg) => (
                  <div key={msg.id} className="rounded-lg border border-brand-800 p-3">
                    <p className="text-sm text-stone-100">{msg.title}</p>
                    <p className="text-xs text-stone-500 mt-1">{msg.group}</p>
                    <p className="text-xs text-accent-400 mt-1">
                      Engajamento {msg.engagementRate}% • {msg.replies} respostas • {msg.reactions} reações
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="font-semibold text-stone-50 mb-4">Top 10 membros ativos</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={topHorizontal} margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2d4a38" opacity={0.5} horizontal={false} />
                <XAxis type="number" stroke="#a8a29e" fontSize={12} />
                <YAxis type="category" dataKey="name" width={100} stroke="#a8a29e" fontSize={11} />
                <Tooltip contentStyle={{ background: '#0f1812', border: '1px solid #2d4a38', borderRadius: '12px' }} />
                <Bar dataKey="msgs" fill="#eab308" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {visibleSections.groupComparison && (
        <Card>
          <h3 className="font-semibold text-stone-50 mb-4">Comparativo entre grupos</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-800 text-left text-stone-400">
                  <th className="py-3 pr-4">Grupo</th>
                  <th className="py-3 pr-4">Mensagens (período)</th>
                  <th className="py-3 pr-4">Membros</th>
                  <th className="py-3">Engajamento %</th>
                </tr>
              </thead>
              <tbody>
                {filteredGroupComparison.map((g) => (
                  <tr key={g.id} className="border-b border-brand-800/80">
                    <td className="py-3 text-stone-50">{g.name}</td>
                    <td className="py-3 text-stone-300">{g.messages}</td>
                    <td className="py-3 text-stone-300">{g.members}</td>
                    <td className="py-3 text-accent-400">{g.engagement.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
