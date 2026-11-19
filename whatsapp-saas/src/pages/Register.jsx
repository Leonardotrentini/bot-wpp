import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '../components/common/Button.jsx'
import { Input } from '../components/common/Input.jsx'
import { register } from '../services/api.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useToast } from '../contexts/ToastContext.jsx'

export function Register() {
  const navigate = useNavigate()
  const { login: setUser } = useAuth()
  const toast = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)

  function validate() {
    const e = {}
    if (!name.trim()) e.name = 'Informe seu nome'
    if (!email.trim()) e.email = 'Informe o e-mail'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = 'E-mail inválido'
    if (!password || password.length < 6) e.password = 'Mínimo 6 caracteres'
    if (password !== confirm) e.confirm = 'As senhas não coincidem'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function onSubmit(ev) {
    ev.preventDefault()
    if (!validate()) return
    setLoading(true)
    try {
      const { data } = await register(name, email, password)
      setUser(data.user)
      toast.success('Conta criada! Bem-vindo.')
      navigate('/dashboard')
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Não foi possível registrar'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-dvh min-h-screen bg-brand-950">
      <div className="relative hidden overflow-hidden border-r border-brand-800 bg-gradient-to-br from-brand-800/90 to-brand-950 p-12 lg:flex lg:w-1/2 lg:flex-col lg:justify-center">
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-accent-500/10 blur-3xl" />
        <div className="absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-brand-500/20 blur-2xl" />
        <div className="relative">
          <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-2xl border border-accent-500/30 bg-accent-500/20 text-accent-400">
            <Sparkles className="h-8 w-8" />
          </div>
          <h2 className="max-w-md font-heading text-3xl font-bold text-stone-50">Comece a escalar hoje</h2>
          <p className="mt-4 max-w-md leading-relaxed text-stone-400">
            Trial completo para testar automações, analytics e integrações com seus grupos reais.
          </p>
        </div>
      </div>
      <div className="flex w-full min-w-0 flex-1 flex-col justify-center px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8 sm:py-12 max-lg:justify-start">
        <div className="mx-auto w-full max-w-md min-w-0">
          <Link to="/" className="mb-6 inline-flex min-h-11 items-center text-sm text-accent-400 hover:underline max-lg:mb-4">
            ← Voltar ao site
          </Link>
          <h1 className="font-heading text-2xl font-bold text-stone-50 max-lg:text-[1.65rem]">Criar conta</h1>
          <p className="mt-2 text-sm leading-relaxed text-stone-400">Leva menos de um minuto.</p>
          <form onSubmit={onSubmit} className="mt-7 space-y-4 max-lg:mt-6">
            <Input label="Nome completo" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} placeholder="Maria Santos" />
            <Input label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} placeholder="voce@empresa.com.br" />
            <Input label="Senha" type="password" revealable value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} placeholder="Mínimo 6 caracteres" />
            <Input label="Confirmar senha" type="password" revealable value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} placeholder="Repita a senha" />
            <Button type="submit" className="w-full max-lg:min-h-12" disabled={loading}>
              {loading ? 'Criando...' : 'Criar conta'}
            </Button>
          </form>
          <p className="mt-8 text-center text-sm text-stone-400">
            Já tem conta?{' '}
            <Link to="/login" className="font-medium text-accent-400 hover:underline">
              Entrar
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
