import { useEffect, useMemo, useRef, useState } from 'react'
import { AtSign, Link2, Megaphone, User, Users, X } from 'lucide-react'
import { MentionTextarea } from './MentionTextarea.jsx'
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

function memberInitials(name) {
  const parts = String(name || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
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
      const lbl = mentionLabel(option)
      const token = mentionToken(lbl)
      insertAtCursor(prefix, after, `${token} `)
      const entry = {
        type: 'user',
        label: lbl,
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

  function syncMentionsFromText(value) {
    const hasTodos = /\B@todos\b/i.test(value)
    const next = normalizeMentionsJson(mentionsJson)
    if (hasTodos && !next.mentionAll) {
      updateMentions({
        mentionAll: true,
        mentions: [...next.mentions.filter((m) => m.type !== 'all'), { type: 'all', label: 'todos' }],
      })
      return
    }
    if (!hasTodos && next.mentionAll) {
      updateMentions({
        mentionAll: false,
        mentions: next.mentions.filter((m) => m.type !== 'all'),
      })
    }
  }

  function onTextChange(e) {
    const value = e.target.value
    onBodyChange?.(value)
    syncMentionsFromText(value)
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

  function openMentionPicker() {
    textareaRef.current?.focus()
    setMentionOpen(true)
    setMentionQuery('')
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

  const showEmptyMembers =
    groupIds.length > 0 && mentionOptions.users.length === 0 && !mentionQuery && !mentionOptions.showTodos

  return (
    <div className={`space-y-3 ${className}`}>
      <MentionTextarea
        label={label}
        rows={rows}
        value={body}
        onChange={onTextChange}
        onKeyDown={onKeyDown}
        onClick={(e) => detectMentionTrigger(body, e.target.selectionStart)}
        placeholder={placeholder}
        mentionsJson={mentionsJson}
        highlightRing={normalized.mentionAll}
        textareaRef={textareaRef}
      >
        {mentionOpen && (
          <div className="mention-dropdown">
            <div className="border-b border-brand-800/80 px-3 py-2">
              <p className="text-xs font-medium text-stone-300">Mencionar</p>
              <p className="text-[10px] text-stone-500">↑↓ navegar · Enter selecionar · Esc fechar</p>
            </div>
            <ul role="listbox" className="max-h-48 overflow-y-auto py-1">
              {flatOptions.length === 0 && (
                <li className="px-4 py-3 text-xs text-stone-500">
                  {showEmptyMembers
                    ? 'Nenhum membro nos grupos selecionados. Sincronize em Membros.'
                    : 'Nenhum resultado para esta busca.'}
                </li>
              )}
              {flatOptions.map((opt, idx) => {
                const active = idx === mentionIndex
                const isAll = opt.type === 'all'
                return (
                  <li key={isAll ? '__all__' : opt.id} role="option" aria-selected={active}>
                    <button
                      type="button"
                      className={`mention-dropdown-item ${isAll ? 'mention-dropdown-item--all' : ''} ${
                        active ? 'mention-dropdown-item--active' : 'hover:bg-white/5'
                      } ${isAll && active ? 'mention-dropdown-item--all mention-dropdown-item--active' : ''}`}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        applyMention(opt)
                      }}
                    >
                      {isAll ? (
                        <>
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-300">
                            <Megaphone className="h-4 w-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block font-semibold text-amber-200">@todos</span>
                            <span className="block text-xs text-amber-200/60">Notifica todo o grupo</span>
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-xs font-semibold text-sky-200">
                            {memberInitials(opt.name)}
                          </span>
                          <span className="min-w-0 truncate">
                            <span className="block truncate text-stone-100">{opt.name}</span>
                            <span className="block truncate text-xs text-stone-500">{opt.phone}</span>
                          </span>
                        </>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </MentionTextarea>

      {(normalized.mentionAll || normalized.mentions.some((m) => m.type === 'user')) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-stone-500">Menções</span>
          {normalized.mentionAll && (
            <span className="mention-chip-all">
              <Users className="h-3 w-3 shrink-0" aria-hidden />
              @todos
              <button
                type="button"
                className="rounded p-0.5 hover:bg-amber-500/20"
                onClick={() => removeMention({ type: 'all' })}
                aria-label="Remover @todos"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {normalized.mentions
            .filter((m) => m.type === 'user')
            .map((m) => (
              <span key={m.participantJid || m.label} className="mention-chip-user">
                <User className="h-3 w-3 shrink-0" aria-hidden />
                @{m.label}
                <button
                  type="button"
                  className="rounded p-0.5 hover:bg-sky-500/20"
                  onClick={() => removeMention(m)}
                  aria-label={`Remover @${m.label}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" className="mention-btn gap-1.5" onClick={openMentionPicker}>
          <AtSign className="h-4 w-4" /> Mencionar
        </Button>
        <span className="hidden h-5 w-px bg-brand-700 sm:inline" aria-hidden />
        <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={openLinkModal}>
          <Link2 className="h-4 w-4" /> Inserir link
        </Button>
        {onLinkPreviewChange && (
          <div className="ml-auto">
            <Toggle checked={linkPreview !== false} onChange={onLinkPreviewChange} label="Prévia de link" />
          </div>
        )}
      </div>

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
