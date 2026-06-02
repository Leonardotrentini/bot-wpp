import { useCallback, useEffect, useMemo, useState } from 'react'
import { Tag, MessageSquare, Download, RefreshCw } from 'lucide-react'
import { Card } from '../../components/common/Card.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Select } from '../../components/common/Select.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { getMembers, syncMembersParticipants } from '../../services/api.js'
import { useToast } from '../../contexts/ToastContext.jsx'

function fmtActivity(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return String(iso).replace('T', ' ')
  }
}

export function Members() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [members, setMembers] = useState([])
  const [groups, setGroups] = useState([])
  const [meta, setMeta] = useState(null)
  const [groupId, setGroupId] = useState('')
  const [tag, setTag] = useState('')
  const [status, setStatus] = useState('')
  const [activeGroupsOnly, setActiveGroupsOnly] = useState(true)
  const [inactiveDays, setInactiveDays] = useState('')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [debouncedInactive, setDebouncedInactive] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 400)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedInactive(inactiveDays), 400)
    return () => clearTimeout(t)
  }, [inactiveDays])

  const loadMembers = useCallback(async () => {
    setLoading(true)
    try {
      const params = { activeGroupsOnly: activeGroupsOnly ? '1' : '0' }
      if (groupId) params.groupId = groupId
      if (tag) params.tag = tag
      if (status) params.status = status
      if (debouncedInactive) params.inactiveDays = debouncedInactive
      if (debouncedQ.trim()) params.q = debouncedQ.trim()
      const { data } = await getMembers(params)
      setMembers(data.members || [])
      setGroups(data.groups || [])
      setMeta(data.meta || null)
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao carregar membros.')
      setMembers([])
    } finally {
      setLoading(false)
    }
  }, [activeGroupsOnly, groupId, tag, status, debouncedInactive, debouncedQ, toast])

  useEffect(() => {
    loadMembers()
  }, [loadMembers])

  const allTags = useMemo(() => {
    const s = new Set()
    members.forEach((m) => (m.tags || []).forEach((t) => s.add(t)))
    return [...s].sort()
  }, [members])

  const activeGroups = useMemo(() => groups.filter((g) => g.status === 'ativo'), [groups])

  async function onSyncParticipants() {
    setSyncing(true)
    try {
      const { data } = await syncMembersParticipants(12)
      toast.success(`Participantes atualizados em ${data.synced || 0} grupo(s).`)
      await loadMembers()
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao sincronizar participantes.')
    } finally {
      setSyncing(false)
    }
  }

  function exportCsv() {
    if (!members.length) return toast.info('Nenhum membro para exportar.')
    const header = ['nome', 'telefone', 'grupos', 'tags', 'status', 'ultima_atividade']
    const rows = members.map((m) =>
      [
        m.name,
        m.phone,
        (m.groups || []).join('; '),
        (m.tags || []).join('; '),
        m.status,
        m.lastActivity || '',
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(','),
    )
    const blob = new Blob([`\uFEFF${header.join(',')}\n${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `membros-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('CSV exportado.')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" className="gap-1" onClick={() => toast.info('Tags em massa em breve.')}>
          <Tag className="h-4 w-4" /> Tags
        </Button>
        <Button size="sm" variant="secondary" className="gap-1" onClick={() => toast.info('Envio em massa em breve.')}>
          <MessageSquare className="h-4 w-4" /> Mensagem
        </Button>
        <Button size="sm" variant="outline" className="gap-1" onClick={exportCsv} disabled={!members.length}>
          <Download className="h-4 w-4" /> Exportar
        </Button>
        <Button size="sm" variant="outline" className="gap-1" onClick={onSyncParticipants} disabled={syncing}>
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Sincronizando…' : 'Sincronizar participantes'}
        </Button>
      </div>

      {meta && meta.groupsTotal > 0 && meta.groupsWithParticipants === 0 && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200/90">
          Ainda não há participantes importados. Clique em <strong>Sincronizar participantes</strong> ou abra cada grupo em{' '}
          <strong>Grupos</strong> para carregar a lista do WhatsApp.
        </p>
      )}

      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 mb-4">
          <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">Todos os grupos</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} {g.status !== 'ativo' ? '(inativo)' : ''}
              </option>
            ))}
          </Select>
          <Select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">Todas as tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Status</option>
            <option value="ativo">Ativo</option>
            <option value="inativo">Inativo</option>
          </Select>
          <label className="flex items-center gap-2 rounded-xl border border-brand-800 px-3 py-2 text-xs text-stone-300">
            <input
              type="checkbox"
              checked={activeGroupsOnly}
              onChange={(e) => setActiveGroupsOnly(e.target.checked)}
              className="rounded border-brand-600 text-accent-500 focus:ring-accent-500/30"
            />
            Só grupos ativos ({activeGroups.length})
          </label>
          <Input placeholder="Inatividade mín. (dias)" type="number" value={inactiveDays} onChange={(e) => setInactiveDays(e.target.value)} />
          <div className="sm:col-span-2">
            <Input placeholder="Buscar nome ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <p className="px-5 py-8 text-sm text-stone-500">Carregando membros…</p>
        ) : members.length === 0 ? (
          <p className="px-5 py-8 text-sm text-stone-500">
            Nenhum membro encontrado com os filtros atuais.
            {groups.length === 0 && ' Sincronize seus grupos em Conectar WhatsApp → Grupos.'}
          </p>
        ) : (
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
                {members.map((m) => (
                  <tr key={m.id} className="border-b border-brand-800/80 hover:bg-white/[0.02]">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <img src={m.avatar} alt="" className="h-9 w-9 rounded-full border border-brand-700" />
                        <span className="text-stone-100 font-medium">{m.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-stone-400">{m.phone}</td>
                    <td className="px-5 py-3 text-stone-300 max-w-[200px]">
                      <span className="line-clamp-2">{(m.groups || []).join(', ')}</span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(m.tags || []).map((t) => (
                          <Badge key={t} variant="default">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <Badge variant={m.status === 'ativo' ? 'success' : 'muted'}>{m.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-stone-500 text-xs">{fmtActivity(m.lastActivity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && members.length > 0 && (
          <p className="mt-3 px-5 text-xs text-stone-500">{members.length} membro(s) listado(s)</p>
        )}
      </Card>
    </div>
  )
}
