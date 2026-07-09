import { useCallback, useEffect, useState } from 'react'

function initialsFromName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

const sizeClasses = {
  sm: 'h-8 w-8 text-[11px] rounded-lg',
  md: 'h-16 w-16 text-lg rounded-full',
  lg: 'h-24 w-24 text-2xl rounded-full',
  xl: 'h-28 w-28 text-3xl rounded-full',
}

export function UserAvatar({ name, src, size = 'md', className = '', contactId, onRefreshAvatar }) {
  const box = sizeClasses[size] || sizeClasses.md
  const [imgFailed, setImgFailed] = useState(false)
  const [srcOverride, setSrcOverride] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const effectiveSrc = srcOverride || src

  useEffect(() => {
    setImgFailed(false)
    setSrcOverride(null)
    setRefreshing(false)
  }, [src, contactId])

  const handleError = useCallback(async () => {
    if (contactId && onRefreshAvatar && !refreshing) {
      setRefreshing(true)
      try {
        const fresh = await onRefreshAvatar(contactId)
        if (fresh) {
          setSrcOverride(fresh)
          setImgFailed(false)
          return
        }
      } catch {
        /* fallback para iniciais */
      } finally {
        setRefreshing(false)
      }
    }
    setImgFailed(true)
  }, [contactId, onRefreshAvatar, refreshing])

  if (effectiveSrc && !imgFailed) {
    return (
      <img
        src={effectiveSrc}
        alt=""
        onError={handleError}
        className={`${box} shrink-0 border border-brand-700 object-cover bg-brand-800 ${className}`}
      />
    )
  }

  return (
    <div
      className={`${box} flex shrink-0 items-center justify-center border border-accent-500/25 bg-accent-500/10 font-semibold text-accent-300 ${className}`}
      aria-hidden
    >
      {initialsFromName(name)}
    </div>
  )
}
