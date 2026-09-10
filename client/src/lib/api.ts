const rawApiUrl = import.meta.env.VITE_API_URL || ''
const API_URL = (rawApiUrl.endsWith('/') ? rawApiUrl.slice(0, -1) : rawApiUrl) + '/api'

export class ApiError extends Error {
  status: number
  data: any
  isNetworkError: boolean

  constructor(message: string, status = 500, data: any = null, isNetworkError = false) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
    this.isNetworkError = isNetworkError
  }
}

class ApiClient {
  private token: string | null = null
  private refreshToken: string | null = null
  private refreshPromise: Promise<boolean> | null = null
  private getCache = new Map<string, { value: unknown; expiresAt: number; lastUsed: number }>()
  private getRequests = new Map<string, Promise<unknown>>()
  private readonly maxCachedGets = 160
  private cacheVersion = 0

  constructor() {
    this.token = localStorage.getItem('niche_token')
    this.refreshToken = localStorage.getItem('niche_refresh_token')
  }

  setToken(token: string) {
    if (this.token !== token) this.invalidateCache()
    this.token = token
    localStorage.setItem('niche_token', token)
  }

  clearToken() {
    this.token = null
    this.refreshToken = null
    localStorage.removeItem('niche_token')
    localStorage.removeItem('niche_refresh_token')
    this.invalidateCache()
  }

