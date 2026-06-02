import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Tag, MessageSquare, Download, RefreshCw, Plus, X } from 'lucide-react'
import { Card } from '../../components/common/Card.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Select } from '../../components/common/Select.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { Modal } from '../../components/common/Modal.jsx'
import { getMembers, syncMembersParticipants } from '../../services/api.js'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useAuth } from '../../contexts/AuthContext.jsx'
import {
  normalizeTag,
  displayTag,
  loadMemberTagsStore,
  saveMemberTagsStore,
  mergeMemberTags,
  setMemberCustomTags,
} from '../../utils/memberTagsStorage.js'

function fmtActivity(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return String(iso).replace('T', ' ')
  }
}

function applyStoreToMembers(apiMembers, store) {
  return apiMembers.map((m) => ({
    ...m,
    tags: mergeMemberTags(m, store.overrides),
  }))
}

export function Members() {
  const toast = useToast()
  const { user } = useAuth()
  const userId = user?.id || user?.email || 'default'

  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [apiMembers, setApiMembers] = useState([])
  const [members, setMembers] = useState([])
  const [catalogExtras, setCatalogExtras] = useState([])
  const [tagOverrides, setTagOverrides] = useState({})
  const [groups, setGroups] = useState([])
  const [meta, setMeta] = useState(null)
  const [groupId, setGroupId] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [status, setStatus] = useState('')
  const [activeGroupsOnly, setActiveGroupsOnly] = useState(true)
  const [inactiveDays, setInactiveDays] = useState('')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [debouncedInactive, setDebouncedInactive] = useState('')

  const [selected, setSelected] = useState(() => new Set())
  const [tagsModal, setTagsModal] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [applyTagValue, setApplyTagValue] = useState('')

  const overridesRef = useRef(tagOverrides)
  const catalogRef = useRef(catalogExtras)
  overridesRef.current = tagOverrides
  catalogRef.current = catalogExtras

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 400)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedInactive(inactiveDays), 400)
    return () => clearTimeout(t)
  }, [inactiveDays])

  const persistStore = useCallback(
    (nextOverrides, nextCatalog) => {
      const overrides = nextOverrides !== undefined ? nextOverrides : overridesRef.current
      const catalog = nextCatalog !== undefined ? nextCatalog : catalogRef.current
      saveMemberTagsStore(userId, { catalogExtras: catalog, overrides })
    },
    [userId],
  )

  useEffect(() => {
    const store = loadMemberTagsStore(userId)
    setCatalogExtras(store.catalogExtras)
    setTagOverrides(store.overrides)
  }, [userId])

  const loadMembers = useCallback(async () => {
    setLoading(true)
    try {
      const params = { activeGroupsOnly: activeGroupsOnly ? '1' : '0' }
      if (groupId) params.groupId = groupId
      if (status) params.status = status
      if (debouncedInactive) params.inactiveDays = debouncedInactive
      if (debouncedQ.trim()) params.q = debouncedQ.trim()
      const { data } = await getMembers(params)
      const list = data.members || []
      setApiMembers(list)
      setGroups(data.groups || [])
      setMeta(data.meta || null)
      const store = loadMemberTagsStore(userId)
      setCatalogExtras(store.catalogExtras)
      setTagOverrides(store.overrides)
      setMembers(applyStoreToMembers(list, store))
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao carregar membros.')
      setApiMembers([])
      setMembers([])
    } finally {
      setLoading(false)
    }
  }, [activeGroupsOnly, groupId, status, debouncedInactive, debouncedQ, toast, userId])

  useEffect(() => {
    loadMembers()
  }, [loadMembers])

  useEffect(() => {
    setMembers(applyStoreToMembers(apiMembers, { overrides: tagOverrides, catalogExtras }))
  }, [apiMembers, tagOverrides])

  const tagCatalog = useMemo(() => {
    const s = new Set(catalogExtras.map(normalizeTag).filter(Boolean))
    members.forEach((m) => (m.tags || []).forEach((t) => s.add(normalizeTag(t))))
    return [...s].sort()
  }, [members, catalogExtras])

  const allTags = tagCatalog

  const displayedMembers = useMemo(() => {
    if (!tagFilter) return members
    return members.filter((m) => (m.tags || []).map(normalizeTag).includes(normalizeTag(tagFilter)))
  }, [members, tagFilter])

  const allVisibleSelected =
    displayedMembers.length > 0 && displayedMembers.every((m) => selected.has(m.id))

  const selectAll = () => {
    setSelected(new Set(displayedMembers.map((m) => m.id)))
  }

  const clearAll = () => {
    setSelected(new Set())
  }

  const toggleRow = (memberId) => {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(memberId)) n.delete(memberId)
      else n.add(memberId)
      return n
    })
  }

  const toggleSelectAllHeader = () => {
    if (allVisibleSelected) clearAll()
    else selectAll()
  }

  const createTag = () => {
    const norm = normalizeTag(newTagName)
    if (!norm) {
      toast.error('Digite um nome para a tag.')
      return
    }
    if (tagCatalog.includes(norm)) {
      toast.info('Essa tag já existe.')
      setNewTagName('')
      return
    }
    const nextCatalog = [...catalogExtras, norm]
    setCatalogExtras(nextCatalog)
    persistStore(tagOverrides, nextCatalog)
    setNewTagName('')
    toast.success(`Tag "${displayTag(norm)}" criada.`)
  }

  const applyTagToSelected = (tagRaw) => {
    const norm = normalizeTag(tagRaw || applyTagValue)
    if (!norm) {
      toast.error('Selecione uma tag para aplicar.')
      return
    }
    if (selected.size === 0) {
      toast.error('Selecione ao menos um membro.')
      return
    }
    let nextCatalog = [...catalogExtras]
    if (!tagCatalog.includes(norm) && !nextCatalog.includes(norm)) {
      nextCatalog = [...nextCatalog, norm]
      setCatalogExtras(nextCatalog)
    }
    let nextOverrides = { ...tagOverrides }
    selected.forEach((memberId) => {
      const m = members.find((x) => x.id === memberId)
      const current = (m?.tags || []).filter((t) => normalizeTag(t) !== 'admin')
      const merged = [...new Set([...current.map(normalizeTag), norm])]
      nextOverrides = setMemberCustomTags(nextOverrides, memberId, merged)
    })
    setTagOverrides(nextOverrides)
    persistStore(nextOverrides, nextCatalog)
    setMembers(
      applyStoreToMembers(apiMembers, { overrides: nextOverrides, catalogExtras: nextCatalog }),
    )
    toast.success(`Tag "${displayTag(norm)}" aplicada a ${selected.size} membro(s).`)
    setApplyTagValue('')
  }

  const removeTagFromMember = (memberId, tag) => {
    const norm = normalizeTag(tag)
    if (norm === 'admin') {
      toast.info('A tag admin vem do WhatsApp e não pode ser removida aqui.')
      return
    }
    const m = members.find((x) => x.id === memberId)
    const custom = (m?.tags || []).map(normalizeTag).filter((t) => t !== 'admin' && t !== norm)
    const nextOverrides = setMemberCustomTags(tagOverrides, memberId, custom)
    setTagOverrides(nextOverrides)
    persistStore(nextOverrides)
    setMembers(applyStoreToMembers(apiMembers, { overrides: nextOverrides }))
    toast.success(`Tag "${displayTag(norm)}" removida.`)
  }

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
    const toExport =
      selected.size > 0
        ? displayedMembers.filter((m) => selected.has(m.id))
        : displayedMembers
    if (!toExport.length) {
      return toast.info(
        selected.size > 0
          ? 'Nenhum dos selecionados está visível com os filtros atuais.'
          : 'Nenhum membro para exportar.',
      )
    }
    const header = ['nome', 'telefone', 'grupos', 'tags', 'status', 'ultima_atividade']
    const rows = toExport.map((m) =>
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
    const suffix = selected.size > 0 ? `-${toExport.length}-selecionados` : ''
    a.download = `membros${suffix}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(
      selected.size > 0
        ? `CSV exportado com ${toExport.length} membro(s) selecionado(s).`
        : `CSV exportado com ${toExport.length} membro(s).`,
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" className="gap-1" onClick={() => setTagsModal(true)}>
          <Tag className="h-4 w-4" /> Tags
        </Button>
        <Button size="sm" variant="secondary" className="gap-1" onClick={() => toast.info('Envio em massa em breve.')}>
          <MessageSquare className="h-4 w-4" /> Mensagem
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          onClick={exportCsv}
          disabled={!displayedMembers.length}
          title={
            selected.size > 0
              ? `Exportar ${selected.size} membro(s) selecionado(s)`
              : 'Exportar todos os membros visíveis'
          }
        >
          <Download className="h-4 w-4" />
          {selected.size > 0 ? `Exportar (${selected.size})` : 'Exportar'}
        </Button>
        <Button size="sm" variant="outline" className="gap-1" onClick={onSyncParticipants} disabled={syncing}>
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Sincronizando…' : 'Sincronizar participantes'}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-800 bg-brand-900/40 px-3 py-2">
        <button
          type="button"
          onClick={selectAll}
          disabled={!displayedMembers.length}
          className="text-xs font-semibold uppercase tracking-wide text-accent-400 hover:text-accent-300 disabled:opacity-40"
        >
          Selecionar todos
        </button>
        <span className="text-stone-600">|</span>
        <button
          type="button"
          onClick={clearAll}
          disabled={selected.size === 0}
          className="text-xs font-semibold uppercase tracking-wide text-stone-400 hover:text-stone-200 disabled:opacity-40"
        >
          Limpar todos
        </button>
        <span className="hidden text-stone-600 sm:inline">|</span>
        <span className="text-xs text-stone-500">
          {selected.size === 0 ? 'Nenhum selecionado' : `${selected.size} selecionado(s)`}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select
            className="min-w-[160px]"
            value={applyTagValue}
            onChange={(e) => setApplyTagValue(e.target.value)}
            disabled={!tagCatalog.length}
          >
            <option value="">Aplicar tag…</option>
            {tagCatalog.map((t) => (
              <option key={t} value={t}>
                {displayTag(t)}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="secondary"
            disabled={!applyTagValue || selected.size === 0}
            onClick={() => applyTagToSelected(applyTagValue)}
          >
            Aplicar
          </Button>
        </div>
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
          <Select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="">Todas as tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {displayTag(t)}
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
            Só grupos ativos ({groups.filter((g) => g.status === 'ativo').length})
          </label>
          <Input placeholder="Inatividade mín. (dias)" type="number" value={inactiveDays} onChange={(e) => setInactiveDays(e.target.value)} />
          <div className="sm:col-span-2">
            <Input placeholder="Buscar nome ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <p className="px-5 py-8 text-sm text-stone-500">Carregando membros…</p>
        ) : displayedMembers.length === 0 ? (
          <p className="px-5 py-8 text-sm text-stone-500">
            Nenhum membro encontrado com os filtros atuais.
            {groups.length === 0 && ' Sincronize seus grupos em Conectar WhatsApp → Grupos.'}
          </p>
        ) : (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="border-y border-brand-800 text-left text-stone-400">
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllHeader}
                      className="rounded border-brand-600 text-accent-500 focus:ring-accent-500/30"
                      title="Selecionar todos visíveis"
                      aria-label="Selecionar todos"
                    />
                  </th>
                  <th className="px-5 py-3">Membro</th>
                  <th className="px-5 py-3">Telefone</th>
                  <th className="px-5 py-3">Grupos</th>
                  <th className="px-5 py-3">Tags</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Última atividade</th>
                </tr>
              </thead>
              <tbody>
                {displayedMembers.map((m) => (
                  <tr key={m.id} className="border-b border-brand-800/80 hover:bg-white/[0.02]">
                    <td className="px-3 py-3 align-middle">
                      <input
                        type="checkbox"
                        checked={selected.has(m.id)}
                        onChange={() => toggleRow(m.id)}
                        className="rounded border-brand-600 text-accent-500 focus:ring-accent-500/30"
                        aria-label={`Selecionar ${m.name}`}
                      />
                    </td>
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
                        {(m.tags || []).length ? (
                          m.tags.map((t) => {
                            const norm = normalizeTag(t)
                            if (norm === 'admin') {
                              return (
                                <Badge key={`${m.id}-admin`} variant="warning">
                                  admin
                                </Badge>
                              )
                            }
                            return (
                              <span
                                key={`${m.id}-${norm}`}
                                className="inline-flex items-center gap-0.5 rounded-full border border-brand-600 bg-brand-800/80 pl-2.5 pr-1 py-0.5 text-xs text-stone-200"
                              >
                                {displayTag(norm)}
                                <button
                                  type="button"
                                  className="rounded p-0.5 text-stone-500 hover:bg-white/10 hover:text-accent-400"
                                  aria-label={`Remover tag ${displayTag(norm)}`}
                                  onClick={() => removeTagFromMember(m.id, norm)}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            )
                          })
                        ) : (
                          <span className="text-stone-600">—</span>
                        )}
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
        {!loading && displayedMembers.length > 0 && (
          <p className="mt-3 px-5 text-xs text-stone-500">{displayedMembers.length} membro(s) listado(s)</p>
        )}
      </Card>

      <Modal
        isOpen={tagsModal}
        onClose={() => setTagsModal(false)}
        title="Gerenciar tags"
        size="md"
        footer={
          <Button variant="ghost" onClick={() => setTagsModal(false)}>
            Fechar
          </Button>
        }
      >
        <p className="text-sm text-stone-400 mb-4">
          Crie tags para organizar membros. Selecione membros na tabela e use o menu &quot;Aplicar tag&quot; acima da lista.
        </p>
        <div className="flex flex-wrap gap-2 mb-4 min-h-[28px]">
          {tagCatalog.map((t) => (
            <Badge key={t} variant="default">
              {displayTag(t)}
            </Badge>
          ))}
          {tagCatalog.length === 0 && <span className="text-xs text-stone-500">Nenhuma tag ainda.</span>}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Nome da nova tag (ex: lead-quente)"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), createTag())}
          />
          <Button type="button" variant="secondary" className="gap-1 shrink-0" onClick={createTag}>
            <Plus className="h-4 w-4" /> Criar
          </Button>
        </div>
      </Modal>
    </div>
  )
}
