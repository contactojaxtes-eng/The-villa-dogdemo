import { useEffect, useMemo, useState, useRef } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { io } from '@/lib/socket'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { cn, formatCurrency, groupOrderItems, cleanNotes, getItemRawNote, fuzzyMatch, levenshteinDistance, formatThousandsInput, parseThousandsInput } from '@/lib/utils'
import { alerts } from '@/lib/alerts'
import type { ComandaOrder } from '@/components/orders/ComandaPrint'
import { AddressSearch, type AddressResult } from '@/components/orders/AddressSearch'
import { globalSessionsCache } from '@/lib/chatCache'
import { ArrowLeft, ShoppingCart, Trash2, Search, Save, Sparkles, Clock, Bike, Store, Loader2, Plus, Minus, MapPin, DollarSign, AlertTriangle, Route, Pizza, CupSoda, ChefHat, Flame, UtensilsCrossed, X, Users, CheckCircle2, Mic, MicOff, ChevronDown, MessageCircle, Send, FileText, Phone, ExternalLink, Download, Eye, RotateCw, ZoomIn, ZoomOut, Edit } from 'lucide-react'

function ChatDrawerMedia({ mediaId, type }: { mediaId: string; type: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [isZoomed, setIsZoomed] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [scale, setScale] = useState(1)

  const rawMediaId = mediaId.split('|')[0]
  const cleanMediaId = rawMediaId.includes('/') ? rawMediaId.split('/').pop() : rawMediaId
  const captionText = mediaId.includes('|') ? mediaId.split('|').slice(1).join('|') : ''

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null

    const fetchMedia = async () => {
      try {
        const token = api.getToken()
        const rawApiUrl = import.meta.env.VITE_API_URL || ''
        const baseUrl = (rawApiUrl.endsWith('/') ? rawApiUrl.slice(0, -1) : rawApiUrl) + '/api'
        const res = await fetch(`${baseUrl}/whatsapp/media/${cleanMediaId}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (res.ok) {
          const blob = await res.blob()
          if (active) {
            objectUrl = URL.createObjectURL(blob)
            setSrc(objectUrl)
          }
        } else if (active) setError(true)
      } catch (err) {
        console.error('Error fetching media:', err)
        if (active) setError(true)
      } finally {
        if (active) setLoading(false)
      }
    }
    fetchMedia()
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [cleanMediaId])

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

  if (loading) return <div className="text-[10px] text-gray-400 p-1 font-mono">Cargando multimedia...</div>
  if (error || !src) return <div className="text-[10px] text-red-400 p-1 font-mono">[Archivo multimedia no disponible]</div>

  return (
    <div className="space-y-1 my-1">
      {type === 'image' ? (
        <>
          <div className="relative group overflow-hidden rounded-xl border border-black/10 shadow-xs max-w-full inline-block">
            <img 
              src={src} 
              alt="Adjunto WhatsApp" 
              className="max-h-48 rounded-xl object-contain cursor-zoom-in transition-transform duration-200 hover:scale-[1.02]" 
              onClick={() => setIsZoomed(true)}
            />
            <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setIsZoomed(true)
                }}
                className="p-1 rounded-md bg-black/70 hover:bg-black text-white text-[10px] font-bold shadow-md cursor-pointer"
                title="Ver en grande"
              >
                <Eye className="h-3 w-3" />
              </button>
              <a
                href={src}
                download={`whatsapp-imagen-${Date.now()}.jpg`}
                onClick={(e) => e.stopPropagation()}
                className="p-1 rounded-md bg-black/70 hover:bg-black text-white text-[10px] font-bold shadow-md cursor-pointer"
                title="Descargar"
              >
                <Download className="h-3 w-3" />
              </a>
            </div>
          </div>

          {isZoomed && (
            <div 
              className="fixed inset-0 z-[9999] bg-black/85 backdrop-blur-sm flex flex-col items-center justify-between p-4 select-none animate-in fade-in duration-200"
              onClick={handleCloseZoom}
            >
              <div 
                className="w-full max-w-3xl flex items-center justify-between py-2 px-4 rounded-2xl bg-black/70 border border-white/10 text-white backdrop-blur-md shadow-2xl z-10"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold tracking-wide text-white/90">Vista previa de imagen</span>
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
                    onClick={() => setScale(s => Math.min(3, s + 0.25))}
                    className="p-2 rounded-xl hover:bg-white/15 text-white/80 hover:text-white transition-colors cursor-pointer"
                    title="Acercar"
                  >
                    <ZoomIn className="h-4 w-4" />
                  </button>
                  <a
                    href={src}
                    download={`whatsapp-imagen-${Date.now()}.jpg`}
                    className="p-2 rounded-xl hover:bg-white/15 text-white/80 hover:text-white transition-colors cursor-pointer ml-1"
                    title="Descargar"
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

              <div className="text-[11px] font-medium text-white/50 pb-1">
                Haz clic fuera de la foto o presiona Esc para cerrar
              </div>
            </div>
          )}
        </>
      ) : type === 'audio' ? (
        <audio controls preload="metadata" src={src} onError={() => setError(true)} className="h-7 w-full accent-[var(--accent)]" />
      ) : (
        <a href={src} download="documento.pdf" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 p-2 bg-black/5 rounded-lg text-[11px] font-bold text-emerald-600 hover:underline">
          <FileText className="h-4 w-4" /> <span>Descargar Documento</span>
        </a>
      )}
      {captionText && <p className="text-xs font-medium opacity-95">{captionText}</p>}
    </div>
  )
}

interface MenuItem { id: string; name: string; price: number; image?: string | null; category: { name: string } }
interface Category { id: string; name: string; description?: string | null; items: MenuItem[] }
export function isAdditionCategory(catName?: string | null, catDesc?: string | null): boolean {
  if (!catName && !catDesc) return false
  const normName = (catName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  const normDesc = (catDesc || '').toLowerCase().trim()
  if (normDesc.includes('[is_addition]') || normDesc.includes('[targets:')) return true
  return normName.includes('adiciones e ingredientes') || 
         normName.includes('bordes rellenos') || 
         normName.includes('adicionales para tu plato') ||
         normName.includes('adicionales para pizza') ||
         normName.startsWith('adicion') ||
         normName.startsWith('topping') ||
         normName === 'adicionales' ||
         normName === 'adiciones'
}

interface Zone { id: string; name: string; rate: number; km?: number | null; zoneGroup?: string }
interface CartItem { menuItemId: string; name: string; price: number; quantity: number; notes?: string; lineId?: string; isCourtesy?: boolean }

function consolidateCart(items: CartItem[]): CartItem[] {
  if (!Array.isArray(items)) return []
  const processed = items.map(item => {
    if (!item) return null
    const rawNote = getItemRawNote(item.notes || '').trim()
    const hasCustomNotes = rawNote.length > 0
    const hasAdditions = items.some(i => i && i.notes && i.notes.startsWith('Adición para:') && i.notes.includes(`(#${item.lineId})`))
    const hasTag = !!(item.notes && item.notes.includes('(#line-'))
    if (!hasCustomNotes && !hasAdditions && !hasTag) {
      return { ...item, notes: undefined }
    }
    return item
  }).filter(Boolean) as CartItem[]

  const result: CartItem[] = []
  const plainMerged = new Map<string, CartItem>()

  for (const item of processed) {
    if (!item) continue
    if (item.notes === undefined && !item.isCourtesy) {
      const key = item.menuItemId || item.name || 'item'
      const existing = plainMerged.get(key)
      if (existing && !existing.isCourtesy) {
        existing.quantity += (item.quantity || 1)
      } else {
        const newItem = { ...item }
        plainMerged.set(key, newItem)
        result.push(newItem)
      }
    } else {
      result.push(item)
    }
  }

  return result
}

function keepKitchenInstruction(rawNote: string | undefined, productName?: string): string {
  const note = cleanNotes(rawNote, productName)
  const normalized = normalizeText(note)
  if (!normalized) return ''

  // El nombre de otro producto o una variante mal escrita no es una nota para
  // cocina. Las notas deben ser instrucciones reales: "sin salsa", "sin
  // cebolla", "con más queso", "aparte", etc.
  if (/^(?:para llevar|domicilio|recoger|pickup)$/.test(normalized)) return ''
  if (/^(?:\d+\s*(?:x\s*)?)?(?:perro|hamburguesa|pizza|gaseosa|jugo|combo|salchich\w*|doble\s+salchich\w*|triple\s+salchich\w*)(?:\s+\d+)?$/.test(normalized)) return ''
  return note
}

function serializeItemNote(item: CartItem): string | undefined {
  if (item.notes?.startsWith('Adición para:')) return item.notes
  const tag = item.notes?.match(/\s?(\(#[\w-]+\))/)?.[1] || ''
  const instruction = keepKitchenInstruction(item.notes, item.name)
  return instruction ? `${instruction}${tag ? ` ${tag}` : ''}` : (tag || undefined)
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
}

function extractPaymentMethod(text: string): 'CASH' | 'TRANSFER' | null {
  const matches = Array.from(text.matchAll(/\b(efectivo|transferencia|transferir|nequi|daviplata|bancolombia)\b/gi))
  const last = matches[matches.length - 1]?.[1]?.toLowerCase()
  if (!last) return null
  return last === 'efectivo' ? 'CASH' : 'TRANSFER'
}

function extractOrderType(text: string): 'delivery' | 'pickup' | null {
  const matches = Array.from(text.matchAll(/\b(domicilio|domicili[oa]|enviar(?:lo)?|pasar a recoger|recoger(?:lo)?|recojo|voy por (?:el|mi) pedido)\b/gi))
  const last = matches[matches.length - 1]?.[1]?.toLowerCase() || ''
  if (!last) return null
  return /recoger|recojo|voy por/.test(last) ? 'pickup' : 'delivery'
}

function extractNeighborhood(text: string): string | null {
  const matches = Array.from(text.matchAll(/\bbarrio\s*[:\-]?\s+([^,\n.;]+)/gi))
  const raw = matches[matches.length - 1]?.[1] || ''
  const value = raw
    .split(/\b(?:direcci[oó]n|pago|efectivo|transferencia|nequi|daviplata|bancolombia|calle|cl|carrera|cra|cr|diagonal|dg|transversal|tv|avenida|av|manzana|mz)\b/i)[0]
    .replace(/\s+(?:y|con)\s*$/i, '')
    .trim()
  return value.length >= 2 ? value : null
}

function extractStreetAddress(text: string): string | null {
  const explicitMatches = Array.from(text.matchAll(/\bdirecci[oó]n\s*[:\-]?\s+([^\n,;]+)/gi))
  const streetMatches = Array.from(text.matchAll(/\b(?:calle|cl|carrera|cra|cr|diagonal|dg|transversal|tv|avenida|av|manzana|mz)\s*[:#\-]?\s*[^\n,;]+/gi))
  const raw = explicitMatches[explicitMatches.length - 1]?.[1] || streetMatches[streetMatches.length - 1]?.[0] || ''
  const value = raw
    .split(/\bbarrio\b/i)[0]
    .split(/\b(?:pago|efectivo|transferencia|nequi|daviplata|bancolombia)\b/i)[0]
    .replace(/\s+(?:y|con)\s*$/i, '')
    .trim()
  return value.length >= 3 ? value : null
}

interface ParsedOrderResponse {
  parsedCartItems: {
    menuItem: MenuItem;
    quantity: number;
    preference: string;
    additions: MenuItem[];
    notes?: string;
  }[];
  detectedOrderType: 'delivery' | 'pickup' | null;
  independentNotes: string[];
  customerName?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerAddressReference?: string | null;
  customerNeighborhood?: string | null;
  zoneId?: string | null;
  paymentMethod?: 'CASH' | 'TRANSFER' | null;
  modelUsed?: string;
}

function AdditionDropdown({
  item,
  additions,
  onSelect
}: {
  item: CartItem
  additions: MenuItem[]
  onSelect: (item: CartItem, additionId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open])

  const filtered = useMemo(() => {
    if (!search.trim()) return additions
    const q = search.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    return additions.filter(a => 
      a.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q)
    )
  }, [additions, search])

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => {
          setOpen(!open)
          setSearch('')
        }}
        className="h-5 w-auto border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-[10px] font-extrabold text-amber-600 rounded-md px-1.5 flex items-center gap-0.5 cursor-pointer shrink-0 transition-colors"
      >
        <Plus className="h-2.5 w-2.5 text-amber-600" /> Adición <ChevronDown className={`h-2.5 w-2.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-[9999] w-72 sm:w-80 max-w-[calc(100vw-2rem)] rounded-2xl bg-[var(--bg-panel)] border border-[var(--border-default)] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          {/* Buscador de adiciones */}
          <div className="p-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 relative flex items-center">
            <Search className="absolute left-4 h-4 w-4 text-[var(--text-muted)] pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar adición..."
              className="w-full pl-9 pr-7 py-1.5 text-xs rounded-xl bg-[var(--bg-input)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] font-medium"
              autoFocus
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-4 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm font-bold"
              >
                ×
              </button>
            )}
          </div>

          {/* Lista con scroll manual */}
          <div className="max-h-60 overflow-y-auto p-1.5 space-y-1 custom-scrollbar">
            {filtered.map(add => (
              <button
                key={add.id}
                type="button"
                onClick={() => {
                  onSelect(item, add.id)
                  setOpen(false)
                }}
                className="w-full text-left px-3.5 py-2.5 text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-xl transition-colors flex items-center justify-between cursor-pointer group gap-2"
              >
                <span className="group-hover:text-[var(--accent)] font-bold">{add.name}</span>
                <span className="text-xs font-black text-[var(--accent)] shrink-0 bg-[var(--accent-muted)] px-2 py-0.5 rounded-lg border border-[var(--accent)]/20">
                  +{formatCurrency(add.price)}
                </span>
              </button>
            ))}

            {filtered.length === 0 && (
              <div className="p-4 text-center text-xs text-[var(--text-muted)] font-medium">
                No se encontraron adiciones
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const draftKey = 'niche-new-order-draft'
const createClientMutationId = () => globalThis.crypto?.randomUUID?.() || `order-${Date.now()}-${Math.random().toString(36).slice(2)}`
const cleanupStaleChatDrafts = () => {
  const prefix = `${draftKey}:chat:`
  const validDrafts: { key: string; updatedAt: number }[] = []
  const expiresBefore = Date.now() - 7 * 24 * 60 * 60 * 1000
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index)
    if (!key?.startsWith(prefix)) continue
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '{}')
      const updatedAt = Number(parsed.updatedAt || 0)
      if (!updatedAt || updatedAt < expiresBefore) localStorage.removeItem(key)
      else validDrafts.push({ key, updatedAt })
    } catch {
      localStorage.removeItem(key)
    }
  }
  validDrafts.sort((a, b) => b.updatedAt - a.updatedAt)
  validDrafts.slice(20).forEach(draft => localStorage.removeItem(draft.key))
}
let globalCategoriesCache: Category[] = []
let globalZonesCache: Zone[] = []

export type EmbeddedOrderParams = {
  editOrderId?: string | null
  chatSessionId: string
  phone?: string
  name?: string
  address?: string
  zone?: string
}

type NewOrderPageProps = {
  embedded?: boolean
  embeddedParams?: EmbeddedOrderParams | null
  onClose?: () => void
  onOrderSaved?: (order: ComandaOrder) => void
}

export default function NewOrderPage({
  embedded = false,
  embeddedParams = null,
  onClose,
  onOrderSaved,
}: NewOrderPageProps = {}) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editOrderId = embedded ? (embeddedParams?.editOrderId || null) : searchParams.get('edit')
  const chatSessionId = embedded ? (embeddedParams?.chatSessionId || null) : searchParams.get('chatSessionId')
  const initialPhone = embedded ? (embeddedParams?.phone || '') : (searchParams.get('phone') || '')
  const initialName = embedded ? (embeddedParams?.name || '') : (searchParams.get('name') || '')
  const initialAddress = embedded ? (embeddedParams?.address || '') : (searchParams.get('address') || '')
  const initialZone = embedded ? (embeddedParams?.zone || '') : (searchParams.get('zone') || '')
  const activeDraftKey = chatSessionId ? `${draftKey}:chat:${chatSessionId}` : draftKey
  const chatReturnPath = chatSessionId ? `/chat?session=${encodeURIComponent(chatSessionId)}` : '/chat'
  const { user } = useAuth()

  const closeOrderPanel = () => {
    if (embedded) {
      onClose?.()
      return
    }
    navigate('/orders')
  }

  const [step, setStep] = useState<'menu' | 'delivery'>('menu')
  const [categories, setCategories] = useState<Category[]>(globalCategoriesCache)
  const [zones, setZones] = useState<Zone[]>(globalZonesCache)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [exactAddress, setExactAddress] = useState('')
  const [addressReference, setAddressReference] = useState('')
  const [canCreate, setCanCreate] = useState<{ allowed: boolean; reason?: string | null }>({ allowed: true })
  const [paymentReference, setPaymentReference] = useState('')

  const [customerId, setCustomerId] = useState('')
  const [customerSearchQuery, setCustomerSearchQuery] = useState('')
  const [dbCustomers, setDbCustomers] = useState<any[]>([])
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false)
  const [creatingCustomerInline, setCreatingCustomerInline] = useState(false)

  const [zoneId, setZoneId] = useState('')
  const [zoneSearch, setZoneSearch] = useState('')
  const [zoneRateEdit, setZoneRateEdit] = useState('')
  const [zoneResultsOpen, setZoneResultsOpen] = useState(false)
  const zoneContainerRef = useRef<HTMLDivElement>(null)
  const [orderReaderEnabled, setOrderReaderEnabled] = useState(false)
  const [chatContextMessageCount, setChatContextMessageCount] = useState<number | null>(null)
  const [chatTranscriptRevision, setChatTranscriptRevision] = useState(0)

  const [paymentMethod, setPaymentMethod] = useState('CASH')
  const [cashAmountInput, setCashAmountInput] = useState('')
  const [transferAmountInput, setTransferAmountInput] = useState('')
  const [notes, setNotes] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [itemSearch, setItemSearch] = useState('')
  const [catSearch, setCatSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [loading, setLoading] = useState(false)
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null)
  const [hasRestoredDraft, setHasRestoredDraft] = useState(false)
  const [error, setError] = useState('')
  const [clientMutationId, setClientMutationId] = useState(createClientMutationId)
  const [orderType, setOrderType] = useState<'delivery' | 'pickup'>('delivery')
  const [mapSearch, setMapSearch] = useState('')

  const [addedItemId, setAddedItemId] = useState<string | null>(null)
  const [latitude, setLatitude] = useState<number | null>(null)
  const [longitude, setLongitude] = useState<number | null>(null)
  const [chargeTax, setChargeTax] = useState(false)

  const [showNotes, setShowNotes] = useState<Record<string, boolean>>({})
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({})
  const noteInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [isCartCollapsed, setIsCartCollapsed] = useState(false)
  const [isCartDrawerOpen, setIsCartDrawerOpen] = useState(false)
  const [initialLoading, setInitialLoading] = useState(
    globalCategoriesCache.length === 0 || globalZonesCache.length === 0
  )
  const [editOrderLoaded, setEditOrderLoaded] = useState(false)

  // Live WhatsApp Chat Drawer State
  const [showChatDrawer, setShowChatDrawer] = useState(false)
  const [chatDrawerSession, setChatDrawerSession] = useState<any | null>(null)
  const [chatDrawerMessages, setChatDrawerMessages] = useState<any[]>([])
  const [loadingChatDrawer, setLoadingChatDrawer] = useState(false)
  const [chatDrawerReplyText, setChatDrawerReplyText] = useState('')
  const chatDrawerScrollRef = useRef<HTMLDivElement>(null)
  const userIsNearBottomRef = useRef(true)
  const shouldAutoScrollRef = useRef(true)

  const showChatDrawerRef = useRef(showChatDrawer)
  const chatDrawerSessionRef = useRef(chatDrawerSession)
  const customerPhoneRef = useRef(customerPhone)
  const chatSessionIdRef = useRef(chatSessionId)

  useEffect(() => {
    showChatDrawerRef.current = showChatDrawer
    chatDrawerSessionRef.current = chatDrawerSession
    customerPhoneRef.current = customerPhone
    chatSessionIdRef.current = chatSessionId
  }, [showChatDrawer, chatDrawerSession, customerPhone, chatSessionId])

  const [quickText, setQuickText] = useState('')
  const [parsingQuickText, setParsingQuickText] = useState(false)
  const [parsingChatOrder, setParsingChatOrder] = useState(false)
  const [orderReaderModel, setOrderReaderModel] = useState('')
  const [suggestedProducts, setSuggestedProducts] = useState<MenuItem[]>([])
  const [lastOrderItems, setLastOrderItems] = useState<any[]>([])
  const [lastOrderDate, setLastOrderDate] = useState<string>('')
  const [isVoiceSearchingMenu, setIsVoiceSearchingMenu] = useState(false)
  const lastParsedSessionIdRef = useRef<string | null>(null)
  // Guarda el resultado instantáneo del lector local para que una respuesta
  // lenta de Gemini no pueda reemplazarlo por un pedido incompleto.
  const autoParsedCartRef = useRef<CartItem[] | null>(null)
  const restoredDraftHasItemsRef = useRef(false)
  const restoredDraftUpdatedAtRef = useRef(0)

  useEffect(() => {
    cleanupStaleChatDrafts()
  }, [])

  const handleVoiceSearchMenu = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('Tu navegador no soporta dictado por voz. Te recomendamos usar Google Chrome o Microsoft Edge.')
      return
    }

    if (isVoiceSearchingMenu) {
      setIsVoiceSearchingMenu(false)
      return
    }

    try {
      const recognition = new SpeechRecognition()
      recognition.lang = 'es-CO'
      recognition.continuous = false
      recognition.interimResults = false

      recognition.onstart = () => {
        setIsVoiceSearchingMenu(true)
      }

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript
        if (transcript) {
          setItemSearch(transcript)
        }
        setIsVoiceSearchingMenu(false)
      }

      recognition.onerror = () => {
        setIsVoiceSearchingMenu(false)
      }

      recognition.onend = () => {
        setIsVoiceSearchingMenu(false)
      }

      recognition.start()
    } catch {
      setIsVoiceSearchingMenu(false)
    }
  }

  useEffect(() => {
    Promise.all([
      api.get<Category[]>('/menu/categories').then(cats => {
        if (cats && Array.isArray(cats)) {
          globalCategoriesCache = cats
          setCategories(cats)
        }
      }).catch(err => console.warn('Error cargando categorias:', err)),
      api.get<Zone[]>('/zones').then(zs => {
        if (zs && Array.isArray(zs)) {
          globalZonesCache = zs
          setZones(zs)
        }
      }).catch(err => console.warn('Error cargando zonas:', err)),
      api.get<{ allowed: boolean; reason?: string | null }>('/orders/can-create')
        .then(res => setCanCreate(res || { allowed: true }))
        .catch(() => setCanCreate({ allowed: false, reason: 'No se pudo verificar la caja' })),
    ]).finally(() => setInitialLoading(false))
  }, [])

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      transports: ['websocket', 'polling'],
    })

    const checkPermission = () => {
      api.get<{ allowed: boolean; reason?: string | null }>('/orders/can-create')
        .then(res => setCanCreate(res || { allowed: true }))
        .catch(() => setCanCreate({ allowed: false, reason: 'No se pudo verificar la caja' }))
    }

    socket.on('cashStatusChanged', () => {
      checkPermission()
    })

    socket.on('cashRegistersChanged', () => {
      checkPermission()
    })

    socket.on('menuUpdated', () => {
      api.get<Category[]>('/menu/categories').then(cats => {
        if (cats && Array.isArray(cats)) {
          globalCategoriesCache = cats
          setCategories(cats)
        }
      }).catch(() => {})
    })

    socket.on('zonesChanged', () => {
      api.get<Zone[]>('/zones').then(zs => {
        if (zs && Array.isArray(zs)) {
          globalZonesCache = zs
          setZones(zs)
        }
      }).catch(() => {})
    })

    socket.on('whatsappMessage', (data: any) => {
      if (!data) return
      const activeSession = chatDrawerSessionRef.current
      const activePhone = customerPhoneRef.current || activeSession?.phone || ''
      const targetSessionId = chatSessionIdRef.current || activeSession?.id

      const cleanPayloadPhone = (data.phone || '').replace(/\D/g, '')
      const payloadPhone10 = cleanPayloadPhone.length === 12 && cleanPayloadPhone.startsWith('57') ? cleanPayloadPhone.slice(2) : cleanPayloadPhone

      const cleanActivePhone = activePhone.replace(/\D/g, '')
      const activePhone10 = cleanActivePhone.length === 12 && cleanActivePhone.startsWith('57') ? cleanActivePhone.slice(2) : cleanActivePhone

      const isMatch = (targetSessionId && data.sessionId === targetSessionId) ||
                      (payloadPhone10 && activePhone10 && payloadPhone10 === activePhone10)

      if (isMatch) {
        const msgId = data.id || data.waMessageId || `msg-${Date.now()}`
        const newMsgItem = {
          id: msgId,
          waMessageId: data.waMessageId,
          direction: data.direction,
          content: data.content,
          messageType: data.messageType || 'text',
          status: data.status || 'sent',
          createdAt: data.createdAt || new Date().toISOString()
        }

        setChatDrawerMessages(prev => {
          if (prev.some(m => m.id === msgId || (data.waMessageId && m.waMessageId === data.waMessageId))) {
            return prev
          }
          return [...prev, newMsgItem]
        })

        if (showChatDrawerRef.current && (data.sessionId || targetSessionId)) {
          const sid = data.sessionId || targetSessionId
          api.get<any[]>(`/whatsapp/sessions/${sid}/messages`).then(msgs => {
            if (msgs && Array.isArray(msgs)) setChatDrawerMessages(msgs)
          }).catch(() => {})
        }
      }
    })

    socket.on('whatsappAudioTranscribed', (data: any) => {
      if (!data?.sessionId) return
      const activeSession = chatDrawerSessionRef.current
      const targetSessionId = chatSessionIdRef.current || activeSession?.id
      if (targetSessionId && data.sessionId === targetSessionId) {
        // Si la asesora ya abrió “Nuevo pedido”, reintenta la lectura cuando la
        // transcripción llega, sin obligarla a cerrar ni recargar el panel.
        setChatTranscriptRevision(current => current + 1)
        if (showChatDrawerRef.current) {
          api.get<any[]>(`/whatsapp/sessions/${data.sessionId}/messages`).then(messages => {
            if (Array.isArray(messages)) setChatDrawerMessages(messages)
          }).catch(() => {})
        }
      }
    })

    socket.on('whatsappSessionUpdated', (payload: any) => {
      if (showChatDrawerRef.current && chatDrawerSessionRef.current?.id) {
        if (!payload || payload.sessionId === chatDrawerSessionRef.current.id) {
          api.get<any[]>(`/whatsapp/sessions/${chatDrawerSessionRef.current.id}/messages`).then(msgs => {
            if (msgs && Array.isArray(msgs)) setChatDrawerMessages(msgs)
          }).catch(() => {})
        }
      }
    })

    return () => {
      socket.disconnect()
    }
  }, [])

  useEffect(() => {
    if (editOrderId) {
      setLoading(true)
      setEditOrderLoaded(false)
      setCart([])
      try { localStorage.removeItem(activeDraftKey) } catch (e) {}
      api.get<any>(`/orders/${editOrderId}`)
        .then(order => {
          if (!order) return
          setCustomerName(order.customerName === 'Cliente Mostrador' ? '' : (order.customerName || ''))
          let oPhone = (order.customerPhone || '').trim()
          if ((!oPhone || oPhone === '3000000000' || oPhone === '0000000000') && order.orderType === 'DELIVERY') {
            const urlP = initialPhone
            if (urlP && urlP !== '3000000000' && urlP !== '0000000000') {
              oPhone = urlP
            } else if (order.customer?.phone && order.customer.phone !== '3000000000') {
              oPhone = order.customer.phone
            } else {
              oPhone = ''
            }
          }
          setCustomerPhone(oPhone)
          setExactAddress(order.customerAddress === 'Recoger en restaurante' || order.customerAddress === 'Consumo en restaurante / Mostrador' ? '' : (order.customerAddress || ''))
          // Los pedidos LOCAL antiguos se conservan como "Pasar a recoger"
          // dentro del flujo de WhatsApp. El modo Mostrador ya no se ofrece.
          setOrderType(order.orderType === 'PICKUP' || order.orderType === 'LOCAL' ? 'pickup' : 'delivery')
          setNotes((order.notes || '').replace(/^\[MOSTRADOR\]\s*/i, '').replace(/^\[PICKUP\]\s*/i, '').trim())
          setPaymentMethod(order.paymentMethod || 'CASH')
          setPaymentReference(order.paymentReference || '')
          setLatitude(order.latitude || null)
          setLongitude(order.longitude || null)
          setCustomerId(order.customerId || '')
          
          if (order.addressReference) {
            setAddressReference(order.addressReference)
          }
          
          if (order.zone) {
            setZoneId(order.zone.id)
            setZoneSearch(order.zone.name)
            setMapSearch(order.zone.name)
            setZoneRateEdit(String(order.deliveryFee ?? order.zone.rate ?? 0))
          } else {
            const fallbackZone = order.zoneName || order.customer?.barrio || (order.addressReference ? order.addressReference.split('—')[0].trim() : '') || (order.orderType === 'DELIVERY' ? 'Domicilio' : '')
            setZoneId(order.zoneId || '')
            setZoneSearch(fallbackZone)
            setMapSearch(fallbackZone)
            setZoneRateEdit(String(order.deliveryFee ?? 0))
          }

          const cartItems = (order.items || []).map((i: any) => {
            const tagMatch = (i.notes || '').match(/\(#(line-\w+)\)/)
            const lineId = tagMatch ? tagMatch[1] : `line-${Math.random().toString(36).substring(2, 9)}`
            const mId = i.menuItemId || i.menuItem?.id || i.id || `item-${Math.random().toString(36).substring(2, 9)}`
            return {
              menuItemId: mId,
              name: i.menuItem?.name || i.name || 'Producto',
              price: Number(i.unitPrice ?? i.price ?? 0),
              quantity: Number(i.quantity ?? 1),
              notes: i.notes || undefined,
              isCourtesy: Boolean(i.isCourtesy || i.unitPrice === 0),
              lineId
            }
          })
          setCart(consolidateCart(cartItems))
          setEditOrderLoaded(true)
          setDraftLoaded(true)
        })
        .catch(err => {
          console.error('Error cargando pedido', err)
          setError('No se pudo cargar el pedido para editar')
        })
        .finally(() => setLoading(false))
    }
  }, [editOrderId, initialPhone])

  useEffect(() => {
    if (editOrderId) return
    setDraftLoaded(false)
    setHasRestoredDraft(false)
    restoredDraftUpdatedAtRef.current = 0
    const resetDraftState = () => {
      setCustomerName('')
      setCustomerPhone('')
      setExactAddress('')
      setAddressReference('')
      setZoneId('')
      setZoneSearch('')
      setZoneRateEdit('')
      setMapSearch('')
      setPaymentMethod('CASH')
      setPaymentReference('')
      setCashAmountInput('')
      setTransferAmountInput('')
      setLatitude(null)
      setLongitude(null)
      setNotes('')
      setCustomerId('')
      setCart([])
      restoredDraftHasItemsRef.current = false
      setOrderType('delivery')
      setClientMutationId(createClientMutationId())
    }
    const stored = localStorage.getItem(activeDraftKey)
    if (stored) {
      try {
        const draft = JSON.parse(stored)
        setCustomerName(draft.customerName || '')
        setCustomerPhone(draft.customerPhone || '')
        setExactAddress(draft.exactAddress || '')
        setAddressReference(draft.addressReference || '')
        setZoneId(draft.zoneId || '')
        setZoneSearch(draft.zoneSearch || '')
        setZoneRateEdit(draft.zoneRateEdit || '')
        setMapSearch(draft.mapSearch || '')
        setPaymentMethod(draft.paymentMethod || 'CASH')
        setPaymentReference(draft.paymentReference || '')
        setCashAmountInput(draft.cashAmountInput || '')
        setTransferAmountInput(draft.transferAmountInput || '')
        setLatitude(typeof draft.latitude === 'number' ? draft.latitude : null)
        setLongitude(typeof draft.longitude === 'number' ? draft.longitude : null)
        setNotes(draft.notes || '')
        setCustomerId(draft.customerId || '')
        const loadedCart = Array.isArray(draft.cart) ? draft.cart : []
        const cartWithIds = loadedCart.filter(Boolean).map((i: any) => ({
          ...i,
          menuItemId: i.menuItemId || i.id || '',
          name: i.name || 'Producto',
          price: Number(i.price || i.unitPrice || 0),
          quantity: Math.max(1, Number(i.quantity || 1)),
          lineId: i.lineId || `line-${Math.random().toString(36).substring(2, 9)}`
        }))
        setCart(consolidateCart(cartWithIds))
        restoredDraftHasItemsRef.current = cartWithIds.length > 0
        setOrderType(draft.orderType === 'pickup' || draft.orderType === 'mostrador' ? 'pickup' : 'delivery')
        if (draft.clientMutationId) setClientMutationId(draft.clientMutationId)
        const hasUsefulDraft = cartWithIds.length > 0
          || Boolean((draft.exactAddress || '').trim())
          || Boolean((draft.addressReference || '').trim())
          || Boolean((draft.zoneId || '').trim())
          || Boolean((draft.paymentReference || '').trim())
          || Boolean((draft.notes || '').trim())
        restoredDraftUpdatedAtRef.current = Number(draft.updatedAt || 0)
        setHasRestoredDraft(hasUsefulDraft)
      } catch {
        localStorage.removeItem(activeDraftKey)
        resetDraftState()
      }
    } else {
      resetDraftState()
    }
    setLoadedDraftKey(activeDraftKey)
    setDraftLoaded(true)
  }, [editOrderId, activeDraftKey])

  const loadCustomerHistory = async (
    phone: string, 
    urlAddress?: string | null, 
    urlZone?: string | null, 
    currentZones: Zone[] = zones, 
    name?: string | null
  ) => {
    if (editOrderId) return
    const rawPhone = (phone || '').trim()
    if (!rawPhone) return
    try {
      const history = await api.get<any[]>(`/orders/history/${encodeURIComponent(rawPhone)}`)
      if (history.length > 0) {
        if (!name && (!customerName || customerName === 'Cliente Mostrador')) {
          setCustomerName(history[0].customerName || '')
        }
        
        if (history[0].items) {
          setLastOrderItems(history[0].items)
          setLastOrderDate(history[0].createdAt)
        }

        if (!urlAddress) {
          setExactAddress(history[0].customerAddress || '')
        }
        if (history[0].addressReference) {
          setAddressReference(history[0].addressReference)
        }
        if (!urlZone && history[0].zone) {
          setZoneId(history[0].zone.id)
          setZoneSearch(history[0].zone.name)
          setMapSearch(history[0].zone.name)
          setZoneRateEdit(String(history[0].zone.rate ?? history[0].deliveryFee ?? ''))
        }
      } else {
        if (name) setCustomerName(name)
      }
    } catch {
      if (name) setCustomerName(name)
    }
  }

  const lookupAndLoadCustomer = async (
    phone: string, 
    name?: string | null, 
    urlAddress?: string | null, 
    urlZone?: string | null
  ) => {
    if (editOrderId) return
    let resolvedPhone = (phone || '').trim()

    // 1. Si viene con sesión de chat, recuperar de inmediato el teléfono real de WhatsAppSession
    if (chatSessionId) {
      try {
        const session = await api.get<any>(`/whatsapp/sessions/${chatSessionId}`).catch(() => null)
        if (session) {
          const rawSessionPhone = (session.customerPhone || '').trim()
          const scClean = rawSessionPhone.replace(/\D/g, '')
          const s10 = (scClean.length === 12 && scClean.startsWith('57')) ? scClean.slice(2) : scClean
          if (s10 && s10.length >= 7 && s10.length <= 11 && s10 !== '3000000000' && s10 !== '0000000000') {
            resolvedPhone = s10
            setCustomerPhone(s10)
          }
          if (session.customerName && (!customerName || customerName === 'Cliente Mostrador' || customerName.startsWith('Cliente '))) {
            setCustomerName(session.customerName)
          }
        }
      } catch {}
    }

    const cleanPhone = resolvedPhone.replace(/\D/g, '')
    const phone10 = (cleanPhone.length === 12 && cleanPhone.startsWith('57')) ? cleanPhone.slice(2) : (cleanPhone.length > 10 ? cleanPhone.slice(-10) : cleanPhone)
    
    if (resolvedPhone) {
      try {
        const searchTarget = phone10.length >= 7 ? phone10 : (cleanPhone || resolvedPhone)
        const results = await api.get<any[]>(`/customers?search=${encodeURIComponent(searchTarget)}`)
        const matched = results.find(c => {
          const cDigits = (c.phone || '').replace(/\D/g, '')
          return (cDigits && cDigits !== '3000000000' && (cDigits === cleanPhone || cDigits === phone10 || (phone10.length >= 7 && cDigits.includes(phone10)))) || c.phone === resolvedPhone
        })
        if (matched) {
          setCustomerId(matched.id)
          if (matched.name) setCustomerName(matched.name)
          if (matched.phone && matched.phone !== '3000000000' && matched.phone !== '0000000000') {
            const mClean = matched.phone.replace(/\D/g, '')
            const m10 = (mClean.length === 12 && mClean.startsWith('57')) ? mClean.slice(2) : matched.phone
            setCustomerPhone(m10)
          }
          if (matched.address && !urlAddress) {
            setExactAddress(matched.address)
          }
          if (matched.barrio && !urlZone) {
            setMapSearch(matched.barrio)
            setZoneSearch(matched.barrio)
          }
          loadCustomerHistory(phone10 || cleanPhone || resolvedPhone, urlAddress || matched.address, urlZone, zones, matched.name)
        } else {
          loadCustomerHistory(phone10 || cleanPhone || resolvedPhone, urlAddress, urlZone, zones, name)
        }
      } catch {
        loadCustomerHistory(phone10 || cleanPhone || resolvedPhone, urlAddress, urlZone, zones, name)
      }
    }
  }

  useEffect(() => {
    if (editOrderId || !draftLoaded || loadedDraftKey !== activeDraftKey) return
    const phone = initialPhone
    const name = initialName
    const urlAddress = initialAddress
    const urlZone = initialZone

    if (phone || chatSessionId) {
      if (phone) {
        const cleanDigits = phone.replace(/\D/g, '')
        const p10 = (cleanDigits.length === 12 && cleanDigits.startsWith('57')) ? cleanDigits.slice(2) : cleanDigits
        if (p10 && p10.length >= 7 && p10.length <= 11 && p10 !== '3000000000' && p10 !== '0000000000') {
          setCustomerPhone(p10)
        }
        if (orderType === 'pickup' && !editOrderId) {
          setOrderType('delivery')
        }
      }
      lookupAndLoadCustomer(phone || '', name, urlAddress, urlZone)
    } else {
      if (name && (!customerName || customerName === 'Cliente Mostrador')) setCustomerName(name)
      if (urlAddress) setExactAddress(urlAddress)
    }

    if (urlZone) {
      setMapSearch(urlZone)
      setZoneSearch(urlZone)
      if (zones.length > 0) {
        const normUrlZone = normalizeText(urlZone)
        const matchedZone = zones.find(z => {
          return normalizeText(z.name) === normUrlZone
        })
        if (matchedZone) {
          setZoneId(matchedZone.id)
          setZoneSearch(matchedZone.name)
          setMapSearch(matchedZone.name)
          setZoneRateEdit(String(matchedZone.rate))
        }
      }
    }
  }, [initialPhone, initialName, initialAddress, initialZone, chatSessionId, draftLoaded, loadedDraftKey, activeDraftKey, zones, editOrderId])

  useEffect(() => {
    if (showChatDrawer && chatDrawerScrollRef.current) {
      if (shouldAutoScrollRef.current || userIsNearBottomRef.current) {
        chatDrawerScrollRef.current.scrollTop = chatDrawerScrollRef.current.scrollHeight
        shouldAutoScrollRef.current = false
      }
    }
  }, [chatDrawerMessages, showChatDrawer])

  const handleOpenChatDrawer = async () => {
    setShowChatDrawer(true)
    shouldAutoScrollRef.current = true
    userIsNearBottomRef.current = true

    // 1. Identificar ID de sesión objetivo (searchParams -> customerPhone match -> localStorage last active)
    let targetSessionId = chatSessionId || (typeof window !== 'undefined' ? localStorage.getItem('niche_last_active_whatsapp_session_id') : null)

    const cleanPhone = (customerPhone || '').replace(/\D/g, '')
    const phone10 = cleanPhone.length === 12 && cleanPhone.startsWith('57') ? cleanPhone.slice(2) : cleanPhone

    let cachedSession: any = null

    // Buscar en memoria global de sesiones primero (0ms instantáneo)
    if (globalSessionsCache && globalSessionsCache.length > 0) {
      if (phone10 && phone10.length >= 7) {
        cachedSession = globalSessionsCache.find(s => {
          const sClean = (s.phone || '').replace(/\D/g, '')
          const s10 = sClean.length === 12 && sClean.startsWith('57') ? sClean.slice(2) : sClean
          const scClean = (s.customerPhone || '').replace(/\D/g, '')
          const sc10 = scClean.length === 12 && scClean.startsWith('57') ? scClean.slice(2) : scClean
          return s10 === phone10 || sc10 === phone10 || s.phone === customerPhone || s.customerPhone === customerPhone
        })
      }
      if (!cachedSession && targetSessionId) {
        cachedSession = globalSessionsCache.find(s => s.id === targetSessionId)
      }
    }

    if (cachedSession) {
      targetSessionId = cachedSession.id
      setChatDrawerSession(cachedSession)
      if (cachedSession.messages && cachedSession.messages.length > 0) {
        setChatDrawerMessages(cachedSession.messages)
        setLoadingChatDrawer(false) // ¡Cargado en 0ms!
      } else {
        setLoadingChatDrawer(true)
      }
    } else {
      setLoadingChatDrawer(true)
    }

    // 2. Carga en segundo plano de mensajes frescos (con timeout rápido de 3.5s)
    try {
      if (!targetSessionId && phone10 && phone10.length >= 7) {
        const sessions = await api.get<any[]>(`/whatsapp/sessions?search=${phone10}`).catch(() => [])
        if (sessions.length > 0) {
          cachedSession = sessions[0]
          targetSessionId = cachedSession.id
          setChatDrawerSession(cachedSession)
        }
      }

      if (targetSessionId) {
        if (!cachedSession) {
          const s = await api.get<any>(`/whatsapp/sessions/${targetSessionId}`).catch(() => null)
          if (s) setChatDrawerSession(s)
        }

        const msgs = await Promise.race([
          api.get<any[]>(`/whatsapp/sessions/${targetSessionId}/messages`),
          new Promise<any[]>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3500))
        ]).catch(() => [])

        if (msgs && Array.isArray(msgs) && msgs.length > 0) {
          setChatDrawerMessages(msgs)
        }
      }
    } catch (err) {
      console.error('Error cargando chat emergente:', err)
    } finally {
      setLoadingChatDrawer(false)
    }
  }

  const handleSendDrawerReply = async () => {
    if (!chatDrawerReplyText.trim() || !chatDrawerSession) return
    const text = chatDrawerReplyText.trim()
    setChatDrawerReplyText('')

    shouldAutoScrollRef.current = true
    userIsNearBottomRef.current = true

    const optimisticMsg = {
      id: `temp-${Date.now()}`,
      direction: 'OUT',
      content: text,
      messageType: 'text',
      status: 'sent',
      createdAt: new Date().toISOString()
    }
    setChatDrawerMessages(prev => [...prev, optimisticMsg])

    try {
      await api.post('/whatsapp/send', {
        phone: chatDrawerSession.phone,
        text
      })
    } catch (err: any) {
      console.error('Error enviando respuesta rápida:', err)
    }
  }

  const parseOrderText = (text: string) => {
    if (!text.trim()) return null

    const lines = text.split('\n')
      .map(l => l.trim())
      .filter(l => {
        if (l.length < 2) return false
        const lLower = l.toLowerCase()
        if (
          lLower.startsWith('asistente:') ||
          lLower.startsWith('bot:') ||
          lLower.startsWith('asesor:') ||
          lLower.startsWith('restaurante:') ||
          lLower.startsWith('niche:') ||
          lLower.includes('tu pedido #') ||
          lLower.includes('detalle de tu pedido') ||
          lLower.includes('valor del pedido') ||
          lLower.includes('total a pagar') ||
          lLower.includes('método de pago') ||
          lLower.includes('metodo de pago') ||
          lLower.includes('te avisaremos') ||
          lLower.startsWith('plantilla meta:') ||
          lLower.startsWith('welcome') ||
          lLower.includes('sistemaniche.com')
        ) return false
        return true
      })
      .map(l => l.replace(/^cliente:\s*/i, '').trim())
      .filter(l => l.length > 1)
    
    const flatItems = (categories || [])
      .filter(c => c && c.name !== 'Adicionales para Pizza' && c.name !== 'Adicionales')
      .flatMap(c => (c?.items || []).map(i => ({ ...i, category: { name: c?.name || '' } })))

    const stopWords = new Set([
      'solo', 'para', 'esta', 'este', 'todo', 'con', 'sin', 'las', 'los', 'del', 'una', 'uno', 'mas', 
      'por', 'que', 'de', 'la', 'el', 'un', 'y', 'o', 'a', 'en', 'quiero', 'buenas', 'hola', 'favor', 
      'pedido', 'mandame', 'enviame', 'deme', 'das', 'regalame', 'porfa', 'noches', 'tardes', 
      'dias', 'gracias', 'amigo', 'vecino', 'nequi', 'daviplata', 'bancolombia', 'efectivo'
    ])

    const sizeWords = ['personal', 'mediana', 'familiar', 'semifamiliar', 'extragrande', 'pequena', 'pequeno', 'grande']

    const parsedCartItems: { 
      menuItem: MenuItem; 
      quantity: number; 
      preference: string; 
      additions: MenuItem[]; 
      notes?: string; 
    }[] = []

    let detectedOrderType: 'delivery' | 'pickup' | null = null
    const independentNotes: string[] = []

    for (const line of lines) {
      const lineLower = line.toLowerCase()
      if (lineLower.includes('nequi') || lineLower.includes('transferencia') || lineLower.includes('bancolombia') || lineLower.includes('daviplata')) {
        // Línea de método de pago, no de producto
      }

      const clauses = line
        .split(/[,:\(\)\+\-]|(?:\s+y\s+)|(?:\s+e\s+)/i)
        .map(c => c.trim())
        .filter(c => c.length > 0)

      for (const clause of clauses) {
        const normalizedClause = normalizeText(clause)
        const clauseLower = clause.toLowerCase()

        if (clauseLower.includes('llevar') || clauseLower.includes('domicilio')) {
          detectedOrderType = 'delivery'
        } else if (clauseLower.includes('comer') || clauseLower.includes('aqui') || clauseLower.includes('mesa') || clauseLower.includes('recoger')) {
          detectedOrderType = 'pickup'
          if (clauseLower.includes('mesa')) {
            if (!independentNotes.includes('Mesa')) independentNotes.push('Mesa')
          }
        }

        // Buscar coincidencia de producto en catálogo
        let bestMatch: { item: MenuItem; score: number } | null = null
        for (const item of flatItems) {
          const normalizedName = normalizeText(item.name)
          if (normalizedName.length < 3) continue

          const isMitadProduct = normalizedName.includes('mitad')
          const isClauseMitad = normalizedClause.includes('mitad')
          if (isMitadProduct && !isClauseMitad) {
            continue // Si el cliente no pide mitad y mitad, NO emparejar pizzas combinadas
          }

          let score = 0
          if (normalizedClause.includes(normalizedName)) {
            score += 80 + normalizedName.length
          }

          const allItemWords = normalizedName.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w))
          const coreWords = allItemWords.filter(w => !sizeWords.includes(w))

          if (coreWords.length > 0) {
            let matchedCore = 0
            for (const cw of coreWords) {
              if (normalizedClause.includes(cw)) {
                matchedCore++
              }
            }
            if (matchedCore === coreWords.length) {
              score += 60 + (coreWords.length * 15)
            } else if (matchedCore > 0 && coreWords.length > 1) {
              score += matchedCore * 10
            }
          }

          // DISTINCIÓN ENTRE PERROS CALIENTES, HAMBURGUESAS, SUIZOS, SALVAJADAS Y BEBIDAS
          const isPerroItem = normalizedName.includes('perro')
          const isSuizoDishItem = !isPerroItem && normalizedName.includes('suizo')
          const clauseHasPerro = normalizedClause.includes('perro')
          const clauseHasSuizo = normalizedClause.includes('suizo') || normalizedClause.includes('suiza')

          if (clauseHasPerro && clauseHasSuizo) {
            // Cliente pide "perro suizo"
            if (normalizedName === 'perro suizo') score += 140
            else if (isSuizoDishItem) score -= 80
          } else if (clauseHasPerro && !clauseHasSuizo) {
            // Cliente pide otro perro
            if (isPerroItem) {
              score += 50
              if (normalizedClause.includes('sencillo') && normalizedName.includes('sencillo')) score += 80
              if (normalizedClause.includes('especial') && normalizedName.includes('especial')) score += 80
              if (normalizedClause.includes('super') && normalizedName.includes('super')) score += 80
              if (normalizedClause.includes('combo') && normalizedName.includes('combo')) score += 80
            } else if (isSuizoDishItem) {
              score -= 80
            }
          } else if (!clauseHasPerro && clauseHasSuizo) {
            // Cliente pide suizo al plato
            if (isSuizoDishItem) score += 70
            else if (isPerroItem) score -= 80
          }

          // HAMBURGUESAS
          const isBurgerItem = normalizedName.includes('hamburguesa') || normalizedName.includes('burger')
          const clauseHasBurger = normalizedClause.includes('hamburguesa') || normalizedClause.includes('burger')
          if (clauseHasBurger) {
            if (isBurgerItem) {
              score += 60
              if (normalizedClause.includes('sencilla') && normalizedName.includes('sencilla')) score += 80
              if (normalizedClause.includes('especial') && normalizedName.includes('especial')) score += 80
              if (normalizedClause.includes('super') && normalizedName.includes('super')) score += 80
              if (normalizedClause.includes('mixta') && normalizedName.includes('mixta')) score += 80
              if (normalizedClause.includes('combo') && normalizedName.includes('combo')) score += 80
            } else {
              score -= 60
            }
          }

          // SALVAJADAS
          const isSalvajadaItem = normalizedName.includes('salvajada')
          const clauseHasSalvajada = normalizedClause.includes('salvajada')
          if (clauseHasSalvajada) {
            if (isSalvajadaItem) {
              score += 70
              if ((normalizedClause.includes('chica') || normalizedClause.includes('pequena')) && normalizedName.includes('chica')) score += 80
              if (normalizedClause.includes('matrimonio') && normalizedName.includes('matrimonio')) score += 80
              if (normalizedClause.includes('trio') && normalizedName.includes('trio')) score += 80
              if (normalizedClause.includes('super') && normalizedName.includes('super')) score += 80
            } else {
              score -= 70
            }
          }

          // Verificación de tamaño
          let clauseHasSize = false
          for (const sz of sizeWords) {
            if (normalizedClause.includes(sz)) {
              clauseHasSize = true
              if (normalizedName.includes(sz)) {
                score += 40
              } else {
                score -= 20
              }
            }
          }

          // Si el cliente no especificó tamaño, preferir la variante "personal"
          if (!clauseHasSize) {
            if (normalizedName.includes('personal')) {
              score += 25
            } else if (normalizedName.includes('mediana') || normalizedName.includes('familiar') || normalizedName.includes('semifamiliar')) {
              score -= 15
            }
          }

          // Verificación de Papas (Francesa vs al Vapor)
          const isVaporVariant = normalizedName.includes('vapor') || normalizedName.includes('cocida')
          const clauseHasVapor = normalizedClause.includes('vapor') || normalizedClause.includes('cocida')
          if (clauseHasVapor) {
            if (isVaporVariant) score += 35
            else if (normalizedName.includes('francesa')) score -= 25
          } else {
            // Por defecto, si el cliente NO pidió vapor, preferir fuertemente Francesa y penalizar Vapor
            if (normalizedName.includes('francesa')) {
              score += 30
            } else if (isVaporVariant) {
              score -= 30
            }
          }

          if (score > 0 && (!bestMatch || score > bestMatch.score)) {
            bestMatch = { item, score }
          }
        }

        // La cantidad puede ir antes o después del producto y puede estar
        // separada por texto (“quiero 2 perros”, “perro sencillo x2”,
        // “perro sencillo 2”). Antes solo se detectaba cuando comenzaba la
        // cláusula, por eso los chats antiguos quedaban con el carrito vacío
        // o con una sola unidad.
        const qtyMatch = clause.match(/(?:^|\s)(\d{1,2})\s*(?:x|unidades?|uds?\.?|de|\*)?(?=\s|$)/i)
          || clause.match(/(?:x|de|\*)\s*(\d{1,2})\b/i)
        const trailingWordQuantity = clause.match(/\b(un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*$/i)
        let parsedQuantity = 1
        if (qtyMatch) {
          parsedQuantity = Math.min(99, parseInt(qtyMatch[1], 10))
        } else if (trailingWordQuantity) {
          const wordMap: Record<string, number> = {
            'un': 1, 'una': 1, 'uno': 1, 'dos': 2, 'tres': 3,
            'cuatro': 4, 'cinco': 5, 'seis': 6, 'siete': 7,
            'ocho': 8, 'nueve': 9, 'diez': 10
          }
          parsedQuantity = wordMap[trailingWordQuantity[1].toLowerCase()] || 1
        } else {
          const wordNumMatch = clause.match(/^(un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/i)
          if (wordNumMatch) {
            const wordMap: Record<string, number> = {
              'un': 1, 'una': 1, 'uno': 1, 'dos': 2, 'tres': 3,
              'cuatro': 4, 'cinco': 5, 'seis': 6, 'siete': 7,
              'ocho': 8, 'nueve': 9, 'diez': 10
            }
            parsedQuantity = wordMap[wordNumMatch[1].toLowerCase()] || 1
          }
        }

        if (bestMatch && bestMatch.score >= 50) {
          const matchedItem = bestMatch.item

          // Extraer adiciones
          const matchedAdditions: MenuItem[] = []
          const additionItems = (categories || [])
            .filter(c => c && (c.name === 'Adicionales para Pizza' || c.name === 'Adicionales'))
            .flatMap(c => (c?.items || []).map(i => ({ ...i, category: { name: c?.name || '' } })))

          for (const add of additionItems) {
            const cleanAddName = add.name.replace(/^(adic\.|adicionales|adicional)\s+/i, '').split(/\s*-\s*/)[0].trim().toLowerCase()
            const normalizedAddName = normalizeText(cleanAddName)
            const regexSin = new RegExp(`\\bsin\\s+${normalizedAddName}\\b`, 'i')
            const isExcluded = regexSin.test(normalizedClause) || normalizedClause.includes(`sin ${normalizedAddName}`)
            if (normalizedAddName.length > 1 && normalizedClause.includes(normalizedAddName) && !isExcluded) {
              matchedAdditions.push(add)
            }
          }

          // Extraer notas de cocina reales (descartando nombres de productos y frases vacías)
          let cleanClauseNotes = keepKitchenInstruction(clause, matchedItem.name)
          if (cleanClauseNotes) {
            cleanClauseNotes = cleanClauseNotes
              .replace(/^\d+\s*/, '')
              .replace(/^(un|una|uno|otro|otra|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+/i, '')
              .replace(/^(y|e|con|para|quiero|me das|porfa|por favor)\s+/i, '')
              .trim()
            
            // Si lo que quedó es solo el nombre del producto o palabras vacías, anular la nota
            const normRemaining = normalizeText(cleanClauseNotes)
            const isJustProductWord = normRemaining.split(/\s+/).every(w => stopWords.has(w) || normalizeText(matchedItem.name).includes(w))
            const isProductFragment = /^(?:\d+\s*(?:x\s*)?)?(?:perro|hamburguesa|pizza|gaseosa|jugo|combo|salchich\w*|doble\s+salchich\w*|triple\s+salchich\w*)(?:\s+\d+)?$/.test(normRemaining)
            if (isJustProductWord || isProductFragment) {
              cleanClauseNotes = ''
            }
          }

          // Verificar si la nota especifica una cantidad parcial (ej: "2 perros, 1 sin cebolla" -> 1 sin cebolla, 1 normal)
          const wordToNum: Record<string, number> = { 'un': 1, 'una': 1, 'uno': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5, 'seis': 6 }
          const partialNoteQtyMatch = clause.match(/(?:^|\s)(\d+|un|una|uno|dos|tres|cuatro|cinco)\s+(?:sin|con|solo\s+con)\s+([a-záéíóúñ\s]+)/i)
          let partialQty = 0
          if (partialNoteQtyMatch) {
            const rawPart = partialNoteQtyMatch[1].toLowerCase()
            partialQty = parseInt(rawPart, 10) || wordToNum[rawPart] || 0
          }

          if (cleanClauseNotes && partialQty > 0 && partialQty < parsedQuantity) {
            // Dividir en 2 líneas separadas para cocina: los que llevan la nota y los que van normales
            parsedCartItems.push({
              menuItem: matchedItem,
              quantity: partialQty,
              preference: (clauseLower.includes('llevar') || clauseLower.includes('domicilio')) ? 'Para llevar' : '',
              additions: matchedAdditions,
              notes: cleanClauseNotes
            })
            parsedCartItems.push({
              menuItem: matchedItem,
              quantity: parsedQuantity - partialQty,
              preference: (clauseLower.includes('llevar') || clauseLower.includes('domicilio')) ? 'Para llevar' : '',
              additions: [],
              notes: undefined
            })
          } else {
            parsedCartItems.push({
              menuItem: matchedItem,
              quantity: parsedQuantity,
              preference: (clauseLower.includes('llevar') || clauseLower.includes('domicilio')) ? 'Para llevar' : '',
              additions: matchedAdditions,
              notes: cleanClauseNotes || undefined
            })
          }
        }
      }
    }

    return {
      parsedCartItems,
      detectedOrderType,
      independentNotes,
      customerName: null,
      customerPhone: null,
      customerAddress: null,
      customerAddressReference: null,
      customerNeighborhood: null,
      paymentMethod: null,
      zoneId: undefined
    }
  }

  const handleQuickTextParse = async () => {
    if (!quickText.trim() || parsingQuickText) return
    setParsingQuickText(true)

    let parsed = null
    try {
      parsed = await api.post<ParsedOrderResponse>('/whatsapp/parse-order', { text: quickText })
      if (!parsed || !parsed.parsedCartItems) {
        throw new Error('Respuesta inválida del servidor')
      }
    } catch (err) {
      console.warn('Fallo el parseo inteligente en backend con Gemini, usando contingencia local:', err)
      parsed = parseOrderText(quickText)
    } finally {
      setParsingQuickText(false)
    }

    if (!parsed) return

    if ('modelUsed' in parsed && parsed.modelUsed) setOrderReaderModel(parsed.modelUsed)

    const { parsedCartItems, detectedOrderType, paymentMethod: extPaymentMethod, independentNotes, customerName: extName, customerPhone: extPhone, customerAddress: extAddress, customerAddressReference: extAddressRef, customerNeighborhood: extNeighborhood, zoneId: extZoneId } = parsed

    if (extName) {
      setCustomerName(extName)
    }
    if (extPhone) {
      setCustomerPhone(extPhone)
    }
    if (extAddress) {
      setExactAddress(extAddress)
    }
    if (extAddressRef) {
      setAddressReference(extAddressRef)
    }
    if (extPaymentMethod) {
      setPaymentMethod(extPaymentMethod)
    }

    // Auto-selección y cálculo inteligente de tarifa de barrio/zona de Montería
    let matchedZone: Zone | undefined = undefined
    if (extZoneId) {
      matchedZone = zones.find(z => z.id === extZoneId)
    }
    if (!matchedZone && extNeighborhood) {
      const normNeigh = extNeighborhood.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
      matchedZone = zones.find(z => {
        const zn = z.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
        return zn === normNeigh
      })
    }

    if (matchedZone) {
      selectZone(matchedZone)
    } else if (extNeighborhood) {
      setZoneSearch(extNeighborhood)
    }

    if (detectedOrderType) {
      setOrderType(detectedOrderType)
    }
    if (independentNotes && independentNotes.length > 0) {
      setNotes(prev => {
        const currentNotes = prev ? prev.split(' — ').map(n => n.trim()) : []
        const uniqueNewNotes = independentNotes.filter(n => !currentNotes.includes(n))
        if (uniqueNewNotes.length === 0) return prev
        return [...currentNotes, ...uniqueNewNotes].join(' — ')
      })
    }

    if (parsedCartItems && parsedCartItems.length > 0) {
      setCart(prev => {
        let updatedCart = [...prev]
        let addedAny = false

        for (const parsedItem of parsedCartItems) {
          const item = parsedItem.menuItem
          const lineId = `line-${Math.random().toString(36).substring(2, 9)}`
          const parentTag = `(#${lineId})`

          const isAlreadyInCart = parsedItem.preference 
            ? updatedCart.some(i => i.menuItemId === item.id && i.notes?.includes(parsedItem.preference))
            : false
          if (isAlreadyInCart) continue

          const additionsToInsert: MenuItem[] = []
          if (parsedItem.additions.length > 0) {
            const parentNameLower = item.name.toLowerCase()
            const sizes = ['personal', 'mediana', 'mediano', 'semifamiliar', 'familiar']
            const parentSize = sizes.find(s => parentNameLower.includes(s))

            for (const add of parsedItem.additions) {
              const nameLower = add.name.toLowerCase()
              const hasSize = sizes.some(s => nameLower.includes(s))
              if (hasSize && parentSize) {
                if (nameLower.includes(parentSize)) {
                  additionsToInsert.push(add)
                }
              } else {
                additionsToInsert.push(add)
              }
            }
            if (additionsToInsert.length === 0) {
              additionsToInsert.push(...parsedItem.additions)
            }
          }

          const cleanPref = parsedItem.preference ? keepKitchenInstruction(parsedItem.preference, item.name) : ''
          const cleanNote = parsedItem.notes ? keepKitchenInstruction(parsedItem.notes, item.name) : ''

          let parentNotes = ''
          const hasAdditions = additionsToInsert.length > 0

          if (cleanPref && cleanNote) {
            parentNotes = `${cleanPref} — ${cleanNote}`
          } else if (cleanPref) {
            parentNotes = cleanPref
          } else if (cleanNote) {
            parentNotes = cleanNote
          }

          if (hasAdditions) {
            parentNotes = parentNotes ? `${parentNotes} ${parentTag}` : parentTag
          }

          updatedCart.push({ 
            menuItemId: item.id, 
            name: item.name, 
            price: item.price, 
            quantity: parsedItem.quantity, 
            lineId, 
            notes: parentNotes || undefined 
          })

          for (const addition of additionsToInsert) {
            updatedCart.push({
              menuItemId: addition.id,
              name: addition.name,
              price: addition.price,
              quantity: parsedItem.quantity,
              lineId: `line-${Math.random().toString(36).substring(2, 9)}`,
              notes: `Adición para: ${item.name} ${parentTag}`
            })
          }

          addedAny = true
        }
        return addedAny ? consolidateCart(updatedCart) : prev
      })
    }

    setQuickText('')
  }

  useEffect(() => {
    if (editOrderId || initialLoading || !draftLoaded || loadedDraftKey !== activeDraftKey) return

    const chatParseKey = chatSessionId ? `${chatSessionId}:${chatTranscriptRevision}` : null
    if (chatSessionId && categories.length > 0 && lastParsedSessionIdRef.current !== chatParseKey) {
      lastParsedSessionIdRef.current = chatParseKey
      
      const initialUrlAddress = initialAddress
      const initialUrlZone = initialZone
      const initialUrlName = initialName
      const initialUrlPhone = initialPhone

      // Un borrador útil se conserva; uno vacío no debe impedir que se lea el chat.
      if (!hasRestoredDraft) {
        setCart([])
        autoParsedCartRef.current = null
        setCustomerName(initialUrlName || '')
        setCustomerPhone(initialUrlPhone || '')
        setExactAddress(initialUrlAddress || '')
        setAddressReference('')
        setZoneId('')
        setZoneSearch(initialUrlZone || '')
        setMapSearch(initialUrlZone || '')
        setNotes('')
      }

      setOrderReaderModel('')

      setParsingChatOrder(true)
      Promise.all([
        api.get<any>(`/whatsapp/sessions/${chatSessionId}`),
        api.get<any[]>(`/whatsapp/sessions/${chatSessionId}/messages?limit=200`, { force: true }),
        api.get<{ enabled?: boolean }>('/whatsapp/order-reader-status').catch(() => ({ enabled: false })),
      ])
        .then(async ([session, messages, readerStatus]) => {
          const readerEnabled = readerStatus?.enabled === true
          setOrderReaderEnabled(readerEnabled)
          if (session) {
            if (session.customerName && session.customerName !== session.phone && !session.customerName.startsWith('@') && !initialUrlName) {
              setCustomerName(session.customerName)
            }
            if (!initialUrlPhone) {
              const rawTarget = session.customerPhone || session.phone || ''
              const cleanDigits = rawTarget.replace(/\D/g, '')
              const phone10 = (cleanDigits.length === 12 && cleanDigits.startsWith('57')) ? cleanDigits.slice(2) : cleanDigits
              if (phone10.length === 10 && phone10.startsWith('3')) {
                setCustomerPhone(phone10)
              } else if (cleanDigits.length >= 7 && cleanDigits.length <= 11) {
                setCustomerPhone(cleanDigits)
              } else if (session.customerPhone) {
                setCustomerPhone(session.customerPhone)
              }
            }
          }

          const isPersistedOrderMessage = (message: any) => {
            if (message?.direction !== 'OUT') return false
            const content = String(message?.content || '').toLowerCase()
            const hasOrderNumber = /pedido\s*#\s*\d+/.test(content)
            return hasOrderNumber && (
              content.includes('ha sido recibido') ||
              content.includes('está siendo preparado') ||
              content.includes('ha sido actualizado') ||
              content.includes('ha sido cancelado') ||
              content.includes('ya va en camino') ||
              content.includes('ha sido entregado')
            )
          }

          // Cortar solo después de una confirmación real generada al guardar un
          // pedido. Una frase del bot con "total" no significa que ya exista.
          let lastOrderMsgIndex = -1
          for (let i = 0; i < messages.length; i++) {
            if (isPersistedOrderMessage(messages[i])) lastOrderMsgIndex = i
          }

          // Nuevo pedido siempre empieza con una ventana reciente. Así un pedido
          // de las 7:00 p. m. no se mezcla con uno que el mismo cliente hace a
          // las 10:00 p. m., aunque no haya una confirmación antigua en el chat.
          const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000)
          const isWithinRecentContext = (message: any) => {
            const timestamp = new Date(message?.createdAt || 0).getTime()
            return Number.isFinite(timestamp) && timestamp >= twoHoursAgo
          }
          let relevantSlice: any[] = []
          if (lastOrderMsgIndex >= 0) {
            if (lastOrderMsgIndex < messages.length - 1) {
              relevantSlice = messages.slice(lastOrderMsgIndex + 1).filter(isWithinRecentContext)
            } else {
              relevantSlice = []
            }
          } else {
            relevantSlice = messages.filter(isWithinRecentContext)
          }

          const getAudioTranscript = (content: unknown) => {
            const raw = String(content || '')
            const marker = raw.match(/(?:^|\|)\s*📝\s*Transcripción:\s*([\s\S]+)/i)
            return marker?.[1]?.trim() || ''
          }
          const messageForOrderReader = (message: any) => message.messageType === 'audio'
            ? `Nota de voz transcrita: ${getAudioTranscript(message.content)}`
            : String(message.content || '')

          // Se incluyen textos y notas de voz ya transcritas. Las imágenes,
          // videos y archivos siguen siendo revisables en el chat sin que la
          // IA invente contenido a partir de ellos.
          let recentMessages = relevantSlice
            .filter(m => {
              if (m.messageType === 'audio') return Boolean(getAudioTranscript(m.content))
              if (m.messageType && m.messageType !== 'text') return false
              const txt = (m.content || '').trim()
              if (!txt) return false
              const txtLower = txt.toLowerCase()
              if (
                isPersistedOrderMessage(m) ||
                txt.startsWith('Plantilla Meta:') || 
                txt.startsWith('Welcome') || 
                txt.includes('sistemaniche.com') ||
                txtLower.includes('pedido ha sido cancelado') ||
                txtLower.includes('pedido ya va en camino') ||
                txtLower.includes('pedido ha sido entregado')
              ) return false
              return true
            })
            // 120 mensajes cubren conversaciones largas sin mandar un
            // historial ilimitado a Gemini. El reconocimiento local recorre
            // la misma ventana y se muestra antes de la llamada remota.
            .slice(-120)

          setChatContextMessageCount(recentMessages.length)

          // Si no hay mensajes entrantes del cliente en la conversación actual, no autollenar nada
          const hasIncomingCustomerMsg = recentMessages.some(m => m.direction === 'IN')
          if (recentMessages.length === 0 || !hasIncomingCustomerMsg) return

          // Hoy la toma es manual. El asesor ve los mensajes recientes pero el
          // sistema no llena productos ni consulta IA mientras esta opción esté
          // pausada en Configuración técnica.
          if (!readerEnabled) return

          const latestIncomingAt = recentMessages
            .filter(m => m.direction === 'IN')
            .reduce((latest, message) => Math.max(latest, new Date(message.createdAt).getTime() || 0), 0)
           // Un borrador con datos de entrega, pero sin productos, todavía debe
           // leer el pedido del chat. Solo omitimos el parseo si el borrador ya
           // tiene líneas y es más reciente que el último mensaje del cliente.
           if (hasRestoredDraft && restoredDraftHasItemsRef.current && restoredDraftUpdatedAtRef.current >= latestIncomingAt) return

          const customerText = recentMessages
            .filter(m => {
              const cLower = (m.content || '').toLowerCase()
              if (m.direction === 'OUT') {
                if (
                  cLower.includes('menu digital') ||
                  cLower.includes('menú digital') ||
                  cLower.includes('menú y precios villa dog') ||
                  cLower.includes('opcion 1') ||
                  cLower.includes('opción 1') ||
                  String(m.content || '').length > 1200
                ) return false
              }
              return true
            })
            .map(m => `${m.direction === 'IN' ? 'Cliente' : 'Asistente'}: ${messageForOrderReader(m)}`)
            .join('\n')

          if (!customerText.trim()) return

           const incomingCustomerOnlyText = recentMessages
             .filter(m => m.direction === 'IN')
             .map(messageForOrderReader)
             .join('\n')

           // En chats donde el cliente confirmó el pedido con una respuesta corta
           // (“sí”, “domicilio”, etc.), el producto puede aparecer únicamente en
           // el resumen que el bot ya escribió. Es una fuente válida de contexto
           // para el producto, pero no para inventar dirección, barrio o precios.
           const flatCatalog = categories
             .filter(c => c && !isAdditionCategory(c.name, c.description))
             .flatMap(c => c.items || [])
           const likelyOrderSummary = (content: string) => {
             const normalized = normalizeText(content)
             if (!normalized || /menu y precios|carta actualizada|categorias principales|detalle de tu pedido|total a pagar|disponibles con sus precios|precios de alguna categoria|agregarlo a tu pedido/.test(normalized)) {
               return false
             }
             const hasProduct = flatCatalog.some(item => {
               const name = normalizeText(item.name)
               if (name.length < 4) return false
               if (normalized.includes(name)) return true
               const words = name.split(/\s+/).filter(word => word.length > 3)
               return words.length > 0 && words.every(word => normalized.includes(word))
             })
             return hasProduct && /ya tengo|tengo anotad|quedan anotad|excelente eleccion|pedido (?:queda|es|confirmado|para)|productos? anotad|listo/.test(normalized)
           }
           const assistantOrderHintMessages = recentMessages
             .filter(m => m.direction === 'OUT' && likelyOrderSummary(String(m.content || '')))
           // Un chat puede repetir el mismo resumen varias veces. Tomar solo el
           // último evita sumar dos veces “dos perros” al reconstruir el carrito.
           const assistantOrderHintText = assistantOrderHintMessages.length > 0
             ? String(assistantOrderHintMessages[assistantOrderHintMessages.length - 1].content || '')
             : ''

           // Parseo local instantáneo (sin esperar red). Primero se respetan los
           // productos escritos por el cliente; si no hay ninguno, se usa el
           // resumen del bot para recuperar el pedido que ya quedó confirmado.
           const incomingParsed = parseOrderText(incomingCustomerOnlyText)
           const assistantParsed = assistantOrderHintText ? parseOrderText(assistantOrderHintText) : null
           const localParsed = incomingParsed && incomingParsed.parsedCartItems.length > 0
             ? incomingParsed
             : (assistantParsed && assistantParsed.parsedCartItems.length > 0
                 ? { ...incomingParsed, parsedCartItems: assistantParsed.parsedCartItems }
                 : incomingParsed)

           const applyData = (dataToApply: any, source: 'local' | 'remote' = 'remote') => {
             if (!dataToApply) return

            let { parsedCartItems, detectedOrderType, paymentMethod: extPaymentMethod, independentNotes, customerName: extName, customerPhone: extPhone, customerAddress: extAddress, customerAddressReference: extAddressRef, customerNeighborhood: extNeighborhood, zoneId: extZoneId } = dataToApply

            detectedOrderType ||= extractOrderType(incomingCustomerOnlyText)
            extPaymentMethod ||= extractPaymentMethod(incomingCustomerOnlyText)
            extNeighborhood ||= extractNeighborhood(incomingCustomerOnlyText)
            extAddress ||= extractStreetAddress(incomingCustomerOnlyText)

            // Fallback regex for address & neighborhood if empty
            if (!extAddress && !initialUrlAddress) {
              extAddress = extractStreetAddress(incomingCustomerOnlyText)
            }

            if (!extNeighborhood && !initialUrlZone) {
              extNeighborhood = extractNeighborhood(incomingCustomerOnlyText)
            }

            if (extName && extName.trim() && !initialUrlName) {
              setCustomerName(extName)
            }
            if (extPhone && extPhone.trim() && !initialUrlPhone) {
              const cleanedExtPhone = (extPhone.startsWith('57') && extPhone.length === 12)
                ? extPhone.substring(2)
                : extPhone
              setCustomerPhone(cleanedExtPhone)
            }

            // Auto-selección y cálculo inteligente de tarifa de barrio/zona de Montería
            let matchedZone: Zone | undefined = undefined
            if (extZoneId) {
              matchedZone = zones.find(z => z.id === extZoneId)
            }
            if (!matchedZone && extNeighborhood) {
              const normNeigh = extNeighborhood.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
              matchedZone = zones.find(z => {
                const zn = z.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
                return zn === normNeigh
              })
            }

            if (matchedZone) {
              selectZone(matchedZone)
            } else if (extNeighborhood && extNeighborhood.trim()) {
              setZoneSearch(extNeighborhood)
              setMapSearch(extNeighborhood)
            } else if (initialUrlZone) {
              setZoneSearch(initialUrlZone)
              setMapSearch(initialUrlZone)
            }

            if (extAddress && extAddress.trim()) {
              setExactAddress(extAddress)
            } else if (initialUrlAddress) {
              setExactAddress(initialUrlAddress)
            }

            if (extAddressRef && extAddressRef.trim()) {
              setAddressReference(extAddressRef.trim())
            }

            if (extPaymentMethod) {
              setPaymentMethod(extPaymentMethod)
            }

            if (detectedOrderType) {
              setOrderType(detectedOrderType)
            }
            if (independentNotes && independentNotes.length > 0) {
              setNotes(prev => {
                const currentNotes = prev ? prev.split(' — ').map(n => n.trim()) : []
                const uniqueNewNotes = independentNotes.filter((n: string) => !currentNotes.includes(n))
                if (uniqueNewNotes.length === 0) return prev
                return [...currentNotes, ...uniqueNewNotes].join(' — ')
              })
            }

            if (parsedCartItems && parsedCartItems.length > 0) {
              setSuggestedProducts(parsedCartItems.map((p: any) => p.menuItem).filter((v: any, i: number, a: any[]) => a.findIndex(t => t.id === v.id) === i))
              
              const newCart: CartItem[] = []

              for (const parsedItem of parsedCartItems) {
                const item = parsedItem.menuItem
                // Reutilizar lineId existente si coincide el menuItemId para preservar claves de React y evitar parpadeos
                const existingMatch = (autoParsedCartRef.current || []).find(c => c.menuItemId === item.id)
                const lineId = existingMatch?.lineId || `line-${Math.random().toString(36).substring(2, 9)}`
                const parentTag = `(#${lineId})`

                const additionsToInsert: MenuItem[] = []
                if (parsedItem.additions.length > 0) {
                  const parentNameLower = item.name.toLowerCase()
                  const sizes = ['personal', 'mediana', 'mediano', 'semifamiliar', 'familiar']
                  const parentSize = sizes.find(s => parentNameLower.includes(s))

                  for (const add of parsedItem.additions) {
                    const nameLower = add.name.toLowerCase()
                    const hasSize = sizes.some(s => nameLower.includes(s))
                    if (hasSize && parentSize) {
                      if (nameLower.includes(parentSize)) {
                        additionsToInsert.push(add)
                      }
                    } else {
                      additionsToInsert.push(add)
                    }
                  }
                  if (additionsToInsert.length === 0) {
                    additionsToInsert.push(...parsedItem.additions)
                  }
                }

                const cleanPref = parsedItem.preference ? keepKitchenInstruction(parsedItem.preference, item.name) : ''
                const cleanNote = parsedItem.notes ? keepKitchenInstruction(parsedItem.notes, item.name) : ''

                let parentNotes = ''
                const hasAdditions = additionsToInsert.length > 0

                if (cleanPref && cleanNote) {
                  parentNotes = `${cleanPref} — ${cleanNote}`
                } else if (cleanPref) {
                  parentNotes = cleanPref
                } else if (cleanNote) {
                  parentNotes = cleanNote
                }

                if (hasAdditions) {
                  parentNotes = parentNotes ? `${parentNotes} ${parentTag}` : parentTag
                }

                newCart.push({ 
                  menuItemId: item.id, 
                  name: item.name, 
                  price: item.price, 
                  quantity: parsedItem.quantity, 
                  lineId, 
                  notes: parentNotes || undefined 
                })

                for (const addition of additionsToInsert) {
                  const existingAdd = (autoParsedCartRef.current || []).find(c => c.menuItemId === addition.id && c.notes?.includes(parentTag))
                  newCart.push({
                    menuItemId: addition.id,
                    name: addition.name,
                    price: addition.price,
                    quantity: parsedItem.quantity,
                    lineId: existingAdd?.lineId || `line-${Math.random().toString(36).substring(2, 9)}`,
                    notes: `Adición para: ${item.name} ${parentTag}`
                  })
                }
              }

              if (newCart.length > 0) {
                const normalizedCart = consolidateCart(newCart)
                const cartUnits = (items: CartItem[]) => items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0)
                const isEquivalentCart = (a: CartItem[], b: CartItem[]) => {
                  if (a.length !== b.length) return false
                  return a.every((itemA, idx) => {
                    const itemB = b[idx]
                    if (!itemB) return false
                    const noteA = getItemRawNote(itemA.notes || '').trim()
                    const noteB = getItemRawNote(itemB.notes || '').trim()
                    return itemA.menuItemId === itemB.menuItemId &&
                      itemA.quantity === itemB.quantity &&
                      noteA === noteB
                  })
                }

                if (source === 'local') {
                  autoParsedCartRef.current = normalizedCart
                  // Un borrador que el asesor ya empezó a editar tiene prioridad.
                  setCart(prev => prev.length > 0 ? prev : normalizedCart)
                } else {
                  const localUnits = autoParsedCartRef.current ? cartUnits(autoParsedCartRef.current) : 0
                  const remoteUnits = cartUnits(normalizedCart)
                  // Gemini puede responder con solo una línea mientras termina
                  // de leer el historial. Nunca se permite que borre unidades ya
                  // detectadas de forma local.
                  if (localUnits > remoteUnits) return

                  // Si lo detectado por Gemini es idéntico a lo que ya reconoció el lector local,
                  // NO re-ejecutar setCart para evitar el refresco/reinicio visual de los productos.
                  if (autoParsedCartRef.current && isEquivalentCart(autoParsedCartRef.current, normalizedCart)) {
                    return
                  }

                  autoParsedCartRef.current = normalizedCart
                  setCart(normalizedCart)
                }
                if (embedded) setStep('delivery')
              }
            }
           }

          // Mostrar inmediatamente lo reconocido. Gemini queda como
          // enriquecimiento en segundo plano y nunca debe bloquear el panel.
           if (localParsed) {
             applyData(localParsed, 'local')
             setParsingChatOrder(false)
           }

          return api.post<ParsedOrderResponse>('/whatsapp/parse-order', { text: customerText })
            .then(parsed => {
              if (parsed) {
                if (parsed.modelUsed) setOrderReaderModel(parsed.modelUsed)
                // Solo llamar applyData si Gemini encontró productos reales
                if (parsed.parsedCartItems && parsed.parsedCartItems.length > 0) {
                  applyData(parsed, 'remote')
                }
              }
            })
            .catch(() => {
              // Si la IA remota falla, ya se aplicó el parseo local instantáneo previamente
            })
        })
        .catch(err => {
          lastParsedSessionIdRef.current = null
          console.error('Error fetching chat messages for autocomplete:', err)
        })
        .finally(() => setParsingChatOrder(false))
    }
  }, [chatSessionId, chatTranscriptRevision, categories, zones, editOrderLoaded, editOrderId, draftLoaded, loadedDraftKey, activeDraftKey, hasRestoredDraft, initialLoading, initialAddress, initialZone, initialName, initialPhone])

  useEffect(() => {
    if (editOrderId || !draftLoaded || loadedDraftKey !== activeDraftKey) return
    localStorage.setItem(activeDraftKey, JSON.stringify({ customerName, customerPhone, exactAddress, addressReference, zoneId, zoneSearch, zoneRateEdit, mapSearch, paymentMethod, paymentReference, cashAmountInput, transferAmountInput, latitude, longitude, notes, cart, orderType, customerId, clientMutationId, updatedAt: Date.now() }))
  }, [cart, exactAddress, addressReference, customerName, customerPhone, draftLoaded, loadedDraftKey, notes, paymentMethod, paymentReference, cashAmountInput, transferAmountInput, latitude, longitude, zoneId, zoneSearch, zoneRateEdit, mapSearch, orderType, editOrderId, customerId, activeDraftKey, clientMutationId])

  useEffect(() => {
    if (editOrderId && editOrderLoaded) return
    const zone = zones.find(z => z.id === zoneId)
    if (zone) {
      setZoneSearch(zone.name)
      setMapSearch(zone.name)
      setZoneRateEdit(String(zone.rate))
    }
  }, [zoneId, zones, editOrderId, editOrderLoaded])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (zoneContainerRef.current && !zoneContainerRef.current.contains(e.target as Node)) {
        setZoneResultsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const uniqueZones = useMemo(() => {
    const seen = new Map<string, Zone>()
    for (const z of zones) {
      const key = z.name.toLowerCase().trim()
      if (!seen.has(key) || seen.get(key)!.rate > z.rate) seen.set(key, z)
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }, [zones])

  const filteredZones = useMemo(() => {
    if (!zoneSearch.trim()) return []
    const query = zoneSearch.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    return uniqueZones.filter(z => {
      const zName = z.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      return zName.includes(query)
    })
  }, [uniqueZones, zoneSearch])

  const addToCart = (item: MenuItem) => {
    if (!item) return
    // Verificar si el ítem pertenece a una categoría de adiciones o tipo ADICION
    const itemCat = (item as any)?.category || (categories || []).find(c => (c?.items || []).some(i => i && i.id === item.id))
    const itemCatName = itemCat?.name || ''
    const itemCatDesc = (itemCat as any)?.description || ''
    const isAdditionItem = (item as any).type === 'ADICION' || isAdditionCategory(itemCatName, itemCatDesc)

    // Si es un ítem de adición y hay al menos un producto principal en el carrito, vincularlo al último producto principal
    const mainItems = cart.filter(i => i && !(i.notes || '').startsWith('Adición para:'))
    if (isAdditionItem && mainItems.length > 0) {
      const lastMainItem = mainItems[mainItems.length - 1]
      handleAddAddition(lastMainItem, item.id)
      setAddedItemId(item.id)
      setTimeout(() => setAddedItemId(null), 400)
      return
    }

    setCart(prev => {
      const existing = prev.find(i => i && i.menuItemId === item.id && !i.notes)
      if (existing) {
        return consolidateCart(prev.map(i => (i && i.menuItemId === item.id && !i.notes && i.lineId === existing.lineId) ? { ...i, quantity: i.quantity + 1 } : i))
      }
      const lineId = `line-${Math.random().toString(36).substring(2, 9)}`
      return consolidateCart([...prev, { menuItemId: item.id, name: item.name, price: item.price || 0, quantity: 1, lineId }])
    })
    setAddedItemId(item.id)
    setTimeout(() => setAddedItemId(null), 400)
  }

  const removeFromCart = (lineId: string, name?: string) => setCart(prev => consolidateCart(prev.filter(i => {
    if (!i || i.lineId === lineId) return false
    if (i.notes && i.notes.startsWith('Adición para:') && i.notes.includes(`(#${lineId})`)) return false
    return true
  })))

  const updateQuantity = (lineId: string, delta: number) => setCart(prev => {
    const parent = prev.find(i => i && i.lineId === lineId)
    if (!parent) return prev

    return consolidateCart(prev.map(i => {
      if (!i) return i
      if (i.lineId === lineId) {
        return { ...i, quantity: Math.max(1, i.quantity + delta) }
      }
      if (i.notes && i.notes.startsWith('Adición para:') && i.notes.includes(`(#${lineId})`)) {
        const oldParentQty = parent.quantity
        const newParentQty = Math.max(1, oldParentQty + delta)
        const ratio = newParentQty / oldParentQty
        const newQty = Math.round(i.quantity * ratio)
        return { ...i, quantity: Math.max(1, newQty) }
      }
      return i
    }))
  })


  const saveItemNote = (lineId: string, rawInput: string) => {
    const trimmed = rawInput.trim();
    setShowNotes(prev => ({ ...prev, [lineId]: false }));

    setCart(prev => {
      const lineIndex = prev.findIndex(i => i && i.lineId === lineId);
      if (lineIndex === -1) return prev;
      const target = prev[lineIndex];

      if (!trimmed) {
        // Limpiar notas si quedó vacío
        const hasAdditions = prev.some(add => add && add.notes && add.notes.startsWith('Adición para:') && add.notes.includes(`(#${lineId})`));
        return consolidateCart(prev.map(i => (i && i.lineId === lineId) ? { ...i, notes: hasAdditions ? `(#${lineId})` : undefined } : i));
      }

      // Si tiene varias unidades, analizar división inteligente
      if (target.quantity > 1) {
        let noteQty = 1;
        let cleanNote = trimmed;

        // Detectar si el usuario especificó una cantidad al inicio (ej: "2 sin cebolla", "2 sin cebolla y 8 normal", "2x sin salsa")
        const qtyMatch = trimmed.match(/^(\d+)\s*(?:x\s*)?(.*?)(?:\s*(?:y|,|;|-)\s*(\d+)?\s*(?:normal.*)?)?$/i);
        const isAll = /^(todas?|todos|todo)\b/i.test(trimmed);

        if (isAll) {
          noteQty = target.quantity;
          cleanNote = trimmed.replace(/^(todas?|todos|todo)\s*(?:con|de|:)?\s*/i, '').trim();
        } else if (qtyMatch && qtyMatch[1]) {
          const parsedQty = parseInt(qtyMatch[1], 10);
          if (parsedQty > 0) {
            noteQty = Math.min(parsedQty, target.quantity);
            cleanNote = (qtyMatch[2] || '').trim();
            if (!cleanNote) cleanNote = trimmed;
          }
        }

        // Si la cantidad con nota cubre todas las unidades de la línea
        if (noteQty >= target.quantity) {
          const tag = `(#${target.lineId})`;
          const finalNotes = cleanNote ? `${cleanNote} ${tag}` : tag;
          return consolidateCart(prev.map(i => (i && i.lineId === lineId) ? { ...i, notes: finalNotes } : i));
        }

        // Separar la cantidad: target.quantity - noteQty (limpio sin nota) y noteQty (con nota)
        const remainingQty = target.quantity - noteQty;
        const newLineId = `line-${Math.random().toString(36).substring(2, 9)}`;
        const newTag = `(#${newLineId})`;
        const newNotedNotes = cleanNote ? `${cleanNote} ${newTag}` : newTag;

        const updatedOriginal: CartItem = {
          ...target,
          quantity: remainingQty,
          notes: undefined,
        };

        const newNotedLine: CartItem = {
          ...target,
          lineId: newLineId,
          quantity: noteQty,
          notes: newNotedNotes,
        };

        const newCart = [...prev];
        newCart[lineIndex] = updatedOriginal;
        newCart.push(newNotedLine);
        return consolidateCart(newCart);
      }

      // Línea de 1 unidad
      const tagMatch = (target.notes || '').match(/\(#line-[\w-]+\)/);
      const tag = tagMatch ? tagMatch[0] : `(#${lineId})`;
      const cleanedInput = trimmed.replace(/\s?\(#[\w-]+\)/g, '');
      const newNotes = cleanedInput ? `${cleanedInput} ${tag}` : tag;
      return consolidateCart(prev.map(i => (i && i.lineId === lineId) ? { ...i, notes: newNotes } : i));
    });
  };

  const clearItemNotes = (lineId: string) => {
    setShowNotes(prev => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
    setDraftNotes(prev => {
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
    setCart(prev => consolidateCart(prev.map(i => {
      if (i && i.lineId === lineId) {
        const hasAdditions = prev.some(add => add && add.notes && add.notes.startsWith('Adición para:') && add.notes.includes(`(#${lineId})`));
        return { ...i, notes: hasAdditions ? `(#${lineId})` : undefined };
      }
      return i;
    })));
  };

  const removeAddition = (add: CartItem) => setCart(prev => consolidateCart(prev.filter(i => i && !(i.menuItemId === add.menuItemId && i.notes === add.notes))))

  const updateAdditionQuantity = (add: CartItem, delta: number) => setCart(prev => consolidateCart(prev.map(i => (i && i.menuItemId === add.menuItemId && i.notes === add.notes) ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i)))

  const startEditNote = (item: CartItem) => {
    if (!item) return;
    const keyId = item.lineId || item.menuItemId;
    const currentNote = keepKitchenInstruction(getItemRawNote(item.notes), item.name);
    setDraftNotes(prev => ({ ...prev, [keyId]: currentNote }));
    setShowNotes(prev => ({ ...prev, [keyId]: true }));
    setTimeout(() => {
      const input = noteInputRefs.current[keyId];
      if (input) {
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
      }
    }, 50);
  };

  const handleAddNoteClick = (item: CartItem) => {
    if (!item) return;
    const keyId = item.lineId || item.menuItemId;
    const currentNote = keepKitchenInstruction(getItemRawNote(item.notes), item.name);
    setDraftNotes(prev => ({ ...prev, [keyId]: currentNote }));
    setShowNotes(prev => ({ ...prev, [keyId]: true }));
    setTimeout(() => {
      const input = noteInputRefs.current[keyId];
      if (input) {
        input.focus();
      }
    }, 50);
  };

  const handleAddAddition = (item: CartItem, additionId: string) => {
    if (!item || !additionId) return
    const allItemsList = (categories || []).flatMap(c => c?.items || [])
    const selectedAdd = (additionItems || []).find(ai => ai && ai.id === additionId) || allItemsList.find(i => i && i.id === additionId)
    if (!selectedAdd) return

    setCart(prev => {
      let targetLineId = item.lineId || `line-${Math.random().toString(36).substring(2, 9)}`
      let updatedCart = [...prev]

      if (item.quantity > 1) {
        const newParentLineId = `line-${Math.random().toString(36).substring(2, 9)}`
        targetLineId = newParentLineId
        const parentIndex = updatedCart.findIndex(i => i && i.lineId === item.lineId)
        if (parentIndex !== -1) {
          updatedCart[parentIndex] = { ...updatedCart[parentIndex], quantity: updatedCart[parentIndex].quantity - 1 }
          const parentTag = `(#${newParentLineId})`
          const newParent: CartItem = {
            menuItemId: item.menuItemId,
            name: item.name,
            price: item.price,
            quantity: 1,
            lineId: newParentLineId,
            notes: parentTag
          }
          updatedCart.push(newParent)
        }
      } else {
        const parentTag = `(#${targetLineId})`
        updatedCart = updatedCart.map(i => {
          if (i && i.lineId === item.lineId) {
            const existingNotes = i.notes || ''
            const newNotes = existingNotes.includes(parentTag) ? existingNotes : (existingNotes ? `${existingNotes} ${parentTag}` : parentTag)
            return { ...i, notes: newNotes }
          }
          return i
        })
      }

      const notesLabel = `Adición para: ${item.name} (#${targetLineId})`
      const existingAddIndex = updatedCart.findIndex(i => i && i.menuItemId === selectedAdd.id && i.notes === notesLabel)
      if (existingAddIndex !== -1) {
        updatedCart[existingAddIndex] = { ...updatedCart[existingAddIndex], quantity: updatedCart[existingAddIndex].quantity + 1 }
      } else {
        updatedCart.push({
          menuItemId: selectedAdd.id,
          name: selectedAdd.name,
          price: selectedAdd.price || 0,
          quantity: 1,
          notes: notesLabel,
          lineId: `line-${Math.random().toString(36).substring(2, 9)}`
        })
      }

      return consolidateCart(updatedCart)
    })
  }

  const isGlobalCourtesy = paymentMethod === 'CORTESIA'
  const subtotal = isGlobalCourtesy 
    ? 0 
    : cart.reduce((sum, item) => sum + (item.isCourtesy ? 0 : item.price) * item.quantity, 0)
  const groupedCart = useMemo(() => groupOrderItems(cart), [cart])
  const selectedZone = zones.find(zone => zone.id === zoneId)
  const deliveryFee = (orderType === 'pickup' || isGlobalCourtesy) ? 0 : (parseFloat(zoneRateEdit) || 0)
  const tax = (chargeTax && !isGlobalCourtesy) ? (subtotal * 0.08) : 0
  const total = isGlobalCourtesy ? 0 : (subtotal + tax + deliveryFee)
  const estimatedTime = orderType === 'pickup' ? '10-15 min' : '15-25 min'
  const estimatedKm = useMemo(() => {
    // Solo enseñamos una distancia guardada en la zona. No se inventa un
    // kilometraje aproximado por el nombre del barrio: la tarifa siempre la
    // confirma o edita el asesor.
    const savedKm = Number(selectedZone?.km)
    return Number.isFinite(savedKm) && savedKm > 0 ? savedKm : null
  }, [selectedZone])

  const allItems = useMemo(() => 
    (categories || [])
      .flatMap(c => (c?.items || []).map(i => ({ ...i, category: { name: c?.name || '', id: c?.id || '' } }))), 
    [categories]
  )
  const displayCategories = useMemo(() => {
    return (categories || []).filter(c => c && !isAdditionCategory(c.name, (c as any)?.description))
  }, [categories])

  const allAdditionCategories = useMemo(() => {
    return (categories || []).filter(c => c && isAdditionCategory(c.name, (c as any)?.description))
  }, [categories])

  const additionItems = useMemo(() => {
    const fromCat = (allAdditionCategories || []).flatMap(c => c?.items || [])
    const allItemsList = (categories || []).flatMap(c => c?.items || [])
    const byType = allItemsList.filter(i => (i as any)?.type === 'ADICION')
    const map = new Map<string, typeof allItemsList[0]>()
    fromCat.forEach(i => { if (i?.id) map.set(i.id, i) })
    byType.forEach(i => { if (i?.id) map.set(i.id, i) })
    return Array.from(map.values())
  }, [categories, allAdditionCategories])

  const getCartItemCategory = (cartItem: CartItem) => {
    if (!cartItem) return ''
    for (const cat of (categories || [])) {
      const match = (cat?.items || []).find(i => i && i.id === cartItem.menuItemId)
      if (match) return cat.name
    }
    return ''
  }

  const parseTargetCategories = (description: string | null | undefined): { targetCategoryIds: string[]; cleanDesc: string; hasExplicitSetting: boolean } => {
    if (!description) return { targetCategoryIds: [], cleanDesc: '', hasExplicitSetting: false }
    const clean = description.replace(/\[IS_ADDITION\]\s*/g, '').trim()
    const match = clean.match(/^\[TARGETS:([^\]]*)\]\s*([\s\S]*)$/)
    if (match) {
      const idsStr = match[1].trim()
      if (idsStr === 'NONE') {
        return { targetCategoryIds: [], cleanDesc: match[2] || '', hasExplicitSetting: true }
      }
      const targetCategoryIds = idsStr ? idsStr.split(',').map(s => s.trim()).filter(Boolean) : []
      return { targetCategoryIds, cleanDesc: match[2] || '', hasExplicitSetting: true }
    }
    return { targetCategoryIds: [], cleanDesc: clean, hasExplicitSetting: false }
  }

  const isPizzaAdditionCategory = (catName: string) => {
    const norm = (catName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    return norm.includes('adiciones e ingredientes') || norm.includes('bordes rellenos') || norm.includes('adicionales para pizza')
  }

  const getAdditionItemsFor = (cartItem: CartItem) => {
    if (!cartItem) return additionItems || []
    let itemCatId = ''
    let itemCatName = ''
    for (const cat of (categories || [])) {
      if (!cat || !cat.items) continue
      const match = cat.items.find(i => i && i.id === cartItem.menuItemId)
      if (match) {
        itemCatId = cat.id
        itemCatName = cat.name
        break
      }
    }
    const lowerCat = (itemCatName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    
    const matchedItems: any[] = []
    
    for (const addCat of (allAdditionCategories || [])) {
      if (!addCat || !addCat.items) continue
      const { targetCategoryIds, hasExplicitSetting } = parseTargetCategories(addCat.description)
      // Si la categoría de adición tiene configuración explícita guardada
      if (hasExplicitSetting) {
        if (targetCategoryIds.includes(itemCatId)) {
          matchedItems.push(...addCat.items)
        }
      } else {
        // Regla inteligente por defecto si nunca se ha editado la categoría
        if (lowerCat.includes('pizza')) {
          if (isPizzaAdditionCategory(addCat.name)) {
            matchedItems.push(...addCat.items)
          }
        } else {
          if (!isPizzaAdditionCategory(addCat.name)) {
            matchedItems.push(...addCat.items)
          }
        }
      }
    }

    if (matchedItems.length > 0) {
      const map = new Map<string, any>()
      matchedItems.forEach(i => { if (i && i.id) map.set(i.id, i) })
      return Array.from(map.values())
    }
    
    return additionItems || []
  }

  function getSearchRelevanceScore(item: MenuItem, rawQuery: string): number {
    if (!rawQuery.trim()) return 0
    const queryNorm = normalizeText(rawQuery)
    const nameNorm = normalizeText(item.name)
    const catNorm = normalizeText(item.category?.name || '')

    // 1. Exact match on full product name ("Porción de Papas" === "porcion de papas") -> 100,000 pts
    if (nameNorm === queryNorm) return 100000

    // 2. Product name STARTS WITH the query string ("Porción de Papas a la Francesa" starts with "porcion de papa") -> 50,000 pts
    if (nameNorm.startsWith(queryNorm)) {
      const nameWords = nameNorm.split(/\s+/).filter(Boolean)
      return 50000 + Math.max(0, 1000 - (nameWords.length * 50))
    }

    const queryTokens = queryNorm.split(/\s+/).filter(Boolean)
    const nameWords = nameNorm.split(/\s+/).filter(Boolean)

    // 3. First word or leading tokens match the start of product name
    let leadingMatches = 0
    for (let i = 0; i < Math.min(queryTokens.length, nameWords.length); i++) {
      if (nameWords[i].startsWith(queryTokens[i])) {
        leadingMatches++
      } else {
        break
      }
    }

    if (leadingMatches > 0) {
      return 20000 + (leadingMatches * 5000) - (nameWords.length * 10)
    }

    // 4. Exact word match in product name (e.g. "Perro Suizo" has word "suizo") -> 10,000 pts
    const isExactWord = queryTokens.every(tok => nameWords.includes(tok))
    if (isExactWord) {
      const matchedIndex = nameWords.indexOf(queryTokens[0])
      const positionPenalty = matchedIndex >= 0 ? matchedIndex * 500 : 0
      return 10000 - positionPenalty - (nameWords.length * 10)
    }

    // 5. Product name contains query substring -> 5,000 pts
    if (nameNorm.includes(queryNorm)) {
      return 5000 - (nameWords.length * 5)
    }

    // 6. Category name starts with query -> 2,000 pts
    if (catNorm.startsWith(queryNorm)) return 2000

    // 7. Category name contains query -> 1,000 pts
    if (catNorm.includes(queryNorm)) return 1000

    return 100
  }

  const filteredItems = useMemo(() => {
    const rawQuery = itemSearch.trim()
    if (!rawQuery) {
      return categoryFilter === 'ALL' 
        ? allItems.filter(i => !isAdditionCategory(i?.category?.name, (i as any)?.category?.description))
        : allItems.filter(item => item?.category?.name === categoryFilter)
    }

    const queryNorm = normalizeText(rawQuery)
    const queryNoSpaces = queryNorm.replace(/\s+/g, '')
    const tokens = queryNorm.split(/\s+/).filter(t => t.length > 0)

    const matches = allItems.filter(item => {
      if (!item) return false
      const nameNorm = normalizeText(item.name || '')
      const nameNoSpaces = nameNorm.replace(/\s+/g, '')
      const catNorm = normalizeText(item.category?.name || '')
      const catNoSpaces = catNorm.replace(/\s+/g, '')
      const descNorm = normalizeText((item as any)?.description || '')

      // 1. Direct name match (starts with or contains query or space-stripped query)
      if (nameNorm.includes(queryNorm) || nameNoSpaces.includes(queryNoSpaces)) return true

      // 2. Category name match (e.g. "salchipapa" matches items in Salchipapas)
      if (catNorm.includes(queryNorm) || catNoSpaces.includes(queryNoSpaces)) return true

      // 3. Exact word prefix match in product name (e.g. "chorip" matches "Choripapa")
      const nameWords = nameNorm.split(/\s+/)
      if (tokens.every(tok => nameWords.some(w => w.startsWith(tok) || w.includes(tok)))) return true

      // 4. Exact substring match in description (NO fuzzy typo matching on descriptions)
      if (descNorm.includes(queryNorm)) return true

      // 5. Very strict fuzzy match ONLY on product name (max 1 typo for queries >= 5 chars)
      if (queryNorm.length >= 5) {
        if (levenshteinDistance(queryNorm, nameNorm) <= 1) return true
        if (nameWords.some(w => w.length >= 4 && levenshteinDistance(queryNorm, w) <= 1)) return true
      }

      return false
    })

    if (categoryFilter !== 'ALL') {
      const inCategory = matches.filter(i => i?.category?.name === categoryFilter)
      if (inCategory.length > 0) return inCategory
    }

    return matches.sort((a, b) => getSearchRelevanceScore(b, rawQuery) - getSearchRelevanceScore(a, rawQuery))
  }, [allItems, categoryFilter, itemSearch])

  const cartItemIds = useMemo(() => new Set(cart.map(i => i.menuItemId)), [cart])

  const itemsByCategory = useMemo(() => {
    const rawQuery = itemSearch.trim()
    const map = new Map<string, { name: string; items: MenuItem[]; maxScore: number }>()

    for (const cat of (categories || [])) {
      if (!cat) continue
      const isAdd = isAdditionCategory(cat.name, (cat as any)?.description)
      if (!rawQuery && isAdd) continue
      map.set(cat.name, { name: cat.name, items: [], maxScore: 0 })
    }

    for (const item of (filteredItems || [])) {
      if (!item) continue
      const catName = item.category?.name || 'General'
      const isAdd = isAdditionCategory(catName, (item.category as any)?.description)
      if (!rawQuery && isAdd) continue
      if (!map.has(catName)) {
        map.set(catName, { name: catName, items: [], maxScore: 0 })
      }
      const group = map.get(catName)!
      group.items.push(item)
      const score = getSearchRelevanceScore(item, rawQuery)
      if (score > group.maxScore) {
        group.maxScore = score
      }
    }

    const result = Array.from(map.values())
      .filter(group => group.items.length > 0)

    if (rawQuery) {
      for (const group of result) {
        group.items.sort((a, b) => getSearchRelevanceScore(b, rawQuery) - getSearchRelevanceScore(a, rawQuery))
      }
      result.sort((a, b) => b.maxScore - a.maxScore)
    }

    return result
  }, [categories, filteredItems, itemSearch])

  const missingFields = [
    cart.length === 0 && 'productos',
    orderType === 'delivery' && !customerPhone.trim() && 'teléfono',
    orderType === 'delivery' && !zoneSearch.trim() && 'barrio',
    orderType === 'delivery' && !exactAddress.trim() && 'dirección exacta',
    orderType === 'delivery' && (!zoneRateEdit || !Number.isFinite(parseFloat(zoneRateEdit)) || parseFloat(zoneRateEdit) < 0) && 'tarifa confirmada',
  ].filter(Boolean) as string[]
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0)
  const isCashBlocked = !canCreate?.allowed && !editOrderId
  const isOrderReadyToConfirm = !parsingChatOrder && !isCashBlocked && missingFields.length === 0

  const selectZone = (zone: Zone) => {
    setZoneId(zone.id)
    setZoneSearch(zone.name)
    setZoneRateEdit(String(zone.rate))

    setLatitude(null)
    setLongitude(null)
  }

  const handleAddressSelect = (result: AddressResult) => {
    setLatitude(result.latitude)
    setLongitude(result.longitude)
    if (result.suggestedZone) {
      const match = uniqueZones.find(z => z.id === result.suggestedZone!.id)
        || uniqueZones.find(z => z.name.toLowerCase() === result.suggestedZone!.name.toLowerCase())
      if (match) selectZone(match)
      else selectZone({ id: result.suggestedZone.id, name: result.suggestedZone.name, rate: result.suggestedZone.rate, zoneGroup: result.suggestedZone.zoneGroup })
    } else if (result.neighbourhood) {
      setZoneSearch(result.neighbourhood)
      setZoneId('')
    } else {
      setZoneSearch(result.address)
      setZoneId('')
    }
    setMapSearch(result.address)
  }

  const handleReplicateLastOrder = () => {
    if (lastOrderItems.length === 0) return
    const flatItems = (categories || []).flatMap(c => c?.items || [])
    
    setCart(prev => {
      let nextCart = [...prev]
      for (const histItem of lastOrderItems) {
        const menuItem = flatItems.find(fi => fi.id === histItem.menuItemId)
        if (!menuItem) continue
        
        const existing = nextCart.find(i => i.menuItemId === menuItem.id && !i.notes)
        if (existing) {
          nextCart = nextCart.map(i => 
            (i.menuItemId === menuItem.id && !i.notes && i.lineId === existing.lineId) 
              ? { ...i, quantity: i.quantity + histItem.quantity } 
              : i
          )
        } else {
          const lineId = `line-${Math.random().toString(36).substring(2, 9)}`
          nextCart.push({
            menuItemId: menuItem.id,
            name: menuItem.name,
            price: menuItem.price,
            quantity: histItem.quantity,
            lineId
          })
        }
      }
      return consolidateCart(nextCart)
    })
  }

  const handleCustomerSearch = async (val: string) => {
    setCustomerSearchQuery(val)
    if (!val.trim()) {
      setDbCustomers([])
      setCustomerSearchOpen(false)
      return
    }
    // Si la cajera escribe un nombre en el buscador, sincronizarlo al nombre del cliente
    if (!/^\d+$/.test(val.trim()) && (!customerName || customerName === 'Cliente Mostrador' || customerName === 'Cliente Recoger')) {
      setCustomerName(val)
    }
    try {
      const results = await api.get<any[]>(`/customers?search=${encodeURIComponent(val)}`)
      setDbCustomers(results)
      setCustomerSearchOpen(results.length > 0)
    } catch {
      setDbCustomers([])
    }
  }

  const handleSelectCustomer = (cust: any) => {
    setCustomerId(cust.id)
    setCustomerName(cust.name)
    if (cust.phone && cust.phone !== '3000000000' && cust.phone !== '0000000000') {
      const cClean = cust.phone.replace(/\D/g, '')
      const c10 = (cClean.length === 12 && cClean.startsWith('57')) ? cClean.slice(2) : cust.phone
      setCustomerPhone(c10)
    }
    if (cust.address) {
      setExactAddress(cust.address)
      setMapSearch(cust.address)
      setZoneSearch(cust.address)
    }
    setCustomerSearchOpen(false)
    setCustomerSearchQuery('')
  }

  const handleDeselectCustomer = () => {
    setCustomerId('')
    setCustomerName('')
    setCustomerPhone('')
    setExactAddress('')
    setMapSearch('')
    setZoneSearch('')
    setZoneId('')
    setPaymentMethod('CASH') // Reset from CREDIT or CORTESIA if selected
  }

  const handleRegisterCustomerInline = async () => {
    const phone = customerPhone.replace(/\D/g, '')
    if (phone.length !== 10 || !phone.startsWith('3')) {
      alert('El teléfono debe tener exactamente 10 dígitos y empezar con 3 para registrar como cliente.')
      return
    }
    if (!customerName.trim()) {
      alert('Por favor escribe el nombre del cliente.')
      return
    }
    setCreatingCustomerInline(true)
    try {
      const newCust = await api.post<any>('/customers', {
        name: customerName,
        phone,
        address: exactAddress || undefined
      })
      setCustomerId(newCust.id)
      setCustomerName(newCust.name)
      setCustomerPhone(newCust.phone)
      if (newCust.address) {
        setExactAddress(newCust.address)
        setMapSearch(newCust.address)
        setZoneSearch(newCust.address)
      }
    } catch (err: any) {
      alert(err.message || 'No se pudo registrar el cliente.')
    } finally {
      setCreatingCustomerInline(false)
    }
  }

  const handlePhoneBlur = async () => {
    const raw = customerPhone.trim()
    if (!raw) return
    try {
      const history = await api.get<any[]>(`/orders/history/${encodeURIComponent(raw)}`)
      if (history.length > 0) {
        if (!customerName) setCustomerName(history[0].customerName)
        
        if (history[0].items) {
          setLastOrderItems(history[0].items)
          setLastOrderDate(history[0].createdAt)
        }

        if (!exactAddress && orderType === 'delivery') {
          setExactAddress(history[0].customerAddress)
          if (history[0].addressReference) setAddressReference(history[0].addressReference)
        }
      }
    } catch { /* ignore */ }
  }

  const submittingRef = useRef(false)

  const handleSubmit = async () => {
    if (loading || submittingRef.current) return
    if (!canCreate?.allowed && !editOrderId) { 
      setError(canCreate?.reason || 'Caja cerrada')
      submittingRef.current = false
      return 
    }
    if (!cart || cart.length === 0) { 
      setError('El carrito está vacío. Agrega al menos un producto.')
      submittingRef.current = false
      return 
    }
    submittingRef.current = true
    
    const isPickup = orderType === 'pickup'
    const isDelivery = orderType === 'delivery'
    
    const trimmedPhone = customerPhone.trim()
    const cleanDigits = trimmedPhone.replace(/\D/g, '')
    const isId = trimmedPhone.startsWith('@') || trimmedPhone.startsWith('CO.') || /[a-zA-Z_]/.test(trimmedPhone) || cleanDigits.length >= 13

    if (isDelivery) {
      const isRealPhone = cleanDigits.length >= 7 && cleanDigits.length <= 12 && cleanDigits !== '3000000000' && cleanDigits !== '0000000000'
      if (!isRealPhone) {
        setError('Por favor ingresa el número de celular del cliente (10 dígitos) para el domiciliario.')
        submittingRef.current = false
        return
      }
      if (!zoneSearch.trim()) {
        setError('Selecciona o escribe el barrio del domicilio.')
        submittingRef.current = false
        return
      }
      if (!exactAddress.trim()) {
        setError('Ingresa la dirección exacta para que el domiciliario pueda entregar el pedido.')
        submittingRef.current = false
        return
      }
      const confirmedDeliveryFee = Number(zoneRateEdit)
      if (!Number.isFinite(confirmedDeliveryFee) || confirmedDeliveryFee < 0) {
        setError('Selecciona una zona configurada o escribe la tarifa de domicilio confirmada por el asesor.')
        submittingRef.current = false
        return
      }
    } else {
      if (cleanDigits && cleanDigits.length < 7) {
        setError('El teléfono (si se ingresa) debe tener al menos 7 dígitos.')
        submittingRef.current = false
        return
      }
    }

    const rawTypedName = (customerName || customerSearchQuery || '').trim()
    const effectiveName = (rawTypedName && rawTypedName !== 'Cliente Mostrador')
      ? rawTypedName
      : (isPickup ? 'Cliente Recoger' : (cleanDigits.length >= 4 ? `Cliente ${cleanDigits.slice(-4)}` : 'Cliente Domicilio'))
    let effectivePhone = isId ? trimmedPhone : cleanDigits
    if (isDelivery && (!effectivePhone || effectivePhone === '3000000000' || effectivePhone === '0000000000')) {
      const custMatch = dbCustomers.find(c => (customerId && c.id === customerId) || (rawTypedName && c.name?.toLowerCase() === rawTypedName.toLowerCase()))
      if (custMatch?.phone && custMatch.phone !== '3000000000' && custMatch.phone !== '0000000000') {
        const cClean = custMatch.phone.replace(/\D/g, '')
        effectivePhone = (cClean.length === 12 && cClean.startsWith('57')) ? cClean.slice(2) : cClean
      } else {
        const urlP = initialPhone.replace(/\D/g, '')
        if (urlP && urlP !== '3000000000' && urlP !== '0000000000') {
          effectivePhone = (urlP.length === 12 && urlP.startsWith('57')) ? urlP.slice(2) : urlP
        }
      }
    }
    if (!effectivePhone) {
      effectivePhone = '3000000000'
    }

    setError('')
    setLoading(true)
    try {
      const addressRef = isPickup
        ? undefined
        : (selectedZone
            ? (addressReference || undefined)
            : (zoneSearch
                ? (addressReference ? `${zoneSearch} — ${addressReference}` : zoneSearch)
                : (addressReference || undefined)
              )
          )

      const finalAddress = isPickup ? 'Recoger en restaurante' : exactAddress

      const finalOrderType = isPickup ? 'PICKUP' : 'DELIVERY'
      const finalNotes = notes.trim() || undefined

      const payload = {
        customerName: effectiveName,
        customerPhone: effectivePhone,
        customerAddress: finalAddress,
        addressReference: addressRef,
        waiterId: user?.id || '',
        zoneId: isPickup ? undefined : (zoneId || undefined),
        zoneName: isPickup ? undefined : (zoneSearch || undefined),
        paymentMethod,
        cashAmount: paymentMethod === 'MIXED' ? (parseFloat(cashAmountInput) || 0) : undefined,
        transferAmount: paymentMethod === 'MIXED' ? (parseFloat(transferAmountInput) || 0) : undefined,
        paymentReference: paymentReference || undefined,
        orderType: finalOrderType,
        notes: finalNotes,
        items: cart.map(item => ({ menuItemId: item.menuItemId, quantity: item.quantity, notes: serializeItemNote(item), isCourtesy: item.isCourtesy || false })),
        deliveryFee: (isPickup || isGlobalCourtesy) ? 0 : (parseFloat(zoneRateEdit) || 0),
        tax: tax,
        latitude: isPickup ? undefined : (latitude || undefined),
        longitude: isPickup ? undefined : (longitude || undefined),
        customerId: customerId || undefined,
        chatSessionId: chatSessionId || undefined,
        source: chatSessionId ? 'WHATSAPP' : undefined,
        clientMutationId: editOrderId ? undefined : clientMutationId,
      }

      let savedOrder: ComandaOrder
      if (editOrderId) {
        savedOrder = await api.put<ComandaOrder>(`/orders/${editOrderId}`, payload)
        savedOrder.isEdited = true
      } else {
        savedOrder = await api.post<ComandaOrder>('/orders', payload)
      }

      if (chatSessionId) {
        if (user?.id) {
          await api.put(`/whatsapp/sessions/${chatSessionId}/assign`, { userId: user.id }).catch(() => {})
        }
        const cleanEffective = (effectivePhone || '').replace(/\D/g, '');
        const isDummy = cleanEffective === '3000000000' || cleanEffective === '0000000000' || /^0+$/.test(cleanEffective) || (cleanEffective.length < 7 && !effectivePhone.startsWith('@') && !effectivePhone.startsWith('CO.'));
        if (effectivePhone && !isDummy && effectivePhone.length <= 13) {
          await api.put(`/whatsapp/sessions/${chatSessionId}`, { 
            customerPhone: effectivePhone,
            ...(effectiveName && !effectiveName.startsWith('@') && effectiveName !== 'Cliente Mostrador' && effectiveName !== 'Cliente Recoger' ? { customerName: effectiveName } : {})
          }).catch(() => {})
        }
      }

      if (editOrderId) {
        await alerts.success('Pedido Actualizado', `Pedido #${savedOrder.orderNumber || ''} modificado exitosamente.`)
      } else {
        await alerts.success('Pedido Creado', `Pedido #${savedOrder.orderNumber || ''} registrado exitosamente.`)
      }

      localStorage.removeItem(activeDraftKey)
      if (embedded) {
        onOrderSaved?.(savedOrder)
        onClose?.()
      } else if (chatSessionId) {
        navigate(chatReturnPath)
      } else {
        navigate('/dispatch')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el pedido')
    } finally {
      setLoading(false)
      submittingRef.current = false
    }
  }

  const clearDraft = () => {
    if (editOrderId) {
      closeOrderPanel()
      return
    }
    localStorage.removeItem(activeDraftKey)
    setClientMutationId(createClientMutationId())
    setCustomerName(''); setCustomerPhone(''); setExactAddress(''); setZoneId('')
    setZoneSearch(''); setZoneRateEdit('')
    setPaymentMethod('CASH'); setNotes(''); setCart([]); setError(''); setOrderType('delivery'); setIsCartCollapsed(false)
  }


   const renderMenuCard = () => {
    return (
      <Card className={cn(
        "flex min-h-0 flex-1 flex-col border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-xl rounded-2xl overflow-hidden",
        embedded ? "h-full" : "md:h-full h-auto"
      )}>
        <CardHeader className={cn("shrink-0 border-b border-[var(--border-subtle)]", embedded ? "p-2.5 sm:p-3" : "p-5 pb-3")}>
          <div className={cn(
            "flex flex-col gap-2",
            embedded ? "sm:flex-row sm:items-center sm:justify-between sm:gap-3" : "md:flex-row md:items-center md:justify-between"
          )}>
            <div className={cn("min-w-0", embedded && "sm:shrink-0")}>
              <CardTitle className="text-base font-bold text-[var(--text-primary)]">Carta del Menú</CardTitle>
              <CardDescription className="text-xs text-[var(--text-secondary)]">Toca un producto para agregarlo</CardDescription>
            </div>
            <div className={cn(
              "relative flex w-full items-center gap-2",
              embedded ? "sm:w-auto sm:min-w-0 sm:flex-1 sm:max-w-md" : "md:w-80"
            )}>
              <div className="relative flex-1">
                <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
                <Input 
                  className="w-full bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl pl-9 pr-8 text-xs h-9 focus:border-[var(--accent)]" 
                  value={itemSearch} 
                  onChange={e => setItemSearch(e.target.value)} 
                  placeholder="Buscar plato, ingrediente..." 
                />
                {itemSearch && (
                  <button 
                    type="button"
                    onClick={() => setItemSearch('')}
                    className="absolute top-1/2 right-2.5 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleVoiceSearchMenu}
                className={`h-9 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer shrink-0 flex items-center gap-1.5 ${
                  isVoiceSearchingMenu 
                    ? 'bg-red-500 text-white border-red-600 animate-pulse shadow-md shadow-red-500/20' 
                    : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--accent)] hover:bg-[var(--accent-muted)]'
                }`}
                title="Dictar nombre de plato o ingredientes por voz"
              >
                {isVoiceSearchingMenu ? (
                  <>
                    <MicOff className="h-4 w-4 text-white animate-bounce" />
                    <span className="text-[10px] hidden sm:inline font-bold">Escuchando...</span>
                  </>
                ) : (
                  <>
                    <Mic className="h-4 w-4 text-[var(--accent)]" />
                    <span className="text-[10px] hidden sm:inline font-bold">Dictar</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>

        <div className="flex flex-1 min-h-0 flex-col">
          {/* Horizontal Category Navigation Bar */}
          <div className="shrink-0 px-3 sm:px-4 py-2.5 border-b border-[var(--border-subtle)]/50 bg-[var(--bg-panel)]/30 gap-2 overflow-x-auto no-scrollbar scroll-smooth flex">
            <button
              type="button"
              onClick={() => setCategoryFilter('ALL')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer flex items-center gap-1 ${
                categoryFilter === 'ALL'
                  ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm'
                  : 'bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span>⭐ Todas las Categorías</span>
            </button>
            {displayCategories.map(c => {
              const isActive = categoryFilter === c.name;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryFilter(c.name)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                    isActive
                      ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm'
                      : 'bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span>{c.name}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/20 text-white font-extrabold' : 'bg-black/20 text-[var(--text-muted)]'}`}>
                    {c?.items?.length || 0}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="flex-1 min-h-0 flex flex-col min-w-0 bg-[var(--bg-base)]/30">
            <CardContent className={cn(
              "min-h-0 flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700",
              embedded ? "p-3 pb-4 sm:p-4" : "p-4 md:p-6 md:pb-6"
            )}>
          <div className={cn(embedded ? "space-y-3" : "space-y-6")}>
            {/* Quick Natural Language Add Bar */}
            {!embedded && <div className="relative rounded-2xl border border-[var(--accent-border)]/40 bg-[var(--accent-muted)]/15 p-4 shadow-inner">
              <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold text-[var(--accent)] uppercase tracking-wider">
                    <Sparkles className="h-4 w-4 animate-pulse" />
                    <span>Carga Rápida de Pedido</span>
                  </div>
                  <p className="text-[10px] text-[var(--text-secondary)] mt-0.5 leading-tight pr-2">Escribe o pega el pedido completo (Ej: 2 asados con papas francesas, 1 sin ensalada y 1 gaseosa personal)</p>
                </div>
                <div className="relative flex-1 md:max-w-md w-full shrink-0">
                  <Textarea 
                    disabled={parsingQuickText}
                    rows={3}
                    className="w-full bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl p-3 pr-20 text-xs focus:border-[var(--accent)] font-medium text-[var(--text-primary)] placeholder-[var(--text-muted)] resize-none" 
                    value={quickText} 
                    onChange={e => setQuickText(e.target.value)} 
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault()
                        handleQuickTextParse()
                      }
                    }}
                    placeholder="Pega aquí el chat de WhatsApp o escribe el pedido..." 
                  />
                  <Button 
                    size="sm"
                    onClick={handleQuickTextParse}
                    disabled={parsingQuickText || !quickText.trim()}
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7.5 text-[10px] rounded-lg px-3.5 bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent)]/90 font-bold cursor-pointer shadow-sm"
                  >
                    {parsingQuickText ? 'Procesando...' : 'Procesar'}
                  </Button>
                </div>
              </div>
            </div>}

            {/* Intelligent Suggestions & History Integration */}
            {(suggestedProducts.length > 0 || lastOrderItems.length > 0) && (
              <div className={cn(
                "grid gap-2 rounded-2xl bg-[var(--accent-muted)]/20 border border-[var(--accent-border)]/30 mb-2",
                (suggestedProducts.length > 0 && lastOrderItems.length > 0) ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1",
                embedded ? "p-2.5" : "p-3"
              )}>
                {/* WHATSAPP CHAT SUGGESTIONS */}
                {suggestedProducts.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-extrabold text-[var(--accent)] uppercase tracking-wider">
                      <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                      <span>Sugerido por WhatsApp</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {suggestedProducts.map(item => (
                        <Button
                          key={item.id}
                          size="sm"
                          variant="outline"
                          onClick={() => addToCart(item)}
                          className="h-7 rounded-lg text-[10px] font-bold border-[var(--accent-border)] hover:bg-[var(--accent)] hover:text-[var(--accent-fg)] flex items-center gap-1 bg-[var(--bg-panel)] text-[var(--text-primary)] cursor-pointer"
                        >
                          <Plus className="h-3 w-3" /> {item.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {/* LAST ORDER REPLICATION */}
                {lastOrderItems.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 text-xs font-extrabold text-[var(--purple)] uppercase tracking-wider">
                        <Clock className="h-3.5 w-3.5 text-purple-500" />
                        <span>Último Pedido ({lastOrderDate ? new Date(lastOrderDate).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''})</span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleReplicateLastOrder}
                        className="h-6.5 rounded-lg text-[10px] font-bold border-purple-500/30 text-purple-500 hover:bg-purple-500 hover:text-white flex items-center gap-1 bg-[var(--bg-panel)] px-2 cursor-pointer"
                      >
                        <Plus className="h-3 w-3" /> Replicar Todo ({(lastOrderItems || []).reduce((acc, i) => acc + (i?.quantity || 0), 0)} uds)
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(lastOrderItems || []).map(item => {
                        if (!item) return null
                        const flatItems = (categories || []).flatMap(c => c?.items || [])
                        const menuItem = flatItems.find(fi => fi && fi.id === item.menuItemId)
                        if (!menuItem) return null
                        return (
                          <span
                            key={item.id || item.menuItemId}
                            onClick={() => addToCart(menuItem)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[9px] font-bold bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[var(--text-secondary)] cursor-pointer hover:bg-[var(--bg-hover)]"
                          >
                            {item.quantity}x {item.menuItem?.name || menuItem.name}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}



            {/* CATEGORY MAP (WORKS FOR BOTH SEARCHING AND NORMAL VIEW) */}
            {itemsByCategory.map(group => {
              const catName = group.name
              const normalized = catName.toLowerCase().trim()
              
              let CatIcon = UtensilsCrossed
              let catColor = '#F97316'
              let catDesc = 'Platos del menú preparados con ingredientes frescos'
              
              if (normalized.includes('pizza')) { CatIcon = Pizza; catColor = '#EF4444'; catDesc = 'Pizzas artesanales con salsa de la casa' }
              else if (normalized.includes('hamburguesa')) { CatIcon = ChefHat; catColor = '#F59E0B'; catDesc = 'Hamburguesas premium al carbón con papas rústicas' }
              else if (normalized.includes('perro')) { CatIcon = Flame; catColor = '#F97316'; catDesc = 'Perros calientes gigantes con adiciones' }
              else if (normalized.includes('suizo')) { CatIcon = Flame; catColor = '#F97316'; catDesc = 'Suizos artesanales con queso y adiciones' }
              else if (normalized.includes('patacon')) { CatIcon = UtensilsCrossed; catColor = '#8B5CF6'; catDesc = 'Patacones de plátano verde rellenos y gratinados' }
              else if (normalized.includes('picada')) { CatIcon = Sparkles; catColor = '#EC4899'; catDesc = 'Picadas especiales con carne de res, cerdo, butifarra y chorizo' }
              else if (normalized.includes('salchipapa') || normalized.includes('salvajada')) { CatIcon = Flame; catColor = '#3B82F6'; catDesc = 'Salchipapas de la casa con papas a la francesa, queso costeño y salsas' }
              else if (normalized.includes('bebida') || normalized.includes('jugo') || normalized.includes('gaseosa')) { CatIcon = CupSoda; catColor = '#14B8A6'; catDesc = 'Bebidas refrescantes para acompañar tus platos' }
              else if (normalized.includes('asado') || normalized.includes('carne') || normalized.includes('chuzo')) { CatIcon = Flame; catColor = '#10B981'; catDesc = 'Carnes y asados seleccionados al carbón' }

              if (!itemSearch.trim() && categoryFilter !== 'ALL' && catName !== categoryFilter) return null;

              return (
                <div
                  key={catName}
                  className={cn(embedded ? "space-y-2" : "space-y-3")}
                >
                  <div className={cn(
                    "flex items-center bg-[var(--bg-elevated)]/50 border border-[var(--border-subtle)]/40 rounded-xl",
                    embedded ? "gap-2 p-2" : "gap-3 p-3"
                  )}>
                    <div className={cn("flex shrink-0 items-center justify-center rounded-lg", embedded ? "h-8 w-8" : "h-10 w-10")} style={{ background: `${catColor}15`, border: `1px solid ${catColor}30` }}>
                      <CatIcon className={cn(embedded ? "h-4 w-4" : "h-5 w-5")} style={{ color: catColor }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-extrabold text-[var(--text-primary)] tracking-wide leading-none">{catName}</h3>
                        <Badge className="bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20 text-[9px] font-bold py-0 h-4.5">{group.items.length} ítems</Badge>
                      </div>
                      {!embedded && <p className="text-[10px] text-[var(--text-muted)] mt-1 truncate">{catDesc}</p>}
                    </div>
                  </div>

                  <div className={cn("grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3", embedded ? "gap-2" : "gap-2.5")}>
                    {group.items.map(item => {
                      const isInCart = cartItemIds.has(item.id)
                      const cartItem = cart.find(ci => ci.menuItemId === item.id && !ci.notes) || cart.find(ci => ci.menuItemId === item.id)
                      const justAdded = addedItemId === item.id
                      return (
                        <div
                          key={item.id}
                          role="button"
                          tabIndex={0}
                          aria-label={`Agregar ${item.name} al pedido`}
                          className={cn(
                            "relative flex items-center rounded-xl border transition-all duration-200 cursor-pointer select-none hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30",
                            embedded ? "gap-2.5 p-2.5" : "gap-3 p-3",
                            justAdded && "scale-95"
                          )}
                          style={{
                            backgroundColor: isInCart ? 'var(--accent-muted)' : 'var(--bg-elevated)',
                            borderColor: isInCart ? 'var(--accent-border)' : 'var(--border-default)',
                          }}
                          onClick={() => addToCart(item)}
                          onKeyDown={event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              addToCart(item)
                            }
                          }}
                        >
                          <div className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] shadow-sm", embedded ? "h-10 w-10" : "h-12 w-12")}>
                            {item.image ? (
                              <img src={item.image} alt={item.name} className="h-full w-full object-cover" loading="lazy" />
                            ) : (
                              <CatIcon className="h-5 w-5 text-neutral-400" />
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <p 
                              className={`text-xs sm:text-sm font-bold leading-snug break-normal line-clamp-2 ${isInCart ? 'text-[var(--accent)] font-extrabold' : 'text-[var(--text-primary)]'}`}
                              title={item.name}
                            >
                              {item.name}
                            </p>
                            <p className="text-xs font-black text-[var(--accent)] mt-1">{formatCurrency(item.price)}</p>
                          </div>

                          <div className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors",
                            isInCart ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "bg-[var(--bg-panel)] text-[var(--accent)] border border-[var(--accent-border)]"
                          )}>
                            {isInCart && cartItem
                              ? <span className="text-[11px] font-black">{cartItem.quantity}</span>
                              : <Plus className="h-3.5 w-3.5" />}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {!itemSearch.trim() && itemsByCategory.length === 0 && (
              <div className="py-16 text-center space-y-3">
                <Search className="mx-auto h-8 w-8 text-[var(--text-muted)]" />
                <p className="text-sm text-[var(--text-muted)]">No se encontraron platos que coincidan con la búsqueda</p>
              </div>
            )}
          </div>
        </CardContent>
        </div>
      </div>
    </Card>
  )
}

  const renderDeliveryCard = () => {
    return (
      <Card className={cn("flex flex-col border border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl h-auto", embedded ? "p-3 shadow-sm" : "p-4 sm:p-5 shadow-xl")}>
        <div className={cn("flex-1", embedded ? "space-y-2.5" : "space-y-3.5")}>
          <div className="flex items-center justify-between gap-2 min-w-0 pb-2 border-b border-[var(--border-subtle)]">
            <CardTitle className="text-xs sm:text-sm font-bold text-[var(--text-primary)] flex items-center gap-1.5 truncate">
              <Bike className="h-4 w-4 text-[var(--accent)] shrink-0" />
              <span className="tracking-wide">2. DATOS DE ENTREGA Y PAGO</span>
            </CardTitle>
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="flex items-center gap-1 text-[10px] sm:text-xs font-bold text-[var(--text-secondary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-2 py-0.5 rounded-lg">
                <Clock className="h-3 w-3 text-[var(--accent)] shrink-0" />
                <span>{estimatedTime}</span>
              </div>
            </div>
          </div>

          {/* Bloqueo crítico de caja si está cerrada */}
          {isCashBlocked && (
            <div className="flex items-center gap-2 rounded-xl border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 px-3 py-2 text-xs text-[var(--destructive)]">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <span className="font-bold">Caja Domicilios cerrada: </span>
                <span>{canCreate?.reason || 'Ábrela antes de confirmar pedidos.'} </span>
                <Link to="/payments" className="font-bold underline ml-1">Abrir Caja</Link>
              </div>
            </div>
          )}

          {/* Spinner si la IA está leyendo el chat */}
          {parsingChatOrder && (
            <div className="flex items-center gap-2 rounded-xl border border-blue-500/25 bg-blue-500/5 px-3 py-2 text-xs text-blue-600">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              <span className="font-semibold">Completando datos desde el chat…</span>
            </div>
          )}

          {/* Toggle Domicilio / Pasar a recoger */}
          <div className="flex rounded-xl bg-[var(--bg-base)] p-1 border border-[var(--border-default)] gap-1">
            <button
              type="button"
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition-all cursor-pointer ${
                orderType === 'delivery' 
                  ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm' 
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
              onClick={() => {
                setOrderType('delivery')
                if (customerName === 'Cliente Mostrador' || customerPhone === '3000000000') {
                  if (customerName === 'Cliente Mostrador') setCustomerName('')
                  if (customerPhone === '3000000000') setCustomerPhone('')
                }
              }}
            >
              <Bike className="h-3.5 w-3.5" /> Domicilio
            </button>
            <button
              type="button"
              className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition-all cursor-pointer ${
                orderType === 'pickup'
                  ? 'bg-[var(--purple)] text-white shadow-sm' 
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
              onClick={() => {
                setOrderType('pickup')
                if (customerName === 'Cliente Mostrador' || customerPhone === '3000000000') {
                  if (customerName === 'Cliente Mostrador') setCustomerName('')
                  if (customerPhone === '3000000000') setCustomerPhone('')
                }
              }}
            >
              <Store className="h-3.5 w-3.5" /> Pasar a Recoger
            </button>
          </div>

          {/* Datos del cliente */}
          <div className="space-y-2">
            {!embedded && (
              <div className="space-y-1 relative">
                <Label className="text-[11px] font-bold text-[var(--text-secondary)] uppercase flex items-center gap-1">
                  <Users className="h-3 w-3 text-[var(--accent)]" /> Buscar Cliente Registrado
                </Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]" />
                  <Input
                    value={customerSearchQuery}
                    onChange={e => handleCustomerSearch(e.target.value)}
                    placeholder="Buscar por nombre o celular..."
                    className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl h-8 pl-9 text-xs focus:border-[var(--accent)]"
                  />
                </div>
                {customerSearchOpen && dbCustomers.length > 0 && (
                  <div className="absolute left-0 right-0 z-50 bg-[var(--bg-panel)] border border-[var(--border-default)] rounded-xl shadow-2xl mt-1 max-h-48 overflow-y-auto no-scrollbar">
                    {dbCustomers.map(cust => (
                      <div
                        key={cust.id}
                        onClick={() => handleSelectCustomer(cust)}
                        className="p-2 hover:bg-[var(--bg-elevated)] cursor-pointer text-xs flex justify-between items-center border-b border-[var(--border-subtle)]/40 last:border-0"
                      >
                        <div>
                          <p className="font-bold text-[var(--text-primary)]">{cust.name}</p>
                          <p className="text-[10px] text-[var(--text-muted)]">{cust.phone}</p>
                        </div>
                        {cust.totalDebt > 0 && (
                          <span className="text-[9px] font-extrabold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded-md">
                            Debe: {formatCurrency(cust.totalDebt)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {customerId && (
                  <div className="flex items-center justify-between bg-[var(--accent-muted)]/40 border border-[var(--accent-border)]/40 rounded-xl px-2.5 py-1.5 mt-1 text-xs text-[var(--accent)]">
                    <span className="font-semibold truncate text-[11px]">📎 Vinculado: {customerName}</span>
                    <button
                      type="button"
                      onClick={handleDeselectCustomer}
                      className="text-red-500 hover:text-red-700 font-extrabold text-[10px] uppercase ml-2 cursor-pointer"
                    >
                      Desvincular
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">
                  Teléfono / ID {orderType === 'delivery' ? '*' : ''}
                </Label>
                <Input 
                  value={customerPhone} 
                  onChange={e => {
                    const val = e.target.value
                    const cleaned = val.startsWith('@')
                      ? val.replace(/[^\w.@_\-]/g, '').slice(0, 30)
                      : val.replace(/\D/g, '').slice(0, 10)
                    setCustomerPhone(cleaned)
                  }} 
                  onBlur={handlePhoneBlur} 
                  placeholder="3001234567" 
                  maxLength={customerPhone.startsWith('@') ? 30 : 10}
                  className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl h-8 text-xs focus:border-[var(--accent)] font-semibold tracking-wide" 
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">Nombre del Cliente</Label>
                <Input 
                  value={customerName} 
                  onChange={e => setCustomerName(e.target.value)} 
                  placeholder="Nombre del cliente" 
                  className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl h-8 text-xs focus:border-[var(--accent)]" 
                />
              </div>

              {!customerId && customerPhone.length === 10 && customerPhone.startsWith('3') && customerName.trim().length > 0 && (
                <div className="col-span-1 sm:col-span-2 flex items-center justify-between bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl p-2 text-xs">
                  <div>
                    <p className="font-semibold text-[var(--text-primary)] text-[11px]">¿Registrar como cliente?</p>
                    <p className="text-[9px] text-[var(--text-muted)]">Habilita ventas a crédito o historial.</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={creatingCustomerInline}
                    onClick={handleRegisterCustomerInline}
                    className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold rounded-lg h-7 px-3 text-[10px] cursor-pointer"
                  >
                    {creatingCustomerInline ? 'Guardando...' : 'Registrar'}
                  </Button>
                </div>
              )}
            </div>
          </div>

          {orderType === 'pickup' && (
            <div className="flex items-center gap-2 rounded-xl border border-[var(--purple)]/20 bg-[var(--purple)]/5 p-2 text-xs text-[var(--purple)] font-semibold">
              <Store className="h-4 w-4 shrink-0" />
              <span>El cliente recogerá en el local (The Villa Dog)</span>
            </div>
          )}

          {orderType === 'delivery' && (
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="flex items-center gap-1 text-[10px] font-bold text-[var(--text-secondary)] uppercase">
                    <MapPin className="h-3 w-3 text-[var(--accent)]" /> Barrio o Zona *
                  </Label>
                  <AddressSearch
                    value={mapSearch}
                    onChange={(val) => {
                      setMapSearch(val)
                      setZoneSearch(val)
                      setZoneId('')
                    }}
                    onSelect={handleAddressSelect}
                    placeholder="Busca barrio (Ej: La Granja)..."
                    zones={uniqueZones}
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase flex items-center gap-1">
                      <DollarSign className="h-3 w-3 text-[var(--accent)]" /> Tarifa Domicilio *
                    </Label>
                    {estimatedKm != null && (
                      <span className="text-[9px] font-bold text-[var(--accent)] bg-[var(--accent-muted)] px-1 rounded">
                        ~{estimatedKm} km
                      </span>
                    )}
                  </div>
                  <Input
                    type="number"
                    min={500}
                    step={500}
                    value={zoneRateEdit}
                    onChange={e => setZoneRateEdit(e.target.value)}
                    placeholder="Ej: 4000"
                    className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl h-8 text-xs focus:border-[var(--accent)] font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">Dirección Detallada</Label>
                  <Input
                    value={exactAddress}
                    onChange={e => setExactAddress(e.target.value)}
                    placeholder="Ej: Calle 12 # 34 - 56, Apto 201"
                    className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl h-8 text-xs focus:border-[var(--accent)]"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">Punto de Referencia</Label>
                  <Input
                    value={addressReference}
                    onChange={e => setAddressReference(e.target.value)}
                    placeholder="Ej: Portón verde, frente al parque"
                    className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl h-8 text-xs focus:border-[var(--accent)]"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">Método de Pago</Label>
                <Select value={paymentMethod} onValueChange={val => {
                  setPaymentMethod(val)
                  if (val === 'MIXED') {
                    const half = Math.round(total / 2)
                    setCashAmountInput(String(half))
                    setTransferAmountInput(String(total - half))
                  }
                }}>
                  <SelectTrigger className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl h-8 text-xs focus:border-[var(--accent)] font-semibold">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-default)]">
                    <SelectItem value="CASH">Efectivo</SelectItem>
                    <SelectItem value="TRANSFER">Transferencia</SelectItem>
                    <SelectItem value="MIXED">🔀 Mixto (Efectivo + Transfer)</SelectItem>
                    {customerId && <SelectItem value="CREDIT">Crédito (Fiado)</SelectItem>}
                  </SelectContent>
                </Select>
              </div>

              {paymentMethod !== 'CASH' && paymentMethod !== 'CREDIT' && paymentMethod !== 'MIXED' ? (
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">N° Comprobante / Ref</Label>
                  <Input 
                    className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl h-8 text-xs focus:border-[var(--accent)]" 
                    placeholder="Número o Ref" 
                    value={paymentReference} 
                    onChange={e => setPaymentReference(e.target.value)} 
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">Notas del Pedido</Label>
                  <Input 
                    value={notes} 
                    onChange={e => setNotes(e.target.value)} 
                    placeholder="Ej: Salsas por aparte" 
                    className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl h-8 text-xs focus:border-[var(--accent)]" 
                  />
                </div>
              )}
            </div>

            {paymentMethod !== 'CASH' && paymentMethod !== 'CREDIT' && paymentMethod !== 'MIXED' && (
              <div className="space-y-1">
                <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">Notas del Pedido</Label>
                <Input 
                  value={notes} 
                  onChange={e => setNotes(e.target.value)} 
                  placeholder="Ej: Salsas por aparte" 
                  className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl h-8 text-xs focus:border-[var(--accent)]" 
                />
              </div>
            )}

            {paymentMethod === 'MIXED' && (
              <div className="grid grid-cols-2 gap-2 p-2 bg-[var(--bg-input)] rounded-xl border border-[var(--border-default)]">
                <div>
                  <Label className="text-[9px] font-extrabold text-[var(--text-secondary)] uppercase">💵 Efectivo ($)</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={formatThousandsInput(cashAmountInput)}
                    onChange={e => {
                      const num = parseThousandsInput(e.target.value)
                      setCashAmountInput(num > 0 ? String(num) : '')
                      const rest = Math.max(0, total - num)
                      setTransferAmountInput(rest > 0 ? String(rest) : '0')
                    }}
                    className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-lg h-7 text-xs font-bold text-emerald-500 mt-0.5"
                  />
                </div>
                <div>
                  <Label className="text-[9px] font-extrabold text-[var(--text-secondary)] uppercase">📱 Transferencia ($)</Label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    value={formatThousandsInput(transferAmountInput)}
                    onChange={e => {
                      const num = parseThousandsInput(e.target.value)
                      setTransferAmountInput(num > 0 ? String(num) : '')
                      const rest = Math.max(0, total - num)
                      setCashAmountInput(rest > 0 ? String(rest) : '0')
                    }}
                    className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-lg h-7 text-xs font-bold text-blue-500 mt-0.5"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>
    )
  }

  const renderCartCard = (showSubmitButtonDirectly = false, hideSubmitButton = false) => {
    return (
      <Card className={cn(
        "flex flex-col bg-gradient-to-b from-[var(--bg-panel)] to-[var(--bg-elevated)] rounded-2xl relative overflow-visible h-auto",
        embedded ? "border border-[var(--border-subtle)] shadow-sm" : "border-2 border-[var(--accent-border)] shadow-2xl"
      )}>
        <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-[var(--accent)]/5 to-transparent blur-xl pointer-events-none" />
        <CardHeader className="shrink-0 py-2 px-3 border-b border-[var(--border-subtle)]">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-primary)]">
              <ShoppingCart className="h-3.5 w-3.5 text-[var(--accent)]" />
              <span className="antifont tracking-wider">{step === 'delivery' ? '1. PRODUCTOS DEL PEDIDO' : 'MI PEDIDO'}</span>
            </CardTitle>
            <div className="flex items-center gap-1.5">
              <Badge className="bg-[var(--accent)] text-[var(--accent-fg)] font-extrabold rounded-md px-1.5 py-0.5 text-[10px]">
                {cart.reduce((s, i) => s + i.quantity, 0)} items
              </Badge>
              {step === 'delivery' && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setStep('menu')}
                  className="h-6 px-2 text-[10px] font-bold border-[var(--border-default)] hover:bg-[var(--bg-hover)] text-[var(--accent)] rounded-md cursor-pointer"
                >
                  <Plus className="mr-0.5 h-3 w-3" /> Agregar más
                </Button>
              )}
              {step === 'delivery' && cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIsCartCollapsed(!isCartCollapsed)}
                  className="h-6 w-6 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer"
                  title={isCartCollapsed ? 'Mostrar lista de productos' : 'Plegar productos'}
                >
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${isCartCollapsed ? '' : 'rotate-180'}`} />
                </button>
              )}
            </div>
          </div>
        </CardHeader>

        {isCartCollapsed && step === 'delivery' ? (
          <div 
            onClick={() => setIsCartCollapsed(false)}
            className="px-3 py-2 text-[11px] font-semibold text-[var(--text-secondary)] flex items-center justify-between cursor-pointer hover:bg-[var(--bg-hover)]/40 transition-colors"
          >
            <span>{groupedCart.length} producto(s) · {cart.reduce((s, i) => s + i.quantity, 0)} items</span>
            <span className="font-extrabold text-[var(--accent)]">{formatCurrency(subtotal)} (clic para desplegar)</span>
          </div>
        ) : (
          <div className="px-2.5 py-2 max-h-[190px] sm:max-h-[220px] overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700">
            {cart.length === 0 && (
              <div className={cn("text-center space-y-2", embedded ? "py-3" : "py-8")}>
                <Sparkles className="mx-auto h-6 w-6 text-[var(--accent)]/30 animate-pulse" />
                <div>
                  <p className="text-xs font-semibold text-[var(--text-secondary)]">El pedido está vacío</p>
                  {step === 'delivery' && (
                    <Button size="sm" variant="outline" onClick={() => setStep('menu')} className="mt-2 text-xs h-7 rounded-lg font-bold">
                      <Plus className="mr-1 h-3 w-3" /> Ir a la carta para agregar
                    </Button>
                  )}
                </div>
              </div>
            )}
            <div className={cn(
              "grid gap-2",
              groupedCart.length > 1 ? "grid-cols-1 min-[420px]:grid-cols-2" : "grid-cols-1"
            )}>
              <AnimatePresence>
                {groupedCart.map(item => {
                  const keyId = item.lineId || item.menuItemId;
                  const visibleKitchenNote = keepKitchenInstruction(getItemRawNote(item.notes), item.name)
                  return (
                    <motion.div
                      key={keyId}
                      layout
                      initial={{ opacity: 0, x: 15 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -15 }}
                      className="rounded-xl bg-[var(--bg-base)] border border-[var(--border-subtle)] p-2 shadow-xs space-y-1.5 min-w-0 flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between gap-1.5 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <p className="text-xs font-bold text-[var(--text-primary)] truncate" title={item.name}>{item.name}</p>
                          <span className="text-xs font-extrabold text-[var(--accent)] shrink-0">
                            {formatCurrency(item.price * item.quantity)}
                          </span>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0 bg-[var(--bg-panel)] rounded-lg p-0.5 border border-[var(--border-subtle)]">
                          <Button 
                            size="icon" 
                            variant="ghost" 
                            className="h-5 w-5 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] cursor-pointer" 
                            onClick={() => item.quantity === 1 ? removeFromCart(item.lineId!, item.name) : updateQuantity(item.lineId!, -1)}
                          >
                            <Minus className="h-2.5 w-2.5" />
                          </Button>
                          <span className="w-4 text-center text-xs font-extrabold text-[var(--text-primary)]">{item.quantity}</span>
                          <Button 
                            size="icon" 
                            variant="ghost" 
                            className="h-5 w-5 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] cursor-pointer" 
                            onClick={() => updateQuantity(item.lineId!, 1)}
                          >
                            <Plus className="h-2.5 w-2.5" />
                          </Button>
                          <Button 
                            size="icon" 
                            variant="ghost" 
                            className="h-5 w-5 rounded-md text-[var(--destructive)] hover:bg-[var(--destructive)]/10 cursor-pointer" 
                            onClick={() => removeFromCart(item.lineId!, item.name)}
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                          </Button>
                        </div>
                      </div>

                      {/* Cart Item Actions Row (Nota chip / input, Adición) */}
                      <div className="flex items-center gap-1 flex-wrap pt-1 border-t border-[var(--border-subtle)]/40 min-w-0">
                        {showNotes[keyId] ? (
                          <div className="flex items-center gap-1 bg-[var(--bg-elevated)] border border-[var(--accent)]/40 p-1 rounded-lg w-full">
                            <input 
                              ref={el => { noteInputRefs.current[keyId] = el; }}
                              value={draftNotes[keyId] ?? visibleKitchenNote ?? ''}
                              onChange={e => {
                                const val = e.target.value;
                                setDraftNotes(prev => ({ ...prev, [keyId]: val }));
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  saveItemNote(item.lineId!, draftNotes[keyId] ?? visibleKitchenNote ?? '');
                                }
                              }}
                              placeholder={item.quantity > 1 ? "Nota (ej: 2 sin cebolla)..." : "Nota (ej: sin cebolla)..."} 
                              className="h-6 text-[11px] bg-[var(--bg-input)] border border-[var(--border-subtle)] rounded px-2 focus:border-[var(--accent)] outline-none flex-1 font-medium text-[var(--text-primary)]" 
                              autoFocus
                            />
                            <button
                              type="button"
                              onMouseDown={e => e.preventDefault()}
                              onClick={() => saveItemNote(item.lineId!, draftNotes[keyId] ?? visibleKitchenNote ?? '')}
                              className="h-6 px-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[10px] font-bold cursor-pointer shrink-0 transition-colors shadow-2xs"
                              title="Guardar nota (Enter)"
                            >
                              ✓
                            </button>
                            <button
                              type="button"
                              onMouseDown={e => e.preventDefault()}
                              onClick={() => clearItemNotes(item.lineId!)}
                              className="h-6 px-1.5 text-[var(--text-muted)] hover:text-red-500 rounded text-[10px] font-bold cursor-pointer shrink-0"
                              title="Borrar nota"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <>
                            {visibleKitchenNote ? (
                              <div className="inline-flex items-center gap-1 text-[10px] bg-red-500/10 border border-red-500/25 text-red-600 dark:text-red-400 font-semibold px-1.5 py-0.5 rounded-md max-w-full min-w-0">
                                <button 
                                  type="button"
                                  onClick={() => startEditNote(item)}
                                  className="truncate cursor-pointer hover:underline max-w-[130px] flex items-center gap-1 text-left"
                                  title="Clic para editar nota con el cursor"
                                >
                                  <span>📝 {visibleKitchenNote}</span>
                                  <Edit className="w-2.5 h-2.5 opacity-80 shrink-0" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => clearItemNotes(item.lineId!)}
                                  className="hover:text-red-700 dark:hover:text-red-300 cursor-pointer shrink-0 ml-0.5"
                                  title="Quitar nota"
                                >
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleAddNoteClick(item)}
                                className="text-[10px] font-bold text-[var(--accent)] hover:bg-[var(--accent)]/15 flex items-center gap-0.5 cursor-pointer bg-[var(--accent)]/10 px-1.5 py-0.5 rounded-md transition-all shrink-0"
                              >
                                <Plus className="h-2.5 w-2.5" /> Nota
                              </button>
                            )}

                            {(() => {
                              const itemAdditions = getAdditionItemsFor(item);
                              if (itemAdditions.length === 0) return null;
                              return (
                                <AdditionDropdown
                                  item={item}
                                  additions={itemAdditions}
                                  onSelect={handleAddAddition}
                                />
                              );
                            })()}
                          </>
                        )}
                      </div>

                      {/* Additions list nested under parent */}
                      {item.additions && item.additions.length > 0 && (
                        <div className="mt-1 pl-2 border-l-2 border-[var(--accent)]/30 space-y-1">
                          {item.additions.map(add => (
                            <div key={`${add.menuItemId}-${add.notes}`} className="flex items-center justify-between text-xs bg-[var(--bg-elevated)]/60 rounded-md py-0.5 px-1.5 border border-[var(--border-subtle)]/50">
                              <div className="min-w-0 flex-1 flex items-center gap-1.5">
                                <p className="text-[10px] font-bold text-[var(--text-primary)] truncate">{add.name}</p>
                                <p className="text-[10px] text-[var(--accent)] font-semibold shrink-0">+{formatCurrency(add.price * add.quantity)}</p>
                              </div>
                              <div className="flex items-center gap-0.5 shrink-0 bg-[var(--bg-panel)] rounded p-0.5 border border-[var(--border-subtle)]">
                                <Button 
                                  size="icon" 
                                  variant="ghost" 
                                  className="h-4.5 w-4.5 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]" 
                                  onClick={() => add.quantity === 1 ? removeAddition(add) : updateAdditionQuantity(add, -1)}
                                >
                                  <Minus className="h-2 w-2" />
                                </Button>
                                <span className="w-3 text-center text-[9px] font-bold text-[var(--text-primary)]">{add.quantity}</span>
                                <Button 
                                  size="icon" 
                                  variant="ghost" 
                                  className="h-4.5 w-4.5 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]" 
                                  onClick={() => updateAdditionQuantity(add, 1)}
                                >
                                  <Plus className="h-2 w-2" />
                                </Button>
                                <Button 
                                  size="icon" 
                                  variant="ghost" 
                                  className="h-4.5 w-4.5 rounded text-[var(--destructive)] hover:bg-[var(--destructive)]/10" 
                                  onClick={() => removeAddition(add)}
                                >
                                  <Trash2 className="h-2.5 w-2.5" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          </div>
        )}
        
        {cart.length > 0 && !hideSubmitButton && (
          <div className="shrink-0 space-y-2.5 border-t border-[var(--border-subtle)] p-4 bg-[var(--bg-panel)]">
            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-[var(--text-secondary)]"><span>Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
              <div className="flex justify-between text-[var(--text-secondary)]"><span>Tarifa Envío</span><span>{orderType === 'pickup' ? 'Gratis' : formatCurrency(deliveryFee)}</span></div>
              <Separator className="bg-[var(--border-subtle)] my-1" />
              <div className="flex justify-between text-sm font-bold text-[var(--text-primary)]"><span>TOTAL</span><span className="text-[var(--accent)] font-extrabold text-base">{formatCurrency(total)}</span></div>
            </div>
            {error && <p className="rounded-xl border border-[var(--destructive)]/20 bg-[var(--destructive)]/5 p-2 text-xs text-[var(--destructive)] leading-relaxed">{error}</p>}

            {(step === 'menu' && !showSubmitButtonDirectly) ? (
              <Button
                className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold h-10 rounded-xl shadow-lg shadow-[var(--accent)]/15 transition-all text-xs uppercase tracking-wider cursor-pointer"
                onClick={() => setStep('delivery')}
              >
                Continuar a Datos de Entrega
              </Button>
            ) : (
              <Button
                className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold h-10 rounded-xl shadow-lg shadow-[var(--accent)]/15 transition-all text-xs uppercase tracking-wider cursor-pointer"
                onClick={handleSubmit}
                disabled={loading || isCashBlocked}
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {loading ? 'Guardando Pedido...' : editOrderId ? 'GUARDAR CAMBIOS' : 'CONFIRMAR Y CREAR PEDIDO'}
              </Button>
            )}

            <p className="flex items-center justify-center gap-1 text-[9px] text-[var(--text-muted)]">
              <Save className="h-3 w-3" />
              {editOrderId ? 'Guardando modificaciones · Re-imprime Comanda' : 'Borrador guardado automáticamente · Imprime Comanda'}
            </p>
          </div>
        )}

        {cart.length > 0 && hideSubmitButton && !isCartCollapsed && (
          <div className="shrink-0 flex items-center justify-between border-t border-[var(--border-subtle)] px-3 py-1.5 bg-[var(--bg-panel)]/40 text-[11px] font-bold text-[var(--text-secondary)]">
            <span>Subtotal platos ({cart.reduce((s, i) => s + i.quantity, 0)} items)</span>
            <span className="text-xs font-black text-[var(--text-primary)]">{formatCurrency(subtotal)}</span>
          </div>
        )}
      </Card>
    )
  }

  const renderEmbeddedConfirmationBar = () => {
    const isBlocked = loading || parsingChatOrder || isCashBlocked || missingFields.length > 0
    const statusText = isCashBlocked
      ? 'Caja Domicilios cerrada'
      : parsingChatOrder
        ? 'Leyendo el chat…'
        : missingFields.length > 0
          ? `Falta: ${missingFields.join(', ')}`
          : 'Listo para enviar a cocina'

    return (
      <div className="shrink-0 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2 sm:p-2.5 shadow-lg shadow-black/5">
        {error && <p className="mb-1.5 rounded-xl border border-[var(--destructive)]/20 bg-[var(--destructive)]/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--destructive)]">{error}</p>}
        <div className="flex items-center justify-between gap-2 min-w-0">
          <div className="min-w-0 flex-1 pl-1">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)] truncate">
              {itemCount} {itemCount === 1 ? 'producto' : 'productos'} · {orderType === 'delivery' ? 'Domicilio' : 'Recoger'}
            </p>
            <p className={cn(
              "mt-0.5 truncate text-xs font-bold",
              isOrderReadyToConfirm ? 'text-emerald-600' : isCashBlocked ? 'text-[var(--destructive)]' : 'text-[var(--text-secondary)]'
            )}>
              {statusText}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-xs sm:text-sm font-black text-[var(--accent)]">{formatCurrency(total)}</span>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isBlocked}
              title={isBlocked ? statusText : 'Confirmar el pedido y enviarlo a cocina'}
              className="h-9 sm:h-10 rounded-xl bg-[var(--accent)] px-3 text-xs font-black text-[var(--accent-fg)] shadow-md shadow-[var(--accent)]/15 hover:bg-[var(--accent-hover)]"
            >
              {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
              {loading ? 'Guardando…' : editOrderId ? 'Guardar' : 'Confirmar'}
            </Button>
          </div>
        </div>
        <p className="mt-1 px-1 text-[9px] text-[var(--text-muted)] truncate">
          {isCashBlocked ? 'El borrador queda guardado mientras abres la caja.' : 'El borrador se guarda automáticamente.'}
        </p>
      </div>
    )
  }

  if (initialLoading) {
    return (
      <div className={cn("flex items-center justify-center", embedded ? "h-full min-h-0" : "min-h-[60vh]")}>
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-[var(--accent)]" />
          <p className="text-sm font-semibold text-[var(--text-secondary)]">Cargando menú...</p>
        </div>
      </div>
    )
  }

  return (
    <div className={cn(
      "flex min-h-0 w-full flex-col gap-3",
      embedded ? "relative h-full overflow-hidden bg-[var(--bg-base)] p-2 sm:p-3" : "min-h-[calc(100dvh-120px)] md:h-[calc(100vh-70px)]"
    )}>
      <div className="flex items-center justify-between gap-2 shrink-0 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={closeOrderPanel}
            className="rounded-xl hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)] text-[var(--text-secondary)] h-8 w-8 sm:h-9 sm:w-9 shrink-0 cursor-pointer"
            title={embedded ? 'Cerrar pedido y volver al chat' : 'Volver a la lista de pedidos'}
          >
            {embedded ? <X className="h-5 w-5" /> : <ArrowLeft className="h-5 w-5" />}
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className={cn("antifont tracking-wider text-[var(--text-primary)] leading-none truncate", embedded ? "text-lg sm:text-2xl" : "text-2xl md:text-3xl")}>
              {editOrderId ? 'EDITAR PEDIDO' : embedded ? 'PEDIDO RÁPIDO' : 'NUEVO PEDIDO'}
            </h2>
            {embedded && (
              <div className="mt-0.5 sm:mt-1 flex items-center gap-1.5 text-[10px] font-semibold text-[var(--text-muted)] min-w-0">
                {parsingChatOrder && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[var(--accent)]" />}
                <span className="truncate">
                  {parsingChatOrder
                    ? 'Leyendo productos y datos del chat…'
                    : `${customerName || initialName ? `Para ${customerName || initialName} · ` : ''}datos listos · borrador guardado`}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!embedded && <Button
            variant="outline" 
            size="sm"
            onClick={() => navigate(chatReturnPath)}
            className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 font-bold rounded-xl text-xs h-9 px-3 cursor-pointer flex items-center gap-1.5 transition-all shadow-xs"
            title="Regresar al panel de chat de WhatsApp"
          >
            <MessageCircle className="h-4 w-4 text-emerald-500" />
            <span>← Volver al Chat</span>
          </Button>}

          {!embedded && <Button
            size="sm"
            onClick={handleOpenChatDrawer}
            className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold rounded-xl text-xs h-9 px-3 cursor-pointer flex items-center gap-1.5 shadow-md shadow-[var(--accent)]/10"
            title="Abrir ventana emergente con el chat en vivo del cliente"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>💬 Ver Chat en Vivo</span>
          </Button>}

          <Button 
            variant="outline" 
            size="sm" 
            onClick={clearDraft} 
            className="border-[var(--border-default)] bg-[var(--bg-panel)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all rounded-xl text-xs h-8 sm:h-9 px-2.5 sm:px-3 cursor-pointer shrink-0"
          >
            {editOrderId ? 'Cancelar Edición' : (
              <>
                <Trash2 className="mr-1 h-3.5 w-3.5 text-[var(--destructive)]" /> Limpiar
              </>
            )}
          </Button>
        </div>
      </div>
 
      {isCashBlocked && step === 'menu' && (
        <div className={cn(
          "flex items-center gap-3 rounded-2xl border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 text-[var(--destructive)] shrink-0",
          embedded ? "px-3 py-2" : "px-4 py-3.5"
        )}>
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{canCreate?.reason || 'La Caja Domicilios está cerrada'}</p>
              <p className={cn("mt-0.5 text-xs", embedded ? "hidden" : "hidden sm:block")}>Puedes armar el pedido; solo falta abrir la caja para confirmarlo.</p>
            </div>
            <Link to="/payments" className="shrink-0 text-xs font-semibold underline transition-all hover:text-[var(--text-primary)]">Abrir caja →</Link>
          </div>
        </div>
      )}

      {/* Flujo de pedido: siempre visible dentro de WhatsApp y compacto en móvil. */}
      <div className={cn(
        "rounded-xl bg-[var(--bg-panel)] p-1 border border-[var(--border-subtle)]/40 shrink-0 gap-1",
        embedded ? "flex" : "flex md:hidden"
      )}>
        <button
          type="button"
          className={`flex-1 py-1.5 sm:py-2 px-2 text-xs font-bold rounded-lg transition-all cursor-pointer min-w-0 ${step === 'menu' ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
          onClick={() => setStep('menu')}
        >
          <span className="inline-flex items-center justify-center gap-1.5 truncate max-w-full">
            {cart.length > 0 && step !== 'menu' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <ShoppingCart className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">1. Productos</span> <span className="opacity-80 shrink-0">({itemCount})</span>
          </span>
        </button>
        <button
          type="button"
          disabled={embedded && cart.length === 0}
          className={`flex-1 py-1.5 sm:py-2 px-2 text-xs font-bold rounded-lg transition-all min-w-0 ${
            step === 'delivery'
              ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm cursor-pointer'
              : embedded && cart.length === 0
                ? 'text-[var(--text-muted)] opacity-60 cursor-not-allowed'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer'
          }`}
          onClick={() => setStep('delivery')}
          title={embedded && cart.length === 0 ? 'Agrega al menos un producto para continuar' : 'Completar datos y confirmar pedido'}
        >
          <span className="inline-flex items-center justify-center gap-1.5 truncate max-w-full">
            {isOrderReadyToConfirm ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <MapPin className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate">2. Entrega y pago</span> <span className="opacity-80 shrink-0">({cart.length > 0 ? formatCurrency(total) : '$0'})</span>
          </span>
        </button>
      </div>

      {embedded ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {step === 'menu' ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {renderMenuCard()}
            </div>
          ) : (
            <>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1 pb-3 scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700">
                {renderCartCard(true, true)}
                {renderDeliveryCard()}
              </div>
              {renderEmbeddedConfirmationBar()}
            </>
          )}
        </div>
      ) : (
        <>
          {/* ── DESKTOP VIEW (hidden on mobile) ── */}
          <div className="hidden md:grid min-h-0 flex-1 gap-4 overflow-hidden md:grid-cols-2 lg:grid-cols-3">
            {/* Columna 1: Menú (Ampliada) */}
            <div className="min-h-0 h-full flex flex-col lg:col-span-2">
              {renderMenuCard()}
            </div>

            {/* Columna 2: Sidebar (Carrito + Datos) */}
            <div className="min-h-0 h-full overflow-y-auto flex flex-col gap-3 pr-1 pb-4 scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700">
              <div className="flex-none">
                {renderCartCard(true)}
              </div>
              <div className="flex-none">
                {renderDeliveryCard()}
              </div>
            </div>
          </div>

          {/* ── MOBILE VIEW (hidden on desktop) ── */}
          <div className="md:hidden flex-1 min-h-0 overflow-y-auto flex flex-col">
            {step === 'menu' ? (
              <div className="flex-1 min-h-0 overflow-y-auto">
                {renderMenuCard()}
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pb-3 scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700">
                  {renderCartCard(true, true)}
                  {renderDeliveryCard()}
                </div>
                {renderEmbeddedConfirmationBar()}
              </div>
            )}
          </div>
        </>
      )}

      {/* Resumen flotante para revisar el pedido sin perder la carta. */}
      {step === 'menu' && cart.length > 0 && !isCartDrawerOpen && (
        <div className={cn("z-40", embedded ? "w-full shrink-0" : "fixed bottom-4 left-4 right-4 md:hidden")}>
          <motion.div
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            className={cn(
              "flex items-center justify-between rounded-2xl border border-[var(--accent-border)] bg-[var(--bg-panel)]/95 backdrop-blur-md shadow-2xl",
              embedded ? "gap-2 px-2.5 py-2" : "p-3"
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <div className={cn(
                "flex items-center justify-center rounded-xl bg-[var(--accent)]/15 border border-[var(--accent)]/30 text-[var(--accent)]",
                embedded ? "h-8 w-8" : "h-9 w-9"
              )}>
                <ShoppingCart className={embedded ? "h-3.5 w-3.5" : "h-4 w-4"} />
              </div>
              <div className="min-w-0">
                <p className={cn("font-bold text-[var(--text-primary)]", embedded ? "text-[11px]" : "text-xs")}>
                  {cart.reduce((s, i) => s + i.quantity, 0)} items
                </p>
                <p className={cn("font-extrabold text-[var(--accent)]", embedded ? "text-[11px]" : "text-xs")}>
                  Total: {formatCurrency(total)}
                </p>
              </div>
            </div>
            <Button
              onClick={() => setStep('delivery')} // Ir directamente a la pestaña de entrega!
              className={cn(
                "bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold rounded-xl flex items-center gap-1.5 shadow-md shadow-[var(--accent)]/10 cursor-pointer",
                embedded ? "h-8 px-3 text-[11px]" : "h-9 px-4 text-xs"
              )}
            >
              Revisar y confirmar
            </Button>
          </motion.div>
        </div>
      )}
      {/* FLOATING LIVE WHATSAPP CHAT DRAWER */}
      <AnimatePresence>
        {!embedded && showChatDrawer && (
          <div 
            className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-xs cursor-pointer"
            onClick={() => setShowChatDrawer(false)}
          >
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 250 }}
              className="w-full max-w-md bg-[var(--bg-panel)] h-full shadow-2xl flex flex-col border-l border-[var(--border-subtle)] cursor-default"
              onClick={e => e.stopPropagation()}
            >
              {/* Drawer Header */}
              <div className="p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-9 w-9 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-extrabold text-xs flex items-center justify-center border border-emerald-500/20 shrink-0">
                    <MessageCircle className="h-5 w-5 text-emerald-500" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-extrabold text-[var(--text-primary)] uppercase truncate">
                      {chatDrawerSession?.customerName || customerName || 'Chat de WhatsApp'}
                    </h3>
                    <p className="text-[10px] text-[var(--text-secondary)] font-mono font-bold flex items-center gap-1">
                      <Phone className="h-3 w-3 text-emerald-500" /> {chatDrawerSession?.phone || customerPhone || 'Sin teléfono'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate(chatReturnPath)}
                    className="h-8 px-2.5 text-[10px] font-bold border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 rounded-lg flex items-center gap-1 cursor-pointer"
                    title="Abrir pantalla completa de Chat"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span className="hidden sm:inline">Pantalla Completa</span>
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setShowChatDrawer(false)}
                    className="h-8 w-8 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-full cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Drawer Messages List */}
              <div 
                ref={chatDrawerScrollRef} 
                onScroll={(e) => {
                  const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
                  userIsNearBottomRef.current = (scrollHeight - scrollTop - clientHeight) < 150
                }}
                className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 bg-[var(--bg-elevated)]/20 overscroll-contain"
              >
                {loadingChatDrawer ? (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400">
                    <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
                    <span className="text-xs font-semibold">Cargando mensajes del cliente...</span>
                  </div>
                ) : chatDrawerMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center p-6 text-[var(--text-secondary)]">
                    <MessageCircle className="h-10 w-10 text-emerald-500/40 mb-2" />
                    <p className="text-xs font-bold">No hay conversación activa cargada</p>
                    <p className="text-[11px] text-[var(--text-muted)] mt-1">Ingresa el teléfono del cliente arriba o abre el pedido desde el Chat de WhatsApp.</p>
                  </div>
                ) : (
                  chatDrawerMessages.map(m => {
                    const isIncoming = m.direction === 'IN'
                    return (
                      <div key={m.id} className={`flex ${isIncoming ? 'justify-start' : 'justify-end'}`}>
                        <div className={`max-w-[85%] rounded-2xl p-2.5 shadow-xs text-xs ${
                          isIncoming
                            ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] rounded-tl-none border border-[var(--border-subtle)]'
                            : 'bg-emerald-600 text-white rounded-tr-none'
                        }`}>
                          {['image', 'video', 'audio', 'document'].includes(m.messageType) ? (
                            <ChatDrawerMedia mediaId={m.content} type={m.messageType} />
                          ) : (
                            <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                          )}
                          <span className={`block text-[9px] mt-1 font-mono text-right ${isIncoming ? 'text-[var(--text-muted)]' : 'text-white/80'}`}>
                            {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Drawer Footer Input */}
              {chatDrawerSession && (
                <div className="p-3 border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] flex items-center gap-2 shrink-0">
                  <Input
                    value={chatDrawerReplyText}
                    onChange={e => setChatDrawerReplyText(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSendDrawerReply()}
                    placeholder="Escribe una respuesta rápida por WhatsApp..."
                    className="text-xs h-9 bg-[var(--bg-input)] rounded-xl border-[var(--border-default)]"
                  />
                  <Button
                    size="icon"
                    onClick={handleSendDrawerReply}
                    disabled={!chatDrawerReplyText.trim()}
                    className="h-9 w-9 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shrink-0 cursor-pointer"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

