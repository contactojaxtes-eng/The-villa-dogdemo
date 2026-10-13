export const DEFAULT_SITE_ID = '00000000-0000-4000-8000-000000000101'

export function scopedStorageKey(base: string, siteId?: string | null) {
  return `${base}:${siteId || DEFAULT_SITE_ID}`
}

function decodeAccessToken(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null
  try {
    const encoded = token.split('.')[1]
    if (!encoded) return null
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

export function getAccessTokenSiteId(token: string | null | undefined): string | null {
  const payload = decodeAccessToken(token)
  return typeof payload?.siteId === 'string' && payload.siteId.trim()
    ? payload.siteId.trim()
    : null
}

export function getAccessTokenContextKey(token: string | null | undefined): string | null {
  const payload = decodeAccessToken(token)
  if (!payload) return null
  const userId = typeof payload.sub === 'string' ? payload.sub.trim() : ''
  if (!userId) return null
  const siteId = typeof payload.siteId === 'string' && payload.siteId.trim()
    ? payload.siteId.trim()
    : DEFAULT_SITE_ID
  const impersonatedBy = typeof payload.impersonatedBy === 'string'
    ? payload.impersonatedBy.trim()
    : ''
  return `${userId}:${siteId}:${impersonatedBy}`
}

export function accessTokenMatchesSite(token: string | null | undefined, siteId: string) {
  if (!token) return false
  const tokenSiteId = getAccessTokenSiteId(token)
  // Compatibilidad temporal con sesiones antiguas de la sede principal, cuyos
  // JWT fueron emitidos antes de que existiera el claim siteId.
  return tokenSiteId ? tokenSiteId === siteId : siteId === DEFAULT_SITE_ID
}
