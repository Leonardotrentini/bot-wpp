import { useEffect, useMemo, useState } from 'react'
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
  const [loadError, setLoadError] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)

  async function refresh() {
    setLoading(true)
    setLoadError(null)
    try {
      const { data } = await getWhatsAppStatus()
      setStatus(data)
    } catch (e) {
      const msg = e?.response?.data?.message || e?.message || 'Não foi possível verificar o status do WhatsApp.'
      setLoadError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const connected = status?.connected

  useEffect(() => {
    if (connected || !status?.qr) return undefined
    const timer = window.setInterval(() => {
      getWhatsAppStatus()
        .then(({ data }) => setStatus(data))
        .catch(() => {})
    }, 5000)
    return () => window.clearInterval(timer)
  }, [connected, status?.qr])

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
      const { data } = await connectWhatsApp()
      setStatus(data)
      toast.success('QR gerado. Escaneie no seu WhatsApp.')
    } catch (e) {
      const msg =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        'Falha ao reconectar.'
      toast.error(typeof msg === 'string' ? msg : 'Falha ao reconectar.')
    } finally {
      setActionLoading(false)
    }
  }

  const step = useMemo(() => {
    if (loading) {
      return { progress: 15, label: 'Verificando conexão', description: 'Consultando o backend e a Evolution.' }
    }
    if (connected) {
      const sync = status?.sync
      if (sync?.status === 'SYNCING_GROUPS') {
        return { progress: sync.progress || 75, label: 'Sincronizando grupos', description: sync.message || 'Buscando metadados leves dos grupos.' }
      }
      if (sync?.status === 'RATE_LIMITED') {
        return { progress: sync.progress || 80, label: 'Conectado, em cooldown', description: sync.message || 'WhatsApp limitou consultas temporariamente.' }
      }
      return { progress: 100, label: 'WhatsApp conectado', description: 'Sessão ativa. O QR não é mais necessário.' }
    }
    if (status?.qr) {
      return { progress: 45, label: 'QR pronto para escanear', description: 'Abra Aparelhos conectados no WhatsApp e escaneie o código.' }
    }
    if (actionLoading) {
      return { progress: 30, label: 'Gerando QR', description: 'Criando ou recuperando a instância na Evolution.' }
    }
    return { progress: 0, label: 'Aguardando início', description: 'Clique em Reconectar para gerar o QR no Vesto.' }
  }, [actionLoading, connected, loading, status])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        {loadError && !loading && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {loadError}
            <button type="button" className="ml-2 underline" onClick={refresh}>
              Tentar novamente
            </button>
          </div>
        )}
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
        <div className="mb-6 rounded-2xl border border-brand-700 bg-brand-950/50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-stone-50">{step.label}</p>
              <p className="mt-1 text-xs text-stone-400">{step.description}</p>
            </div>
            <span className="text-sm font-medium text-accent-300">{step.progress}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-brand-800">
            <div className="h-full rounded-full bg-accent-400 transition-all" style={{ width: `${step.progress}%` }} />
          </div>
        </div>

        <h3 className="text-md font-semibold text-stone-50 mb-4 flex items-center gap-2">
          <QrCode className="h-5 w-5 text-accent-400" /> QR Code
        </h3>
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <div className="flex h-72 w-72 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-brand-600 bg-white">
            {connected ? (
              <span className="text-xs text-stone-500 text-center px-6">Sessão ativa — QR não necessário</span>
            ) : status?.qr ? (
              <img src={status.qr} alt="QR Code do WhatsApp" className="h-64 w-64 rounded-md bg-white p-3" />
            ) : (
              <div className="text-center p-2">
                <QrCode className="h-16 w-16 mx-auto text-stone-600 mb-2" />
                <span className="text-xs text-stone-500">Clique em Reconectar para gerar QR</span>
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
