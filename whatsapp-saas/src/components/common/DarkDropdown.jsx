import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * Dropdown customizado — fundo preto e texto branco (evita lista nativa branca no Windows).
 */
export function DarkDropdown({
  value,
  onChange,
  options = [],
  placeholder = 'Selecionar…',
  disabled = false,
  className = '',
  triggerClassName = '',
  menuClassName = '',
  placement = 'bottom',
  leadingIcon = null,
  ariaLabel,
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const strValue = String(value ?? '')
  const selected = options.find((o) => String(o.value) === strValue)
  const display = selected?.label ?? placeholder

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
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

  function pick(nextValue) {
    onChange?.({ target: { value: nextValue } })
    setOpen(false)
  }

  const menuPlacementClass =
    placement === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'

  return (
    <div ref={rootRef} className={`relative ${open ? 'z-[100]' : ''} ${className}`}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`flex w-full items-center gap-2 rounded-xl border border-brand-700 bg-black px-3 py-2.5 text-left text-sm text-white outline-none transition focus:border-accent-500/50 focus:ring-2 focus:ring-accent-500/20 disabled:cursor-not-allowed disabled:opacity-50 ${triggerClassName}`}
      >
        {leadingIcon}
        <span className="min-w-0 flex-1 truncate">{display}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && (
        <ul
          role="listbox"
          className={`absolute z-[200] max-h-56 w-full overflow-y-auto rounded-xl border border-brand-700 bg-black py-1 shadow-2xl ${menuPlacementClass} ${menuClassName}`}
        >
          {options.map((opt) => {
            const v = String(opt.value)
            const active = v === strValue
            return (
              <li key={v || '__empty'} role="option" aria-selected={active}>
                <button
                  type="button"
                  disabled={opt.disabled}
                  onClick={() => !opt.disabled && pick(opt.value)}
                  className={`w-full px-4 py-2.5 text-left text-sm transition disabled:opacity-40 ${
                    active ? 'bg-accent-500/15 font-medium text-accent-300' : 'text-white hover:bg-white/10'
                  }`}
                >
                  {opt.label}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
