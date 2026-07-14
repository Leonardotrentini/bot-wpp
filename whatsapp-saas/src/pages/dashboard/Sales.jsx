import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Receipt, Loader2, Search, MessageSquare, ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react'
import { Card } from '../../components/common/Card.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Select } from '../../components/common/Select.jsx'
import { Modal, ConfirmModal } from '../../components/common/Modal.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import {
  getCrmSales,
  getCrmTags,
  fetchOrgMembers,
  updateCrmContactActivity,
  deleteCrmContactActivity,
} from '../../services/api.js'

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

function parseAmountInput(raw) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : NaN
}

function amountToInput(value) {
  if (value == null || !Number.isFinite(Number(value))) return ''
  return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function isoToDatetimeLocal(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function datetimeLocalToIso(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

export function Sales() {
  const toast = useToast()
  const { isOrgOwner } = useAuth()
  const [loading, setLoading] = useState(true)
  const [sales, setSales] = useState([])
  const [summary, setSummary] = useState({ count: 0, totalAmount: 0, averageAmount: 0 })
  const [pagination, setPagination] = useState({ page: 1, limit: 30, total: 0, pages: 0 })
  const [period, setPeriod] = useState('30d')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [page, setPage] = useState(1)
  const [sellerUserId, setSellerUserId] = useState('')
  const [tagId, setTagId] = useState('')
  const [members, setMembers] = useState([])
  const [tags, setTags] = useState([])
  const [editSale, setEditSale] = useState(null)
  const [editAmount, setEditAmount] = useState('')
  const [editTicket, setEditTicket] = useState('')
  const [editAt, setEditAt] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deleteSale, setDeleteSale] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 350)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    setPage(1)
  }, [period, debouncedQ, sellerUserId, tagId])

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([
      isOrgOwner ? fetchOrgMembers() : Promise.resolve({ members: [] }),
      getCrmTags(),
    ]).then(([membersRes, tagsRes]) => {
      if (cancelled) return
      if (membersRes.status === 'fulfilled') {
        setMembers(membersRes.value?.members || [])
      }
      if (tagsRes.status === 'fulfilled') {
        const payload = tagsRes.value?.data || tagsRes.value || {}
        setTags(payload.tags || [])
      }
    })
    return () => {
      cancelled = true
    }
  }, [isOrgOwner])

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
        sellerUserId: sellerUserId || undefined,
        tagId: tagId || undefined,
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
  }, [period, debouncedQ, page, sellerUserId, tagId, toast])

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

  const openEdit = (sale) => {
    setEditSale(sale)
    setEditAmount(amountToInput(sale.amount))
    setEditTicket(sale.ticket || '')
    setEditAt(isoToDatetimeLocal(sale.confirmedAt))
  }

  const handleSaveEdit = async () => {
    if (!editSale?.contact?.id) {
      toast.error('Venda sem contato vinculado.')
      return
    }
    const amount = parseAmountInput(editAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Informe um valor válido.')
      return
    }
    const at = datetimeLocalToIso(editAt)
    if (!at) {
      toast.error('Informe uma data válida.')
      return
    }
    setSavingEdit(true)
    try {
      await updateCrmContactActivity(editSale.contact.id, editSale.id, {
        amount,
        ticket: editTicket.trim() || null,
        at,
      })
      toast.success('Venda atualizada.')
      setEditSale(null)
      await load()
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao editar venda.')
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteSale?.contact?.id) return
    setDeleting(true)
    try {
      await deleteCrmContactActivity(deleteSale.contact.id, deleteSale.id)
      toast.success('Venda removida do registro.')
      setDeleteSale(null)
      await load()
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao remover venda.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-stone-50 font-heading">Registro de vendas</h2>
        <p className="mt-2 text-sm text-stone-400">
          Histórico de compras confirmadas no CRM — {periodLabel}. Cada venda fica atribuída ao vendedor que confirmou.
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
        <div className="flex flex-col gap-3 border-b border-brand-800 pb-4">
          <div className="flex flex-1 flex-col gap-3 lg:flex-row lg:items-end">
            <div className="sm:w-40">
              <Select label="Período" value={period} onChange={(e) => setPeriod(e.target.value)}>
                <option value="today">Hoje</option>
                <option value="7d">Últimos 7 dias</option>
                <option value="30d">Últimos 30 dias</option>
                <option value="90d">Últimos 90 dias</option>
                <option value="all">Tudo</option>
              </Select>
            </div>
            {isOrgOwner && members.length > 0 ? (
              <div className="sm:w-48">
                <Select label="Vendedor" value={sellerUserId} onChange={(e) => setSellerUserId(e.target.value)}>
                  <option value="">Todos</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name || m.email}
                      {m.role === 'OWNER' ? ' (dono)' : ''}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            <div className="sm:w-48">
              <Select label="Tag" value={tagId} onChange={(e) => setTagId(e.target.value)}>
                <option value="">Todas</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
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
            <Button variant="secondary" onClick={load} disabled={loading} className="shrink-0">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Atualizar'}
            </Button>
          </div>
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
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-brand-800 text-xs uppercase tracking-wide text-stone-500">
                    <th className="px-3 py-3 font-medium">Data</th>
                    <th className="px-3 py-3 font-medium">Cliente</th>
                    <th className="px-3 py-3 font-medium">Vendedor</th>
                    <th className="px-3 py-3 font-medium">Tags</th>
                    <th className="px-3 py-3 font-medium">Valor</th>
                    <th className="px-3 py-3 font-medium">Ticket</th>
                    <th className="px-3 py-3 font-medium text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((sale) => (
                    <tr key={sale.id} className="border-b border-brand-800/60 hover:bg-brand-950/40">
                      <td className="px-3 py-3 text-stone-400">{formatWhen(sale.confirmedAt)}</td>
                      <td className="px-3 py-3">
                        <p className="font-medium text-stone-100">{sale.contact?.name || '—'}</p>
                        <p className="text-xs text-stone-500">{sale.contact?.phone || ''}</p>
                      </td>
                      <td className="px-3 py-3 text-stone-300">
                        {sale.seller?.name || sale.seller?.email || '—'}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(sale.tags || []).length ? (
                            sale.tags.map((t) => (
                              <span
                                key={t.id}
                                className="inline-flex max-w-[120px] truncate rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                                style={{ backgroundColor: `${t.color}22`, color: t.color }}
                                title={t.name}
                              >
                                {t.name}
                              </span>
                            ))
                          ) : (
                            <span className="text-stone-600">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 font-semibold text-emerald-400">{formatBrl(sale.amount)}</td>
                      <td className="px-3 py-3 text-stone-400">{sale.ticket || '—'}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEdit(sale)}
                            className="inline-flex items-center gap-1 rounded-lg border border-brand-700 px-2 py-1.5 text-xs text-stone-300 transition hover:bg-brand-800 hover:text-stone-100"
                            title="Editar venda"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteSale(sale)}
                            className="inline-flex items-center rounded-lg border border-brand-700 p-1.5 text-stone-500 transition hover:border-red-800 hover:bg-red-500/10 hover:text-red-400"
                            title="Excluir venda"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                          {sale.contact?.conversationId ? (
                            <Link
                              to={`/dashboard/chat?c=${encodeURIComponent(sale.contact.conversationId)}`}
                              className="inline-flex items-center gap-1 rounded-lg border border-brand-700 px-2.5 py-1.5 text-xs text-accent-400 transition hover:bg-accent-500/10"
                            >
                              <MessageSquare className="h-3.5 w-3.5" />
                              Chat
                            </Link>
                          ) : null}
                        </div>
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

      <Modal
        isOpen={Boolean(editSale)}
        onClose={() => setEditSale(null)}
        title="Editar venda"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditSale(null)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-stone-400">
          Corrige valor, ticket e data no registro. Não reenvia Purchase à Meta.
        </p>
        <label className="mb-1 block text-xs font-medium text-stone-500">Valor (R$)</label>
        <input
          value={editAmount}
          onChange={(e) => setEditAmount(e.target.value)}
          placeholder="Ex.: 1.500,00"
          className="mb-3 w-full rounded-xl border border-brand-700 bg-brand-900/60 px-4 py-2.5 text-sm text-stone-100 outline-none focus:border-accent-500/60"
        />
        <label className="mb-1 block text-xs font-medium text-stone-500">Ticket (opcional)</label>
        <input
          value={editTicket}
          onChange={(e) => setEditTicket(e.target.value)}
          placeholder="Ex.: #1234"
          className="mb-3 w-full rounded-xl border border-brand-700 bg-brand-900/60 px-4 py-2.5 text-sm text-stone-100 outline-none focus:border-accent-500/60"
        />
        <label className="mb-1 block text-xs font-medium text-stone-500">Data / hora</label>
        <input
          type="datetime-local"
          value={editAt}
          onChange={(e) => setEditAt(e.target.value)}
          className="w-full rounded-xl border border-brand-700 bg-brand-900/60 px-4 py-2.5 text-sm text-stone-100 outline-none focus:border-accent-500/60"
        />
      </Modal>

      <ConfirmModal
        isOpen={Boolean(deleteSale)}
        onClose={() => setDeleteSale(null)}
        onConfirm={handleDelete}
        loading={deleting}
        title="Excluir venda"
        message={
          deleteSale
            ? `Remover a venda de ${formatBrl(deleteSale.amount)} (${deleteSale.contact?.name || 'cliente'}) do registro?`
            : ''
        }
      />
    </div>
  )
}
