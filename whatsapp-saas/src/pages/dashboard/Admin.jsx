import { useCallback, useEffect, useState } from 'react'
import { Eye, LogOut, Pencil, Shield, Trash2, UserPlus, Building2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Card } from '../../components/common/Card.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Spinner } from '../../components/common/Spinner.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Modal, ConfirmModal } from '../../components/common/Modal.jsx'
import { UserAvatar } from '../../components/common/UserAvatar.jsx'
import {
  createAdminUser,
  createAdminOrgMember,
  createAdminOrganization,
  deleteAdminOrgMember,
  deleteAdminUser,
  getAdminOrganizations,
  getAdminPlans,
  getAdminUsers,
  impersonateAdminUser,
  patchAdminOrgMember,
  patchAdminUser,
  patchAdminUserPlan,
} from '../../services/api.js'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'

export function Admin() {
  const toast = useToast()
  const navigate = useNavigate()
  const { setCurrentUser, refreshImpersonation } = useAuth()
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState([])
  const [plans, setPlans] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [appliedQ, setAppliedQ] = useState('')
  const [savingId, setSavingId] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', email: '', role: 'USER', planId: '' })
  const [editSaving, setEditSaving] = useState(false)
  const [deleteUser, setDeleteUser] = useState(null)
  const [deleteSaving, setDeleteSaving] = useState(false)
  const [viewAsId, setViewAsId] = useState(null)
  const [createForm, setCreateForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'USER',
  })
  const [tab, setTab] = useState('users')
  const [orgs, setOrgs] = useState([])
  const [orgsLoading, setOrgsLoading] = useState(false)
  const [orgQ, setOrgQ] = useState('')
  const [appliedOrgQ, setAppliedOrgQ] = useState('')
  const [manageOrg, setManageOrg] = useState(null)
  const [newOrgName, setNewOrgName] = useState('')
  const [creatingOrg, setCreatingOrg] = useState(false)
  const [memberForm, setMemberForm] = useState({ name: '', email: '', password: '', role: 'SELLER' })
  const [addingMember, setAddingMember] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await getAdminUsers({ page, pageSize: 20, q: appliedQ.trim() || undefined })
      setUsers(data.users || [])
      setTotal(data.total ?? 0)
    } catch (e) {
      toast.error(e.response?.data?.message || 'Não foi possível carregar utilizadores.')
      setUsers([])
    } finally {
      setLoading(false)
    }
  }, [page, appliedQ, toast])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    getAdminPlans()
      .then((r) => setPlans(r.data.plans || []))
      .catch(() => {})
  }, [])

  const loadOrgs = useCallback(async () => {
    setOrgsLoading(true)
    try {
      const { data } = await getAdminOrganizations({ q: appliedOrgQ.trim() || undefined })
      setOrgs(data.organizations || [])
    } catch (e) {
      toast.error(e.response?.data?.message || 'Não foi possível carregar empresas.')
      setOrgs([])
    } finally {
      setOrgsLoading(false)
    }
  }, [appliedOrgQ, toast])

  useEffect(() => {
    if (tab === 'organizations') loadOrgs()
  }, [tab, loadOrgs])

  async function onRoleChange(userId, role) {
    setSavingId(userId)
    try {
      await patchAdminUser(userId, { role })
      toast.success('Função atualizada.')
      await load()
    } catch (e) {
      toast.error(e.response?.data?.message || 'Erro ao atualizar.')
    } finally {
      setSavingId(null)
    }
  }

  async function onPlanChange(userId, planId) {
    if (!planId) return
    setSavingId(userId)
    try {
      await patchAdminUserPlan(userId, planId)
      toast.success('Plano atualizado.')
      await load()
    } catch (e) {
      toast.error(e.response?.data?.message || 'Erro ao atualizar plano.')
    } finally {
      setSavingId(null)
    }
  }

  function openEdit(u) {
    setEditUser(u)
    setEditForm({
      name: u.name || '',
      email: u.email || '',
      role: u.role || 'USER',
      planId: u.plan?.id || plans[0]?.id || '',
    })
  }

  async function saveEdit() {
    if (!editUser) return
    const name = editForm.name.trim()
    const email = editForm.email.trim().toLowerCase()
    if (name.length < 2) return toast.error('Nome deve ter pelo menos 2 caracteres.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast.error('Informe um e-mail válido.')

    setEditSaving(true)
    try {
      await patchAdminUser(editUser.id, { name, email, role: editForm.role })
      if (editForm.planId && editForm.planId !== editUser.plan?.id) {
        await patchAdminUserPlan(editUser.id, editForm.planId)
      }
      toast.success('Usuário atualizado.')
      setEditUser(null)
      await load()
    } catch (e) {
      toast.error(e.response?.data?.message || 'Falha ao salvar.')
    } finally {
      setEditSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteUser) return
    setDeleteSaving(true)
    try {
      await deleteAdminUser(deleteUser.id)
      toast.success('Usuário excluído.')
      setDeleteUser(null)
      await load()
    } catch (e) {
      toast.error(e.response?.data?.message || 'Falha ao excluir.')
    } finally {
      setDeleteSaving(false)
    }
  }

  async function onViewAs(u) {
    if (u.role === 'ADMIN') {
      toast.error('Não é possível acessar a conta de outro administrador.')
      return
    }
    setViewAsId(u.id)
    try {
      const { user } = await impersonateAdminUser(u.id)
      setCurrentUser(user)
      refreshImpersonation()
      toast.success(`Visualizando conta de ${user.name}`)
      navigate('/dashboard')
    } catch (e) {
      toast.error(e.response?.data?.message || 'Não foi possível acessar a conta.')
    } finally {
      setViewAsId(null)
    }
  }

  function resetCreateForm() {
    setCreateForm({ name: '', email: '', password: '', role: 'USER' })
  }

  async function onCreateUser() {
    const name = createForm.name.trim()
    const email = createForm.email.trim().toLowerCase()
    const password = createForm.password
    if (name.length < 2) return toast.error('Nome deve ter pelo menos 2 caracteres.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast.error('Informe um login (e-mail) válido.')
    if (password.length < 6) return toast.error('Senha deve ter pelo menos 6 caracteres.')

    setCreating(true)
    try {
      await createAdminUser({ name, email, password, role: createForm.role })
      toast.success('Usuário criado com sucesso.')
      setCreateOpen(false)
      resetCreateForm()
      setPage(1)
      await load()
    } catch (e) {
      toast.error(e.response?.data?.message || 'Falha ao criar usuário.')
    } finally {
      setCreating(false)
    }
  }

  async function onCreateOrg() {
    const name = newOrgName.trim()
    if (name.length < 2) return toast.error('Informe o nome da empresa.')
    setCreatingOrg(true)
    try {
      await createAdminOrganization({ name })
      toast.success('Empresa criada.')
      setNewOrgName('')
      await loadOrgs()
    } catch (e) {
      toast.error(e.response?.data?.message || 'Falha ao criar empresa.')
    } finally {
      setCreatingOrg(false)
    }
  }

  async function onAddOrgMember() {
    if (!manageOrg) return
    const name = memberForm.name.trim()
    const email = memberForm.email.trim().toLowerCase()
    const password = memberForm.password
    if (name.length < 2 || !email || password.length < 6) {
      return toast.error('Preencha nome, e-mail e senha (mín. 6 caracteres).')
    }
    setAddingMember(true)
    try {
      await createAdminOrgMember(manageOrg.id, {
        name,
        email,
        password,
        role: memberForm.role,
      })
      toast.success('Membro adicionado à empresa.')
      setMemberForm({ name: '', email: '', password: '', role: 'SELLER' })
      const { data } = await getAdminOrganizations({ q: appliedOrgQ.trim() || undefined })
      const updated = (data.organizations || []).find((o) => o.id === manageOrg.id)
      if (updated) setManageOrg(updated)
      setOrgs(data.organizations || [])
      await load()
    } catch (e) {
      toast.error(e.response?.data?.message || 'Falha ao adicionar membro.')
    } finally {
      setAddingMember(false)
    }
  }

  async function onOrgMemberRoleChange(orgId, userId, role) {
    try {
      await patchAdminOrgMember(orgId, userId, { role })
      toast.success('Papel atualizado.')
      await loadOrgs()
      if (manageOrg?.id === orgId) {
        const { data } = await getAdminOrganizations()
        const updated = (data.organizations || []).find((o) => o.id === orgId)
        if (updated) setManageOrg(updated)
      }
      await load()
    } catch (e) {
      toast.error(e.response?.data?.message || 'Erro ao atualizar papel.')
    }
  }

  async function onRemoveOrgMember(orgId, userId, name) {
    if (!window.confirm(`Remover ${name} da empresa?`)) return
    try {
      await deleteAdminOrgMember(orgId, userId)
      toast.success('Membro removido.')
      await loadOrgs()
      if (manageOrg?.id === orgId) {
        const { data } = await getAdminOrganizations()
        const updated = (data.organizations || []).find((o) => o.id === orgId)
        if (updated) setManageOrg(updated)
      }
      await load()
    } catch (e) {
      toast.error(e.response?.data?.message || 'Falha ao remover membro.')
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-500/15 text-accent-400">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-stone-50">Administração</h1>
            <p className="text-sm text-stone-500">Usuários, empresas, planos e acessos</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {tab === 'users' && (
            <Button variant="secondary" type="button" onClick={() => setCreateOpen(true)}>
              <UserPlus className="h-4 w-4" />
              Novo usuário
            </Button>
          )}
          {tab === 'users' && (
            <>
              <input
                type="search"
                placeholder="Pesquisar e-mail ou nome…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="min-w-[200px] rounded-xl border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:border-accent-500/50 focus:outline-none focus:ring-1 focus:ring-accent-500/30"
              />
              <Button
                variant="secondary"
                type="button"
                onClick={() => {
                  setAppliedQ(q)
                  setPage(1)
                }}
              >
                Pesquisar
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex gap-2 border-b border-brand-800 pb-1">
        <button
          type="button"
          onClick={() => setTab('users')}
          className={`rounded-t-lg px-4 py-2 text-sm font-medium transition ${
            tab === 'users' ? 'bg-brand-900 text-accent-400 border border-brand-800 border-b-brand-900' : 'text-stone-500 hover:text-stone-200'
          }`}
        >
          Usuários
        </button>
        <button
          type="button"
          onClick={() => setTab('organizations')}
          className={`rounded-t-lg px-4 py-2 text-sm font-medium transition flex items-center gap-1.5 ${
            tab === 'organizations' ? 'bg-brand-900 text-accent-400 border border-brand-800 border-b-brand-900' : 'text-stone-500 hover:text-stone-200'
          }`}
        >
          <Building2 className="h-4 w-4" />
          Empresas
        </button>
      </div>

      {tab === 'users' && (
      <>
      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-brand-800 bg-brand-900/50 text-stone-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Usuário</th>
                  <th className="px-4 py-3 font-medium">E-mail</th>
                  <th className="px-4 py-3 font-medium">Empresa</th>
                  <th className="px-4 py-3 font-medium">Papel empresa</th>
                  <th className="px-4 py-3 font-medium">Plano</th>
                  <th className="px-4 py-3 font-medium">Função</th>
                  <th className="px-4 py-3 font-medium">Registo</th>
                  <th className="px-4 py-3 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-800/80">
                {users.map((u) => (
                  <tr key={u.id} className="text-stone-300 hover:bg-white/[0.03]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <UserAvatar name={u.name} src={null} size="sm" className="rounded-lg" />
                        <span className="truncate font-medium text-stone-100">{u.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-stone-400">{u.email}</td>
                    <td className="px-4 py-3 text-stone-400">{u.organization?.name || '—'}</td>
                    <td className="px-4 py-3 text-stone-400">
                      {u.organization?.role === 'OWNER' ? 'Dono' : u.organization?.role === 'SELLER' ? 'Vendedor' : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={u.plan?.id || ''}
                        disabled={savingId === u.id || plans.length === 0}
                        onChange={(e) => onPlanChange(u.id, e.target.value)}
                        className="rounded-lg border border-brand-700 bg-brand-950 px-2 py-1.5 text-xs text-stone-200 focus:border-accent-500/50 focus:outline-none"
                      >
                        {!u.plan?.id && <option value="">—</option>}
                        {plans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        disabled={savingId === u.id}
                        onChange={(e) => onRoleChange(u.id, e.target.value)}
                        className="rounded-lg border border-brand-700 bg-brand-950 px-2 py-1.5 text-xs text-stone-200 focus:border-accent-500/50 focus:outline-none"
                      >
                        <option value="USER">USER</option>
                        <option value="ADMIN">ADMIN</option>
                      </select>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-stone-500">
                      {u.createdAt ? new Date(u.createdAt).toLocaleString('pt-BR') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          className="rounded-lg p-2 text-stone-400 transition hover:bg-accent-500/10 hover:text-accent-300 disabled:opacity-50"
                          title="Ver conta do cliente"
                          aria-label="Ver conta do cliente"
                          disabled={viewAsId === u.id || u.role === 'ADMIN'}
                          onClick={() => onViewAs(u)}
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="rounded-lg p-2 text-stone-400 transition hover:bg-white/5 hover:text-stone-50"
                          title="Editar usuário"
                          aria-label="Editar usuário"
                          onClick={() => openEdit(u)}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="rounded-lg p-2 text-stone-400 transition hover:bg-red-500/10 hover:text-red-300"
                          title="Excluir usuário"
                          aria-label="Excluir usuário"
                          onClick={() => setDeleteUser(u)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {users.length === 0 && (
              <p className="py-12 text-center text-stone-500">Nenhum utilizador encontrado.</p>
            )}
          </div>
        )}
      </Card>

      {!loading && total > 20 && (
        <div className="flex justify-center gap-2">
          <Button variant="secondary" disabled={page <= 1} type="button" onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <span className="flex items-center px-3 text-sm text-stone-500">
            Página {page} — {total} total
          </span>
          <Button
            variant="secondary"
            disabled={page * 20 >= total}
            type="button"
            onClick={() => setPage((p) => p + 1)}
          >
            Seguinte
          </Button>
        </div>
      )}
      </>
      )}

      {tab === 'organizations' && (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-stone-500">Nova empresa</label>
                <Input
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  placeholder="Ex.: Baseset"
                />
              </div>
              <Button type="button" onClick={onCreateOrg} disabled={creatingOrg}>
                {creatingOrg ? 'Criando…' : 'Criar empresa'}
              </Button>
              <input
                type="search"
                placeholder="Buscar empresa…"
                value={orgQ}
                onChange={(e) => setOrgQ(e.target.value)}
                className="min-w-[180px] rounded-xl border border-brand-700 bg-brand-900/80 px-3 py-2 text-sm text-stone-200"
              />
              <Button variant="secondary" type="button" onClick={() => setAppliedOrgQ(orgQ)}>
                Buscar
              </Button>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            {orgsLoading ? (
              <div className="flex justify-center py-16">
                <Spinner />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-brand-800 bg-brand-900/50 text-stone-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Empresa</th>
                      <th className="px-4 py-3 font-medium">Dono</th>
                      <th className="px-4 py-3 font-medium">Membros</th>
                      <th className="px-4 py-3 font-medium text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-800/80">
                    {orgs.map((org) => (
                      <tr key={org.id} className="text-stone-300 hover:bg-white/[0.03]">
                        <td className="px-4 py-3 font-medium text-stone-100">{org.name}</td>
                        <td className="px-4 py-3 text-stone-400">
                          {org.owner ? `${org.owner.name} (${org.owner.email})` : '—'}
                        </td>
                        <td className="px-4 py-3 text-stone-400">{org.memberCount}</td>
                        <td className="px-4 py-3 text-right">
                          <Button size="sm" variant="secondary" type="button" onClick={() => setManageOrg(org)}>
                            Gerenciar acessos
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!orgs.length && <p className="py-12 text-center text-stone-500">Nenhuma empresa encontrada.</p>}
              </div>
            )}
          </Card>
        </div>
      )}

      <Modal
        isOpen={!!manageOrg}
        onClose={() => !addingMember && setManageOrg(null)}
        title={manageOrg ? `Acessos — ${manageOrg.name}` : 'Empresa'}
        footer={
          <Button variant="ghost" type="button" disabled={addingMember} onClick={() => setManageOrg(null)}>
            Fechar
          </Button>
        }
      >
        {manageOrg && (
          <div className="space-y-6">
            <div>
              <h4 className="mb-2 text-sm font-medium text-stone-300">Membros</h4>
              <ul className="divide-y divide-brand-800 rounded-xl border border-brand-800">
                {manageOrg.members?.map((m) => (
                  <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium text-stone-100">{m.name}</p>
                      <p className="text-stone-500">{m.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={m.role}
                        onChange={(e) => onOrgMemberRoleChange(manageOrg.id, m.userId, e.target.value)}
                        className="rounded-lg border border-brand-700 bg-brand-950 px-2 py-1 text-xs text-stone-200"
                      >
                        <option value="OWNER">Dono</option>
                        <option value="SELLER">Vendedor</option>
                      </select>
                      {m.role === 'SELLER' && (
                        <button
                          type="button"
                          className="rounded p-1.5 text-red-400 hover:bg-red-500/10"
                          onClick={() => onRemoveOrgMember(manageOrg.id, m.userId, m.name)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
                {!manageOrg.members?.length && (
                  <li className="px-3 py-4 text-center text-stone-500">Nenhum membro.</li>
                )}
              </ul>
            </div>
            <div className="border-t border-brand-800 pt-4">
              <h4 className="mb-3 text-sm font-medium text-stone-300">Adicionar vendedor</h4>
              <div className="space-y-3">
                <Input
                  label="Nome"
                  value={memberForm.name}
                  onChange={(e) => setMemberForm((f) => ({ ...f, name: e.target.value }))}
                />
                <Input
                  label="E-mail"
                  type="email"
                  value={memberForm.email}
                  onChange={(e) => setMemberForm((f) => ({ ...f, email: e.target.value }))}
                />
                <Input
                  label="Senha"
                  type="password"
                  value={memberForm.password}
                  onChange={(e) => setMemberForm((f) => ({ ...f, password: e.target.value }))}
                />
                <Button type="button" disabled={addingMember} onClick={onAddOrgMember}>
                  {addingMember ? 'Adicionando…' : 'Criar vendedor na empresa'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!editUser}
        onClose={() => !editSaving && setEditUser(null)}
        title="Editar usuário"
        footer={
          <>
            <Button variant="ghost" type="button" disabled={editSaving} onClick={() => setEditUser(null)}>
              Cancelar
            </Button>
            <Button type="button" disabled={editSaving} onClick={saveEdit}>
              {editSaving ? 'Salvando…' : 'Salvar'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Nome" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
          <Input label="E-mail" type="email" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} />
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-stone-300">Plano</span>
            <select
              value={editForm.planId}
              onChange={(e) => setEditForm((f) => ({ ...f, planId: e.target.value }))}
              className="w-full rounded-xl border border-brand-700 bg-brand-900/50 px-4 py-2.5 text-sm text-stone-50 outline-none focus:border-accent-500/60"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-stone-300">Função</span>
            <select
              value={editForm.role}
              onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
              className="w-full rounded-xl border border-brand-700 bg-brand-900/50 px-4 py-2.5 text-sm text-stone-50 outline-none focus:border-accent-500/60"
            >
              <option value="USER">USER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </label>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!deleteUser}
        onClose={() => !deleteSaving && setDeleteUser(null)}
        onConfirm={confirmDelete}
        loading={deleteSaving}
        title="Excluir usuário"
        message={
          deleteUser
            ? `Excluir "${deleteUser.name}" (${deleteUser.email})? Grupos, automações e dados do WhatsApp serão removidos permanentemente.`
            : ''
        }
      />

      <Modal
        isOpen={createOpen}
        onClose={() => {
          if (creating) return
          setCreateOpen(false)
        }}
        title="Adicionar novo usuário"
        footer={
          <>
            <Button
              variant="ghost"
              type="button"
              disabled={creating}
              onClick={() => {
                setCreateOpen(false)
                resetCreateForm()
              }}
            >
              Cancelar
            </Button>
            <Button type="button" disabled={creating} onClick={onCreateUser}>
              {creating ? 'Criando...' : 'Criar usuário'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Nome"
            value={createForm.name}
            onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Nome completo"
          />
          <Input
            label="Login (e-mail)"
            type="email"
            value={createForm.email}
            onChange={(e) => setCreateForm((prev) => ({ ...prev, email: e.target.value }))}
            placeholder="usuario@empresa.com"
          />
          <Input
            label="Senha"
            type="password"
            value={createForm.password}
            onChange={(e) => setCreateForm((prev) => ({ ...prev, password: e.target.value }))}
            placeholder="Mínimo 6 caracteres"
          />
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-stone-300">Função</span>
            <select
              value={createForm.role}
              onChange={(e) => setCreateForm((prev) => ({ ...prev, role: e.target.value }))}
              className="w-full rounded-xl border border-brand-700 bg-brand-900/50 px-4 py-2.5 text-sm text-stone-50 outline-none focus:border-accent-500/60"
            >
              <option value="USER">USER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </label>
        </div>
      </Modal>
    </div>
  )
}
