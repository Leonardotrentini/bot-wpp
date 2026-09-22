import { AI_TOOL_LABELS } from '../../lib/agentPromptTemplates.js'
import { Toggle } from '../common/Toggle.jsx'

const TOOLS = Object.entries(AI_TOOL_LABELS)

export function AgentToolsPanel({ agent, tags, onChange }) {
  const allowed = new Set(agent.allowedTools || [])
  const allowedTags = new Set(agent.allowedTagIds || [])

  const toggleTool = (tool) => {
    const next = new Set(allowed)
    if (next.has(tool)) next.delete(tool)
    else next.add(tool)
    onChange({ allowedTools: [...next] })
  }

  const toggleTag = (tagId) => {
    const next = new Set(allowedTags)
    if (next.has(tagId)) next.delete(tagId)
    else next.add(tagId)
    onChange({ allowedTagIds: [...next] })
  }

  const usesTags = allowed.has('add_tag') || allowed.has('remove_tag')

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-400">
        Permissões opcionais via function calling. Se nada estiver marcado, o agente só responde texto.
      </p>
      <div className="space-y-2">
        {TOOLS.map(([id, label]) => (
          <Toggle key={id} label={label} checked={allowed.has(id)} onChange={() => toggleTool(id)} />
        ))}
      </div>
      {usesTags && (
        <div>
          <p className="mb-2 text-sm font-medium text-stone-300">Tags permitidas (vazio = todas)</p>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTag(tag.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  allowedTags.has(tag.id) || allowedTags.size === 0
                    ? 'bg-accent-600/30 text-accent-100'
                    : 'bg-brand-800 text-stone-500'
                }`}
              >
                {tag.name}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-stone-500">Clique para restringir; com nenhuma selecionada, qualquer tag do CRM pode ser usada.</p>
        </div>
      )}
    </div>
  )
}
