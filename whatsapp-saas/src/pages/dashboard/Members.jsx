import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Tag, MessageSquare, Download, RefreshCw, Plus, X, CheckSquare, Eraser } from 'lucide-react'
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
        <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => setTagsModal(true)}>
          <Tag className="h-4 w-4" /> Gerenciar tags
        </Button>
        <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => toast.info('Envio em massa em breve.')}>
          <MessageSquare className="h-4 w-4" /> Mensagem
        </Button>
        <Button
          size="sm"
          variant={selected.size > 0 ? 'primary' : 'outline'}
          className="gap-1.5"
          onClick={exportCsv}
          disabled={!displayedMembers.length}
          title={
            selected.size > 0
              ? `Exportar ${selected.size} membro(s) selecionado(s)`
              : 'Exportar todos os membros visíveis'
          }
        >
          <Download className="h-4 w-4" />
          {selected.size > 0 ? `Exportar ${selected.size}` : 'Exportar'}
        </Button>
        <span className="hidden h-6 w-px bg-brand-700 sm:inline" aria-hidden />
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onSyncParticipants} disabled={syncing}>
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Sincronizando…' : 'Sincronizar'}
        </Button>
      </div>

      <div className="rounded-2xl border border-brand-800/90 bg-brand-900/50 shadow-sm shadow-black/20">
        <div className="flex flex-col gap-3 p-3 sm:p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5 border-brand-700"
              onClick={selectAll}
              disabled={!displayedMembers.length}
            >
              <CheckSquare className="h-4 w-4 shrink-0" />
              Selecionar todos
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1.5 text-stone-400 hover:text-stone-100"
              onClick={clearAll}
              disabled={selected.size === 0}
            >
              <Eraser className="h-4 w-4 shrink-0" />
              Limpar
            </Button>
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                selected.size > 0
                  ? 'border-accent-500/35 bg-accent-500/10 text-accent-300'
                  : 'border-brand-700/80 bg-brand-950/40 text-stone-400'
              }`}
              aria-live="polite"
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  selected.size > 0 ? 'bg-accent-400 shadow-[0_0_6px_rgba(212,175,55,0.6)]' : 'bg-stone-600'
                }`}
              />
              {selected.size === 0
                ? 'Nenhum membro selecionado'
                : `${selected.size} de ${displayedMembers.length} selecionado${selected.size === 1 ? '' : 's'}`}
            </span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:shrink-0">
            <p className="text-xs text-stone-500 sm:hidden">Aplicar tag aos selecionados</p>
            <div className="flex w-full items-stretch gap-2 sm:w-auto">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-brand-700 bg-brand-950/50 px-3 sm:min-w-[200px] sm:flex-initial">
                <Tag className="h-4 w-4 shrink-0 text-stone-500" aria-hidden />
                <select
                  value={applyTagValue}
                  onChange={(e) => setApplyTagValue(e.target.value)}
                  disabled={!tagCatalog.length || selected.size === 0}
                  aria-label="Tag para aplicar"
                  className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent py-2.5 text-sm text-stone-100 outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">
                    {tagCatalog.length ? 'Escolher tag…' : 'Crie uma tag primeiro'}
                  </option>
                  {tagCatalog.map((t) => (
                    <option key={t} value={t}>
                      {displayTag(t)}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                size="sm"
                variant="primary"
                className="shrink-0 px-4"
                disabled={!applyTagValue || selected.size === 0}
                onClick={() => applyTagToSelected(applyTagValue)}
              >
                Aplicar tag
              </Button>
            </div>
          </div>
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
