import { useEffect, useState } from 'react'
import { CheckCircle2, QrCode, Unplug, RefreshCw } from 'lucide-react'
import { Card } from '../../components/common/Card.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Spinner } from '../../components/common/Spinner.jsx'
import { connectWhatsApp, disconnectWhatsApp, getWhatsAppStatus } from '../../services/api.js'
import { useToast } from '../../contexts/ToastContext.jsx'

export function Connect() {
  const toast = useToast()
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)

  async function refresh() {
    setLoading(true)
    try {
      const { data } = await getWhatsAppStatus()
      setStatus(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function onDisconnect() {
    setActionLoading(true)
    try {
      await disconnectWhatsApp()
      toast.success('WhatsApp desconectado.')
      await refresh()
    } catch {
      toast.error('Não foi possível desconectar.')
    } finally {
      setActionLoading(false)
    }
  }

  async function onReconnect() {
    setActionLoading(true)
    try {
      await connectWhatsApp()
      toast.success('Conexão restabelecida (simulado).')
      await refresh()
    } catch {
      toast.error('Falha ao reconectar.')
    } finally {
      setActionLoading(false)
    }
  }

  const connected = status?.connected

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-stone-50">Status da conexão</h2>
            <p className="text-sm text-stone-400 mt-1">Última sincronização: {status?.lastSync?.replace('T', ' ') || '—'}</p>
          </div>
          {loading ? (
            <Spinner className="h-8 w-8" />
          ) : (
            <div
              className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium ${
                connected
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-brand-600 bg-brand-800/50 text-stone-400'
              }`}
            >
              {connected ? <CheckCircle2 className="h-4 w-4" /> : <Unplug className="h-4 w-4" />}
              {connected ? 'Conectado' : 'Desconectado'}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <h3 className="text-md font-semibold text-stone-50 mb-4 flex items-center gap-2">
          <QrCode className="h-5 w-5 text-accent-400" /> QR Code
        </h3>
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <div className="flex h-48 w-48 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-brand-600 bg-brand-900/80">
            {connected ? (
              <span className="text-xs text-stone-500 text-center px-2">Sessão ativa — QR não necessário</span>
            ) : (
              <div className="text-center p-2">
                <QrCode className="h-16 w-16 mx-auto text-stone-600 mb-2" />
                <span className="text-xs text-stone-500">Placeholder do QR</span>
              </div>
            )}
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-400 flex-1">
            <li>Abra o WhatsApp no celular e vá em Aparelhos conectados.</li>
            <li>Toque em Conectar um aparelho.</li>
            <li>Escaneie o QR Code exibido aqui (quando desconectado).</li>
            <li>Aguarde a confirmação — o status mudará para Conectado.</li>
          </ol>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          {connected ? (
            <Button variant="danger" onClick={onDisconnect} disabled={actionLoading}>
              {actionLoading ? '...' : 'Desconectar'}
            </Button>
          ) : (
            <Button onClick={onReconnect} disabled={actionLoading} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${actionLoading ? 'animate-spin' : ''}`} />
              {actionLoading ? 'Conectando...' : 'Reconectar'}
            </Button>
          )}
        </div>
      </Card>
    </div>
  )
}
