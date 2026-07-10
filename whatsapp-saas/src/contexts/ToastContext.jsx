import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const remove = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const push = useCallback((toast) => {
    const id = crypto.randomUUID()
    const item = { id, type: 'info', duration: 4000, ...toast }
    setToasts((t) => [...t, item])
    if (item.duration > 0) {
      setTimeout(() => remove(id), item.duration)
    }
    return id
  }, [remove])

  const success = useCallback((message, title) => push({ type: 'success', message, title }), [push])
  const error = useCallback((message, title) => push({ type: 'error', message, title }), [push])
  const info = useCallback((message, title) => push({ type: 'info', message, title }), [push])

  const actions = useMemo(() => ({ push, success, error, info, remove }), [push, success, error, info, remove])
  const value = useMemo(() => ({ ...actions, toasts }), [actions, toasts])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`vg-toast pointer-events-auto rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm ${
                t.type === 'success'
                ? 'border-emerald-500/40 bg-emerald-950/90 text-emerald-50'
                : t.type === 'error'
                  ? 'border-red-500/40 bg-red-950/90 text-red-50'
                  : 'border-accent-500/30 bg-brand-900/95 text-stone-100'
            }`}
          >
            {t.title && <p className="text-sm font-semibold">{t.title}</p>}
            <p className="text-sm opacity-95">{t.message}</p>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast outside ToastProvider')
  return ctx
}
