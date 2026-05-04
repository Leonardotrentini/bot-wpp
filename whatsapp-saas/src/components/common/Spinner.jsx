export function Spinner({ className = 'h-8 w-8' }) {
  return (
    <div
      className={`rounded-full border-2 border-accent-500/30 border-t-accent-500 animate-spin ${className}`}
      role="status"
      aria-label="Carregando"
    />
  )
}
