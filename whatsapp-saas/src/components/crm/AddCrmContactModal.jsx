import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Modal } from '../common/Modal.jsx'
import { Button } from '../common/Button.jsx'
import { Select } from '../common/Select.jsx'
import { createCrmContact } from '../../services/api.js'

function normalizePhoneDigits(input) {
  let digits = String(input || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith('55')) {
    digits = `55${digits}`
  }
  return digits
}

function isValidCrmPhone(input) {
  const digits = normalizePhoneDigits(input)
  if (digits.length < 12 || digits.length > 13) return false
  if (!digits.startsWith('55')) return false
  return true
}

export function AddCrmContactModal({
  isOpen,
  onClose,
  onCreated,
  members = [],
  showSellerSelect = false,
  defaultSellerUserId = '',
}) {
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [sellerUserId, setSellerUserId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setPhone('')
    setName('')
    setNotes('')
    setSellerUserId(defaultSellerUserId || '')
    setError('')
    setErrorCode('')
    setSaving(false)
  }, [isOpen, defaultSellerUserId])

  const phoneValid = useMemo(() => isValidCrmPhone(phone), [phone])
  const phoneInvalidUi =
    errorCode === 'INVALID_WHATSAPP_NUMBER' ||
    errorCode === 'VALIDATION_ERROR' ||
    (Boolean(error) && !phoneValid)

  const handleSubmit = async (e) => {
    e?.preventDefault?.()
    if (!phoneValid) {
      setErrorCode('VALIDATION_ERROR')
      setError('Informe um WhatsApp válido com DDD (ex.: 11987654321).')
      return
    }
    setSaving(true)
    setError('')
    setErrorCode('')
    try {
      const { data } = await createCrmContact({
        phone: normalizePhoneDigits(phone),
        name: name.trim() || undefined,
        notes: notes.trim() || undefined,
        sellerUserId: showSellerSelect && sellerUserId ? sellerUserId : undefined,
      })
      onCreated?.(data)
      onClose?.()
    } catch (err) {
      const code = err?.response?.data?.error || ''
      setErrorCode(code)
      setError(
        err?.response?.data?.message ||
          err?.message ||
          'Não foi possível criar o contato.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={saving ? undefined : onClose}
      title="Adicionar contato"
      dismissible={!saving}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={saving || !phoneValid}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? 'Verificando…' : 'Criar e abrir chat'}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-stone-400">Telefone (WhatsApp)</label>
          <input
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value)
              if (error) {
                setError('')
                setErrorCode('')
              }
            }}
            placeholder="11987654321"
            autoFocus
            aria-invalid={phoneInvalidUi}
            className={`w-full rounded-xl border bg-brand-950/60 px-3 py-2.5 text-sm text-stone-100 outline-none ${
              phoneInvalidUi
                ? 'border-red-500/70 focus:border-red-400 focus:ring-1 focus:ring-red-500/30'
                : 'border-brand-700 focus:border-accent-500/50'
            }`}
          />
          <p className="mt-1 text-[11px] text-stone-500">DDD + número. O +55 entra sozinho se faltar.</p>
        </div>

        {error ? (
          <div
            className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${
              errorCode === 'INVALID_WHATSAPP_NUMBER' || errorCode === 'VALIDATION_ERROR'
                ? 'border-red-500/40 bg-red-500/10 text-red-100'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-100'
            }`}
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">
                {errorCode === 'INVALID_WHATSAPP_NUMBER' ? 'Contato errado' : 'Não foi possível adicionar'}
              </p>
              <p className="mt-0.5 text-xs opacity-90">{error}</p>
            </div>
          </div>
        ) : null}

        <div>
          <label className="mb-1.5 block text-xs font-medium text-stone-400">Nome (opcional)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do contato"
            className="w-full rounded-xl border border-brand-700 bg-brand-950/60 px-3 py-2.5 text-sm text-stone-100 outline-none focus:border-accent-500/50"
          />
        </div>

        {showSellerSelect && members.length > 0 ? (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-stone-400">Vendedor</label>
            <Select
              value={sellerUserId}
              onChange={(e) => setSellerUserId(e.target.value)}
              aria-label="Vendedor responsável"
            >
              <option value="">Eu (dono)</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name || m.email}
                  {m.role === 'OWNER' ? ' (dono)' : ''}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        <div>
          <label className="mb-1.5 block text-xs font-medium text-stone-400">Notas (opcional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Anotações internas"
            className="w-full resize-none rounded-xl border border-brand-700 bg-brand-950/60 px-3 py-2.5 text-sm text-stone-100 outline-none focus:border-accent-500/50"
          />
        </div>
      </form>
    </Modal>
  )
}
