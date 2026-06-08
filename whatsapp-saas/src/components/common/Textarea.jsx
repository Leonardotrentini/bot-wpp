import { forwardRef } from 'react'

export const Textarea = forwardRef(function Textarea({ label, error, className = '', rows = 4, ...props }, ref) {
  return (
    <label className="block w-full">
      {label && <span className="mb-1.5 block text-sm font-medium text-stone-300">{label}</span>}
      <textarea
        ref={ref}
        rows={rows}
        className={`w-full resize-y rounded-xl border bg-brand-900/50 px-4 py-2.5 text-sm text-stone-100 placeholder:text-stone-500 outline-none transition focus:border-accent-500/60 focus:ring-2 focus:ring-accent-500/20 ${
          error ? 'border-red-500/60' : 'border-brand-700'
        } ${className}`}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </label>
  )
})
