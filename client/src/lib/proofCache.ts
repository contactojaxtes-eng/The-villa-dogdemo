import { api } from './api'

type ProofEntry = {
  url: string
  bytes: number
  refs: number
  lastUsed: number
}

const proofCache = new Map<string, ProofEntry>()
const pendingProofs = new Map<string, Promise<ProofEntry>>()
const negativeProofCache = new Map<string, number>() // endpoint -> expiresAt
const MAX_PROOF_ITEMS = 40
const MAX_PROOF_BYTES = 32 * 1024 * 1024
const NEGATIVE_TTL_MS = 15 * 60 * 1000
const MAX_NEGATIVE_ITEMS = 100

const totalBytes = () => [...proofCache.values()].reduce((sum, entry) => sum + entry.bytes, 0)

function pruneProofCache() {
  if (proofCache.size <= MAX_PROOF_ITEMS && totalBytes() <= MAX_PROOF_BYTES) return
  const candidates = [...proofCache.entries()]
    .filter(([, entry]) => entry.refs === 0)
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed)

  for (const [key, entry] of candidates) {
    if (proofCache.size <= MAX_PROOF_ITEMS && totalBytes() <= MAX_PROOF_BYTES) break
    URL.revokeObjectURL(entry.url)
    proofCache.delete(key)
  }
}

function pruneNegativeCache() {
  const now = Date.now()
  for (const [k, exp] of negativeProofCache.entries()) {
    if (exp <= now) negativeProofCache.delete(k)
  }
  if (negativeProofCache.size > MAX_NEGATIVE_ITEMS) {
    const oldest = [...negativeProofCache.keys()].slice(0, 30)
    for (const k of oldest) negativeProofCache.delete(k)
  }
}

export function peekProofUrl(endpoint: string): string | null {
  const entry = proofCache.get(endpoint)
  if (!entry) return null
  entry.lastUsed = Date.now()
  return entry.url
}

export async function acquireProofUrl(endpoint: string): Promise<string> {
  const now = Date.now()
  const negExp = negativeProofCache.get(endpoint)
  if (negExp && negExp > now) {
    throw new Error('Comprobante no disponible (404)')
  }

  const cached = proofCache.get(endpoint)
  if (cached) {
    cached.refs += 1
    cached.lastUsed = Date.now()
    return cached.url
  }

  let pending = pendingProofs.get(endpoint)
  if (!pending) {
    pending = api.getBlob(endpoint)
      .then(blob => {
        if (!blob || blob.size === 0) {
          negativeProofCache.set(endpoint, Date.now() + NEGATIVE_TTL_MS)
          pruneNegativeCache()
          throw new Error('Comprobante vacío o no disponible')
        }
        negativeProofCache.delete(endpoint)
        const entry: ProofEntry = {
          url: URL.createObjectURL(blob),
          bytes: blob.size,
          refs: 0,
          lastUsed: Date.now(),
        }
        proofCache.set(endpoint, entry)
        return entry
      })
      .catch(err => {
        negativeProofCache.set(endpoint, Date.now() + NEGATIVE_TTL_MS)
        pruneNegativeCache()
        throw err
      })
      .finally(() => pendingProofs.delete(endpoint))
    pendingProofs.set(endpoint, pending)
  }

  const entry = await pending
  entry.refs += 1
  entry.lastUsed = Date.now()
  pruneProofCache()
  return entry.url
}

export function releaseProofUrl(endpoint: string): void {
  const entry = proofCache.get(endpoint)
  if (!entry) return
  entry.refs = Math.max(0, entry.refs - 1)
  entry.lastUsed = Date.now()
  pruneProofCache()
}

export function clearProofCache(): void {
  for (const entry of proofCache.values()) {
    try {
      URL.revokeObjectURL(entry.url)
    } catch {}
  }
  proofCache.clear()
  pendingProofs.clear()
  negativeProofCache.clear()
}
