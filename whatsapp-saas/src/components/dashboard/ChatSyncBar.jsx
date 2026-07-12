import { useState } from 'react'
import {
  RefreshCw,
  Loader2,
  Clock,
  MessageSquare,
  User,
  Shield,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '../common/Button.jsx'
import { Modal } from '../common/Modal.jsx'
import { Select } from '../common/Select.jsx'

function formatSyncTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  if (sameDay) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function formatEta(seconds) {
  if (!seconds || seconds <= 0) return null
  if (seconds < 60) return `~${seconds}s restantes`
  if (seconds < 3600) return `~${Math.ceil(seconds / 60)} min restantes`
  return `~${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}min restantes`
}

const PERIOD_ESTIMATES = {
  7: '15–45 min',
  30: '30 min – 2 h',
  90: '1–4 h',
  180: '2–6 h',
}

function ModalSection({ icon: Icon, title, children }) {
  return (
    <section className="rounded-xl border border-brand-700/80 bg-brand-950/40 p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-accent-400" />
        <h3 className="text-sm font-semibold text-stone-100">{title}</h3>
      </div>
      <div className="space-y-2 text-sm leading-relaxed text-stone-400">{children}</div>
    </section>
  )
}

function ChatSyncModal({ isOpen, onClose, onConfirm, syncStarting, lastJob }) {
  const [days, setDays] = useState('30')
  const estimate = PERIOD_ESTIMATES[days] || PERIOD_ESTIMATES[30]

  const handleConfirm = async () => {
    const ok = await onConfirm(Number(days))
    if (ok) onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Sincronizar conversas"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={syncStarting}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={syncStarting}>
            {syncStarting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Iniciando…
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Iniciar sincronização
              </>
            )}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-stone-300">
          Importa o histórico do WhatsApp e atualiza telefones, fotos e nomes dos contatos — tudo em um único processo,
          com pausas automáticas para proteger sua conta.
        </p>

        <div className="rounded-xl border border-brand-700 bg-brand-900/50 p-3">
          <label htmlFor="sync-days" className="mb-1.5 block text-xs font-medium text-stone-400">
            Período do histórico
          </label>
          <Select id="sync-days" className="w-full" value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="180">Últimos 180 dias</option>
          </Select>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-stone-500">
            <Clock className="h-3.5 w-3.5 shrink-0 text-accent-400" />
            Tempo estimado: <span className="text-stone-300">{estimate}</span> (varia com o volume de conversas)
          </p>
        </div>

        <ModalSection icon={MessageSquare} title="O que será feito">
          <ul className="list-disc space-y-1 pl-5">
            <li>Importar mensagens antigas do período escolhido</li>
            <li>Atualizar fotos de perfil e telefones dos contatos</li>
            <li>Buscar nomes do WhatsApp quando a API expuser</li>
            <li>Mensagens novas continuam entrando em tempo real — não precisa sincronizar de novo por isso</li>
          </ul>
        </ModalSection>

        <ModalSection icon={Shield} title="Boas práticas">
          <ul className="list-disc space-y-1 pl-5">
            <li>Faça com calma — o processo é lento de propósito (anti-ban)</li>
            <li>Não clique em sincronizar várias vezes seguidas</li>
            <li>Se aparecer limite do WhatsApp, aguarde: retoma sozinho depois</li>
            <li>Mantenha a aba aberta ou recarregue depois de alguns minutos para ver fotos na fila</li>
          </ul>
        </ModalSection>

        <ModalSection icon={User} title="Sobre nomes e números">
          <ul className="list-disc space-y-1 pl-5">
            <li>Contatos não salvos aparecem com o telefone quando a API enviar</li>
            <li>Nome da agenda só aparece se o número estiver salvo no celular conectado</li>
            <li>Alguns contatos com privacidade (@lid) podem ficar sem número — salve um nome manualmente no painel</li>
          </ul>
        </ModalSection>

        {lastJob?.status === 'done' && (
          <p className="flex items-start gap-2 rounded-lg border border-brand-700/80 bg-brand-950/30 px-3 py-2 text-xs text-stone-500">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone-400" />
            Última sync: {formatSyncTime(lastJob.finishedAt)} · {lastJob.totalMessages} msgs · {lastJob.doneChats}{' '}
            conversas
          </p>
        )}
      </div>
    </Modal>
  )
}

export function ChatSyncBar({ job, onStartSync, syncStarting }) {
  const [modalOpen, setModalOpen] = useState(false)
  const idle = !job || ['done', 'error', 'cancelled'].includes(job.status)

  const handleConfirm = (days) => onStartSync(days)

  if (idle) {
    const statusText = syncStarting
      ? 'Iniciando sincronização…'
      : job?.status === 'done'
        ? `Sync ${formatSyncTime(job.finishedAt)} · ${job.totalMessages} msgs`
        : job?.status === 'error'
          ? job.error
            ? `Última sync falhou: ${job.error}`
            : 'Última sync falhou'
          : 'Histórico e perfis do WhatsApp'

    return (
      <>
        <div className="flex items-center gap-2 border-b border-brand-800/80 bg-brand-950/30 px-3 py-2">
          <RefreshCw className="h-3.5 w-3.5 shrink-0 text-stone-500" aria-hidden />
          <p className="min-w-0 flex-1 truncate text-[11px] text-stone-500" title={statusText}>
            {statusText}
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setModalOpen(true)}
            disabled={syncStarting}
            className="h-8 shrink-0 px-3 text-xs"
          >
            {syncStarting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sincronizar
          </Button>
        </div>
        <ChatSyncModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onConfirm={handleConfirm}
          syncStarting={syncStarting}
          lastJob={job?.status === 'done' ? job : null}
        />
      </>
    )
  }

  const pct = job.totalChats > 0 ? Math.round((job.doneChats / job.totalChats) * 100) : 0
  const rateLimited = job.status === 'rate_limited'

  return (
    <div
      className={`border-b px-3 py-1.5 ${rateLimited ? 'border-amber-500/30 bg-amber-500/10' : 'border-accent-500/25 bg-accent-500/10'}`}
    >
      <div className="flex items-center gap-2 text-[11px]">
        {rateLimited ? (
          <Clock className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent-400" />
        )}
        <span className={`min-w-0 flex-1 truncate ${rateLimited ? 'text-amber-200' : 'text-accent-200'}`}>
          {rateLimited
            ? `Limite WhatsApp · retoma ${job.retryAfter ? new Date(job.retryAfter).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'em breve'}`
            : `${job.doneChats}/${job.totalChats} conversas · ${job.totalMessages} msgs`}
          {!rateLimited && formatEta(job.etaSeconds) ? ` · ${formatEta(job.etaSeconds)}` : ''}
        </span>
        <span className="shrink-0 text-stone-500">{pct}%</span>
      </div>
      {!rateLimited && (
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-brand-800">
          <div className="h-full rounded-full bg-accent-500 transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}
