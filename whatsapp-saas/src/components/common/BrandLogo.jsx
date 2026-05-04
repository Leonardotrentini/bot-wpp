/**
 * Logo VESTO + nome do produto Vesto Group.
 * Imagem: public/vesto-logo-gold.jpg
 */
export function BrandLogo({ collapsed = false, className = '' }) {
  if (collapsed) {
    return (
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-800 ring-1 ring-accent-500/25 ${className}`}
      >
        <img src="/vesto-logo-gold.jpg" alt="Vesto" className="max-h-7 max-w-[1.85rem] rounded object-cover" />
      </div>
    )
  }
  return (
    <div className={`flex items-center gap-2.5 min-w-0 ${className}`}>
      <img
        src="/vesto-logo-gold.jpg"
        alt=""
        className="h-9 w-auto max-h-9 shrink-0 rounded object-cover object-left"
      />
      <span className="font-serif text-lg font-semibold tracking-tight text-stone-100 truncate">
        Vesto <span className="text-accent-400">Group</span>
      </span>
    </div>
  )
}
