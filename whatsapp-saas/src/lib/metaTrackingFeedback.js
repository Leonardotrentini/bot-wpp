/** Toast para respostas `tracking` / `metaTracking` da API — somente CAPI, sem fbq browser. */
export function toastMetaTracking(toast, tracking, fallbackLabel = 'Evento') {
  if (!tracking) return
  if (tracking.skipped && tracking.reason === 'disabled') return

  if (tracking.sent) {
    toast.success(`${tracking.eventName || fallbackLabel} enviado à Meta.`)
    return
  }

  if (tracking.skipped && tracking.reason === 'already_sent') {
    toast.info(`${tracking.eventName || fallbackLabel} já enviado para este lead (máx. 1x).`)
    return
  }

  if (tracking.message) {
    toast.error(tracking.message)
    return
  }

  if (tracking.error) {
    toast.error(`Meta não recebeu: ${tracking.error}`)
  }
}

export function metaFunnelLabel(metaFunnel) {
  if (!metaFunnel) return null
  const parts = []
  if (metaFunnel.conversationStarted) parts.push('Conversa')
  if (metaFunnel.leadQualified) parts.push('Qualificado')
  if (metaFunnel.quote) parts.push('Orçamento')
  if (!parts.length) return 'Meta: nenhum evento enviado ainda'
  const attr = metaFunnel.hasAttribution ? ' · com atribuição de anúncio' : ' · sem atribuição de LP/anúncio'
  return `Meta enviado: ${parts.join(', ')}${attr}`
}
