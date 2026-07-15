import { Search, Users } from 'lucide-react'
import { Select } from '../common/Select.jsx'

function FilterChip({ active, onClick, children, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${className} ${
        active
          ? 'border-accent-500/45 bg-accent-500/15 text-accent-200'
          : 'border-brand-700/80 bg-brand-950/50 text-stone-400 hover:border-brand-600 hover:text-stone-200'
      }`}
    >
      {children}
    </button>
  )
}

export function ChatConversationFilters({
  query,
  onQueryChange,
  tagFilter,
  onTagFilterChange,
  stageFilter,
  onStageFilterChange,
  sellerFilter,
  onSellerFilterChange,
  members = [],
  showSellerFilter = false,
  tags,
  stages,
  groupsOnly,
  onToggleGroupsOnly,
  unidentifiedOnly,
  onToggleUnidentifiedOnly,
  unidentifiedCount,
  monitoredGroupCount,
}) {
  return (
    <div className="shrink-0 space-y-2.5 border-b border-brand-800/80 bg-brand-950/20 p-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Buscar conversa…"
          className="w-full rounded-xl border border-brand-700/80 bg-brand-900/50 py-2.5 pl-9 pr-3 text-sm text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/20"
        />
      </div>

      {showSellerFilter ? (
        <Select
          className="min-w-0 w-full"
          value={sellerFilter || ''}
          onChange={(e) => onSellerFilterChange?.(e.target.value)}
          aria-label="Filtrar por membro da empresa"
          menuClassName="max-h-56"
        >
          <option value="">Todos os membros</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name || m.email}
              {m.role === 'OWNER' ? ' (dono)' : ''}
            </option>
          ))}
        </Select>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Select
          className="min-w-0"
          value={tagFilter}
          onChange={(e) => onTagFilterChange(e.target.value)}
          menuClassName="max-h-56"
        >
          <option value="">Todas as tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Select
          className="min-w-0"
          value={stageFilter}
          onChange={(e) => onStageFilterChange(e.target.value)}
          menuClassName="max-h-56"
        >
          <option value="">Todos os estágios</option>
          <option value="none">Sem estágio</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex gap-2 overflow-x-auto vg-scrollbar pb-0.5">
        <FilterChip
          active={groupsOnly}
          onClick={onToggleGroupsOnly}
          className={groupsOnly ? 'border-sky-500/40 bg-sky-500/15 text-sky-100' : ''}
        >
          <Users className="h-3.5 w-3.5" />
          Grupos{monitoredGroupCount > 0 ? ` (${monitoredGroupCount})` : ''}
        </FilterChip>
        {unidentifiedCount > 0 && (
          <FilterChip
            active={unidentifiedOnly}
            onClick={onToggleUnidentifiedOnly}
            className={
              unidentifiedOnly ? 'border-amber-500/40 bg-amber-500/15 text-amber-100' : ''
            }
          >
            Sem identificação ({unidentifiedCount})
          </FilterChip>
        )}
      </div>
    </div>
  )
}
