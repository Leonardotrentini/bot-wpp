import { useCallback, useEffect, useState } from 'react'
import { UserPlus, Trash2, Copy, Check, Smartphone, Mail } from 'lucide-react'
import { Card } from '../../components/common/Card.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import {
  fetchOrgMembers,
  inviteOrgMember,
  removeOrgMember,
} from '../../services/api.js'

function WhatsAppStatus({ whatsapp }) {
  if (!whatsapp?.connected) {
    return <Badge variant="warning">Desconectado</Badge>
  }
  return (
    <Badge variant="success">
      Conectado{whatsapp.phone ? ` · ${whatsapp.phone}` : ''}
    </Badge>
  )
}

export function Team() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [members, setMembers] = useState([])
  const [pendingInvites, setPendingInvites] = useState([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [lastInviteUrl, setLastInviteUrl] = useState('')
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchOrgMembers()
      setMembers(data.members || [])
      setPendingInvites(data.pendingInvites || [])
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao carregar equipe.')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const onInvite = async (e) => {
    e.preventDefault()
    if (!name.trim() || !email.trim()) return
    setInviting(true)
    try {
      const data = await inviteOrgMember({ name: name.trim(), email: email.trim() })
      setLastInviteUrl(data.invite?.inviteUrl || '')
      setName('')
      setEmail('')
      toast.success('Convite criado. Envie o link ao vendedor.')
      await load()
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Não foi possível convidar.')
    } finally {
      setInviting(false)
    }
  }

  const onRemove = async (userId, memberName) => {
    if (!window.confirm(`Remover ${memberName} da equipe?`)) return
    try {
      await removeOrgMember(userId)
      toast.success('Vendedor removido.')
      await load()
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao remover.')
    }
  }

  const copyInvite = async () => {
    if (!lastInviteUrl) return
    try {
      await navigator.clipboard.writeText(lastInviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast.success('Link copiado.')
    } catch {
      toast.error('Não foi possível copiar.')
    }
  }

  const sellers = members.filter((m) => m.role === 'SELLER')
  const owners = members.filter((m) => m.role === 'OWNER')

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-brand-800/80 bg-brand-900/40 px-4 py-3 text-sm text-stone-400">
        Gerencie os vendedores da sua empresa. Cada vendedor tem login próprio e conecta o próprio WhatsApp em{' '}
        <strong className="text-stone-200">Conectar WhatsApp</strong>. Você vê os dados agregados na Visão geral.
      </div>

      <Card className="p-5">
        <h3 className="text-lg font-semibold text-stone-100">Convidar vendedor</h3>
        <p className="mt-1 text-sm text-stone-500">O convite expira em 7 dias.</p>
        <form onSubmit={onInvite} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-stone-500">Nome</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="João Silva" required />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs text-stone-500">E-mail</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="joao@empresa.com"
              required
            />
          </div>
          <Button type="submit" className="gap-1.5 shrink-0" disabled={inviting}>
            <UserPlus className="h-4 w-4" />
            {inviting ? 'Enviando…' : 'Convidar'}
          </Button>
        </form>
        {lastInviteUrl && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-brand-800 bg-brand-950/60 p-3">
            <code className="flex-1 truncate text-xs text-accent-400">{lastInviteUrl}</code>
            <Button type="button" size="sm" variant="outline" className="gap-1" onClick={copyInvite}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              Copiar link
            </Button>
          </div>
        )}
      </Card>

      {pendingInvites.length > 0 && (
        <Card className="p-5">
          <h3 className="text-lg font-semibold text-stone-100">Convites pendentes</h3>
          <ul className="mt-3 divide-y divide-brand-800/80">
            {pendingInvites.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div>
                  <p className="font-medium text-stone-200">{inv.name}</p>
                  <p className="text-stone-500">{inv.email}</p>
                </div>
                <Badge variant="warning">Aguardando aceite</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-5">
        <h3 className="text-lg font-semibold text-stone-100">Equipe</h3>
        {loading ? (
          <p className="mt-4 text-sm text-stone-500">Carregando…</p>
        ) : (
          <ul className="mt-4 divide-y divide-brand-800/80">
            {[...owners, ...sellers].map((m) => (
              <li key={m.userId} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-stone-100">
                    {m.name}
                    {m.role === 'OWNER' && (
                      <span className="ml-2 text-xs font-normal text-accent-400">Dono</span>
                    )}
                  </p>
                  <p className="flex items-center gap-1.5 text-sm text-stone-500">
                    <Mail className="h-3.5 w-3.5" />
                    {m.email}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1.5 text-xs text-stone-500">
                    <Smartphone className="h-3.5 w-3.5" />
                    <WhatsAppStatus whatsapp={m.whatsapp} />
                  </span>
                  {m.role === 'SELLER' && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-red-400 hover:text-red-300"
                      onClick={() => onRemove(m.userId, m.name)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Remover
                    </Button>
                  )}
                </div>
              </li>
            ))}
            {!owners.length && !sellers.length && (
              <li className="py-6 text-center text-sm text-stone-500">Nenhum membro na equipe.</li>
            )}
          </ul>
        )}
      </Card>
    </div>
  )
}
