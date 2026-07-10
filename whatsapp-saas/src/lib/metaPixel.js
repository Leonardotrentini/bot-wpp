/**
 * Meta Pixel no navegador (complementa a API de Conversões com deduplicação via eventID).
 */

let loadedPixelId = null

export function initMetaPixel(pixelId) {
  if (typeof window === 'undefined' || !pixelId) return
  const id = String(pixelId).trim()
  if (!id || loadedPixelId === id) return

  if (!window.fbq) {
    const n = function fbq(...args) {
      if (n.callMethod) {
        n.callMethod(...args)
      } else {
        n.queue.push(args)
      }
    }
    n.queue = []
    n.loaded = true
    n.version = '2.0'
    window.fbq = n
    const script = document.createElement('script')
    script.async = true
    script.src = 'https://connect.facebook.net/en_US/fbevents.js'
    const first = document.getElementsByTagName('script')[0]
    first.parentNode.insertBefore(script, first)
  }

  window.fbq('init', id)
  window.fbq('track', 'PageView')
  loadedPixelId = id
}

export function trackMetaPixel(eventName, params = {}, eventId) {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return false
  const options = eventId ? { eventID: eventId } : undefined
  const standardEvents = new Set([
    'PageView',
    'Lead',
    'Purchase',
    'AddToCart',
    'InitiateCheckout',
    'ViewContent',
    'CompleteRegistration',
    'Subscribe',
  ])
  const method = standardEvents.has(eventName) ? 'track' : 'trackCustom'
  if (options) {
    window.fbq(method, eventName, params, options)
  } else {
    window.fbq(method, eventName, params)
  }
  return true
}

export function trackCrmMetaEvent(tracking) {
  if (!tracking?.eventId || !tracking?.eventName || tracking.skipped) return

  const params = { currency: 'BRL' }
  if (tracking.value != null) params.value = tracking.value

  trackMetaPixel(tracking.eventName, params, tracking.eventId)
}
