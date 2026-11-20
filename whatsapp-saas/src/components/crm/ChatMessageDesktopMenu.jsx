import { Copy, Forward, MoreVertical, Pencil, Reply, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/**
 * Menu de ações no desktop (estilo WhatsApp Web): aparece no hover, sem atrapalhar seleção de texto.
 */
export function ChatMessageDesktopMenu({
  message,
  align = 'end',
  onReply,
  onForward,
  onEdit,
  onDelete,
  onCopy,
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!message || message.deleted) return null

  const canEdit = Boolean(message.fromMe) && String(message.type || '') === 'text'
  const canDelete = Boolean(message.fromMe)
  const canCopy = Boolean(String(message.body || '').trim())

  const run = (fn) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    setOpen(false)
    fn?.(message)
  }

  return (
    <div
      ref={rootRef}
      className={`pointer-events-none absolute top-0 z-10 opacity-0 transition group-hover/msg:pointer-events-auto group-hover/msg:opacity-100 ${
        align === 'start' ? 'left-0 -translate-x-1' : 'right-0 translate-x-1'
      }`}
    >
      <div className="relative">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setOpen((v) => !v)
          }}
          className="rounded-md border border-brand-600/80 bg-brand-900/95 p-1 text-stone-300 shadow-lg backdrop-blur hover:bg-brand-800 hover:text-stone-50"
          aria-label="Mais ações"
          title="Mais ações"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
        {open ? (
          <div
            className={`absolute top-full z-20 mt-1 min-w-[10.5rem] overflow-hidden rounded-xl border border-brand-600/80 bg-brand-900 py-1 shadow-2xl ${
              align === 'start' ? 'left-0' : 'right-0'
            }`}
          >
            <MenuItem icon={Reply} label="Responder" onClick={run(onReply)} />
            <MenuItem icon={Forward} label="Encaminhar" onClick={run(onForward)} />
            {canCopy ? <MenuItem icon={Copy} label="Copiar" onClick={run(onCopy)} /> : null}
            {canEdit ? <MenuItem icon={Pencil} label="Editar" onClick={run(onEdit)} /> : null}
            {canDelete ? <MenuItem icon={Trash2} label="Apagar" danger onClick={run(onDelete)} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function MenuItem({ icon: Icon, label, onClick, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-white/5 ${
        danger ? 'text-red-300' : 'text-stone-100'
      }`}
    >
      <Icon className={`h-4 w-4 ${danger ? 'text-red-400' : 'text-stone-400'}`} />
      {label}
    </button>
  )
}
