import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Input } from '../components/common/Input.jsx'
import { Button } from '../components/common/Button.jsx'
import { BrandLogo } from '../components/common/BrandLogo.jsx'
import { acceptOrgInvite } from '../services/api.js'
import { useAuth } from '../contexts/AuthContext.jsx'

export function AcceptInvite() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const navigate = useNavigate()
  const { login } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!token) {
      setError('Link de convite inválido.')
      return
    }
    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.')
      return
    }
    setLoading(true)
    try {
      const data = await acceptOrgInvite({ token, password })
      login(data.user)
      localStorage.setItem('vg_auth_token', data.token)
      navigate('/dashboard/connect', { replace: true })
    } catch (err) {
      setError(err?.response?.data?.message || 'Não foi possível aceitar o convite.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-brand-950 px-4">
      <div className="mb-8">
        <BrandLogo />
      </div>
      <div className="w-full max-w-md rounded-2xl border border-brand-800 bg-brand-900/60 p-6 shadow-xl">
        <h1 className="text-xl font-semibold text-stone-50">Entrar na equipe</h1>
        <p className="mt-2 text-sm text-stone-400">Defina sua senha para acessar o Vesto como vendedor.</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1 block text-xs text-stone-500">Nova senha</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div>
            <label className="mb-1 block text-xs text-stone-500">Confirmar senha</label>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Criando conta…' : 'Aceitar convite'}
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-stone-500">
          Já tem conta? <Link to="/login" className="text-accent-400 hover:underline">Entrar</Link>
        </p>
      </div>
    </div>
  )
}
