import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { io } from '@/lib/socket'
import { api } from '../lib/api'
import { hasUserPermission } from '../lib/permissions'

interface User {
  id: string
  name: string
  email: string
  role: string
  permissions?: string[] | null
  phone?: string
  photo?: string
  mustVerifyEmail?: boolean
  emailVerified?: boolean
}

const IMPERSONATION_KEY = 'niche_impersonation_original'

interface StashedSession {
  accessToken: string
  refreshToken: string | null
}

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string, role?: string) => Promise<void>
  logout: () => void
  isAuthenticated: boolean
  hasRole: (...roles: string[]) => boolean
  hasPermission: (permKey: string) => boolean
  refreshProfile: () => Promise<void>
  updateCurrentUser: (user: User) => void
  forgotPassword: (email: string) => Promise<{ message: string }>
  resetPassword: (token: string, newPassword: string) => Promise<{ message: string }>
  updateProfile: (data: { name?: string; phone?: string; photo?: string }) => Promise<void>
  requestEmailChange: (newEmail: string) => Promise<{ step: number; requiresOtp: boolean; sentTo: string; currentEmail?: string; newEmail: string; message: string }>
  verifyCurrentEmailStep1: (newEmail: string, otpCode: string) => Promise<{ success: boolean; step: number; sentTo: string; newEmail: string; message: string }>
  confirmNewEmailStep2: (newEmail: string, otpCode: string) => Promise<{ success: boolean; message: string; user: User }>
  unlockAccount: (email: string, otpCode: string) => Promise<{ success: boolean; message: string; user?: User }>
  changeOwnPassword: (currentPassword: string, newPassword: string) => Promise<{ message: string; requiresOtp?: boolean; sentTo?: string }>
  requestPasswordChange: (currentPassword: string, newPassword: string) => Promise<{ success: boolean; requiresOtp: boolean; sentTo: string; message: string }>
  confirmPasswordChange: (currentPassword: string, newPassword: string, otpCode: string) => Promise<{ success: boolean; message: string }>
  isImpersonating: boolean
  startImpersonation: (userId: string) => Promise<void>
  stopImpersonation: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [isImpersonating, setIsImpersonating] = useState(false)
  const navigate = useNavigate()

  const refreshProfile = useCallback(async () => {
    const token = api.getToken()
    if (!token) return
    try {
      const profile = await api.get<User>('/auth/profile')
      setUser(profile)
    } catch (err) {
      console.error('Error al sincronizar perfil de usuario:', err)
    }
  }, [])

  useEffect(() => {
    setIsImpersonating(!!sessionStorage.getItem(IMPERSONATION_KEY))
    const token = api.getToken()
    if (token) {
      api.get<User>('/auth/profile')
        .then(setUser)
        .catch(() => api.clearToken())
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  // Escuchar cambios solo con una sesión autenticada.
  useEffect(() => {
    // El portal del domiciliario consulta únicamente sus pedidos privados.
    // No abre el canal global de operaciones para no recibir eventos ajenos.
    if (!user?.id || user.role === 'DELIVERY_DRIVER') return
    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      transports: ['websocket', 'polling'],
    })

    socket.on('usersChanged', () => {
      refreshProfile()
    })

    return () => {
      socket.disconnect()
    }
  }, [refreshProfile, user?.id, user?.role])

  const login = async (email: string, password: string) => {
    const data = await api.post<{ accessToken: string; refreshToken: string; user: User }>('/auth/login', { email, password })
    sessionStorage.removeItem(IMPERSONATION_KEY)
    setIsImpersonating(false)
    api.setTokens(data.accessToken, data.refreshToken)
    setUser(data.user)
  }

  const register = async (name: string, email: string, password: string, role?: string) => {
    const data = await api.post<{ accessToken: string; refreshToken: string; user: User }>('/auth/register', { name, email, password, role })
    api.setTokens(data.accessToken, data.refreshToken)
    setUser(data.user)
  }

  const logout = () => {
    sessionStorage.removeItem(IMPERSONATION_KEY)
    setIsImpersonating(false)
    api.clearToken()
    setUser(null)
    navigate('/login', { replace: true })
  }

  const hasRole = (...roles: string[]) => {
    if (!user) return false
    if (user.role === 'SUPERADMIN') return true
    return roles.includes(user.role)
  }

  const hasPermission = (permKey: string): boolean => {
    return hasUserPermission(user, permKey)
  }

  const forgotPassword = (email: string) => {
    return api.post<{ message: string }>('/auth/forgot-password', { email })
  }

  const resetPassword = (token: string, newPassword: string) => {
    return api.post<{ message: string }>('/auth/reset-password', { token, newPassword })
  }

  const updateProfile = async (data: { name?: string; email?: string; phone?: string; photo?: string }) => {
    const updated = await api.patch<User>('/auth/profile', data)
    setUser(updated)
  }

  const requestEmailChange = async (newEmail: string) => {
    const res = await api.post<{ step: number; requiresOtp: boolean; sentTo: string; currentEmail?: string; newEmail: string; email?: string; message: string; user?: User }>('/auth/profile/request-email-change', { newEmail })
    if (res.user) setUser(res.user)
    return res
  }

  const verifyCurrentEmailStep1 = (newEmail: string, otpCode: string) => {
    return api.post<{ success: boolean; step: number; sentTo: string; newEmail: string; message: string }>('/auth/profile/verify-current-email-step1', { newEmail, otpCode })
  }

  const confirmNewEmailStep2 = async (newEmail: string, otpCode: string) => {
    const res = await api.post<{ success: boolean; message: string; user: User }>('/auth/profile/confirm-new-email-step2', { newEmail, otpCode })
    if (res.user) {
      setUser(res.user)
    }
    return res
  }

  const unlockAccount = async (email: string, otpCode: string) => {
    const res = await api.post<{ success: boolean; message: string; accessToken: string; refreshToken?: string; user: User }>('/auth/unlock-account', { email, otpCode })
    if (res.accessToken && res.user) {
      api.setTokens(res.accessToken, res.refreshToken)
      setUser(res.user)
    }
    return res
  }

  const requestPasswordChange = (currentPassword: string, newPassword: string) => {
    return api.patch<{ success: boolean; requiresOtp: boolean; sentTo: string; message: string }>('/auth/profile/password', { currentPassword, newPassword })
  }

  const confirmPasswordChange = (currentPassword: string, newPassword: string, otpCode: string) => {
    return api.post<{ success: boolean; message: string }>('/auth/profile/confirm-password-change', { currentPassword, newPassword, otpCode })
  }

  const changeOwnPassword = (currentPassword: string, newPassword: string) => {
    return requestPasswordChange(currentPassword, newPassword)
  }

  const startImpersonation = async (userId: string) => {
    const original: StashedSession = { accessToken: api.getToken() || '', refreshToken: api.getRefreshToken() }
    const data = await api.post<{ accessToken: string; user: User }>(`/superadmin/impersonate/${userId}`)
    sessionStorage.setItem(IMPERSONATION_KEY, JSON.stringify(original))
    api.setAccessTokenOnly(data.accessToken)
    setUser(data.user)
    setIsImpersonating(true)
    navigate('/dashboard', { replace: true })
  }

  const stopImpersonation = async () => {
    const raw = sessionStorage.getItem(IMPERSONATION_KEY)
    if (!raw) return
    const original: StashedSession = JSON.parse(raw)
    sessionStorage.removeItem(IMPERSONATION_KEY)
    api.setTokens(original.accessToken, original.refreshToken || undefined)
    setIsImpersonating(false)
    try {
      const profile = await api.get<User>('/auth/profile')
      setUser(profile)
    } catch (err) {
      console.error('Failed to refresh profile after stop impersonation', err)
    }
    navigate('/superadmin', { replace: true })
  }

  return (
    <AuthContext.Provider value={{
      user, loading, login, register, logout, isAuthenticated: !!user, hasRole, hasPermission,
      refreshProfile, updateCurrentUser: (newUser: User) => setUser(newUser),
      forgotPassword, resetPassword, updateProfile, 
      requestEmailChange, verifyCurrentEmailStep1, confirmNewEmailStep2,
      unlockAccount,
      changeOwnPassword, requestPasswordChange, confirmPasswordChange,
      isImpersonating, startImpersonation, stopImpersonation,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
