import { apiClient } from '../services/api.js'
import { resolveUseRealApi } from './runtimeEnv.js'

const ENABLED_KEY = 'vg_push_enabled'

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function isStandalonePwa() {
  if (typeof window === 'undefined') return false
  const standaloneMq = window.matchMedia?.('(display-mode: standalone)')?.matches
  const iosStandalone = window.navigator?.standalone === true
  return Boolean(standaloneMq || iosStandalone)
}

export function getPushEnabledPreference() {
  try {
    return localStorage.getItem(ENABLED_KEY) !== '0'
  } catch {
    return true
  }
}

export function setPushEnabledPreference(enabled) {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export async function registerServiceWorker() {
  if (!pushSupported()) return null
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  } catch (err) {
    console.warn('[push] SW register failed:', err?.message || err)
    return null
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

async function fetchVapidPublicKey() {
  const { data } = await apiClient.get('/push/vapid-public-key')
  return data?.publicKey || null
}

export async function getPushStatus() {
  if (!resolveUseRealApi()) return { configured: false, subscribed: false, devices: 0, supported: false }
  if (!pushSupported()) return { configured: false, subscribed: false, devices: 0, supported: false }
  try {
    const { data } = await apiClient.get('/push/status')
    return { ...data, supported: true, permission: Notification.permission }
  } catch {
    return { configured: false, subscribed: false, devices: 0, supported: true, permission: Notification.permission }
  }
}

export async function enableWebPush() {
  if (!resolveUseRealApi()) throw new Error('API real necessária para notificações.')
  if (!pushSupported()) throw new Error('Este navegador não suporta notificações push.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    const err = new Error('Permissão de notificação negada.')
    err.code = 'PERMISSION_DENIED'
    throw err
  }

  const registration = (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker())
  if (!registration) throw new Error('Não foi possível registrar o service worker.')
  await navigator.serviceWorker.ready

  const publicKey = await fetchVapidPublicKey()
  if (!publicKey) throw new Error('Servidor sem chave VAPID configurada.')

  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
  }

  await apiClient.post('/push/subscribe', { subscription: subscription.toJSON() })
  setPushEnabledPreference(true)
  return { ok: true, subscription }
}

export async function disableWebPush() {
  setPushEnabledPreference(false)
  if (!pushSupported()) return { ok: true }
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager?.getSubscription()
  if (subscription) {
    try {
      await apiClient.post('/push/unsubscribe', { endpoint: subscription.endpoint })
    } catch {
      /* ignore */
    }
    try {
      await subscription.unsubscribe()
    } catch {
      /* ignore */
    }
  }
  return { ok: true }
}

/** Reenvia a subscription se o usuário já liberou permissão (ex.: reabriu o PWA). */
export async function syncWebPushIfGranted() {
  if (!resolveUseRealApi() || !pushSupported()) return false
  if (!getPushEnabledPreference()) return false
  if (Notification.permission !== 'granted') return false
  try {
    const registration = (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker())
    if (!registration) return false
    await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()
    if (!subscription) return false
    await apiClient.post('/push/subscribe', { subscription: subscription.toJSON() })
    return true
  } catch {
    return false
  }
}
