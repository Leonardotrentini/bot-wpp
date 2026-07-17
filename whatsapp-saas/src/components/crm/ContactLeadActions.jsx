import { useCallback, useEffect, useRef, useState } from 'react'
import { History, Receipt, ShoppingBag, Bell, Loader2, X, Trash2, Pencil } from 'lucide-react'
import { Button } from '../common/Button.jsx'
import { Modal } from '../common/Modal.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import {
  getCrmContactActivity,
  deleteCrmContactActivity,
  updateCrmContactActivity,
  saveCrmContactQuote,
  confirmCrmContactPurchase,
  createCrmContactReminder,
  cancelCrmContactReminder,
} from '../../services/api.js'
import { ensureNotificationPermission } from '../../lib/browserNotifications.js'
import { toastMetaTracking, metaFunnelLabel } from '../../lib/metaTrackingFeedback.js'

function notifyMetaTracking(toastApi, tracking, actionLabel) {
  return toastMetaTracking(toastApi, tracking, actionLabel)
}

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
  return new Date().toLocaleDateString('en-CA')
}

function defaultReminderTime() {
  const d = new Date(Date.now() + 2 * 60_000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function reminderFieldsFromDate(date) {
  return {
    date: date.toLocaleDateString('en-CA'),
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`,
  }
}

function applyReminderOffset(minutes) {
  return reminderFieldsFromDate(new Date(Date.now() + minutes * 60_000))
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

function activityIcon(type) {
  switch (type) {
    case 'quote_saved':
      return Receipt
    case 'purchase_confirmed':
      return ShoppingBag
    case 'reminder_set':
    case 'reminder_cancelled':
    case 'reminder_triggered':
      return Bell
    default:
      return History
  }
}

function hasLegacyQuoteTags(tags = []) {
  const quoteTags = tags.filter((t) => t.name === 'Orçamento' || t.name?.startsWith('Orçamento '))
  return quoteTags.length > 1 || quoteTags.some((t) => t.name !== 'Orçamento')
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
  const [deletingActivityId, setDeletingActivityId] = useState(null)
  const [editActivity, setEditActivity] = useState(null)
  const [editAmount, setEditAmount] = useState('')
  const [editTicket, setEditTicket] = useState('')
  const [editAt, setEditAt] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const contactId = contact?.id
  const pendingReminders = contact?.reminders || []

  const onContactUpdateRef = useRef(onContactUpdate)
  onContactUpdateRef.current = onContactUpdate

  const loadHistory = useCallback(async () => {
    if (!contactId) return
    setLoadingHistory(true)
    setHistoryError(null)
    try {
      const { data } = await getCrmContactActivity(contactId)
      setActivities(data.activities || [])
      if (data.contact) onContactUpdateRef.current?.(data.contact)
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
    if (!contactId || !hasLegacyQuoteTags(contact?.tags)) return
    getCrmContactActivity(contactId)
      .then(({ data }) => {
        if (data.contact) onContactUpdateRef.current?.(data.contact)
      })
      .catch(() => {})
  }, [contactId, contact?.tags])

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
      // Nova venda: sugere orçamento aberto, não a compra anterior
      const base = contact?.quote?.amount
      setPurchaseAmount(base != null ? String(base).replace('.', ',') : '')
      setPurchaseTicket('')
    }
  }, [purchaseOpen, contact?.quote?.amount])

  useEffect(() => {
    if (reminderOpen) {
      const preset = applyReminderOffset(2)
      setReminderDate(preset.date)
      setReminderTime(preset.time)
      setReminderNote('')
      void ensureNotificationPermission()
    }
  }, [reminderOpen])

  const applyReminderPreset = (minutes) => {
    const preset = applyReminderOffset(minutes)
    setReminderDate(preset.date)
    setReminderTime(preset.time)
  }

  const handleDeleteActivity = async (activityId, label) => {
    if (!contactId || !activityId) return
    if (!window.confirm(`Remover esta etapa do histórico?\n\n${label}`)) return
    setDeletingActivityId(activityId)
    try {
      const { data } = await deleteCrmContactActivity(contactId, activityId)
      setActivities((prev) => prev.filter((a) => a.id !== activityId))
      if (data.contact) onContactUpdate?.(data.contact)
      toastRef.current.success('Etapa removida do histórico.')
    } catch (err) {
      toastRef.current.error(err?.response?.data?.message || 'Falha ao remover etapa.')
    } finally {
      setDeletingActivityId(null)
    }
  }

  const openEditActivity = (item) => {
    if (!['quote_saved', 'purchase_confirmed'].includes(item.type)) return
    setEditActivity(item)
    setEditAmount(amountToInput(item.payload?.amount))
    setEditTicket(item.payload?.ticket || '')
    setEditAt(isoToDatetimeLocal(item.at))
  }

  const handleSaveEditActivity = async () => {
    if (!contactId || !editActivity?.id) return
    const amount = parseAmountInput(editAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toastRef.current.error('Informe um valor válido.')
      return
    }
    const at = datetimeLocalToIso(editAt)
    if (!at) {
      toastRef.current.error('Informe uma data válida.')
      return
    }
    setSavingEdit(true)
    try {
      const payload = { amount, at }
      if (editActivity.type === 'purchase_confirmed') {
        payload.ticket = editTicket.trim() || null
      }
      const { data } = await updateCrmContactActivity(contactId, editActivity.id, payload)
      if (data.activity) {
        setActivities((prev) => prev.map((a) => (a.id === data.activity.id ? data.activity : a)))
      } else {
        await loadHistory()
      }
      if (data.contact) onContactUpdate?.(data.contact)
      toastRef.current.success('Histórico atualizado.')
      setEditActivity(null)
    } catch (err) {
      toastRef.current.error(err?.response?.data?.message || 'Falha ao editar etapa.')
    } finally {
      setSavingEdit(false)
    }
  }

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
      const metaWarned = notifyMetaTracking(toastRef.current, data.tracking, 'Orçamento')
      if (!metaWarned) {
        toastRef.current.success('Orçamento salvo.')
      } else if (!data.tracking?.sent) {
        toastRef.current.success('Orçamento salvo no CRM.')
      }
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
      const metaWarned = notifyMetaTracking(toastRef.current, data.tracking, 'Compra')
      if (!metaWarned) {
        toastRef.current.success('Compra confirmada.')
      } else if (data.tracking?.sent) {
        // toast Meta já cobriu; reforço curto no CRM
      } else {
        toastRef.current.success('Compra salva no CRM.')
      }
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
        {contact.metaFunnel && (
          <p className="mb-2 text-[11px] leading-snug text-stone-500">{metaFunnelLabel(contact.metaFunnel)}</p>
        )}
        {(contact.quote || contact.purchase || contact.nextReminder) && (
          <div className="mb-2 space-y-1 rounded-xl border border-brand-700/80 bg-brand-900/50 px-3 py-2 text-xs text-stone-300">
            {contact.quote?.amount != null && (
              <p>
                Orçamento: <span className="font-medium text-accent-300">{formatBrl(contact.quote.amount)}</span>
              </p>
            )}
            {contact.purchase?.amount != null && (
              <p className="flex flex-wrap items-center gap-2">
                Compra: <span className="font-medium text-emerald-400">{formatBrl(contact.purchase.amount)}</span>
                {contact.purchase.ticket ? (
                  <span className="text-stone-500"> · ticket {contact.purchase.ticket}</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setPurchaseOpen(true)}
                  className="text-[10px] font-semibold uppercase tracking-wide text-accent-400 hover:text-accent-300"
                >
                  Editar
                </button>
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
                  <div className="mt-0.5 flex shrink-0 gap-0.5">
                    {['quote_saved', 'purchase_confirmed'].includes(item.type) ? (
                      <button
                        type="button"
                        onClick={() => openEditActivity(item)}
                        className="rounded-lg p-1.5 text-stone-500 transition hover:bg-accent-500/10 hover:text-accent-300"
                        title="Editar etapa"
                        aria-label="Editar etapa"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => handleDeleteActivity(item.id, item.label)}
                      disabled={deletingActivityId === item.id}
                      className="rounded-lg p-1.5 text-stone-500 transition hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                      title="Remover etapa"
                      aria-label="Remover etapa"
                    >
                      {deletingActivityId === item.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
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
          O valor fica salvo no card do lead. A etiqueta <strong className="text-stone-300">Orçamento</strong> é aplicada
          uma vez — ao salvar de novo, só o valor é atualizado.
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
          Registra uma nova venda neste lead (pode haver várias). Aplica a tag &quot;Comprou&quot; e move para
          Fechado quando existir. O evento Purchase na Meta continua enviando só 1x por lead.
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
        <div className="mb-3 flex flex-wrap gap-2">
          {[
            { label: 'Em 2 min', minutes: 2 },
            { label: 'Em 15 min', minutes: 15 },
            { label: 'Em 1 h', minutes: 60 },
          ].map((preset) => (
            <button
              key={preset.minutes}
              type="button"
              onClick={() => applyReminderPreset(preset.minutes)}
              className="rounded-full border border-accent-500/35 bg-accent-500/10 px-3 py-1 text-[11px] font-medium text-accent-300 transition hover:bg-accent-500/20"
            >
              {preset.label}
            </button>
          ))}
        </div>
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

      <Modal
        isOpen={Boolean(editActivity)}
        onClose={() => setEditActivity(null)}
        title={editActivity?.type === 'purchase_confirmed' ? 'Editar compra' : 'Editar orçamento'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditActivity(null)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveEditActivity} disabled={savingEdit}>
              {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-stone-400">
          Corrige a etapa no histórico do lead. Não reenvia evento à Meta.
        </p>
        <label className="mb-1 block text-xs font-medium text-stone-500">Valor (R$)</label>
        <input
          value={editAmount}
          onChange={(e) => setEditAmount(e.target.value)}
          placeholder="Ex.: 1.500,00"
          className="mb-3 w-full rounded-xl border border-brand-700 bg-brand-900/60 px-4 py-2.5 text-sm text-stone-100 outline-none focus:border-accent-500/60"
        />
        {editActivity?.type === 'purchase_confirmed' ? (
          <>
            <label className="mb-1 block text-xs font-medium text-stone-500">Ticket (opcional)</label>
            <input
              value={editTicket}
              onChange={(e) => setEditTicket(e.target.value)}
              placeholder="Ex.: #1234"
              className="mb-3 w-full rounded-xl border border-brand-700 bg-brand-900/60 px-4 py-2.5 text-sm text-stone-100 outline-none focus:border-accent-500/60"
            />
          </>
        ) : null}
        <label className="mb-1 block text-xs font-medium text-stone-500">Data / hora</label>
        <input
          type="datetime-local"
          value={editAt}
          onChange={(e) => setEditAt(e.target.value)}
          className="w-full rounded-xl border border-brand-700 bg-brand-900/60 px-4 py-2.5 text-sm text-stone-100 outline-none focus:border-accent-500/60"
        />
      </Modal>
    </>
  )
}
