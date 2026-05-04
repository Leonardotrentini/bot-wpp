export function Skeleton({ className = '' }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-brand-800/80 ${className}`}
      aria-hidden
    />
  )
}
