import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Link2, Loader2, Search } from 'lucide-react'
import { getOrgMaterialContent } from '../../services/api.js'
import { useToast } from '../../contexts/ToastContext.jsx'

export function ChatMaterialsMenu({ materials = [], onApply }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [menuStyle, setMenuStyle] = useState({})
  const [loadingId, setLoadingId] = useState(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return materials
    return materials.filter(
      (item) =>
        (item.title || '').toLowerCase().includes(q) ||
        (item.shortcut || '').includes(q) ||
        (item.body || '').toLowerCase().includes(q),
    )
  }, [materials, query])

  useEffect(() => {
    if (!open) return undefined
    const reposition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const menuWidth = 320
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8))
      setMenuStyle({
        position: 'fixed',
        bottom: `${window.innerHeight - rect.top + 8}px`,
        left: `${left}px`,
        width: `${menuWidth}px`,
        zIndex: 10050,
      })
    }
    reposition()
    const onDoc = (e) => {
      if (triggerRef.current?.contains(e.target)) return
      if (menuRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  async function handleApply(item) {
    setLoadingId(item.id)
    try {
      let full = item
      if (item.kind === 'document' && item.hasMedia) {
        const { data } = await getOrgMaterialContent(item.id)
        full = data?.material || item
      }
      await onApply?.(full)
      setOpen(false)
    } catch {
      toast.error('Falha ao carregar o material.')
    } finally {
      setLoadingId(null)
    }
  }

  if (!materials.length) return null

  return (
    <>
      <button
        id="chat-materials-trigger"
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-xl p-2.5 text-stone-400 transition hover:bg-white/5 hover:text-stone-100"
        title="Materiais da loja"
      >
        <FileText className="h-5 w-5" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={menuStyle}
            className="overflow-hidden rounded-2xl border border-brand-700 bg-brand-950 shadow-2xl shadow-black/50"
          >
            <div className="border-b border-brand-800 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Materiais da loja</p>
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar…"
                  className="w-full rounded-lg border border-brand-800 bg-brand-900/60 py-1.5 pl-8 pr-2 text-sm text-stone-100 outline-none focus:border-accent-500/50"
                />
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto p-1">
              {filtered.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-stone-500">Nenhum material.</p>
              ) : (
                filtered.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={loadingId === item.id}
                    onClick={() => handleApply(item)}
                    className="flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/5 disabled:opacity-50"
                  >
                    {item.kind === 'link' ? (
                      <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-accent-400" />
                    ) : (
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-accent-400" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-stone-100">{item.title}</p>
                      <p className="truncate text-[11px] text-stone-500">
                        {item.kind === 'link' ? item.url : item.mediaName || 'PDF'}
                        {item.shortcut ? ` · /${item.shortcut}` : ''}
                      </p>
                    </div>
                    {loadingId === item.id && <Loader2 className="h-4 w-4 animate-spin text-stone-400" />}
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
