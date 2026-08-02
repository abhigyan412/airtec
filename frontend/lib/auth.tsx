'use client'
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { authApi } from './api'

interface User {
  id: string
  full_name: string
  email: string
  role: string
  school_id: string
  schools?: {
    id: string
    name: string
    logo_url?: string
  }
}

interface AuthContextType {
  user: User | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<User>
  logout: () => void
  isRole: (...roles: string[]) => boolean
}

// Roles that get an ownership-scoped view of their own child's data
// (see backend NON_STAFF_ROLES) rather than the staff admin tooling —
// they land in the (portal) route group, not (app).
export const NON_STAFF_ROLES = ['parent', 'student']

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const queryClient = useQueryClient()

  useEffect(() => {
    const token = localStorage.getItem('airtec_token')
    if (!token) {
      setIsLoading(false)
      return
    }
    authApi.me()
      .then(res => setUser(res.data))
      .catch(() => {
        localStorage.removeItem('airtec_token')
        localStorage.removeItem('airtec_refresh_token')
        localStorage.removeItem('airtec_user')
      })
      .finally(() => setIsLoading(false))
  }, [])

  const login = async (email: string, password: string) => {
    const res = await authApi.login(email, password)
    // Query keys like ['teacher-dashboard'] and ['rbac-permissions-me']
    // aren't scoped by user id — logging in doesn't reload the page, so
    // without this, signing into a second account in the same tab (no
    // explicit logout first) would render whatever was cached for the
    // PREVIOUS account until each query happened to refetch on its own.
    // Wipe everything the instant a login succeeds, before it's used.
    queryClient.clear()
    localStorage.setItem('airtec_token', res.data.access_token)
    // Kept so the API client can silently re-auth when the hour-long
    // access token expires (see the 401 interceptor in lib/api.ts).
    if (res.data.refresh_token) localStorage.setItem('airtec_refresh_token', res.data.refresh_token)
    localStorage.setItem('airtec_user', JSON.stringify(res.data.user))
    setUser(res.data.user)
    return res.data.user as User
  }

  const logout = () => {
    localStorage.removeItem('airtec_token')
    localStorage.removeItem('airtec_refresh_token')
    localStorage.removeItem('airtec_user')
    setUser(null)
    window.location.href = '/auth/login'
  }

  const isRole = (...roles: string[]) => !!user && roles.includes(user.role)

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, isRole }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
