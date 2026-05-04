import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

export function Accordion({ items }) {
  const [open, setOpen] = useState(null)
  return (
    <div className="space-y-2">
      {items.map((item, i) => {
        const isOpen = open === i
        return (
          <div
            key={i}
            className="rounded-xl border border-brand-800 bg-brand-900/40 overflow-hidden transition hover:border-brand-700"
          >
            <button
              type="button"
              className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
            >
              <span className="font-medium text-stone-100 font-heading pr-4">{item.q}</span>
              <ChevronDown className={`h-5 w-5 shrink-0 text-accent-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
              <div className="border-t border-brand-800 px-4 pb-4 pt-0">
                <p className="pt-3 text-sm text-stone-400 leading-relaxed">{item.a}</p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
