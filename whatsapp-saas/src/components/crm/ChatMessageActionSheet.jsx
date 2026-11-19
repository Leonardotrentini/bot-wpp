import { Copy, Forward, Pencil, Reply, Trash2, X } from 'lucide-react'

/**
 * Bottom sheet de ações da mensagem (estilo WhatsApp).
 */
export function ChatMessageActionSheet({
  open,
  message,
  onClose,
  onReply,
  onForward,
  onEdit,
  onDelete,
  onCopy,
}) {
  if (!open || !message) return null

  const canEdit = Boolean(message.fromMe) && String(message.type || '') === 'text' && !message.deleted
  const canDelete = Boolean(message.fromMe) && !message.deleted
  const canCopy = Boolean(String(message.body || '').trim()) && !message.deleted

  const actions = [
    { key: 'reply', label: 'Responder', icon: Reply, onClick: onReply, show: !message.deleted },
    { key: 'forward', label: 'Encaminhar', icon: Forward, onClick: onForward, show: !message.deleted },
    { key: 'edit', label: 'Editar', icon: Pencil, onClick: onEdit, show: canEdit },
    { key: 'copy', label: 'Copiar', icon: Copy, onClick: onCopy, show: canCopy },
    {
      key: 'delete',
      label: 'Apagar',
      icon: Trash2,
      onClick: onDelete,
      show: canDelete,
      danger: true,
    },
  ].filter((a) => a.show)

  return (
    <div className="fixed inset-0 z-[95]" role="dialog" aria-modal="true" aria-label="Ações da mensagem">
      <button type="button" className="absolute inset-0 bg-black/55" aria-label="Fechar" onClick={onClose} />
      <div
        className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-brand-700/80 bg-brand-900 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl"
        style={{ animation: 'vg-sheet-up 0.22s ease-out' }}
      >
        <div className="relative flex items-center justify-center px-4 pt-3 pb-2">
          <div className="h-1 w-10 rounded-full bg-stone-600/80" aria-hidden />
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-2 rounded-lg p-2 text-stone-400 hover:bg-white/5 hover:text-stone-100"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="px-4 pb-2 text-sm font-semibold text-stone-100">Mensagem</p>
        <div className="flex flex-col px-2 pb-3">
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => {
                a.onClick?.(message)
                onClose?.()
              }}
              className={`flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition active:bg-white/5 ${
                a.danger ? 'text-red-300' : 'text-stone-100'
              }`}
            >
              <a.icon className={`h-5 w-5 ${a.danger ? 'text-red-400' : 'text-stone-400'}`} />
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
