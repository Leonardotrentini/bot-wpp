import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Smile } from 'lucide-react'

/** Grid compacto o bastante pro desktop — sem lib extra. */
const EMOJI_GROUPS = [
  {
    label: 'Frequentes',
    emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😎', '🤩', '🥳', '😮', '😢', '😭', '😤', '😡', '🤔', '😴', '🙌', '👏', '👍', '👎', '🙏', '💪', '🔥', '✨', '💯', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '👀', '👇', '☝️', '👋', '🤝', '✅', '❌', '⭐', '🎉'],
  },
  {
    label: 'Gestos',
    emojis: ['👋', '🤚', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🙏', '✍️', '💅', '🤳', '💪'],
  },
  {
    label: 'Objetos',
    emojis: ['📱', '💻', '⌨️', '🖥️', '🖨️', '📷', '📦', '📝', '📌', '📎', '🔗', '💰', '💳', '📈', '📉', '🛒', '🏪', '🚚', '⏰', '📅', '🔔', '💡', '🔒', '🔓', '🛠️', '⚙️', '🎯', '🏆', '🎁', '🧾'],
  },
]

export function ChatEmojiPicker({ onPick, disabled = false }) {
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState({})
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  const flat = useMemo(() => EMOJI_GROUPS, [])

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
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  function handlePick(emoji) {
    onPick?.(emoji)
    // Mantém aberto pra inserir vários; fecha só com Esc/clique fora.
  }

  const menu =
    open &&
    createPortal(
      <div
        ref={menuRef}
        style={menuStyle}
        className="overflow-hidden rounded-xl border border-brand-700 bg-brand-900 shadow-2xl"
        role="dialog"
        aria-label="Emojis"
      >
        <div className="max-h-72 overflow-y-auto p-2">
          {flat.map((group) => (
            <div key={group.label} className="mb-2 last:mb-0">
              <p className="px-1.5 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-stone-500">
                {group.label}
              </p>
              <div className="grid grid-cols-8 gap-0.5">
                {group.emojis.map((emoji) => (
                  <button
                    key={`${group.label}-${emoji}`}
                    type="button"
                    onClick={() => handlePick(emoji)}
                    className="flex h-9 w-full items-center justify-center rounded-lg text-xl transition hover:bg-white/10"
                    title={emoji}
                    aria-label={`Inserir ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>,
      document.body,
    )

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`mb-0.5 flex h-11 w-10 shrink-0 items-center justify-center rounded-full transition hover:bg-white/5 hover:text-stone-100 disabled:opacity-40 ${
          open ? 'bg-accent-500/15 text-accent-300' : 'text-stone-400'
        }`}
        title="Emojis"
        aria-label="Emojis"
        aria-expanded={open}
      >
        <Smile className="h-5 w-5" />
      </button>
      {menu}
    </>
  )
}
