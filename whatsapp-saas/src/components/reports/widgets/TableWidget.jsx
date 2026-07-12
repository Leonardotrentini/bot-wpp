import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, ImageIcon } from 'lucide-react'
import { Badge } from '../../common/Badge.jsx'

function AdThumbnail({ src, href, alt }) {
  const [failed, setFailed] = useState(false)

  const inner = failed || !src ? (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-brand-800/60 bg-brand-950/60 text-stone-600">
      <ImageIcon className="h-5 w-5" />
    </div>
  ) : (
    <img
      src={src}
      alt={alt || ''}
      className="h-14 w-14 shrink-0 rounded-xl border border-brand-800/60 object-cover bg-brand-950/60"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="shrink-0 hover:opacity-90 transition">
        {inner}
      </a>
    )
  }

  return inner
}

function truncateUrl(url) {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.length > 28 ? `${parsed.pathname.slice(0, 28)}…` : parsed.pathname
    return `${parsed.hostname}${path}`
  } catch {
    return url.length > 42 ? `${url.slice(0, 42)}…` : url
  }
}

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
  const { items = [], unavailable } = payload || {}

  if (unavailable) {
    return <p className="text-sm text-stone-500 py-4">Meta Ads não conectado ou indisponível.</p>
  }

  if (!items.length) {
    return <p className="text-sm text-stone-500">Sem dados no período.</p>
  }

  const hasRichAds = items.some((item) => item.thumbnail || item.destinationUrl)

  return (
    <ul className={`space-y-3 ${hasRichAds ? '' : 'max-h-64 overflow-y-auto'}`}>
      {items.map((item, index) => (
        <li
          key={item.id ? `${item.id}-${index}` : `${item.label}-${index}`}
          className="flex items-center gap-3 rounded-xl border border-brand-800/40 bg-brand-950/30 p-3"
        >
          {(item.thumbnail || item.href) && (
            <AdThumbnail src={item.thumbnail} href={item.href} alt={item.label} />
          )}

          <div className="min-w-0 flex-1">
            {item.href ? (
              <a
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-stone-200 hover:text-accent-400 transition font-medium leading-snug"
              >
                <span className="truncate">{item.label}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-60" />
              </a>
            ) : (
              <p className="text-stone-200 font-medium leading-snug truncate">{item.label}</p>
            )}

            {item.sub ? <p className="text-xs text-stone-500 mt-0.5 truncate">{item.sub}</p> : null}

            {item.destinationUrl ? (
              <a
                href={item.destinationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-sky-400/90 hover:text-sky-300 transition truncate max-w-full"
                title={item.destinationUrl}
              >
                <span className="truncate">{truncateUrl(item.destinationUrl)}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            ) : null}
          </div>

          {item.value ? (
            <Badge variant="muted" className="shrink-0 tabular-nums">
              {item.value}
            </Badge>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
