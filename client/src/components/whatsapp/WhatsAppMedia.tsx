import React, { useState, useEffect, useRef } from 'react'
import {
  Loader2,
  AlertCircle,
  Eye,
  Download,
  RotateCw,
  ZoomIn,
  ZoomOut,
  X,
  FileText,
} from 'lucide-react'
import {
  acquireWhatsappMediaUrl,
  peekWhatsappMediaUrl,
  releaseWhatsappMediaUrl,
} from '@/lib/mediaCache'

interface WhatsAppMediaProps {
  mediaId: string
  type: 'image' | 'audio' | 'video'
}

export function WhatsAppMedia({ mediaId, type }: WhatsAppMediaProps) {
  const safeMediaId = typeof mediaId === 'string' ? mediaId : String(mediaId || '')
  const rawMediaId = safeMediaId.split('|')[0] || ''
  const cleanMediaId = rawMediaId.includes('/') ? (rawMediaId.split('/').pop() || rawMediaId) : rawMediaId
  const captionText = safeMediaId.includes('|') ? safeMediaId.split('|').slice(1).join('|') : ''
  const containerRef = useRef<HTMLDivElement | null>(null)
  const cachedSrc = peekWhatsappMediaUrl(cleanMediaId)
  const [isVisible, setIsVisible] = useState(Boolean(cachedSrc))
  const [src, setSrc] = useState<string | null>(cachedSrc)
  const [loading, setLoading] = useState(!cachedSrc)
  const [error, setError] = useState(false)
  const [isZoomed, setIsZoomed] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    if (isVisible) return
    const el = containerRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some(e => e.isIntersecting)) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '250px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [isVisible])

  useEffect(() => {
    if (!isVisible) return
    let active = true
    let retained = false

    const fetchMedia = async () => {
      try {
        setError(false)
        if (!peekWhatsappMediaUrl(cleanMediaId)) setLoading(true)
        const url = await acquireWhatsappMediaUrl(cleanMediaId)
        if (!active) {
          releaseWhatsappMediaUrl(cleanMediaId)
          return
        }
        retained = true
        setSrc(url)
      } catch (err) {
        if (active) setError(true)
      } finally {
        if (active) setLoading(false)
      }
    }

    fetchMedia()

    return () => {
      active = false
      if (retained) releaseWhatsappMediaUrl(cleanMediaId)
    }
  }, [cleanMediaId, isVisible])

  const handleCloseZoom = () => {
    setIsZoomed(false)
    setRotation(0)
    setScale(1)
  }

  useEffect(() => {
    if (!isZoomed) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCloseZoom()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isZoomed])

  if (!isVisible) {
    return (
      <div ref={containerRef} className="flex items-center justify-center p-3 bg-[var(--bg-elevated)]/20 rounded-xl min-h-[50px] animate-pulse">
        <span className="text-[10px] font-medium text-[var(--text-secondary)]">Multimedia en espera...</span>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="space-y-1.5 max-w-full">
      {loading ? (
        <div className="flex items-center justify-center p-3 bg-[var(--bg-elevated)]/30 rounded-xl">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
          <span className="text-[10px] ml-2 font-medium text-[var(--text-secondary)]">Cargando multimedia...</span>
        </div>
      ) : error || !src ? (
        <div className="flex items-center gap-1.5 p-2.5 bg-red-500/10 text-red-500 rounded-xl text-[10px] font-semibold border border-red-500/20">
          <AlertCircle className="h-3.5 w-3.5" />
          <span>Error al cargar multimedia</span>
        </div>
      ) : type === 'image' ? (
        <>
          <div className="relative group overflow-hidden rounded-xl border border-[var(--border-subtle)]/40 max-w-full">
            <img 
              src={src} 
              alt="WhatsApp Image" 
              className="max-h-64 object-contain rounded-xl w-full cursor-zoom-in transition-transform duration-200 hover:scale-[1.02] bg-black/5 dark:bg-black/40"
              onClick={() => setIsZoomed(true)}
            />
            <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setIsZoomed(true)
                }}
                className="p-1.5 rounded-lg bg-black/70 hover:bg-black text-white shadow-md transition-all cursor-pointer text-[10px] font-bold"
                title="Ver en grande y verificar comprobante"
              >
                <Eye className="h-3.5 w-3.5" />
              </button>
              <a
                href={src}
                download={`whatsapp-imagen-${Date.now()}.jpg`}
                onClick={(e) => e.stopPropagation()}
                className="p-1.5 rounded-lg bg-black/70 hover:bg-black text-white shadow-md transition-all cursor-pointer flex items-center gap-1 text-[10px] font-bold"
                title="Descargar Imagen"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Descargar</span>
              </a>
            </div>
          </div>

          {/* Modal In-App: Visor de foto en grande sin salir */}
          {isZoomed && (
            <div 
              className="fixed inset-0 z-[99999] bg-black/85 backdrop-blur-md flex flex-col items-center justify-between p-4 select-none animate-in fade-in duration-200"
              onClick={handleCloseZoom}
            >
              {/* Barra superior de herramientas */}
              <div 
                className="w-full max-w-3xl flex items-center justify-between py-2 px-4 rounded-2xl bg-black/75 border border-white/15 text-white backdrop-blur-md shadow-2xl z-10"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold tracking-wide text-white/90">Comprobante / Foto del Pedido</span>
                  {captionText && <span className="text-[11px] text-white/60 truncate max-w-xs">• {captionText}</span>}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setRotation(r => (r + 90) % 360)}
                    className="p-2 rounded-xl hover:bg-white/15 text-white/80 hover:text-white transition-colors cursor-pointer"
                    title="Rotar 90°"
                  >
                    <RotateCw className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setScale(s => Math.max(0.5, s - 0.25))}
                    className="p-2 rounded-xl hover:bg-white/15 text-white/80 hover:text-white transition-colors cursor-pointer"
                    title="Alejar"
                  >
                    <ZoomOut className="h-4 w-4" />
                  </button>
                  <span className="text-[11px] font-mono font-bold text-white/70 w-10 text-center">
                    {Math.round(scale * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setScale(s => Math.min(4, s + 0.25))}
                    className="p-2 rounded-xl hover:bg-white/15 text-white/80 hover:text-white transition-colors cursor-pointer"
                    title="Acercar"
                  >
                    <ZoomIn className="h-4 w-4" />
                  </button>
                  <a
                    href={src}
                    download={`whatsapp-imagen-${Date.now()}.jpg`}
                    className="p-2 rounded-xl hover:bg-white/15 text-white/80 hover:text-white transition-colors cursor-pointer ml-1"
                    title="Descargar a tu equipo"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                  <button
                    type="button"
                    onClick={handleCloseZoom}
                    className="p-2 ml-2 rounded-xl bg-white/15 hover:bg-red-500 text-white transition-colors cursor-pointer"
                    title="Cerrar (Esc)"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Contenedor central de la foto con rotación y zoom */}
              <div 
                className="flex-1 w-full flex items-center justify-center overflow-hidden py-4 cursor-default"
                onClick={handleCloseZoom}
              >
                <img 
                  src={src} 
                  alt="WhatsApp Preview" 
                  style={{
                    transform: `rotate(${rotation}deg) scale(${scale})`,
                    transition: 'transform 0.2s ease-out'
                  }}
                  className="max-h-[82vh] max-w-[90vw] object-contain rounded-xl shadow-2xl drop-shadow-2xl pointer-events-auto"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>

              {/* Pie de foto informativo */}
              <div className="text-[11px] font-medium text-white/50 pb-1">
                Haz clic fuera de la foto o presiona Esc para volver
              </div>
            </div>
          )}
        </>
      ) : type === 'video' ? (
        <div className="relative group overflow-hidden rounded-xl border border-[var(--border-subtle)]/40 max-w-full">
          <video controls src={src} className="max-h-60 rounded-xl w-full" />
          <a
            href={src}
            download={`whatsapp-video-${Date.now()}.mp4`}
            className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/70 hover:bg-black text-white shadow-md transition-all cursor-pointer flex items-center gap-1 text-[10px] font-bold"
            title="Descargar Video"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Descargar</span>
          </a>
        </div>
      ) : type === 'audio' ? (
        <div className="py-1 min-w-[240px] flex items-center gap-2">
          <audio
            controls
            preload="metadata"
            src={src}
            className="flex-1 h-8 accent-[var(--accent)]"
            onError={() => setError(true)}
          />
          <a
            href={src}
            download={`whatsapp-audio-${Date.now()}.mp3`}
            className="p-1.5 rounded-lg bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] border border-[var(--border-subtle)] transition-colors cursor-pointer shrink-0"
            title="Descargar Audio"
          >
            <Download className="h-3.5 w-3.5" />
          </a>
        </div>
      ) : null}
      {captionText && (
        <p className="text-xs font-medium px-1 whitespace-pre-wrap leading-relaxed opacity-95">{captionText}</p>
      )}
    </div>
  )
}

