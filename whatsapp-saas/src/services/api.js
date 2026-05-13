import axios from 'axios'
import {
  mockUser,
  mockGroups,
  mockGroupMembersByGroup,
  mockMembersGlobal,
  mockDashboardMetrics,
  mockAutomations,
  mockScheduledMessages,
  mockMessageHistory,
  mockAnalytics,
  mockIntegrations,
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
            plan: { name: 'Grátis', slug: 'free' },
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

export async function patchAdminUser(userId, body) {
  if (!resolveUseRealApi()) throw new Error('Disponível apenas com API real.')
  return apiClient.patch(`/admin/users/${userId}`, body)
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
}

export async function getGroups() {
  if (resolveUseRealApi()) return apiClient.get('/groups')
  return mockResponse({ groups: mockGroups })
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

export async function sendMessage({ groupIds, body }) {
  if (resolveUseRealApi()) return apiClient.post('/messages/send', { groupIds, body })
  await delay()
  return mockResponse({ ok: true, sent: groupIds?.length || 0, body })
}

export async function scheduleMessage({ groupIds, body, scheduledAt, recurrence, timezone, retryPolicy }) {
  if (resolveUseRealApi()) {
    return apiClient.post('/messages/schedule', { groupIds, body, scheduledAt, recurrence, timezone, retryPolicy })
  }
  await delay()
  return mockResponse({
    ok: true,
    id: `sch-${Date.now()}`,
    groupIds,
    body,
    scheduledAt,
  })
}

export async function getScheduledMessages() {
  if (resolveUseRealApi()) return apiClient.get('/messages/scheduled')
  return mockResponse({ items: mockScheduledMessages })
}

export async function getMessageHistory() {
  if (resolveUseRealApi()) return apiClient.get('/messages/history')
  return mockResponse({ items: mockMessageHistory })
}

let automationsStore = [...mockAutomations]

export async function createAutomation(payload) {
  await delay()
  const row = {
    id: `auto-${Date.now()}`,
    name: payload.name,
    type: payload.type,
    status: 'ativa',
    groupIds: payload.groupIds || [],
    messagePreview: (payload.message || '').slice(0, 80) + ((payload.message || '').length > 80 ? '…' : ''),
  }
  automationsStore = [row, ...automationsStore]
  return mockResponse({ automation: row })
}

export async function getAutomations() {
  return mockResponse({ automations: [...automationsStore] })
}

export async function getMembers() {
  return mockResponse({ members: mockMembersGlobal })
}

export async function getMemberDetails(id) {
  await delay()
  const m = mockMembersGlobal.find((x) => x.id === id)
  if (!m) throw new Error('Membro não encontrado')
  return mockResponse({ member: m })
}

export async function getAnalytics(period = '7d') {
  if (resolveUseRealApi()) return apiClient.get('/analytics', { params: { period } })
  await delay()
  return mockResponse({ ...mockAnalytics, period })
}

export async function getDashboardSummary() {
  return mockResponse(mockDashboardMetrics)
}

export async function getIntegrations() {
  return mockResponse({ integrations: mockIntegrations })
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
