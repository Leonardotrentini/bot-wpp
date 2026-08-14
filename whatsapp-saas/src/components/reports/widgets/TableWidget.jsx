import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, ImageIcon, Loader2 } from 'lucide-react'
import { Badge } from '../../common/Badge.jsx'
import { Modal } from '../../common/Modal.jsx'
import { Button } from '../../common/Button.jsx'
import { getMetaAdPreview } from '../../../services/api.js'

function AdThumbnail({ src, onClick, alt }) {
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

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="shrink-0 hover:opacity-90 transition">
        {inner}
      </button>
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

function AdPreviewModal({ item, onClose }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(null)

  useEffect(() => {
    if (!item?.previewAdId) return undefined
    let cancelled = false
    setLoading(true)
    setError(null)
    setPreview(null)
    getMetaAdPreview(item.previewAdId)
      .then(({ data }) => {
        if (cancelled) return
        setPreview(data)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err?.response?.data?.message || 'Não foi possível carregar a prévia deste anúncio.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [item?.previewAdId])

  return (
    <Modal
      isOpen={Boolean(item)}
      onClose={onClose}
      title={item?.label || 'Prévia do anúncio'}
      size="lg"
      footer={
        <>
          {item?.adsManagerUrl ? (
            <a href={item.adsManagerUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="secondary" type="button">
                Ads Manager
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </a>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </>
      }
    >
      {item?.sub ? <p className="mb-3 text-xs text-stone-500">{item.sub}</p> : null}

      {loading ? (
        <div className="flex min-h-[280px] items-center justify-center gap-2 text-sm text-stone-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando prévia da Meta…
        </div>
      ) : null}

      {!loading && error ? (
        <div className="space-y-3 rounded-xl border border-amber-800/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
          <p>{error}</p>
          {item?.thumbnail ? (
            <img
              src={item.thumbnail}
              alt={item.label || ''}
              className="mx-auto max-h-64 rounded-xl border border-brand-800 object-contain"
            />
          ) : null}
          {item?.adsManagerUrl ? (
            <a
              href={item.adsManagerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-accent-400 hover:text-accent-300"
            >
              Abrir no Ads Manager
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
      ) : null}

      {!loading && !error && preview ? (
        <div className="flex justify-center overflow-hidden rounded-xl border border-brand-800 bg-white">
          {preview.iframeSrc ? (
            <iframe
              title={`Prévia ${item?.label || ''}`}
              src={preview.iframeSrc}
              className="h-[520px] w-full max-w-[360px] border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            />
          ) : (
            <div
              className="w-full max-w-[420px] bg-white p-2 [&_iframe]:mx-auto [&_iframe]:max-w-full"
              // HTML vem da Graph API (previews) — mesmo conteúdo do botão Prévia do Ads Manager.
              dangerouslySetInnerHTML={{ __html: preview.html || '' }}
            />
          )}
        </div>
      ) : null}
    </Modal>
  )
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
  const [previewItem, setPreviewItem] = useState(null)

  if (unavailable) {
    return <p className="text-sm text-stone-500 py-4">Meta Ads não conectado ou indisponível.</p>
  }

  if (!items.length) {
    return <p className="text-sm text-stone-500">Sem dados no período.</p>
  }

  const hasRichAds = items.some((item) => item.thumbnail || item.destinationUrl || item.previewAdId || item.href)

  return (
    <>
      <ul className={`space-y-3 ${hasRichAds ? '' : 'max-h-64 overflow-y-auto'}`}>
        {items.map((item, index) => {
          const canPreview = Boolean(item.previewAdId)
          const openPreview = canPreview ? () => setPreviewItem(item) : null
          const fallbackHref = item.href || item.storyUrl || item.adsManagerUrl || item.destinationUrl || null

          return (
            <li
              key={item.id ? `${item.id}-${index}` : `${item.label}-${index}`}
              className="flex items-center gap-3 rounded-xl border border-brand-800/40 bg-brand-950/30 p-3"
            >
              {(item.thumbnail || canPreview || fallbackHref) && (
                <AdThumbnail src={item.thumbnail} onClick={openPreview} alt={item.label} />
              )}

              <div className="min-w-0 flex-1">
                {canPreview ? (
                  <button
                    type="button"
                    onClick={openPreview}
                    className="inline-flex max-w-full items-center gap-1 text-left font-medium leading-snug text-stone-200 transition hover:text-accent-400"
                  >
                    <span className="truncate">{item.label}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  </button>
                ) : fallbackHref ? (
                  <a
                    href={fallbackHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium leading-snug text-stone-200 transition hover:text-accent-400"
                  >
                    <span className="truncate">{item.label}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  </a>
                ) : (
                  <p className="truncate font-medium leading-snug text-stone-200">{item.label}</p>
                )}

                {item.sub ? <p className="mt-0.5 truncate text-xs text-stone-500">{item.sub}</p> : null}

                {canPreview ? (
                  <button
                    type="button"
                    onClick={openPreview}
                    className="mt-1 inline-flex items-center gap-1 text-[11px] text-accent-400/90 transition hover:text-accent-300"
                  >
                    Ver prévia do anúncio
                  </button>
                ) : null}

                {item.destinationUrl ? (
                  <a
                    href={item.destinationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 flex items-center gap-1 text-[11px] text-sky-400/90 transition hover:text-sky-300 truncate max-w-full"
                    title={item.destinationUrl}
                  >
                    <span className="truncate">{truncateUrl(item.destinationUrl)}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ) : null}

                {item.adsManagerUrl ? (
                  <a
                    href={item.adsManagerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[11px] text-stone-500 transition hover:text-stone-300"
                  >
                    Abrir no Ads Manager
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
          )
        })}
      </ul>

      {previewItem ? <AdPreviewModal item={previewItem} onClose={() => setPreviewItem(null)} /> : null}
    </>
  )
}
