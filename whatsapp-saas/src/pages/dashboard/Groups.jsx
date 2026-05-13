import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Settings2 } from 'lucide-react'
import { Card } from '../../components/common/Card.jsx'
import { Button } from '../../components/common/Button.jsx'
import { Badge } from '../../components/common/Badge.jsx'
import { Input } from '../../components/common/Input.jsx'
import { Skeleton } from '../../components/common/Skeleton.jsx'
import { getGroups } from '../../services/api.js'
import { useToast } from '../../contexts/ToastContext.jsx'

export function Groups() {
  const toast = useToast()
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('todos')
  const [q, setQ] = useState('')

  async function load() {
    setLoading(true)
    try {
      const { data } = await getGroups()
      setGroups(data.groups)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    return groups.filter((g) => {
      if (filter === 'ativos' && g.status !== 'ativo') return false
      if (filter === 'inativos' && g.status !== 'inativo') return false
      if (q && !g.name.toLowerCase().includes(q.toLowerCase())) return false
      return true
    })
  }, [groups, filter, q])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-stone-50">Seus grupos</h2>
          <p className="text-sm text-stone-400 mt-1">Gerencie comunidades e acompanhe a última atividade.</p>
        </div>
        <Button
          variant="secondary"
          className="gap-2 shrink-0"
          onClick={() => {
            load()
            toast.info('Lista atualizada.')
          }}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar lista
        </Button>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex gap-2">
          {[
            { id: 'todos', label: 'Todos' },
            { id: 'ativos', label: 'Ativos' },
            { id: 'inativos', label: 'Inativos' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                filter === f.id ? 'bg-accent-500/15 text-accent-400 border border-accent-500/30' : 'text-stone-400 border border-transparent hover:bg-white/5'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1 max-w-md">
          <Input placeholder="Buscar por nome..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((g) => (
            <Card key={g.id}>
              <div className="flex gap-4">
                <img src={g.image} alt="" className="h-14 w-14 shrink-0 rounded-xl border border-brand-700 bg-brand-800" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-stone-50 truncate">{g.name}</h3>
                    <Badge variant={g.status === 'ativo' ? 'success' : 'muted'}>{g.status}</Badge>
                  </div>
                  <p className="text-xs text-stone-500 mt-1">{g.memberCount} membros</p>
                  <p className="text-sm text-stone-400 mt-2 line-clamp-2">&ldquo;{g.lastMessage}&rdquo;</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link to={`/dashboard/groups/${encodeURIComponent(g.id)}`}>
                      <Button size="sm" variant="secondary">
                        Ver detalhes
                      </Button>
                    </Link>
                    <Link to={`/dashboard/groups/${encodeURIComponent(g.id)}?tab=config`}>
                      <Button size="sm" variant="ghost" className="gap-1 border border-brand-700">
                        <Settings2 className="h-3.5 w-3.5" /> Configurar
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
