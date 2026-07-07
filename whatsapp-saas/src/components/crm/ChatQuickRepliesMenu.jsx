import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Pencil, Plus, Search, Trash2, Zap } from 'lucide-react'
import { Button } from '../common/Button.jsx'
import { QuickReplyFormModal } from './QuickReplyFormModal.jsx'
import { ConfirmModal } from '../common/Modal.jsx'
import { buildQuickReplyPayload, QUICK_REPLY_MEDIA_LABELS } from '../../lib/quickReplyMedia.js'
import { createCrmQuickReply, deleteCrmQuickReply, updateCrmQuickReply } from '../../services/api.js'
import { useToast } from '../../contexts/ToastContext.jsx'

export function ChatQuickRepliesMenu({ quickReplies, onQuickRepliesChange, onApply, draft = '' }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [menuStyle, setMenuStyle] = useState({})
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return quickReplies
    return quickReplies.filter(
      (item) =>
        item.shortcut.includes(q) ||
        (item.title || '').toLowerCase().includes(q) ||
        (item.body || '').toLowerCase().includes(q),
    )
  }, [quickReplies, query])

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

  function openCreate() {
    setEditing(null)
    setModalOpen(true)
    setOpen(false)
  }

  function openEdit(item, e) {
    e.stopPropagation()
    setEditing(item)
    setModalOpen(true)
    setOpen(false)
  }

  async function handleSave(form) {
    const payload = buildQuickReplyPayload(form)
    setSaving(true)
    try {
      if (editing) {
        const { data } = await updateCrmQuickReply(editing.id, payload)
        onQuickRepliesChange?.((prev) =>
          prev.map((q) => (q.id === editing.id ? data.quickReply : q)).sort((a, b) => a.shortcut.localeCompare(b.shortcut)),
        )
        toast.success('Mensagem rápida atualizada.')
      } else {
        const { data } = await createCrmQuickReply(payload)
        onQuickRepliesChange?.((prev) => [...prev, data.quickReply].sort((a, b) => a.shortcut.localeCompare(b.shortcut)))
        toast.success('Mensagem rápida salva.')
      }
      setModalOpen(false)
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao salvar mensagem rápida.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    try {
      await deleteCrmQuickReply(confirmDelete.id)
      onQuickRepliesChange?.((prev) => prev.filter((q) => q.id !== confirmDelete.id))
      toast.success('Mensagem rápida removida.')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao remover.')
    } finally {
      setConfirmDelete(null)
    }
  }

  const menu =
    open &&
    createPortal(
      <div
        ref={menuRef}
        style={menuStyle}
        className="overflow-hidden rounded-xl border border-brand-700 bg-brand-900 shadow-2xl"
      >
        <div className="border-b border-brand-800 px-3 py-2.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-stone-100">Mensagens rápidas</p>
            <Button size="sm" variant="ghost" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" />
              Nova
            </Button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar atalho…"
              className="w-full rounded-lg border border-brand-700 bg-black py-1.5 pl-8 pr-2 text-xs text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/50"
            />
          </div>
        </div>
        <ul className="max-h-64 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-center text-xs text-stone-500">
              {quickReplies.length === 0
                ? 'Nenhuma mensagem salva. Crie a primeira para agilizar o atendimento.'
                : 'Nenhum resultado para esta busca.'}
            </li>
          ) : (
            filtered.map((qr) => (
              <li key={qr.id}>
                <button
                  type="button"
                  onClick={() => {
                    onApply?.(qr)
                    setOpen(false)
                  }}
                  className="group flex w-full items-start gap-2 border-b border-brand-800/60 px-3 py-2.5 text-left transition hover:bg-white/5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-accent-400">/{qr.shortcut}</p>
                      {qr.title ? <p className="truncate text-xs font-medium text-stone-300">{qr.title}</p> : null}
                      <p className="line-clamp-2 text-[11px] text-stone-500">{qr.body || (qr.hasMedia ? `Anexo: ${QUICK_REPLY_MEDIA_LABELS[qr.mediaType] || qr.mediaType}` : '')}</p>
                  </div>
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => openEdit(qr, e)}
                      className="rounded p-1 text-stone-500 hover:bg-white/10 hover:text-stone-200"
                      title="Editar"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setConfirmDelete(qr)
                      }}
                      className="rounded p-1 text-stone-500 hover:bg-red-500/10 hover:text-red-300"
                      title="Excluir"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="border-t border-brand-800 px-3 py-2 text-[10px] text-stone-500">
          Dica: digite <span className="font-mono text-accent-400">/</span> no campo de mensagem para filtrar atalhos.
        </div>
      </div>,
      document.body,
    )

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`rounded-xl p-2.5 transition hover:bg-white/5 hover:text-stone-100 ${
          open ? 'bg-accent-500/15 text-accent-300' : 'text-stone-400'
        }`}
        title="Mensagens rápidas"
      >
        <Zap className="h-5 w-5" />
      </button>
      {menu}
      <QuickReplyFormModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        initial={editing}
        defaultBody={draft.trim()}
        onSave={handleSave}
        saving={saving}
        onError={(msg) => toast.error(msg)}
      />
      <ConfirmModal
        isOpen={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title="Excluir mensagem rápida"
        message={`Remover o atalho "/${confirmDelete?.shortcut}"?`}
      />
    </>
  )
}
