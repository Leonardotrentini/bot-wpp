import { useCallback, useRef } from 'react'
import { highlightMentionsInText } from '../../lib/messageMentions.js'

function editorPartClass(type) {
  if (type === 'mention-user') return 'mention-editor-user'
  if (type === 'link') return 'mention-editor-link'
  return ''
}

function EditorHighlightLayer({ text, mentionsJson }) {
  const parts = highlightMentionsInText(text || '', mentionsJson)
  return (
    <>
      {parts.map((part, i) => {
        const cls = editorPartClass(part.type)
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
    if (ta && bd) {
      bd.scrollTop = ta.scrollTop
      bd.scrollLeft = ta.scrollLeft
    }
  }, [textareaRef])

  const fieldClass =
    'mention-editor-field w-full resize-y rounded-xl border bg-transparent px-4 py-2.5 outline-none transition focus:ring-2'

  return (
    <label className="block w-full">
      {label && <span className="mb-1.5 block text-sm font-medium text-stone-300">{label}</span>}
      <div className="relative">
        <div
          className={`relative overflow-hidden rounded-xl border bg-brand-900/50 transition ${
            highlightRing
              ? 'border-sky-500/35 ring-2 ring-sky-500/15'
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
              <EditorHighlightLayer text={value} mentionsJson={mentionsJson} />
            ) : (
              <span className="text-stone-500">{placeholder}</span>
            )}
          </div>
          <textarea
            ref={textareaRef}
            rows={rows}
            value={value}
            onChange={(e) => {
              onChange?.(e)
              requestAnimationFrame(syncScroll)
            }}
            onKeyDown={onKeyDown}
            onClick={(e) => {
              onClick?.(e)
              syncScroll()
            }}
            onKeyUp={syncScroll}
            onSelect={syncScroll}
            onScroll={syncScroll}
            placeholder=""
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            className={`${fieldClass} relative text-transparent caret-stone-100 selection:bg-sky-500/30 selection:text-transparent`}
          />
        </div>
        {children}
      </div>
      <p className="mt-1.5 text-[11px] text-stone-500">Digite @ para mencionar · máximo 2 pessoas por mensagem</p>
    </label>
  )
}
