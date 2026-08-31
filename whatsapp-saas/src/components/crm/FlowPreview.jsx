import { Bot, Clock, FileText, Film, ImageIcon, Kanban, Mic, Octagon, Tag as TagIcon, Zap } from 'lucide-react'
import { ImageMediaPreview, VideoMediaPreview } from '../common/MediaPreview.jsx'
import { FLOW_MEDIA_LABELS, flowMessageHasContent } from '../../lib/flowMedia.js'
import { formatActionDelay } from '../../lib/flowActionDelay.js'
import { formatRecordingDelay } from '../../lib/flowRecordingDelay.js'

const URL_IN_TEXT_RE = /(https?:\/\/[^\s]+)/g

function isUrlPart(part) {
  return /^https?:\/\//i.test(part)
}

function renderTextWithLinks(text) {
  const parts = String(text || '').split(URL_IN_TEXT_RE)
  return parts.map((part, i) =>
    isUrlPart(part) ? (
      <span key={i} className="text-sky-300 underline">
        {part}
      </span>
    ) : (
      part
    ),
  )
}

const ACTION_ICONS = {
  add_tag: TagIcon,
  remove_tag: TagIcon,
  move_stage: Kanban,
  assign_ai: Bot,
  set_status: Zap,
  stop_flows: Octagon,
}

function actionSummary(action, { tags, stages, agents }) {
  if (action.type === 'add_tag') {
    const tag = tags.find((t) => t.id === action.tagId)
    return tag ? `Adicionar tag “${tag.name}”` : 'Adicionar tag'
  }
  if (action.type === 'remove_tag') {
    const tag = tags.find((t) => t.id === action.tagId)
    return tag ? `Remover tag “${tag.name}”` : 'Remover tag'
  }
  if (action.type === 'move_stage') {
    const stage = stages.find((s) => s.id === action.stageId)
    return stage ? `Mover para “${stage.name}”` : 'Mover no Kanban'
  }
  if (action.type === 'assign_ai') {
    const agent = agents.find((a) => a.id === action.agentId)
    return agent ? `Ativar IA “${agent.name}”` : 'Ativar agente de IA'
  }
  if (action.type === 'set_status') {
    const labels = { open: 'Aberta', pending: 'Pendente', resolved: 'Resolvida', archived: 'Arquivada' }
    return `Status → ${labels[action.value] || action.value || '—'}`
  }
  if (action.type === 'stop_flows') {
    return 'Parar automações (STOP)'
  }
  return action.type
}

function RecordingChip({ action }) {
  const label = formatRecordingDelay(action)
  if (!label) return null
  return (
    <div className="flex justify-center py-1">
      <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-[10px] font-medium text-sky-200">
        <Mic className="h-3 w-3" />
        {label}
      </span>
    </div>
  )
}

function DelayChip({ action }) {
  const label = formatActionDelay(action)
  if (!label) return null
  return (
    <div className="flex justify-center py-1">
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-medium text-amber-200">
        <Clock className="h-3 w-3" />
        Aguardar {label}
      </span>
    </div>
  )
}

