export const GROUP_CHAT_PREFIX = 'g:'

export function isMonitoredGroup(group) {
  return group?.status === 'ativo' && group?.monitoringEnabled
}

export function isGroupChatId(id) {
  return typeof id === 'string' && id.startsWith(GROUP_CHAT_PREFIX)
}

export function groupChatId(groupJid) {
  return `${GROUP_CHAT_PREFIX}${groupJid}`
}

export function parseGroupChatId(id) {
  if (!isGroupChatId(id)) return null
  return id.slice(GROUP_CHAT_PREFIX.length)
}

function groupJidOf(group) {
  return String(group?.id || group?.groupJid || '').trim()
}

function groupActivityMs(group) {
  const raw = group?.lastMessageAt || group?.messagesLastSyncAt || group?.activatedAt || null
  if (!raw) return 0
  const ms = new Date(raw).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/**
 * Escopo de org pode devolver o mesmo @g.us uma vez por WhatsApp membro.
 * Mantém uma entrada por JID (prefere o usuário logado; senão o mais recente).
 */
export function dedupeGroupsByJid(groups, preferredUserId = null) {
  const list = Array.isArray(groups) ? groups : []
  const byJid = new Map()
  for (const group of list) {
    const jid = groupJidOf(group)
    if (!jid) continue
    const ownerId = group.ownerUserId || group.userId || null
    const current = byJid.get(jid)
    if (!current) {
      byJid.set(jid, group)
      continue
    }
    const currentOwner = current.ownerUserId || current.userId || null
    if (preferredUserId && ownerId === preferredUserId && currentOwner !== preferredUserId) {
      byJid.set(jid, group)
      continue
    }
    if (preferredUserId && currentOwner === preferredUserId && ownerId !== preferredUserId) {
      continue
    }
    if (groupActivityMs(group) > groupActivityMs(current)) {
      byJid.set(jid, group)
    }
  }
  return [...byJid.values()]
}

export function groupToListItem(group) {
  const jid = groupJidOf(group)
  const lastMessageAt =
    group.lastMessageAt || group.messagesLastSyncAt || group.activatedAt || null
  return {
    id: groupChatId(jid),
    kind: 'group',
    groupJid: jid,
    remoteJid: jid,
    ownerUserId: group.ownerUserId || group.userId || null,
    lastMessageAt,
    lastMessagePreview: group.lastMessage || 'Grupo ativo',
    lastMessageFromMe: false,
    unreadCount: 0,
    aiEnabled: false,
    contact: {
      id: jid,
      name: group.name,
      avatarUrl: group.image,
      isGroup: true,
      memberCount: group.memberCount,
    },
  }
}

export function groupMediaKind(type) {
  const t = String(type || '').toLowerCase()
  if (t.includes('image') || t.includes('sticker')) return 'image'
  if (t.includes('video')) return 'video'
  if (t.includes('audio') || t.includes('ptt')) return 'audio'
  if (t.includes('document')) return 'document'
  return null
}

export function mapGroupMessageToChat(message) {
  return {
    id: message.id,
    fromMe: message.fromMe,
    body: message.body || '',
    type: message.type || 'text',
    mediaKind: groupMediaKind(message.type),
    mediaMime: message.mediaMime || null,
    senderName: message.sender,
    timestamp: message.timestamp,
    source: 'group',
  }
}

export function sortChatListItems(items) {
  return [...items].sort((a, b) => {
    const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
    const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
    return tb - ta
  })
}
