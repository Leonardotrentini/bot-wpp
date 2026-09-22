import { AGENT_PROMPT_TEMPLATES } from '../../lib/agentPromptTemplates.js'
import { Input } from '../common/Input.jsx'
import { Select } from '../common/Select.jsx'

export function AgentPromptGuide({ agent, onChange }) {
  const template = AGENT_PROMPT_TEMPLATES.find((t) => t.id === agent.promptTemplateId)

  const applyTemplate = (id) => {
    const t = AGENT_PROMPT_TEMPLATES.find((x) => x.id === id)
    if (!t) return
    onChange({
      promptTemplateId: id,
      locale: t.locale,
      systemPrompt: t.systemPrompt,
    })
  }

  return (
    <div className="space-y-4">
      <Select
        label="Template de prompt"
        value={agent.promptTemplateId || 'custom'}
        onChange={(e) => applyTemplate(e.target.value)}
      >
        {AGENT_PROMPT_TEMPLATES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </Select>

      <Input
        label="Nome do agente"
        value={agent.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder="Ex.: Consultor atacado"
      />

      <div>
        <p className="mb-1.5 text-sm font-medium text-stone-300">Instruções (prompt do sistema)</p>
        <textarea
          value={agent.systemPrompt}
          onChange={(e) => onChange({ systemPrompt: e.target.value })}
          rows={10}
          placeholder="Descreva o negócio, tom e regras. Use {{MARCA}} e {{NOME}} como placeholders."
          className="w-full resize-none rounded-xl border border-brand-700 bg-brand-900/60 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/60"
        />
        <p className="mt-1 text-xs text-stone-500">
          Mínimo 10 caracteres. A base de conhecimento é injetada em <code>{'{{KNOWLEDGE}}'}</code>.
        </p>
      </div>

      {template && template.id !== 'custom' && (
        <details className="rounded-xl border border-brand-700/60 bg-brand-950/40 p-3">
          <summary className="cursor-pointer text-sm font-medium text-stone-300">Ver exemplo do template</summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-stone-400">{template.systemPrompt}</pre>
        </details>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Modelo"
          value={agent.model}
          onChange={(e) => onChange({ model: e.target.value })}
          placeholder="gpt-4o-mini"
        />
        <Input
          label="Máx. respostas por conversa/dia"
          type="number"
          min={1}
          max={100}
          value={agent.maxRepliesPerConversation}
          onChange={(e) => onChange({ maxRepliesPerConversation: Math.max(1, Number(e.target.value) || 10) })}
        />
        <Input
          label="Delay mín. de resposta (s)"
          type="number"
          min={1}
          max={120}
          value={agent.replyDelayMinSec}
          onChange={(e) => onChange({ replyDelayMinSec: Math.max(1, Number(e.target.value) || 5) })}
        />
        <Input
          label="Delay máx. de resposta (s)"
          type="number"
          min={1}
          max={300}
          value={agent.replyDelayMaxSec}
          onChange={(e) => onChange({ replyDelayMaxSec: Math.max(1, Number(e.target.value) || 20) })}
        />
      </div>

      <Input
        label="Palavras de transferência para humano (vírgula)"
        value={(agent.handoffKeywords || []).join(', ')}
        onChange={(e) =>
          onChange({
            handoffKeywords: e.target.value
              .split(',')
              .map((k) => k.trim())
              .filter(Boolean),
          })
        }
        placeholder="humano, atendente, falar com alguém"
      />
    </div>
  )
}
