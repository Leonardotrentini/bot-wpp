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

const delay = (ms = 400) => new Promise((r) => setTimeout(r, ms))
const useRealApi = import.meta.env.VITE_USE_REAL_API === 'true'

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

// #region agent log
if (import.meta.env.DEV) {
  const _d = {
    sessionId: '855908',
    hypothesisId: 'H1',
    location: 'api.js:init',
    message: 'Vite env + apiClient',
    data: {
      VITE_USE_REAL_API_raw: import.meta.env.VITE_USE_REAL_API,
      useRealApi,
      VITE_API_URL: import.meta.env.VITE_API_URL ?? '(undefined)',
      resolvedBaseURL: apiClient.defaults.baseURL,
    },
    timestamp: Date.now(),
  }
  fetch('http://127.0.0.1:7849/ingest/14afd426-0281-49ff-96ac-f3b8cb6971c7', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '855908' },
    body: JSON.stringify(_d),
  }).catch(() => {})
}
// #endregion

apiClient.interceptors.request.use((config) => {
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
  if (useRealApi) {
    // #region agent log
    if (import.meta.env.DEV) {
      const _d = {
        sessionId: '855908',
        hypothesisId: 'H2',
        location: 'api.js:login',
        message: 'real login attempt',
        data: {
          baseURL: apiClient.defaults.baseURL,
          fullUrlApprox: `${apiClient.defaults.baseURL || ''}/auth/login`,
        },
        timestamp: Date.now(),
      }
      fetch('http://127.0.0.1:7849/ingest/14afd426-0281-49ff-96ac-f3b8cb6971c7', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '855908' },
        body: JSON.stringify(_d),
      }).catch(() => {})
    }
    // #endregion
    try {
      const { data } = await apiClient.post('/auth/login', { email, password })
      sessionUser = data.user
      localStorage.setItem('vg_auth', JSON.stringify(sessionUser))
      localStorage.setItem('vg_auth_token', data.token)
      return { data }
    } catch (err) {
      // #region agent log
      if (import.meta.env.DEV) {
        const _d = {
          sessionId: '855908',
          hypothesisId: 'H3',
          location: 'api.js:login.catch',
          message: 'login request failed',
          data: {
            status: err.response?.status,
            code: err.code,
            msg: String(err.message || err).slice(0, 200),
          },
          timestamp: Date.now(),
        }
        fetch('http://127.0.0.1:7849/ingest/14afd426-0281-49ff-96ac-f3b8cb6971c7', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '855908' },
          body: JSON.stringify(_d),
        }).catch(() => {})
      }
      // #endregion
      throw err
    }
  }
  await delay()
  if (!email || !password) throw new Error('E-mail e senha são obrigatórios')
  sessionUser = { ...mockUser, email }
  localStorage.setItem('vg_auth', JSON.stringify(sessionUser))
  return mockResponse({ user: sessionUser, token: 'mock-jwt-token' })
}

export async function register(name, email, password) {
  if (useRealApi) {
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
  if (useRealApi) return apiClient.get('/groups')
  return mockResponse({ groups: mockGroups })
}

export async function getGroupDetails(id) {
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
  if (useRealApi) return apiClient.post('/messages/send', { groupIds, body })
  await delay()
  return mockResponse({ ok: true, sent: groupIds?.length || 0, body })
}

export async function scheduleMessage({ groupIds, body, scheduledAt, recurrence, timezone, retryPolicy }) {
  if (useRealApi) {
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
  if (useRealApi) return apiClient.get('/messages/scheduled')
  return mockResponse({ items: mockScheduledMessages })
}

export async function getMessageHistory() {
  if (useRealApi) return apiClient.get('/messages/history')
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
  if (useRealApi) return apiClient.get('/analytics', { params: { period } })
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
  if (useRealApi) return apiClient.post('/whatsapp/connect')
  await delay(600)
  whatsappConnected = true
  return mockResponse({ connected: true, qr: null })
}

export async function disconnectWhatsApp() {
  if (useRealApi) return apiClient.post('/whatsapp/disconnect')
  await delay(400)
  whatsappConnected = false
  return mockResponse({ connected: false })
}

export async function getWhatsAppStatus() {
  if (useRealApi) return apiClient.get('/whatsapp/status')
  return mockResponse({ connected: whatsappConnected, lastSync: mockWhatsAppStatus.lastSync })
}
