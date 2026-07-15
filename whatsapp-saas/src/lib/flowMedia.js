import { revokeMediaPreviewUrl } from '../components/common/MediaPreview.jsx'
import {
  QUICK_REPLY_FILE_ACCEPT,
  QUICK_REPLY_MEDIA_LABELS,
  attachQuickReplyMediaFromFile,
  emptyQuickReplyMedia,
} from './quickReplyMedia.js'
import { buildNoReplyTriggerPatch, getNoReplyDelayUi } from './flowNoReplyDelay.js'

export const FLOW_FILE_ACCEPT = QUICK_REPLY_FILE_ACCEPT
export const FLOW_MEDIA_LABELS = QUICK_REPLY_MEDIA_LABELS

export function emptyFlowMessageMedia() {
  return emptyQuickReplyMedia()
}

export function flowMessageHasContent(action) {
  const body = String(action?.body || '').trim()
  const mediaType = action?.mediaType || 'none'
  return Boolean(body) || mediaType !== 'none'
}

export const attachFlowMediaFromFile = attachQuickReplyMediaFromFile

export function clearFlowMessageMedia(action) {
  revokeMediaPreviewUrl(action?.mediaPreviewUrl)
  return { ...action, body: action?.body || '', ...emptyFlowMessageMedia() }
}

export function stripFlowActionForSave(action) {
  if (action.type === 'send_message') {
    const { mediaPreviewUrl, mediaSize, ...rest } = action
    return rest
  }
  if (action.type === 'add_tag') return { type: 'add_tag', tagId: String(action.tagId || '') }
  if (action.type === 'move_stage') return { type: 'move_stage', stageId: String(action.stageId || '') }
  if (action.type === 'assign_ai') {
    const out = { type: 'assign_ai' }
    if (action.agentId) out.agentId = String(action.agentId)
    return out
  }
  if (action.type === 'set_status') return { type: 'set_status', value: String(action.value || '') }
  return { type: action.type }
}

export const DEFAULT_FLOW_COOLDOWN_HOURS = 24

export function normalizeFlowCooldown(hours) {
  const n = Number(hours)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_FLOW_COOLDOWN_HOURS
  return Math.min(720, Math.round(n))
}

function cleanFlowTrigger(trigger) {
  const type = trigger?.type || 'new_conversation'
  const out = { type }
  if (type === 'keyword') {
    out.keywords = Array.isArray(trigger.keywords) ? trigger.keywords.map((k) => String(k).trim()).filter(Boolean) : []
    out.matchMode = trigger.matchMode === 'exact' ? 'exact' : 'contains'
  }
  if (type === 'no_reply') {
    const ui = getNoReplyDelayUi(trigger)
    Object.assign(out, buildNoReplyTriggerPatch(ui.value, ui.unit))
  }
  if (type === 'stage_change' && trigger.stageId) {
    out.stageId = String(trigger.stageId)
  }
  if (type === 'tag_added' && trigger.tagId) {
    out.tagId = String(trigger.tagId)
  }
  return out
}

/** Payload normalizado para API (salvar ou testar rascunho). */
export function buildFlowApiPayload(flow) {
  return {
    name: String(flow?.name || '').trim() || 'Fluxo',
    enabled: Boolean(flow?.enabled),
    trigger: cleanFlowTrigger(flow?.trigger),
    conditions: Array.isArray(flow?.conditions) ? flow.conditions : [],
    actions: (flow?.actions || []).map(stripFlowActionForSave),
    cooldownPerContactHours: normalizeFlowCooldown(flow?.cooldownPerContactHours),
  }
}

/** Normaliza URL para inserção na mensagem do fluxo. */
export function normalizeFlowLink(raw) {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

const URL_IN_TEXT_RE = /(https?:\/\/[^\s]+)/g

export function textContainsLink(text) {
  return URL_IN_TEXT_RE.test(String(text || ''))
}
