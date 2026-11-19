import { useMemo, useState } from 'react'
import { Forward, Loader2, Search, X } from 'lucide-react'
import { contactTitle } from '../../lib/contactDisplay.js'

/**
 * Escolhe conversas destino para encaminhar.
 */
export function ChatForwardModal({ open, conversations = [], onClose, onConfirm, forwarding }) {
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(() => new Set())

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return conversations.slice(0, 40)
    return conversations
      .filter((c) => {
        const name = contactTitle(c.contact).toLowerCase()
        const phone = String(c.contact?.phone || '')
        return name.includes(term) || phone.includes(term)
      })
      .slice(0, 40)
  }, [conversations, q])

  if (!open) return null

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < 10) next.add(id)
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-[96]" role="dialog" aria-modal="true" aria-label="Encaminhar">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Fechar" onClick={onClose} />
      <div className="absolute inset-x-3 top-[12%] mx-auto flex max-h-[75vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-brand-700 bg-brand-900 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-brand-800 px-3 py-3">
          <Forward className="h-5 w-5 text-accent-400" />
          <p className="flex-1 text-sm font-semibold text-stone-100">Encaminhar para</p>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-stone-400 hover:bg-white/5">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="border-b border-brand-800 px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar contato…"
              className="w-full rounded-xl border border-brand-700 bg-brand-950/60 py-2.5 pl-9 pr-3 text-base text-stone-100 outline-none placeholder:text-stone-500"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {filtered.map((c) => {
            const on = selected.has(c.id)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                  on ? 'bg-accent-500/15' : 'hover:bg-white/5'
                }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                    on ? 'border-accent-400 bg-accent-500 text-[10px] text-black' : 'border-stone-500'
                  }`}
                >
                  {on ? '✓' : ''}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-stone-100">{contactTitle(c.contact)}</span>
              </button>
            )
          })}
          {!filtered.length ? <p className="px-3 py-6 text-center text-xs text-stone-500">Nenhuma conversa</p> : null}
        </div>
        <div className="border-t border-brand-800 p-3">
          <button
            type="button"
            disabled={!selected.size || forwarding}
            onClick={() => onConfirm?.([...selected])}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25d366] py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            {forwarding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Forward className="h-4 w-4" />}
            Encaminhar{selected.size ? ` (${selected.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
