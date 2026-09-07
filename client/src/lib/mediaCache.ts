import { api } from './api'

type MediaEntry = {
  url: string
  bytes: number
  refs: number
  lastUsed: number
}

const mediaCache = new Map<string, MediaEntry>()
const pendingMedia = new Map<string, Promise<MediaEntry>>()
const MAX_MEDIA_ITEMS = 80
const MAX_MEDIA_BYTES = 48 * 1024 * 1024

const totalBytes = () => [...mediaCache.values()].reduce((sum, entry) => sum + entry.bytes, 0)

function pruneMediaCache() {
  if (mediaCache.size <= MAX_MEDIA_ITEMS && totalBytes() <= MAX_MEDIA_BYTES) return
  const candidates = [...mediaCache.entries()]
    .filter(([, entry]) => entry.refs === 0)
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed)

  for (const [key, entry] of candidates) {
    if (mediaCache.size <= MAX_MEDIA_ITEMS && totalBytes() <= MAX_MEDIA_BYTES) break
    URL.revokeObjectURL(entry.url)
    mediaCache.delete(key)
  }
}

export function peekWhatsappMediaUrl(mediaId: string) {
  const entry = mediaCache.get(mediaId)
  if (!entry) return null
  entry.lastUsed = Date.now()
  return entry.url
}

export async function acquireWhatsappMediaUrl(mediaId: string) {
  const cached = mediaCache.get(mediaId)
  if (cached) {
    cached.refs += 1
    cached.lastUsed = Date.now()
    return cached.url
  }

  let pending = pendingMedia.get(mediaId)
  if (!pending) {
    pending = api.getBlob(`/whatsapp/media/${encodeURIComponent(mediaId)}`)
      .then(blob => {
        if (!blob || blob.size === 0) throw new Error('Archivo multimedia vacío')
        const entry: MediaEntry = {
          url: URL.createObjectURL(blob),
          bytes: blob.size,
          refs: 0,
          lastUsed: Date.now(),
        }
        mediaCache.set(mediaId, entry)
        return entry
      })
      .finally(() => pendingMedia.delete(mediaId))
    pendingMedia.set(mediaId, pending)
  }

  const entry = await pending
  entry.refs += 1
  entry.lastUsed = Date.now()
  pruneMediaCache()
  return entry.url
}

export function releaseWhatsappMediaUrl(mediaId: string) {
  const entry = mediaCache.get(mediaId)
  if (!entry) return
  entry.refs = Math.max(0, entry.refs - 1)
  entry.lastUsed = Date.now()
  pruneMediaCache()
}
