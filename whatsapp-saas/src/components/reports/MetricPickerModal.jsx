import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Button } from '../common/Button.jsx'
import { getMetricsByCategory, REPORT_CATEGORIES } from '../../lib/reportMetricCatalog.js'

export function MetricPickerModal({ open, onClose, onSelect, existingMetricIds = [] }) {
  const [query, setQuery] = useState('')

  const grouped = useMemo(() => getMetricsByCategory(), [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return grouped
    const result = {}
    for (const [cat, metrics] of Object.entries(grouped)) {
      const list = metrics.filter(
        (m) =>
          m.label.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q),
      )
      if (list.length) result[cat] = list
    }
    return result
  }, [grouped, query])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-2xl border border-brand-700 bg-brand-950 shadow-xl">
        <div className="flex items-center justify-between gap-3 p-4 border-b border-brand-800">
          <h3 className="text-lg font-semibold text-stone-100 font-heading">Adicionar métrica</h3>
          <button type="button" onClick={onClose} className="text-stone-500 hover:text-stone-200">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 border-b border-brand-800">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-500" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar métrica…"
              className="w-full rounded-lg border border-brand-700 bg-black/40 py-2 pl-9 pr-3 text-sm text-stone-200 placeholder:text-stone-600 focus:border-accent-500/50 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {Object.entries(filtered).map(([cat, metrics]) => (
            <div key={cat}>
              <p className="text-xs font-medium uppercase tracking-wide text-stone-500 mb-2">
                {REPORT_CATEGORIES[cat] || cat}
              </p>
              <div className="space-y-1">
                {metrics.map((m) => {
                  const added = existingMetricIds.includes(m.id)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={added}
                      onClick={() => {
                        onSelect(m.id)
                        onClose()
                      }}
                      className={`w-full text-left rounded-lg border px-3 py-2.5 transition ${
                        added
                          ? 'border-brand-800/50 opacity-50 cursor-not-allowed'
                          : 'border-brand-800 hover:border-accent-500/40 hover:bg-accent-500/5'
                      }`}
                    >
                      <p className="text-sm font-medium text-stone-200">{m.label}</p>
                      <p className="text-xs text-stone-500 mt-0.5">{m.description}</p>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          {Object.keys(filtered).length === 0 && (
            <p className="text-sm text-stone-500 text-center py-4">Nenhuma métrica encontrada.</p>
          )}
        </div>

        <div className="p-4 border-t border-brand-800">
          <Button type="button" variant="secondary" className="w-full" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </div>
  )
}
