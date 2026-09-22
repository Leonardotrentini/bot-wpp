import { useCallback, useEffect, useState } from 'react'
import { FileText, Loader2, Trash2, Upload } from 'lucide-react'
import { Button } from '../common/Button.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { addCrmAgentKnowledge, deleteCrmAgentKnowledge, getCrmAgentKnowledge } from '../../services/api.js'

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function AgentKnowledgePanel({ agentId, knowledgeText, onChange }) {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async () => {
    if (!agentId) return
    setLoading(true)
    try {
      const { data } = await getCrmAgentKnowledge(agentId)
      setItems(data.items || [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    load()
  }, [load])

  const uploadFile = async (file) => {
    if (!agentId || !file) return
    setUploading(true)
    try {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      const isText = file.type.startsWith('text/') || file.name.toLowerCase().endsWith('.txt')
      if (!isPdf && !isText) {
        toast.error('Envie PDF ou arquivo .txt')
        return
      }
      const buffer = await file.arrayBuffer()
      const base64 = isPdf ? arrayBufferToBase64(buffer) : undefined
      let contentText = ''
      if (isText) {
        contentText = await file.text()
      }
      await addCrmAgentKnowledge(agentId, {
        name: file.name,
        type: isPdf ? 'pdf' : 'text',
        contentText,
        base64: isPdf ? base64 : undefined,
        mimeType: file.type,
      })
      toast.success('Documento adicionado.')
      load()
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao enviar documento.')
    } finally {
      setUploading(false)
    }
  }

  const remove = async (kid) => {
    if (!agentId) return
    try {
      await deleteCrmAgentKnowledge(agentId, kid)
      setItems((prev) => prev.filter((i) => i.id !== kid))
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao remover.')
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-sm font-medium text-stone-300">Base de conhecimento (texto)</p>
        <textarea
          value={knowledgeText || ''}
          onChange={(e) => onChange({ knowledgeText: e.target.value })}
          rows={8}
          placeholder={`## Catálogo e preços\n- Pedido mínimo: 6 peças por referência\n- Tabela atacado: link ou valores\n\n## Prazos\n- Produção: 15–20 dias úteis\n- Envio: 3–7 dias úteis`}
          className="w-full resize-none rounded-xl border border-brand-700 bg-brand-900/60 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/60"
        />
      </div>

      <details className="rounded-xl border border-brand-700/60 bg-brand-950/40 p-3 text-sm text-stone-400">
        <summary className="cursor-pointer font-medium text-stone-300">Como estruturar PDF/texto para a IA</summary>
        <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
          <li>Use títulos claros: Preços, MOQ, Prazos, Formas de pagamento</li>
          <li>Links completos (https://…)</li>
          <li>Evite PDFs escaneados (só imagem) — prefira texto selecionável</li>
          <li>Atualize quando mudar tabela ou condições comerciais</li>
        </ul>
      </details>

      {agentId && (
        <div>
          <p className="mb-2 text-sm font-medium text-stone-300">Documentos anexos</p>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-brand-600 px-4 py-3 text-sm text-stone-400 hover:border-accent-500/50 hover:text-stone-200">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Enviar PDF ou .txt (máx. 5MB)
            <input
              type="file"
              accept=".pdf,.txt,text/plain,application/pdf"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) uploadFile(f)
                e.target.value = ''
              }}
            />
          </label>
          {loading ? (
            <p className="mt-2 text-xs text-stone-500">Carregando…</p>
          ) : items.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between rounded-lg border border-brand-700/50 bg-brand-900/40 px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2 text-stone-300">
                    <FileText className="h-4 w-4 text-stone-500" />
                    {item.name}
                    <span className="text-xs text-stone-500">({item.type})</span>
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => remove(item.id)}>
                    <Trash2 className="h-4 w-4 text-red-400" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-stone-500">Nenhum documento — salve o agente antes de anexar arquivos.</p>
          )}
        </div>
      )}

      {!agentId && (
        <p className="text-xs text-amber-200/80">Salve o agente uma vez para poder anexar PDFs.</p>
      )}
    </div>
  )
}
