import axios from 'axios'
import {
  mockUser,
  mockGroups,
  mockGroupMembersByGroup,
  mockMembersGlobal,
  mockDashboardMetrics,
  mockMessageHistory,
  mockAnalytics,
  mockWhatsAppStatus,
  mockGroupSettings,
} from '../utils/mockData.js'
import { resolveApiBaseURL, resolveUseRealApi } from '../lib/runtimeEnv.js'

const delay = (ms = 400) => new Promise((r) => setTimeout(r, ms))

export const apiClient = axios.create({
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

apiClient.interceptors.request.use((config) => {
  config.baseURL = resolveApiBaseURL()
  const token = localStorage.getItem('vg_auth_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('vg_auth_token')
      localStorage.removeItem('vg_auth')
      const path = window.location.pathname || ''
      if (!path.startsWith('/login') && !path.startsWith('/register')) {
        window.location.href = '/login?expired=1'
      }
    }
    return Promise.reject(error)
  },
)

/** Simula resposta JSON — substitua por apiClient.post(...) quando o backend existir */
async function mockResponse(data) {
  await delay()
  return { data }
}

let sessionUser = null
let whatsappConnected = mockWhatsAppStatus.connected

export async function login(email, password) {
  if (resolveUseRealApi()) {
    const { data } = await apiClient.post('/auth/login', { email, password })
    sessionUser = data.user
    localStorage.setItem('vg_auth', JSON.stringify(sessionUser))
    localStorage.setItem('vg_auth_token', data.token)
    return { data }
  }
  await delay()
  if (!email || !password) throw new Error('E-mail e senha são obrigatórios')
  sessionUser = { ...mockUser, email }
  localStorage.setItem('vg_auth', JSON.stringify(sessionUser))
  return mockResponse({ user: sessionUser, token: 'mock-jwt-token' })
}

export async function register(name, email, password) {
  if (resolveUseRealApi()) {
    const { data } = await apiClient.post('/auth/register', { name, email, password })
    sessionUser = data.user
    localStorage.setItem('vg_auth', JSON.stringify(sessionUser))
    localStorage.setItem('vg_auth_token', data.token)
    return { data }
  }
  await delay()
  if (!name || !email || !password) throw new Error('Preencha todos os campos')
  sessionUser = { ...mockUser, name, email }
  localStorage.setItem('vg_auth', JSON.stringify(sessionUser))
  return mockResponse({ user: sessionUser, token: 'mock-jwt-token' })
}

/** Atualiza sessão a partir do servidor (role, plano). Usar após login ou ao montar a app. */
export async function fetchMe() {
  if (!resolveUseRealApi()) {
    const u = loadSessionFromStorage()
    return { user: u }
  }
  const { data } = await apiClient.get('/auth/me')
  sessionUser = data.user
  localStorage.setItem('vg_auth', JSON.stringify(sessionUser))
  return data
}

export async function updateProfile(payload = {}) {
  if (resolveUseRealApi()) {
    const { data } = await apiClient.put('/auth/profile', payload)
    sessionUser = { ...(sessionUser || {}), ...(data?.user || {}) }
    localStorage.setItem('vg_auth', JSON.stringify(sessionUser))
    return data
  }
  await delay()
  sessionUser = { ...(sessionUser || mockUser), ...payload }
  if (payload.newPassword) delete sessionUser.newPassword
  localStorage.setItem('vg_auth', JSON.stringify(sessionUser))
  return { user: sessionUser }
}

export async function getAdminUsers(params = {}) {
  if (!resolveUseRealApi()) {
    await delay()
    return {
      data: {
        users: [
          {
            id: 'u-mock',
            name: mockUser.name,
            email: mockUser.email,
            role: 'USER',
            createdAt: new Date().toISOString(),
            plan: { id: 'plan-free', name: 'ILIMITADO', slug: 'free' },
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      },
    }
  }
  return apiClient.get('/admin/users', { params })
}

export async function getAdminPlans() {
  if (!resolveUseRealApi()) {
    await delay()
    return {
      data: {
        plans: [
          { id: 'plan-free', name: 'ILIMITADO', slug: 'free', maxGroups: 50 },
          { id: 'plan-pro', name: 'Pro', slug: 'pro', maxGroups: 50 },
        ],
      },
    }
  }
  return apiClient.get('/admin/plans')
}

export async function patchAdminUser(userId, body) {
  if (!resolveUseRealApi()) throw new Error('Disponível apenas com API real.')
  return apiClient.patch(`/admin/users/${encodeURIComponent(userId)}`, body)
}

export async function patchAdminUserPlan(userId, planId) {
  if (!resolveUseRealApi()) throw new Error('Disponível apenas com API real.')
  return apiClient.patch(`/admin/users/${encodeURIComponent(userId)}/subscription`, { planId })
}

export async function deleteAdminUser(userId) {
  if (!resolveUseRealApi()) throw new Error('Disponível apenas com API real.')
  return apiClient.delete(`/admin/users/${encodeURIComponent(userId)}`)
}

export function getImpersonationInfo() {
  try {
    const raw = sessionStorage.getItem('vg_impersonating')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function stashAdminSessionForImpersonation() {
  const token = localStorage.getItem('vg_auth_token')
  const auth = localStorage.getItem('vg_auth')
  if (token) sessionStorage.setItem('vg_admin_token', token)
  if (auth) sessionStorage.setItem('vg_admin_auth', auth)
}

export async function impersonateAdminUser(userId) {
  if (!resolveUseRealApi()) throw new Error('Disponível apenas com API real.')
  const { data } = await apiClient.post(`/admin/users/${encodeURIComponent(userId)}/impersonate`)
  stashAdminSessionForImpersonation()
  sessionStorage.setItem(
    'vg_impersonating',
    JSON.stringify({ userId: data.user.id, name: data.user.name, email: data.user.email }),
  )
  sessionUser = data.user
  localStorage.setItem('vg_auth', JSON.stringify(data.user))
  localStorage.setItem('vg_auth_token', data.token)
  return data
}

export function exitImpersonation() {
  const adminToken = sessionStorage.getItem('vg_admin_token')
  const adminAuth = sessionStorage.getItem('vg_admin_auth')
  sessionStorage.removeItem('vg_admin_token')
  sessionStorage.removeItem('vg_admin_auth')
  sessionStorage.removeItem('vg_impersonating')
  if (adminToken) localStorage.setItem('vg_auth_token', adminToken)
  else localStorage.removeItem('vg_auth_token')
  if (adminAuth) {
    localStorage.setItem('vg_auth', adminAuth)
    try {
      sessionUser = JSON.parse(adminAuth)
    } catch {
      sessionUser = null
    }
  } else {
    localStorage.removeItem('vg_auth')
    sessionUser = null
  }
  return sessionUser
}

export async function createAdminUser(body) {
  if (!resolveUseRealApi()) {
    await delay()
    return {
      data: {
        user: {
          id: `u-${Date.now()}`,
          name: body?.name || 'Novo usuário',
          email: body?.email || 'novo@exemplo.com',
          role: body?.role || 'USER',
          createdAt: new Date().toISOString(),
          plan: { name: 'ILIMITADO', slug: 'free' },
        },
      },
    }
  }
  return apiClient.post('/admin/users', body)
}

export function loadSessionFromStorage() {
  try {
    const raw = localStorage.getItem('vg_auth') || localStorage.getItem('gf_auth')
    if (raw) sessionUser = JSON.parse(raw)
  } catch {
    sessionUser = null
  }
  return sessionUser
}

export function logout() {
  sessionUser = null
  localStorage.removeItem('vg_auth')
  localStorage.removeItem('vg_auth_token')
  sessionStorage.removeItem('vg_admin_token')
  sessionStorage.removeItem('vg_admin_auth')
  sessionStorage.removeItem('vg_impersonating')
}

export async function getGroups() {
  if (resolveUseRealApi()) return apiClient.get('/groups')
  return mockResponse({ groups: mockGroups })
}

export async function discoverGroups() {
  if (resolveUseRealApi()) return apiClient.post('/groups/discover')
  return mockResponse({
    groups: mockGroups.map((group) => ({ ...group, status: 'pendente', monitoringEnabled: false, messageSyncStatus: 'IDLE' })),
    sync: { status: 'GROUPS_FOUND', progress: 100, groupsCount: mockGroups.length },
    import: { status: 'IDLE', total: 0, done: 0, backfillDays: 2 },
  })
}

export async function selectGroups(groupIds = []) {
  if (resolveUseRealApi()) return apiClient.post('/groups/select', { groupIds })
  const selected = new Set(groupIds)
  return mockResponse({
    groups: mockGroups.map((group) => ({
      ...group,
      monitoringEnabled: selected.has(group.id),
      messageSyncStatus: selected.has(group.id) ? 'READY' : 'IDLE',
      messagesSyncedCount: selected.has(group.id) ? 42 : 0,
      status: selected.has(group.id) ? 'ativo' : group.status,
    })),
    import: { status: 'READY', total: groupIds.length, done: groupIds.length, backfillDays: 2 },
  })
}

export async function setGroupsStatus(groupIds = [], status = 'ativo') {
  if (resolveUseRealApi()) return apiClient.post('/groups/status', { groupIds, status })
  const sel = new Set(groupIds)
  return mockResponse({
    groups: mockGroups.map((g) => (sel.has(g.id) ? { ...g, status, monitoringEnabled: status === 'ativo' } : g)),
  })
}

export async function syncGroups(groupIds = []) {
  if (resolveUseRealApi()) {
    const body = groupIds?.length ? { groupIds } : {}
    return apiClient.post('/groups/sync', body)
  }
  return mockResponse({ groups: mockGroups, import: { status: 'READY', total: mockGroups.length, done: mockGroups.length, backfillDays: 2 } })
}

export async function getGroupMessages(id, limit = 100) {
  if (resolveUseRealApi()) return apiClient.get(`/groups/${encodeURIComponent(id)}/messages`, { params: { limit } })
  return mockResponse({ groupName: 'Grupo', messages: [] })
}

export async function getGroupDetails(id) {
  if (resolveUseRealApi()) return apiClient.get(`/groups/${encodeURIComponent(id)}`)
  await delay()
  const group = mockGroups.find((g) => g.id === id)
  if (!group) throw new Error('Grupo não encontrado')
  const rawMembers = mockGroupMembersByGroup[id] || mockGroupMembersByGroup.g1
  const members = rawMembers.map((m) => ({
    ...m,
    lastActivity: m.lastActivity || new Date().toISOString(),
  }))
  const activity = mockDashboardMetrics.messagesLast7Days.map((d, i) => ({
    day: d.day,
    msgs: Math.round(40 + Math.random() * 80 + i * 5),
  }))
  return mockResponse({ group, members, activity, settings: { ...mockGroupSettings } })
}

export async function updateGroupConfig(groupId, payload = {}) {
  if (resolveUseRealApi()) return apiClient.put(`/groups/${encodeURIComponent(groupId)}/config`, payload)
  return mockResponse({ ok: true, ...payload })
}

export async function getGroupX1Deliveries(groupId, limit = 30) {
  if (resolveUseRealApi()) {
    return apiClient.get(`/groups/${encodeURIComponent(groupId)}/x1/deliveries`, { params: { limit } })
  }
  return mockResponse({ deliveries: [] })
}

export async function testGroupX1(groupId, { kind, participantJid }) {
  if (resolveUseRealApi()) {
    return apiClient.post(`/groups/${encodeURIComponent(groupId)}/x1/test`, { kind, participantJid })
  }
  await delay()
  return mockResponse({
    ok: true,
    delivery: {
      id: `x1-${Date.now()}`,
      kind,
      participantJid,
      status: 'sent',
      source: 'test',
      createdAt: new Date().toISOString(),
    },
  })
}

export async function setGroupParticipantsStatus(groupId, participantIds = [], status = 'ativo') {
  if (resolveUseRealApi()) {
    return apiClient.post(`/groups/${encodeURIComponent(groupId)}/participants/status`, { participantIds, status })
  }
  await delay()
  return mockResponse({ updated: participantIds.length, status })
}

export async function sendMessage({
  groupIds,
  templateId,
  body,
  mediaType,
  mediaBase64,
  mediaMime,
  mediaName,
  mentionsJson,
  linkPreview,
}) {
  if (resolveUseRealApi()) {
    return apiClient.post('/messages/send', {
      groupIds,
      templateId,
      body,
      mediaType,
      mediaBase64,
      mediaMime,
      mediaName,
      mentionsJson,
      linkPreview,
    })
  }
  await delay()
  return mockResponse({ results: (groupIds || []).map((id) => ({ groupJid: id, status: 'entregue' })), sent: groupIds?.length || 0 })
}

export async function getTemplates() {
  if (resolveUseRealApi()) return apiClient.get('/messages/templates')
  return mockResponse({ templates: [] })
}

export async function createTemplate(payload) {
  if (resolveUseRealApi()) return apiClient.post('/messages/templates', payload)
  return mockResponse({ template: { id: `tpl-${Date.now()}`, ...payload } })
}

export async function updateTemplate(id, payload) {
  if (resolveUseRealApi()) return apiClient.put(`/messages/templates/${encodeURIComponent(id)}`, payload)
  return mockResponse({ template: { id, ...payload } })
}

export async function deleteTemplate(id) {
  if (resolveUseRealApi()) return apiClient.delete(`/messages/templates/${encodeURIComponent(id)}`)
  return mockResponse({ ok: true })
}

export async function updateAutomation(id, payload) {
  if (resolveUseRealApi()) return apiClient.patch(`/automations/${encodeURIComponent(id)}`, payload)
  return mockResponse({ automation: { id, ...payload } })
}

export async function deleteAutomation(id) {
  if (resolveUseRealApi()) return apiClient.delete(`/automations/${encodeURIComponent(id)}`)
  return mockResponse({ ok: true })
}

export async function putAutomation(id, payload) {
  if (resolveUseRealApi()) return apiClient.put(`/automations/${encodeURIComponent(id)}`, payload)
  return mockResponse({ automation: { id, ...payload } })
}

export async function getSendJob(id) {
  if (resolveUseRealApi()) return apiClient.get(`/messages/jobs/${encodeURIComponent(id)}`)
  return mockResponse({ job: { id, status: 'done', total: 1, done: 1, sent: 1, failed: 0 } })
}

export async function getCadences() {
  if (resolveUseRealApi()) return apiClient.get('/cadences')
  return mockResponse({ cadences: [] })
}

export async function createCadence(name) {
  if (resolveUseRealApi()) return apiClient.post('/cadences', { name })
  return mockResponse({ cadence: { id: `cad-${Date.now()}`, name } })
}

export async function renameCadence(id, name) {
  if (resolveUseRealApi()) return apiClient.patch(`/cadences/${encodeURIComponent(id)}`, { name })
  return mockResponse({ cadence: { id, name } })
}

export async function deleteCadence(id) {
  if (resolveUseRealApi()) return apiClient.delete(`/cadences/${encodeURIComponent(id)}`)
  return mockResponse({ ok: true })
}

export async function setCadenceAutomations(id, automationIds) {
  if (resolveUseRealApi()) return apiClient.post(`/cadences/${encodeURIComponent(id)}/automations`, { automationIds })
  return mockResponse({ automations: [] })
}

export async function setCadenceStatus(id, status) {
  if (resolveUseRealApi()) return apiClient.post(`/cadences/${encodeURIComponent(id)}/status`, { status })
  return mockResponse({ automations: [] })
}

export async function getMessageHistory(params = {}) {
  if (resolveUseRealApi()) return apiClient.get('/messages/history', { params })
  return mockResponse({ items: mockMessageHistory, total: mockMessageHistory.length, limit: 50, offset: 0 })
}

export async function getGroupMessageActivity(limit = 40) {
  if (resolveUseRealApi()) return apiClient.get('/messages/activity', { params: { limit } })
  return mockResponse({ items: [], meta: { messageRetentionDays: 2 } })
}

export async function createAutomation(payload) {
  if (resolveUseRealApi()) return apiClient.post('/automations', payload)
  await delay()
  return mockResponse({ automation: { id: `auto-${Date.now()}`, status: 'ativa', ...payload } })
}

export async function getAutomations() {
  if (resolveUseRealApi()) return apiClient.get('/automations')
  return mockResponse({ automations: [] })
}

export async function getMembers(params = {}) {
  if (resolveUseRealApi()) return apiClient.get('/members', { params })
  await delay()
  let members = [...mockMembersGlobal]
  const activeOnly = params.activeGroupsOnly === '1' || params.activeGroupsOnly === true
  const activeIds = new Set(mockGroups.filter((g) => g.status === 'ativo').map((g) => g.id))
  if (activeOnly) {
    members = members
      .map((m) => {
        const ids = (m.groupIds || []).filter((id) => activeIds.has(id))
        const names = ids.map((id) => mockGroups.find((g) => g.id === id)?.name).filter(Boolean)
        return { ...m, groupIds: ids, groups: names }
      })
      .filter((m) => m.groupIds.length > 0)
  }
  if (params.groupId) members = members.filter((m) => (m.groupIds || []).includes(params.groupId))
  if (params.status) members = members.filter((m) => m.status === params.status)
  if (params.tag) members = members.filter((m) => (m.tags || []).includes(params.tag))
  if (params.q) {
    const q = String(params.q).toLowerCase()
    members = members.filter((m) => m.name.toLowerCase().includes(q) || m.phone.includes(q))
  }
  return mockResponse({
    members,
    groups: mockGroups,
    total: members.length,
    meta: { groupsTotal: mockGroups.length, groupsWithParticipants: mockGroups.length },
  })
}

export async function syncMembersParticipants(maxGroups = 8) {
  if (resolveUseRealApi()) return apiClient.post('/members/sync-participants', { maxGroups })
  return mockResponse({ synced: mockGroups.filter((g) => g.status === 'ativo').length, failed: 0, attempted: maxGroups })
}

export async function getMemberDetails(id) {
  await delay()
  const m = mockMembersGlobal.find((x) => x.id === id)
  if (!m) throw new Error('Membro não encontrado')
  return mockResponse({ member: m })
}

export async function getAnalytics(period = '2d', { startDate, endDate } = {}) {
  if (resolveUseRealApi()) {
    const params = { period }
    if (startDate) params.startDate = startDate
    if (endDate) params.endDate = endDate
    return apiClient.get('/analytics', { params })
  }
  await delay()
  return mockResponse({ ...mockAnalytics, period })
}

export async function getOverview({ groupIds = [], period = '2d' } = {}) {
  if (resolveUseRealApi()) {
    const params = { period }
    if (groupIds?.length) params.groupIds = groupIds.join(',')
    return apiClient.get('/overview', { params })
  }
  await delay()
  return mockResponse(mockDashboardMetrics)
}

export async function refreshOverview({ groupIds = [], period = '2d' } = {}) {
  if (resolveUseRealApi()) {
    const body = { period }
    if (groupIds?.length) body.groupIds = groupIds
    return apiClient.post('/overview/refresh', body)
  }
  return getOverview({ groupIds, period })
}

/** @deprecated use getOverview */
export async function getDashboardSummary() {
  return getOverview()
}

export async function getIntegrations() {
  if (resolveUseRealApi()) return apiClient.get('/integrations')
  return mockResponse({
    integrations: [
      {
        id: 'meta',
        name: 'Meta (Facebook)',
        description: 'Envia orçamentos e vendas do CRM para o Pixel.',
        connected: false,
        provider: 'meta',
      },
      {
        id: 'gtm',
        name: 'Google Tag Manager',
        description: 'Container GTM para tags na landing page.',
        connected: false,
        provider: 'gtm',
      },
    ],
  })
}

export async function getGtmIntegration() {
  if (resolveUseRealApi()) return apiClient.get('/integrations/gtm')
  return mockResponse({ integration: null })
}

export async function saveGtmIntegration(payload) {
  if (resolveUseRealApi()) return apiClient.put('/integrations/gtm', payload)
  return mockResponse({
    integration: {
      containerId: String(payload.containerId || '').toUpperCase(),
      enabled: payload.enabled !== false,
      connected: Boolean(payload.containerId && payload.enabled !== false),
      conversionTags: payload.conversionTags || [],
      linkedTagsCount: (payload.conversionTags || []).filter((t) => t.enabled).length,
      ga4MeasurementId: payload.ga4MeasurementId || '',
      hasGa4ApiSecret: Boolean(payload.ga4ApiSecret),
    },
  })
}

export async function getMetaIntegration() {
  if (resolveUseRealApi()) return apiClient.get('/integrations/meta')
  return mockResponse({ integration: null })
}

export async function saveMetaLpSettings(payload) {
  if (resolveUseRealApi()) return apiClient.patch('/integrations/meta/lp', payload)
  return mockResponse({
    integration: {
      allowedOrigins: payload.allowedOrigins || [],
      lpWhatsapp: payload.lpSellers?.[0]?.phone || '',
      lpWhatsappMsg: payload.lpWhatsappMsg || '',
      lpRotatorMode: payload.lpRotatorMode || 'sequential',
      lpSellers: payload.lpSellers || [],
      vestoPublicKey: 'vpk_demo123',
    },
  })
}

export async function saveMetaIntegration(payload) {
  if (resolveUseRealApi()) return apiClient.put('/integrations/meta', payload)
  return mockResponse({
    integration: {
      pixelId: payload.pixelId,
      facebookPageId: payload.facebookPageId || '',
      enabled: payload.enabled !== false,
      sendQuotes: payload.sendQuotes !== false,
      sendPurchases: payload.sendPurchases !== false,
      testEventCode: payload.testEventCode || '',
      allowedOrigins: payload.allowedOrigins || [],
      lpWhatsapp: payload.lpWhatsapp || payload.lpSellers?.[0]?.phone || '',
      lpWhatsappMsg: payload.lpWhatsappMsg || '',
      lpRotatorMode: payload.lpRotatorMode || 'sequential',
      lpSellers: payload.lpSellers || [],
      vestoPublicKey: 'vpk_demo123',
      hasAccessToken: true,
      connected: true,
    },
  })
}

export async function testMetaIntegration() {
  if (resolveUseRealApi()) return apiClient.post('/integrations/meta/test')
  return mockResponse({ ok: true, message: 'Eventos de teste enviados (simulado).' })
}

export async function getMetaAdsDashboard(period = '7d') {
  if (resolveUseRealApi()) return apiClient.get('/integrations/meta/ads', { params: { period } })
  return mockResponse({
    ok: true,
    period,
    account: { id: 'act_000', name: 'Conta demo', currency: 'BRL' },
    summary: { spend: 1250.5, impressions: 45000, clicks: 890, cpc: 1.4 },
    campaigns: [
      { id: '1', name: 'Campanha LP WhatsApp', spend: 800, impressions: 30000, clicks: 520, cpc: 1.54 },
      { id: '2', name: 'CTWA Mensagem', spend: 450.5, impressions: 15000, clicks: 370, cpc: 1.22 },
    ],
    creatives: [
      {
        id: 'ad-1',
        name: 'Criativo vídeo 01',
        status: 'ACTIVE',
        campaignName: 'Campanha LP WhatsApp',
        thumbnailUrl: null,
        title: 'Fale conosco no WhatsApp',
        body: 'Orçamento rápido para seu projeto.',
      },
    ],
    syncedAt: new Date().toISOString(),
  })
}

export async function testMetaAdsConnection() {
  if (resolveUseRealApi()) return apiClient.post('/integrations/meta/ads/test')
  return mockResponse({ ok: true, message: 'Conta de anúncios conectada (simulado).' })
}

export async function connectWhatsApp() {
  if (resolveUseRealApi()) return apiClient.post('/whatsapp/connect')
  await delay(600)
  whatsappConnected = true
  return mockResponse({ connected: true, qr: null })
}

export async function disconnectWhatsApp() {
  if (resolveUseRealApi()) return apiClient.post('/whatsapp/disconnect')
  await delay(400)
  whatsappConnected = false
  return mockResponse({ connected: false })
}

export async function getWhatsAppStatus() {
  if (resolveUseRealApi()) return apiClient.get('/whatsapp/status')
  return mockResponse({ connected: whatsappConnected, lastSync: mockWhatsAppStatus.lastSync })
}

// ============================= CRM =============================

export async function getCrmConversations(params = {}) {
  if (resolveUseRealApi()) return apiClient.get('/crm/conversations', { params })
  return mockResponse({ conversations: [], total: 0, limit: 100, offset: 0 })
}

export async function getCrmConversationMessages(id, params = {}) {
  if (resolveUseRealApi()) return apiClient.get(`/crm/conversations/${encodeURIComponent(id)}/messages`, { params })
  return mockResponse({ messages: [], hasMore: false })
}

export async function getCrmMessageMedia(messageId) {
  if (resolveUseRealApi()) {
    return apiClient.get(`/crm/messages/${encodeURIComponent(messageId)}/media`, { timeout: 120000 })
  }
  return mockResponse({ kind: 'audio', mimetype: 'audio/ogg', base64: '' })
}

export async function sendCrmMessage(id, payload) {
  if (resolveUseRealApi()) {
    return apiClient.post(`/crm/conversations/${encodeURIComponent(id)}/send`, payload, { timeout: 120000 })
  }
  return mockResponse({ message: null, conversation: null })
}

export async function markCrmConversationRead(id) {
  if (resolveUseRealApi()) return apiClient.post(`/crm/conversations/${encodeURIComponent(id)}/read`)
  return mockResponse({ conversation: null })
}

export async function patchCrmConversation(id, payload) {
  if (resolveUseRealApi()) return apiClient.patch(`/crm/conversations/${encodeURIComponent(id)}`, payload)
  return mockResponse({ conversation: null })
}

export async function patchCrmContact(id, payload) {
  if (resolveUseRealApi()) return apiClient.patch(`/crm/contacts/${encodeURIComponent(id)}`, payload)
  return mockResponse({ contact: null })
}

export async function saveCrmContact(id, { name, saveOnWhatsapp = false }) {
  if (resolveUseRealApi()) {
    return apiClient.post(`/crm/contacts/${encodeURIComponent(id)}/save`, {
      name,
      saveOnWhatsapp: Boolean(saveOnWhatsapp),
    })
  }
  return mockResponse({ contact: { id, name, savedName: name }, whatsappSaved: false })
}

export async function addCrmContactTag(contactId, tagId) {
  if (resolveUseRealApi()) return apiClient.post(`/crm/contacts/${encodeURIComponent(contactId)}/tags`, { tagId })
  return mockResponse({ contact: null })
}

export async function removeCrmContactTag(contactId, tagId) {
  if (resolveUseRealApi()) {
    return apiClient.delete(`/crm/contacts/${encodeURIComponent(contactId)}/tags/${encodeURIComponent(tagId)}`)
  }
  return mockResponse({ contact: null })
}

export async function getCrmContactActivity(contactId) {
  if (resolveUseRealApi()) return apiClient.get(`/crm/contacts/${encodeURIComponent(contactId)}/activity`)
  return mockResponse({ activities: [] })
}

export async function deleteCrmContactActivity(contactId, activityId) {
  if (resolveUseRealApi()) {
    return apiClient.delete(
      `/crm/contacts/${encodeURIComponent(contactId)}/activity/${encodeURIComponent(activityId)}`,
    )
  }
  return mockResponse({ ok: true })
}

export async function getCrmSales({ from, to, q, page, limit } = {}) {
  if (resolveUseRealApi()) {
    return apiClient.get('/crm/sales', {
      params: {
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(q ? { q } : {}),
        ...(page ? { page } : {}),
        ...(limit ? { limit } : {}),
      },
    })
  }
  return mockResponse({
    sales: [],
    summary: { count: 0, totalAmount: 0, averageAmount: 0 },
    pagination: { page: 1, limit: 30, total: 0, pages: 0 },
  })
}

export async function saveCrmContactQuote(contactId, { amount }) {
  if (resolveUseRealApi()) {
    return apiClient.post(`/crm/contacts/${encodeURIComponent(contactId)}/quote`, { amount })
  }
  return mockResponse({
    contact: {
      id: contactId,
      quote: { amount, currency: 'BRL', savedAt: new Date().toISOString() },
    },
  })
}

export async function confirmCrmContactPurchase(contactId, { amount, ticket, moveToClosed = true }) {
  if (resolveUseRealApi()) {
    return apiClient.post(`/crm/contacts/${encodeURIComponent(contactId)}/purchase/confirm`, {
      amount,
      ticket,
      moveToClosed,
    })
  }
  return mockResponse({
    contact: {
      id: contactId,
      purchase: { amount, ticket, currency: 'BRL', confirmedAt: new Date().toISOString() },
    },
    conversation: null,
  })
}

export async function getCrmContactReminders(contactId) {
  if (resolveUseRealApi()) return apiClient.get(`/crm/contacts/${encodeURIComponent(contactId)}/reminders`)
  return mockResponse({ reminders: [] })
}

export async function createCrmContactReminder(contactId, { scheduledAt, note }) {
  if (resolveUseRealApi()) {
    return apiClient.post(`/crm/contacts/${encodeURIComponent(contactId)}/reminders`, { scheduledAt, note })
  }
  const reminder = {
    id: `rem-${Date.now()}`,
    note: note || '',
    scheduledAt,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
  return mockResponse({
    reminder,
    contact: { id: contactId, reminders: [reminder], nextReminder: reminder },
  })
}

export async function cancelCrmContactReminder(contactId, reminderId) {
  if (resolveUseRealApi()) {
    return apiClient.delete(
      `/crm/contacts/${encodeURIComponent(contactId)}/reminders/${encodeURIComponent(reminderId)}`,
    )
  }
  return mockResponse({ contact: { id: contactId, reminders: [], nextReminder: null } })
}

export async function getCrmReminderAlerts() {
  if (resolveUseRealApi()) return apiClient.get('/crm/reminders/alerts')
  return mockResponse({ alerts: [] })
}

export async function dismissCrmReminderAlert(reminderId) {
  if (resolveUseRealApi()) {
    return apiClient.post(`/crm/reminders/${encodeURIComponent(reminderId)}/dismiss`)
  }
  return mockResponse({ ok: true })
}

export async function getCrmTags() {
  if (resolveUseRealApi()) return apiClient.get('/crm/tags')
  return mockResponse({ tags: [] })
}

export async function createCrmTag(payload) {
  if (resolveUseRealApi()) return apiClient.post('/crm/tags', payload)
  return mockResponse({ tag: { id: `tag-${Date.now()}`, ...payload } })
}

export async function updateCrmTag(id, payload) {
  if (resolveUseRealApi()) return apiClient.patch(`/crm/tags/${encodeURIComponent(id)}`, payload)
  return mockResponse({ tag: { id, ...payload } })
}

export async function deleteCrmTag(id) {
  if (resolveUseRealApi()) return apiClient.delete(`/crm/tags/${encodeURIComponent(id)}`)
  return mockResponse({ ok: true })
}

export async function getCrmStages() {
  if (resolveUseRealApi()) return apiClient.get('/crm/stages')
  return mockResponse({ stages: [] })
}

export async function createCrmStage(payload) {
  if (resolveUseRealApi()) return apiClient.post('/crm/stages', payload)
  return mockResponse({ stage: { id: `stage-${Date.now()}`, ...payload } })
}

export async function updateCrmStage(id, payload) {
  if (resolveUseRealApi()) return apiClient.patch(`/crm/stages/${encodeURIComponent(id)}`, payload)
  return mockResponse({ stage: { id, ...payload } })
}

export async function reorderCrmStages(order) {
  if (resolveUseRealApi()) return apiClient.post('/crm/stages/reorder', { order })
  return mockResponse({ stages: [] })
}

export async function deleteCrmStage(id) {
  if (resolveUseRealApi()) return apiClient.delete(`/crm/stages/${encodeURIComponent(id)}`)
  return mockResponse({ ok: true })
}

export async function getCrmQuickReplies() {
  if (resolveUseRealApi()) return apiClient.get('/crm/quick-replies')
  return mockResponse({ quickReplies: [] })
}

export async function createCrmQuickReply(payload) {
  if (resolveUseRealApi()) return apiClient.post('/crm/quick-replies', payload, { timeout: 120000 })
  return mockResponse({ quickReply: { id: `qr-${Date.now()}`, ...payload } })
}

export async function updateCrmQuickReply(id, payload) {
  if (resolveUseRealApi()) return apiClient.put(`/crm/quick-replies/${encodeURIComponent(id)}`, payload, { timeout: 120000 })
  return mockResponse({ quickReply: { id, ...payload } })
}

export async function deleteCrmQuickReply(id) {
  if (resolveUseRealApi()) return apiClient.delete(`/crm/quick-replies/${encodeURIComponent(id)}`)
  return mockResponse({ ok: true })
}

export async function getCrmQuickReplyContent(id) {
  if (resolveUseRealApi()) return apiClient.get(`/crm/quick-replies/${encodeURIComponent(id)}/content`)
  return mockResponse({ quickReply: null })
}

export async function getCrmFlows() {
  if (resolveUseRealApi()) return apiClient.get('/crm/flows')
  return mockResponse({ flows: [] })
}

export async function createCrmFlow(payload) {
  if (resolveUseRealApi()) return apiClient.post('/crm/flows', payload, { timeout: 120000 })
  return mockResponse({ flow: { id: `flow-${Date.now()}`, ...payload } })
}

export async function updateCrmFlow(id, payload) {
  if (resolveUseRealApi()) return apiClient.put(`/crm/flows/${encodeURIComponent(id)}`, payload, { timeout: 120000 })
  return mockResponse({ flow: { id, ...payload } })
}

export async function toggleCrmFlow(id, enabled) {
  if (resolveUseRealApi()) return apiClient.patch(`/crm/flows/${encodeURIComponent(id)}`, { enabled })
  return mockResponse({ flow: { id, enabled } })
}

export async function deleteCrmFlow(id) {
  if (resolveUseRealApi()) return apiClient.delete(`/crm/flows/${encodeURIComponent(id)}`)
  return mockResponse({ ok: true })
}

export async function getCrmFlowRuns(id) {
  if (resolveUseRealApi()) return apiClient.get(`/crm/flows/${encodeURIComponent(id)}/runs`)
  return mockResponse({ runs: [] })
}

export async function testCrmFlow(id, conversationId) {
  if (resolveUseRealApi()) {
    return apiClient.post(
      `/crm/flows/${encodeURIComponent(id)}/test`,
      { conversationId },
      { timeout: 120000 },
    )
  }
  return mockResponse({ ok: true, detail: ['send_message'], message: 'Teste enviado (modo demonstração).' })
}

export async function testCrmFlowDraft(flow, conversationId) {
  if (resolveUseRealApi()) {
    return apiClient.post('/crm/flows/test', { flow, conversationId }, { timeout: 120000 })
  }
  return mockResponse({ ok: true, detail: ['send_message'], message: 'Teste enviado (modo demonstração).' })
}

export async function getCrmAgents() {
  if (resolveUseRealApi()) return apiClient.get('/crm/agents')
  return mockResponse({ agents: [], aiConfigured: false })
}

export async function createCrmAgent(payload) {
  if (resolveUseRealApi()) return apiClient.post('/crm/agents', payload)
  return mockResponse({ agent: { id: `agent-${Date.now()}`, ...payload } })
}

export async function updateCrmAgent(id, payload) {
  if (resolveUseRealApi()) return apiClient.put(`/crm/agents/${encodeURIComponent(id)}`, payload)
  return mockResponse({ agent: { id, ...payload } })
}

export async function deleteCrmAgent(id) {
  if (resolveUseRealApi()) return apiClient.delete(`/crm/agents/${encodeURIComponent(id)}`)
  return mockResponse({ ok: true })
}

export async function testCrmAgent(id, message) {
  if (resolveUseRealApi()) {
    return apiClient.post(`/crm/agents/${encodeURIComponent(id)}/test`, { message }, { timeout: 90000 })
  }
  return mockResponse({ reply: 'Resposta de teste (modo demonstração).' })
}

export async function startCrmSync(payload = {}) {
  if (resolveUseRealApi()) return apiClient.post('/crm/sync', payload)
  return mockResponse({ started: true, job: null })
}

export async function getCrmSyncStatus() {
  if (resolveUseRealApi()) return apiClient.get('/crm/sync/status')
  return mockResponse({ job: null })
}

export async function refreshCrmContactAvatar(contactId) {
  if (resolveUseRealApi()) {
    return apiClient.post(`/crm/contacts/${encodeURIComponent(contactId)}/refresh-avatar`)
  }
  return mockResponse({ avatarUrl: null, contact: null })
}

export async function refreshCrmProfiles() {
  if (resolveUseRealApi()) return apiClient.post('/crm/profiles/refresh')
  return mockResponse({ ok: true, enriched: 0, queued: 0, directorySize: 0 })
}

export async function getCrmOverview() {
  if (resolveUseRealApi()) return apiClient.get('/crm/overview')
  return mockResponse({ open: 0, pending: 0, resolved: 0, unread: 0, contacts: 0, aiConfigured: false })
}
