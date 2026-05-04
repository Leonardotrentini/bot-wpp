import { useEffect, useMemo, useState } from 'react'
import { Tag, MessageSquare, Download } from 'lucide-react'
import { Card } from '../../components/common/Card.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Select } from '../../components/common/Select.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { getMembers } from '../../services/api.js'
import { useToast } from '../../contexts/ToastContext.jsx'

export function Members() {
  const toast = useToast()
  const [refNow] = useState(() => Date.now())
  const [members, setMembers] = useState([])
  const [group, setGroup] = useState('')
  const [tag, setTag] = useState('')
  const [status, setStatus] = useState('')
  const [inactiveDays, setInactiveDays] = useState('')
  const [q, setQ] = useState('')

  useEffect(() => {
    getMembers().then((r) => setMembers(r.data.members))
  }, [])

  const allTags = useMemo(() => {
    const s = new Set()
    members.forEach((m) => m.tags.forEach((t) => s.add(t)))
    return [...s]
  }, [members])

  const allGroupNames = useMemo(() => {
    const s = new Set()
    members.forEach((m) => m.groups.forEach((g) => s.add(g)))
    return [...s]
  }, [members])

  const filtered = useMemo(() => {
    return members.filter((m) => {
      if (status && m.status !== status) return false
      if (tag && !m.tags.includes(tag)) return false
      if (group && !m.groups.includes(group)) return false
      if (q && !m.name.toLowerCase().includes(q.toLowerCase()) && !m.phone.includes(q)) return false
      if (inactiveDays) {
        const days = Number(inactiveDays)
        if (!Number.isNaN(days) && days > 0) {
          const last = new Date(m.lastActivity).getTime()
          const diff = (refNow - last) / (1000 * 60 * 60 * 24)
          if (diff < days) return false
        }
      }
      return true
    })
  }, [members, status, tag, group, q, inactiveDays, refNow])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" className="gap-1" onClick={() => toast.info('Tags em massa (simulado).')}>
          <Tag className="h-4 w-4" /> Tags
        </Button>
        <Button size="sm" variant="secondary" className="gap-1" onClick={() => toast.info('Envio em massa (simulado).')}>
          <MessageSquare className="h-4 w-4" /> Mensagem
        </Button>
        <Button size="sm" variant="outline" className="gap-1" onClick={() => toast.success('Exportação iniciada (CSV simulado).')}>
          <Download className="h-4 w-4" /> Exportar
        </Button>
      </div>

      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 mb-4">
          <Select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">Todos os grupos</option>
            {allGroupNames.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </Select>
          <Select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">Todas as tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Status</option>
            <option value="ativo">Ativo</option>
            <option value="inativo">Inativo</option>
          </Select>
          <Input placeholder="Inatividade mínima (dias)" type="number" value={inactiveDays} onChange={(e) => setInactiveDays(e.target.value)} />
          <div className="sm:col-span-2">
            <Input placeholder="Buscar nome ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        <div className="overflow-x-auto -mx-5">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-y border-brand-800 text-left text-stone-400">
                <th className="px-5 py-3">Membro</th>
                <th className="px-5 py-3">Telefone</th>
                <th className="px-5 py-3">Grupos</th>
                <th className="px-5 py-3">Tags</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Última atividade</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.id} className="border-b border-brand-800/80 hover:bg-white/[0.02]">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <img src={m.avatar} alt="" className="h-9 w-9 rounded-full border border-brand-700" />
                      <span className="text-stone-100 font-medium">{m.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-stone-400">{m.phone}</td>
                  <td className="px-5 py-3 text-stone-300 max-w-[200px]">
                    <span className="line-clamp-2">{m.groups.join(', ')}</span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {m.tags.map((t) => (
                        <Badge key={t} variant="default">{t}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <Badge variant={m.status === 'ativo' ? 'success' : 'muted'}>{m.status}</Badge>
                  </td>
                  <td className="px-5 py-3 text-stone-500 text-xs">{m.lastActivity?.replace('T', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
