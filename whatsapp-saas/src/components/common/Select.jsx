import { Children, useMemo } from 'react'
import { DarkDropdown } from './DarkDropdown.jsx'

function optionsFromChildren(children) {
  return Children.toArray(children)
    .filter((child) => child != null && typeof child === 'object' && child.props != null)
    .map((child) => ({
      value: child.props.value ?? '',
      label: String(child.props.children ?? ''),
      disabled: !!child.props.disabled,
    }))
}

export function Select({ label, error, children, className = '', value, onChange, disabled, id, ...rest }) {
  const options = useMemo(() => optionsFromChildren(children), [children])
  const placeholder = options.find((o) => o.value === '')?.label || 'Selecionar…'

  return (
    <div className={`block w-full ${className}`}>
      {label && (
        <span id={id ? `${id}-label` : undefined} className="mb-1.5 block text-sm font-medium text-stone-300">
          {label}
        </span>
      )}
      <DarkDropdown
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        ariaLabel={label || rest['aria-label']}
        triggerClassName={error ? 'border-red-500/60' : ''}
      />
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  )
}
