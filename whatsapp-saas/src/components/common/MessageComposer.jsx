import { useEffect, useMemo, useRef, useState } from 'react'
import { AtSign, Link2, Users, User, Shield, X } from 'lucide-react'
import { MentionTextarea } from './MentionTextarea.jsx'
import { Input } from './Input.jsx'
import { Button } from './Button.jsx'
import { Toggle } from './Toggle.jsx'
import { Modal } from './Modal.jsx'
import {
  filterMembersForMention,
  MAX_MENTIONS,
  MENTION_ALL_LABEL,
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

const MENTION_ALL_OPTION = { id: '__mention_all__', kind: 'all' }

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
  const [mentionLimitHint, setMentionLimitHint] = useState(false)
  const [adminsOnly, setAdminsOnly] = useState(false)
  const [linkModal, setLinkModal] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkText, setLinkText] = useState('')

  const normalized = useMemo(() => normalizeMentionsJson(mentionsJson), [mentionsJson])
  const mentionCount = normalized.mentions.length
  const mentionAll = normalized.mentionAll === true
  const atMentionLimit = !mentionAll && mentionCount >= MAX_MENTIONS

  const memberOptions = useMemo(
    () => filterMembersForMention(members, groupIds, mentionQuery, { adminsOnly }).slice(0, 12),
    [members, groupIds, mentionQuery, adminsOnly],
  )

  const showMentionAllOption = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase()
    if (!q) return true
    return 'todos'.includes(q) || 'all'.includes(q) || '@todos'.includes(q) || '@all'.includes(q)
  }, [mentionQuery])

  const pickerRows = useMemo(() => {
    const rows = []
    if (showMentionAllOption) rows.push(MENTION_ALL_OPTION)
    if (!mentionAll) {
      for (const m of memberOptions) rows.push({ ...m, kind: 'user' })
    }
    return rows
  }, [showMentionAllOption, memberOptions, mentionAll])

  useEffect(() => {
    setMentionIndex(0)
  }, [mentionQuery, mentionOpen, adminsOnly])

  useEffect(() => {
    if (!mentionLimitHint) return undefined
    const t = setTimeout(() => setMentionLimitHint(false), 3000)
    return () => clearTimeout(t)
  }, [mentionLimitHint])

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

  function replaceAtTrigger(insertText) {
    const el = textareaRef.current
    const cursor = el?.selectionStart ?? body.length
    const before = body.slice(0, cursor)
    const after = body.slice(cursor)
    const atMatch = before.match(/@([\w\u00C0-\u024f.]*)$/)
    const prefix = atMatch ? before.slice(0, before.length - atMatch[0].length) : before
    insertAtCursor(prefix, after, insertText)
  }

  function applyMentionAll() {
    replaceAtTrigger(`${mentionToken(MENTION_ALL_LABEL)} `)
    updateMentions({ mentionAll: true, mentions: [] })
    setMentionOpen(false)
    setMentionQuery('')
  }

  function clearMentionAll() {
    updateMentions({ mentionAll: false, mentions: [] })
    const token = mentionToken(MENTION_ALL_LABEL)
    const allToken = mentionToken('all')
    let next = body
    if (next.includes(token)) next = next.replace(new RegExp(`${token}\\s?`, 'gi'), '')
    if (next.includes(allToken)) next = next.replace(new RegExp(`${allToken}\\s?`, 'gi'), '')
    if (next !== body) onBodyChange?.(next)
  }

  function applyMention(option) {
    if (option?.kind === 'all' || option?.id === MENTION_ALL_OPTION.id) {
      applyMentionAll()
      return
    }

    const exists = normalized.mentions.some((m) => m.participantJid === option.id)
    if (!exists && atMentionLimit) {
      setMentionLimitHint(true)
      setMentionOpen(false)
      return
    }

    const el = textareaRef.current
    let workingBody = body
    if (mentionAll) {
      const todos = mentionToken(MENTION_ALL_LABEL)
      const allTok = mentionToken('all')
      workingBody = workingBody
        .replace(new RegExp(`${todos}\\s?`, 'gi'), '')
        .replace(new RegExp(`${allTok}\\s?`, 'gi'), '')
    }

    const cursor = Math.min(el?.selectionStart ?? workingBody.length, workingBody.length)
    const before = workingBody.slice(0, cursor)
    const after = workingBody.slice(cursor)
    const atMatch = before.match(/@([\w\u00C0-\u024f.]*)$/)
    const prefix = atMatch ? before.slice(0, before.length - atMatch[0].length) : before

    const lbl = mentionLabel(option)
    const token = `${mentionToken(lbl)} `
    const nextBody = `${prefix}${token}${after}`
    onBodyChange?.(nextBody)
    requestAnimationFrame(() => {
      if (!el) return
      const pos = prefix.length + token.length
      el.focus()
      el.setSelectionRange(pos, pos)
    })

    const entry = {
      type: 'user',
      label: lbl,
      participantJid: option.id,
      phone: String(option.phoneDigits || option.phone || '').replace(/\D/g, '') || undefined,
    }
    updateMentions({
      mentionAll: false,
      mentions: exists ? normalized.mentions : [...normalized.mentions, entry],
    })
    setMentionOpen(false)
    setMentionQuery('')
  }

  function removeMention(entry) {
    updateMentions({
      mentionAll: false,
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
    if (!pickerRows.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setMentionIndex((i) => (i + 1) % pickerRows.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setMentionIndex((i) => (i - 1 + pickerRows.length) % pickerRows.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const row = pickerRows[mentionIndex]
      if (row) applyMention(row)
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

  const showEmptyMembers =
    !mentionAll && groupIds.length > 0 && memberOptions.length === 0 && !mentionQuery

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
        highlightRing={mentionCount > 0 || mentionAll}
        textareaRef={textareaRef}
      >
        {mentionOpen && (
          <div className="mention-dropdown">
            <div className="border-b border-brand-800/80 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-stone-300">Mencionar</p>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setAdminsOnly((v) => !v)
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
                    adminsOnly
                      ? 'border-amber-400/50 bg-amber-500/20 text-amber-100 shadow-sm shadow-amber-500/10'
                      : 'border-brand-600 bg-brand-800/80 text-stone-100 hover:border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-100'
                  }`}
                >
                  <Shield className={`h-3.5 w-3.5 ${adminsOnly ? 'text-amber-300' : 'text-amber-400/90'}`} />
                  {adminsOnly ? 'Só admins' : 'Filtrar admins'}
                </button>
              </div>
              <p className="text-[10px] text-stone-500">
                ↑↓ navegar · Enter selecionar · @todos = grupo inteiro · máx. {MAX_MENTIONS} pessoas
              </p>
            </div>
            <ul role="listbox" className="max-h-56 overflow-y-auto py-1">
              {pickerRows.map((row, idx) => {
                const active = idx === mentionIndex
                if (row.kind === 'all') {
                  return (
                    <li key={row.id} role="option" aria-selected={active}>
                      <button
                        type="button"
                        className={`mention-dropdown-item ${active ? 'mention-dropdown-item--active' : 'hover:bg-white/5'} ${
                          mentionAll ? 'bg-emerald-500/10' : ''
                        }`}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          applyMentionAll()
                        }}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
                          <Users className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 truncate">
                          <span className="block truncate text-stone-100">@todos · Todo o grupo</span>
                          <span className="block truncate text-xs text-stone-500">
                            Marca todos os participantes no envio
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                }

                const alreadyMentioned = normalized.mentions.some((m) => m.participantJid === row.id)
                const disabled = atMentionLimit && !alreadyMentioned
                const isAdmin = row.role === 'admin' || row.role === 'superadmin' || (row.tags || []).includes('admin')
                return (
                  <li key={row.id} role="option" aria-selected={active}>
                    <button
                      type="button"
                      disabled={disabled}
                      className={`mention-dropdown-item ${active ? 'mention-dropdown-item--active' : 'hover:bg-white/5'} ${
                        disabled ? 'cursor-not-allowed opacity-40' : ''
                      }`}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        if (!disabled) applyMention(row)
                      }}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-xs font-semibold text-sky-200">
                        {memberInitials(row.name)}
                      </span>
                      <span className="min-w-0 truncate">
                        <span className="flex items-center gap-1.5 truncate text-stone-100">
                          <span className="truncate">{row.name}</span>
                          {isAdmin && (
                            <span className="shrink-0 rounded bg-amber-500/15 px-1 py-px text-[9px] font-medium uppercase text-amber-200">
                              admin
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-stone-500">
                          {row.phoneDigits || row.phone}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}

              {atMentionLimit && !mentionAll && (
                <li className="px-4 py-2 text-xs text-amber-300/90">
                  Limite de {MAX_MENTIONS} menções atingido. Remova uma ou use @todos.
                </li>
              )}
              {pickerRows.length === 0 && (
                <li className="px-4 py-3 text-xs text-stone-500">
                  {showEmptyMembers
                    ? adminsOnly
                      ? 'Nenhum admin nos grupos selecionados.'
                      : 'Nenhum membro nos grupos selecionados. Sincronize em Membros.'
                    : adminsOnly
                      ? 'Nenhum admin encontrado para esta busca.'
                      : 'Nenhum resultado para esta busca.'}
                </li>
              )}
            </ul>
          </div>
        )}
      </MentionTextarea>

      {mentionLimitHint && (
        <p className="text-xs text-amber-300/90">
          Você pode mencionar no máximo {MAX_MENTIONS} pessoas — ou use @todos para o grupo inteiro.
        </p>
      )}

      {(mentionAll || normalized.mentions.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-stone-500">
            {mentionAll ? 'Menção' : `Menções (${mentionCount}/${MAX_MENTIONS})`}
          </span>
          {mentionAll && (
            <span className="mention-chip-user inline-flex items-center gap-1 bg-emerald-500/15 text-emerald-200">
              <Users className="h-3 w-3 shrink-0" aria-hidden />
              @todos
              <button
                type="button"
                className="rounded p-0.5 hover:bg-emerald-500/20"
                onClick={clearMentionAll}
                aria-label="Remover @todos"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {normalized.mentions.map((m) => (
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
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mention-btn gap-1.5"
          onClick={openMentionPicker}
        >
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
