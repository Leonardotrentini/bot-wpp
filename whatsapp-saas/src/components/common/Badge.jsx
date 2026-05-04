export function Badge({ children, variant = 'default', className = '' }) {
  const styles = {
    default: 'bg-brand-800 text-stone-200 border-brand-600',
    success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    warning: 'bg-accent-500/15 text-accent-300 border-accent-500/30',
    muted: 'bg-brand-800/50 text-stone-400 border-brand-700',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[variant]} ${className}`}>
      {children}
    </span>
  )
}
