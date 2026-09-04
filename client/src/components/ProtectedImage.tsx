import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { FileQuestion, Image as ImageIcon } from 'lucide-react'

export function ProtectedImage({ endpoint, alt, className }: { endpoint: string; alt: string; className?: string }) {
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  const isLocalPreview = endpoint.startsWith('blob:') || endpoint.startsWith('data:')

  useEffect(() => {
    let active = true
    let objectUrl = ''
    setUrl('')
    setFailed(false)
    if (isLocalPreview) return

    api.getBlob(endpoint)
      .then(blob => {
        if (!active) return
        if (blob && blob.size > 0) {
          objectUrl = URL.createObjectURL(blob)
          setUrl(objectUrl)
        } else {
          setFailed(true)
        }
      })
      .catch(() => {
        if (active) setFailed(true)
      })

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [endpoint, isLocalPreview])

  if (isLocalPreview) {
    return <img src={endpoint} alt={alt} className={className} />
  }

  if (failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-muted)] p-1 text-center select-none ${className || ''}`}
        title="Comprobante registrado en caja (archivo visual no disponible)"
      >
        <FileQuestion className="h-5 w-5 text-amber-500/80 mb-0.5" />
        <span className="text-[9px] font-black uppercase tracking-wider text-[var(--text-secondary)] leading-tight">
          Comprobante
        </span>
        <span className="text-[8px] text-[var(--text-muted)] leading-tight">
          Sin foto
        </span>
      </div>
    )
  }

  if (!url) {
    return (
      <div className={`flex items-center justify-center bg-[var(--bg-elevated)] animate-pulse ${className || ''}`}>
        <ImageIcon className="h-4 w-4 text-[var(--text-muted)]" />
      </div>
    )
  }

  return (
    <img
      src={url}
      alt={alt}
      className={className}
      onError={() => {
        setFailed(true)
        setUrl('')
      }}
    />
  )
}