export function WhatsAppDocument({ mediaId }: { mediaId: string }) {
  const safeMediaId = typeof mediaId === 'string' ? mediaId : String(mediaId || '')
  const rawMediaId = safeMediaId.split('|')[0] || ''
  const cleanMediaId = rawMediaId.includes('/') ? (rawMediaId.split('/').pop() || rawMediaId) : rawMediaId
  const captionText = safeMediaId.includes('|') ? safeMediaId.split('|').slice(1).join('|') : ''
  const containerRef = useRef<HTMLDivElement | null>(null)
  const cachedSrc = peekWhatsappMediaUrl(cleanMediaId)
  const [isVisible, setIsVisible] = useState(Boolean(cachedSrc))
  const [loading, setLoading] = useState(!cachedSrc)
  const [error, setError] = useState(false)
  const [src, setSrc] = useState<string | null>(cachedSrc)

  useEffect(() => {
    if (isVisible) return
    const el = containerRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some(e => e.isIntersecting)) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '250px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [isVisible])

  useEffect(() => {
    if (!isVisible) return
    let active = true
    let retained = false

    const fetchDoc = async () => {
      try {
        setError(false)
        if (!peekWhatsappMediaUrl(cleanMediaId)) setLoading(true)
        const url = await acquireWhatsappMediaUrl(cleanMediaId)
        if (!active) {
          releaseWhatsappMediaUrl(cleanMediaId)
          return
        }
        retained = true
        setSrc(url)
      } catch (err) {
        if (active) setError(true)
      } finally {
        if (active) setLoading(false)
      }
    }

    fetchDoc()

    return () => {
      active = false
      if (retained) releaseWhatsappMediaUrl(cleanMediaId)
    }
  }, [cleanMediaId, isVisible])

  if (!isVisible) {
    return (
      <div ref={containerRef} className="flex items-center gap-2 p-2 bg-[var(--bg-elevated)]/20 rounded-xl min-w-[200px] animate-pulse">
        <span className="text-[10px] font-medium text-[var(--text-secondary)]">Documento en espera...</span>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="space-y-1.5 min-w-[200px]">
      {loading ? (
        <div className="flex items-center gap-2 p-2 bg-[var(--bg-elevated)]/30 rounded-xl">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
          <span className="text-[10px] font-medium text-[var(--text-secondary)]">Cargando archivo...</span>
        </div>
      ) : error || !src ? (
        <div className="flex items-center gap-1.5 p-2 bg-red-500/10 text-red-500 rounded-xl text-[10px] font-semibold border border-red-500/20">
          <AlertCircle className="h-3.5 w-3.5" />
          <span>Error al cargar archivo</span>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-[var(--bg-elevated)]/50 border border-[var(--border-subtle)]">
          <div className="flex items-center gap-2 overflow-hidden">
            <FileText className="h-5 w-5 text-[var(--accent)] shrink-0" />
            <span className="text-xs font-semibold truncate text-[var(--text-primary)]">
              {captionText || 'documento.pdf'}
            </span>
          </div>
          <a
            href={src}
            download={captionText || 'documento.pdf'}
            className="p-1.5 rounded-lg bg-[var(--accent)] hover:opacity-90 text-white shadow-sm transition-all cursor-pointer shrink-0"
            title="Descargar documento"
          >
            <Download className="h-3.5 w-3.5" />
          </a>
        </div>
      )}
    </div>
  )
}
