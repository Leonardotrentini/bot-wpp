export function Card({ children, className = '', padding = true }) {
  return (
    <div
      className={`rounded-2xl border border-brand-800/90 bg-brand-900/45 shadow-xl shadow-black/25 backdrop-blur-sm transition hover:border-accent-500/15 ${padding ? 'p-5' : ''} ${className}`}
    >
      {children}
    </div>
  )
}
