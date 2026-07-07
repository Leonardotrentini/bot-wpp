import { useRef } from 'react'
import { FileText, Film, Mic, Paperclip, X } from 'lucide-react'
import { Button } from '../common/Button.jsx'
import { ImageMediaPreview, VideoMediaPreview } from '../common/MediaPreview.jsx'
import {
  QUICK_REPLY_FILE_ACCEPT,
  QUICK_REPLY_MEDIA_LABELS,
  attachQuickReplyMediaFromFile,
  clearQuickReplyMedia,
  emptyQuickReplyMedia,
} from '../../lib/quickReplyMedia.js'
import { audioMaxLabel, documentMaxLabel, imageMaxLabel, videoMaxLabel } from '../../lib/mediaLimits.js'

export function QuickReplyMediaBlock({ form, onChange, onError }) {
  const inputRef = useRef(null)
  const mediaType = form.mediaType || 'none'
  const previewSrc = form.mediaPreviewUrl || form.mediaBase64 || null

  async function onPick(ev) {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file) return
    const result = await attachQuickReplyMediaFromFile(file)
    if (result.error) {
      onError?.(result.error)
      return
    }
    onChange({ ...form, ...result.patch })
  }

  function clear() {
    onChange(clearQuickReplyMedia(form))
  }

  return (
    <div className="rounded-xl border border-brand-800 bg-brand-900/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-stone-400">Anexo (opcional)</p>
        {mediaType === 'none' ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => inputRef.current?.click()}>
            <Paperclip className="h-3.5 w-3.5" />
            Anexar
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
          Imagem até {imageMaxLabel} · Vídeo MP4 até {videoMaxLabel} · Áudio até {audioMaxLabel} · PDF até{' '}
          {documentMaxLabel}
        </p>
      ) : (
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-500/15 text-accent-300">
            {mediaType === 'audio' ? (
              <Mic className="h-5 w-5" />
            ) : mediaType === 'video' ? (
              <Film className="h-5 w-5" />
            ) : mediaType === 'document' ? (
              <FileText className="h-5 w-5" />
            ) : (
              <Paperclip className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-stone-200">
              {QUICK_REPLY_MEDIA_LABELS[mediaType] || mediaType}
              {form.mediaName ? ` · ${form.mediaName}` : ''}
            </p>
            {mediaType === 'audio' && previewSrc && (
              <audio src={previewSrc} controls className="mt-2 h-9 w-full max-w-sm" preload="metadata" />
            )}
            {mediaType === 'video' && (
              <VideoMediaPreview
                src={previewSrc}
                mediaName={form.mediaName}
                className="mt-2 max-h-32 w-full rounded-lg border border-brand-700 object-contain"
                compact
              />
            )}
            {mediaType === 'image' && (
              <ImageMediaPreview src={previewSrc} alt="" className="mt-2 max-h-32 w-full rounded-lg border border-brand-700 object-cover" />
            )}
            {mediaType === 'document' && (
              <p className="mt-1 text-[11px] text-stone-500">PDF anexado — use o campo acima como legenda (opcional).</p>
            )}
          </div>
        </div>
      )}
      <input ref={inputRef} type="file" accept={QUICK_REPLY_FILE_ACCEPT} className="hidden" onChange={onPick} />
    </div>
  )
}
