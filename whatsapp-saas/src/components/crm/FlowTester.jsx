import { useState } from 'react'
import { ExternalLink, Loader2, Play } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '../common/Button.jsx'
import { Select } from '../common/Select.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { contactTitle } from '../../lib/contactDisplay.js'
import { buildFlowApiPayload, flowMessageHasContent } from '../../lib/flowMedia.js'
import { testCrmFlow, testCrmFlowDraft } from '../../services/api.js'

function flowIsTestable(flow) {
  if (!flow?.actions?.length) return false
  return flow.actions.every((a) => {
    if (a.type === 'send_message') return flowMessageHasContent(a)
    if (a.type === 'add_tag') return Boolean(a.tagId)
    if (a.type === 'move_stage') return Boolean(a.stageId)
    if (a.type === 'set_status') return Boolean(a.value)
    return true
  })
}

/**
 * @param {boolean} [testDraft] — true: testa o formulário atual (modal); false: testa fluxo salvo no servidor
 */
export function FlowTester({ flow, flowId, conversations = [], waConnected = true, onTested, testDraft = false }) {
  const toast = useToast()
  const [conversationId, setConversationId] = useState('')
  const [testing, setTesting] = useState(false)
  const [lastResult, setLastResult] = useState(null)

  const testable = flowIsTestable(flow)
  const sorted = [...conversations].sort((a, b) => {
    const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
    const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
    return tb - ta
  })

  const runTest = async () => {
    if (!conversationId || !testable) return
    setTesting(true)
    setLastResult(null)
    try {
      const payload = buildFlowApiPayload(flow)
      const useSaved = Boolean(flowId) && !testDraft
      const { data } = useSaved
        ? await testCrmFlow(flowId, conversationId)
        : await testCrmFlowDraft(payload, conversationId)
      setLastResult(data)
      onTested?.(data)
      toast.success(data.message || 'Teste executado.')
    } catch (err) {
      const msg = err?.response?.data?.message
      toast.error(msg || 'Falha ao testar o fluxo.')
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="rounded-xl border border-accent-500/25 bg-accent-500/5 p-4">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent-300">Testar fluxo</p>
      <p className="mb-3 text-[11px] leading-relaxed text-stone-500">
        Envia as ações agora para uma conversa real. Ignora gatilho e cooldown — útil para validar antes de ativar.
      </p>
      {!waConnected ? (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Conecte o WhatsApp antes de testar.
        </p>
      ) : (
        <div className="space-y-2">
          <Select value={conversationId} onChange={(e) => setConversationId(e.target.value)}>
            <option value="">Escolha a conversa de teste…</option>
            {sorted.slice(0, 100).map((c) => (
              <option key={c.id} value={c.id}>
                {contactTitle(c.contact)} — {c.lastMessagePreview || 'sem mensagens'}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="w-full"
            onClick={runTest}
            disabled={testing || !conversationId || !testable || !waConnected}
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Executar teste agora
          </Button>
          {!testable ? (
            <p className="text-[11px] text-stone-500">Preencha todas as ações antes de testar.</p>
          ) : null}
        </div>
      )}
      {lastResult?.conversationId ? (
        <div className="mt-3 rounded-lg bg-brand-900/60 px-3 py-2 text-xs text-stone-300">
          <p>
            {lastResult.detail?.length
              ? `Executado: ${lastResult.detail.join(' → ')}`
              : 'Nenhuma ação foi executada.'}
          </p>
          <Link
            to={`/dashboard/chat?c=${encodeURIComponent(lastResult.conversationId)}`}
            className="mt-1 inline-flex items-center gap-1 text-accent-300 hover:text-accent-200"
          >
            Abrir conversa no chat
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      ) : null}
    </div>
  )
}
