import { useCallback, useEffect, useRef, useState } from 'react'
import { requestContactAvatarEnqueue } from '../../lib/crmAvatarEnqueue.js'

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

export function UserAvatar({
  name,
  src,
  size = 'md',
  className = '',
  contactId,
  onRefreshAvatar,
  autoFetch = true,
}) {
  const box = sizeClasses[size] || sizeClasses.md
  const rootRef = useRef(null)
  const [imgFailed, setImgFailed] = useState(false)
  const [srcOverride, setSrcOverride] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [pendingFetch, setPendingFetch] = useState(false)

  const effectiveSrc = srcOverride || src

  useEffect(() => {
    setImgFailed(false)
    setSrcOverride(null)
    setRefreshing(false)
    setPendingFetch(false)
  }, [src, contactId])

  const tryRefresh = useCallback(async () => {
    if (!contactId || !onRefreshAvatar || refreshing) return false
    setRefreshing(true)
    try {
      const fresh = await onRefreshAvatar(contactId)
      if (fresh) {
        setSrcOverride(fresh)
        setImgFailed(false)
        setPendingFetch(false)
        return true
      }
    } catch {
      /* fallback para iniciais */
    } finally {
      setRefreshing(false)
    }
    return false
  }, [contactId, onRefreshAvatar, refreshing])

  const handleError = useCallback(async () => {
    const ok = await tryRefresh()
    if (!ok) setImgFailed(true)
  }, [tryRefresh])

  useEffect(() => {
    if (!autoFetch || !contactId || effectiveSrc || !onRefreshAvatar) return undefined

    const node = rootRef.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      requestContactAvatarEnqueue(contactId)
      setPendingFetch(true)
      return undefined
    }

    let visible = false
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting || visible) return
        visible = true
        setPendingFetch(true)
        requestContactAvatarEnqueue(contactId)
        observer.disconnect()
      },
      { rootMargin: '80px', threshold: 0.01 },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [autoFetch, contactId, effectiveSrc, onRefreshAvatar])

  useEffect(() => {
    if (!pendingFetch || effectiveSrc || !contactId) return undefined
    const timer = setTimeout(() => {
      tryRefresh().finally(() => setPendingFetch(false))
    }, 4500)
    return () => clearTimeout(timer)
  }, [pendingFetch, effectiveSrc, contactId, tryRefresh])

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
      ref={rootRef}
      className={`${box} flex shrink-0 items-center justify-center border border-accent-500/25 bg-accent-500/10 font-semibold text-accent-300 ${
        pendingFetch ? 'animate-pulse' : ''
      } ${className}`}
      aria-hidden
    >
      {initialsFromName(name)}
    </div>
  )
}
