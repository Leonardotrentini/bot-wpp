import { useState } from 'react'
import { Bot, Loader2, Send, User } from 'lucide-react'
import { Button } from '../common/Button.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { testCrmAgent } from '../../services/api.js'

export function AgentPlayground({ agentId, aiConfigured }) {
  const toast = useToast()
  const [input, setInput] = useState('')
  const [turns, setTurns] = useState([])
  const [testing, setTesting] = useState(false)

  const send = async () => {
    const message = input.trim()
    if (!message || !agentId) return
    if (!aiConfigured) {
      toast.error('Configure OPENAI_API_KEY no servidor para testar.')
      return
    }
    setTesting(true)
    setInput('')
    const nextTurns = [...turns, { role: 'user', content: message }]
    setTurns(nextTurns)
    try {
      const history = turns.map((t) => ({ role: t.role, content: t.content }))
      const { data } = await testCrmAgent(agentId, message, history)
      setTurns([...nextTurns, { role: 'assistant', content: data.reply || '(sem resposta)' }])
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha no teste da IA.')
      setTurns(turns)
      setInput(message)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-3">
      {!aiConfigured && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          IA não configurada no servidor. Adicione <code className="text-amber-50">OPENAI_API_KEY</code> no{' '}
          <code className="text-amber-50">backend/.env</code> e reinicie o backend.
        </div>
      )}
      <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-brand-700/60 bg-brand-950/50 p-3">
        {turns.length === 0 ? (
          <p className="text-sm text-stone-500">Simule uma conversa de cliente — ex.: &quot;Qual o pedido mínimo?&quot;</p>
        ) : (
          turns.map((turn, i) => (
            <div
              key={i}
              className={`flex gap-2 text-sm ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {turn.role === 'assistant' && <Bot className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />}
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 ${
                  turn.role === 'user' ? 'bg-accent-600/30 text-stone-100' : 'bg-brand-800/80 text-stone-200'
                }`}
              >
                {turn.content}
              </div>
              {turn.role === 'user' && <User className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />}
            </div>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !testing && send()}
          disabled={!agentId || testing}
          placeholder="Mensagem do cliente…"
          className="flex-1 rounded-xl border border-brand-700 bg-brand-900/60 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/60 disabled:opacity-50"
        />
        <Button size="sm" onClick={send} disabled={testing || !input.trim() || !agentId}>
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
      {turns.length > 0 && (
        <button
          type="button"
          onClick={() => setTurns([])}
          className="text-xs text-stone-500 hover:text-stone-300"
        >
          Limpar conversa de teste
        </button>
      )}
    </div>
  )
}
