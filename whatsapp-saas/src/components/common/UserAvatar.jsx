import { useEffect, useState } from 'react'

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

export function UserAvatar({ name, src, size = 'md', className = '' }) {
  const box = sizeClasses[size] || sizeClasses.md
  const [imgFailed, setImgFailed] = useState(false)

  useEffect(() => {
    setImgFailed(false)
  }, [src])

  if (src && !imgFailed) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setImgFailed(true)}
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
