const rawApiUrl = import.meta.env.VITE_API_URL || ''
const API_URL = (rawApiUrl.endsWith('/') ? rawApiUrl.slice(0, -1) : rawApiUrl) + '/api'

class ApiClient {
  private token: string | null = null
  private refreshToken: string | null = null
  private refreshPromise: Promise<boolean> | null = null

  constructor() {
    this.token = localStorage.getItem('niche_token')
    this.refreshToken = localStorage.getItem('niche_refresh_token')
  }

  setToken(token: string) {
    this.token = token
    localStorage.setItem('niche_token', token)
  }

  clearToken() {
    this.token = null
    this.refreshToken = null
    localStorage.removeItem('niche_token')
    localStorage.removeItem('niche_refresh_token')
  }

  setTokens(accessToken: string, refreshToken?: string) {
    this.token = accessToken
    localStorage.setItem('niche_token', accessToken)
    if (refreshToken && refreshToken !== 'undefined' && refreshToken !== 'null') {
      this.refreshToken = refreshToken
      localStorage.setItem('niche_refresh_token', refreshToken)
    }
  }

  // Usado por sesiones de impersonación: no tienen refreshToken propio, así que
  // si el access token expira se debe forzar logout en vez de refrescar de vuelta al SuperAdmin original.
  setAccessTokenOnly(accessToken: string) {
    this.token = accessToken
    this.refreshToken = null
    localStorage.setItem('niche_token', accessToken)
    localStorage.removeItem('niche_refresh_token')
  }

  getToken() {
    return this.token
  }

  getRefreshToken() {
    return this.refreshToken
  }

  refreshSession() {
    return this.performRefreshToken()
  }

  private async performRefreshToken(): Promise<boolean> {
    if (this.refreshPromise) {
      return this.refreshPromise
    }

    if (!this.refreshToken || this.refreshToken === 'undefined' || this.refreshToken === 'null') {
      return false
    }

    this.refreshPromise = (async () => {
      try {
        const refreshRes = await fetch(`${API_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: this.refreshToken }),
        })

        if (refreshRes.ok) {
          const refreshData = await refreshRes.json()
          this.setTokens(refreshData.accessToken, refreshData.refreshToken)
          return true
        }
        return false
      } catch {
        return false
      } finally {
        this.refreshPromise = null
      }
    })()

    return this.refreshPromise
  }

  private async request<T>(endpoint: string, options: RequestInit = {}, responseType: 'json' | 'blob' = 'json'): Promise<T> {
    const headers: Record<string, string> = {}
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json'
    }
    if (options.headers) {
      Object.assign(headers, options.headers)
    }

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    let response: Response
    try {
      response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers,
      })
    } catch (netErr) {
      throw new Error('Error de conexión con el servidor. Verifica tu internet.')
    }

    if (response.status === 401 && endpoint !== '/auth/login' && endpoint !== '/auth/refresh') {
      const refreshed = await this.performRefreshToken()
      if (refreshed && this.token) {
        headers['Authorization'] = `Bearer ${this.token}`
        try {
          response = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers,
          })
        } catch (netErr) {
          throw new Error('Error de conexión con el servidor.')
        }
      } else {
        this.clearToken()
        if (window.location.pathname !== '/login') {
          window.location.href = '/login'
        }
        throw new Error('Sesión expirada')
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Error de conexión' }))
      throw new Error(error.message || 'Error del servidor')
    }

    if (responseType === 'blob') return response.blob() as Promise<T>
    if (response.status === 204) return undefined as T
    return response.json()
  }

  get<T>(endpoint: string) {
    return this.request<T>(endpoint)
  }

  getBlob(endpoint: string) {
    return this.request<Blob>(endpoint, {}, 'blob')
  }

  post<T>(endpoint: string, data?: any, options: RequestInit = {}) {
    const body = data instanceof FormData ? data : (data !== undefined ? JSON.stringify(data) : undefined)
    return this.request<T>(endpoint, { ...options, method: 'POST', body })
  }

  put<T>(endpoint: string, data?: any, options: RequestInit = {}) {
    const body = data instanceof FormData ? data : (data !== undefined ? JSON.stringify(data) : undefined)
    return this.request<T>(endpoint, { ...options, method: 'PUT', body })
  }

  patch<T>(endpoint: string, data?: any) {
    return this.request<T>(endpoint, { method: 'PATCH', body: JSON.stringify(data) })
  }

  delete<T>(endpoint: string) {
    return this.request<T>(endpoint, { method: 'DELETE' })
  }
}

export const api = new ApiClient()
