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
type CartItem = {
  cartKey: string
  menuItemId: string
  name: string
  price: number
  quantity: number
  notes?: string
  takeaway: boolean
}

const QUICK_CHIPS = ['Sin cebolla', 'Salsas aparte', 'Sin ripio', 'Bien dorado', 'Sin salsas', 'Poco picante']

function genKey(prefix = 'item'): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export default function TableOrderPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [params] = useSearchParams()
  const existingTableId = params.get('tableId') || ''
  const editOrderId = params.get('editOrderId') || ''
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL')
  const [tableLabel, setTableLabel] = useState('')
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [pending, setPending] = useState<OfflineTableOrder[]>([])
  const [online, setOnline] = useState(navigator.onLine)
  const [saving, setSaving] = useState(false)
  const submission = useRef({ signature: '', id: '' })
  const [showMobileCart, setShowMobileCart] = useState(false)

  const loadPending = useCallback(() => listOfflineOrders().then(setPending).catch(() => setPending([])), [])

  useEffect(() => {
    api.get<Category[]>('/menu/categories').then(setCategories).catch(console.error)
    loadPending()
    if (existingTableId && !editOrderId) {
      api.get<{ label: string }>(`/tables/${existingTableId}`).then(table => setTableLabel(table.label)).catch(console.error)
    }
    if (editOrderId) {
      api.get<DiningOrderSummary>(`/orders/${editOrderId}`).then(order => {
        setTableLabel(order.diningTable?.label || order.customerName || '')
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

  const items = useMemo(() => {
    const q = search.trim().toLowerCase()
    return categories
      .filter(c => selectedCategory === 'ALL' || c.id === selectedCategory)
      .flatMap(c => c.items.map(i => ({ ...i, category: { name: c.name } })))
      .filter(i => !q || `${i.name} ${i.category?.name || ''}`.toLowerCase().includes(q))
  }, [categories, search, selectedCategory])

  const total = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart])
  const totalCount = useMemo(() => cart.reduce((s, i) => s + i.quantity, 0), [cart])
  const takeawayCount = useMemo(() => cart.filter(i => i.takeaway || i.notes?.includes('[PARA LLEVAR]')).reduce((s, i) => s + i.quantity, 0), [cart])
  const dineInCount = useMemo(() => totalCount - takeawayCount, [totalCount, takeawayCount])

  // Agregar producto (por defecto En Mesa o Llevar según botón)
  const addItem = (item: MenuItem, takeaway = false) => {
    setCart(prev => {
      // Si ya existe una línea exacta con el mismo producto, mismo takeaway y SIN notas particulares, incrementamos cantidad
      const existingIdx = prev.findIndex(p => p.menuItemId === item.id && p.takeaway === takeaway && !p.notes?.trim())
      if (existingIdx >= 0) {
        const copy = [...prev]
        copy[existingIdx] = { ...copy[existingIdx], quantity: copy[existingIdx].quantity + 1 }
        return copy
      }
      return [
        ...prev,
        {
          cartKey: genKey(item.id),
          menuItemId: item.id,
          name: item.name,
          price: item.price,
          quantity: 1,
          takeaway,
          notes: '',
        },
      ]
    })
  }

  // Modificar cantidad (+ / -) de una línea específica del carrito
  const updateQty = (cartKey: string, delta: number) => {
    setCart(prev =>
      prev
        .map(i => (i.cartKey === cartKey ? { ...i, quantity: i.quantity + delta } : i))
        .filter(i => i.quantity > 0)
    )
  }

  // Quitar producto completamente de una línea
  const removeItem = (cartKey: string) => {
    setCart(prev => prev.filter(i => i.cartKey !== cartKey))
  }

  // Disminuir o sumar desde la tarjeta del menú directamente
  const handleMenuCardDecrement = (menuItemId: string) => {
    setCart(prev => {
      // Buscar última línea agregada de este producto para restar
      const idx = prev.map(p => p.menuItemId).lastIndexOf(menuItemId)
      if (idx === -1) return prev
      const target = prev[idx]
      if (target.quantity > 1) {
        const copy = [...prev]
        copy[idx] = { ...target, quantity: target.quantity - 1 }
        return copy
      }
      return prev.filter((_, i) => i !== idx)
    })
  }

  // Separar una línea con cantidad > 1 en N ítems individuales de cantidad = 1
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
      }))

      const copy = [...prev]
      copy.splice(idx, 1, ...splitLines)
      return copy
    })
    alerts.toast('Separado en unidades individuales para notas y llevar independiente.')
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

      // Si tiene más de 1, restamos 1 a la actual y creamos una nueva línea individual con el nuevo estado
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
      })
      return copy
    })
  }

  // Cambiar todas las unidades de una línea a Mesa o Llevar
  const toggleAllTakeaway = (cartKey: string, targetTakeaway: boolean) => {
    setCart(prev => prev.map(i => (i.cartKey === cartKey ? { ...i, takeaway: targetTakeaway } : i)))
  }

  // Actualizar nota de una línea
  const updateNotes = (cartKey: string, value: string) => {
    setCart(prev => prev.map(i => (i.cartKey === cartKey ? { ...i, notes: value } : i)))
  }

  // Agregar chip rápido
  const appendNote = (cartKey: string, chipText: string) => {
    setCart(prev =>
      prev.map(i => {
        if (i.cartKey !== cartKey) return i
        const current = i.notes ? i.notes.trim() : ''
        if (current.toLowerCase().includes(chipText.toLowerCase())) return i
        return { ...i, notes: current ? `${current}, ${chipText}` : chipText }
      })
    )
  }

  // Unir ítems idénticos (mismo producto, mismo takeaway, misma nota)
  const mergeIdentical = () => {
    setCart(prev => {
      const merged: CartItem[] = []
      for (const item of prev) {
        const match = merged.find(
          m => m.menuItemId === item.menuItemId && m.takeaway === item.takeaway && (m.notes || '').trim() === (item.notes || '').trim()
        )
        if (match) {
          match.quantity += item.quantity
        } else {
          merged.push({ ...item })
        }
      }
      return merged
    })
    alerts.toast('Unidades idénticas agrupadas.')
  }

  const submit = async () => {
    if (saving) return
    if (cart.length === 0) {
      alerts.warning('Pedido vacío', 'Toca los productos del menú para agregarlos a la cuenta.')
      return
    }

    const effectiveTableLabel = tableLabel.trim() || 'Nueva Mesa'
    const displayLabel = tableLabel.trim() || 'Nueva Mesa (Automática)'

    let summaryText = `${totalCount} producto(s)`
    if (takeawayCount > 0 && dineInCount > 0) {
      summaryText += ` (${dineInCount} en mesa, ${takeawayCount} para llevar)`
    } else if (takeawayCount > 0) {
      summaryText += ` (Todos para llevar)`
    } else {
      summaryText += ` (Todos en mesa)`
    }

    const confirmed = await alerts.confirm(
      '¿Enviar pedido a cocina?',
      `${displayLabel}: ${summaryText}\nTotal: ${formatCurrency(total)}\nMesera: ${user?.name || 'Mesera'}`,
      '🚀 Enviar a cocina',
      'Revisar pedido',
      'question'
    )
    if (!confirmed) return

    const signature = JSON.stringify({ tableLabel: effectiveTableLabel, tableId: existingTableId, cart, notes })
    if (submission.current.signature !== signature) submission.current = { signature, id: genKey('sub') }
    const clientMutationId = submission.current.id

    const payload: OfflineTableOrderPayload = {
      clientMutationId,
      tableId: existingTableId || undefined,
      tableLabel: tableLabel.trim() || undefined,
      notes,
      items: cart.map(i => {
        let noteText = i.notes?.trim() || ''
        if (i.takeaway && !noteText.toLowerCase().includes('para llevar') && !noteText.toLowerCase().includes('llevar')) {
          noteText = noteText ? `[PARA LLEVAR] ${noteText}` : '[PARA LLEVAR]'
        } else if (!i.takeaway && !noteText.toLowerCase().includes('mesa')) {
          noteText = noteText ? `[MESA] ${noteText}` : '[MESA]'
        }
        return {
          menuItemId: i.menuItemId,
          quantity: i.quantity,
          notes: noteText || undefined,
        }
      }),
      paymentMethod: 'CASH',
      editOrderId: editOrderId || undefined,
    }

    setSaving(true)
    try {
      if (!navigator.onLine) throw new Error('offline')
      const res = editOrderId
        ? await api.put<{ table?: { id?: string; label?: string } }>(`/tables/orders/${editOrderId}`, payload)
        : await api.post<{ table?: { id?: string; label?: string } }>('/tables/orders', payload)
      alerts.toast(`Pedido enviado a cocina para ${res?.table?.label || displayLabel}`)
      setCart([])
      setNotes('')
      if (!existingTableId) setTableLabel('')
      navigate('/tables')
    } catch (err: any) {
      if (!navigator.onLine) {
        await saveOfflineOrder({ clientMutationId, createdAt: new Date().toISOString(), payload, status: 'PENDING' })
        await loadPending()
        alerts.warning('Guardado sin internet', 'El pedido queda guardado y se enviará al reconectar.')
        setCart([])
        navigate('/tables')
      } else {
        const msg = err?.response?.data?.message || err?.message || 'Error al enviar pedido a cocina'
        alerts.error('Error al enviar pedido', msg)
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
                <h1 className="text-base sm:text-lg font-black text-[var(--text-primary)] truncate">
                  {editOrderId ? 'Editar Pedido' : 'Tomar Pedido'}
                </h1>
                <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <User className="h-3 w-3" /> Mesera: {user?.name || 'Mesera'}
                </span>
              </div>
            </div>
            {!online && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-black text-amber-600 shrink-0">
                <WifiOff className="h-3 w-3" /> Sin internet
              </span>
            )}
          </div>

          {pending.length > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700">
              <span>{pending.length} pedido(s) pendientes por sincronizar.</span>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={syncPending}>
                Reintentar
              </Button>
            </div>
          )}

          {/* Nombre / Mesa del Pedido */}
          {!existingTableId ? (
            <div className="space-y-1.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 shadow-xs">
              <div className="flex items-center justify-between">
                <label htmlFor="account-name" className="text-xs font-black uppercase tracking-wider text-[var(--text-primary)]">
                  Mesa / Cliente / Referencia:
                </label>
                <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md">
                  ✨ Mesa automática
                </span>
              </div>
              <Input
                id="account-name"
                maxLength={80}
                autoComplete="off"
                value={tableLabel}
                onChange={e => setTableLabel(e.target.value)}
                placeholder="Ej. Mesa 4, Carlos, Carro rojo (o déjalo vacío)..."
                className="h-10 text-xs font-bold rounded-xl bg-[var(--bg-elevated)]"
              />
            </div>
          ) : (
            <div className="rounded-xl bg-[var(--accent)]/10 border border-[var(--accent)]/30 px-3 py-2 flex items-center justify-between">
              <span className="text-xs font-black text-[var(--text-primary)]">
                Agregando a: <strong className="text-[var(--accent)] text-sm">{tableLabel}</strong>
              </span>
              <span className="text-[10px] text-[var(--text-muted)] font-bold">Mesa existente</span>
            </div>
          )}

          {/* Buscador de productos */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar producto..."
              className="pl-9 pr-8 h-10 text-xs rounded-xl bg-[var(--bg-panel)]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* Pestañas de categorías fluidas */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar sticky top-0 z-10 bg-[var(--bg-base)] py-1.5">
            <button
              type="button"
              onClick={() => setSelectedCategory('ALL')}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-black whitespace-nowrap transition-all active:scale-95 cursor-pointer ${
                selectedCategory === 'ALL'
                  ? 'bg-[var(--accent)] text-white shadow-xs'
                  : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              Todos ({categories.reduce((acc, c) => acc + c.items.length, 0)})
            </button>
            {categories.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCategory(c.id)}
                className={`rounded-xl px-3.5 py-1.5 text-xs font-black whitespace-nowrap transition-all active:scale-95 cursor-pointer ${
                  selectedCategory === c.id
                    ? 'bg-[var(--accent)] text-white shadow-xs'
                    : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                {c.name} ({c.items.length})
              </button>
            ))}
          </div>

          {/* LISTA DE PRODUCTOS TÁCTIL (CLIC EN CUALQUIER PARTE PARA AGREGAR) */}
          <div className="grid gap-2.5 sm:grid-cols-2">
            {items.map(item => {
              const inCartItems = cart.filter(c => c.menuItemId === item.id)
              const inCartTotal = inCartItems.reduce((s, i) => s + i.quantity, 0)
              const inCartTakeaway = inCartItems.filter(i => i.takeaway).reduce((s, i) => s + i.quantity, 0)
              const inCartDineIn = inCartTotal - inCartTakeaway

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

                      {/* Resumen si ya está en la cuenta */}
                      {inCartTotal > 0 && (
                        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                          <span className="rounded-md bg-[var(--accent)] text-white text-[10px] font-black px-1.5 py-0.5">
                            {inCartTotal} en cuenta
                          </span>
                          {inCartTakeaway > 0 && (
                            <span className="rounded-md bg-amber-500 text-slate-950 text-[10px] font-black px-1.5 py-0.5">
                              {inCartTakeaway} llevar
                            </span>
                          )}
                          {inCartDineIn > 0 && inCartTakeaway > 0 && (
                            <span className="rounded-md bg-blue-500/15 text-blue-700 text-[10px] font-bold px-1.5 py-0.5">
                              {inCartDineIn} mesa
                            </span>
                          )}
                        </div>
                      )}
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
                            className="h-9 px-2.5 rounded-xl bg-amber-500/15 text-amber-800 dark:text-amber-300 font-bold text-xs border border-amber-500/30 hover:bg-amber-500/25 active:scale-90 transition cursor-pointer flex items-center gap-1"
                            title="Agregar para llevar"
                          >
                            🥡 Llevar
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
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

                          {/* Botón rápido para sumar para llevar */}
                          <button
                            type="button"
                            onClick={() => addItem(item, true)}
                            className="h-9 px-2 rounded-xl bg-amber-500/20 text-amber-900 dark:text-amber-200 font-black text-xs border border-amber-500/40 hover:bg-amber-500/30 active:scale-90 transition cursor-pointer flex items-center gap-0.5"
                            title="Sumar una unidad para llevar"
                          >
                            +🥡
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
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
          <div className="border-b border-[var(--border-subtle)] p-4 bg-[var(--bg-panel)]">
            <div className="flex items-center justify-between">
              <h2 className="font-black text-base text-[var(--text-primary)]">Cuenta del Pedido</h2>
              {cart.length > 1 && (
                <button
                  type="button"
                  onClick={mergeIdentical}
                  className="text-[10px] font-bold text-[var(--accent)] hover:underline flex items-center gap-1 cursor-pointer"
                  title="Agrupar ítems idénticos"
                >
                  <Layers className="h-3 w-3" /> Unir iguales
                </button>
              )}
            </div>
            <div className="mt-1 flex items-center justify-between text-xs text-[var(--text-secondary)]">
              <span>
                {totalCount} producto(s)
                {takeawayCount > 0 && <b className="ml-1 text-amber-600">({takeawayCount} llevar)</b>}
              </span>
              <b className="text-base font-black text-[var(--accent)]">{formatCurrency(total)}</b>
            </div>
          </div>

          {/* LISTA DE ÍTEMS EN CUENTA (DESKTOP) */}
          <div className="flex-1 space-y-3 overflow-y-auto p-3.5 min-h-0">
            {cart.map(item => (
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
                      {formatCurrency(item.price * item.quantity)}
                      {item.quantity > 1 && (
                        <span className="text-[10px] font-normal text-[var(--text-muted)] ml-1">
                          ({formatCurrency(item.price)} c/u)
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

                {/* TOGGLE MESA VS LLEVAR + OPCIONES DE SEPARAR */}
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
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-black transition-all cursor-pointer ${
                      item.takeaway
                        ? 'bg-amber-600 text-white shadow-xs'
                        : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    🥡 {item.quantity > 1 && !item.takeaway ? 'Pasar 1 a Llevar' : 'Para Llevar'}
                  </button>

                  {/* Botón para dividir en unidades independientes */}
                  {item.quantity > 1 && (
                    <button
                      type="button"
                      onClick={() => splitItem(item.cartKey)}
                      className="rounded-lg px-2 py-1 text-[10px] font-black bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/30 hover:bg-purple-500/20 active:scale-95 transition flex items-center gap-1 cursor-pointer"
                      title="Dividir en unidades individuales para notas o llevar independientes"
                    >
                      <Scissors className="h-3 w-3" /> Separar ({item.quantity})
                    </button>
                  )}
                </div>

                {/* CAMPO DE NOTA INDIVIDUAL */}
                <Input
                  value={item.notes || ''}
                  onChange={e => updateNotes(item.cartKey, e.target.value)}
                  placeholder="Nota (sin cebolla, salsas aparte...)"
                  className="mt-2 h-8 text-xs bg-[var(--bg-panel)] rounded-lg"
                />

                {/* Chips rápidos para notas */}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {QUICK_CHIPS.map(chip => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => appendNote(item.cartKey, chip)}
                      className="rounded-md bg-[var(--bg-panel)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition cursor-pointer"
                    >
                      +{chip}
                    </button>
                  ))}
                </div>

                {/* Si tiene varias unidades, sugerir aplicar a 1 solo si quiere */}
                {item.quantity > 1 && (
                  <div className="mt-1.5 pt-1.5 border-t border-[var(--border-subtle)]/50 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                    <span>💡 Aplica a los {item.quantity} productos.</span>
                    <button
                      type="button"
                      onClick={() => splitItem(item.cartKey)}
                      className="text-[var(--accent)] font-bold hover:underline"
                    >
                      Separar para notas individuales →
                    </button>
                  </div>
                )}
              </div>
            ))}

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
                ? 'Enviando...'
                : editOrderId
                ? 'Guardar y avisar cocina'
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
        <div className="fixed bottom-3 left-3 right-3 z-30 lg:hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
          <button
            type="button"
            onClick={() => setShowMobileCart(true)}
            className="flex w-full items-center justify-between rounded-2xl bg-[var(--accent)] px-4 py-3 text-white shadow-2xl active:scale-[0.98] transition-all cursor-pointer border border-white/20"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-black text-[var(--accent)] shadow-sm shrink-0">
                {totalCount}
              </span>
              <div className="text-left min-w-0">
                <p className="text-xs sm:text-sm font-black truncate">
                  Cuenta ({tableLabel || 'Sin nombre'})
                </p>
                <p className="text-[10px] text-white/80 font-semibold truncate">
                  {dineInCount} mesa {takeawayCount > 0 ? `• ${takeawayCount} llevar` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm sm:text-base font-black">{formatCurrency(total)}</span>
              <span className="rounded-xl bg-black/25 px-2.5 py-1 text-xs font-bold flex items-center gap-1">
                Ver Cuenta <ChevronRight className="h-3.5 w-3.5" />
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
                  Cuenta ({tableLabel || 'Mesa nueva'})
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
            {cart.map(item => (
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
                      {formatCurrency(item.price * item.quantity)}
                      {item.quantity > 1 && (
                        <span className="text-[10px] font-normal text-[var(--text-muted)] ml-1">
                          ({formatCurrency(item.price)} c/u)
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
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-black transition-all cursor-pointer ${
                      item.takeaway
                        ? 'bg-amber-600 text-white shadow-xs'
                        : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border border-[var(--border-subtle)]'
                    }`}
                  >
                    🥡 {item.quantity > 1 && !item.takeaway ? 'Pasar 1 a Llevar' : 'Para Llevar'}
                  </button>

                  {item.quantity > 1 && (
                    <button
                      type="button"
                      onClick={() => splitItem(item.cartKey)}
                      className="rounded-lg px-2 py-1 text-[10px] font-black bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/30 active:scale-95 transition flex items-center gap-1 cursor-pointer"
                    >
                      <Scissors className="h-3 w-3" /> Separar ({item.quantity})
                    </button>
                  )}
                </div>

                {/* Campo de notas móvil */}
                <Input
                  value={item.notes || ''}
                  onChange={e => updateNotes(item.cartKey, e.target.value)}
                  placeholder="Nota: sin cebolla, salsas aparte..."
                  className="mt-2 h-8 text-xs bg-[var(--bg-panel)] rounded-lg"
                />

                {/* Chips rápidos */}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {QUICK_CHIPS.map(chip => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => appendNote(item.cartKey, chip)}
                      className="rounded-md bg-[var(--bg-panel)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition"
                    >
                      +{chip}
                    </button>
                  ))}
                </div>

                {item.quantity > 1 && (
                  <div className="mt-1.5 pt-1.5 border-t border-[var(--border-subtle)]/50 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                    <span>💡 Nota para las {item.quantity} unidades.</span>
                    <button
                      type="button"
                      onClick={() => splitItem(item.cartKey)}
                      className="text-[var(--accent)] font-bold"
                    >
                      Separar unidades →
                    </button>
                  </div>
                )}
              </div>
            ))}
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
                ? 'Guardando...'
                : editOrderId
                ? 'Guardar y avisar cocina'
                : `Enviar a cocina (${formatCurrency(total)})`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
