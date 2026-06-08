import { useEffect, useMemo, useRef, useState } from 'react'
import { AtSign, Link2, X } from 'lucide-react'
import { Textarea } from './Textarea.jsx'
import { Input } from './Input.jsx'
import { Button } from './Button.jsx'
import { Toggle } from './Toggle.jsx'
import { Modal } from './Modal.jsx'
import {
  emptyMentionsJson,
  filterMembersForMention,
  mentionLabel,
  normalizeMentionsJson,
} from '../../lib/messageMentions.js'

function mentionToken(label) {
  return `@${label}`
}

export function MessageComposer({
  label,
  rows = 5,
  body = '',
  onBodyChange,
  mentionsJson,
  onMentionsChange,
  linkPreview = true,
  onLinkPreviewChange,
  members = [],
  groupIds = [],
  placeholder = 'Escreva sua mensagem...',
  className = '',
}) {
  const textareaRef = useRef(null)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)
  const [linkModal, setLinkModal] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkText, setLinkText] = useState('')

  const normalized = useMemo(() => normalizeMentionsJson(mentionsJson), [mentionsJson])

  const mentionOptions = useMemo(() => {
    const users = filterMembersForMention(members, groupIds, mentionQuery).slice(0, 12)
    const showTodos = !mentionQuery || 'todos'.includes(mentionQuery.toLowerCase())
    return { showTodos, users }
  }, [members, groupIds, mentionQuery])

  useEffect(() => {
    setMentionIndex(0)
  }, [mentionQuery, mentionOpen])

  function updateMentions(next) {
    onMentionsChange?.(normalizeMentionsJson(next))
  }

  function detectMentionTrigger(value, cursor) {
    const before = value.slice(0, cursor)
    const match = before.match(/@([\w\u00C0-\u024f.]*)$/)
    if (!match) {
      setMentionOpen(false)
      setMentionQuery('')
      return
    }
    setMentionOpen(true)
    setMentionQuery(match[1] || '')
  }

  function insertAtCursor(before, after, insertText) {
    const el = textareaRef.current
    const cursor = el?.selectionStart ?? body.length
    const nextBody = `${before}${insertText}${after}`
    onBodyChange?.(nextBody)
    requestAnimationFrame(() => {
      if (!el) return
      const pos = before.length + insertText.length
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  function applyMention(option) {
    const el = textareaRef.current
    const cursor = el?.selectionStart ?? body.length
    const before = body.slice(0, cursor)
    const after = body.slice(cursor)
    const atMatch = before.match(/@([\w\u00C0-\u024f.]*)$/)
    const prefix = atMatch ? before.slice(0, before.length - atMatch[0].length) : before

    if (option.type === 'all') {
      const token = mentionToken('todos')
      insertAtCursor(prefix, after, `${token} `)
      updateMentions({
        mentionAll: true,
        mentions: [...normalized.mentions.filter((m) => m.type !== 'all'), { type: 'all', label: 'todos' }],
      })
    } else {
      const label = mentionLabel(option)
      const token = mentionToken(label)
      insertAtCursor(prefix, after, `${token} `)
      const entry = {
        type: 'user',
        label,
        participantJid: option.id,
        phone: String(option.phone || '').replace(/\D/g, '') || undefined,
      }
      const exists = normalized.mentions.some((m) => m.type === 'user' && m.participantJid === entry.participantJid)
      updateMentions({
        mentionAll: normalized.mentionAll,
        mentions: exists ? normalized.mentions : [...normalized.mentions, entry],
      })
    }
    setMentionOpen(false)
    setMentionQuery('')
  }

  function removeMention(entry) {
    if (entry.type === 'all') {
      updateMentions({
        mentionAll: false,
        mentions: normalized.mentions.filter((m) => m.type !== 'all'),
      })
      if (body.includes('@todos')) onBodyChange?.(body.replace(/@todos/g, '').replace(/\s{2,}/g, ' ').trim())
      return
    }
    updateMentions({
      mentionAll: normalized.mentionAll,
      mentions: normalized.mentions.filter((m) => m.participantJid !== entry.participantJid),
    })
    const token = mentionToken(entry.label)
    if (body.includes(token)) onBodyChange?.(body.replace(new RegExp(`${token}\\s?`, 'g'), ''))
  }

  function onTextChange(e) {
    const value = e.target.value
    onBodyChange?.(value)
    detectMentionTrigger(value, e.target.selectionStart)
  }

  function onKeyDown(e) {
    if (!mentionOpen) return
    const total = (mentionOptions.showTodos ? 1 : 0) + mentionOptions.users.length
    if (!total) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setMentionIndex((i) => (i + 1) % total)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setMentionIndex((i) => (i - 1 + total) % total)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      let idx = mentionIndex
      if (mentionOptions.showTodos) {
        if (idx === 0) return applyMention({ type: 'all' })
        idx -= 1
      }
      const user = mentionOptions.users[idx]
      if (user) applyMention(user)
    } else if (e.key === 'Escape') {
      setMentionOpen(false)
    }
  }

  function openLinkModal() {
    setLinkUrl('')
    setLinkText('')
    setLinkModal(true)
  }

  function insertLink() {
    const url = linkUrl.trim()
    if (!url) return
    const normalizedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`
    const insertText = linkText.trim() ? `${linkText.trim()} ${normalizedUrl}` : normalizedUrl
    const el = textareaRef.current
    const cursor = el?.selectionStart ?? body.length
    const before = body.slice(0, cursor)
    const after = body.slice(cursor)
    const spacer = before && !before.endsWith(' ') ? ' ' : ''
    insertAtCursor(before, after, `${spacer}${insertText}`)
    setLinkModal(false)
  }

  const flatOptions = []
  if (mentionOptions.showTodos) flatOptions.push({ type: 'all', label: 'todos' })
  for (const u of mentionOptions.users) flatOptions.push({ type: 'user', ...u })

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="relative">
        <Textarea
          ref={textareaRef}
          label={label}
          rows={rows}
          value={body}
          onChange={onTextChange}
          onKeyDown={onKeyDown}
          onClick={(e) => detectMentionTrigger(body, e.target.selectionStart)}
          placeholder={placeholder}
        />
        {mentionOpen && flatOptions.length > 0 && (
          <ul
            role="listbox"
            className="absolute z-[120] mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-brand-700 bg-black py-1 shadow-2xl"
          >
            {flatOptions.map((opt, idx) => (
              <li key={opt.type === 'all' ? '__all__' : opt.id} role="option" aria-selected={idx === mentionIndex}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition ${
                    idx === mentionIndex ? 'bg-accent-500/15 text-accent-300' : 'text-white hover:bg-white/10'
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    applyMention(opt)
                  }}
                >
                  <AtSign className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  {opt.type === 'all' ? (
                    <span>
                      <strong>todos</strong>
                      <span className="ml-2 text-xs text-stone-500">mencionar o grupo inteiro</span>
                    </span>
                  ) : (
                    <span className="truncate">
                      {opt.name}
                      <span className="ml-2 text-xs text-stone-500">{opt.phone}</span>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => applyMention({ type: 'all' })}>
          <AtSign className="h-4 w-4" /> @todos
        </Button>
        <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={openLinkModal}>
          <Link2 className="h-4 w-4" /> Inserir link
        </Button>
        {onLinkPreviewChange && (
          <div className="ml-auto">
            <Toggle checked={linkPreview !== false} onChange={onLinkPreviewChange} label="Prévia de link" />
          </div>
        )}
      </div>

      {(normalized.mentionAll || normalized.mentions.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {normalized.mentionAll && (
            <span className="inline-flex items-center gap-1 rounded-full border border-accent-500/30 bg-accent-500/10 px-2.5 py-1 text-xs text-accent-200">
              @todos
              <button type="button" className="rounded p-0.5 hover:bg-white/10" onClick={() => removeMention({ type: 'all' })} aria-label="Remover @todos">
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {normalized.mentions
            .filter((m) => m.type === 'user')
            .map((m) => (
              <span
                key={m.participantJid || m.label}
                className="inline-flex items-center gap-1 rounded-full border border-brand-700 bg-brand-900/60 px-2.5 py-1 text-xs text-stone-200"
              >
                @{m.label}
                <button
                  type="button"
                  className="rounded p-0.5 hover:bg-white/10"
                  onClick={() => removeMention(m)}
                  aria-label={`Remover @${m.label}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
        </div>
      )}

      <Modal
        isOpen={linkModal}
        onClose={() => setLinkModal(false)}
        title="Inserir link"
        footer={
          <>
            <Button variant="ghost" onClick={() => setLinkModal(false)}>Cancelar</Button>
            <Button onClick={insertLink}>Inserir</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input label="URL" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://exemplo.com" />
          <Input
            label="Texto (opcional)"
            value={linkText}
            onChange={(e) => setLinkText(e.target.value)}
            placeholder="Ex: Clique aqui"
          />
        </div>
      </Modal>
    </div>
  )
}
