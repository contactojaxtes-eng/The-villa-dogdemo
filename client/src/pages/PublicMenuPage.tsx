import { useState, useEffect, useMemo, useRef } from 'react'
import { io as connect } from 'socket.io-client'
import { useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { BrandLogo } from '@/components/brand/BrandLogo'
import { ShoppingCart, Plus, Minus, X, Info, Send, Check, ChevronDown, ListFilter, MessageSquare, Edit3, PlusCircle, Bike, Store } from 'lucide-react'

interface MenuItem {
  id: string
  name: string
  description?: string
  price: number
  imageUrl?: string
  active: boolean
  type?: string
}

interface Category {
  id: string
  name: string
  description?: string
  items: MenuItem[]
}

interface Zone {
  id: string
  name: string
  rate?: number
  price?: number
}

interface CartItem {
  lineId: string
  menuItem: MenuItem
  quantity: number
  notes: string
  additions: MenuItem[]
}

const emptyCustomerInfo = {
  name: '',
  phone: '',
  address: '',
  neighborhood: '',
  paymentMethod: 'CASH',
  notes: '',
}

export default function PublicMenuPage() {
  const { siteCode } = useParams<{ siteCode?: string }>()
  const normalizedSiteCode = String(siteCode || '').trim().toLowerCase()
  const publicSiteQuery = normalizedSiteCode ? `?site=${encodeURIComponent(normalizedSiteCode)}` : ''
  const publicStorageSuffix = normalizedSiteCode || 'principal'
  const customerStorageKey = `niche_customer_info:${publicStorageSuffix}`
  const cartStorageKey = `niche_cart:${publicStorageSuffix}`
  const [categories, setCategories] = useState<Category[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState<string>('')
  const [formError, setFormError] = useState<string>('')
  const drawerRef = useRef<HTMLDivElement>(null)

  const [restaurantPhone, setRestaurantPhone] = useState('573003229261')
  const publicSiteIdRef = useRef<string | null>(null)
  const [publicSiteIdentityReady, setPublicSiteIdentityReady] = useState(!normalizedSiteCode)
  const [orderMode, setOrderMode] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY')

  const [cart, setCart] = useState<CartItem[]>([])
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [isCheckout, setIsCheckout] = useState(false)

  // Mobile Vertical Category Drawer Toggle State
  const [isCategoryDrawerOpen, setIsCategoryDrawerOpen] = useState(false)
  
  // Track open additions per cart item lineId
  const [expandedAdditions, setExpandedAdditions] = useState<Record<string, boolean>>({})

  // Custom Neighborhood text when not in dropdown
  const [customNeighborhood, setCustomNeighborhood] = useState('')

  const [customerInfo, setCustomerInfo] = useState(emptyCustomerInfo)
  const [hydratedCustomerKey, setHydratedCustomerKey] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const publicAttempt = useRef({ signature: '', id: '' })
  const [orderSuccess, setOrderSuccess] = useState(false)
  const [placedOrderInfo, setPlacedOrderInfo] = useState<{ id?: string; number?: number; total: number } | null>(null)
  const [lastMessageText, setLastMessageText] = useState('')

  const [isAdmin, setIsAdmin] = useState(false)

  // A public menu can change site code without a full page reload.  Never
  // carry the previous restaurant's cart into the newly selected site.
  useEffect(() => {
    setCart([])
    setExpandedAdditions({})
    setIsCartOpen(false)
    setIsCheckout(false)
    setOrderSuccess(false)
    setPlacedOrderInfo(null)
    setFormError('')
    publicAttempt.current = { signature: '', id: '' }
  }, [publicStorageSuffix])

  useEffect(() => {
    if (isCheckout && drawerRef.current) {
      drawerRef.current.scrollTop = 0
    }
  }, [isCheckout])

  // Load saved customer info from localStorage AND URL params on mount
  useEffect(() => {
    let nextCustomerInfo = { ...emptyCustomerInfo }
    let nextCustomNeighborhood = ''
    try {
      // La clave histórica se lee únicamente para la sede principal. Cada
      // sede secundaria conserva su formulario separado en el navegador.
      const saved = localStorage.getItem(customerStorageKey)
        || (!siteCode ? localStorage.getItem('niche_customer_info') : null)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.name || parsed.phone || parsed.address || parsed.neighborhood) {
          nextCustomerInfo = { ...nextCustomerInfo, ...parsed }
          if (parsed.customNeighborhood) {
            nextCustomNeighborhood = parsed.customNeighborhood
          }
        }
      }
    } catch (e) {}

    const params = new URLSearchParams(window.location.search)
    const phoneParam = params.get('phone') || params.get('tel') || params.get('cel')
    const nameParam = params.get('name') || params.get('nombre')
    const addressParam = params.get('address') || params.get('direccion')
    const neighborhoodParam = params.get('neighborhood') || params.get('barrio')

    if (phoneParam || nameParam || addressParam || neighborhoodParam) {
      nextCustomerInfo = {
        ...nextCustomerInfo,
        name: nameParam ? decodeURIComponent(nameParam) : nextCustomerInfo.name,
        phone: phoneParam ? phoneParam.replace(/\D/g, '') : nextCustomerInfo.phone,
        address: addressParam ? decodeURIComponent(addressParam) : nextCustomerInfo.address,
        neighborhood: neighborhoodParam ? decodeURIComponent(neighborhoodParam) : nextCustomerInfo.neighborhood,
      }

      if (neighborhoodParam) {
        nextCustomNeighborhood = decodeURIComponent(neighborhoodParam)
      }
    }

    setCustomerInfo(nextCustomerInfo)
    setCustomNeighborhood(nextCustomNeighborhood)
    setHydratedCustomerKey(customerStorageKey)
  }, [customerStorageKey, siteCode])

  // Auto-save customer info changes to localStorage
  useEffect(() => {
    if (hydratedCustomerKey !== customerStorageKey) return
    try {
      if (customerInfo.name || customerInfo.phone || customerInfo.address || customerInfo.neighborhood) {
        localStorage.setItem(customerStorageKey, JSON.stringify({
          ...customerInfo,
          customNeighborhood
        }))
      }
    } catch (e) {}
  }, [customerInfo, customNeighborhood, customerStorageKey, hydratedCustomerKey])

  useEffect(() => {
    let active = true
    const applyCategories = (catRes: Category[]) => {
      if (!active) return
      const activeCats = (catRes || []).filter(c => c.items && c.items.some(i => i.active))
      setCategories(activeCats)
      setActiveCategory(current => activeCats.some(category => category.id === current) ? current : (activeCats[0]?.id || ''))
    }

    Promise.all([
      api.get<Category[]>(`/public/menu/categories${publicSiteQuery}`, { force: true }),
      api.get<Zone[]>(`/public/zones${publicSiteQuery}`),
      api.get<{ whatsappPhone: string; site?: { id?: string } }>(`/public/menu/info${publicSiteQuery}`).catch(() => null)
    ])
    .then(([catRes, zoneRes, infoRes]) => {
      if (!active) return
      applyCategories(catRes || [])
      setZones(zoneRes || [])
      if (infoRes && infoRes.whatsappPhone) {
        setRestaurantPhone(infoRes.whatsappPhone)
      }
      publicSiteIdRef.current = infoRes?.site?.id || null
      // A secondary public menu must never fall back to the principal
      // restaurant's WhatsApp number if its own identity endpoint fails.
      setPublicSiteIdentityReady(
        !normalizedSiteCode || Boolean(infoRes?.site?.id && infoRes?.whatsappPhone),
      )
    })
    .catch(err => {
      console.error("Error cargando menú", err)
      if (normalizedSiteCode) setPublicSiteIdentityReady(false)
    })
    .finally(() => { if (active) setLoading(false) })

    const token = localStorage.getItem('token')
    if (token) setIsAdmin(true)

    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const menuSocket = connect(`${socketUrl}/public-menu`, {
      transports: ['websocket', 'polling'],
      reconnection: true,
    })
    menuSocket.on('menuUpdated', (event?: { siteId?: string }) => {
      // El namespace público es liviano y compartido, pero cada navegador
      // vuelve a consultar únicamente cuando cambió la sede que está viendo.
      if (event?.siteId && publicSiteIdRef.current && event.siteId !== publicSiteIdRef.current) return
      api.get<Category[]>(`/public/menu/categories${publicSiteQuery}`, { force: true })
        .then(applyCategories)
        .catch(err => console.error('Error sincronizando la carta', err))
    })

    return () => {
      active = false
      menuSocket.disconnect()
    }
  }, [publicSiteQuery])

  // Extract addition items from any category containing "Adicion" or "Adicional"
  const availableAdditions = useMemo(() => {
    return categories
      .filter(c => c.name.toLowerCase().includes('adicion') || c.name.toLowerCase().includes('adicional'))
      .flatMap(c => c.items.filter(i => i.active))
  }, [categories])

  const toggleAdditionsAccordion = (lineId: string) => {
    setExpandedAdditions(prev => ({ ...prev, [lineId]: !prev[lineId] }))
  }

  const addToCart = (item: MenuItem, notes = '', itemAdditions: MenuItem[] = []) => {
    const lineId = `line-${Math.random().toString(36).substring(2, 9)}`
    setCart(prev => [...prev, {
      lineId,
      menuItem: item,
      quantity: 1,
      notes,
      additions: itemAdditions
    }])
    setIsCartOpen(true)
  }

  const updateQuantity = (lineId: string, delta: number) => {
    setCart(prev => {
      return prev.map(item => {
        if (item.lineId === lineId) {
          const newQty = item.quantity + delta
          return newQty > 0 ? { ...item, quantity: newQty } : null
        }
        return item
      }).filter(Boolean) as CartItem[]
    })
  }

  const updateItemNotes = (lineId: string, notes: string) => {
    setCart(prev => prev.map(item => item.lineId === lineId ? { ...item, notes } : item))
  }

  const toggleItemAddition = (lineId: string, addition: MenuItem) => {
    setCart(prev => prev.map(item => {
      if (item.lineId === lineId) {
        const hasAdd = item.additions.some(a => a.id === addition.id)
        const nextAdds = hasAdd
          ? item.additions.filter(a => a.id !== addition.id)
          : [...item.additions, addition]
        return { ...item, additions: nextAdds }
      }
      return item
    }))
  }

  const getZoneRate = (z?: Zone): number => {
    if (!z) return 0
    return Number(z.rate ?? z.price ?? 0)
  }

  const effectiveNeighborhood = useMemo(() => {
    if (customerInfo.neighborhood === 'OTRO') {
      return customNeighborhood.trim() || 'Otro Barrio'
    }
    return customerInfo.neighborhood
  }, [customerInfo.neighborhood, customNeighborhood])

  // Determine if neighborhood matches a known registered zone
  const selectedZone = useMemo(() => {
    if (!effectiveNeighborhood || customerInfo.neighborhood === 'OTRO') return undefined
    return zones.find(z => z.name.toLowerCase() === effectiveNeighborhood.toLowerCase())
  }, [zones, effectiveNeighborhood, customerInfo.neighborhood])

  const hasKnownDeliveryFee = orderMode === 'DELIVERY' && !!selectedZone
  const deliveryFee = (orderMode === 'DELIVERY' && hasKnownDeliveryFee) ? getZoneRate(selectedZone) : 0

  const subtotal = useMemo(() => {
    return cart.reduce((sum, item) => {
      const itemPrice = item.menuItem?.price || 0
      const additionTotal = item.additions.reduce((addSum, add) => addSum + (add.price || 0), 0)
      return sum + ((itemPrice + additionTotal) * item.quantity)
    }, 0)
  }, [cart])

  const total = subtotal + deliveryFee

  const generateWhatsAppMessage = () => {
    let msg = `Hola The Villa Dog, quiero hacer un pedido:\n\n`
    cart.forEach(item => {
      const addTotal = item.additions.reduce((s, a) => s + (a.price || 0), 0)
      const unitPrice = (item.menuItem?.price || 0) + addTotal
      msg += `- ${item.quantity}x ${item.menuItem?.name || 'Producto'} ($${(unitPrice * item.quantity).toLocaleString()})\n`
      if (item.additions.length > 0) {
        msg += `  Adiciones: ${item.additions.map(a => `${a.name} (+$${(a.price || 0).toLocaleString()})`).join(', ')}\n`
      }
      if (item.notes) {
        msg += `  Nota: ${item.notes}\n`
      }
    })

    if (orderMode === 'PICKUP') {
      msg += `\n*Tipo de Pedido:* 🏪 PASAR A RECOGER EN RESTAURANTE\n`
      msg += `*Subtotal productos:* $${(subtotal || 0).toLocaleString()}\n`
      msg += `*Total a pagar:* $${(subtotal || 0).toLocaleString()}\n\n`
    } else {
      msg += `\n*Tipo de Pedido:* 🛵 DOMICILIO\n`
      msg += `*Subtotal productos:* $${(subtotal || 0).toLocaleString()}\n`
      if (hasKnownDeliveryFee) {
        msg += `*Domicilio (${selectedZone?.name}):* $${deliveryFee.toLocaleString()}\n`
        msg += `*Total estimado:* $${total.toLocaleString()}\n\n`
      } else {
        msg += `*Domicilio (${effectiveNeighborhood}):* A definir por el asesor\n`
        msg += `*Total:* $${subtotal.toLocaleString()} (+ Valor de domicilio por confirmar)\n\n`
      }
    }
    
    msg += `*Mis datos:*\nNombre: ${customerInfo.name}\nTeléfono: ${customerInfo.phone}\n`
    if (orderMode === 'DELIVERY') {
      msg += `Dirección: ${customerInfo.address}\nBarrio: ${effectiveNeighborhood}\n`
    } else {
      msg += `Entrega: Pasar a Recoger en Restaurante\n`
    }
    msg += `Pago: ${customerInfo.paymentMethod === 'CASH' ? 'Efectivo' : 'Transferencia'}\n`
    if (customerInfo.notes) msg += `\nNotas extra: ${customerInfo.notes}`
    return encodeURIComponent(msg)
  }

  const setFormErrorAndScroll = (msg: string) => {
    setFormError(msg)
    if (drawerRef.current) {
      drawerRef.current.scrollTop = 0
    }
  }

  const handleWhatsAppOrder = async () => {
    if (submitting) return
    setFormError('')
    const cleanPhone = customerInfo.phone.replace(/\D/g, '')

    if (normalizedSiteCode && !publicSiteIdentityReady) {
      setFormErrorAndScroll('No se pudo identificar esta sede. Recarga el menú e inténtalo de nuevo.')
      return
    }

    if (!customerInfo.name.trim()) {
      setFormErrorAndScroll("Por favor ingresa tu Nombre Completo.")
      return
    }
    if (cleanPhone.length !== 10 || !cleanPhone.startsWith('3')) {
      setFormErrorAndScroll("Ingresa un número de celular de 10 dígitos que empiece por 3 (Ej: 3001234567).")
      return
    }
    if (orderMode === 'DELIVERY') {
      if (!effectiveNeighborhood.trim()) {
        setFormErrorAndScroll("Por favor selecciona o escribe tu Barrio.")
        return
      }
      if (!customerInfo.address.trim()) {
        setFormErrorAndScroll("Por favor ingresa tu Dirección Exacta.")
        return
      }
    }

    setSubmitting(true)

    const orderItemsPayload = cart.flatMap(item => {
      let mainNotes = item.notes.trim()
      if (item.additions.length > 0) {
        const addNames = item.additions.map(a => a.name).join(', ')
        mainNotes = mainNotes ? `${mainNotes} (Con adición: ${addNames})` : `Con adición: ${addNames}`
      }

      const mainPayload = [{
        menuItemId: item.menuItem.id,
        quantity: item.quantity,
        price: item.menuItem.price || 0,
        notes: mainNotes || undefined
      }]

      const additionPayloads = item.additions.map(add => ({
        menuItemId: add.id,
        quantity: item.quantity,
        price: add.price || 0,
        notes: `Adición para: ${item.menuItem.name}`
      }))

      return [...mainPayload, ...additionPayloads]
    })

    const msg = generateWhatsAppMessage()
    setLastMessageText(msg)
    const targetPhone = restaurantPhone.replace(/\D/g, '')
    // Usar wa.me (formato oficial) para evitar que WhatsApp muestre "Invitar"
    const waUrl = `https://wa.me/${targetPhone}?text=${msg}`

    let orderNotes = customerInfo.notes
    if (orderMode === 'DELIVERY' && !hasKnownDeliveryFee) {
      orderNotes = orderNotes ? `${orderNotes} | [Domicilio por definir en barrio: ${effectiveNeighborhood}]` : `[Domicilio por definir en barrio: ${effectiveNeighborhood}]`
    } else if (orderMode === 'PICKUP') {
      orderNotes = orderNotes ? `${orderNotes} | [PASAR A RECOGER EN RESTAURANTE]` : `[PASAR A RECOGER EN RESTAURANTE]`
    }

    const signature = JSON.stringify({ customerInfo, orderMode, orderItemsPayload })
    const safeUUID = () => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        try { return crypto.randomUUID() } catch {}
      }
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        const v = c === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
      })
    }
    if (publicAttempt.current.signature !== signature) publicAttempt.current = { signature, id: safeUUID() }
    try {
    const res = await api.post<any>('/public-orders', {
      ...(normalizedSiteCode ? { siteCode: normalizedSiteCode } : {}),
      clientMutationId: publicAttempt.current.id,
      customerName: customerInfo.name,
      customerPhone: cleanPhone,
      customerAddress: orderMode === 'PICKUP' ? 'Recoger en restaurante' : customerInfo.address,
      address: orderMode === 'PICKUP' ? 'Recoger en restaurante' : customerInfo.address,
      neighborhood: orderMode === 'PICKUP' ? 'Recoger en restaurante' : effectiveNeighborhood,
      zoneName: orderMode === 'PICKUP' ? undefined : (hasKnownDeliveryFee ? selectedZone?.name : effectiveNeighborhood),
      orderType: orderMode === 'PICKUP' ? 'PICKUP' : 'DELIVERY',
      items: orderItemsPayload,
      total,
      deliveryFee: orderMode === 'PICKUP' ? 0 : deliveryFee,
      paymentMethod: customerInfo.paymentMethod,
      notes: orderNotes
    })
    if (!res?.order?.id) throw new Error('No se pudo confirmar el pedido. Intenta de nuevo.')
    setPlacedOrderInfo({ id: res.order.id, number: res.order.orderNumber, total: res.order.total })

    setOrderSuccess(true)
    try {
      localStorage.setItem(`niche_last_placed_cart:${publicStorageSuffix}`, JSON.stringify(cart))
    } catch (e) {}
    setCart([])
    localStorage.removeItem(cartStorageKey)

    // 2. Abrir WhatsApp de inmediato usando wa.me
    if (targetPhone) window.location.href = waUrl
    } catch (error: any) {
      setFormErrorAndScroll(error.message || 'No se pudo guardar el pedido. Tu carrito sigue disponible.')
    } finally { setSubmitting(false) }
  }

  if (loading) {
    return <div className="min-h-screen bg-neutral-900 flex items-center justify-center text-white font-bold text-lg">Cargando menú delicioso...</div>
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 pb-24 font-sans flex flex-col md:flex-row relative">
      
      {/* Admin Banner */}
      {isAdmin && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:bottom-4 z-50 bg-[var(--accent)] text-black p-3.5 rounded-2xl shadow-2xl flex items-center justify-between gap-4 border border-[var(--accent)]/50">
          <div>
            <p className="font-bold text-xs uppercase tracking-wider">Modo Vista Cliente</p>
            <p className="text-[11px] opacity-80">Así es cómo tus clientes ven y arman sus pedidos.</p>
          </div>
          <button onClick={() => window.location.href = '/dashboard/menu'} className="bg-black text-white px-3.5 py-1.5 rounded-xl text-xs font-bold hover:bg-neutral-800 transition whitespace-nowrap cursor-pointer">
            Editar Menú
          </button>
        </div>
      )}

      {/* Sticky Header Mobile */}
      <div className="md:hidden sticky top-0 z-40 bg-neutral-950/95 backdrop-blur-xl border-b border-neutral-800 p-3.5 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-2">
          <BrandLogo compact imageClassName="w-28 h-auto" />
        </div>
        
        <div className="flex items-center gap-2">
          {/* Vertical Categories Selector Toggle */}
          <button 
            onClick={() => setIsCategoryDrawerOpen(!isCategoryDrawerOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl text-xs font-bold border border-neutral-700 transition cursor-pointer"
          >
            <ListFilter className="w-4 h-4 text-[var(--accent)]" />
            <span>Categorías</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isCategoryDrawerOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Cart Button Mobile */}
          <button 
            onClick={() => setIsCartOpen(true)}
            className="relative p-2 bg-[var(--accent)] text-black rounded-xl hover:opacity-90 transition font-bold shadow-md shadow-[var(--accent)]/20 cursor-pointer"
          >
            <ShoppingCart className="w-5 h-5" />
            {cart.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-red-600 text-white text-[10px] font-black w-5 h-5 flex items-center justify-center rounded-full border-2 border-neutral-950">
                {cart.reduce((s, i) => s + i.quantity, 0)}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Vertical Categories Mobile Drawer Dropdown */}
      {isCategoryDrawerOpen && (
        <div className="md:hidden sticky top-[65px] z-30 bg-neutral-900 border-b border-neutral-800 p-3 shadow-2xl space-y-1.5 max-h-[60vh] overflow-y-auto animate-fade-in">
          <p className="text-[10px] uppercase tracking-wider font-extrabold text-neutral-400 px-2 pb-1">Selecciona una categoría (Vertical)</p>
          <div className="flex flex-col gap-1.5">
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => {
                  setActiveCategory(cat.id)
                  setIsCategoryDrawerOpen(false)
                  document.getElementById(`cat-${cat.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
                className={`w-full text-left px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-between cursor-pointer ${
                  activeCategory === cat.id 
                    ? 'bg-[var(--accent)] text-black shadow-md' 
                    : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'
                }`}
              >
                <span>{cat.name}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${activeCategory === cat.id ? 'bg-black/20 text-black font-extrabold' : 'bg-neutral-700 text-neutral-400'}`}>
                  {cat.items.filter(i => i.active).length} platos
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Desktop Sidebar (Vertical Layout) */}
      <div className="hidden md:flex sticky top-0 z-40 bg-neutral-950 border-r border-neutral-800/80 p-5 w-72 h-screen flex-col shrink-0">
        <div className="mb-6">
          <BrandLogo imageClassName="w-44 h-auto" />
          <p className="text-[11px] text-neutral-400 font-medium mt-2">El verdadero sabor costeño en Montería</p>
        </div>
        
        <p className="text-[10px] uppercase tracking-wider font-extrabold text-neutral-500 mb-2">Categorías del Menú</p>
        
        {/* Desktop Vertical Categories List */}
        <div className="flex flex-col gap-1.5 overflow-y-auto pr-1 flex-1 no-scrollbar">
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => {
                setActiveCategory(cat.id)
                document.getElementById(`cat-${cat.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              className={`w-full text-left px-4 py-3 rounded-xl text-xs font-bold transition flex items-center justify-between cursor-pointer ${
                activeCategory === cat.id 
                  ? 'bg-[var(--accent)] text-black shadow-lg shadow-[var(--accent)]/20 scale-[1.02]' 
                  : 'bg-neutral-900 text-neutral-300 hover:bg-neutral-800 border border-neutral-800/60'
              }`}
            >
              <span className="line-clamp-1">{cat.name}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${activeCategory === cat.id ? 'bg-black/20 text-black font-black' : 'bg-neutral-800 text-neutral-400'}`}>
                {cat.items.filter(i => i.active).length}
              </span>
            </button>
          ))}
        </div>

        {/* Cart Button Desktop */}
        <div className="mt-auto pt-4 border-t border-neutral-800">
          <button 
            onClick={() => setIsCartOpen(true)}
            className="w-full flex items-center justify-center gap-2 py-3 bg-[var(--accent)] text-black font-extrabold rounded-xl hover:opacity-90 transition shadow-lg shadow-[var(--accent)]/20 text-sm cursor-pointer"
          >
            <ShoppingCart className="w-4 h-4" /> 
            <span>Ver Mi Pedido ({cart.reduce((s, i) => s + i.quantity, 0)})</span>
          </button>
        </div>
      </div>

      {/* Main Content Areas */}
      <div className="flex-1 max-w-5xl mx-auto p-4 md:p-8 space-y-10">
        
        {/* Banner promocional & Opción de Modificar Pedido */}
        <div className="rounded-2xl p-6 bg-gradient-to-r from-neutral-900 via-neutral-800 to-neutral-900 border border-neutral-800 shadow-xl relative overflow-hidden space-y-3">
          <div className="relative z-10 max-w-lg">
            <span className="inline-block bg-[var(--accent)]/20 text-[var(--accent)] text-[10px] font-black uppercase px-2.5 py-1 rounded-full mb-2">Pide Online & Recibe en Domicilio</span>
            <h2 className="text-2xl font-black text-white tracking-tight">Arma tu pedido al instante</h2>
            <p className="text-xs text-neutral-400 mt-1">Selecciona tus platos favoritos, agrega las especificaciones que desees y envíalo directamente por WhatsApp.</p>
          </div>

          {/* Opción para Re-cargar y Modificar Pedido Anterior */}
          {(() => {
            try {
              const savedLastCart = localStorage.getItem(`niche_last_placed_cart:${publicStorageSuffix}`)
              if (savedLastCart) {
                const parsedLast = JSON.parse(savedLastCart)
                if (Array.isArray(parsedLast) && parsedLast.length > 0 && cart.length === 0) {
                  return (
                    <div className="pt-3 border-t border-neutral-800 flex flex-wrap items-center justify-between gap-3 animate-fade-in">
                      <div className="flex items-center gap-2 text-xs text-[var(--accent)] font-bold">
                        <Edit3 className="w-4 h-4" />
                        <span>¿Hiciste un pedido y deseas editarlo o agregar algo más?</span>
                      </div>
                      <button
                        onClick={() => {
                          setCart(parsedLast)
                          setIsCartOpen(true)
                        }}
                        className="bg-[var(--accent)] text-black px-3.5 py-1.5 rounded-xl text-xs font-extrabold hover:opacity-90 transition cursor-pointer shadow-md"
                      >
                        ✏️ Cargar y Modificar Mi Pedido ({parsedLast.length} productos)
                      </button>
                    </div>
                  )
                }
              }
            } catch (e) {}
            return null
          })()}
        </div>

        {/* Categorías y Platos */}
        {categories.map(cat => (
          <div key={cat.id} id={`cat-${cat.id}`} className="scroll-mt-24 md:scroll-mt-8 space-y-4">
            <div className="flex items-center gap-3 border-b border-neutral-800 pb-2">
              <h2 className="text-xl md:text-2xl font-black text-white uppercase tracking-wider">{cat.name}</h2>
              <span className="text-xs font-bold bg-neutral-800 text-neutral-400 px-2.5 py-0.5 rounded-full">
                {cat.items.filter(i => i.active).length}
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {cat.items.filter(i => i.active).map(item => (
                <div key={item.id} className="bg-neutral-900/80 border border-neutral-800/80 rounded-2xl p-4 md:p-5 flex flex-col justify-between hover:border-[var(--accent)]/50 transition shadow-md group">
                  <div>
                    {(item.type === 'COMBO' || item.name.toLowerCase().includes('combo') || cat.name.toLowerCase().includes('combo')) && (
                      <span className="inline-flex items-center gap-1 bg-amber-500/20 text-amber-400 border border-amber-500/40 text-[10px] font-black uppercase px-2 py-0.5 rounded-md mb-2">
                        🍱 Combo Especial
                      </span>
                    )}
                    <div className="flex justify-between items-start gap-3">
                      <h3 className="font-extrabold text-base md:text-lg text-white leading-tight">{item.name}</h3>
                      <span className="font-black text-[var(--accent)] text-sm md:text-base whitespace-nowrap bg-[var(--accent)]/10 px-2.5 py-1 rounded-lg">${(item.price || 0).toLocaleString()}</span>
                    </div>
                    {item.description && (
                      <p className="text-xs text-neutral-400 mt-2.5 line-clamp-3 leading-relaxed">{item.description}</p>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-neutral-800/60 flex items-center justify-between gap-3">
                    <button 
                      onClick={() => addToCart(item)}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-[var(--accent)] text-black font-extrabold rounded-xl text-xs hover:bg-[var(--accent)]/90 transition shadow-md shadow-[var(--accent)]/10 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" /> Agregar al Pedido
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Cart Drawer */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-neutral-950 h-[100dvh] shadow-2xl flex flex-col animate-slide-left border-l border-neutral-800">
            
            {/* Header Drawer */}
            <div className="flex justify-between items-center p-4 border-b border-neutral-800 bg-neutral-900/60">
              <div>
                <h2 className="text-lg font-black text-white">Mi Pedido The Villa Dog</h2>
                <p className="text-[11px] text-neutral-400">{cart.length} plato(s) en tu orden</p>
              </div>
              <button onClick={() => { setIsCartOpen(false); setIsCheckout(false); }} className="p-2 hover:bg-neutral-800 rounded-xl text-neutral-400 hover:text-white transition cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Body Drawer */}
            <div ref={drawerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
              {orderSuccess ? (
                <div className="flex flex-col items-center justify-center h-full text-center space-y-5 p-4">
                  <div className="w-20 h-20 bg-green-500/20 border-2 border-green-500 rounded-full flex items-center justify-center animate-bounce">
                    <Check className="w-10 h-10 text-green-400" />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-white">¡Pedido Enviado a WhatsApp!</h3>
                    {placedOrderInfo?.number && (
                      <p className="text-sm font-bold text-[var(--accent)] mt-1">Orden #{placedOrderInfo.number}</p>
                    )}
                    <p className="text-xs text-neutral-400 mt-2 max-w-xs leading-relaxed">
                      Tu pedido se ha registrado en nuestra cocina y se ha enviado a WhatsApp.
                    </p>
                  </div>

                  <div className="w-full space-y-3 pt-4">
                    <a 
                      href={`https://wa.me/${restaurantPhone.replace(/\D/g, '')}?text=${lastMessageText}`}
                      target="_top"
                      className="w-full py-3.5 bg-[#25D366] text-white font-extrabold rounded-xl flex items-center justify-center gap-2 hover:bg-[#128C7E] transition shadow-lg shadow-[#25D366]/20 text-sm"
                    >
                      <MessageSquare className="w-5 h-5" /> Abrir WhatsApp con mi Pedido
                    </a>

                    <button 
                      onClick={() => { setOrderSuccess(false); setIsCheckout(false); setIsCartOpen(false); }} 
                      className="w-full py-2.5 bg-neutral-800 text-neutral-300 font-bold rounded-xl text-xs hover:bg-neutral-700 transition cursor-pointer"
                    >
                      Volver al Menú
                    </button>
                  </div>
                </div>
              ) : cart.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-neutral-500 space-y-3">
                  <ShoppingCart className="w-16 h-16 opacity-30 text-neutral-400" />
                  <p className="font-bold text-sm">Tu carrito está vacío</p>
                  <p className="text-xs text-neutral-600 text-center max-w-xs">Explora el menú y presiona + Agregar en los platos que se te antojen.</p>
                </div>
              ) : !isCheckout ? (
                /* Lista de ítems en carrito */
                <div className="space-y-4">
                  <p className="text-xs font-bold text-neutral-400 uppercase tracking-wider">Productos Seleccionados</p>
                  
                  {cart.map((item) => {
                    const isAdditionsOpen = !!expandedAdditions[item.lineId]
                    const itemUnitPrice = (item.menuItem?.price || 0) + item.additions.reduce((s, a) => s + (a.price || 0), 0)
                    return (
                      <div key={item.lineId} className="bg-neutral-900 border border-neutral-800 p-4 rounded-2xl space-y-3">
                        <div className="flex justify-between items-start gap-3">
                          <div className="flex-1">
                            <h4 className="font-extrabold text-sm text-white">{item.menuItem?.name || 'Producto'}</h4>
                            <span className="text-xs font-bold text-[var(--accent)]">
                              ${itemUnitPrice.toLocaleString()} c/u
                            </span>
                          </div>

                          {/* Control de Cantidad */}
                          <div className="flex items-center gap-2 bg-neutral-800 border border-neutral-700/80 rounded-xl p-1">
                            <button onClick={() => updateQuantity(item.lineId, -1)} className="p-1 hover:bg-neutral-700 text-neutral-300 rounded-lg cursor-pointer">
                              <Minus className="w-3.5 h-3.5"/>
                            </button>
                            <span className="w-4 text-center font-extrabold text-xs text-white">{item.quantity}</span>
                            <button onClick={() => updateQuantity(item.lineId, 1)} className="p-1 hover:bg-neutral-700 text-neutral-300 rounded-lg cursor-pointer">
                              <Plus className="w-3.5 h-3.5"/>
                            </button>
                          </div>
                        </div>

                        {/* Especificación / Modificación de plato (Ej: Sin cebolla) */}
                        <div>
                          <label className="flex items-center gap-1 text-[11px] font-bold text-neutral-400 mb-1">
                            <Edit3 className="w-3 h-3 text-[var(--accent)]" />
                            <span>Modificaciones (Ej: Sin cebolla, salsas por aparte):</span>
                          </label>
                          <input 
                            type="text" 
                            value={item.notes} 
                            onChange={e => updateItemNotes(item.lineId, e.target.value)}
                            placeholder="Ej: Sin cebolla, término medio..."
                            className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-1.5 text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-[var(--accent)]"
                          />
                        </div>

                        {/* Adicionales (Plegable / Colapsable por defecto) */}
                        {availableAdditions.length > 0 && (
                          <div className="pt-2 border-t border-neutral-800/60">
                            <button
                              type="button"
                              onClick={() => toggleAdditionsAccordion(item.lineId)}
                              className="text-[11px] font-extrabold text-[var(--accent)] hover:underline flex items-center gap-1 cursor-pointer py-1"
                            >
                              <PlusCircle className="w-3.5 h-3.5" />
                              <span>{isAdditionsOpen ? 'Ocultar Adicionales' : `+ Agregar Adicionales (${item.additions.length > 0 ? item.additions.length + ' elegidos' : 'Opcional'})`}</span>
                              <ChevronDown className={`w-3 h-3 transition-transform ${isAdditionsOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {/* Mostrar selecciones actuales si la lista está oculta */}
                            {!isAdditionsOpen && item.additions.length > 0 && (
                              <div className="mt-1 text-[10px] text-neutral-400 flex flex-wrap gap-1">
                                <span className="font-bold text-neutral-300">Con:</span>
                                {item.additions.map(a => (
                                  <span key={a.id} className="bg-neutral-800 px-2 py-0.5 rounded text-neutral-300">
                                    {a.name} (+${(a.price || 0).toLocaleString()})
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* Lista desplegable de adicionales */}
                            {isAdditionsOpen && (
                              <div className="flex flex-wrap gap-1.5 mt-2 animate-fade-in bg-neutral-950 p-2.5 rounded-xl border border-neutral-850">
                                {availableAdditions.map(add => {
                                  const isAdded = item.additions.some(a => a.id === add.id)
                                  return (
                                    <button
                                      key={add.id}
                                      type="button"
                                      onClick={() => toggleItemAddition(item.lineId, add)}
                                      className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition flex items-center gap-1 cursor-pointer ${
                                        isAdded
                                          ? 'bg-[var(--accent)] text-black border-[var(--accent)] shadow-sm'
                                          : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-white'
                                      }`}
                                    >
                                      <span>{isAdded ? '✓' : '+'} {add.name}</span>
                                      <span className="opacity-80">(+${(add.price || 0).toLocaleString()})</span>
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  <div className="border-t border-neutral-800 pt-4 space-y-2">
                    <div className="flex justify-between text-sm font-bold text-neutral-400">
                      <span>Subtotal</span>
                      <span className="text-white">${(subtotal || 0).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              ) : (
                /* Formulario de Checkout y Datos de Entrega */
                <div className="space-y-4 animate-fade-in pb-8">
                  <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                    <h3 className="font-extrabold text-base text-white">Datos de Entrega</h3>
                    <button onClick={() => setIsCheckout(false)} className="text-xs text-[var(--accent)] font-bold hover:underline cursor-pointer">
                      ← Volver al Carrito
                    </button>
                  </div>

                  {formError && (
                    <div className="bg-red-500/20 border border-red-500/80 text-red-300 p-3 rounded-xl text-xs font-bold">
                      {formError}
                    </div>
                  )}

                  {/* Selector de Modo de Entrega: Domicilio vs Pasar a Recoger */}
                  <div>
                    <label className="block text-xs font-bold text-neutral-300 mb-1.5">¿Cómo deseas recibir tu pedido?</label>
                    <div className="flex bg-neutral-900 p-1.5 rounded-2xl border border-neutral-800 gap-1.5">
                      <button
                        type="button"
                        onClick={() => setOrderMode('DELIVERY')}
                        className={`flex-1 py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition cursor-pointer ${
                          orderMode === 'DELIVERY'
                            ? 'bg-[var(--accent)] text-black shadow-md'
                            : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        <Bike className="w-4 h-4" /> Domicilio
                      </button>
                      <button
                        type="button"
                        onClick={() => setOrderMode('PICKUP')}
                        className={`flex-1 py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition cursor-pointer ${
                          orderMode === 'PICKUP'
                            ? 'bg-[var(--accent)] text-black shadow-md'
                            : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        <Store className="w-4 h-4" /> Pasar a Recoger
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-neutral-300 mb-1">Nombre Completo *</label>
                    <input 
                      type="text" 
                      value={customerInfo.name} 
                      onChange={e => setCustomerInfo({...customerInfo, name: e.target.value})} 
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-[var(--accent)] font-medium" 
                      placeholder="Ej: Don José" 
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-neutral-300 mb-1">Número Celular * (10 dígitos)</label>
                    <input 
                      type="tel" 
                      maxLength={10}
                      value={customerInfo.phone} 
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 10)
                        setCustomerInfo({...customerInfo, phone: val})
                      }} 
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-[var(--accent)] font-medium" 
                      placeholder="Ej: 3001234567" 
                    />
                  </div>

                  {orderMode === 'DELIVERY' && (
                    <>
                      <div>
                        <label className="block text-xs font-bold text-neutral-300 mb-1">Barrio *</label>
                        <select 
                          value={customerInfo.neighborhood} 
                          onChange={e => setCustomerInfo({...customerInfo, neighborhood: e.target.value})} 
                          className="w-full bg-neutral-900 border border-neutral-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-[var(--accent)] font-medium"
                        >
                          <option value="">Selecciona tu barrio en Montería...</option>
                          {zones.map(z => {
                            const r = getZoneRate(z)
                            return (
                              <option key={z.id} value={z.name}>
                                {z.name} (+${r.toLocaleString()})
                              </option>
                            )
                          })}
                          <option value="OTRO">Otro Barrio (Escribir nombre abajo...)</option>
                        </select>

                        {/* Si seleccionó "OTRO", permitir escribir el nombre del barrio manualmente */}
                        {(customerInfo.neighborhood === 'OTRO' || (customerInfo.neighborhood && !zones.some(z => z.name === customerInfo.neighborhood))) && (
                          <div className="mt-2.5 animate-fade-in">
                            <label className="block text-xs font-bold text-[var(--accent)] mb-1">Escribe el nombre de tu Barrio *</label>
                            <input 
                              type="text" 
                              value={customNeighborhood} 
                              onChange={e => setCustomNeighborhood(e.target.value)} 
                              className="w-full bg-neutral-950 border border-[var(--accent)]/70 rounded-xl p-3 text-xs text-white focus:outline-none font-medium" 
                              placeholder="Ej: La Granja, Cantaclaro, etc." 
                            />
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-neutral-300 mb-1">Dirección Exacta *</label>
                        <input 
                          type="text" 
                          value={customerInfo.address} 
                          onChange={e => setCustomerInfo({...customerInfo, address: e.target.value})} 
                          className="w-full bg-neutral-900 border border-neutral-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-[var(--accent)] font-medium" 
                          placeholder="Ej: Calle 35 # 15-51, Apto 201" 
                        />
                      </div>
                    </>
                  )}

                  {orderMode === 'PICKUP' && (
                    <div className="bg-neutral-900 border border-neutral-800 p-3.5 rounded-xl text-xs text-neutral-300 flex items-start gap-2.5">
                      <Store className="w-5 h-5 text-[var(--accent)] shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-white mb-0.5">Retiro en Restaurante (Sin costo de domicilio)</p>
                        <p className="text-[11px] text-neutral-400">Te notificaremos cuando tu pedido esté listo para que pases a recogerlo.</p>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-neutral-300 mb-1">Método de Pago *</label>
                    <select 
                      value={customerInfo.paymentMethod} 
                      onChange={e => setCustomerInfo({...customerInfo, paymentMethod: e.target.value})} 
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-[var(--accent)] font-medium"
                    >
                      <option value="CASH">Efectivo</option>
                      <option value="TRANSFER">Transferencia</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-neutral-300 mb-1">Notas Generales (Opcional)</label>
                    <textarea 
                      value={customerInfo.notes} 
                      onChange={e => setCustomerInfo({...customerInfo, notes: e.target.value})} 
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-[var(--accent)] resize-none h-20 font-medium" 
                      placeholder="Pagaré con billete de 50.000, timbre no funciona, etc." 
                    />
                  </div>

                  <div className="bg-neutral-900 border border-neutral-800 p-4 rounded-2xl mt-4 space-y-2">
                    <div className="flex justify-between text-xs text-neutral-400">
                      <span>Subtotal Platos + Adiciones</span>
                      <span>${(subtotal || 0).toLocaleString()}</span>
                    </div>

                    <div className="flex justify-between text-xs text-neutral-400">
                      <span>Valor Domicilio</span>
                      {orderMode === 'PICKUP' ? (
                        <span className="text-green-400 font-bold">$0 (Pasar a Recoger)</span>
                      ) : hasKnownDeliveryFee ? (
                        <span>${deliveryFee.toLocaleString()}</span>
                      ) : (
                        <span className="text-[var(--accent)] font-bold">Por definir por el asesor</span>
                      )}
                    </div>

                    <div className="flex justify-between text-base font-black text-white border-t border-neutral-800 pt-2.5">
                      <span>TOTAL DEL PEDIDO</span>
                      {orderMode === 'PICKUP' ? (
                        <span className="text-[var(--accent)]">${subtotal.toLocaleString()}</span>
                      ) : hasKnownDeliveryFee ? (
                        <span className="text-[var(--accent)]">${(total || 0).toLocaleString()}</span>
                      ) : (
                        <span className="text-[var(--accent)]">${subtotal.toLocaleString()} <span className="text-xs font-normal text-neutral-400">(+ Domicilio a coordinar)</span></span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            {!orderSuccess && cart.length > 0 && (
              <div className="p-4 border-t border-neutral-800 bg-neutral-950">
                {!isCheckout ? (
                  <button 
                    onClick={() => setIsCheckout(true)} 
                    className="w-full py-3.5 bg-[var(--accent)] text-black font-extrabold rounded-xl text-sm hover:opacity-90 transition shadow-lg shadow-[var(--accent)]/20 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>Continuar a Datos de Envío (${(subtotal || 0).toLocaleString()})</span>
                  </button>
                ) : (
                  <button 
                    onClick={handleWhatsAppOrder} 
                    disabled={submitting} 
                    className="w-full py-3.5 bg-[#25D366] text-white font-extrabold rounded-xl text-sm flex items-center justify-center gap-2 hover:bg-[#128C7E] transition shadow-lg shadow-[#25D366]/20 disabled:opacity-50 cursor-pointer"
                  >
                    <Send className="w-4 h-4"/> 
                    <span>{submitting ? 'Enviando a WhatsApp...' : 'Enviar Pedido por WhatsApp'}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideLeft {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-left {
          animation: slideLeft 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fadeIn 0.25s ease-out forwards;
        }
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  )
}
