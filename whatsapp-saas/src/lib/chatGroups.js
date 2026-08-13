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

export function groupToListItem(group) {
  const lastMessageAt =
    group.lastMessageAt || group.messagesLastSyncAt || group.activatedAt || null
  return {
    id: groupChatId(group.id),
    kind: 'group',
    groupJid: group.id,
    remoteJid: group.id,
    ownerUserId: group.ownerUserId || group.userId || null,
    lastMessageAt,
    lastMessagePreview: group.lastMessage || 'Grupo ativo',
    lastMessageFromMe: false,
    unreadCount: 0,
    aiEnabled: false,
    contact: {
      id: group.id,
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
