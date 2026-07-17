/**
 * Toast para respostas `tracking` da API — deixa claro quando a Meta NÃO recebeu.
 * Retorna true se já mostrou toast de Meta (sucesso/erro/skip relevante).
 */
export function toastMetaTracking(toast, tracking, fallbackLabel = 'Evento') {
  if (!tracking) return false

  if (tracking.sent) {
    const attr =
      tracking.hasAdsAttribution === false
        ? ' (sem clique de anúncio — coluna Compras do Ads pode ficar "—")'
        : ''
    toast.success(`${tracking.eventName || fallbackLabel} enviado à Meta.${attr}`)
    return true
  }

  if (tracking.skipped && tracking.reason === 'already_sent') {
    toast.info(
      tracking.message ||
        `${tracking.eventName || fallbackLabel} já enviado à Meta para esta venda.`,
    )
    return true
  }

  if (tracking.skipped && (tracking.reason === 'disabled' || tracking.reason === 'not_configured')) {
    toast.error(
      tracking.message ||
        `${fallbackLabel} salva no CRM, mas a Meta não recebeu: configure Pixel na conta do dono (Integrações).`,
    )
    return true
  }

  if (tracking.message) {
    toast.error(tracking.message)
    return true
  }

  if (tracking.error) {
    toast.error(`Meta não recebeu: ${tracking.error}`)
    return true
  }

  if (tracking.skipped) {
    toast.info(
      `${fallbackLabel} salva no CRM, mas não foi à Meta (${tracking.reason || 'ignorado'}).`,
    )
    return true
  }

  return false
}

export function metaFunnelLabel(metaFunnel) {
  if (!metaFunnel) return null
  const parts = []
  if (metaFunnel.conversationStarted) parts.push('Conversa')
  if (metaFunnel.leadQualified) parts.push('Qualificado')
  if (metaFunnel.quote) parts.push('Orçamento')
  if (metaFunnel.purchase) parts.push('Compra')
  if (!parts.length) return 'Meta: nenhum evento enviado ainda'
  const attr = metaFunnel.hasAttribution ? ' · com atribuição de anúncio' : ' · sem atribuição de LP/anúncio'
  return `Meta enviado: ${parts.join(', ')}${attr}`
}
