import { useState } from 'react'
import { Tabs } from '../../components/common/Tabs.jsx'
import { Card } from '../../components/common/Card.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Toggle } from '../../components/common/Toggle.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { mockUser } from '../../utils/mockData.js'

export function Settings() {
  const toast = useToast()
  const { user } = useAuth()
  const [tab, setTab] = useState('perfil')
  const [notif, setNotif] = useState({ email: true, push: false, whatsapp: true })
  const [teamEmail, setTeamEmail] = useState('')

  return (
    <div className="space-y-6 max-w-3xl">
      <Tabs
        tabs={[
          { id: 'perfil', label: 'Perfil' },
          { id: 'plano', label: 'Plano' },
          { id: 'notif', label: 'Notificações' },
          { id: 'equipe', label: 'Equipe' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'perfil' && (
        <Card className="space-y-4">
          <div className="flex items-center gap-4">
            <img src={user?.avatar || mockUser.avatar} alt="" className="h-16 w-16 rounded-2xl border border-brand-700" />
            <Button variant="secondary" size="sm" onClick={() => toast.info('Upload simulado.')}>Alterar foto</Button>
          </div>
          <Input label="Nome" defaultValue={user?.name} />
          <Input label="E-mail" type="email" defaultValue={user?.email} />
          <Input label="Telefone" defaultValue={user?.phone} />
          <Input label="Nova senha" type="password" placeholder="Deixe em branco para manter" />
          <Button onClick={() => toast.success('Perfil atualizado (simulado).')}>Salvar</Button>
        </Card>
      )}

      {tab === 'plano' && (
        <Card className="space-y-4">
          <p className="text-sm text-stone-400">Plano atual</p>
          <p className="text-2xl font-bold text-accent-400">{user?.plan || 'Pro'}</p>
          <div className="grid gap-3 sm:grid-cols-3 mt-4">
            {[
              { k: 'Grupos', v: '8 / 15' },
              { k: 'Membros', v: '2.847 / 10.000' },
              { k: 'Mensagens/mês', v: '42k / 200k' },
            ].map((x) => (
              <div key={x.k} className="rounded-xl border border-brand-800 p-3">
                <p className="text-xs text-stone-500">{x.k}</p>
                <p className="text-lg font-semibold text-stone-50 mt-1">{x.v}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-4">
            <Button variant="secondary" onClick={() => toast.info('Fluxo de upgrade simulado.')}>Upgrade</Button>
            <Button variant="outline" onClick={() => toast.info('Downgrade simulado.')}>Downgrade</Button>
          </div>
        </Card>
      )}

      {tab === 'notif' && (
        <Card className="space-y-6">
          <Toggle checked={notif.email} onChange={(v) => setNotif((n) => ({ ...n, email: v }))} label="Notificações por e-mail" />
          <Toggle checked={notif.push} onChange={(v) => setNotif((n) => ({ ...n, push: v }))} label="Push no navegador" />
          <Toggle checked={notif.whatsapp} onChange={(v) => setNotif((n) => ({ ...n, whatsapp: v }))} label="Alertas no WhatsApp" />
          <Button onClick={() => toast.success('Preferências salvas.')}>Salvar</Button>
        </Card>
      )}

      {tab === 'equipe' && (
        <Card className="space-y-4">
          <p className="text-sm text-stone-400">Convide membros da equipe e defina permissões (admin, editor, leitura).</p>
          <Input label="E-mail do convidado" type="email" value={teamEmail} onChange={(e) => setTeamEmail(e.target.value)} placeholder="colega@empresa.com.br" />
          <SelectPerm />
          <Button onClick={() => { toast.success('Convite enviado (simulado).'); setTeamEmail('') }}>Adicionar membro</Button>
          <ul className="mt-6 divide-y divide-brand-800 border-t border-brand-800 pt-4 text-sm">
            <li className="flex justify-between py-2">
              <span className="text-stone-50">{user?.email}</span>
              <span className="text-accent-400">Admin</span>
            </li>
            <li className="flex justify-between py-2 text-stone-400">
              <span>maria@empresa.com.br</span>
              <span>Editor</span>
            </li>
          </ul>
        </Card>
      )}
    </div>
  )
}

function SelectPerm() {
  return (
    <label className="block w-full">
      <span className="mb-1.5 block text-sm font-medium text-stone-300">Permissão</span>
      <select className="w-full rounded-xl border border-brand-700 bg-brand-900/50 px-4 py-2.5 text-sm text-stone-50 outline-none focus:border-accent-500/60">
        <option value="admin">Admin</option>
        <option value="editor">Editor</option>
        <option value="read">Somente leitura</option>
      </select>
    </label>
  )
}
