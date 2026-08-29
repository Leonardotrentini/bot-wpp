import { AlertCircle, Check, CheckCheck, Clock } from 'lucide-react'

/** Ícone de status de entrega WhatsApp (mensagens fromMe). */
export function MessageDeliveryIcon({ status, className = '' }) {
  const s = String(status || 'sent').toLowerCase()
  if (s === 'failed' || s === 'falhou') {
    return <AlertCircle className={`h-3 w-3 text-red-400 ${className}`} aria-label="Falha no envio" />
  }
  if (s === 'read' || s === 'lido') {
    return <CheckCheck className={`h-3 w-3 text-sky-400 ${className}`} aria-label="Lido" />
  }
  if (s === 'delivered' || s === 'entregue') {
    return <CheckCheck className={`h-3 w-3 text-stone-400 ${className}`} aria-label="Entregue" />
  }
  if (s === 'sent' || s === 'enviado') {
    return <Check className={`h-3 w-3 text-stone-500 ${className}`} aria-label="Enviado" />
  }
  return <Clock className={`h-3 w-3 text-stone-600 ${className}`} aria-label="Enviando" />
}
