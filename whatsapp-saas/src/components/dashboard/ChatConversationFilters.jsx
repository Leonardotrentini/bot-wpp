import { useState } from 'react'
import { Search, Users, SlidersHorizontal, X } from 'lucide-react'
import { Select } from '../common/Select.jsx'
import { Button } from '../common/Button.jsx'

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

function FiltersBody({
  tagFilter,
  onTagFilterChange,
  stageFilter,
  onStageFilterChange,
  sellerFilter,
  onSellerFilterChange,
  members,
  showSellerFilter,
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
    <div className="space-y-3">
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

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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

      <div className="flex flex-wrap gap-2">
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
            className={unidentifiedOnly ? 'border-amber-500/40 bg-amber-500/15 text-amber-100' : ''}
          >
            Sem telefone / LID ({unidentifiedCount})
          </FilterChip>
        )}
      </div>
    </div>
  )
}

/**
 * @param {boolean} [compact] — mobile: só busca + botão Filtros (sheet). Desktop: layout completo.
 * @param {React.ReactNode} [trailing] — ações extras no mobile (⋯, etc.)
 */
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
  compact = false,
  trailing = null,
}) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const activeFilterCount = [
    tagFilter,
    stageFilter,
    sellerFilter,
    groupsOnly,
    unidentifiedOnly,
  ].filter(Boolean).length

  const bodyProps = {
    tagFilter,
    onTagFilterChange,
    stageFilter,
    onStageFilterChange,
    sellerFilter,
    onSellerFilterChange,
    members,
    showSellerFilter,
    tags,
    stages,
    groupsOnly,
    onToggleGroupsOnly,
    unidentifiedOnly,
    onToggleUnidentifiedOnly,
    unidentifiedCount,
    monitoredGroupCount,
  }

  if (compact) {
    return (
      <>
        <div className="shrink-0 border-b border-brand-800/80 bg-brand-950/40 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
              <input
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                placeholder="Buscar"
                className="w-full rounded-full border border-brand-700/80 bg-brand-900/70 py-2.5 pl-9 pr-3 text-sm text-stone-100 placeholder:text-stone-500 outline-none focus:border-accent-500/50"
              />
            </div>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition ${
                activeFilterCount
                  ? 'border-accent-500/50 bg-accent-500/15 text-accent-300'
                  : 'border-brand-700 bg-brand-900/70 text-stone-400'
              }`}
              aria-label="Filtros"
            >
              <SlidersHorizontal className="h-5 w-5" />
              {activeFilterCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-brand-950">
                  {activeFilterCount}
                </span>
              ) : null}
            </button>
            {trailing}
          </div>
        </div>

        {sheetOpen ? (
          <div className="fixed inset-0 z-[90] lg:hidden" role="dialog" aria-modal="true">
            <button
              type="button"
              className="absolute inset-0 bg-black/55"
              aria-label="Fechar filtros"
              onClick={() => setSheetOpen(false)}
            />
            <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border border-brand-700/80 bg-brand-900 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl">
              <div className="flex items-center justify-between px-4 pt-3 pb-2">
                <p className="text-sm font-semibold text-stone-100">Filtros</p>
                <button
                  type="button"
                  onClick={() => setSheetOpen(false)}
                  className="rounded-lg p-2 text-stone-400 hover:bg-white/5"
                  aria-label="Fechar"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="px-4 pb-3">
                <FiltersBody {...bodyProps} />
              </div>
              <div className="px-4">
                <Button type="button" className="w-full" onClick={() => setSheetOpen(false)}>
                  Ver conversas
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </>
    )
  }

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
      <FiltersBody {...bodyProps} />
    </div>
  )
}
