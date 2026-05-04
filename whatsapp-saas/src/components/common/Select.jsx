export function Select({ label, error, children, className = '', ...props }) {
  return (
    <label className="block w-full">
      {label && <span className="mb-1.5 block text-sm font-medium text-stone-300">{label}</span>}
      <select
        className={`w-full rounded-xl border bg-brand-900/50 px-4 py-2.5 text-sm text-stone-100 outline-none transition focus:border-accent-500/60 focus:ring-2 focus:ring-accent-500/20 ${
          error ? 'border-red-500/60' : 'border-brand-700'
        } ${className}`}
        {...props}
      >
        {children}
      </select>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </label>
  )
}
