import { useEffect, useState } from 'react'
import { Bell, BellOff, Share, Smartphone } from 'lucide-react'
import { Card } from '../common/Card.jsx'
import { Button } from '../common/Button.jsx'
import { Badge } from '../common/Badge.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { resolveUseRealApi } from '../../lib/runtimeEnv.js'
import {
  disableWebPush,
  enableWebPush,
  getPushStatus,
  isStandalonePwa,
  pushSupported,
} from '../../lib/webPushClient.js'

function isIos() {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function PushNotificationsCard() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState({
    supported: pushSupported(),
    configured: false,
    subscribed: false,
    devices: 0,
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
  })
  const standalone = isStandalonePwa()
  const ios = isIos()
  const demoMode = !resolveUseRealApi()

  const refresh = async () => {
    setLoading(true)
    try {
      if (demoMode) {
        setStatus({
          supported: pushSupported(),
          configured: false,
          subscribed: false,
          devices: 0,
          permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
        })
        return
      }
      const next = await getPushStatus()
      setStatus(next)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const onEnable = async () => {
    setBusy(true)
    try {
      await enableWebPush()
      toast.success('Notificações ativadas neste aparelho.')
      await refresh()
    } catch (err) {
      if (err?.code === 'PERMISSION_DENIED') {
        toast.error('Permissão negada. Ative notificações nas configurações do Safari/sistema.')
      } else {
        toast.error(err?.message || 'Não foi possível ativar as notificações.')
      }
    } finally {
      setBusy(false)
    }
  }

  const onDisable = async () => {
    setBusy(true)
    try {
      await disableWebPush()
      toast.success('Notificações desativadas neste aparelho.')
      await refresh()
    } catch {
      toast.error('Falha ao desativar.')
    } finally {
      setBusy(false)
    }
  }

  const needsHomeScreen = ios && !standalone

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-accent-400" />
          <div>
            <h3 className="font-semibold text-stone-50">Notificações de mensagens</h3>
            <p className="text-xs text-stone-500">
              Receba alerta mesmo com o celular bloqueado ou o app fechado.
            </p>
          </div>
        </div>
        {status.subscribed ? (
          <Badge variant="success">Ativo</Badge>
        ) : (
          <Badge variant="warning">Desligado</Badge>
        )}
      </div>

      {needsHomeScreen && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-sm text-amber-100">
          <p className="font-medium text-amber-50">No iPhone, adicione à Tela de Início:</p>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-amber-100/90">
            <li className="inline-flex flex-wrap items-center gap-1">
              Toque em <Share className="inline h-3.5 w-3.5" /> Compartilhar no Safari
            </li>
            <li>
              Escolha <strong>Adicionar à Tela de Início</strong>
            </li>
            <li>
              Abra o ícone <Smartphone className="inline h-3.5 w-3.5" /> Vesto e ative as notificações aqui
            </li>
          </ol>
        </div>
      )}

      {demoMode && (
        <p className="text-sm text-stone-400">
          Em modo demonstração o push fica desligado. No ambiente real (celular/Chrome), após o login
          aparece o pedido para <strong className="font-medium text-stone-200">Permitir</strong> e as
          mensagens novas notificam neste aparelho.
        </p>
      )}

      {!demoMode && !status.supported && (
        <p className="text-sm text-stone-400">Este navegador não suporta notificações push.</p>
      )}

      {!demoMode && status.supported && !status.configured && !loading && (
        <p className="text-sm text-stone-400">
          Servidor ainda sem configuração de push. Se acabou de publicar, aguarde o deploy do backend.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {!status.subscribed ? (
          <Button
            onClick={onEnable}
            disabled={
              busy ||
              loading ||
              demoMode ||
              !status.supported ||
              needsHomeScreen ||
              status.configured === false
            }
          >
            {busy ? 'Ativando…' : 'Ativar notificações'}
          </Button>
        ) : (
          <Button variant="secondary" onClick={onDisable} disabled={busy}>
            <span className="inline-flex items-center gap-1.5">
              <BellOff className="h-4 w-4" />
              {busy ? 'Desativando…' : 'Desativar neste aparelho'}
            </span>
          </Button>
        )}
      </div>

      {standalone && (
        <p className="text-xs text-stone-500">App instalado na tela inicial — push disponível neste dispositivo.</p>
      )}
    </Card>
  )
}
