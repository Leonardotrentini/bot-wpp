import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { Button } from '../components/common/Button.jsx'
import { Input } from '../components/common/Input.jsx'
import { BrandLogo } from '../components/common/BrandLogo.jsx'
import { login } from '../services/api.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useToast } from '../contexts/ToastContext.jsx'

export function Login() {
  const navigate = useNavigate()
  const { login: setUser } = useAuth()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)

  function validate() {
    const e = {}
    if (!email.trim()) e.email = 'Informe o e-mail'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = 'E-mail inválido'
    if (!password) e.password = 'Informe a senha'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function onSubmit(ev) {
    ev.preventDefault()
    if (!validate()) return
    setLoading(true)
    try {
      const { data } = await login(email, password)
      setUser(data.user)
      toast.success('Login realizado com sucesso!')
      navigate('/dashboard')
    } catch (err) {
      toast.error(err.message || 'Falha no login')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-dvh min-h-screen bg-brand-950">
      <div className="relative hidden overflow-hidden border-r border-brand-800 bg-gradient-to-br from-brand-900 via-brand-950 to-brand-950 p-12 lg:flex lg:w-1/2 lg:flex-col lg:justify-center">
        <div className="absolute inset-0 opacity-30 bg-[url('data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23eab308\' fill-opacity=\'0.08\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')]" />
        <div className="relative">
          <BrandLogo className="mb-8" />
          <h2 className="max-w-md font-heading text-3xl font-bold text-stone-50">Bem-vindo de volta ao Vesto Group</h2>
          <p className="mt-4 max-w-md leading-relaxed text-stone-400">
            Centralize grupos, automatize mensagens e acompanhe métricas que importam para o seu funil.
          </p>
        </div>
      </div>
      <div className="flex w-full min-w-0 flex-1 flex-col justify-center px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8 sm:py-12 max-lg:justify-start">
        <div className="mx-auto w-full max-w-md min-w-0">
          <BrandLogo className="mb-5 max-lg:mb-4" />
          <Link to="/" className="mb-6 inline-flex min-h-11 items-center text-sm text-accent-400 hover:underline max-lg:mb-4">
            ← Voltar ao site
          </Link>
          <h1 className="font-heading text-2xl font-bold text-stone-50 max-lg:text-[1.65rem]">Entrar na conta</h1>
          <p className="mt-2 text-sm leading-relaxed text-stone-400">Use seu e-mail corporativo para acessar o painel.</p>
          <form onSubmit={onSubmit} className="mt-7 space-y-4 max-lg:mt-6">
            <Input
              label="E-mail"
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors.email}
              placeholder="voce@empresa.com.br"
            />
            <Input
              label="Senha"
              type="password"
              revealable
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
              placeholder="••••••••"
            />
            <div className="flex justify-end">
              <button
                type="button"
                className="inline-flex min-h-11 items-center whitespace-nowrap text-sm text-accent-400 hover:underline"
              >
                Esqueci minha senha
              </button>
            </div>
            <Button type="submit" className="w-full max-lg:min-h-12" disabled={loading}>
              {loading ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>
          <p className="mt-8 text-center text-sm text-stone-400">
            Não tem conta?{' '}
            <Link to="/register" className="font-medium text-accent-400 hover:underline">
              Criar conta
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
