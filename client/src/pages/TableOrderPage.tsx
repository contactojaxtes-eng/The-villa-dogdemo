import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronRight,
  Layers,
  Minus,
  Plus,
  Save,
  Scissors,
  Search,
  Send,
  Trash2,
  User,
  UtensilsCrossed,
  WifiOff,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { formatCurrency } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { deleteOfflineOrder, listOfflineOrders, saveOfflineOrder, type OfflineTableOrder } from '@/lib/offlineTableOrders'
import { getErrorMessage, type DiningOrderSummary, type OfflineTableOrderPayload } from '@/lib/tableTypes'

type MenuItem = { id: string; name: string; price: number; category?: { name: string } }
type Category = { id: string; name: string; items: MenuItem[] }

type CartAddition = {
  id: string
  name: string
  price: number
}

type CartItem = {
  cartKey: string
  menuItemId: string
  name: string
  price: number
  quantity: number
  notes?: string
  takeaway: boolean
  additions?: CartAddition[]
}

const QUICK_CHIPS = ['Sin cebolla', 'Sin ripio', 'Sin piña', 'Sin salsas', 'Sin queso', 'Bien caliente']

function genKey(prefix = 'item'): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function isFoodWithAdditions(item: { name: string; category?: { name: string } }): boolean {
  const cat = (item.category?.name || '').toLowerCase()
  const name = item.name.toLowerCase()
  // No permitir adiciones en bebidas, jugos, agua ni en las adiciones mismas
  if (
    cat.includes('bebida') ||
    cat.includes('gaseosa') ||
    cat.includes('jugo') ||
    cat.includes('agua') ||
    cat.includes('adicion') ||
    cat.includes('adicional') ||
    name.includes('gaseosa') ||
    name.includes('hit ') ||
    name.includes('agua ') ||
    name.includes('coca') ||
    name.includes('postobon') ||
    name.startsWith('adición') ||
    name.startsWith('adicion')
  ) {
    return false
  }
  return true
}

