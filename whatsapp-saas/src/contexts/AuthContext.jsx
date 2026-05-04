import { createContext, useContext, useMemo, useState } from 'react'
import { loadSessionFromStorage, logout as apiLogout } from '../services/api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => loadSessionFromStorage())

  const login = (u) => setUser(u)
  const logout = () => {
    apiLogout()
    setUser(null)
  }

  const value = useMemo(() => ({ user, login, logout, isAuthenticated: !!user }), [user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
