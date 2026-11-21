import { useEffect, useState } from 'react'
import { Bot, Kanban, Loader2, Send, Tag, User } from 'lucide-react'
import { Button } from '../common/Button.jsx'
import { Select } from '../common/Select.jsx'
import { Card } from '../common/Card.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { testCrmAgent } from '../../services/api.js'
import { describeAgentAudience } from '../../lib/agentPromptTemplates.js'

function ActionList({ actions }) {
  if (!actions?.length) return null
  return (
    <ul className="mt-2 space-y-1">
      {actions.map((action, index) => {
        const Icon = action.type === 'move_stage' ? Kanban : action.type === 'handoff' ? User : Tag
        return (
          <li
            key={`${action.type}-${index}`}
            className="flex items-center gap-1.5 rounded-lg border border-amber-400/30 bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-50"
          >
            <Icon className="h-3.5 w-3.5 shrink-0 text-amber-300" />
            {action.label}
          </li>
        )
      })}
    </ul>
  )
}

export function AgentPlayground({ agentId, aiConfigured }) {
  const toast = useToast()
  const [input, setInput] = useState('')
  const [turns, setTurns] = useState([])
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    setTurns([])
    setInput('')
  }, [agentId])

  const send = async () => {
    const message = input.trim()
    if (!message || !agentId) return
    if (!aiConfigured) {
      toast.error('Conecte a chave de API da empresa antes de testar.')
      return
    }
    setTesting(true)
    setInput('')
    const nextTurns = [...turns, { role: 'user', content: message }]
    setTurns(nextTurns)
    try {
      const history = turns.map((turn) => ({
        role: turn.role,
        content: turn.content,
        actions: turn.actions || [],
      }))
      const { data } = await testCrmAgent(agentId, message, history)
      setTurns([
        ...nextTurns,
        {
          role: 'assistant',
          content: data.reply || '(sem resposta)',
          actions: Array.isArray(data.actions) ? data.actions : [],
        },
      ])
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
          Conecte a chave de API desta empresa para testar. O teste usa essa chave e não altera leads de verdade.
        </div>
      )}
      <div className="max-h-80 space-y-2 overflow-y-auto rounded-xl border border-brand-700/60 bg-brand-950/50 p-3">
        {turns.length === 0 ? (
          <p className="text-sm text-stone-500">
            Simule o cliente. Se o agente tiver permissão, a resposta mostra tag adicionada, tag removida e movimento de kanban.
          </p>
        ) : (
          turns.map((turn, index) => (
            <div key={index} className={`flex gap-2 text-sm ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {turn.role === 'assistant' && <Bot className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />}
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 ${
                  turn.role === 'user' ? 'bg-accent-600/30 text-stone-100' : 'bg-brand-800/80 text-stone-200'
                }`}
              >
                {turn.content}
                <ActionList actions={turn.actions} />
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
        <button type="button" onClick={() => setTurns([])} className="text-xs text-stone-500 hover:text-stone-300">
          Limpar conversa de teste
        </button>
      )}
    </div>
  )
}

export function AgentTestBench({ agents, members = [], aiConfigured }) {
  const [agentId, setAgentId] = useState(agents[0]?.id || '')

  useEffect(() => {
    if (!agents.some((agent) => agent.id === agentId)) setAgentId(agents[0]?.id || '')
  }, [agents, agentId])

  const agent = agents.find((item) => item.id === agentId)

  if (!agents.length) return null

  return (
    <Card className="space-y-3">
      <div>
        <p className="text-sm font-medium text-stone-100">Testar um agente salvo</p>
        <p className="mt-1 text-xs text-stone-500">
          Escolha o agente. A resposta mostra o texto e, quando ele decidir, a tag que adicionou ou removeu e o movimento no kanban. Nada disso grava no CRM.
        </p>
      </div>
      <Select label="Agente" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
        {agents.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </Select>
      {agent ? (
        <p className="text-xs text-stone-400">Onde atua: {describeAgentAudience(agent, members)}</p>
      ) : null}
      <AgentPlayground agentId={agentId} aiConfigured={aiConfigured} />
    </Card>
  )
}
