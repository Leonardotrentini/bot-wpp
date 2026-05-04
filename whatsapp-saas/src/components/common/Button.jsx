const variants = {
  primary: 'bg-accent-500 text-brand-950 font-semibold hover:bg-accent-400 shadow-lg shadow-accent-500/20',
  secondary: 'bg-brand-700 text-stone-100 hover:bg-brand-600 border border-brand-600',
  ghost: 'bg-transparent text-stone-200 hover:bg-white/5 border border-transparent',
  danger: 'bg-red-600/90 text-white hover:bg-red-600 border border-red-500/40',
  outline: 'bg-transparent border border-brand-600 text-stone-200 hover:border-accent-500/50 hover:text-accent-400',
}

export function Button({
  children,
  variant = 'primary',
  className = '',
  size = 'md',
  disabled,
  type = 'button',
  ...props
}) {
  const sizes = {
    sm: 'px-3 py-1.5 text-sm rounded-lg',
    md: 'px-4 py-2.5 text-sm rounded-xl',
    lg: 'px-6 py-3 text-base rounded-xl',
  }
  return (
    <button
      type={type}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