export default function TableOrderPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [params] = useSearchParams()
  const existingTableId = params.get('tableId') || ''
  const editOrderId = params.get('editOrderId') || ''
  const [categories, setCategories] = useState<Category[]>(() => {
    try {
      const cached = localStorage.getItem('the_villa_dog_cached_menu')
      return cached ? JSON.parse(cached) : []
    } catch {
      return []
    }
  })
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL')
  const [tableLabel, setTableLabel] = useState('')
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<OfflineTableOrder[]>([])
  const [online, setOnline] = useState(navigator.onLine)
  const [saving, setSaving] = useState(false)
  const [editOrderNumber, setEditOrderNumber] = useState<number | null>(null)
  const submission = useRef({ signature: '', id: '' })
  const [showMobileCart, setShowMobileCart] = useState(false)

  const loadPending = useCallback(() => listOfflineOrders().then(setPending).catch(() => setPending([])), [])

  useEffect(() => {
    api.get<Category[]>('/menu/categories').then(data => {
      setCategories(data)
      try {
        localStorage.setItem('the_villa_dog_cached_menu', JSON.stringify(data))
      } catch (e) {
        console.warn('No se pudo guardar menú en caché local', e)
      }
    }).catch(console.error)
    loadPending()
    if (existingTableId) {
      api.get<{ label: string }>(`/tables/${existingTableId}`).then(table => {
        if (table?.label) setTableLabel(table.label)
      }).catch(console.error)
    }
    if (editOrderId) {
      api.get<DiningOrderSummary>(`/orders/${editOrderId}`).then(order => {
        if (order.orderNumber) setEditOrderNumber(order.orderNumber)
        if (order.diningTable?.label) {
          setTableLabel(order.diningTable.label)
        } else if (order.customerName) {
          setTableLabel(order.customerName)
        }
        setNotes(order.notes || '')
        setCart((order.items || []).map((item, idx) => {
          const rawNotes = item.notes || ''
          const isTakeaway = rawNotes.toLowerCase().includes('para llevar') || rawNotes.toLowerCase().includes('llevar')
          const cleanNotes = rawNotes.replace(/\[PARA LLEVAR\]/gi, '').replace(/\[MESA\]/gi, '').trim()
          return {
            cartKey: genKey(`edit_${item.menuItemId}_${idx}`),
            menuItemId: item.menuItemId,
            name: item.menuItem?.name || item.nameSnapshot || 'Producto',
            price: item.unitPrice || item.menuItem?.price || 0,
            quantity: item.quantity,
            notes: cleanNotes,
            takeaway: isTakeaway,
            additions: [],
          }
        }))
      }).catch(console.error)
    }
  }, [editOrderId, existingTableId, loadPending])

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine)
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    return () => {
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
    }
  }, [])

  const syncPending = useCallback(async () => {
    const rows = await listOfflineOrders()
    for (const row of rows) {
      try {
        if (row.payload.editOrderId) {
          await api.put(`/tables/orders/${row.payload.editOrderId}`, { ...row.payload, offline: true })
        } else {
          await api.post('/tables/orders', { ...row.payload, offline: true })
        }
        await deleteOfflineOrder(row.clientMutationId)
      } catch (err: unknown) {
        await saveOfflineOrder({ ...row, status: 'FAILED', error: getErrorMessage(err, 'No se pudo sincronizar') })
        break
      }
    }
    await loadPending()
  }, [loadPending])

  useEffect(() => {
    if (online) syncPending().catch(() => undefined)
  }, [online, syncPending])

  const availableAdditions = useMemo(() => {
    return categories
      .flatMap(c => c.items.map(i => ({ ...i, categoryName: c.name })))
      .filter(i => {
        const cat = (i.categoryName || '').toLowerCase()
        const name = i.name.toLowerCase()
        return cat.includes('adicion') || cat.includes('adicional') || name.startsWith('adición') || name.startsWith('adicion')
      })
  }, [categories])

  const quesoAddition = useMemo(() => {
    return availableAdditions.find(a => a.name.toLowerCase().includes('queso'))
  }, [availableAdditions])

  const tocinetaAddition = useMemo(() => {
    return availableAdditions.find(a => a.name.toLowerCase().includes('tocineta'))
  }, [availableAdditions])

  const items = useMemo(() => {
    const q = search.trim().toLowerCase()
    return categories
      .filter(c => selectedCategory === 'ALL' || c.id === selectedCategory)
      .flatMap(c => c.items.map(i => ({ ...i, category: { name: c.name } })))
      .filter(i => !q || `${i.name} ${i.category?.name || ''}`.toLowerCase().includes(q))
  }, [categories, search, selectedCategory])

  const getItemUnitPrice = (item: CartItem) => {
    const addTotal = (item.additions || []).reduce((s, a) => s + a.price, 0)
    return item.price + addTotal
  }

  const getItemLineTotal = (item: CartItem) => {
    return getItemUnitPrice(item) * item.quantity
  }

  const total = useMemo(() => cart.reduce((sum, item) => sum + getItemLineTotal(item), 0), [cart])
  const totalCount = useMemo(() => cart.reduce((s, i) => s + i.quantity, 0), [cart])
  const dineInCount = useMemo(() => cart.filter(i => !i.takeaway).reduce((s, i) => s + i.quantity, 0), [cart])
  const takeawayCount = useMemo(() => cart.filter(i => i.takeaway).reduce((s, i) => s + i.quantity, 0), [cart])

  // Contadores por producto en el menú
  const inCartCounts = useMemo(() => {
    const map = new Map<string, { total: number; dineIn: number; takeaway: number }>()
    for (const item of cart) {
      const current = map.get(item.menuItemId) || { total: 0, dineIn: 0, takeaway: 0 }
      current.total += item.quantity
      if (item.takeaway) {
        current.takeaway += item.quantity
      } else {
        current.dineIn += item.quantity
      }
      map.set(item.menuItemId, current)
    }
    return map
  }, [cart])

  // Agregar producto normal
  const addItem = (item: MenuItem, isTakeaway = false) => {
    setCart(prev => {
      // Buscar si ya existe una línea exactamente idéntica (sin adiciones, mismo modo, sin notas especiales)
      const existing = prev.find(
        i => i.menuItemId === item.id && i.takeaway === isTakeaway && !(i.notes || '').trim() && (!i.additions || i.additions.length === 0)
      )
      if (existing) {
        return prev.map(i => (i.cartKey === existing.cartKey ? { ...i, quantity: i.quantity + 1 } : i))
      }
      return [
        ...prev,
        {
          cartKey: genKey(item.id),
          menuItemId: item.id,
          name: item.name,
          price: item.price,
          quantity: 1,
          takeaway: isTakeaway,
          notes: '',
          additions: [],
        },
      ]
    })
    alerts.toast(`+1 ${item.name} (${isTakeaway ? 'Llevar' : 'Mesa'})`)
  }

  // Agregar producto directamente con una adición desde el menú
  const addItemWithAddition = (item: MenuItem, addition: CartAddition) => {
    setCart(prev => {
      // Buscar si ya existe una línea con exactamente esta adición
      const existing = prev.find(
        i =>
          i.menuItemId === item.id &&
          !i.takeaway &&
          !(i.notes || '').trim() &&
          (i.additions || []).length === 1 &&
          i.additions![0].id === addition.id
      )
      if (existing) {
        return prev.map(i => (i.cartKey === existing.cartKey ? { ...i, quantity: i.quantity + 1 } : i))
      }
      return [
        ...prev,
        {
          cartKey: genKey(`${item.id}_${addition.id}`),
          menuItemId: item.id,
          name: item.name,
          price: item.price,
          quantity: 1,
          takeaway: false,
          notes: '',
          additions: [addition],
        },
      ]
    })
    alerts.toast(`+1 ${item.name} con ${addition.name}`)
  }

  // Restar en tarjeta de producto
  const handleMenuCardDecrement = (menuItemId: string) => {
    setCart(prev => {
      const line = [...prev].reverse().find(i => i.menuItemId === menuItemId)
      if (!line) return prev
      if (line.quantity > 1) {
        return prev.map(i => (i.cartKey === line.cartKey ? { ...i, quantity: i.quantity - 1 } : i))
      }
      return prev.filter(i => i.cartKey !== line.cartKey)
    })
  }

  // Modificar cantidad en la cuenta
  const updateQty = (cartKey: string, delta: number) => {
    setCart(prev =>
      prev
        .map(i => (i.cartKey === cartKey ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i))
        .filter(i => i.quantity > 0)
    )
  }

  // Eliminar ítem completo
  const removeItem = (cartKey: string) => {
    setCart(prev => prev.filter(i => i.cartKey !== cartKey))
  }

  // Separar todas las unidades en líneas individuales
  const splitItem = (cartKey: string) => {
    setCart(prev => {
      const idx = prev.findIndex(p => p.cartKey === cartKey)
      if (idx === -1) return prev
      const item = prev[idx]
      if (item.quantity <= 1) return prev

      const splitLines: CartItem[] = Array.from({ length: item.quantity }, (_, i) => ({
        cartKey: genKey(`${item.menuItemId}_split_${i}`),
        menuItemId: item.menuItemId,
        name: item.name,
        price: item.price,
        quantity: 1,
        takeaway: item.takeaway,
        notes: item.notes || '',
        additions: item.additions ? [...item.additions] : [],
      }))

      const copy = [...prev]
      copy.splice(idx, 1, ...splitLines)
      return copy
    })
    alerts.toast('Separado en unidades individuales.')
  }

  // Mover 1 unidad de esta línea al modo opuesto (Mesa <-> Llevar)
  const moveOneTakeaway = (cartKey: string, targetTakeaway: boolean) => {
    setCart(prev => {
      const idx = prev.findIndex(p => p.cartKey === cartKey)
      if (idx === -1) return prev
      const item = prev[idx]

      if (item.quantity === 1) {
        const copy = [...prev]
        copy[idx] = { ...item, takeaway: targetTakeaway }
        return copy
      }

      // Si tiene más de 1, restamos 1 y creamos una línea individual
      const copy = [...prev]
      copy[idx] = { ...item, quantity: item.quantity - 1 }
      copy.push({
        cartKey: genKey(`${item.menuItemId}_moved`),
        menuItemId: item.menuItemId,
        name: item.name,
        price: item.price,
        quantity: 1,
        takeaway: targetTakeaway,
        notes: item.notes || '',
        additions: item.additions ? [...item.additions] : [],
      })
      return copy
    })
  }

  // Cambiar todas las unidades de una línea a Mesa o Llevar
  const toggleAllTakeaway = (cartKey: string, targetTakeaway: boolean) => {
    setCart(prev => prev.map(i => (i.cartKey === cartKey ? { ...i, takeaway: targetTakeaway } : i)))
  }

  // Actualizar nota de una línea en borrador local (sin mover el cursor)
  const updateNotes = (cartKey: string, value: string) => {
    setDraftNotes(prev => ({ ...prev, [cartKey]: value }))
  }

  // Confirmar y aplicar nota inteligente (separa automáticamente cantidades si se escribe ej: "2 sin cebolla")
  const commitLineNote = (cartKey: string, rawInput?: string) => {
    const value = rawInput !== undefined ? rawInput : (draftNotes[cartKey] ?? '')
    const trimmed = value.trim()

    setDraftNotes(prev => {
      const copy = { ...prev }
      delete copy[cartKey]
      return copy
    })

    setCart(prev => {
      const lineIndex = prev.findIndex(i => i.cartKey === cartKey)
      if (lineIndex === -1) return prev
      const target = prev[lineIndex]

      if (!trimmed) {
        return prev.map(i => (i.cartKey === cartKey ? { ...i, notes: '' } : i))
      }

      if (target.quantity > 1) {
        let noteQty = 1
        let cleanNote = trimmed

        const qtyMatch = trimmed.match(/^(\d+)\s*(?:x\s*)?(.*?)(?:\s*(?:y|,|;|-)\s*(\d+)?\s*(?:normal.*)?)?$/i)
        const isAll = /^(todas?|todos|todo)\b/i.test(trimmed)

        if (isAll) {
          noteQty = target.quantity
          cleanNote = trimmed.replace(/^(todas?|todos|todo)\s*(?:con|de|:)?\s*/i, '').trim()
        } else if (qtyMatch && qtyMatch[1]) {
          const parsedQty = parseInt(qtyMatch[1], 10)
          if (parsedQty > 0) {
            noteQty = Math.min(parsedQty, target.quantity)
            cleanNote = (qtyMatch[2] || '').trim()
            if (!cleanNote) cleanNote = trimmed
          }
        }

        if (noteQty >= target.quantity) {
          return prev.map(i => (i.cartKey === cartKey ? { ...i, notes: cleanNote } : i))
        }

        // Separar: target.quantity - noteQty (sin nota) y noteQty (con nota)
        const remainingQty = target.quantity - noteQty
        const newKey = genKey(`${target.menuItemId}_noted`)

        const updatedOriginal: CartItem = {
          ...target,
          quantity: remainingQty,
          notes: '',
        }

        const newNotedLine: CartItem = {
          ...target,
          cartKey: newKey,
          quantity: noteQty,
          notes: cleanNote,
          additions: target.additions ? [...target.additions] : [],
        }

        alerts.toast(`Se separaron ${noteQty} con nota "${cleanNote}" y ${remainingQty} sin nota.`)

        const copy = [...prev]
        copy[lineIndex] = updatedOriginal
        copy.push(newNotedLine)
        return copy
      }

      // Si tiene 1 unidad
      return prev.map(i => (i.cartKey === cartKey ? { ...i, notes: trimmed } : i))
    })
  }

  // Agregar chip rápido: SI TIENE > 1 UNIDAD, SEPARA AUTOMÁTICAMENTE 1 UNIDAD CON ESA NOTA
  const appendNote = (cartKey: string, chipText: string) => {
    setDraftNotes(prev => {
      const copy = { ...prev }
      delete copy[cartKey]
      return copy
    })
    setCart(prev => {
      const target = prev.find(i => i.cartKey === cartKey)
      if (!target) return prev

      if (target.quantity > 1) {
        // Separar automáticamente 1 unidad con esta nota
        const remaining = { ...target, quantity: target.quantity - 1 }
        const singleUnit: CartItem = {
          ...target,
          cartKey: genKey(`${target.menuItemId}_note`),
          quantity: 1,
          notes: chipText,
          additions: target.additions ? [...target.additions] : [],
        }
        alerts.toast(`Se separó 1 ${target.name} con nota "${chipText}"`)
        return prev.map(i => (i.cartKey === cartKey ? remaining : i)).concat(singleUnit)
      }

      // Si tiene 1 unidad, agregar a la nota actual
      const current = target.notes ? target.notes.trim() : ''
      if (current.toLowerCase().includes(chipText.toLowerCase())) return prev
      const newNotes = current ? `${current}, ${chipText}` : chipText
      return prev.map(i => (i.cartKey === cartKey ? { ...i, notes: newNotes } : i))
    })
  }

  // Aplicar o incrementar una nota directamente en un producto sin modal ni redirección
  const applyNoteToProduct = (menuItemId: string, noteText: string, isTakeaway = false) => {
    setCart(prev => {
      // 1. Buscar si ya existe una línea con esta misma nota
      const existingNoteLine = prev.find(
        i => i.menuItemId === menuItemId && 
             (i.notes || '').trim().toLowerCase() === noteText.trim().toLowerCase() && 
             i.takeaway === isTakeaway &&
             (!i.additions || i.additions.length === 0)
      )

      // 2. Buscar si hay una línea base (sin notas) de la cual tomar 1 unidad
      const baseLine = prev.find(
        i => i.menuItemId === menuItemId && 
             !(i.notes || '').trim() && 
             i.takeaway === isTakeaway &&
             (!i.additions || i.additions.length === 0)
      )

      if (baseLine && baseLine.quantity > 0) {
        const updated = prev.map(item => {
          if (item.cartKey === baseLine.cartKey) {
            return { ...item, quantity: item.quantity - 1 }
          }
          if (existingNoteLine && item.cartKey === existingNoteLine.cartKey) {
            return { ...item, quantity: item.quantity + 1 }
          }
          return item
        }).filter(item => item.quantity > 0)

        if (!existingNoteLine) {
          updated.push({
            cartKey: genKey(`${menuItemId}_note`),
            menuItemId,
            name: baseLine.name,
            price: baseLine.price,
            quantity: 1,
            takeaway: isTakeaway,
            notes: noteText,
            additions: [],
          })
        }
        return updated
      }

      // Si no hay línea base, pero ya existe la línea con esta nota, sumar 1 más
      if (existingNoteLine) {
        return prev.map(i => i.cartKey === existingNoteLine.cartKey ? { ...i, quantity: i.quantity + 1 } : i)
      }

      // Si el producto no estaba en carrito o todas las líneas ya tienen otras notas, agregar 1 nuevo con esta nota
      const menuItem = categories.flatMap(c => c.items).find(i => i.id === menuItemId)
      if (menuItem) {
        return [
          ...prev,
          {
            cartKey: genKey(`${menuItemId}_note`),
            menuItemId: menuItem.id,
            name: menuItem.name,
            price: menuItem.price,
            quantity: 1,
            takeaway: isTakeaway,
            notes: noteText,
            additions: [],
          },
        ]
      }
      return prev
    })

    alerts.toast(`1 con "${noteText}"`)
  }

  // Reducir o devolver 1 unidad con nota a la línea base
  const decrementNoteLine = (cartKey: string) => {
    setCart(prev => {
      const line = prev.find(i => i.cartKey === cartKey)
      if (!line) return prev

      const baseLine = prev.find(
        i => i.menuItemId === line.menuItemId && 
             !(i.notes || '').trim() && 
             i.takeaway === line.takeaway &&
             (!i.additions || i.additions.length === 0)
      )

      let updated = prev.map(item => {
        if (item.cartKey === cartKey) {
          return { ...item, quantity: item.quantity - 1 }
        }
        if (baseLine && item.cartKey === baseLine.cartKey) {
          return { ...item, quantity: item.quantity + 1 }
        }
        return item
      }).filter(item => item.quantity > 0)

      if (!baseLine) {
        updated.push({
          cartKey: genKey(line.menuItemId),
          menuItemId: line.menuItemId,
          name: line.name,
          price: line.price,
          quantity: 1,
          takeaway: line.takeaway,
          notes: '',
          additions: [],
        })
      }
      return updated
    })
  }

  // Incrementar 1 unidad con nota específica
  const incrementNoteLine = (cartKey: string) => {
    setCart(prev => {
      const line = prev.find(i => i.cartKey === cartKey)
      if (!line) return prev

      const baseLine = prev.find(
        i => i.menuItemId === line.menuItemId && 
             !(i.notes || '').trim() && 
             i.takeaway === line.takeaway &&
             (!i.additions || i.additions.length === 0)
      )

      if (baseLine && baseLine.quantity > 0) {
        return prev.map(item => {
          if (item.cartKey === baseLine.cartKey) {
            return { ...item, quantity: item.quantity - 1 }
          }
          if (item.cartKey === cartKey) {
            return { ...item, quantity: item.quantity + 1 }
          }
          return item
        }).filter(item => item.quantity > 0)
      }

      return prev.map(item => item.cartKey === cartKey ? { ...item, quantity: item.quantity + 1 } : item)
    })
  }

  // Quitar nota directamente de una línea y devolverla a la línea base
  const removeLineNote = (cartKey: string) => {
    setCart(prev => {
      const line = prev.find(i => i.cartKey === cartKey)
      if (!line) return prev

      const baseLine = prev.find(
        i => i.menuItemId === line.menuItemId && 
             !(i.notes || '').trim() && 
             i.takeaway === line.takeaway &&
             (!i.additions || i.additions.length === 0)
      )

      let updated = prev.filter(i => i.cartKey !== cartKey)
      if (baseLine) {
        updated = updated.map(item => item.cartKey === baseLine.cartKey ? { ...item, quantity: item.quantity + line.quantity } : item)
      } else {
        updated.push({
          cartKey: genKey(line.menuItemId),
          menuItemId: line.menuItemId,
          name: line.name,
          price: line.price,
          quantity: line.quantity,
          takeaway: line.takeaway,
          notes: '',
          additions: [],
        })
      }
      return updated
    })
    alerts.toast('Nota devuelta a normal')
  }

  // Convertir 1 unidad a llevar o sumar 1 para llevar directamente
  const convertOrAddTakeaway = (menuItemId: string) => {
    setCart(prev => {
      const baseDineIn = prev.find(
        i => i.menuItemId === menuItemId && 
             !i.takeaway && 
             !(i.notes || '').trim() && 
             (!i.additions || i.additions.length === 0)
      )
      const existingTakeaway = prev.find(
        i => i.menuItemId === menuItemId && 
             i.takeaway && 
             !(i.notes || '').trim() && 
             (!i.additions || i.additions.length === 0)
      )

      if (baseDineIn && baseDineIn.quantity > 0) {
        const updated = prev.map(item => {
          if (item.cartKey === baseDineIn.cartKey) {
            return { ...item, quantity: item.quantity - 1 }
          }
          if (existingTakeaway && item.cartKey === existingTakeaway.cartKey) {
            return { ...item, quantity: item.quantity + 1 }
          }
          return item
        }).filter(item => item.quantity > 0)

        if (!existingTakeaway) {
          updated.push({
            cartKey: genKey(`${menuItemId}_takeaway`),
            menuItemId,
            name: baseDineIn.name,
            price: baseDineIn.price,
            quantity: 1,
            takeaway: true,
            notes: '',
            additions: [],
          })
        }
        alerts.toast('1 pasada para llevar')
        return updated
      }

      const menuItem = categories.flatMap(c => c.items).find(i => i.id === menuItemId)
      if (menuItem) {
        if (existingTakeaway) {
          alerts.toast('+1 para llevar')
          return prev.map(i => i.cartKey === existingTakeaway.cartKey ? { ...i, quantity: i.quantity + 1 } : i)
        }
        alerts.toast('1 para llevar')
        return [
          ...prev,
          {
            cartKey: genKey(`${menuItemId}_takeaway`),
            menuItemId,
            name: menuItem.name,
            price: menuItem.price,
            quantity: 1,
            takeaway: true,
            notes: '',
            additions: [],
          },
        ]
      }
      return prev
    })
  }

  // Alternar adición en una línea de la cuenta (SI TIENE > 1 UNIDAD, SEPARA 1 UNIDAD CON LA ADICIÓN)
  const toggleItemAddition = (cartKey: string, addition: CartAddition) => {
    setCart(prev => {
      const target = prev.find(i => i.cartKey === cartKey)
      if (!target) return prev

      const currentAdditions = target.additions || []
      const hasAddition = currentAdditions.some(a => a.id === addition.id)

      if (!hasAddition && target.quantity > 1) {
        // Separar automáticamente 1 unidad con esta adición
        const remaining = { ...target, quantity: target.quantity - 1 }
        const singleUnit: CartItem = {
          ...target,
          cartKey: genKey(`${target.menuItemId}_add`),
          quantity: 1,
          additions: [...currentAdditions, addition],
        }
        alerts.toast(`Se separó 1 ${target.name} con ${addition.name}`)
        return prev.map(i => (i.cartKey === cartKey ? remaining : i)).concat(singleUnit)
      }

      // Si tiene 1 unidad o ya la tenía (quitar)
      const newAdditions = hasAddition
        ? currentAdditions.filter(a => a.id !== addition.id)
        : [...currentAdditions, addition]

      return prev.map(i => (i.cartKey === cartKey ? { ...i, additions: newAdditions } : i))
    })
  }

  // Unir ítems idénticos
  const mergeIdentical = () => {
    setCart(prev => {
      const merged: CartItem[] = []
      for (const item of prev) {
        const itemAdds = (item.additions || []).map(a => a.id).sort().join(',')
        const match = merged.find(
          m =>
            m.menuItemId === item.menuItemId &&
            m.takeaway === item.takeaway &&
            (m.notes || '').trim() === (item.notes || '').trim() &&
            (m.additions || []).map(a => a.id).sort().join(',') === itemAdds
        )
        if (match) {
          match.quantity += item.quantity
        } else {
          merged.push({ ...item, additions: item.additions ? [...item.additions] : [] })
        }
      }
      return merged
    })
    alerts.toast('Unidades idénticas agrupadas.')
  }

  const submit = async () => {
    if (saving) return

    // 1. Validar nombre de mesa OBLIGATORIO
    if (!existingTableId && !tableLabel.trim()) {
      alerts.warning(
        'Nombre de Mesa Requerido',
        'Por favor escribe el número de mesa (ej. Mesa 1, Mesa 2) o el nombre del cliente para poder identificar el pedido.'
      )
      const input = document.getElementById('table-label-input')
      if (input) {
        input.focus()
        input.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      return
    }

    // 2. Validar pedido no vacío
    if (cart.length === 0) {
      alerts.warning('Pedido vacío', 'Toca los productos del menú para agregarlos a la cuenta.')
      return
    }

    const effectiveTableLabel = tableLabel.trim() || (existingTableId ? 'Mesa' : '')

    let summaryText = `${totalCount} producto(s)`
    if (takeawayCount > 0 && dineInCount > 0) {
      summaryText += ` (${dineInCount} en mesa, ${takeawayCount} para llevar)`
    } else if (takeawayCount > 0) {
      summaryText += ` (Todos para llevar)`
    } else {
      summaryText += ` (Todos en mesa)`
    }

    const confirmed = await alerts.confirm(
      editOrderId ? '¿Guardar cambios y notificar a cocina?' : '¿Enviar pedido a cocina?',
      `${effectiveTableLabel}: ${summaryText}\nTotal: ${formatCurrency(total)}\nMesera: ${user?.name || 'Mesera'}`,
      editOrderId ? '💾 Guardar y avisar cocina' : '🚀 Enviar a cocina',
      'Revisar pedido',
      'question'
    )
    if (!confirmed) return

    const signature = JSON.stringify({ tableLabel: effectiveTableLabel, tableId: existingTableId, cart, notes })
    if (submission.current.signature !== signature) submission.current = { signature, id: genKey('sub') }
    const clientMutationId = submission.current.id

    // Construir lista de ítems para el backend (incluyendo productos base y adiciones facturables)
    const itemsPayload: { menuItemId: string; quantity: number; notes?: string }[] = []

    for (const item of cart) {
      let noteText = item.notes?.trim() || ''
      const additionNames = (item.additions || []).map(a => a.name.replace(/^adici[oó]n\s+de\s+/i, '')).join(', ')
      if (additionNames) {
        noteText = noteText ? `${noteText} (+ Con ${additionNames})` : `+ Con ${additionNames}`
      }
      if (item.takeaway && !noteText.toLowerCase().includes('para llevar') && !noteText.toLowerCase().includes('llevar')) {
        noteText = noteText ? `[PARA LLEVAR] ${noteText}` : '[PARA LLEVAR]'
      } else if (!item.takeaway && !noteText.toLowerCase().includes('mesa')) {
        noteText = noteText ? `[MESA] ${noteText}` : '[MESA]'
      }

      const hasAdds = !!(item.additions && item.additions.length > 0)
      const lineTag = hasAdds ? (item.cartKey.replace(/[^a-zA-Z0-9_-]/g, '').slice(-8) || `line_${Math.random().toString(36).slice(2, 7)}`) : ''
      const finalNoteText = lineTag ? (noteText ? `${noteText} (#${lineTag})` : `(#${lineTag})`) : noteText

      // Producto principal
      itemsPayload.push({
        menuItemId: item.menuItemId,
        quantity: item.quantity,
        notes: finalNoteText || undefined,
      })

      // Cada adición seleccionada como ítem adicional facturable vinculado directamente
      if (hasAdds) {
        for (const add of item.additions!) {
          itemsPayload.push({
            menuItemId: add.id,
            quantity: item.quantity,
            notes: `Adición para: ${item.name} (#${lineTag}) ${item.takeaway ? '[PARA LLEVAR]' : '[MESA]'}`,
          })
        }
      }
    }

    const payload: OfflineTableOrderPayload = {
      clientMutationId,
      tableId: existingTableId || undefined,
      tableLabel: effectiveTableLabel,
      notes,
      items: itemsPayload,
      paymentMethod: 'CASH',
      editOrderId: editOrderId || undefined,
    }

    setSaving(true)
    try {
      if (!navigator.onLine) throw new Error('offline')
      const res = editOrderId
        ? await api.put<{ table?: { id?: string; label?: string } }>(`/tables/orders/${editOrderId}`, payload)
        : await api.post<{ table?: { id?: string; label?: string } }>('/tables/orders', payload)
      alerts.toast(editOrderId ? `Pedido actualizado y avisado a cocina para ${res?.table?.label || effectiveTableLabel}` : `Pedido enviado a cocina para ${res?.table?.label || effectiveTableLabel}`)

      // Impresión directa multidispositivo de comanda/factura enviando el trabajo al servidor
      try {
        const orderIdToPrint = editOrderId || (res as any)?.orderId || (res as any)?.order?.id
        if (orderIdToPrint) {
          await api.post(`/print/order/${orderIdToPrint}`).catch(() => null)
        }
      } catch (printErr) {
        console.warn('Error enviando comanda de mesa a imprimir:', printErr)
      }
      setCart([])
      setNotes('')
      if (!existingTableId) setTableLabel('')
      navigate('/tables')
    } catch (err: any) {
      // Solo entra en Modo Offline si el dispositivo está realmente desconectado (navigator.onLine === false)
      // o si la petición falló por pérdida total de conexión (status === 0 / isNetworkError).
      // Si el servidor respondió (ej: 400 "Abre una caja antes de enviar pedidos"), se muestra el error real al usuario.
      const isActualNetworkError = !navigator.onLine || (err?.isNetworkError === true && (!err?.status || err?.status === 0))
      if (isActualNetworkError) {
        await saveOfflineOrder({ clientMutationId, createdAt: new Date().toISOString(), payload, status: 'PENDING' })
        await loadPending()
        alerts.warning(
          'Guardado sin internet (Modo Offline)',
          `El pedido de "${effectiveTableLabel}" quedó guardado seguro en tu celular. En cuanto te acerques a la señal del restaurante, se enviará solito a cocina.`
        )
        setCart([])
        navigate('/tables')
      } else {
        const msg = err?.data?.message || err?.message || 'Error al enviar pedido a cocina'
        alerts.error('No se pudo enviar el pedido', msg)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full max-w-full overflow-x-hidden pb-32 lg:pb-8">
      <div className="grid gap-4 items-start lg:grid-cols-[1fr_390px]">
        {/* COLUMNA PRINCIPAL: MENÚ Y PRODUCTOS */}
        <section className="space-y-3.5 min-w-0 w-full">
          {/* Cabecera compacta de la orden */}
          <div className="flex items-center justify-between gap-2 bg-[var(--bg-panel)] p-2.5 rounded-2xl border border-[var(--border-subtle)] shadow-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                <Link to="/tables">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-base sm:text-lg font-black text-[var(--text-primary)] truncate">
                    {editOrderId ? `Editar Pedido` : 'Tomar Pedido'}
                  </h1>
                  {editOrderNumber && (
                    <span className="px-2 py-0.5 rounded-md bg-amber-500 text-slate-950 font-black text-xs shadow-xs">
                      #{editOrderNumber}
                    </span>
                  )}
                  {tableLabel && (
                    <span className="text-xs font-black text-[var(--accent)] bg-[var(--accent)]/10 px-2 py-0.5 rounded-md">
                      {tableLabel}
                    </span>
                  )}
                </div>
                <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-0.5">
                  <User className="h-3 w-3" /> Mesera: {user?.name || 'Mesera'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowMobileCart(true)}
                  className="lg:hidden flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--accent)] text-white text-xs font-black shadow-md active:scale-95 transition-all cursor-pointer animate-in fade-in"
                >
                  <UtensilsCrossed className="h-4 w-4" />
                  <span>Ver Cuenta ({totalCount})</span>
                </button>
              )}
              {!online && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-black text-amber-600 shrink-0">
                  <WifiOff className="h-3 w-3" /> Sin red
                </span>
              )}
            </div>
          </div>

          {pending.length > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700">
              <span>{pending.length} pedido(s) pendientes por sincronizar.</span>
              <Button size="sm" variant="outline" onClick={() => syncPending()} className="h-7 text-xs font-bold">
                Sincronizar
              </Button>
            </div>
          )}

          {/* Campo Mesa / Cliente / Referencia (OBLIGATORIO) */}
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3.5 shadow-xs">
            <div className="flex items-center justify-between gap-2 mb-2">
              <label htmlFor="table-label-input" className="text-xs font-black text-[var(--text-primary)] flex items-center gap-1.5 tracking-wider uppercase">
                <span>Mesa / Nombre del Cliente / Pedido:</span>
                <span className="text-rose-600 font-bold text-xs">* Obligatorio</span>
              </label>
            </div>

            <Input
              id="table-label-input"
              value={tableLabel}
              onChange={e => setTableLabel(e.target.value)}
              placeholder="Escribe el número de mesa o nombre del cliente (Ej: Mesa 1, Mesa 4, Alexis)..."
              disabled={!!existingTableId}
              required
              className={`text-sm font-bold bg-[var(--bg-elevated)] rounded-xl h-11 transition-all ${
                !tableLabel.trim() && !existingTableId
                  ? 'border-amber-500/60 focus:border-rose-500'
                  : 'border-[var(--border-subtle)]'
              }`}
            />
          </div>

          {/* Barra de búsqueda de productos */}
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar producto (perro, hamburguesa, gaseosa)..."
              className="pl-10 h-11 bg-[var(--bg-panel)] rounded-xl border-[var(--border-subtle)] text-sm font-medium"
            />
          </div>

          {/* Categorías (Pills horizontales) */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            <button
              type="button"
              onClick={() => setSelectedCategory('ALL')}
              className={`px-4 py-2 rounded-xl text-xs font-black shrink-0 transition-all cursor-pointer ${
                selectedCategory === 'ALL'
                  ? 'bg-[var(--accent)] text-white shadow-xs'
                  : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)]'
              }`}
            >
              Todos ({categories.reduce((sum, c) => sum + c.items.length, 0)})
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-4 py-2 rounded-xl text-xs font-black shrink-0 transition-all cursor-pointer ${
                  selectedCategory === cat.id
                    ? 'bg-[var(--accent)] text-white shadow-xs'
                    : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)]'
                }`}
              >
                {cat.name} ({cat.items.length})
              </button>
            ))}
          </div>

          {/* GRID DE PRODUCTOS */}
          <div className="grid gap-2.5 sm:grid-cols-2">
            {items.map(item => {
              const counts = inCartCounts.get(item.id)
              const inCartTotal = counts?.total || 0
              const inCartDineIn = counts?.dineIn || 0
              const inCartTakeaway = counts?.takeaway || 0
              const allowAdditions = isFoodWithAdditions(item)

              return (
                <div
                  key={item.id}
                  onClick={() => addItem(item, false)}
                  className={`group relative rounded-2xl border p-3.5 bg-[var(--bg-panel)] shadow-2xs transition-all cursor-pointer select-none active:scale-[0.98] hover:border-[var(--accent)] ${
                    inCartTotal > 0
                      ? 'border-[var(--accent)] bg-[var(--accent)]/5 ring-1 ring-[var(--accent)]/30'
                      : 'border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2.5">
                    {/* Nombre, categoría y precio */}
                    <div className="min-w-0 flex-1">
                      <p className="font-black text-sm text-[var(--text-primary)] leading-tight group-hover:text-[var(--accent)] transition-colors">
                        {item.name}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-sm font-black text-[var(--accent)]">{formatCurrency(item.price)}</span>
                        {item.category?.name && (
                          <span className="text-[10px] text-[var(--text-muted)] font-bold truncate">
                            • {item.category.name}
                          </span>
                        )}
                      </div>

                      {/* Resumen detallado en la tarjeta: mesa, llevar y notas específicas */}
                      {inCartTotal > 0 && (() => {
                        const itemCartLines = cart.filter(c => c.menuItemId === item.id)
                        const baseDineIn = itemCartLines
                          .filter(c => !c.takeaway && !(c.notes || '').trim() && (!c.additions || c.additions.length === 0))
                          .reduce((s, c) => s + c.quantity, 0)
                        const baseTakeaway = itemCartLines
                          .filter(c => c.takeaway && !(c.notes || '').trim() && (!c.additions || c.additions.length === 0))
                          .reduce((s, c) => s + c.quantity, 0)
                        const customLines = itemCartLines.filter(
                          c => (c.notes || '').trim() || (c.additions && c.additions.length > 0)
                        )

                        return (
                          <div className="mt-2 flex items-center gap-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
                            <span className="rounded-md bg-[var(--accent)] text-white text-[10px] font-black px-1.5 py-0.5 shadow-2xs">
                              {inCartTotal} en cuenta
                            </span>

                            {baseDineIn > 0 && (
                              <span className="rounded-md bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)] text-[10px] font-bold px-1.5 py-0.5">
                                {baseDineIn} mesa
                              </span>
                            )}

                            {baseTakeaway > 0 && (
                              <span className="rounded-md bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/30 text-[10px] font-bold px-1.5 py-0.5 flex items-center gap-1">
                                <span>🥡</span>
                                <span>{baseTakeaway} llevar</span>
                              </span>
                            )}

                            {customLines.map(line => {
                              const noteStr = line.notes?.trim()
                              const addStr = line.additions?.map(a => a.name.replace(/^adici[oó]n\s+de\s+/i, '')).join(', ')
                              return (
                                <span
                                  key={line.cartKey}
                                  className="rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-950 dark:text-amber-200 text-[10px] font-bold px-1.5 py-0.5 flex items-center gap-1 shadow-2xs"
                                >
                                  {line.takeaway && <span className="text-[10px]">🥡</span>}
                                  <span>
                                    {line.quantity} {noteStr ? noteStr : ''} {addStr ? `(+${addStr})` : ''}
                                  </span>

                                  {/* Stepper por nota: [-] y [+] para controlar cuántos van con esta nota */}
                                  {noteStr && (
                                    <span className="inline-flex items-center gap-0.5 ml-1">
                                      <button
                                        type="button"
                                        onClick={() => decrementNoteLine(line.cartKey)}
                                        className="h-4 w-4 rounded bg-amber-500/25 hover:bg-amber-500/50 text-amber-950 dark:text-amber-100 flex items-center justify-center font-black text-[10px] cursor-pointer"
                                        title="Restar 1 de esta nota"
                                      >
                                        -
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => incrementNoteLine(line.cartKey)}
                                        className="h-4 w-4 rounded bg-amber-500/25 hover:bg-amber-500/50 text-amber-950 dark:text-amber-100 flex items-center justify-center font-black text-[10px] cursor-pointer"
                                        title="Sumar 1 con esta nota"
                                      >
                                        +
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => removeLineNote(line.cartKey)}
                                        className="text-rose-500 hover:text-rose-700 hover:bg-rose-500/20 rounded h-4 w-4 flex items-center justify-center font-black text-[11px] cursor-pointer ml-0.5"
                                        title="Quitar esta nota y devolver a normal"
                                      >
                                        ×
                                      </button>
                                    </span>
                                  )}
                                </span>
                              )
                            })}
                          </div>
                        )
                      })()}
                    </div>

                    {/* Acciones directas dentro de la tarjeta */}
                    <div
                      className="flex flex-col sm:flex-row items-end sm:items-center gap-1.5 shrink-0"
                      onClick={e => e.stopPropagation()}
                    >
                      {inCartTotal === 0 ? (
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => addItem(item, false)}
                            className="h-9 px-3 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-black text-xs gap-1 shadow-xs active:scale-90 cursor-pointer"
                          >
                            <Plus className="h-3.5 w-3.5 stroke-[3]" />
                            <span>Mesa</span>
                          </Button>
                          <button
                            type="button"
                            onClick={() => addItem(item, true)}
                            className="h-9 px-2.5 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-bold text-xs border border-[var(--border-subtle)] active:scale-90 transition cursor-pointer flex items-center gap-1"
                            title="Agregar para llevar"
                          >
                            <span>🥡 Llevar</span>
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          {/* Stepper directo */}
                          <div className="flex items-center gap-1 bg-[var(--bg-elevated)] p-1 rounded-xl border border-[var(--border-subtle)]">
                            <button
                              type="button"
                              onClick={() => handleMenuCardDecrement(item.id)}
                              className="h-7 w-7 rounded-lg bg-[var(--bg-panel)] flex items-center justify-center text-[var(--text-primary)] hover:bg-rose-50 hover:text-rose-600 active:scale-90 font-black transition cursor-pointer"
                              title="Restar una unidad"
                            >
                              <Minus className="h-3.5 w-3.5 stroke-[3]" />
                            </button>
                            <span className="w-6 text-center font-black text-sm text-[var(--text-primary)]">
                              {inCartTotal}
                            </span>
                            <button
                              type="button"
                              onClick={() => addItem(item, false)}
                              className="h-7 w-7 rounded-lg bg-[var(--accent)] text-white flex items-center justify-center active:scale-90 font-black transition shadow-2xs cursor-pointer"
                              title="Sumar a mesa"
                            >
                              <Plus className="h-3.5 w-3.5 stroke-[3]" />
                            </button>
                          </div>

                          {/* Botón rápido para sumar o pasar para llevar */}
                          <button
                            type="button"
                            onClick={() => convertOrAddTakeaway(item.id)}
                            className="h-9 px-2.5 rounded-xl bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-bold text-xs border border-[var(--border-subtle)] active:scale-90 transition cursor-pointer flex items-center gap-1"
                            title="Pasar 1 a llevar o sumar para llevar"
                          >
                            <span>+🥡</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ADICIONES RÁPIDAS EN LA TARJETA (Solo para comidas) */}
                  {allowAdditions && (
                    <div
                      className="mt-2.5 pt-2 border-t border-[var(--border-subtle)]/70 flex items-center gap-1.5 flex-wrap"
                      onClick={e => e.stopPropagation()}
                    >
                      <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                        + Adición:
                      </span>
                      {quesoAddition && (
                        <button
                          type="button"
                          onClick={() => addItemWithAddition(item, { id: quesoAddition.id, name: quesoAddition.name, price: quesoAddition.price })}
                          className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] border border-[var(--border-subtle)] transition active:scale-95 cursor-pointer flex items-center gap-0.5"
                          title="Agregar 1 con Adición de Queso"
                        >
                          🧀 Queso ({formatCurrency(quesoAddition.price)})
                        </button>
                      )}
                      {tocinetaAddition && (
                        <button
                          type="button"
                          onClick={() => addItemWithAddition(item, { id: tocinetaAddition.id, name: tocinetaAddition.name, price: tocinetaAddition.price })}
                          className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] border border-[var(--border-subtle)] transition active:scale-95 cursor-pointer flex items-center gap-0.5"
                          title="Agregar 1 con Adición de Tocineta"
                        >
                          🥓 Tocineta ({formatCurrency(tocinetaAddition.price)})
                        </button>
                      )}
                    </div>
                  )}

                  {/* NOTAS RÁPIDAS DE 1 CLIC DIRECTO EN LA TARJETA (SIN MODAL NI REDIRECCIÓN) */}
                  {allowAdditions && (
                    <div
                      className="mt-1.5 pt-1.5 border-t border-[var(--border-subtle)]/70 flex items-center gap-1 flex-wrap"
                      onClick={e => e.stopPropagation()}
                    >
                      <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                        Nota:
                      </span>
                      {QUICK_CHIPS.map(chip => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => applyNoteToProduct(item.id, chip, false)}
                          className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[var(--bg-elevated)] hover:bg-[var(--accent)] hover:text-white text-[var(--text-secondary)] border border-[var(--border-subtle)] transition active:scale-95 cursor-pointer"
                          title={`Asignar o separar 1 con "${chip}"`}
                        >
                          {chip}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          const custom = window.prompt(`Escribe una indicación para "${item.name}" (ej: término medio, sin tártara):`)
                          if (custom && custom.trim()) {
                            applyNoteToProduct(item.id, custom.trim(), false)
                          }
                        }}
                        className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border-subtle)] transition active:scale-95 cursor-pointer"
                        title="Escribir otra nota para cocina"
                      >
                        ✏️ Otra...
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {items.length === 0 && (
            <div className="rounded-2xl border border-dashed border-[var(--border-default)] p-8 text-center text-sm text-[var(--text-secondary)]">
              No se encontraron productos con la búsqueda "{search}".
            </div>
          )}
        </section>

        {/* COLUMNA LATERAL DERECHA (DESKTOP): CUENTA DETALLADA */}
        <aside className="hidden lg:flex sticky top-4 max-h-[calc(100vh-5.5rem)] flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-sm overflow-hidden">
          {/* CABECERA DE LA CUENTA */}
          <div className="border-b border-[var(--border-subtle)] p-3.5 flex items-center justify-between bg-[var(--bg-panel)]">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-black text-sm text-[var(--text-primary)]">
                  Cuenta: {tableLabel || 'Mesa nueva'}
                </h2>
                {cart.length > 1 && (
                  <button
                    type="button"
                    onClick={mergeIdentical}
                    className="text-[10px] font-bold text-[var(--accent)] hover:underline flex items-center gap-1 cursor-pointer"
                    title="Reagrupar ítems idénticos"
                  >
                    <Layers className="h-3 w-3" /> Unir
                  </button>
                )}
              </div>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                {totalCount} ítem(s) • {dineInCount} mesa {takeawayCount > 0 ? `• ${takeawayCount} llevar` : ''}
              </p>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-black text-[var(--text-muted)] block">TOTAL</span>
              <b className="text-base font-black text-[var(--accent)]">{formatCurrency(total)}</b>
            </div>
          </div>

          {/* LISTA DE ÍTEMS EN CUENTA (DESKTOP) */}
          <div className="flex-1 space-y-3 overflow-y-auto p-3.5 min-h-0">
            {cart.map(item => {
              const allowAdditions = isFoodWithAdditions(item)
              const unitPrice = getItemUnitPrice(item)
              const lineTotal = getItemLineTotal(item)

              return (
                <div
                  key={item.cartKey}
                  className={`rounded-xl border p-3 transition-all ${
                    item.takeaway ? 'border-amber-500/40 bg-amber-500/5' : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]'
                  }`}
                >
                  {/* Cabecera del ítem */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-[var(--text-primary)] leading-tight">{item.name}</p>
                      <p className="text-xs font-black text-[var(--accent)] mt-0.5">
                        {formatCurrency(lineTotal)}
                        {item.quantity > 1 && (
                          <span className="text-[10px] font-normal text-[var(--text-muted)] ml-1">
                            ({formatCurrency(unitPrice)} c/u)
                          </span>
                        )}
                      </p>
                    </div>

                    {/* Stepper y eliminar */}
                    <div className="flex items-center gap-1 rounded-lg bg-[var(--bg-panel)] p-0.5 border border-[var(--border-subtle)] shrink-0">
                      <button
                        type="button"
                        className="h-6 w-6 rounded flex items-center justify-center text-[var(--text-primary)] hover:bg-rose-50 hover:text-rose-600 font-bold active:scale-90"
                        onClick={() => updateQty(item.cartKey, -1)}
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-5 text-center text-xs font-black">{item.quantity}</span>
                      <button
                        type="button"
                        className="h-6 w-6 rounded flex items-center justify-center text-[var(--text-primary)] hover:bg-[var(--accent)] hover:text-white font-bold active:scale-90"
                        onClick={() => updateQty(item.cartKey, 1)}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        className="h-6 w-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-rose-600 hover:bg-rose-50 font-bold active:scale-90 ml-1"
                        onClick={() => removeItem(item.cartKey)}
                        title="Quitar"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  {/* TOGGLE MESA VS LLEVAR */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => (item.quantity === 1 ? toggleAllTakeaway(item.cartKey, false) : moveOneTakeaway(item.cartKey, false))}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-black transition-all cursor-pointer ${
                        !item.takeaway
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
                      }`}
                    >
                      🍽️ {item.quantity > 1 && item.takeaway ? 'Pasar 1 a Mesa' : 'En Mesa'}
                    </button>

                    <button
                      type="button"
                      onClick={() => (item.quantity === 1 ? toggleAllTakeaway(item.cartKey, true) : moveOneTakeaway(item.cartKey, true))}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-black transition-all cursor-pointer flex items-center gap-1 ${
                        item.takeaway
                          ? 'bg-amber-600 text-white shadow-xs'
                          : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
                      }`}
                    >
                      <span>🥡</span>
                      <span>{item.quantity > 1 && !item.takeaway ? 'Pasar 1 a Llevar' : 'Para Llevar'}</span>
                    </button>
                  </div>

                  {/* ADICIONES EN LA CUENTA (Solo para comidas) */}
                  {allowAdditions && (
                    <div className="mt-2 pt-2 border-t border-[var(--border-subtle)]/60 flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-wider">
                        Adición:
                      </span>
                      {quesoAddition && (
                        <button
                          type="button"
                          onClick={() => toggleItemAddition(item.cartKey, { id: quesoAddition.id, name: quesoAddition.name, price: quesoAddition.price })}
                          className={`px-2 py-0.5 rounded-md text-[11px] font-black transition cursor-pointer flex items-center gap-1 ${
                            (item.additions || []).some(a => a.id === quesoAddition.id)
                              ? 'bg-amber-500 text-slate-950 shadow-xs'
                              : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:border-amber-500/40'
                          }`}
                        >
                          {(item.additions || []).some(a => a.id === quesoAddition.id) ? '✓ 🧀 Queso' : '+ 🧀 Queso ($1.500)'}
                        </button>
                      )}
                      {tocinetaAddition && (
                        <button
                          type="button"
                          onClick={() => toggleItemAddition(item.cartKey, { id: tocinetaAddition.id, name: tocinetaAddition.name, price: tocinetaAddition.price })}
                          className={`px-2 py-0.5 rounded-md text-[11px] font-black transition cursor-pointer flex items-center gap-1 ${
                            (item.additions || []).some(a => a.id === tocinetaAddition.id)
                              ? 'bg-rose-500 text-white shadow-xs'
                              : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:border-rose-500/40'
                          }`}
                        >
                          {(item.additions || []).some(a => a.id === tocinetaAddition.id) ? '✓ 🥓 Tocineta' : '+ 🥓 Tocineta ($1.000)'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* CAMPO DE NOTA INDIVIDUAL */}
                  <div className="mt-2 flex items-center gap-1">
                    <Input
                      value={draftNotes[item.cartKey] ?? item.notes ?? ''}
                      onChange={e => updateNotes(item.cartKey, e.target.value)}
                      onBlur={() => commitLineNote(item.cartKey)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitLineNote(item.cartKey)
                        }
                      }}
                      placeholder={item.quantity > 1 ? `Ej: 2 sin cebolla y ${item.quantity - 1 > 1 ? (item.quantity - 1) + ' ' : ''}normal...` : "Nota (sin cebolla, sin queso, bien caliente...)"}
                      className="h-8 text-xs bg-[var(--bg-panel)] rounded-lg flex-1"
                    />
                    {((draftNotes[item.cartKey] !== undefined && draftNotes[item.cartKey] !== (item.notes || '')) || item.notes) && (
                      <button
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => commitLineNote(item.cartKey)}
                        className="h-8 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shrink-0 transition cursor-pointer"
                        title="Guardar nota"
                      >
                        ✓
                      </button>
                    )}
                  </div>

                  {/* Chips rápidos para notas (Separación automática si quantity > 1) */}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {QUICK_CHIPS.map(chip => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => appendNote(item.cartKey, chip)}
                        className="rounded-md bg-[var(--bg-panel)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition cursor-pointer"
                        title={item.quantity > 1 ? `Separar 1 unidad con nota "${chip}"` : `Agregar nota "${chip}"`}
                      >
                        +{chip}
                      </button>
                    ))}
                  </div>

                  {/* Único botón de separación manual si tiene varias unidades */}
                  {item.quantity > 1 && (
                    <div className="mt-2 pt-1.5 border-t border-[var(--border-subtle)]/60 flex items-center justify-between text-[10px]">
                      <span className="text-[var(--text-muted)] font-medium">
                        💡 Tocar un chip separa 1 con esa nota.
                      </span>
                      <button
                        type="button"
                        onClick={() => splitItem(item.cartKey)}
                        className="text-purple-600 dark:text-purple-400 font-bold hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Scissors className="h-3 w-3" /> Separar ({item.quantity})
                      </button>
                    </div>
                  )}
                </div>
              )
            })}

            {cart.length === 0 && (
              <div className="py-12 text-center text-sm text-[var(--text-muted)]">
                <UtensilsCrossed className="mx-auto h-8 w-8 opacity-30 mb-2" />
                <p className="font-bold">Cuenta vacía</p>
                <p className="text-xs mt-0.5">Toca los productos a la izquierda para agregarlos.</p>
              </div>
            )}
          </div>

          {/* PIE DEL PANEL: NOTA GENERAL Y ENVIAR */}
          <div className="space-y-2 border-t border-[var(--border-subtle)] p-3.5 bg-[var(--bg-panel)]">
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Nota general del pedido para cocina o caja..."
              rows={2}
              className="text-xs resize-none rounded-xl"
            />
            <Button
              onClick={submit}
              disabled={saving || cart.length === 0}
              className="h-11 w-full gap-2 bg-[var(--accent)] text-[var(--accent-fg)] font-black text-sm shadow-md hover:bg-[var(--accent-hover)] active:scale-98 transition-all cursor-pointer"
            >
              <Send className="h-4 w-4" />
              {saving
                ? 'Guardando cambios...'
                : editOrderId
                ? `Guardar cambios #${editOrderNumber || ''} y avisar cocina`
                : `Enviar a cocina (${formatCurrency(total)})`}
            </Button>
            <p className="flex items-center justify-center gap-1 text-[10px] text-[var(--text-muted)]">
              <Save className="h-3 w-3" />
              Se despacha en tiempo real a las estaciones de cocina.
            </p>
          </div>
        </aside>
      </div>

      {/* BARRA FLOTANTE MÓVIL (TÁCTIL Y VISIBLE EN CELULAR) */}
      {cart.length > 0 && (
        <div className="fixed bottom-3 left-3 right-3 z-50 lg:hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
          <button
            type="button"
            onClick={() => setShowMobileCart(true)}
            className="flex w-full items-center justify-between rounded-2xl bg-[var(--accent)] px-4 py-3.5 text-white shadow-2xl active:scale-[0.98] transition-all cursor-pointer border-2 border-white/30"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-xs font-black text-[var(--accent)] shadow-sm shrink-0">
                {totalCount}
              </span>
              <div className="text-left min-w-0">
                <p className="text-xs sm:text-sm font-black truncate">
                  {tableLabel ? `Cuenta: ${tableLabel}` : 'Ver Cuenta y Notas'} ({totalCount})
                </p>
                <p className="text-[10px] text-white/90 font-semibold truncate">
                  {dineInCount} en mesa {takeawayCount > 0 ? `• ${takeawayCount} para llevar` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm sm:text-base font-black">{formatCurrency(total)}</span>
              <span className="rounded-xl bg-black/30 px-3 py-1.5 text-xs font-black flex items-center gap-1 shadow-inner">
                Revisar y Enviar →
              </span>
            </div>
          </button>
        </div>
      )}

      {/* MODAL / SHEET DE CUENTA EN MÓVIL */}
      <Dialog open={showMobileCart} onOpenChange={setShowMobileCart}>
        <DialogContent className="max-w-md p-0 overflow-hidden bg-[var(--bg-panel)] rounded-2xl border-none max-h-[90vh] flex flex-col">
          <div className="border-b border-[var(--border-subtle)] p-4 flex justify-between items-center bg-[var(--bg-panel)] shrink-0">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-black text-base text-[var(--text-primary)]">
                  Cuenta: {tableLabel || 'Mesa nueva'}
                </h2>
                {cart.length > 1 && (
                  <button
                    type="button"
                    onClick={mergeIdentical}
                    className="text-[10px] font-bold text-[var(--accent)] hover:underline flex items-center gap-1"
                  >
                    <Layers className="h-3 w-3" /> Unir
                  </button>
                )}
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                {totalCount} ítem(s) • <b className="text-[var(--accent)]">{formatCurrency(total)}</b>
              </p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-xs font-bold rounded-xl"
              onClick={() => setShowMobileCart(false)}
            >
              ✕
            </Button>
          </div>

          {/* LISTA SCROLLEABLE EN MÓVIL */}
          <div className="flex-1 space-y-3 overflow-y-auto p-4 min-h-0">
            {cart.map(item => {
              const allowAdditions = isFoodWithAdditions(item)
              const unitPrice = getItemUnitPrice(item)
              const lineTotal = getItemLineTotal(item)

              return (
                <div
                  key={item.cartKey}
                  className={`rounded-xl border p-3 ${
                    item.takeaway ? 'border-amber-500/40 bg-amber-500/5' : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]'
                  }`}
                >
                  {/* Cabecera ítem móvil */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-[var(--text-primary)] leading-tight">{item.name}</p>
                      <p className="text-xs font-black text-[var(--accent)] mt-0.5">
                        {formatCurrency(lineTotal)}
                        {item.quantity > 1 && (
                          <span className="text-[10px] font-normal text-[var(--text-muted)] ml-1">
                            ({formatCurrency(unitPrice)} c/u)
                          </span>
                        )}
                      </p>
                    </div>

                    {/* Stepper móvil */}
                    <div className="flex items-center gap-1 rounded-lg bg-[var(--bg-panel)] p-0.5 border border-[var(--border-subtle)] shrink-0">
                      <button
                        type="button"
                        className="h-7 w-7 rounded flex items-center justify-center text-[var(--text-primary)] hover:bg-rose-50 hover:text-rose-600 font-bold active:scale-90"
                        onClick={() => updateQty(item.cartKey, -1)}
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-5 text-center text-xs font-black">{item.quantity}</span>
                      <button
                        type="button"
                        className="h-7 w-7 rounded flex items-center justify-center text-[var(--text-primary)] hover:bg-[var(--accent)] hover:text-white font-bold active:scale-90"
                        onClick={() => updateQty(item.cartKey, 1)}
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        className="h-7 w-7 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-rose-600 font-bold active:scale-90 ml-1"
                        onClick={() => removeItem(item.cartKey)}
                        title="Quitar"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Toggles Mesa vs Llevar móvil */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => (item.quantity === 1 ? toggleAllTakeaway(item.cartKey, false) : moveOneTakeaway(item.cartKey, false))}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-black transition-all cursor-pointer ${
                        !item.takeaway
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border border-[var(--border-subtle)]'
                      }`}
                    >
                      🍽️ {item.quantity > 1 && item.takeaway ? 'Pasar 1 a Mesa' : 'En Mesa'}
                    </button>
                    <button
                      type="button"
                      onClick={() => (item.quantity === 1 ? toggleAllTakeaway(item.cartKey, true) : moveOneTakeaway(item.cartKey, true))}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-black transition-all cursor-pointer flex items-center gap-1 ${
                        item.takeaway
                          ? 'bg-amber-600 text-white shadow-xs'
                          : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border border-[var(--border-subtle)]'
                      }`}
                    >
                      <span>🥡</span>
                      <span>{item.quantity > 1 && !item.takeaway ? 'Pasar 1 a Llevar' : 'Para Llevar'}</span>
                    </button>
                  </div>

                  {/* ADICIONES MÓVIL (Solo para comidas) */}
                  {allowAdditions && (
                    <div className="mt-2 pt-2 border-t border-[var(--border-subtle)]/60 flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-wider">
                        Adición:
                      </span>
                      {quesoAddition && (
                        <button
                          type="button"
                          onClick={() => toggleItemAddition(item.cartKey, { id: quesoAddition.id, name: quesoAddition.name, price: quesoAddition.price })}
                          className={`px-2 py-1 rounded-lg text-[11px] font-black transition cursor-pointer flex items-center gap-1 ${
                            (item.additions || []).some(a => a.id === quesoAddition.id)
                              ? 'bg-amber-500 text-slate-950 shadow-xs ring-1 ring-amber-600'
                              : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border border-[var(--border-subtle)]'
                          }`}
                        >
                          {(item.additions || []).some(a => a.id === quesoAddition.id) ? '✓ 🧀 Queso' : '+ 🧀 Queso ($1.500)'}
                        </button>
                      )}
                      {tocinetaAddition && (
                        <button
                          type="button"
                          onClick={() => toggleItemAddition(item.cartKey, { id: tocinetaAddition.id, name: tocinetaAddition.name, price: tocinetaAddition.price })}
                          className={`px-2 py-1 rounded-lg text-[11px] font-black transition cursor-pointer flex items-center gap-1 ${
                            (item.additions || []).some(a => a.id === tocinetaAddition.id)
                              ? 'bg-rose-500 text-white shadow-xs ring-1 ring-rose-600'
                              : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border border-[var(--border-subtle)]'
                          }`}
                        >
                          {(item.additions || []).some(a => a.id === tocinetaAddition.id) ? '✓ 🥓 Tocineta' : '+ 🥓 Tocineta ($1.000)'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Campo de notas móvil */}
                  <div className="mt-2 flex items-center gap-1">
                    <Input
                      value={draftNotes[item.cartKey] ?? item.notes ?? ''}
                      onChange={e => updateNotes(item.cartKey, e.target.value)}
                      onBlur={() => commitLineNote(item.cartKey)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitLineNote(item.cartKey)
                        }
                      }}
                      placeholder={item.quantity > 1 ? `Ej: 2 sin cebolla y ${item.quantity - 1 > 1 ? (item.quantity - 1) + ' ' : ''}normal...` : "Nota: sin cebolla, sin queso, bien caliente..."}
                      className="mt-0 h-8 text-xs bg-[var(--bg-panel)] rounded-lg flex-1"
                    />
                    {((draftNotes[item.cartKey] !== undefined && draftNotes[item.cartKey] !== (item.notes || '')) || item.notes) && (
                      <button
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => commitLineNote(item.cartKey)}
                        className="h-8 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shrink-0 transition cursor-pointer"
                        title="Guardar nota"
                      >
                        ✓
                      </button>
                    )}
                  </div>

                  {/* Chips rápidos (Separación automática si quantity > 1) */}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {QUICK_CHIPS.map(chip => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => appendNote(item.cartKey, chip)}
                        className="rounded-md bg-[var(--bg-panel)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition"
                        title={item.quantity > 1 ? `Separar 1 unidad con nota "${chip}"` : `Agregar nota "${chip}"`}
                      >
                        +{chip}
                      </button>
                    ))}
                  </div>

                  {/* Único botón de separación manual si tiene varias unidades */}
                  {item.quantity > 1 && (
                    <div className="mt-2 pt-1.5 border-t border-[var(--border-subtle)]/60 flex items-center justify-between text-[10px]">
                      <span className="text-[var(--text-muted)] font-medium">
                        💡 Tocar un chip separa 1 con esa nota.
                      </span>
                      <button
                        type="button"
                        onClick={() => splitItem(item.cartKey)}
                        className="text-purple-600 dark:text-purple-400 font-bold hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Scissors className="h-3 w-3" /> Separar ({item.quantity})
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Pie del modal móvil */}
          <div className="space-y-2 border-t border-[var(--border-subtle)] p-4 bg-[var(--bg-panel)] shrink-0">
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Nota general del pedido..."
              rows={2}
              className="text-xs resize-none rounded-xl"
            />
            <Button
              onClick={() => {
                setShowMobileCart(false)
                submit()
              }}
              disabled={saving || cart.length === 0}
              className="h-12 w-full gap-2 bg-[var(--accent)] text-[var(--accent-fg)] font-black text-sm shadow-md hover:bg-[var(--accent-hover)] transition-all cursor-pointer"
            >
              <Send className="h-4 w-4" />
              {saving
                ? 'Guardando cambios...'
                : editOrderId
                ? `Guardar cambios #${editOrderNumber || ''} y avisar cocina`
                : `Enviar a cocina (${formatCurrency(total)})`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