  setTokens(accessToken: string, refreshToken?: string) {
    if (this.token !== accessToken) this.invalidateCache()
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
    if (this.token !== accessToken) this.invalidateCache()
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
    } catch (netErr: any) {
      throw new ApiError('Error de conexión con el servidor. Verifica tu internet.', 0, null, true)
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
        } catch (netErr: any) {
          throw new ApiError('Error de conexión con el servidor.', 0, null, true)
        }
      } else {
        this.clearToken()
        if (window.location.pathname !== '/login') {
          window.location.href = '/login'
        }
        throw new ApiError('Sesión expirada', 401, null, false)
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Error en la respuesta del servidor' }))
      const message = Array.isArray(error.message) ? error.message.join(', ') : (error.message || 'Error del servidor')
      throw new ApiError(message, response.status, error, false)
    }

    if (responseType === 'blob') return response.blob() as Promise<T>
    if (response.status === 204) return undefined as T
    return response.json()
  }

  private getTtl(endpoint: string) {
    const path = endpoint.split('?')[0]
    if (path.startsWith('/kitchen/tickets')) return 0
    if (/^\/(menu\/categories|zones|users|roles|cash-registers|kitchen\/stations|kitchen\/settings)(\/|$)/.test(path)) return 2 * 60_000
    if (path === '/auth/profile') return 60_000
    if (/(history|audit|dashboard-stats|closing)/.test(path)) return 15_000
    if (path.startsWith('/whatsapp/')) return 1_500
    return 5_000
  }

  private pruneGetCache() {
    if (this.getCache.size <= this.maxCachedGets) return
    const oldest = [...this.getCache.entries()]
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed)
      .slice(0, this.getCache.size - this.maxCachedGets)
    oldest.forEach(([key]) => this.getCache.delete(key))
  }

  invalidateCache(prefixes?: string | string[]) {
    if (!prefixes) {
      this.getCache.clear()
      this.getRequests.clear()
      this.cacheVersion += 1
      return
    }
    const list = Array.isArray(prefixes) ? prefixes : [prefixes]
    const matchesPrefix = (endpoint: string) => list.some(prefix => endpoint.startsWith(prefix))
    let invalidated = false
    for (const key of this.getCache.keys()) {
      if (matchesPrefix(key)) {
        this.getCache.delete(key)
        invalidated = true
      }
    }
    // Si una petición vieja todavía está llegando, evitar que vuelva a llenar
    // la caché después de un evento de Socket.IO más reciente.
    for (const endpoint of this.getRequests.keys()) {
      if (matchesPrefix(endpoint)) {
        invalidated = true
        break
      }
    }
    if (invalidated) {
      this.cacheVersion += 1
    }
  }

  invalidateRealtimeEvent(event: string) {
    if (event.startsWith('whatsapp') || event.startsWith('chat')) {
      this.invalidateCache('/whatsapp/')
      return
    }
    if (event.startsWith('menu')) {
      this.invalidateCache(['/menu/', '/public/menu/'])
      return
    }
    if (event.includes('Payment') || event.startsWith('payment') || event.startsWith('cash')) {
      this.invalidateCache(['/payments', '/payment-validation', '/orders', '/tables', '/cash-registers', '/orders/dashboard-stats', '/kitchen/'])
      return
    }
    if (event.includes('Kitchen') || event.startsWith('kitchen')) {
      this.invalidateCache(['/kitchen/', '/orders', '/tables'])
      return
    }
    if (event.includes('Order') || event.startsWith('order')) {
      this.invalidateCache(['/orders', '/tables', '/kitchen/', '/payments', '/payment-validation', '/cash-registers', '/orders/dashboard-stats', '/whatsapp/sessions'])
      return
    }
    if (event.includes('Table') || event.startsWith('table')) {
      this.invalidateCache(['/tables', '/orders', '/kitchen/', '/payments', '/cash-registers'])
    }
  }

  private invalidateAfterMutation(endpoint: string) {
    const path = endpoint.split('?')[0]
    if (path.startsWith('/whatsapp/')) {
      this.invalidateCache('/whatsapp/')
    } else if (path.startsWith('/orders')) {
      this.invalidateCache(['/orders', '/tables', '/kitchen/', '/payments', '/payment-validation', '/cash-registers', '/orders/dashboard-stats', '/whatsapp/sessions'])
    } else if (path.startsWith('/tables')) {
      this.invalidateCache(['/tables', '/orders', '/kitchen/', '/payments', '/payment-validation', '/cash-registers'])
    } else if (path.startsWith('/payments') || path.startsWith('/payment-validation')) {
      this.invalidateCache(['/payments', '/payment-validation', '/orders', '/tables', '/cash-registers', '/orders/dashboard-stats', '/kitchen/'])
    } else if (path.startsWith('/menu')) {
      this.invalidateCache(['/menu/', '/public/menu/'])
    } else if (path.startsWith('/zones')) {
      this.invalidateCache(['/zones', '/public/zones'])
    } else if (path.startsWith('/users') || path.startsWith('/roles')) {
      this.invalidateCache(['/users', '/roles', '/kitchen/'])
    } else if (path.startsWith('/kitchen')) {
      this.invalidateCache(['/kitchen/', '/orders', '/tables'])
    } else if (path.startsWith('/cash-registers')) {
      this.invalidateCache(['/cash-registers', '/payments', '/orders', '/tables', '/kitchen/'])
    } else {
      this.invalidateCache(path.split('/').slice(0, 2).join('/'))
    }
  }

  get<T>(endpoint: string, options: { force?: boolean; ttlMs?: number } = {}) {
    const now = Date.now()
    const cached = this.getCache.get(endpoint)
    if (!options.force && cached && cached.expiresAt > now) {
      cached.lastUsed = now
      return Promise.resolve(cached.value as T)
    }

    const pending = this.getRequests.get(endpoint)
    if (pending) return pending as Promise<T>

    const requestVersion = this.cacheVersion
    const request = this.request<T>(endpoint)
      .then(value => {
        const ttl = options.ttlMs ?? this.getTtl(endpoint)
        if (ttl > 0 && requestVersion === this.cacheVersion) {
          this.getCache.set(endpoint, { value, expiresAt: Date.now() + ttl, lastUsed: Date.now() })
          this.pruneGetCache()
        }
        return value
      })
      .finally(() => {
        if (this.getRequests.get(endpoint) === request) this.getRequests.delete(endpoint)
      })

    this.getRequests.set(endpoint, request)
    return request
  }

  getBlob(endpoint: string) {
    return this.request<Blob>(endpoint, {}, 'blob')
  }

  post<T>(endpoint: string, data?: any, options: RequestInit = {}) {
    const body = data instanceof FormData ? data : (data !== undefined ? JSON.stringify(data) : undefined)
    return this.request<T>(endpoint, { ...options, method: 'POST', body })
      .then(result => { this.invalidateAfterMutation(endpoint); return result })
  }

  put<T>(endpoint: string, data?: any, options: RequestInit = {}) {
    const body = data instanceof FormData ? data : (data !== undefined ? JSON.stringify(data) : undefined)
    return this.request<T>(endpoint, { ...options, method: 'PUT', body })
      .then(result => { this.invalidateAfterMutation(endpoint); return result })
  }

  patch<T>(endpoint: string, data?: any) {
    return this.request<T>(endpoint, { method: 'PATCH', body: JSON.stringify(data) })
      .then(result => { this.invalidateAfterMutation(endpoint); return result })
  }

  delete<T>(endpoint: string) {
    return this.request<T>(endpoint, { method: 'DELETE' })
      .then(result => { this.invalidateAfterMutation(endpoint); return result })
  }
}

export const api = new ApiClient()
