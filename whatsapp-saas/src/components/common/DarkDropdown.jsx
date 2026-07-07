import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'

const MENU_MAX_HEIGHT = 224 // max-h-56

function computeMenuStyle(triggerEl, menuEl, placement) {
  if (!triggerEl) return { style: {}, resolved: 'bottom' }

  const rect = triggerEl.getBoundingClientRect()
  const menuHeight = menuEl?.offsetHeight || MENU_MAX_HEIGHT
  // Largura sempre igual ao trigger — evita menu full-width no portal (body)
  const menuWidth = Math.max(rect.width, 1)
  const gap = 4

  let resolved = placement
  if (placement === 'auto') {
    const spaceBelow = window.innerHeight - rect.bottom - gap
    const spaceAbove = rect.top - gap
    const needed = Math.min(menuHeight, MENU_MAX_HEIGHT)
    resolved = spaceBelow >= needed || spaceBelow >= spaceAbove ? 'bottom' : 'top'
  }

  let top = resolved === 'top' ? rect.top - gap - menuHeight : rect.bottom + gap
  top = Math.max(8, Math.min(top, window.innerHeight - menuHeight - 8))

  const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8))

  return {
    resolved,
    style: {
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
      width: `${menuWidth}px`,
      zIndex: 10050,
    },
  }
}

/**
 * Dropdown customizado — fundo preto e texto branco (evita lista nativa branca no Windows).
 * Menu renderizado em portal com posição fixa para não ser cortado por overflow em modais.
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
  placement = 'auto',
  leadingIcon = null,
  ariaLabel,
}) {
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState({})
  const [resolvedPlacement, setResolvedPlacement] = useState('bottom')
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)

  const strValue = String(value ?? '')
  const selected = options.find((o) => String(o.value) === strValue)
  const display = selected?.label ?? placeholder

  const reposition = useCallback(() => {
    if (!open || !triggerRef.current) return
    const { style, resolved } = computeMenuStyle(triggerRef.current, menuRef.current, placement)
    setMenuStyle(style)
    setResolvedPlacement(resolved)
  }, [open, placement])

  useLayoutEffect(() => {
    reposition()
  }, [open, options, reposition])

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      const t = e.target
      if (triggerRef.current?.contains(t)) return
      if (menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onReposition = () => reposition()
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open, reposition])

  function pick(nextValue) {
    onChange?.({ target: { value: nextValue } })
    setOpen(false)
  }

  function toggleOpen() {
    if (disabled) return
    setOpen((wasOpen) => {
      if (wasOpen) return false
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) {
        setMenuStyle({
          position: 'fixed',
          top: `${rect.bottom + 4}px`,
          left: `${rect.left}px`,
          width: `${Math.max(rect.width, 1)}px`,
          zIndex: 10050,
        })
      }
      return true
    })
  }

  const menu =
    open &&
    createPortal(
      <ul
        ref={menuRef}
        role="listbox"
        style={menuStyle}
        className={`max-h-56 w-full overflow-y-auto overflow-x-hidden rounded-xl border border-brand-700 bg-black py-1 shadow-2xl ${menuClassName}`}
      >
        {options.map((opt) => {
          const v = String(opt.value)
          const active = v === strValue
          return (
            <li key={v || '__empty'} role="option" aria-selected={active}>
              <button
                type="button"
                disabled={opt.disabled}
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (!opt.disabled) pick(opt.value)
                }}
                className={`w-full px-4 py-2.5 text-left text-sm whitespace-normal break-words transition disabled:opacity-40 ${
                  active ? 'bg-accent-500/15 font-medium text-accent-300' : 'text-white hover:bg-white/10'
                }`}
              >
                {opt.label}
              </button>
            </li>
          )
        })}
      </ul>,
      document.body,
    )

  return (
    <div ref={rootRef} className={`relative ${open ? 'z-[100]' : ''} ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggleOpen}
        className={`flex w-full items-center gap-2 rounded-xl border border-brand-700 bg-black px-3 py-2.5 text-left text-sm text-white outline-none transition focus:border-accent-500/50 focus:ring-2 focus:ring-accent-500/20 disabled:cursor-not-allowed disabled:opacity-50 ${triggerClassName}`}
      >
        {leadingIcon}
        <span className="min-w-0 flex-1 truncate">{display}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-stone-400 transition-transform ${
            open && resolvedPlacement === 'bottom' ? 'rotate-180' : ''
          }`}
          aria-hidden
        />
      </button>
      {menu}
    </div>
  )
}
