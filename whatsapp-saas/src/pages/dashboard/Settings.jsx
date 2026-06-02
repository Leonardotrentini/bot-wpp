import { useEffect, useRef, useState } from 'react'
import { Card } from '../../components/common/Card.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Button } from '../../components/common/Button.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { updateProfile } from '../../services/api.js'
import { mockUser } from '../../utils/mockData.js'

export function Settings() {
  const toast = useToast()
  const { user, setCurrentUser } = useAuth()
  const photoInputRef = useRef(null)
  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    phone: user?.phone || '',
    newPassword: '',
    avatar: user?.avatar || mockUser.avatar,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      name: user?.name || '',
      email: user?.email || '',
      phone: user?.phone || '',
      avatar: user?.avatar || prev.avatar || mockUser.avatar,
    }))
  }, [user?.name, user?.email, user?.phone, user?.avatar])

  const onField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  const onPickPhoto = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Selecione uma imagem válida.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('A foto deve ter no máximo 2MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => onField('avatar', String(reader.result || ''))
    reader.onerror = () => toast.error('Não foi possível ler a imagem.')
    reader.readAsDataURL(file)
  }

  const saveProfile = async () => {
    const name = form.name.trim()
    const email = form.email.trim().toLowerCase()
    const phone = form.phone.trim()
    const newPassword = form.newPassword.trim()

    if (name.length < 2) return toast.error('Nome deve ter pelo menos 2 caracteres.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast.error('Informe um e-mail válido.')
    if (newPassword && newPassword.length < 6) return toast.error('A nova senha deve ter no mínimo 6 caracteres.')

    try {
      setSaving(true)
      const data = await updateProfile({
        name,
        email,
        phone: phone || null,
        avatar: form.avatar || null,
        ...(newPassword ? { newPassword } : {}),
      })
      if (data?.user) {
        localStorage.setItem('vg_auth', JSON.stringify(data.user))
        setCurrentUser(data.user)
      }
      setForm((prev) => ({ ...prev, newPassword: '' }))
      toast.success('Perfil atualizado com sucesso.')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao atualizar perfil.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <Card className="space-y-4">
        <div className="flex items-center gap-4">
          <img src={form.avatar || mockUser.avatar} alt="" className="h-16 w-16 rounded-2xl border border-brand-700 object-cover" />
          <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={onPickPhoto} />
          <Button variant="secondary" size="sm" onClick={() => photoInputRef.current?.click()}>
            Alterar foto
          </Button>
        </div>
        <Input label="Nome" value={form.name} onChange={(e) => onField('name', e.target.value)} />
        <Input label="E-mail" type="email" value={form.email} onChange={(e) => onField('email', e.target.value)} />
        <Input label="Telefone" value={form.phone} onChange={(e) => onField('phone', e.target.value)} />
        <Input
          label="Nova senha"
          type="password"
          value={form.newPassword}
          onChange={(e) => onField('newPassword', e.target.value)}
          placeholder="Deixe em branco para manter"
        />
        <Button onClick={saveProfile} disabled={saving}>
          {saving ? 'Salvando...' : 'Salvar'}
        </Button>
      </Card>
    </div>
  )
}
