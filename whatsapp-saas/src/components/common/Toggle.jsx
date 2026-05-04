export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <label className={`flex cursor-pointer items-center gap-3 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange?.(!checked)}
        className={`relative h-7 w-12 rounded-full transition-colors ${checked ? 'bg-accent-500' : 'bg-brand-700'}`}
      >
        <span
          className={`absolute top-1 left-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`}
        />
      </button>
      {label && <span className="text-sm text-stone-300">{label}</span>}
    </label>
  )
}
