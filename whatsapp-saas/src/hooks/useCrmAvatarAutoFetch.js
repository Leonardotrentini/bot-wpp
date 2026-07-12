import { useEffect, useRef } from 'react'
import { enqueueAvatarsFromConversations, enqueueNextAvatarBatch } from '../lib/crmAvatarEnqueue.js'

/**
 * Dispara busca progressiva de fotos enquanto a tela de conversas/CRM está aberta.
 */
export function useCrmAvatarAutoFetch(conversations, { enabled = true, intervalMs = 45000 } = {}) {
  const conversationsRef = useRef(conversations)
  conversationsRef.current = conversations

  useEffect(() => {
    if (!enabled) return undefined

    const run = () => {
      const list = conversationsRef.current
      enqueueAvatarsFromConversations(list, { max: 40 })
      enqueueNextAvatarBatch(20)
    }

    const initialTimer = setTimeout(run, 800)
    const interval = setInterval(run, intervalMs)

    return () => {
      clearTimeout(initialTimer)
      clearInterval(interval)
    }
  }, [enabled, intervalMs])
}
