import { useEffect, useState } from 'react'
import { Plug } from 'lucide-react'
import { Card } from '../../components/common/Card.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Modal } from '../../components/common/Modal.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { getIntegrations } from '../../services/api.js'
import { useToast } from '../../contexts/ToastContext.jsx'

const fieldsById = {
  hotmart: [{ key: 'webhookSecret', label: 'Webhook secret', type: 'password' }, { key: 'token', label: 'Token API', type: 'text' }],
  kiwify: [{ key: 'accountId', label: 'ID da conta', type: 'text' }],
  eduzz: [{ key: 'apiKey', label: 'Chave API', type: 'password' }],
  sheets: [{ key: 'sheetId', label: 'ID da planilha', type: 'text' }, { key: 'serviceEmail', label: 'E-mail da conta de serviço', type: 'text' }],
  zapier: [{ key: 'hookUrl', label: 'URL do webhook Zapier', type: 'text' }],
  api: [{ key: 'baseUrl', label: 'URL base', type: 'text' }, { key: 'apiKey', label: 'API Key', type: 'password' }],
}

export function Integrations() {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [active, setActive] = useState(null)
  const [form, setForm] = useState({})

  useEffect(() => {
    getIntegrations().then((r) => setItems(r.data.integrations))
  }, [])

  const integ = items.find((x) => x.id === active)

  return (
    <div className="space-y-6">
      <p className="text-sm text-stone-400 max-w-2xl">
        Conecte sua stack de vendas. Os campos abaixo são mock — o backend validará tokens e OAuth.
      </p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((i) => (
          <Card key={i.id}>
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-brand-800 p-2 text-accent-400">
                <Plug className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-stone-50">{i.name}</h3>
                <p className="text-xs text-stone-500 mt-1 leading-relaxed">{i.description}</p>
                <Badge variant={i.connected ? 'success' : 'muted'} className="mt-3">
                  {i.connected ? 'Conectado' : 'Desconectado'}
                </Badge>
                <div className="mt-4">
                  <Button size="sm" variant={i.connected ? 'secondary' : 'primary'} onClick={() => { setActive(i.id); setForm({}) }}>
                    {i.connected ? 'Configurar' : 'Conectar'}
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Modal
        isOpen={!!integ}
        onClose={() => setActive(null)}
        title={integ ? `Configurar ${integ.name}` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setActive(null)}>Fechar</Button>
            <Button
              onClick={() => {
                toast.success('Integração salva (simulado).')
                setItems((prev) => prev.map((x) => (x.id === active ? { ...x, connected: true } : x)))
                setActive(null)
              }}
            >
              Salvar
            </Button>
          </>
        }
      >
        {integ && (
          <div className="space-y-4">
            <p className="text-sm text-stone-400">{integ.description}</p>
            {(fieldsById[integ.id] || []).map((f) => (
              <Input
                key={f.key}
                label={f.label}
                type={f.type}
                value={form[f.key] || ''}
                onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
              />
            ))}
            {!fieldsById[integ.id]?.length && (
              <p className="text-sm text-stone-500">Nenhum campo adicional necessário para o mock.</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
