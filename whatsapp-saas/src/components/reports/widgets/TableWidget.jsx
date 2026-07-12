import { Link } from 'react-router-dom'
import { Badge } from '../../common/Badge.jsx'

export function TableWidget({ payload }) {
  const { columns = [], rows = [], unavailable } = payload || {}

  if (unavailable) {
    return <p className="text-sm text-stone-500 py-4">Meta Ads não conectado ou indisponível.</p>
  }

  if (!rows.length) {
    return <p className="text-sm text-stone-500 py-4">Sem dados no período.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="text-stone-500 border-b border-brand-800">
            {columns.map((col) => (
              <th key={col.key} className="py-2 pr-4 font-medium">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id || i} className="border-b border-brand-800/60 text-stone-300">
              {columns.map((col, ci) => (
                <td key={col.key} className="py-2.5 pr-4">
                  {ci === 0 && row.link ? (
                    <Link to={row.link} className="hover:text-accent-400 transition">
                      {row[col.key]}
                    </Link>
                  ) : (
                    row[col.key]
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ListWidget({ payload }) {
  const { items = [] } = payload || {}

  if (!items.length) {
    return <p className="text-sm text-stone-500">Sem dados no período.</p>
  }

  return (
    <ul className="space-y-2 max-h-64 overflow-y-auto">
      {items.map((item) => (
        <li key={item.id || item.label} className="flex items-start justify-between gap-2 text-sm">
          <div className="min-w-0">
            {item.id && item.label?.includes('msg') ? (
              <Link
                to={`/dashboard/groups/${encodeURIComponent(item.id)}`}
                className="truncate text-stone-300 hover:text-accent-400 transition block"
              >
                {item.label}
              </Link>
            ) : (
              <p className="text-stone-300 leading-snug">{item.label}</p>
            )}
            {item.sub ? <p className="text-xs text-stone-500 mt-0.5">{item.sub}</p> : null}
          </div>
          {item.value ? (
            <Badge variant="muted" className="shrink-0">
              {item.value}
            </Badge>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
