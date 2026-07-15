/**
 * Meta Pixel no navegador — LP (PageView, Contact).
 * Eventos de funil CRM (ConversationStarted, LeadQualified, Quote, Purchase) são só CAPI.
 * Não usar no dashboard admin (polui o dataset).
 */

export const CRM_FUNNEL_CAPI_ONLY_EVENTS = new Set([
  'ConversationStarted',
  'LeadQualified',
  'Quote',
  'Purchase',
])

export function isCrmFunnelCapiOnlyEvent(eventName) {
  return CRM_FUNNEL_CAPI_ONLY_EVENTS.has(String(eventName || ''))
}

let loadedPixelId = null

export function initMetaPixel(pixelId, advancedMatching = null) {
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

  if (advancedMatching && typeof advancedMatching === 'object') {
    window.fbq('init', id, advancedMatching)
  } else {
    window.fbq('init', id)
  }
  window.fbq('track', 'PageView')
  loadedPixelId = id
}

export function trackMetaPixel(eventName, params = {}, eventId) {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return false
  const options = eventId ? { eventID: eventId } : undefined
  const standardEvents = new Set([
    'PageView',
    'Lead',
    'Contact',
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

/** @deprecated Funil CRM não dispara fbq — apenas CAPI. Mantido para compatibilidade; sempre no-op. */
export function trackCrmMetaEvent(tracking) {
  if (isCrmFunnelCapiOnlyEvent(tracking?.eventName)) return false
  return false
}
