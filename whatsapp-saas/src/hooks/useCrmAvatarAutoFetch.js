import { useEffect, useRef } from 'react'
import { resetCrmAvatarEnqueueState, runBackgroundAvatarSweep } from '../lib/crmAvatarEnqueue.js'
import { useAuth } from '../contexts/AuthContext.jsx'

/**
 * Dispara busca progressiva de fotos enquanto a tela de conversas/CRM está aberta.
 * Uma varredura por intervalo; fila única evita rajadas e loops.
 */
export function useCrmAvatarAutoFetch(conversations, { enabled = true, intervalMs = 60000 } = {}) {
  const { user } = useAuth()
  const conversationsRef = useRef(conversations)
  conversationsRef.current = conversations

  useEffect(() => {
    resetCrmAvatarEnqueueState(user?.id)
  }, [user?.id])

  useEffect(() => {
    if (!enabled) return undefined

    const run = () => {
      runBackgroundAvatarSweep(conversationsRef.current)
    }

    const initialTimer = setTimeout(run, 1500)
    const interval = setInterval(run, intervalMs)

    return () => {
      clearTimeout(initialTimer)
      clearInterval(interval)
    }
  }, [enabled, intervalMs])
}
