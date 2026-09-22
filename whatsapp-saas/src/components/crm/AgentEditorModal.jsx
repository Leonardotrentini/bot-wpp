import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal } from '../common/Modal.jsx'
import { Button } from '../common/Button.jsx'
import { AgentPromptGuide } from './AgentPromptGuide.jsx'
import { AgentScopePanel } from './AgentScopePanel.jsx'
import { AgentKnowledgePanel } from './AgentKnowledgePanel.jsx'
import { AgentToolsPanel } from './AgentToolsPanel.jsx'
import { AgentPlayground } from './AgentPlayground.jsx'
import { ACTIVATION_MODE_LABELS, getAgentTemplate } from '../../lib/agentPromptTemplates.js'

export const EMPTY_AGENT = {
  name: '',
  enabled: false,
  systemPrompt: '',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 400,
  maxRepliesPerConversation: 10,
  handoffKeywords: ['humano', 'atendente'],
  replyDelayMinSec: 5,
  replyDelayMaxSec: 20,
  activationMode: 'manual',
  activationConfig: { keywords: [], matchMode: 'contains', tagIds: [], stageIds: [], autoEnableOnMatch: true },
  allowedTools: [],
  allowedTagIds: [],
  knowledgeText: '',
  promptTemplateId: 'moda_atacado',
  locale: 'pt-BR',
}

const TABS = [
  { id: 'identity', label: 'Identidade' },
  { id: 'scope', label: 'Onde age' },
  { id: 'knowledge', label: 'Conhecimento' },
  { id: 'tools', label: 'Permissões' },
  { id: 'test', label: 'Testar' },
]

export function AgentEditorModal({
  isOpen,
  onClose,
  initial,
  tags,
  stages,
  aiConfigured,
  onSave,
  saving,
}) {
  const [agent, setAgent] = useState(EMPTY_AGENT)
  const [tab, setTab] = useState('identity')

  useEffect(() => {
    if (isOpen) {
      if (initial) {
        setAgent({ ...EMPTY_AGENT, ...initial })
      } else {
        const t = getAgentTemplate('moda_atacado')
        setAgent({
          ...EMPTY_AGENT,
          promptTemplateId: 'moda_atacado',
          systemPrompt: t?.systemPrompt || EMPTY_AGENT.systemPrompt,
        })
      }
      setTab('identity')
    }
  }, [isOpen, initial])

  const patch = (patchObj) => setAgent((a) => ({ ...a, ...patchObj }))

  const valid = agent.name.trim() && agent.systemPrompt.trim().length >= 10

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={initial?.id ? 'Editar agente de IA' : 'Novo agente de IA'}
      size="xl"
      footer={
        <>
          <div className="mr-auto flex items-center gap-2 text-xs">
            <span
              className={`inline-block h-2 w-2 rounded-full ${aiConfigured ? 'bg-emerald-400' : 'bg-red-400'}`}
            />
            <span className="text-stone-500">{aiConfigured ? 'API IA conectada' : 'API IA não configurada'}</span>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => onSave(agent)} disabled={!valid || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Salvar agente
          </Button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap gap-1 border-b border-brand-800 pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              tab === t.id ? 'bg-accent-600/30 text-accent-100' : 'text-stone-400 hover:bg-brand-800 hover:text-stone-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'identity' && <AgentPromptGuide agent={agent} onChange={patch} />}
      {tab === 'scope' && <AgentScopePanel agent={agent} tags={tags} stages={stages} onChange={patch} />}
      {tab === 'knowledge' && (
        <AgentKnowledgePanel agentId={initial?.id} knowledgeText={agent.knowledgeText} onChange={patch} />
      )}
      {tab === 'tools' && <AgentToolsPanel agent={agent} tags={tags} onChange={patch} />}
      {tab === 'test' && (
        <div className="space-y-3">
          {!initial?.id ? (
            <p className="text-sm text-stone-400">Salve o agente primeiro para testar com a base de conhecimento.</p>
          ) : (
            <AgentPlayground agentId={initial.id} aiConfigured={aiConfigured} />
          )}
        </div>
      )}

      {tab !== 'test' && initial?.id && (
        <p className="mt-4 text-xs text-stone-500">
          Escopo: {ACTIVATION_MODE_LABELS[agent.activationMode] || agent.activationMode}
        </p>
      )}
    </Modal>
  )
}
