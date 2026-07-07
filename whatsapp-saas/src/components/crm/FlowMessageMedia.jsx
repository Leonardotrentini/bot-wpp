import { useRef } from 'react'
import { Film, Mic, Paperclip, X } from 'lucide-react'
import { Button } from '../common/Button.jsx'
import { VideoMediaPreview, formatMediaSize, revokeMediaPreviewUrl } from '../common/MediaPreview.jsx'
import { FLOW_FILE_ACCEPT, attachFlowMediaFromFile, emptyFlowMessageMedia } from '../../lib/flowMedia.js'

export function FlowMessageMedia({ action, onChange, onError }) {
  const inputRef = useRef(null)
  const mediaType = action.mediaType || 'none'
  const previewSrc = action.mediaPreviewUrl || action.mediaBase64 || null

  async function onPick(ev) {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file) return
    const result = await attachFlowMediaFromFile(file)
    if (result.error) {
      onError?.(result.error)
      return
    }
    onChange(result.patch)
  }

  function clear() {
    revokeMediaPreviewUrl(action.mediaPreviewUrl)
    onChange(emptyFlowMessageMedia())
  }

  return (
    <div className="space-y-2">
      <textarea
        value={action.body || ''}
        onChange={(e) => onChange({ body: e.target.value })}
        rows={3}
        placeholder={mediaType === 'none' ? 'Texto da mensagem automática…' : 'Legenda (opcional)…'}
        className="w-full resize-none rounded-xl border border-brand-700 bg-brand-900/60 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/60"
      />
      <div className="rounded-xl border border-brand-800 bg-brand-900/40 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-stone-400">
            Anexar áudio ou vídeo MP4
          </p>
          {mediaType === 'none' ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => inputRef.current?.click()}>
              <Paperclip className="h-3.5 w-3.5" />
              Escolher arquivo
            </Button>
          ) : (
            <button
              type="button"
              onClick={clear}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-stone-400 transition hover:bg-white/5 hover:text-red-300"
            >
              <X className="h-3.5 w-3.5" />
              Remover
            </button>
          )}
        </div>
        {mediaType === 'none' ? (
          <p className="text-[11px] leading-relaxed text-stone-500">
            Áudio até 16MB · Vídeo MP4 até 512MB. Pode enviar só mídia ou mídia com legenda.
          </p>
        ) : (
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-500/15 text-accent-300">
              {mediaType === 'audio' ? <Mic className="h-5 w-5" /> : <Film className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-stone-200">{action.mediaName || mediaType}</p>
              {action.mediaSize ? (
                <p className="text-[10px] text-stone-500">{formatMediaSize(action.mediaSize)}</p>
              ) : null}
              {mediaType === 'audio' && previewSrc && (
                <audio src={previewSrc} controls className="mt-2 h-9 w-full max-w-sm" preload="metadata" />
              )}
              {mediaType === 'video' && (
                <VideoMediaPreview
                  src={previewSrc}
                  mediaName={action.mediaName}
                  mediaSize={action.mediaSize}
                  className="mt-2 max-h-36 w-full rounded-lg border border-brand-700 object-contain"
                  compact
                />
              )}
            </div>
          </div>
        )}
        <input ref={inputRef} type="file" accept={FLOW_FILE_ACCEPT} className="hidden" onChange={onPick} />
      </div>
    </div>
  )
}
