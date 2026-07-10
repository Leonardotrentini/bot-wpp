import { Bot, FileText, Film, ImageIcon, Kanban, Mic, Tag as TagIcon, Zap } from 'lucide-react'
import { ImageMediaPreview, VideoMediaPreview } from '../common/MediaPreview.jsx'
import { FLOW_MEDIA_LABELS, flowMessageHasContent } from '../../lib/flowMedia.js'

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
  move_stage: Kanban,
  assign_ai: Bot,
  set_status: Zap,
}

function actionSummary(action, { tags, stages, agents }) {
  if (action.type === 'add_tag') {
    const tag = tags.find((t) => t.id === action.tagId)
    return tag ? `Adicionar tag “${tag.name}”` : 'Adicionar tag'
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
  return action.type
}

function MessageBubble({ action }) {
  const mediaType = action.mediaType || 'none'
  const previewSrc = action.mediaPreviewUrl || action.mediaBase64 || null
  const body = String(action.body || '').trim()

  return (
    <div className="flex justify-end">
      <div className="max-w-[92%] overflow-hidden rounded-lg rounded-tr-none bg-[#005c4b] px-3 py-2 text-sm text-stone-100 shadow-md">
        {mediaType === 'audio' && previewSrc ? (
          <audio src={previewSrc} controls className="mb-1 h-9 w-full min-w-[200px] max-w-xs" preload="metadata" />
        ) : null}
        {mediaType === 'video' && previewSrc ? (
          <VideoMediaPreview
            src={previewSrc}
            mediaName={action.mediaName}
            className="mb-1 max-h-40 w-full rounded-md object-contain"
            compact
          />
        ) : null}
        {mediaType === 'image' && previewSrc ? (
          <ImageMediaPreview src={previewSrc} alt="" className="mb-1 max-h-40 w-full rounded-md object-cover" />
        ) : null}
        {mediaType !== 'none' && !previewSrc ? (
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
        {body ? (
          <p className="whitespace-pre-wrap break-words leading-relaxed">{renderTextWithLinks(body)}</p>
        ) : null}
        {!body && mediaType === 'none' ? (
          <p className="text-xs italic text-stone-400">Mensagem vazia</p>
        ) : null}
        <p className="mt-1 text-right text-[10px] text-stone-400/80">
          {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  )
}

export function FlowPreview({ flow, tags = [], stages = [], agents = [], compact = false }) {
  const actions = flow?.actions || []
  const messageActions = actions.filter((a) => a.type === 'send_message' && flowMessageHasContent(a))
  const otherActions = actions.filter((a) => a.type !== 'send_message')

  if (!messageActions.length && !otherActions.length) {
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
        {messageActions.map((action, i) => (
          <MessageBubble key={i} action={action} />
        ))}
      </div>
      {otherActions.length > 0 ? (
        <div className="mt-3 space-y-1.5 border-t border-brand-800 pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Outras ações</p>
          {otherActions.map((action, i) => {
            const Icon = ACTION_ICONS[action.type] || Zap
            return (
              <div key={i} className="flex items-center gap-2 text-xs text-stone-400">
                <Icon className="h-3.5 w-3.5 shrink-0 text-accent-400" />
                <span>{actionSummary(action, { tags, stages, agents })}</span>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
