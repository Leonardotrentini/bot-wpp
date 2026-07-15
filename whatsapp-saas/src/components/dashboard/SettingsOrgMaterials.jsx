import { useCallback, useEffect, useState } from 'react'
import { FileText, Link2, Plus, Trash2 } from 'lucide-react'
import { Card } from '../common/Card.jsx'
import { Input } from '../common/Input.jsx'
import { Button } from '../common/Button.jsx'
import { Select } from '../common/Select.jsx'
import { ConfirmModal } from '../common/Modal.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import {
  createOrgMaterial,
  deleteOrgMaterial,
  getOrgMaterials,
} from '../../services/api.js'
import { DOCUMENT_MAX_BYTES, documentMaxLabel } from '../../lib/mediaLimits.js'

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const base64 = result.includes(',') ? result.split(',')[1] : result
      resolve(base64)
    }
    reader.onerror = () => reject(new Error('Falha ao ler arquivo'))
    reader.readAsDataURL(file)
  })
}

const emptyForm = () => ({
  title: '',
  kind: 'link',
  body: '',
  url: '',
  shortcut: '',
  mediaBase64: null,
  mediaMime: null,
  mediaName: null,
})

export function SettingsOrgMaterials() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [materials, setMaterials] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getOrgMaterials()
      setMaterials(data?.materials || [])
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Não foi possível carregar os materiais.')
      setMaterials([])
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  async function onPickPdf(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    if (!isPdf) {
      toast.error('Envie um arquivo PDF.')
      return
    }
    if (file.size > DOCUMENT_MAX_BYTES) {
      toast.error(`PDF até ${documentMaxLabel}.`)
      return
    }
    try {
      const mediaBase64 = await fileToBase64(file)
      setForm((f) => ({
        ...f,
        kind: 'document',
        mediaBase64,
        mediaMime: 'application/pdf',
        mediaName: file.name,
      }))
    } catch {
      toast.error('Falha ao ler o PDF.')
    }
  }

  async function saveMaterial() {
    const title = form.title.trim()
    if (!title) {
      toast.error('Informe o título do material.')
      return
    }
    if (form.kind === 'link' && !form.url.trim()) {
      toast.error('Informe o link.')
      return
    }
    if (form.kind === 'document' && !form.mediaBase64) {
      toast.error('Envie o PDF.')
      return
    }
    setSaving(true)
    try {
      await createOrgMaterial({
        title,
        kind: form.kind,
        body: form.body.trim(),
        url: form.kind === 'link' ? form.url.trim() : null,
        shortcut: form.shortcut.trim().toLowerCase() || null,
        mediaBase64: form.kind === 'document' ? form.mediaBase64 : null,
        mediaMime: form.kind === 'document' ? form.mediaMime : null,
        mediaName: form.kind === 'document' ? form.mediaName : null,
      })
      toast.success('Material adicionado. A equipe já pode usar no chat.')
      setForm(emptyForm())
      await load()
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao salvar material.')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteOrgMaterial(deleteTarget.id)
      toast.success('Material removido.')
      setDeleteTarget(null)
      await load()
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Falha ao remover.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <Card className="space-y-5">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-accent-400" />
          <div>
            <h3 className="font-semibold text-stone-50">Materiais da loja</h3>
            <p className="text-xs text-stone-500">
              Catálogos e links compartilhados com todas as vendedoras no chat.
            </p>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-brand-800 bg-brand-950/30 p-4">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-accent-400" />
            <h4 className="text-sm font-medium text-stone-200">Novo material</h4>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Título"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Catálogo verão"
            />
            <Select
              label="Tipo"
              value={form.kind}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  kind: e.target.value,
                  mediaBase64: null,
                  mediaMime: null,
                  mediaName: null,
                }))
              }
            >
              <option value="link">Link</option>
              <option value="document">PDF</option>
            </Select>
          </div>
          {form.kind === 'link' ? (
            <Input
              label="URL"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://…"
            />
          ) : (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-stone-300">PDF</label>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={onPickPdf}
                className="block w-full text-sm text-stone-400 file:mr-3 file:rounded-lg file:border-0 file:bg-accent-500/20 file:px-3 file:py-2 file:text-sm file:font-medium file:text-accent-300"
              />
              {form.mediaName && <p className="mt-1 text-xs text-stone-500">{form.mediaName}</p>}
            </div>
          )}
          <Input
            label="Texto que acompanha (opcional)"
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            placeholder="Segue o catálogo…"
          />
          <Input
            label="Atalho opcional (sem /)"
            value={form.shortcut}
            onChange={(e) => setForm((f) => ({ ...f, shortcut: e.target.value.replace(/\s/g, '') }))}
            placeholder="catalogo"
          />
          <Button onClick={saveMaterial} disabled={saving}>
            {saving ? 'Salvando…' : 'Adicionar material'}
          </Button>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-medium text-stone-200">Materiais publicados</h4>
          {loading ? (
            <p className="py-4 text-center text-sm text-stone-500">Carregando…</p>
          ) : materials.length === 0 ? (
            <div className="rounded-xl border border-dashed border-brand-700/80 px-4 py-6 text-center">
              <p className="text-sm text-stone-400">Nenhum material ainda.</p>
              <p className="mt-1 text-xs text-stone-500">
                Suba o catálogo ou um link — as vendedoras usam no botão de materiais do chat.
              </p>
            </div>
          ) : (
            materials.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-brand-800 bg-brand-950/40 p-3"
              >
                <div className="flex min-w-0 items-start gap-2">
                  {item.kind === 'link' ? (
                    <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-accent-400" />
                  ) : (
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-accent-400" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-medium text-stone-100">{item.title}</p>
                    <p className="truncate text-xs text-stone-500">
                      {item.kind === 'link' ? item.url : item.mediaName || 'PDF'}
                      {item.shortcut ? ` · /${item.shortcut}` : ''}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-red-400 hover:text-red-300"
                  onClick={() => setDeleteTarget(item)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </Card>

      <ConfirmModal
        isOpen={Boolean(deleteTarget)}
        onClose={() => !deleting && setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Remover material"
        message={deleteTarget ? `Remover “${deleteTarget.title}” da loja?` : ''}
        loading={deleting}
      />
    </>
  )
}
