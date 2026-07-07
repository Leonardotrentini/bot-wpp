import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal } from '../common/Modal.jsx'
import { Input } from '../common/Input.jsx'
import { Button } from '../common/Button.jsx'
import { QuickReplyMediaBlock } from './QuickReplyMediaBlock.jsx'
import { emptyQuickReplyMedia, quickReplyHasContent } from '../../lib/quickReplyMedia.js'
import { getCrmQuickReplyContent } from '../../services/api.js'

const EMPTY_FORM = { shortcut: '', title: '', body: '', ...emptyQuickReplyMedia() }

export function QuickReplyFormModal({ isOpen, onClose, initial, defaultBody = '', onSave, saving, onError }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [loadingMedia, setLoadingMedia] = useState(false)

  useEffect(() => {
    if (!isOpen) return

    if (!initial) {
      setForm({ ...EMPTY_FORM, body: defaultBody || '' })
      return
    }

    setForm({
      shortcut: initial.shortcut || '',
      title: initial.title || '',
      body: initial.body || '',
      ...emptyQuickReplyMedia(),
    })

    if (!initial.id || !initial.hasMedia) return undefined

    let cancelled = false
    setLoadingMedia(true)
    getCrmQuickReplyContent(initial.id)
      .then(({ data }) => {
        if (cancelled) return
        const full = data.quickReply
        if (!full) return
        setForm({
          shortcut: full.shortcut || initial.shortcut || '',
          title: full.title || initial.title || '',
          body: full.body || initial.body || '',
          mediaType: full.mediaType || 'none',
          mediaBase64: full.mediaBase64 || null,
          mediaMime: full.mediaMime || null,
          mediaName: full.mediaName || null,
          mediaPreviewUrl: null,
          mediaSize: null,
        })
      })
      .finally(() => {
        if (!cancelled) setLoadingMedia(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, initial, defaultBody])

  const valid = form.shortcut.trim() && quickReplyHasContent(form) && !loadingMedia

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initial ? 'Editar mensagem rápida' : 'Nova mensagem rápida'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => onSave?.(form)} disabled={!valid || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Atalho (use no chat como /atalho)"
          value={form.shortcut}
          onChange={(e) =>
            setForm((f) => ({ ...f, shortcut: e.target.value.replace(/[^a-z0-9_-]/gi, '').toLowerCase() }))
          }
          placeholder="ex.: catalogo"
        />
        <Input
          label="Título (opcional)"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="Ex.: Catálogo PDF"
        />
        <div>
          <p className="mb-1.5 text-sm font-medium text-stone-300">
            {form.mediaType !== 'none' ? 'Legenda (opcional)' : 'Mensagem'}
          </p>
          <textarea
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            rows={4}
            placeholder={
              form.mediaType !== 'none'
                ? 'Texto enviado junto com o anexo…'
                : 'Texto inserido no campo de mensagem ao selecionar o atalho…'
            }
            className="w-full resize-none rounded-xl border border-brand-700 bg-brand-900/60 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/60"
          />
        </div>
        {loadingMedia ? (
          <div className="flex items-center gap-2 py-2 text-xs text-stone-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando anexo…
          </div>
        ) : (
          <QuickReplyMediaBlock form={form} onChange={setForm} onError={onError} />
        )}
      </div>
    </Modal>
  )
}
