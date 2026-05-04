export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex flex-wrap gap-2 border-b border-brand-800 pb-2">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            active === t.id
              ? 'bg-accent-500/15 text-accent-400 border border-accent-500/30'
              : 'text-stone-400 hover:text-stone-100 hover:bg-white/5'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
