import { useEffect, useState } from 'react'
import { Zap, Copy, Pencil, Trash2 } from 'lucide-react'
import { Card } from '../../components/common/Card.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Modal, ConfirmModal } from '../../components/common/Modal.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Textarea } from '../../components/common/Textarea.jsx'
import { Select } from '../../components/common/Select.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { getAutomations, createAutomation, getGroups } from '../../services/api.js'
import { useToast } from '../../contexts/ToastContext.jsx'

export function Automations() {
  const toast = useToast()
  const [list, setList] = useState([])
  const [groups, setGroups] = useState([])
  const [modal, setModal] = useState(false)
  const [confirmId, setConfirmId] = useState(null)
  const [form, setForm] = useState({
    name: '',
    type: 'boas-vindas',
    message: '',
    groupIds: [],
    triggerKeyword: '',
    cronHint: '',
  })

  async function refresh() {
    const [a, g] = await Promise.all([getAutomations(), getGroups()])
    setList(a.data.automations)
    setGroups(g.data.groups)
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleCreate() {
    if (!form.name.trim() || !form.message.trim()) {
      toast.error('Nome e mensagem são obrigatórios.')
      return
    }
    await createAutomation({
      name: form.name,
      type: form.type,
      message: form.message,
      groupIds: form.groupIds,
      meta: { triggerKeyword: form.triggerKeyword, cronHint: form.cronHint },
    })
    toast.success('Automação criada.')
    setModal(false)
    setForm({ name: '', type: 'boas-vindas', message: '', groupIds: [], triggerKeyword: '', cronHint: '' })
    refresh()
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-stone-50">Automações</h2>
          <p className="text-sm text-stone-400 mt-1">Boas-vindas, agendadas e gatilhos por palavra-chave.</p>
        </div>
        <Button onClick={() => setModal(true)}>Criar nova automação</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {list.map((a) => (
          <Card key={a.id}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex gap-3">
                <div className="rounded-xl bg-accent-500/15 p-2 text-accent-400">
                  <Zap className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-stone-50">{a.name}</h3>
                  <p className="text-xs text-stone-500 capitalize mt-1">Tipo: {a.type.replace('-', ' ')}</p>
                  <Badge variant={a.status === 'ativa' ? 'success' : 'muted'} className="mt-2">{a.status}</Badge>
                  <p className="text-sm text-stone-400 mt-3 line-clamp-2">{a.messagePreview}</p>
                  <p className="text-xs text-stone-500 mt-2">{a.groupIds?.length || 0} grupo(s)</p>
                </div>
              </div>
              <div className="flex gap-1">
                <button type="button" className="p-2 rounded-lg text-stone-400 hover:bg-white/5 hover:text-stone-50" aria-label="Editar" onClick={() => toast.info('Edição simulada.')}>
                  <Pencil className="h-4 w-4" />
                </button>
                <button type="button" className="p-2 rounded-lg text-stone-400 hover:bg-white/5 hover:text-stone-50" aria-label="Duplicar" onClick={() => toast.success('Automação duplicada (simulado).')}>
                  <Copy className="h-4 w-4" />
                </button>
                <button type="button" className="p-2 rounded-lg text-stone-400 hover:bg-red-500/10 hover:text-red-300" aria-label="Excluir" onClick={() => setConfirmId(a.id)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Modal
        isOpen={modal}
        onClose={() => setModal(false)}
        title="Nova automação"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal(false)}>Cancelar</Button>
            <Button onClick={handleCreate}>Salvar</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Nome" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ex: Boas-vindas VIP" />
          <Select label="Tipo" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
            <option value="boas-vindas">Boas-vindas</option>
            <option value="agendada">Agendada</option>
            <option value="gatilho">Gatilho (palavra-chave)</option>
          </Select>
          {form.type === 'gatilho' && (
            <Input label="Palavra-chave" value={form.triggerKeyword} onChange={(e) => setForm((f) => ({ ...f, triggerKeyword: e.target.value }))} placeholder="OFERTA" />
          )}
          {form.type === 'agendada' && (
            <Input label="Recorrência / nota (mock)" value={form.cronHint} onChange={(e) => setForm((f) => ({ ...f, cronHint: e.target.value }))} placeholder="Diariamente 9h" />
          )}
          <Textarea label="Mensagem" rows={4} value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} />
          <div>
            <p className="text-sm font-medium text-stone-300 mb-2">Grupos alvo</p>
            <div className="max-h-36 space-y-2 overflow-y-auto rounded-xl border border-brand-800 p-2">
              {groups.map((g) => (
                <label key={g.id} className="flex items-center gap-2 text-sm text-stone-300">
                  <input
                    type="checkbox"
                    checked={form.groupIds.includes(g.id)}
                    onChange={() =>
                      setForm((f) => ({
                        ...f,
                        groupIds: f.groupIds.includes(g.id) ? f.groupIds.filter((x) => x !== g.id) : [...f.groupIds, g.id],
                      }))
                    }
                    className="rounded border-brand-600"
                  />
                  {g.name}
                </label>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!confirmId}
        onClose={() => setConfirmId(null)}
        onConfirm={() => {
          toast.success('Automação removida (simulado).')
          setConfirmId(null)
        }}
        message="Tem certeza que deseja excluir esta automação? Esta ação não pode ser desfeita."
        title="Excluir automação"
      />
    </div>
  )
}
