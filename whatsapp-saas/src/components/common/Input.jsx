import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

export function Input({ label, error, className = '', id, type = 'text', revealable = false, ...props }) {
  const inputId = id || props.name
  const canReveal = type === 'password' && revealable
  const [visible, setVisible] = useState(false)
  const inputType = canReveal && visible ? 'text' : type

  return (
    <label className="block w-full">
      {label && (
        <span className="mb-1.5 block text-sm font-medium text-stone-300">{label}</span>
      )}
      <div className="relative">
        <input
          id={inputId}
          type={inputType}
          className={`w-full rounded-xl border bg-brand-900/50 px-4 py-2.5 text-sm text-stone-100 placeholder:text-stone-500 outline-none transition focus:border-accent-500/60 focus:ring-2 focus:ring-accent-500/20 ${
            canReveal ? 'pr-11' : ''
          } ${error ? 'border-red-500/60' : 'border-brand-700'} ${className}`}
          {...props}
        />
        {canReveal && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-stone-400 transition hover:text-stone-200"
            aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
            tabIndex={-1}
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </label>
  )
}
