import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Receipt, Loader2, Search, MessageSquare, ChevronLeft, ChevronRight } from 'lucide-react'
import { Card } from '../../components/common/Card.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Select } from '../../components/common/Select.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { getCrmSales } from '../../services/api.js'

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
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function periodToRange(period) {
  if (period === 'all') return { from: null, to: null }
  const to = new Date()
  const from = new Date()
  if (period === 'today') {
    from.setHours(0, 0, 0, 0)
  } else if (period === '7d') {
    from.setDate(from.getDate() - 7)
  } else if (period === '30d') {
    from.setDate(from.getDate() - 30)
  } else if (period === '90d') {
    from.setDate(from.getDate() - 90)
  }
  return { from: from.toISOString(), to: to.toISOString() }
}

export function Sales() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [sales, setSales] = useState([])
  const [summary, setSummary] = useState({ count: 0, totalAmount: 0, averageAmount: 0 })
  const [pagination, setPagination] = useState({ page: 1, limit: 30, total: 0, pages: 0 })
  const [period, setPeriod] = useState('30d')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 350)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    setPage(1)
  }, [period, debouncedQ])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const range = periodToRange(period)
      const { data } = await getCrmSales({
        from: range.from,
        to: range.to,
        q: debouncedQ || undefined,
        page,
        limit: 30,
      })
      setSales(data.sales || [])
      setSummary(data.summary || { count: 0, totalAmount: 0, averageAmount: 0 })
      setPagination(data.pagination || { page: 1, limit: 30, total: 0, pages: 0 })
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao carregar vendas.')
      setSales([])
    } finally {
      setLoading(false)
    }
  }, [period, debouncedQ, page, toast])

  useEffect(() => {
    load()
  }, [load])

  const periodLabel = useMemo(() => {
    switch (period) {
      case 'today':
        return 'hoje'
      case '7d':
        return '7 dias'
      case '30d':
        return '30 dias'
      case '90d':
        return '90 dias'
      default:
        return 'todo o período'
    }
  }, [period])

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-stone-50 font-heading">Registro de vendas</h2>
        <p className="mt-2 text-sm text-stone-400">
          Histórico de todas as compras confirmadas no CRM — {periodLabel}.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Total vendido</p>
          <p className="mt-2 text-2xl font-bold text-emerald-400">{formatBrl(summary.totalAmount)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Vendas</p>
          <p className="mt-2 text-2xl font-bold text-stone-50">{summary.count}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Ticket médio</p>
          <p className="mt-2 text-2xl font-bold text-accent-400">{formatBrl(summary.averageAmount)}</p>
        </Card>
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-brand-800 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
            <div className="sm:w-44">
              <Select label="Período" value={period} onChange={(e) => setPeriod(e.target.value)}>
                <option value="today">Hoje</option>
                <option value="7d">Últimos 7 dias</option>
                <option value="30d">Últimos 30 dias</option>
                <option value="90d">Últimos 90 dias</option>
                <option value="all">Tudo</option>
              </Select>
            </div>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-[2.35rem] h-4 w-4 text-stone-500" />
              <Input
                label="Buscar"
                placeholder="Cliente, telefone ou ticket..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <Button variant="secondary" onClick={load} disabled={loading} className="shrink-0">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Atualizar'}
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-accent-400" />
          </div>
        ) : sales.length === 0 ? (
          <div className="py-16 text-center">
            <Receipt className="mx-auto h-10 w-10 text-stone-600" />
            <p className="mt-3 text-sm text-stone-500">Nenhuma venda encontrada neste período.</p>
            <p className="mt-1 text-xs text-stone-600">
              Confirme compras no card do cliente em Conversas para registrar vendas aqui.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-brand-800 text-xs uppercase tracking-wide text-stone-500">
                    <th className="px-3 py-3 font-medium">Data</th>
                    <th className="px-3 py-3 font-medium">Cliente</th>
                    <th className="px-3 py-3 font-medium">Telefone</th>
                    <th className="px-3 py-3 font-medium">Valor</th>
                    <th className="px-3 py-3 font-medium">Ticket</th>
                    <th className="px-3 py-3 font-medium text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((sale) => (
                    <tr key={sale.id} className="border-b border-brand-800/60 hover:bg-brand-950/40">
                      <td className="px-3 py-3 text-stone-400">{formatWhen(sale.confirmedAt)}</td>
                      <td className="px-3 py-3 font-medium text-stone-100">{sale.contact?.name || '—'}</td>
                      <td className="px-3 py-3 text-stone-400">{sale.contact?.phone || '—'}</td>
                      <td className="px-3 py-3 font-semibold text-emerald-400">{formatBrl(sale.amount)}</td>
                      <td className="px-3 py-3 text-stone-400">{sale.ticket || '—'}</td>
                      <td className="px-3 py-3 text-right">
                        {sale.contact?.conversationId ? (
                          <Link
                            to={`/dashboard/chat?c=${encodeURIComponent(sale.contact.conversationId)}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-brand-700 px-2.5 py-1.5 text-xs text-accent-400 transition hover:bg-accent-500/10"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            Chat
                          </Link>
                        ) : (
                          <span className="text-xs text-stone-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pagination.pages > 1 ? (
              <div className="flex items-center justify-between border-t border-brand-800 px-3 py-3">
                <p className="text-xs text-stone-500">
                  Página {pagination.page} de {pagination.pages} · {pagination.total} vendas
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page >= pagination.pages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </div>
  )
}
