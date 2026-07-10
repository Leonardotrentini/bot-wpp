import { useCallback, useEffect, useRef, useState } from 'react'
import { History, Receipt, ShoppingBag, Bell, Loader2, X } from 'lucide-react'
import { Button } from '../common/Button.jsx'
import { Modal } from '../common/Modal.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import {
  getCrmContactActivity,
  saveCrmContactQuote,
  confirmCrmContactPurchase,
  createCrmContactReminder,
  cancelCrmContactReminder,
} from '../../services/api.js'

function formatBrl(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
}

function formatReminderWhen(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function defaultReminderDate() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

function defaultReminderTime() {
  return '09:00'
}

function combineDateAndTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null
  const when = new Date(`${dateStr}T${timeStr}:00`)
  if (Number.isNaN(when.getTime())) return null
  return when.toISOString()
}

function parseAmountInput(raw) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : NaN
}

function activityIcon(type) {
  switch (type) {
    case 'quote_saved':
      return Receipt
    case 'purchase_confirmed':
      return ShoppingBag
    case 'reminder_set':
    case 'reminder_cancelled':
      return Bell
    default:
      return History
  }
}

export function ContactLeadActions({ contact, onContactUpdate, onConversationUpdate }) {
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast
  const [historyOpen, setHistoryOpen] = useState(false)
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [reminderOpen, setReminderOpen] = useState(false)
  const [activities, setActivities] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyError, setHistoryError] = useState(null)
  const [quoteAmount, setQuoteAmount] = useState('')
  const [purchaseAmount, setPurchaseAmount] = useState('')
  const [purchaseTicket, setPurchaseTicket] = useState('')
  const [reminderDate, setReminderDate] = useState(defaultReminderDate)
  const [reminderTime, setReminderTime] = useState(defaultReminderTime)
  const [reminderNote, setReminderNote] = useState('')
  const [savingQuote, setSavingQuote] = useState(false)
  const [confirmingPurchase, setConfirmingPurchase] = useState(false)
  const [savingReminder, setSavingReminder] = useState(false)
  const [cancellingReminderId, setCancellingReminderId] = useState(null)

  const contactId = contact?.id
  const pendingReminders = contact?.reminders || []

  const loadHistory = useCallback(async () => {
    if (!contactId) return
    setLoadingHistory(true)
    setHistoryError(null)
    try {
      const { data } = await getCrmContactActivity(contactId)
      setActivities(data.activities || [])
    } catch (err) {
      const message = err?.response?.data?.message || 'Falha ao carregar histórico.'
      setHistoryError(message)
      setActivities([])
      toastRef.current.error(message)
    } finally {
      setLoadingHistory(false)
    }
  }, [contactId])

  useEffect(() => {
    if (!historyOpen || !contactId) return
    loadHistory()
  }, [historyOpen, contactId, loadHistory])

  useEffect(() => {
    if (quoteOpen && contact?.quote?.amount != null) {
      setQuoteAmount(String(contact.quote.amount).replace('.', ','))
    } else if (quoteOpen) {
      setQuoteAmount('')
    }
  }, [quoteOpen, contact?.quote?.amount])

  useEffect(() => {
    if (purchaseOpen) {
      const base = contact?.purchase?.amount ?? contact?.quote?.amount
      setPurchaseAmount(base != null ? String(base).replace('.', ',') : '')
      setPurchaseTicket(contact?.purchase?.ticket || '')
    }
  }, [purchaseOpen, contact?.purchase, contact?.quote?.amount])

  useEffect(() => {
    if (reminderOpen) {
      setReminderDate(defaultReminderDate())
      setReminderTime(defaultReminderTime())
      setReminderNote('')
    }
  }, [reminderOpen])

  const handleSaveQuote = async () => {
    const amount = parseAmountInput(quoteAmount)
    if (!contactId || !Number.isFinite(amount) || amount <= 0) {
      toastRef.current.error('Informe um valor válido.')
      return
    }
    setSavingQuote(true)
    try {
      const { data } = await saveCrmContactQuote(contactId, { amount })
      if (data.contact) onContactUpdate?.(data.contact)
      toastRef.current.success('Orçamento salvo.')
      setQuoteOpen(false)
      if (historyOpen) loadHistory()
    } catch (err) {
      toastRef.current.error(err?.response?.data?.message || 'Falha ao salvar orçamento.')
    } finally {
      setSavingQuote(false)
    }
  }

  const handleConfirmPurchase = async () => {
    const amount = parseAmountInput(purchaseAmount)
    if (!contactId || !Number.isFinite(amount) || amount <= 0) {
      toastRef.current.error('Informe um valor válido.')
      return
    }
    setConfirmingPurchase(true)
    try {
      const { data } = await confirmCrmContactPurchase(contactId, {
        amount,
        ticket: purchaseTicket.trim() || null,
      })
      if (data.contact) onContactUpdate?.(data.contact)
      if (data.conversation) onConversationUpdate?.(data.conversation)
      toastRef.current.success('Compra confirmada.')
      setPurchaseOpen(false)
      if (historyOpen) loadHistory()
    } catch (err) {
      toastRef.current.error(err?.response?.data?.message || 'Falha ao confirmar compra.')
    } finally {
      setConfirmingPurchase(false)
    }
  }

  const handleSaveReminder = async () => {
    const scheduledAt = combineDateAndTime(reminderDate, reminderTime)
    if (!contactId || !scheduledAt) {
      toastRef.current.error('Informe data e hora válidas.')
      return
    }
    if (new Date(scheduledAt).getTime() < Date.now() - 60_000) {
      toastRef.current.error('O lembrete precisa ser no futuro.')
      return
    }
    setSavingReminder(true)
    try {
      const { data } = await createCrmContactReminder(contactId, {
        scheduledAt,
        note: reminderNote.trim() || null,
      })
      if (data.contact) onContactUpdate?.(data.contact)
      toastRef.current.success('Lembrete agendado.')
      setReminderOpen(false)
      if (historyOpen) loadHistory()
    } catch (err) {
      toastRef.current.error(err?.response?.data?.message || 'Falha ao salvar lembrete.')
    } finally {
      setSavingReminder(false)
    }
  }

  const handleCancelReminder = async (reminderId) => {
    if (!contactId || !reminderId) return
    setCancellingReminderId(reminderId)
    try {
      const { data } = await cancelCrmContactReminder(contactId, reminderId)
      if (data.contact) onContactUpdate?.(data.contact)
      toastRef.current.success('Lembrete removido.')
      if (historyOpen) loadHistory()
    } catch (err) {
      toastRef.current.error(err?.response?.data?.message || 'Falha ao remover lembrete.')
    } finally {
      setCancellingReminderId(null)
    }
  }

  if (!contactId) return null

  const btnClass =
    'flex flex-col items-center justify-center gap-1 rounded-xl border border-accent-500/35 bg-accent-500/10 px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-accent-400 transition hover:border-accent-500/55 hover:bg-accent-500/20 hover:text-accent-300'

  return (
    <>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">Lead</p>
        {(contact.quote || contact.purchase || contact.nextReminder) && (
          <div className="mb-2 space-y-1 rounded-xl border border-brand-700/80 bg-brand-900/50 px-3 py-2 text-xs text-stone-300">
            {contact.quote?.amount != null && (
              <p>
                Orçamento: <span className="font-medium text-accent-300">{formatBrl(contact.quote.amount)}</span>
              </p>
            )}
            {contact.purchase?.amount != null && (
              <p>
                Compra: <span className="font-medium text-emerald-400">{formatBrl(contact.purchase.amount)}</span>
                {contact.purchase.ticket ? (
                  <span className="text-stone-500"> · ticket {contact.purchase.ticket}</span>
                ) : null}
              </p>
            )}
            {contact.nextReminder?.scheduledAt && (
              <p>
                Lembrete:{' '}
                <span className="font-medium text-sky-300">{formatReminderWhen(contact.nextReminder.scheduledAt)}</span>
                {contact.nextReminder.note ? (
                  <span className="text-stone-500"> · {contact.nextReminder.note}</span>
                ) : null}
              </p>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={btnClass} onClick={() => setHistoryOpen(true)}>
            <History className="h-4 w-4" />
            Histórico
          </button>
          <button type="button" className={btnClass} onClick={() => setQuoteOpen(true)}>
            <Receipt className="h-4 w-4" />
            Orçamento
          </button>
          <button type="button" className={btnClass} onClick={() => setPurchaseOpen(true)}>
            <ShoppingBag className="h-4 w-4" />
            Compra
          </button>
          <button type="button" className={btnClass} onClick={() => setReminderOpen(true)}>
            <Bell className="h-4 w-4" />
            Lembrete
          </button>
        </div>
      </div>

      <Modal
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="Histórico do lead"
        size="md"
        footer={
          <Button variant="ghost" onClick={() => setHistoryOpen(false)}>
            Fechar
          </Button>
        }
      >
        {loadingHistory ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-accent-400" />
          </div>
        ) : historyError ? (
          <div className="py-6 text-center">
            <p className="text-sm text-red-300">{historyError}</p>
            <Button size="sm" variant="secondary" className="mt-3" onClick={loadHistory}>
              Tentar novamente
            </Button>
          </div>
        ) : activities.length === 0 ? (
          <p className="py-6 text-center text-sm text-stone-500">Nenhum evento registrado ainda.</p>
        ) : (
          <ul className="max-h-[min(60vh,420px)] space-y-3 overflow-y-auto pr-1">
            {activities.map((item) => {
              const Icon = activityIcon(item.type)
              return (
                <li key={item.id} className="flex gap-3 rounded-xl border border-brand-800 bg-brand-950/50 px-3 py-2.5">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-500/15 text-accent-300">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-stone-100">{item.label}</p>
                    {item.payload?.note ? (
                      <p className="mt-0.5 text-xs text-stone-500">{item.payload.note}</p>
                    ) : null}
                    {item.payload?.ticket ? (
                      <p className="mt-0.5 text-xs text-stone-500">Ticket: {item.payload.ticket}</p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-stone-500">
                      {new Date(item.at).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Modal>

      <Modal
        isOpen={quoteOpen}
        onClose={() => setQuoteOpen(false)}
        title="Salvar orçamento"
        footer={
          <>
            <Button variant="ghost" onClick={() => setQuoteOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveQuote} disabled={savingQuote}>
              {savingQuote ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-stone-400">
          O valor será salvo no lead e uma tag de orçamento será aplicada automaticamente.
        </p>
        <label className="mb-1 block text-xs font-medium text-stone-500">Valor (R$)</label>
        <input
          value={quoteAmount}
          onChange={(e) => setQuoteAmount(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSaveQuote()}
          placeholder="Ex.: 1.500,00"
          className="w-full rounded-xl border border-brand-700 bg-brand-900/60 px-4 py-2.5 text-sm text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/60"
        />
      </Modal>

      <Modal
        isOpen={purchaseOpen}
        onClose={() => setPurchaseOpen(false)}
        title="Confirmar compra"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPurchaseOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmPurchase} disabled={confirmingPurchase}>
              {confirmingPurchase ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmar'}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-stone-400">
          Registra a compra, aplica a tag &quot;Comprou&quot; e move para o estágio Fechado quando existir.
        </p>
        <label className="mb-1 block text-xs font-medium text-stone-500">Valor da compra (R$)</label>
        <input
          value={purchaseAmount}
          onChange={(e) => setPurchaseAmount(e.target.value)}
          placeholder="Ex.: 1.500,00"
          className="mb-3 w-full rounded-xl border border-brand-700 bg-brand-900/60 px-4 py-2.5 text-sm text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/60"
        />
        <label className="mb-1 block text-xs font-medium text-stone-500">Ticket (opcional)</label>
        <input
          value={purchaseTicket}
          onChange={(e) => setPurchaseTicket(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleConfirmPurchase()}
          placeholder="Ex.: #1234 ou pedido manual"
          className="w-full rounded-xl border border-brand-700 bg-brand-900/60 px-4 py-2.5 text-sm text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/60"
        />
      </Modal>

      <Modal
        isOpen={reminderOpen}
        onClose={() => setReminderOpen(false)}
        title="Agendar lembrete"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReminderOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveReminder} disabled={savingReminder}>
              {savingReminder ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar lembrete'}
            </Button>
          </>
        }
      >
        {pendingReminders.length > 0 && (
          <div className="mb-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Lembretes pendentes</p>
            <ul className="max-h-36 space-y-2 overflow-y-auto">
              {pendingReminders.map((r) => (
                <li
                  key={r.id}
                  className="flex items-start justify-between gap-2 rounded-xl border border-brand-800 bg-brand-950/50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-stone-100">{formatReminderWhen(r.scheduledAt)}</p>
                    {r.note ? <p className="mt-0.5 text-xs text-stone-500">{r.note}</p> : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCancelReminder(r.id)}
                    disabled={cancellingReminderId === r.id}
                    className="shrink-0 rounded-lg p-1.5 text-stone-500 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                    title="Remover lembrete"
                  >
                    {cancellingReminderId === r.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mb-3 text-sm text-stone-400">Escolha quando quer ser lembrado deste lead.</p>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-500">Data</label>
            <input
              type="date"
              value={reminderDate}
              onChange={(e) => setReminderDate(e.target.value)}
              className="w-full rounded-xl border border-brand-700 bg-brand-900/60 px-3 py-2.5 text-sm text-stone-100 outline-none focus:border-accent-500/60 [color-scheme:dark]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-stone-500">Hora</label>
            <input
              type="time"
              value={reminderTime}
              onChange={(e) => setReminderTime(e.target.value)}
              className="w-full rounded-xl border border-brand-700 bg-brand-900/60 px-3 py-2.5 text-sm text-stone-100 outline-none focus:border-accent-500/60 [color-scheme:dark]"
            />
          </div>
        </div>
        <label className="mb-1 block text-xs font-medium text-stone-500">Observação (opcional)</label>
        <input
          value={reminderNote}
          onChange={(e) => setReminderNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSaveReminder()}
          placeholder="Ex.: Retornar sobre o orçamento"
          className="w-full rounded-xl border border-brand-700 bg-brand-900/60 px-4 py-2.5 text-sm text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/60"
        />
      </Modal>
    </>
  )
}