function MessageBubble({ action, bodyOnly = false, mediaOnly = false }) {
  const mediaType = action.mediaType || 'none'
  const previewSrc = action.mediaPreviewUrl || action.mediaBase64 || null
  const body = String(action.body || '').trim()
  const showMedia = !bodyOnly && mediaType !== 'none'
  const showBody = !mediaOnly && body

  return (
    <div className="flex justify-end">
      <div className="max-w-[92%] overflow-hidden rounded-lg rounded-tr-none bg-[#005c4b] px-3 py-2 text-sm text-stone-100 shadow-md">
        {showMedia && mediaType === 'audio' && previewSrc ? (
          <audio src={previewSrc} controls className="mb-1 h-9 w-full min-w-[200px] max-w-xs" preload="metadata" />
        ) : null}
        {showMedia && mediaType === 'video' && previewSrc ? (
          <VideoMediaPreview
            src={previewSrc}
            mediaName={action.mediaName}
            className="mb-1 max-h-40 w-full rounded-md object-contain"
            compact
          />
        ) : null}
        {showMedia && mediaType === 'image' && previewSrc ? (
          <ImageMediaPreview src={previewSrc} alt="" className="mb-1 max-h-40 w-full rounded-md object-cover" />
        ) : null}
        {showMedia && !previewSrc ? (
          <div className="mb-1 flex items-center gap-2 rounded-md bg-black/20 px-2 py-1.5 text-xs text-stone-300">
            {mediaType === 'audio' ? (
              <Mic className="h-4 w-4" />
            ) : mediaType === 'document' ? (
              <FileText className="h-4 w-4" />
            ) : mediaType === 'image' ? (
              <ImageIcon className="h-4 w-4" />
            ) : (
              <Film className="h-4 w-4" />
            )}
            {action.mediaName ||
              FLOW_MEDIA_LABELS[mediaType] ||
              (mediaType === 'audio' ? 'Áudio anexado' : 'Arquivo anexado')}
          </div>
        ) : null}
        {showBody ? (
          <p className="whitespace-pre-wrap break-words leading-relaxed">{renderTextWithLinks(body)}</p>
        ) : null}
        {!showBody && !showMedia ? (
          <p className="text-xs italic text-stone-400">Mensagem vazia</p>
        ) : null}
        <p className="mt-1 text-right text-[10px] text-stone-400/80">
          {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  )
}

function OtherActionRow({ action, tags, stages, agents }) {
  const Icon = ACTION_ICONS[action.type] || Zap
  return (
    <div className="flex items-center gap-2 rounded-lg border border-brand-800/60 bg-brand-950/40 px-2.5 py-2 text-xs text-stone-400">
      <Icon className="h-3.5 w-3.5 shrink-0 text-accent-400" />
      <span>{actionSummary(action, { tags, stages, agents })}</span>
    </div>
  )
}

export function FlowPreview({ flow, tags = [], stages = [], agents = [], compact = false }) {
  const actions = flow?.actions || []
  const hasContent = actions.some(
    (a) => (a.type === 'send_message' && flowMessageHasContent(a)) || a.type !== 'send_message',
  )

  if (!hasContent) {
    return (
      <div className={`rounded-xl border border-brand-700/60 bg-[#0b141a] ${compact ? 'p-3' : 'p-4'}`}>
        <p className="text-xs text-stone-500">Configure ações para ver o preview.</p>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border border-brand-700/60 bg-[#0b141a] ${compact ? 'p-3' : 'p-4'}`}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-500">Preview no WhatsApp</p>
      <div
        className="space-y-2 rounded-xl p-3"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.02) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.015) 0%, transparent 45%)',
        }}
      >
        {actions.map((action, i) => {
          const delayLabel = formatActionDelay(action)
          const showDelay = Boolean(delayLabel)

          if (action.type === 'send_message' && flowMessageHasContent(action)) {
            const body = String(action.body || '').trim()
            const isAudioWithText = action.mediaType === 'audio' && body

            if (isAudioWithText) {
              return (
                <div key={i} className="space-y-2">
                  {showDelay ? <DelayChip action={action} /> : null}
                  <RecordingChip action={action} />
                  <MessageBubble action={action} mediaOnly />
                  <MessageBubble action={action} bodyOnly />
                </div>
              )
            }

            return (
              <div key={i}>
                {showDelay ? <DelayChip action={action} /> : null}
                {action.mediaType === 'audio' ? <RecordingChip action={action} /> : null}
                <MessageBubble action={action} />
              </div>
            )
          }

          if (action.type !== 'send_message') {
            return (
              <div key={i}>
                {showDelay ? <DelayChip action={action} /> : null}
                <OtherActionRow action={action} tags={tags} stages={stages} agents={agents} />
              </div>
            )
          }

          return null
        })}
      </div>
    </div>
  )
}
