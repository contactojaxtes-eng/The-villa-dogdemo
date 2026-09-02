import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { MapPin, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'

export interface AddressResult {
  displayName: string
  address: string
  latitude: number
  longitude: number
  neighbourhood: string
  city: string
  suggestedZone?: { id: string; name: string; rate: number; zoneGroup: string } | null
}

interface AddressSearchProps {
  value: string
  onChange: (address: string) => void
  onSelect: (result: AddressResult) => void
  reference?: string
  onReferenceChange?: (ref: string) => void
  placeholder?: string
  zones?: { id: string; name: string; rate: number; zoneGroup?: string }[]
}

export function AddressSearch({ value, onChange, onSelect, reference = '', onReferenceChange, placeholder, zones }: AddressSearchProps) {
  const [results, setResults] = useState<AddressResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const search = (query: string) => {
    onChange(query)
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const normalizedQuery = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()

    // Find local matches in zones
    let localMatches: AddressResult[] = []
    if (normalizedQuery.length >= 2 && zones) {
      localMatches = zones
        .filter(z => {
          const normalizedName = z.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          return normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName)
        })
        .map(z => ({
          displayName: z.name,
          address: z.name,
          latitude: 0,
          longitude: 0,
          neighbourhood: z.name,
          city: 'Montería',
          suggestedZone: { id: z.id, name: z.name, rate: z.rate, zoneGroup: z.zoneGroup || 'General' }
        }))
    }

    // Add option to create a new barrio if query is at least 3 chars and not in database
    if (query.trim().length >= 3) {
      const hasExactMatch = localMatches.some(m => m.displayName.toLowerCase().trim() === query.toLowerCase().trim())
      if (!hasExactMatch) {
        localMatches.push({
          displayName: `Crear/Guardar barrio: "${query.trim()}"`,
          address: query.trim(),
          latitude: 0,
          longitude: 0,
          neighbourhood: query.trim(),
          city: 'Montería',
          suggestedZone: null
        })
      }
    }

    if (query.length < 3) {
      setResults(localMatches)
      setOpen(localMatches.length > 0)
      return
    }

    setResults(localMatches)
    setOpen(localMatches.length > 0)

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await api.get<AddressResult[]>(`/geocoding/search?q=${encodeURIComponent(query)}`)
        setResults(prev => {
          const merged = [...prev]
          for (const item of data) {
            const isDuplicate = merged.some(m => 
              m.displayName.toLowerCase().trim() === item.displayName.toLowerCase().trim() ||
              (m.suggestedZone && item.suggestedZone && m.suggestedZone.id === item.suggestedZone.id)
            )
            if (!isDuplicate) {
              merged.push(item)
            }
          }
          return merged
        })
        setOpen(true)
      } catch {
        // Keep local matches
      } finally {
        setLoading(false)
      }
    }, 400)
  }

  return (
    <div ref={containerRef} className="space-y-2">
      <div className="relative">
        <MapPin className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--accent)]" />
        {loading && <Loader2 className="absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin text-[var(--text-secondary)]" />}
        <Input
          className="pl-10"
          placeholder={placeholder || 'Buscar barrio o dirección...'}
          value={value}
          onChange={e => search(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {open && results.length > 0 && (
          <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-[var(--border-default)] bg-[var(--bg-panel)] shadow-xl">
            {results.map((r, i) => {
              const barrioName = r.suggestedZone?.name || r.neighbourhood || r.address.split(',')[0]
              const isCreateOption = r.displayName.startsWith('Crear/Guardar')
              return (
                <button
                  key={i}
                  type="button"
                  className="flex w-full flex-col gap-0.5 border-b border-[var(--border-default)] px-3 py-2.5 text-left text-sm transition-colors last:border-0 hover:bg-[var(--accent-muted)]"
                  onClick={() => {
                    onChange(barrioName)
                    onSelect({ ...r, address: barrioName })
                    setOpen(false)
                  }}
                >
                  <span className={`font-semibold ${isCreateOption ? 'text-[var(--accent)] font-bold' : 'text-[var(--text-primary)]'}`}>{r.displayName}</span>
                  {!isCreateOption && <span className="text-xs text-[var(--text-secondary)]">{r.city}</span>}
                  {r.suggestedZone && (
                    <span className="text-xs text-[var(--accent)]">Tarifa Domicilio: {new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(r.suggestedZone.rate)}</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
      {onReferenceChange && (
        <Input
          placeholder="Referencia: apto, casa, color de fachada..."
          value={reference}
          onChange={e => onReferenceChange(e.target.value)}
          className="text-sm"
        />
      )}
    </div>
  )
}

