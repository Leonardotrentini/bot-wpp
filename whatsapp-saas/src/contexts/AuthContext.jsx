import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  loadSessionFromStorage,
  logout as apiLogout,
  fetchMe,
  getImpersonationInfo,
  exitImpersonation as apiExitImpersonation,
} from '../services/api.js'
import { resolveUseRealApi } from '../lib/runtimeEnv.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => loadSessionFromStorage())
  const [impersonation, setImpersonation] = useState(() => getImpersonationInfo())

  const login = (u) => setUser(u)
  const setCurrentUser = (updater) => {
    setUser((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      return next
    })
  }
  const logout = () => {
    apiLogout()
    setUser(null)
    setImpersonation(null)
  }

  const exitImpersonation = useCallback(() => {
    const adminUser = apiExitImpersonation()
    setImpersonation(null)
    setUser(adminUser)
    return adminUser
  }, [])

  const refreshImpersonation = useCallback(() => {
    setImpersonation(getImpersonationInfo())
  }, [])

  useEffect(() => {
    if (!resolveUseRealApi()) return
    const token = localStorage.getItem('vg_auth_token')
    if (!token) return
    fetchMe()
      .then((d) => setUser(d.user))
      .catch(() => {
        apiLogout()
        setUser(null)
        setImpersonation(null)
      })
  }, [])

  const orgRole = user?.orgRole || null
  const isOrgOwner = orgRole === 'OWNER' && !impersonation
  const isOrgSeller = orgRole === 'SELLER' && !impersonation

  const value = useMemo(
    () => ({
      user,
      login,
      setCurrentUser,
      logout,
      exitImpersonation,
      refreshImpersonation,
      impersonation,
      isImpersonating: Boolean(impersonation),
      isAuthenticated: !!user,
      isAdmin: user?.role === 'ADMIN' && !impersonation,
      org: user?.orgId ? { id: user.orgId, name: user.orgName || '' } : null,
      orgRole,
      isOrgOwner,
      isOrgSeller,
    }),
    [user, impersonation, exitImpersonation, refreshImpersonation, orgRole, isOrgOwner, isOrgSeller],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
