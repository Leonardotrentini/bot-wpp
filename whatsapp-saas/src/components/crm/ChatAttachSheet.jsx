import { Camera, FileText, Image as ImageIcon, X } from 'lucide-react'

/**
 * Bottom sheet de anexos — só usado no layout mobile do Chat.
 * Não altera o fluxo de envio: só dispara ações (câmera / galeria / PDF).
 */
export function ChatAttachSheet({ open, onClose, onCamera, onGallery, onDocument }) {
  if (!open) return null

  const actions = [
    { key: 'camera', label: 'Câmera', hint: 'Foto ou vídeo', icon: Camera, onClick: onCamera },
    { key: 'gallery', label: 'Galeria', hint: 'Fotos e vídeos', icon: ImageIcon, onClick: onGallery },
    { key: 'document', label: 'Documento', hint: 'PDF', icon: FileText, onClick: onDocument },
  ]

  return (
    <div className="fixed inset-0 z-[90] lg:hidden" role="dialog" aria-modal="true" aria-label="Anexar">
      <button type="button" className="absolute inset-0 bg-black/55" aria-label="Fechar" onClick={onClose} />
      <div
        className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-brand-700/80 bg-brand-900 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl"
        style={{ animation: 'vg-sheet-up 0.22s ease-out' }}
      >
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="mx-auto h-1 w-10 rounded-full bg-stone-600/80" aria-hidden />
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 rounded-lg p-2 text-stone-400 hover:bg-white/5 hover:text-stone-100"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="px-4 pb-3 text-sm font-semibold text-stone-100">Anexar</p>
        <div className="grid grid-cols-3 gap-2 px-4 pb-4">
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => {
                a.onClick?.()
                onClose?.()
              }}
              className="flex flex-col items-center gap-2 rounded-2xl border border-brand-700/70 bg-brand-950/50 px-2 py-4 text-center transition active:scale-[0.98] hover:border-accent-500/35"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-500/15 text-accent-300">
                <a.icon className="h-6 w-6" />
              </span>
              <span className="text-xs font-medium text-stone-100">{a.label}</span>
              <span className="text-[10px] text-stone-500">{a.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
