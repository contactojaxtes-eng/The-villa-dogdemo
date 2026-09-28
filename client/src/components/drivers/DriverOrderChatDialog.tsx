import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Eye, FileText, Image as ImageIcon, Loader2, MessageSquare, RefreshCw, X } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export interface DriverChatOrder {
  id: string
  orderNumber: number
  customerName: string
  status: string
  paymentMethod: string
  paymentStatus: string
}

interface DriverChatMessage {
  id: string
  direction: 'IN' | 'OUT' | string
  content: string
  messageType: string
  status?: string | null
  createdAt: string
  replyToContent?: string | null
  replyToDirection?: string | null
  hasMedia?: boolean
}

interface DriverChatProof {
  id: string
  status: string
  method: string
  amount?: number | null
  originalName?: string | null
  mimeType?: string | null
  fileSize?: number | null
  purgedAt?: string | null
  createdAt: string
}

interface DriverChatPage {
  hasPrevious: boolean
  before: string | null
  beforeId: string | null
  limit: number
}

interface DriverChatResponse {
  messages?: DriverChatMessage[]
  transferProofs?: DriverChatProof[]
  messagePage?: DriverChatPage | null
}

export interface DriverChatLiveEvent {
  orderId: string
  message: DriverChatMessage
}

interface CachedImage {
  url: string
  bytes: number
  refs: number
  lastUsed: number
}

interface ImageCacheState {
  entries: Map<string, CachedImage>
  pending: Map<string, Promise<CachedImage>>
}

const MAX_CACHED_IMAGES = 30
const MAX_CACHED_BYTES = 24 * 1024 * 1024

function cacheBytes(cache: ImageCacheState) {
  let bytes = 0
  cache.entries.forEach(entry => { bytes += entry.bytes })
  return bytes
}

function pruneImageCache(cache: ImageCacheState) {
  if (cache.entries.size <= MAX_CACHED_IMAGES && cacheBytes(cache) <= MAX_CACHED_BYTES) return
  const removable = [...cache.entries.entries()]
    .filter(([, entry]) => entry.refs === 0)
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed)

  for (const [key, entry] of removable) {
    if (cache.entries.size <= MAX_CACHED_IMAGES && cacheBytes(cache) <= MAX_CACHED_BYTES) break
    URL.revokeObjectURL(entry.url)
    cache.entries.delete(key)
  }
}

async function acquireImage(cache: ImageCacheState, endpoint: string) {
  const cached = cache.entries.get(endpoint)
  if (cached) {
    cached.refs += 1
    cached.lastUsed = Date.now()
    return cached.url
  }

  let pending = cache.pending.get(endpoint)
  if (!pending) {
    pending = api.getBlob(endpoint)
      .then(blob => {
        if (!blob || blob.size === 0) throw new Error('Imagen vacía')
        const entry: CachedImage = {
          url: URL.createObjectURL(blob),
          bytes: blob.size,
          refs: 0,
          lastUsed: Date.now(),
        }
        cache.entries.set(endpoint, entry)
        return entry
      })
      .finally(() => cache.pending.delete(endpoint))
    cache.pending.set(endpoint, pending)
  }

  const entry = await pending
  entry.refs += 1
  entry.lastUsed = Date.now()
  pruneImageCache(cache)
  return entry.url
}

function releaseImage(cache: ImageCacheState, endpoint: string) {
  const entry = cache.entries.get(endpoint)
  if (!entry) return
  entry.refs = Math.max(0, entry.refs - 1)
  entry.lastUsed = Date.now()
  pruneImageCache(cache)
}

function clearImageCache(cache: ImageCacheState) {
  cache.entries.forEach(entry => URL.revokeObjectURL(entry.url))
  cache.entries.clear()
  cache.pending.clear()
}

