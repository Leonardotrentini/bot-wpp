import { useEffect, useState } from 'react'
import { Bell, Share, Smartphone } from 'lucide-react'
import { Modal } from '../common/Modal.jsx'
import { Button } from '../common/Button.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { resolveUseRealApi } from '../../lib/runtimeEnv.js'
import {
  enableWebPush,
  getPushStatus,
  isStandalonePwa,
  pushSupported,
} from '../../lib/webPushClient.js'

function dismissKey(userId) {
  return `vg_push_prompt_dismissed_${userId || 'anon'}`
}

function isIos() {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function wasDismissedRecently(userId) {
  try {
    const raw = localStorage.getItem(dismissKey(userId))
    if (!raw) return false
    const at = Number(raw)
    if (!Number.isFinite(at)) return true
    // Reaparece depois de 7 dias se o usuário adiou.
    return Date.now() - at < 7 * 24 * 60 * 60 * 1000
  } catch {
    return false
  }
}

function markDismissed(userId) {
  try {
    localStorage.setItem(dismissKey(userId), String(Date.now()))
  } catch {
    /* ignore */
  }
}

/** Após login: pede permissão de push no aparelho (celular incluso). */
export function PushEnablePrompt() {
  const { user, isImpersonating } = useAuth()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ios = isIos()
  const standalone = isStandalonePwa()
  const needsHomeScreen = ios && !standalone

  useEffect(() => {
    if (!user?.id || isImpersonating || !resolveUseRealApi()) {
      setOpen(false)
      return
    }
    if (wasDismissedRecently(user.id)) return

    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const status = await getPushStatus()
        if (cancelled) return
        if (status.subscribed) return
        if (status.permission === 'granted' && status.subscribed) return
        // Sem suporte e não é iOS aguardando PWA → não mostra.
        if (!status.supported && !needsHomeScreen) return
        // Servidor sem VAPID ainda.
        if (status.supported && status.configured === false && !needsHomeScreen) return
        setOpen(true)
      } catch {
        /* ignore */
      }
    }, 1200)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [user?.id, isImpersonating, needsHomeScreen])

  const onClose = () => {
    markDismissed(user?.id)
    setOpen(false)
  }

  const onEnable = async () => {
    setBusy(true)
    try {
      await enableWebPush()
      toast.success('Notificações ativadas. Você receberá alertas de novas mensagens neste aparelho.')
      markDismissed(user?.id)
      setOpen(false)
    } catch (err) {
      if (err?.code === 'PERMISSION_DENIED') {
        toast.error('Permissão negada. Ative notificações nas configurações do navegador/sistema.')
        markDismissed(user?.id)
        setOpen(false)
      } else {
        toast.error(err?.message || 'Não foi possível ativar as notificações.')
      }
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Ativar notificações"
      size="sm"
      footer={
        needsHomeScreen ? (
          <Button variant="secondary" onClick={onClose}>
            Entendi
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Agora não
            </Button>
            <Button onClick={onEnable} disabled={busy || !pushSupported()}>
              {busy ? 'Ativando…' : 'Permitir notificações'}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3 text-sm text-stone-300">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-xl bg-accent-500/15 p-2 text-accent-400">
            <Bell className="h-5 w-5" />
          </div>
          <p>
            Receba alertas no celular quando chegar mensagem no CRM — mesmo com o app fechado ou a tela
            bloqueada.
          </p>
        </div>

        {needsHomeScreen ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-amber-100">
            <p className="font-medium text-amber-50">No iPhone, primeiro adicione à Tela de Início:</p>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-amber-100/90">
              <li className="inline-flex flex-wrap items-center gap-1">
                Toque em <Share className="inline h-3.5 w-3.5" /> Compartilhar no Safari
              </li>
              <li>
                Escolha <strong>Adicionar à Tela de Início</strong>
              </li>
              <li>
                Abra o ícone <Smartphone className="inline h-3.5 w-3.5" /> Vesto e permita as notificações
              </li>
            </ol>
          </div>
        ) : (
          <p className="text-xs text-stone-500">
            Ao tocar em Permitir, o navegador vai pedir confirmação neste aparelho.
          </p>
        )}
      </div>
    </Modal>
  )
}
