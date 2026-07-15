import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  FileText,
  Loader2,
  MessageSquare,
  RefreshCw,
  Target,
  Bell,
  Users,
} from 'lucide-react'
import { Card } from '../../components/common/Card.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Select } from '../../components/common/Select.jsx'
import { Input } from '../../components/common/Input.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { fetchOrg, fetchOrgMembers, getCrmOpsToday, updateOrg } from '../../services/api.js'

function formatBrl(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
}

function formatWhen(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function chatHref(conversationId) {
  if (!conversationId) return '/dashboard/chat'
  return `/dashboard/chat?c=${encodeURIComponent(conversationId)}`
}

export function Ops() {
  const toast = useToast()
  const { isOrgOwner } = useAuth()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [sellerUserId, setSellerUserId] = useState('')
  const [members, setMembers] = useState([])
  const [goalInput, setGoalInput] = useState('')
  const [savingGoal, setSavingGoal] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ops, org] = await Promise.all([
        getCrmOpsToday(sellerUserId || undefined),
        isOrgOwner ? fetchOrg() : Promise.resolve(null),
      ])
      setData(ops)
      if (org?.organization?.dailySalesGoal != null) {
        setGoalInput(String(org.organization.dailySalesGoal))
      } else if (ops?.goal?.targetAmount != null) {
        setGoalInput(String(ops.goal.targetAmount))
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Não foi possível carregar a operação de hoje.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [sellerUserId, isOrgOwner, toast])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!isOrgOwner) return undefined
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetchOrgMembers()
        if (!cancelled) setMembers(res?.members || [])
      } catch {
        if (!cancelled) setMembers([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isOrgOwner])

  const sellerOptions = useMemo(
    () => [
      { value: '', label: 'Todos os membros' },
      ...members.map((m) => ({ value: m.userId, label: m.name })),
    ],
    [members],
  )

  const goalPct = useMemo(() => {
    const target = Number(data?.goal?.targetAmount)
    const achieved = Number(data?.goal?.achievedAmount) || 0
    if (!Number.isFinite(target) || target <= 0) return null
    return Math.min(100, Math.round((achieved / target) * 100))
  }, [data])

  async function saveGoal() {
    const raw = goalInput.trim()
    let value = null
    if (raw) {
      const n = Number(raw.replace(',', '.'))
      if (!Number.isFinite(n) || n < 0) {
        toast.error('Informe um valor de meta válido.')
        return
      }
      value = n
    }
    setSavingGoal(true)
    try {
      await updateOrg({ dailySalesGoal: value })
      toast.success(value == null ? 'Meta removida.' : 'Meta diária salva.')
      await load()
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao salvar meta.')
    } finally {
      setSavingGoal(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-6 w-6 text-accent-400" />
            <h1 className="text-xl font-semibold text-stone-50">Operação</h1>
          </div>
          <p className="mt-1 text-sm text-stone-500">
            Filas do dia — quem falta responder, orçamentos abertos e meta de vendas.
            {data?.date ? ` (${data.date.split('-').reverse().join('/')})` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isOrgOwner && (
            <div className="w-48">
              <Select
                value={sellerUserId}
                onChange={(e) => setSellerUserId(e.target.value)}
                aria-label="Filtrar por vendedor"
              >
                {sellerOptions.map((opt) => (
                  <option key={opt.value || 'all'} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 py-20 text-stone-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Carregando operação…
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon={MessageSquare}
              label="Sem resposta"
              value={data?.unanswered?.count ?? 0}
              hint="Aguardando você"
            />
            <KpiCard
              icon={FileText}
              label="Orçamentos abertos"
              value={data?.openQuotes?.count ?? 0}
              hint={formatBrl(data?.openQuotes?.totalAmount)}
            />
            <KpiCard
              icon={Target}
              label="Vendas hoje"
              value={formatBrl(data?.salesToday?.totalAmount)}
              hint={`${data?.salesToday?.count ?? 0} pedido(s)`}
            />
            <KpiCard
              icon={Bell}
              label="Lembretes"
              value={data?.remindersDue?.count ?? 0}
              hint="Para cobrar agora"
            />
          </div>

          {isOrgOwner && (
            <Card className="space-y-3">
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5 text-accent-400" />
                <div>
                  <h3 className="font-semibold text-stone-50">Meta diária da loja</h3>
                  <p className="text-xs text-stone-500">Valor em R$ que a equipe deve bater hoje.</p>
                </div>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="sm:w-56">
                  <Input
                    label="Meta (R$)"
                    value={goalInput}
                    onChange={(e) => setGoalInput(e.target.value)}
                    placeholder="Ex: 5000"
                  />
                </div>
                <Button onClick={saveGoal} disabled={savingGoal}>
                  {savingGoal ? 'Salvando…' : 'Salvar meta'}
                </Button>
              </div>
              {goalPct != null && (
                <div>
                  <div className="mb-1 flex justify-between text-xs text-stone-400">
                    <span>
                      {formatBrl(data?.goal?.achievedAmount)} de {formatBrl(data?.goal?.targetAmount)}
                    </span>
                    <span>{goalPct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-brand-900">
                    <div
                      className="h-full rounded-full bg-accent-500 transition-all"
                      style={{ width: `${goalPct}%` }}
                    />
                  </div>
                </div>
              )}
            </Card>
          )}

          {!isOrgOwner && goalPct != null && (
            <Card className="space-y-2">
              <p className="text-sm text-stone-300">
                Meta da loja: {formatBrl(data?.goal?.achievedAmount)} / {formatBrl(data?.goal?.targetAmount)} (
                {goalPct}%)
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-brand-900">
                <div className="h-full rounded-full bg-accent-500" style={{ width: `${goalPct}%` }} />
              </div>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <ListCard
              title="Conversas sem resposta"
              empty="Nenhuma conversa aguardando resposta."
              items={data?.unanswered?.items || []}
              renderItem={(item) => (
                <Link
                  key={item.conversationId}
                  to={chatHref(item.conversationId)}
                  className="block rounded-xl border border-brand-800 bg-brand-950/40 p-3 transition hover:border-accent-500/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-stone-100">{item.contactName}</p>
                      <p className="truncate text-xs text-stone-500">{item.lastMessagePreview || '—'}</p>
                      {item.sellerName && (
                        <p className="mt-1 text-[11px] text-stone-600">{item.sellerName}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right text-[11px] text-stone-500">
                      <div>{formatWhen(item.lastMessageAt)}</div>
                      {item.unreadCount > 0 && (
                        <span className="mt-1 inline-block rounded-md bg-accent-500/20 px-1.5 py-0.5 text-accent-300">
                          {item.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              )}
            />

            <ListCard
              title="Orçamentos abertos"
              empty="Nenhum orçamento aberto no momento."
              items={data?.openQuotes?.items || []}
              renderItem={(item) => (
                <Link
                  key={item.contactId}
                  to={chatHref(item.conversationId)}
                  className="block rounded-xl border border-brand-800 bg-brand-950/40 p-3 transition hover:border-accent-500/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-stone-100">{item.contactName}</p>
                      <p className="text-sm text-accent-300">{formatBrl(item.amount)}</p>
                      {item.sellerName && (
                        <p className="mt-1 text-[11px] text-stone-600">{item.sellerName}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-[11px] text-stone-500">{formatWhen(item.savedAt)}</span>
                  </div>
                </Link>
              )}
            />

            <ListCard
              title="Lembretes"
              empty="Nenhum lembrete vencido."
              items={data?.remindersDue?.items || []}
              renderItem={(item) => (
                <Link
                  key={item.id}
                  to={chatHref(item.conversationId)}
                  className="block rounded-xl border border-brand-800 bg-brand-950/40 p-3 transition hover:border-accent-500/40"
                >
                  <p className="truncate font-medium text-stone-100">{item.contactName}</p>
                  <p className="text-xs text-stone-500">{item.note || 'Lembrete'}</p>
                  <p className="mt-1 text-[11px] text-stone-600">{formatWhen(item.remindAt)}</p>
                </Link>
              )}
            />

            {isOrgOwner && (data?.bySeller?.length || 0) > 0 && (
              <Card className="space-y-3">
                <div className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-accent-400" />
                  <h3 className="font-semibold text-stone-50">Por vendedor (hoje)</h3>
                </div>
                <div className="space-y-2">
                  {data.bySeller.map((row) => (
                    <div
                      key={row.userId}
                      className="flex items-center justify-between gap-2 rounded-xl border border-brand-800 bg-brand-950/40 px-3 py-2 text-sm"
                    >
                      <span className="truncate text-stone-200">{row.name || 'Vendedor'}</span>
                      <span className="shrink-0 text-xs text-stone-500">
                        {formatBrl(row.salesAmount)} · {row.unansweredCount} sem resp. · {row.openQuotesCount} orç.
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, hint }) {
  return (
    <Card className="space-y-1">
      <div className="flex items-center gap-2 text-stone-500">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-2xl font-semibold text-stone-50">{value}</p>
      {hint != null && <p className="text-xs text-stone-500">{hint}</p>}
    </Card>
  )
}

function ListCard({ title, empty, items, renderItem }) {
  return (
    <Card className="space-y-3">
      <h3 className="font-semibold text-stone-50">{title}</h3>
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-stone-500">{empty}</p>
      ) : (
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1">{items.map(renderItem)}</div>
      )}
    </Card>
  )
}
