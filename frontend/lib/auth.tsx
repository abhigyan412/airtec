'use client'
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
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
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  isRole: (...roles: string[]) => boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

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
        localStorage.removeItem('airtec_user')
      })
      .finally(() => setIsLoading(false))
  }, [])

  const login = async (email: string, password: string) => {
    const res = await authApi.login(email, password)
    localStorage.setItem('airtec_token', res.data.access_token)
    localStorage.setItem('airtec_user', JSON.stringify(res.data.user))
    setUser(res.data.user)
  }

  const logout = () => {
    localStorage.removeItem('airtec_token')
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
