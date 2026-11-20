/* Vesto PWA — Web Push + open chat on click */
self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(Promise.resolve())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }

  const title = data.title || 'Vesto'
  const options = {
    body: data.body || 'Nova mensagem',
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    tag: data.tag || 'vesto-crm',
    renotify: true,
    data: data.data || { url: '/dashboard/chat' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

async function openOrFocus(urlPath) {
  const abs = new URL(urlPath || '/dashboard/chat', self.location.origin).href
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of all) {
    if (client.url.startsWith(self.location.origin) && 'focus' in client) {
      await client.focus()
      try {
        client.postMessage({ type: 'VESTO_PUSH_NAV', url: abs })
      } catch {
        /* ignore */
      }
      return
    }
  }
  if (self.clients.openWindow) {
    await self.clients.openWindow(abs)
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification?.data?.url || '/dashboard/chat'
  event.waitUntil(openOrFocus(url))
})
