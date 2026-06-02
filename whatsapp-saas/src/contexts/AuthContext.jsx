import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { loadSessionFromStorage, logout as apiLogout, fetchMe } from '../services/api.js'
import { resolveUseRealApi } from '../lib/runtimeEnv.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => loadSessionFromStorage())

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
  }

  useEffect(() => {
    if (!resolveUseRealApi()) return
    const token = localStorage.getItem('vg_auth_token')
    if (!token) return
    fetchMe()
      .then((d) => setUser(d.user))
      .catch(() => {
        apiLogout()
        setUser(null)
      })
  }, [])

  const value = useMemo(
    () => ({
      user,
      login,
      setCurrentUser,
      logout,
      isAuthenticated: !!user,
      isAdmin: user?.role === 'ADMIN',
    }),
    [user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