function LazyPrivateImage({
  endpoint,
  alt,
  className,
  cache,
  eager = false,
  onClick,
}: {
  endpoint: string
  alt: string
  className?: string
  cache: ImageCacheState
  eager?: boolean
  onClick?: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cachedUrl = cache.entries.get(endpoint)?.url || ''
  const [visible, setVisible] = useState(eager || Boolean(cachedUrl))
  const [url, setUrl] = useState(cachedUrl)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (visible || eager) return
    const element = containerRef.current
    if (!element || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      setVisible(true)
      observer.disconnect()
    }, { rootMargin: '180px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [eager, visible])

  useEffect(() => {
    if (!visible) return
    let active = true
    let retained = false
    void acquireImage(cache, endpoint)
      .then(nextUrl => {
        if (!active) {
          releaseImage(cache, endpoint)
          return
        }
        retained = true
        setUrl(nextUrl)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
      if (retained) releaseImage(cache, endpoint)
    }
  }, [cache, endpoint, visible])

  return (
    <div ref={containerRef} className={cn('relative overflow-hidden bg-[var(--bg-elevated)]', className)}>
      {!visible || (!url && !failed) ? (
        <div className="flex h-full min-h-24 w-full items-center justify-center">
          {visible ? <Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" /> : <ImageIcon className="h-5 w-5 text-[var(--text-muted)]" />}
        </div>
      ) : failed ? (
        <div className="flex h-full min-h-24 w-full flex-col items-center justify-center gap-1 p-3 text-center text-[var(--text-muted)]">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <span className="text-[10px] font-bold">Imagen no disponible</span>
        </div>
      ) : (
        <button type="button" onClick={onClick} className="group block h-full w-full cursor-zoom-in">
          <img src={url} alt={alt} loading="lazy" decoding="async" className="h-full w-full object-contain" />
          {onClick && <span className="absolute right-2 top-2 rounded-lg bg-black/65 p-1.5 text-white opacity-80 transition group-hover:opacity-100"><Eye className="h-3.5 w-3.5" /></span>}
        </button>
      )}
    </div>
  )
}

function PrivateAttachment({
  endpoint,
  type,
  cache,
}: {
  endpoint: string
  type: string
  cache: ImageCacheState
}) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const retainedRef = useRef(false)

  useEffect(() => () => {
    if (retainedRef.current) releaseImage(cache, endpoint)
  }, [cache, endpoint])

  const load = async () => {
    if (url || loading) return
    setLoading(true)
    setFailed(false)
    try {
      const nextUrl = await acquireImage(cache, endpoint)
      retainedRef.current = true
      setUrl(nextUrl)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  if (url && type === 'audio') {
    return <audio controls preload="metadata" src={url} className="mb-2 h-10 w-full min-w-56" />
  }
  if (url && type === 'video') {
    return <video controls preload="metadata" src={url} className="mb-2 max-h-64 w-full min-w-52 rounded-xl bg-black" />
  }
  if (url) {
    return <a href={url} target="_blank" rel="noreferrer" className="mb-2 flex items-center gap-2 rounded-xl bg-black/10 px-3 py-2 text-xs font-black underline"><FileText className="h-4 w-4" /> Abrir archivo adjunto</a>
  }

  return (
    <button type="button" onClick={() => void load()} disabled={loading} className="mb-2 flex w-full items-center gap-2 rounded-xl bg-black/10 px-3 py-2 text-left text-xs font-black disabled:opacity-60">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
      {failed ? 'Reintentar archivo' : type === 'audio' ? 'Escuchar nota de voz' : type === 'video' ? 'Ver video' : 'Abrir archivo adjunto'}
    </button>
  )
}

function messageTime(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function mergeMessages(...groups: DriverChatMessage[][]) {
  const byId = new Map<string, DriverChatMessage>()
  groups.flat().forEach(message => {
    if (message?.id) byId.set(message.id, message)
  })
  return [...byId.values()].sort((left, right) => {
    const timeDifference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
    return timeDifference || left.id.localeCompare(right.id)
  })
}

export function DriverOrderChatDialog({
  order,
  onClose,
  liveEvents,
}: {
  order: DriverChatOrder | null
  onClose: () => void
  liveEvents: DriverChatLiveEvent[]
}) {
  const [messages, setMessages] = useState<DriverChatMessage[]>([])
  const [proofs, setProofs] = useState<DriverChatProof[]>([])
  const [page, setPage] = useState<DriverChatPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ endpoint: string; alt: string } | null>(null)
  const requestIdRef = useRef(0)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [imageCache] = useState<ImageCacheState>(() => ({ entries: new Map(), pending: new Map() }))
  const orderId = order?.id || ''
  const liveMessages = liveEvents
    .filter(event => event?.orderId === orderId && event.message?.id)
    .map(event => event.message)
  const displayedMessages = mergeMessages(messages, liveMessages)
  const latestLiveMessageId = liveMessages[liveMessages.length - 1]?.id || ''

  const scrollToBottom = useCallback(() => {
    window.requestAnimationFrame(() => {
      const viewport = viewportRef.current
      if (viewport) viewport.scrollTop = viewport.scrollHeight
    })
  }, [])

  const loadChat = useCallback(async () => {
    if (!orderId) return
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError('')
    setMessages([])
    setProofs([])
    setPage(null)
    try {
      const response = await api.get<DriverChatResponse>(`/delivery-drivers/me/orders/${orderId}/chat?limit=20`, { force: true, ttlMs: 0 })
      if (requestId !== requestIdRef.current) return
      const loadedMessages = Array.isArray(response.messages) ? response.messages : []
      setMessages(loadedMessages)
      setProofs(Array.isArray(response.transferProofs) ? response.transferProofs : [])
      setPage(response.messagePage || null)
      scrollToBottom()
    } catch (error: unknown) {
      if (requestId === requestIdRef.current) setError(errorText(error, 'No se pudo cargar el chat de este pedido.'))
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [orderId, scrollToBottom])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (orderId) void loadChat()
      else {
        setMessages([])
        setProofs([])
        setPage(null)
        setError('')
        setPreview(null)
      }
    }, 0)
    return () => {
      window.clearTimeout(timer)
      requestIdRef.current += 1
    }
  }, [loadChat, orderId])

  useEffect(() => () => clearImageCache(imageCache), [imageCache])

  useEffect(() => {
    if (latestLiveMessageId) scrollToBottom()
  }, [latestLiveMessageId, scrollToBottom])

  const loadOlder = async () => {
    if (!order || loadingOlder || !page?.hasPrevious || !page.before) return
    const previousHeight = viewportRef.current?.scrollHeight || 0
    setLoadingOlder(true)
    try {
      const params = new URLSearchParams({ limit: '20', before: page.before })
      if (page.beforeId) params.set('beforeId', page.beforeId)
      const response = await api.get<DriverChatResponse>(`/delivery-drivers/me/orders/${order.id}/chat?${params.toString()}`, { force: true, ttlMs: 0 })
      const older = Array.isArray(response.messages) ? response.messages : []
      setMessages(current => {
        const ids = new Set(current.map(message => message.id))
        return [...older.filter(message => !ids.has(message.id)), ...current]
      })
      setPage(response.messagePage || null)
      window.requestAnimationFrame(() => {
        const viewport = viewportRef.current
        if (viewport) viewport.scrollTop += Math.max(0, viewport.scrollHeight - previousHeight)
      })
    } catch (error: unknown) {
      setError(errorText(error, 'No se pudo cargar el historial anterior.'))
    } finally {
      setLoadingOlder(false)
    }
  }

  const proofEndpoint = (proofId: string) => `/delivery-drivers/me/orders/${order?.id}/proofs/${proofId}/image`
  const mediaEndpoint = (messageId: string) => `/delivery-drivers/me/orders/${order?.id}/chat/messages/${messageId}/media`

  return (
    <>
      <Dialog open={Boolean(order)} onOpenChange={open => { if (!open) onClose() }}>
        <DialogContent className="flex max-h-[94vh] max-w-2xl flex-col overflow-hidden rounded-3xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-0">
          <div className="shrink-0 border-b border-[var(--border-subtle)] p-5 pr-12">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg font-black"><MessageSquare className="h-5 w-5 text-emerald-600" /> Chat del pedido #{order?.orderNumber}</DialogTitle>
              <DialogDescription>Consulta lo que habló el cliente y sus comprobantes. Esta vista es únicamente de lectura.</DialogDescription>
            </DialogHeader>
          </div>

          {proofs.length > 0 && (
            <section className="shrink-0 border-b border-blue-500/20 bg-blue-500/[0.06] px-4 py-3">
              <p className="mb-2 text-[11px] font-black uppercase tracking-wide text-blue-700 dark:text-blue-200">Comprobantes registrados ({proofs.length})</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {proofs.map((proof, index) => {
                  const endpoint = proofEndpoint(proof.id)
                  return (
                    <LazyPrivateImage
                      key={proof.id}
                      endpoint={endpoint}
                      alt={`Comprobante ${index + 1}`}
                      cache={imageCache}
                      onClick={() => setPreview({ endpoint, alt: `Comprobante ${index + 1} del pedido #${order?.orderNumber}` })}
                      className="h-24 w-24 shrink-0 rounded-xl border border-blue-500/25"
                    />
                  )
                })}
              </div>
            </section>
          )}

          <div ref={viewportRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[var(--bg-subtle)] p-4 sm:p-5">
            {loading ? (
              <div className="flex min-h-52 flex-col items-center justify-center gap-2 text-[var(--text-secondary)]"><Loader2 className="h-6 w-6 animate-spin text-[var(--accent)]" /><p className="text-xs font-bold">Cargando conversación…</p></div>
            ) : error && displayedMessages.length === 0 ? (
              <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-rose-500/30 bg-rose-500/[0.06] p-6 text-center"><AlertTriangle className="h-7 w-7 text-rose-500" /><p className="mt-2 text-sm font-black text-[var(--text-primary)]">No se pudo abrir el chat</p><p className="mt-1 text-xs text-[var(--text-secondary)]">{error}</p><Button variant="outline" onClick={() => void loadChat()} className="mt-4 h-9 rounded-xl text-xs font-black"><RefreshCw className="mr-1.5 h-4 w-4" /> Reintentar</Button></div>
            ) : displayedMessages.length === 0 ? (
              <div className="flex min-h-52 flex-col items-center justify-center text-center"><MessageSquare className="h-8 w-8 text-[var(--text-muted)]" /><p className="mt-2 text-sm font-black text-[var(--text-primary)]">Este pedido no tiene mensajes asociados</p><p className="mt-1 text-xs text-[var(--text-secondary)]">Si existe un comprobante registrado, aparecerá arriba.</p></div>
            ) : (
              <>
                {page?.hasPrevious && (
                  <div className="flex justify-center pb-1"><Button variant="outline" onClick={() => void loadOlder()} disabled={loadingOlder} className="h-8 rounded-xl px-3 text-[11px] font-black">{loadingOlder ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null} Cargar mensajes anteriores</Button></div>
                )}
                {error && <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-200">{error}</p>}
                {displayedMessages.map(message => {
                  const customer = message.direction === 'IN'
                  const isImage = message.hasMedia && ['image', 'sticker'].includes(message.messageType)
                  return (
                    <article key={message.id} className={cn('flex', customer ? 'justify-start' : 'justify-end')}>
                      <div className={cn('max-w-[88%] rounded-2xl border p-3 shadow-xs sm:max-w-[76%]', customer ? 'rounded-tl-sm border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-primary)]' : 'rounded-tr-sm border-emerald-500/30 bg-emerald-600 text-white')}>
                        <p className="mb-1 text-[9px] font-black uppercase tracking-wide opacity-70">{customer ? order?.customerName || 'Cliente' : 'The Villa Dog'}</p>
                        {message.replyToContent && <p className={cn('mb-2 border-l-2 pl-2 text-[10px] opacity-75', customer ? 'border-emerald-500' : 'border-white/60')}>{message.replyToContent}</p>}
                        {isImage ? (() => {
                          const endpoint = mediaEndpoint(message.id)
                          return <LazyPrivateImage endpoint={endpoint} alt="Imagen enviada en el chat" cache={imageCache} onClick={() => setPreview({ endpoint, alt: 'Imagen enviada en el chat' })} className="mb-2 max-h-64 min-h-28 w-full min-w-44 rounded-xl border border-black/10" />
                        })() : message.hasMedia ? (
                          <PrivateAttachment endpoint={mediaEndpoint(message.id)} type={message.messageType} cache={imageCache} />
                        ) : null}
                        {message.content && <p className="whitespace-pre-wrap break-words text-xs leading-relaxed sm:text-sm">{message.content}</p>}
                        <p className={cn('mt-1.5 text-right font-mono text-[9px]', customer ? 'text-[var(--text-muted)]' : 'text-emerald-100')}>{messageTime(message.createdAt)}</p>
                      </div>
                    </article>
                  )
                })}
              </>
            )}
          </div>

          <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] px-5 py-3 text-center text-[11px] font-semibold text-[var(--text-muted)]">Solo lectura · no puedes responder ni modificar este chat</div>
        </DialogContent>
      </Dialog>

      {preview && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm" onClick={() => setPreview(null)}>
          <button type="button" onClick={() => setPreview(null)} className="absolute right-4 top-4 rounded-xl bg-white/15 p-2 text-white hover:bg-rose-600" aria-label="Cerrar imagen"><X className="h-6 w-6" /></button>
          <div className="max-h-[90vh] max-w-[94vw]" onClick={event => event.stopPropagation()}>
            <LazyPrivateImage endpoint={preview.endpoint} alt={preview.alt} cache={imageCache} eager className="max-h-[88vh] min-h-48 w-[min(92vw,900px)] rounded-2xl bg-black/30" />
          </div>
        </div>
      )}
    </>
  )
}
