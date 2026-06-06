import { useEffect, useRef, useState } from 'react'
import { Camera, Shield, UserCircle2 } from 'lucide-react'
import { Card } from '../../components/common/Card.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { UserAvatar } from '../../components/common/UserAvatar.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { updateProfile } from '../../services/api.js'
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
  const { user, setCurrentUser } = useAuth()
  const photoInputRef = useRef(null)
  const [profile, setProfile] = useState(() => emptyProfileForm(user))
  const [avatarTouched, setAvatarTouched] = useState(false)
  const [photoLoading, setPhotoLoading] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordForm, setPasswordForm] = useState({ newPassword: '', confirmPassword: '' })

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
    const newPassword = passwordForm.newPassword.trim()
    const confirmPassword = passwordForm.confirmPassword.trim()

    if (newPassword.length < 6) return toast.error('A nova senha deve ter no mínimo 6 caracteres.')
    if (newPassword !== confirmPassword) return toast.error('As senhas não coincidem.')

    try {
      setSavingPassword(true)
      await updateProfile({ newPassword })
      setPasswordForm({ newPassword: '', confirmPassword: '' })
      toast.success('Senha alterada com sucesso.')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao alterar senha.')
    } finally {
      setSavingPassword(false)
    }
  }

  const roleLabel = user?.role === 'ADMIN' ? 'Administrador' : 'Usuário'
  const planLabel = user?.plan?.name || user?.plan || '—'

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-stone-50">Configurações</h2>
        <p className="mt-1 text-sm text-stone-400">Gerencie seus dados de acesso e preferências da conta.</p>
      </div>

      <Card className="space-y-4">
        <div className="flex items-center gap-2">
          <UserCircle2 className="h-5 w-5 text-accent-400" />
          <h3 className="font-semibold text-stone-50">Conta</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-brand-800 bg-brand-950/40 px-4 py-3">
            <p className="text-xs text-stone-500">Plano</p>
            <p className="mt-1 text-sm font-medium text-stone-100">{planLabel}</p>
          </div>
          <div className="rounded-xl border border-brand-800 bg-brand-950/40 px-4 py-3">
            <p className="text-xs text-stone-500">Tipo de acesso</p>
            <div className="mt-1 flex items-center gap-2">
              <p className="text-sm font-medium text-stone-100">{roleLabel}</p>
              {user?.role === 'ADMIN' && <Badge variant="warning">Admin</Badge>}
            </div>
          </div>
        </div>
      </Card>

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
          disabled={savingPassword || !passwordForm.newPassword.trim()}
        >
          {savingPassword ? 'Alterando…' : 'Alterar senha'}
        </Button>
      </Card>
    </div>
  )
}
