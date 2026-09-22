import { ACTIVATION_MODE_LABELS } from '../../lib/agentPromptTemplates.js'
import { Select } from '../common/Select.jsx'
import { Input } from '../common/Input.jsx'
import { Toggle } from '../common/Toggle.jsx'

const MODES = Object.entries(ACTIVATION_MODE_LABELS)

export function AgentScopePanel({ agent, tags, stages, onChange }) {
  const cfg = agent.activationConfig || {}

  const patchConfig = (patch) => {
    onChange({ activationConfig: { ...cfg, ...patch } })
  }

  return (
    <div className="space-y-4">
      <Select
        label="Onde o agente age"
        value={agent.activationMode || 'manual'}
        onChange={(e) => onChange({ activationMode: e.target.value })}
      >
        {MODES.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>

      {agent.activationMode !== 'manual' && (
        <Toggle
          label="Ligar IA automaticamente quando a regra bater"
          checked={cfg.autoEnableOnMatch !== false}
          onChange={(v) => patchConfig({ autoEnableOnMatch: v })}
        />
      )}

      {agent.activationMode === 'auto_keyword' && (
        <>
          <Input
            label="Palavras-chave (vírgula)"
            value={(cfg.keywords || []).join(', ')}
            onChange={(e) =>
              patchConfig({
                keywords: e.target.value
                  .split(',')
                  .map((k) => k.trim())
                  .filter(Boolean),
              })
            }
            placeholder="orçamento, catálogo, atacado"
          />
          <Select
            label="Modo de match"
            value={cfg.matchMode || 'contains'}
            onChange={(e) => patchConfig({ matchMode: e.target.value })}
          >
            <option value="contains">Contém</option>
            <option value="exact">Exato</option>
          </Select>
        </>
      )}

      {agent.activationMode === 'auto_tag' && (
        <div>
          <p className="mb-2 text-sm font-medium text-stone-300">Tags que ativam o agente</p>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => {
              const selected = (cfg.tagIds || []).includes(tag.id)
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => {
                    const ids = new Set(cfg.tagIds || [])
                    if (selected) ids.delete(tag.id)
                    else ids.add(tag.id)
                    patchConfig({ tagIds: [...ids] })
                  }}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    selected ? 'bg-accent-600/40 text-accent-100 ring-1 ring-accent-500/50' : 'bg-brand-800 text-stone-400 hover:text-stone-200'
                  }`}
                >
                  {tag.name}
                </button>
              )
            })}
            {tags.length === 0 && <p className="text-sm text-stone-500">Crie tags no CRM primeiro.</p>}
          </div>
        </div>
      )}

      {agent.activationMode === 'auto_stage' && (
        <div>
          <p className="mb-2 text-sm font-medium text-stone-300">Etapas do kanban</p>
          <div className="flex flex-wrap gap-2">
            {stages.map((stage) => {
              const selected = (cfg.stageIds || []).includes(stage.id)
              return (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => {
                    const ids = new Set(cfg.stageIds || [])
                    if (selected) ids.delete(stage.id)
                    else ids.add(stage.id)
                    patchConfig({ stageIds: [...ids] })
                  }}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    selected ? 'bg-accent-600/40 text-accent-100 ring-1 ring-accent-500/50' : 'bg-brand-800 text-stone-400 hover:text-stone-200'
                  }`}
                >
                  {stage.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {agent.activationMode === 'manual' && (
        <p className="text-sm text-stone-400">
          No modo manual, ligue a IA pelo Chat em cada conversa, ou use a ação <strong className="text-stone-300">assign_ai</strong> em um fluxo.
        </p>
      )}
    </div>
  )
}
