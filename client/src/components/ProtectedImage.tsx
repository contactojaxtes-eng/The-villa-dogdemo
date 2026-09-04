import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

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
    api.getBlob(endpoint).then(blob => {
      if (!active) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [endpoint, isLocalPreview])
  if (isLocalPreview) return <img src={endpoint} alt={alt} className={className} />
  if (!url) return <span className="text-xs text-[var(--text-muted)]">{failed ? 'Comprobante no disponible' : 'Cargando imagen…'}</span>
  return <img src={url} alt={alt} className={className} onError={() => { setFailed(true); setUrl('') }} />
}
