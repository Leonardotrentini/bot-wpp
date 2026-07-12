import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { useMemo } from 'react'

export function GroupFilterBar({ groups, selectedIds, onChange, embedded = false }) {
  const connected = useMemo(
    () => groups.filter((g) => g.status === 'ativo' && g.monitoringEnabled),
    [groups],
  )
  const allSelected = selectedIds.length === 0

  function toggle(id) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id))
    } else {
      onChange([...selectedIds, id])
    }
  }

  if (!connected.length) {
    return (
      <p className="text-sm text-stone-500">
        Nenhum grupo conectado.{' '}
        <Link to="/dashboard/groups" className="text-accent-400 hover:underline">
          Ative um grupo
        </Link>
      </p>
    )
  }

  const wrapperClass = embedded
    ? ''
    : 'rounded-2xl border border-brand-800/80 bg-brand-950/40 p-4'

  return (
    <div className={wrapperClass}>
      {!embedded && (
        <p className="text-xs font-medium uppercase tracking-wide text-stone-500 mb-3">Filtrar por grupo</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange([])}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition ${
            allSelected
              ? 'border-accent-500/50 bg-accent-500/15 text-accent-300'
              : 'border-brand-700/80 bg-brand-950/50 text-stone-400 hover:border-brand-600 hover:text-stone-200'
          }`}
        >
          {allSelected && <Check className="h-3.5 w-3.5" />}
          Todos
        </button>
        {connected.map((g) => {
          const active = selectedIds.includes(g.id)
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => toggle(g.id)}
              className={`inline-flex max-w-[200px] items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition truncate ${
                active
                  ? 'border-accent-500/50 bg-accent-500/15 text-accent-300'
                  : 'border-brand-700/80 bg-brand-950/50 text-stone-400 hover:border-brand-600 hover:text-stone-200'
              }`}
              title={g.name}
            >
              {active && <Check className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{g.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
