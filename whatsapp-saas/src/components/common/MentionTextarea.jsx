import { useCallback, useRef } from 'react'
import { highlightMentionsInText, mentionPartClass } from '../../lib/messageMentions.js'

function HighlightLayer({ text, mentionsJson }) {
  const parts = highlightMentionsInText(text || '', mentionsJson)
  return (
    <>
      {parts.map((part, i) => {
        const cls = mentionPartClass(part.type)
        if (cls) {
          return (
            <span key={i} className={cls}>
              {part.value}
            </span>
          )
        }
        return <span key={i}>{part.value}</span>
      })}
    </>
  )
}

export function MentionTextarea({
  label,
  rows = 5,
  value = '',
  onChange,
  onKeyDown,
  onClick,
  placeholder,
  mentionsJson,
  highlightRing = false,
  textareaRef: externalRef,
  children,
}) {
  const internalRef = useRef(null)
  const backdropRef = useRef(null)
  const textareaRef = externalRef || internalRef

  const syncScroll = useCallback(() => {
    const ta = textareaRef.current
    const bd = backdropRef.current
    if (ta && bd) bd.scrollTop = ta.scrollTop
  }, [textareaRef])

  const fieldClass =
    'w-full resize-y rounded-xl border bg-transparent px-4 py-2.5 text-sm leading-relaxed outline-none transition focus:ring-2'

  return (
    <label className="block w-full">
      {label && <span className="mb-1.5 block text-sm font-medium text-stone-300">{label}</span>}
      <div className="relative">
        <div
          className={`relative overflow-hidden rounded-xl border bg-brand-900/50 transition ${
            highlightRing
              ? 'border-amber-500/35 ring-2 ring-amber-500/15'
              : 'border-brand-700 focus-within:border-sky-500/40 focus-within:ring-2 focus-within:ring-sky-500/15'
          }`}
        >
          <div
            ref={backdropRef}
            aria-hidden
            className={`${fieldClass} pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words border-transparent text-stone-100 ring-0 focus:ring-0`}
            style={{ minHeight: `${rows * 1.625}rem` }}
          >
            {value ? (
              <HighlightLayer text={value} mentionsJson={mentionsJson} />
            ) : (
              <span className="text-stone-500">{placeholder}</span>
            )}
          </div>
          <textarea
            ref={textareaRef}
            rows={rows}
            value={value}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onClick={onClick}
            onScroll={syncScroll}
            placeholder=""
            spellCheck={false}
            className={`${fieldClass} relative text-transparent caret-stone-100 placeholder:text-transparent`}
            style={{ WebkitTextFillColor: 'transparent' }}
          />
        </div>
        {children}
      </div>
      <p className="mt-1.5 text-[11px] text-stone-500">Digite @ para mencionar · @todos notifica o grupo inteiro</p>
    </label>
  )
}
