import { useEffect, useRef, useState } from 'react'
import { Camera, Shield, Users } from 'lucide-react'
import { Card } from '../../components/common/Card.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { UserAvatar } from '../../components/common/UserAvatar.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { updateProfile, fetchOrgMembers, updateOrgMemberAvatar } from '../../services/api.js'
import { AVATAR_MAX_INPUT_BYTES, resizeAvatarFile } from '../../lib/avatarImage.js'

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
  const [teamMembers, setTeamMembers] = useState([])
  const [teamLoading, setTeamLoading] = useState(false)
  const [teamPhotoBusyId, setTeamPhotoBusyId] = useState(null)
  const teamPhotoInputRef = useRef(null)
  const teamPhotoTargetRef = useRef(null)

  useEffect(() => {
    setProfile(emptyProfileForm(user))
    setAvatarTouched(false)
  }, [user?.id, user?.name, user?.email, user?.phone, user?.avatar])

  useEffect(() => {
    if (!isOrgOwner) {
      setTeamMembers([])
      return
    }
    let cancelled = false
    setTeamLoading(true)
    fetchOrgMembers()
      .then((res) => {
        if (!cancelled) setTeamMembers(res?.members || [])
      })
      .catch(() => {
        if (!cancelled) setTeamMembers([])
      })
      .finally(() => {
        if (!cancelled) setTeamLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOrgOwner])

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

  const openTeamPhotoPicker = (userId) => {
    teamPhotoTargetRef.current = userId
    teamPhotoInputRef.current?.click()
  }

  const onTeamPhotoPick = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    const userId = teamPhotoTargetRef.current
    teamPhotoTargetRef.current = null
    if (!file || !userId) return
    if (!file.type.startsWith('image/')) {
      toast.error('Selecione uma imagem válida (JPG, PNG ou WebP).')
      return
    }
    if (file.size > AVATAR_MAX_INPUT_BYTES) {
      toast.error('A imagem original deve ter no máximo 5MB.')
      return
    }
    try {
      setTeamPhotoBusyId(userId)
      const dataUrl = await resizeAvatarFile(file)
      const data = await updateOrgMemberAvatar(userId, { avatar: dataUrl })
      const avatarUrl = data?.member?.avatarUrl ?? dataUrl
      setTeamMembers((prev) =>
        prev.map((m) => (m.userId === userId ? { ...m, avatarUrl } : m)),
      )
      if (userId === user?.id) {
        applyUserUpdate({
          user: { ...user, avatar: avatarUrl },
        })
        setProfile((p) => ({ ...p, avatar: avatarUrl }))
      }
      toast.success('Foto do vendedor atualizada. Aparece na bolinha do Kanban.')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao salvar foto do vendedor.')
    } finally {
      setTeamPhotoBusyId(null)
    }
  }

  const removeTeamPhoto = async (userId) => {
    try {
      setTeamPhotoBusyId(userId)
      await updateOrgMemberAvatar(userId, { avatar: null })
      setTeamMembers((prev) =>
        prev.map((m) => (m.userId === userId ? { ...m, avatarUrl: null } : m)),
      )
      if (userId === user?.id) {
        applyUserUpdate({ user: { ...user, avatar: null } })
        setProfile((p) => ({ ...p, avatar: null }))
      }
      toast.success('Foto removida. O Kanban usa as iniciais.')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao remover foto.')
    } finally {
      setTeamPhotoBusyId(null)
    }
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

      {isOrgOwner ? (
        <Card className="space-y-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-accent-400" />
            <div>
              <h3 className="font-semibold text-stone-50">Fotos da equipe</h3>
              <p className="text-xs text-stone-500">
                Foto de cada vendedor (e do dono) na bolinha do Kanban. Sem foto, aparecem as iniciais.
              </p>
            </div>
          </div>

          <input
            ref={teamPhotoInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            className="hidden"
            onChange={onTeamPhotoPick}
          />

          {teamLoading ? (
            <p className="text-sm text-stone-500">Carregando equipe…</p>
          ) : teamMembers.length === 0 ? (
            <p className="text-sm text-stone-500">Nenhum membro na empresa.</p>
          ) : (
            <div className="space-y-3">
              {teamMembers.map((m) => {
                const busy = teamPhotoBusyId === m.userId
                return (
                  <div
                    key={m.userId}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-800 bg-brand-950/40 p-3"
                  >
                    <UserAvatar name={m.name || m.email} src={m.avatarUrl} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-stone-100">
                        {m.name || m.email}
                        {m.role === 'OWNER' ? (
                          <span className="ml-1.5 text-xs font-normal text-stone-500">(dono)</span>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-stone-500">{m.email}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => openTeamPhotoPicker(m.userId)}
                      >
                        {busy ? 'Salvando…' : m.avatarUrl ? 'Trocar foto' : 'Enviar foto'}
                      </Button>
                      {m.avatarUrl ? (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => removeTeamPhoto(m.userId)}>
                          Remover
                        </Button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      ) : null}

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
    </div>
  )
}
