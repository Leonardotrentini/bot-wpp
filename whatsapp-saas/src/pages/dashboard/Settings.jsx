import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Copy, Shield, Trash2, UserPlus, Users } from 'lucide-react'
import { SettingsOrgMaterials } from '../../components/dashboard/SettingsOrgMaterials.jsx'
import { Card } from '../../components/common/Card.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { UserAvatar } from '../../components/common/UserAvatar.jsx'
import { ConfirmModal } from '../../components/common/Modal.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { fetchOrgMembers, inviteOrgMember, removeOrgMember, updateProfile } from '../../services/api.js'
import { AVATAR_MAX_INPUT_BYTES, resizeAvatarFile } from '../../lib/avatarImage.js'

const ROLE_LABELS = {
  OWNER: 'Dono',
  SELLER: 'Vendedor',
}

function roleLabel(role) {
  return ROLE_LABELS[role] || role
}

function whatsappStatusLabel(member) {
  const status = member?.whatsapp?.status
  if (status === 'connected') return { text: 'WhatsApp conectado', variant: 'success' }
  if (status === 'disconnected') return { text: 'WhatsApp desconectado', variant: 'muted' }
  return null
}

function emptyProfileForm(user) {
  return {
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    avatar: user?.avatar || null,
  }
}

export function Settings() {
  const toast = useToast()
  const { user, setCurrentUser, isOrgOwner } = useAuth()
  const photoInputRef = useRef(null)
  const [profile, setProfile] = useState(() => emptyProfileForm(user))
  const [avatarTouched, setAvatarTouched] = useState(false)
  const [photoLoading, setPhotoLoading] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [teamLoading, setTeamLoading] = useState(false)
  const [members, setMembers] = useState([])
  const [pendingInvites, setPendingInvites] = useState([])
  const [inviteForm, setInviteForm] = useState({ name: '', email: '' })
  const [inviting, setInviting] = useState(false)
  const [removeTarget, setRemoveTarget] = useState(null)
  const [removing, setRemoving] = useState(false)
  const [copiedInviteId, setCopiedInviteId] = useState(null)

  const loadTeam = useCallback(async () => {
    if (!isOrgOwner) {
      setMembers([])
      setPendingInvites([])
      return
    }
    setTeamLoading(true)
    try {
      const data = await fetchOrgMembers()
      setMembers(data?.members || [])
      setPendingInvites(data?.pendingInvites || [])
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Não foi possível carregar a equipe.')
      setMembers([])
      setPendingInvites([])
    } finally {
      setTeamLoading(false)
    }
  }, [isOrgOwner, toast])

  useEffect(() => {
    loadTeam()
  }, [loadTeam])

  useEffect(() => {
    setProfile(emptyProfileForm(user))
    setAvatarTouched(false)
  }, [user?.id, user?.name, user?.email, user?.phone, user?.avatar])

  const profileDirty =
    avatarTouched ||
    profile.name.trim() !== (user?.name || '').trim() ||
    profile.email.trim().toLowerCase() !== (user?.email || '').trim().toLowerCase() ||
    profile.phone.trim() !== (user?.phone || '').trim()

  const onProfileField = (key, value) => setProfile((prev) => ({ ...prev, [key]: value }))

  const onPickPhoto = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Selecione uma imagem válida (JPG, PNG ou WebP).')
      return
    }
    if (file.size > AVATAR_MAX_INPUT_BYTES) {
      toast.error('A imagem original deve ter no máximo 5MB.')
      return
    }
    try {
      setPhotoLoading(true)
      const dataUrl = await resizeAvatarFile(file)
      onProfileField('avatar', dataUrl)
      setAvatarTouched(true)
      toast.success('Foto selecionada. Clique em "Salvar perfil" para confirmar.')
    } catch {
      toast.error('Não foi possível processar a imagem. Tente outra foto.')
    } finally {
      setPhotoLoading(false)
    }
  }

  const removePhoto = () => {
    onProfileField('avatar', null)
    setAvatarTouched(true)
    toast.success('Foto removida. Clique em "Salvar perfil" para confirmar.')
  }

  const applyUserUpdate = (data) => {
    if (data?.user) {
      localStorage.setItem('vg_auth', JSON.stringify(data.user))
      setCurrentUser(data.user)
    }
  }

  const saveProfile = async () => {
    const name = profile.name.trim()
    const email = profile.email.trim().toLowerCase()
    const phone = profile.phone.trim()

    if (name.length < 2) return toast.error('Nome deve ter pelo menos 2 caracteres.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast.error('Informe um e-mail válido.')

    const payload = {
      name,
      email,
      phone: phone || null,
    }
    if (avatarTouched) payload.avatar = profile.avatar

    try {
      setSavingProfile(true)
      const data = await updateProfile(payload)
      applyUserUpdate(data)
      setAvatarTouched(false)
      toast.success('Perfil atualizado com sucesso.')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao atualizar perfil.')
    } finally {
      setSavingProfile(false)
    }
  }

  const savePassword = async () => {
    const currentPassword = passwordForm.currentPassword.trim()
    const newPassword = passwordForm.newPassword.trim()
    const confirmPassword = passwordForm.confirmPassword.trim()

    if (!currentPassword) return toast.error('Informe a senha atual.')
    if (newPassword.length < 6) return toast.error('A nova senha deve ter no mínimo 6 caracteres.')
    if (newPassword !== confirmPassword) return toast.error('As senhas não coincidem.')

    try {
      setSavingPassword(true)
      await updateProfile({ currentPassword, newPassword })
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      toast.success('Senha alterada com sucesso.')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao alterar senha.')
    } finally {
      setSavingPassword(false)
    }
  }

  const sendInvite = async () => {
    const name = inviteForm.name.trim()
    const email = inviteForm.email.trim().toLowerCase()
    if (name.length < 2) return toast.error('Nome deve ter pelo menos 2 caracteres.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast.error('Informe um e-mail válido.')

    try {
      setInviting(true)
      const data = await inviteOrgMember({ name, email })
      const inviteUrl = data?.invite?.inviteUrl
      setInviteForm({ name: '', email: '' })
      await loadTeam()
      if (inviteUrl) {
        toast.success(`Convite enviado! Link: ${inviteUrl}`)
      } else {
        toast.success('Convite criado com sucesso.')
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Não foi possível enviar o convite.')
    } finally {
      setInviting(false)
    }
  }

  const copyInviteLink = async (invite) => {
    if (!invite?.inviteUrl) {
      toast.error('Link do convite indisponível.')
      return
    }
    try {
      await navigator.clipboard.writeText(invite.inviteUrl)
      setCopiedInviteId(invite.id)
      toast.success('Link copiado para a área de transferência.')
      setTimeout(() => setCopiedInviteId(null), 2000)
    } catch {
      toast.error('Não foi possível copiar o link.')
    }
  }

  const confirmRemoveMember = async () => {
    if (!removeTarget) return
    try {
      setRemoving(true)
      await removeOrgMember(removeTarget.userId)
      toast.success(`${removeTarget.name} foi removido da equipe.`)
      setRemoveTarget(null)
      await loadTeam()
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Não foi possível remover o vendedor.')
    } finally {
      setRemoving(false)
    }
  }

  const sellers = members.filter((member) => member.role === 'SELLER')
  const teamEmpty = !teamLoading && sellers.length === 0 && pendingInvites.length === 0

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-stone-50">Configurações</h2>
        <p className="mt-1 text-sm text-stone-400">Gerencie seus dados de acesso e preferências da conta.</p>
      </div>

      <Card className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-accent-400" />
            <div>
              <h3 className="font-semibold text-stone-50">Perfil</h3>
              <p className="text-xs text-stone-500">Foto e dados exibidos no painel.</p>
            </div>
          </div>
          {profileDirty && <Badge variant="warning">Alterações pendentes</Badge>}
        </div>

        <div className="flex flex-col gap-4 rounded-xl border border-dashed border-brand-700/80 bg-brand-950/30 p-4 sm:flex-row sm:items-center">
          <UserAvatar name={profile.name || user?.name} src={profile.avatar} size="xl" />
          <div className="flex flex-1 flex-col gap-2">
            <p className="text-sm text-stone-300">Foto de perfil</p>
            <p className="text-xs text-stone-500">JPG ou PNG, até 5MB. A imagem é redimensionada automaticamente.</p>
            <div className="flex flex-wrap gap-2">
              <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/*" className="hidden" onChange={onPickPhoto} />
              <Button
                variant="secondary"
                size="sm"
                disabled={photoLoading}
                onClick={() => photoInputRef.current?.click()}
              >
                {photoLoading ? 'Processando…' : 'Alterar foto'}
              </Button>
              {(profile.avatar || user?.avatar) && (
                <Button variant="ghost" size="sm" disabled={photoLoading} onClick={removePhoto}>
                  Remover foto
                </Button>
              )}
            </div>
          </div>
        </div>

        <Input label="Nome" value={profile.name} onChange={(e) => onProfileField('name', e.target.value)} />
        <Input label="E-mail" type="email" value={profile.email} onChange={(e) => onProfileField('email', e.target.value)} />
        <Input label="Telefone" value={profile.phone} onChange={(e) => onProfileField('phone', e.target.value)} placeholder="+55 (11) 99999-0000" />

        <div className="flex flex-wrap gap-2 pt-1">
          <Button onClick={saveProfile} disabled={savingProfile || !profileDirty}>
            {savingProfile ? 'Salvando…' : 'Salvar perfil'}
          </Button>
        </div>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-accent-400" />
          <div>
            <h3 className="font-semibold text-stone-50">Segurança</h3>
            <p className="text-xs text-stone-500">Altere sua senha de acesso ao painel.</p>
          </div>
        </div>
        <Input
          label="Senha atual"
          type="password"
          value={passwordForm.currentPassword}
          onChange={(e) => setPasswordForm((f) => ({ ...f, currentPassword: e.target.value }))}
          placeholder="Sua senha de login"
        />
        <Input
          label="Nova senha"
          type="password"
          value={passwordForm.newPassword}
          onChange={(e) => setPasswordForm((f) => ({ ...f, newPassword: e.target.value }))}
          placeholder="Mínimo 6 caracteres"
        />
        <Input
          label="Confirmar nova senha"
          type="password"
          value={passwordForm.confirmPassword}
          onChange={(e) => setPasswordForm((f) => ({ ...f, confirmPassword: e.target.value }))}
          placeholder="Repita a nova senha"
        />
        <Button
          variant="secondary"
          onClick={savePassword}
          disabled={savingPassword || !passwordForm.currentPassword.trim() || !passwordForm.newPassword.trim()}
        >
          {savingPassword ? 'Alterando…' : 'Alterar senha'}
        </Button>
      </Card>

      {isOrgOwner && <SettingsOrgMaterials />}

      {isOrgOwner && (
        <Card className="space-y-5">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-accent-400" />
            <div>
              <h3 className="font-semibold text-stone-50">Equipe</h3>
              <p className="text-xs text-stone-500">Convide vendedores e gerencie quem acessa a conta da empresa.</p>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-brand-800 bg-brand-950/30 p-4">
            <div className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-accent-400" />
              <h4 className="text-sm font-medium text-stone-200">Convidar vendedor</h4>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Nome"
                value={inviteForm.name}
                onChange={(e) => setInviteForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Nome do vendedor"
              />
              <Input
                label="E-mail"
                type="email"
                value={inviteForm.email}
                onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="email@empresa.com.br"
              />
            </div>
            <Button
              onClick={sendInvite}
              disabled={inviting || !inviteForm.name.trim() || !inviteForm.email.trim()}
            >
              {inviting ? 'Enviando convite…' : 'Enviar convite'}
            </Button>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-medium text-stone-200">Membros da equipe</h4>

            {teamLoading ? (
              <p className="py-6 text-center text-sm text-stone-500">Carregando equipe…</p>
            ) : (
              <div className="space-y-3">
                {members.length > 0 ? (
                  <div className="space-y-2">
                    {members.map((member) => {
                      const wa = whatsappStatusLabel(member)
                      const canRemove = member.role === 'SELLER' && member.userId !== user?.id
                      return (
                        <div
                          key={member.userId}
                          className="flex flex-col gap-3 rounded-xl border border-brand-800 bg-brand-950/40 p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <UserAvatar name={member.name} size="md" />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-stone-100">{member.name}</p>
                              <p className="truncate text-xs text-stone-500">{member.email}</p>
                              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                <Badge variant={member.role === 'OWNER' ? 'warning' : 'default'}>
                                  {roleLabel(member.role)}
                                </Badge>
                                {wa && <Badge variant={wa.variant}>{wa.text}</Badge>}
                              </div>
                            </div>
                          </div>
                          {canRemove && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="self-start text-red-400 hover:text-red-300 sm:self-center"
                              onClick={() => setRemoveTarget({ userId: member.userId, name: member.name })}
                            >
                              <Trash2 className="h-4 w-4" />
                              Remover
                            </Button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="py-4 text-center text-sm text-stone-500">Nenhum membro encontrado.</p>
                )}

                {teamEmpty && (
                  <div className="rounded-xl border border-dashed border-brand-700/80 bg-brand-950/20 px-4 py-6 text-center">
                    <Users className="mx-auto h-7 w-7 text-stone-600" />
                    <p className="mt-2 text-sm font-medium text-stone-300">Nenhum vendedor na equipe ainda</p>
                    <p className="mt-1 text-xs text-stone-500">
                      Convide alguém pelo formulário acima para compartilhar o acesso ao painel.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {pendingInvites.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-stone-200">Convites pendentes</h4>
              <div className="space-y-2">
                {pendingInvites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex flex-col gap-3 rounded-xl border border-brand-800 bg-brand-950/40 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-stone-100">{invite.name}</p>
                      <p className="truncate text-xs text-stone-500">{invite.email}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <Badge variant="muted">Aguardando aceite</Badge>
                        <Badge variant="default">{roleLabel(invite.role)}</Badge>
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="self-start sm:self-center"
                      onClick={() => copyInviteLink(invite)}
                      disabled={!invite.inviteUrl}
                    >
                      <Copy className="h-4 w-4" />
                      {copiedInviteId === invite.id ? 'Copiado' : 'Copiar link'}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      <ConfirmModal
        isOpen={Boolean(removeTarget)}
        onClose={() => !removing && setRemoveTarget(null)}
        onConfirm={confirmRemoveMember}
        title="Remover vendedor"
        message={
          removeTarget
            ? `Tem certeza que deseja remover ${removeTarget.name} da equipe? O acesso ao painel será revogado.`
            : ''
        }
        loading={removing}
      />
    </div>
  )
}
