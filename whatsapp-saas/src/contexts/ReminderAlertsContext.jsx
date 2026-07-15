import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { useAuth } from './AuthContext.jsx'
import { onSocketEvent, connectSocket } from '../services/socket.js'
import { dismissCrmReminderAlert, getCrmReminderAlerts } from '../services/api.js'
import { ensureNotificationPermission, showBrowserReminderNotification } from '../lib/browserNotifications.js'
import { Modal } from '../components/common/Modal.jsx'
import { Button } from '../components/common/Button.jsx'
import { resolveUseRealApi } from '../lib/runtimeEnv.js'

const ReminderAlertsContext = createContext(null)

function formatWhen(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function alertKey(alert) {
  return alert?.reminderId || alert?.id
}

export function ReminderAlertsProvider({ children }) {
  const { user, isOrgOwner } = useAuth()
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState([])
  const [popupAlert, setPopupAlert] = useState(null)
  const [loading, setLoading] = useState(false)
  const seenRef = useRef(new Set())
  const popupQueueRef = useRef([])
  const permissionAskedRef = useRef(false)
  const scopeRef = useRef({ userId: user?.id, isOrgOwner })
  scopeRef.current = { userId: user?.id, isOrgOwner }

  const alertInScope = useCallback((alert) => {
    if (!alert) return false
    const { userId, isOrgOwner: owner } = scopeRef.current
    if (!userId) return true
    if (!alert.userId) return true
    if (alert.userId === userId) return true
    return Boolean(owner)
  }, [])

  const mergeAlerts = useCallback((incoming) => {
    if (!incoming?.length) return
    setAlerts((prev) => {
      const map = new Map(prev.map((a) => [alertKey(a), a]))
      for (const item of incoming) {
        map.set(alertKey(item), item)
      }
      return Array.from(map.values()).sort(
        (a, b) => new Date(b.triggeredAt || b.scheduledAt) - new Date(a.triggeredAt || a.scheduledAt),
      )
    })
  }, [])

  const openPopup = useCallback((alert) => {
    if (!alert) return
    setPopupAlert((current) => {
      if (current) {
        const q = popupQueueRef.current
        if (!q.some((x) => alertKey(x) === alertKey(alert))) q.push(alert)
        return current
      }
      return alert
    })
  }, [])

  const notifyReminder = useCallback(
    (alert, { showPopup = true } = {}) => {
      if (!alertInScope(alert)) return
      const key = alertKey(alert)
      if (!key || seenRef.current.has(key)) return
      seenRef.current.add(key)

      mergeAlerts([alert])

      const title = `Lembrete: ${alert.contactName || 'Lead'}`
      const body = alert.note
        ? `${alert.note} · ${formatWhen(alert.scheduledAt)}`
        : `Retornar ao lead · ${formatWhen(alert.scheduledAt)}`

      showBrowserReminderNotification({
        title,
        body,
        tag: `reminder-${key}`,
        onClick: () => {
          if (alert.conversationId) navigate(`/dashboard/chat?c=${encodeURIComponent(alert.conversationId)}`)
        },
      })

      if (showPopup) openPopup(alert)
    },
    [alertInScope, mergeAlerts, navigate, openPopup],
  )

  const refreshAlerts = useCallback(async () => {
    if (!user || !resolveUseRealApi()) return
    setLoading(true)
    try {
      const { data } = await getCrmReminderAlerts()
      const rows = data.alerts || []
      mergeAlerts(rows)
      for (const alert of rows) {
        notifyReminder(alert, { showPopup: false })
      }
      const newest = rows[0]
      if (newest && popupQueueRef.current.length === 0 && !popupAlert) {
        const key = alertKey(newest)
        const triggeredMs = new Date(newest.triggeredAt || newest.scheduledAt).getTime()
        if (Date.now() - triggeredMs < 120_000 && !seenRef.current.has(`popup-${key}`)) {
          seenRef.current.add(`popup-${key}`)
          openPopup(newest)
        }
      }
    } catch {
      // silencioso — polling de fallback
    } finally {
      setLoading(false)
    }
  }, [user, mergeAlerts, notifyReminder, openPopup, popupAlert])

  const dismissAlert = useCallback(
    async (alert) => {
      const id = alert?.reminderId || alert?.id
      if (!id) return
      try {
        await dismissCrmReminderAlert(id)
      } catch {
        // remove localmente mesmo se API falhar
      }
      setAlerts((prev) => prev.filter((a) => alertKey(a) !== id))
      seenRef.current.delete(id)

      setPopupAlert((current) => {
        if (!current || alertKey(current) !== id) return current
        const next = popupQueueRef.current.shift()
        return next || null
      })
    },
    [],
  )

  const closePopup = useCallback(() => {
    if (!popupAlert) return
    void dismissAlert(popupAlert)
  }, [popupAlert, dismissAlert])

  const goToConversation = useCallback(
    (alert) => {
      if (alert?.conversationId) {
        navigate(`/dashboard/chat?c=${encodeURIComponent(alert.conversationId)}`)
      }
      dismissAlert(alert)
      setPopupAlert(null)
      popupQueueRef.current = []
    },
    [dismissAlert, navigate],
  )

  useEffect(() => {
    if (!user || !resolveUseRealApi()) return undefined
    connectSocket()
    if (!permissionAskedRef.current) {
      permissionAskedRef.current = true
      void ensureNotificationPermission()
    }

    refreshAlerts()
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') refreshAlerts()
    }, 20_000)

    const offDue = onSocketEvent('crm:reminder_due', ({ alert }) => {
      if (alert) notifyReminder(alert, { showPopup: true })
    })

    return () => {
      clearInterval(poll)
      offDue()
    }
  }, [user, notifyReminder, refreshAlerts])

  const value = useMemo(
    () => ({
      alerts,
      loading,
      refreshAlerts,
      dismissAlert,
      goToConversation,
      unreadCount: alerts.length,
    }),
    [alerts, loading, refreshAlerts, dismissAlert, goToConversation],
  )

  return (
    <ReminderAlertsContext.Provider value={value}>
      {children}
      <Modal
        isOpen={Boolean(popupAlert)}
        onClose={closePopup}
        title="Lembrete"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={closePopup}>
              Fechar
            </Button>
            {popupAlert?.conversationId ? (
              <Button onClick={() => goToConversation(popupAlert)}>Abrir conversa</Button>
            ) : (
              <Button onClick={closePopup}>Entendi</Button>
            )}
          </>
        }
      >
        {popupAlert && (
          <div className="flex gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-500/15 text-accent-300">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <p className="text-base font-semibold text-stone-100">{popupAlert.contactName || 'Lead'}</p>
              <p className="mt-1 text-sm text-stone-400">{formatWhen(popupAlert.scheduledAt)}</p>
              {popupAlert.note ? (
                <p className="mt-2 rounded-xl border border-brand-800 bg-brand-950/60 px-3 py-2 text-sm text-stone-200">
                  {popupAlert.note}
                </p>
              ) : (
                <p className="mt-2 text-sm text-stone-500">Hora de retornar a este lead.</p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </ReminderAlertsContext.Provider>
  )
}

export function useReminderAlerts() {
  const ctx = useContext(ReminderAlertsContext)
  if (!ctx) throw new Error('useReminderAlerts outside ReminderAlertsProvider')
  return ctx
}
