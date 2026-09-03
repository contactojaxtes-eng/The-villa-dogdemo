import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Minus, Plus, Save, Search, Send, User, UtensilsCrossed, WifiOff } from 'lucide-react'
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
            cartKey: `${item.menuItemId}_${isTakeaway ? 'takeaway' : 'dinein'}_${idx}`,
            menuItemId: item.menuItemId,
            name: item.menuItem?.name || 'Producto',
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

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const totalCount = cart.reduce((s, i) => s + i.quantity, 0)

  const addItem = (item: MenuItem, takeaway = false) => {
    setCart(prev => {
      const targetKey = `${item.id}_${takeaway ? 'takeaway' : 'dinein'}`
      const found = prev.find(p => p.cartKey === targetKey)
      if (found) return prev.map(p => p.cartKey === targetKey ? { ...p, quantity: p.quantity + 1 } : p)
      return [...prev, {
        cartKey: targetKey,
        menuItemId: item.id,
        name: item.name,
        price: item.price,
        quantity: 1,
        takeaway,
        notes: '',
      }]
    })
  }

  const toggleTakeaway = (cartKey: string, takeaway: boolean) => {
    setCart(prev => {
      const item = prev.find(p => p.cartKey === cartKey)
      if (!item || item.takeaway === takeaway) return prev
      const newKey = `${item.menuItemId}_${takeaway ? 'takeaway' : 'dinein'}`
      const existingNew = prev.find(p => p.cartKey === newKey && p.cartKey !== cartKey)
      if (existingNew) {
        return prev
          .map(p => p.cartKey === newKey ? { ...p, quantity: p.quantity + item.quantity } : p)
          .filter(p => p.cartKey !== cartKey)
      }
      return prev.map(p => p.cartKey === cartKey ? { ...p, cartKey: newKey, takeaway } : p)
    })
  }

  const appendNote = (cartKey: string, chipText: string) => {
    setCart(prev => prev.map(i => {
      if (i.cartKey !== cartKey) return i
      const current = i.notes ? i.notes.trim() : ''
      if (current.toLowerCase().includes(chipText.toLowerCase())) return i
      return { ...i, notes: current ? `${current}, ${chipText}` : chipText }
    }))
  }

  const updateQty = (cartKey: string, delta: number) => {
    setCart(prev => prev.map(i => i.cartKey === cartKey ? { ...i, quantity: i.quantity + delta } : i).filter(i => i.quantity > 0))
  }

  const updateNotes = (cartKey: string, value: string) => {
    setCart(prev => prev.map(i => i.cartKey === cartKey ? { ...i, notes: value } : i))
  }

  const submit = async () => {
    if (saving) return
    if (cart.length === 0) {
      alerts.warning('Pedido vacío', 'Agrega al menos un producto a la cuenta tocando "+ Agregar".')
      return
    }

    const effectiveTableLabel = tableLabel.trim() || 'Nueva Mesa'
    const displayLabel = tableLabel.trim() || 'Nueva Mesa (Automática)'

    const takeawayCount = cart.filter(i => i.takeaway || i.notes?.includes('[PARA LLEVAR]')).reduce((s, i) => s + i.quantity, 0)
    const dineInCount = totalCount - takeawayCount

    let summaryText = `${totalCount} producto(s)`
    if (takeawayCount > 0 && dineInCount > 0) {
      summaryText += ` (${dineInCount} en mesa, ${takeawayCount} para llevar)`
    } else if (takeawayCount > 0) {
      summaryText += ` (Todos para llevar)`
    }

    const confirmed = await alerts.confirm(
      '¿Enviar pedido a cocina?',
      `${displayLabel}: ${summaryText} • Total: ${formatCurrency(total)}\nMesera: ${user?.name || 'Mesero'}`,
      '🚀 Enviar a cocina',
      'Revisar pedido',
      'question'
    )
    if (!confirmed) return

    const signature = JSON.stringify({ tableLabel: effectiveTableLabel, tableId: existingTableId, cart, notes })
    if (submission.current.signature !== signature) submission.current = { signature, id: crypto.randomUUID() }
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
    <div className="grid min-h-[calc(100dvh-95px)] gap-4 items-start lg:grid-cols-[1fr_370px] pb-32 lg:pb-6">
      <section className="space-y-3">
        {/* Cabecera compacta con identificación de la mesera */}
        <div className="flex items-center justify-between gap-2 bg-[var(--bg-panel)] p-2.5 rounded-2xl border border-[var(--border-subtle)] shadow-xs">
          <div className="flex items-center gap-2 min-w-0">
            <Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <Link to="/tables"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-black text-[var(--text-primary)] truncate">
                {editOrderId ? 'Editar Pedido' : 'Nuevo Pedido'}
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
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={syncPending}>Reintentar</Button>
          </div>
        )}

        {/* Identificador de Mesa o Pedido Dinámico */}
        {!existingTableId ? (
          <div className="space-y-1.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3 shadow-xs">
            <div className="flex items-center justify-between">
              <label htmlFor="account-name" className="text-xs font-black uppercase tracking-wider text-[var(--text-primary)]">
                Mesa / Cliente / Referencia:
              </label>
              <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md">
                ✨ Nueva mesa automática
              </span>
            </div>
            <Input
              id="account-name"
              maxLength={80}
              autoComplete="off"
              value={tableLabel}
              onChange={e => setTableLabel(e.target.value)}
              placeholder="Opcional: Ej. Mesa 4, Carlos, Carro rojo (o déjalo en blanco)..."
              className="h-10 text-xs font-bold rounded-xl bg-[var(--bg-elevated)]"
            />
            <p className="text-[10px] text-[var(--text-muted)]">
              💡 Cada pedido abre una nueva mesa automáticamente. No tienes que configurar mesas antes.
            </p>
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
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar perro, hamburguesa, bebida..."
            className="pl-8 h-9 text-xs rounded-xl bg-[var(--bg-panel)]"
          />
        </div>

        {/* Pestañas de categorías con scroll horizontal fluido */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar sticky top-0 z-10 bg-[var(--bg-base)] py-1">
          <button
            type="button"
            onClick={() => setSelectedCategory('ALL')}
            className={`rounded-xl px-3 py-1.5 text-xs font-black whitespace-nowrap transition-all active:scale-95 cursor-pointer ${
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
              className={`rounded-xl px-3 py-1.5 text-xs font-black whitespace-nowrap transition-all active:scale-95 cursor-pointer ${
                selectedCategory === c.id
                  ? 'bg-[var(--accent)] text-white shadow-xs'
                  : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {c.name} ({c.items.length})
            </button>
          ))}
        </div>

        {/* Lista de productos táctil optimizada para celular */}
        <div className="space-y-2">
          {items.map(item => {
            const dineInKey = `${item.id}_dinein`
            const takeawayKey = `${item.id}_takeaway`
            const dineInItem = cart.find(c => c.cartKey === dineInKey)
            const takeawayItem = cart.find(c => c.cartKey === takeawayKey)
            const inCartQty = (dineInItem?.quantity || 0) + (takeawayItem?.quantity || 0)

            return (
              <div
                key={item.id}
                className={`rounded-2xl border p-3 bg-[var(--bg-panel)] shadow-2xs transition-all flex items-center justify-between gap-3 ${
                  inCartQty > 0
                    ? 'border-[var(--accent)] bg-[var(--accent)]/5 ring-1 ring-[var(--accent)]/30'
                    : 'border-[var(--border-subtle)] hover:border-[var(--border-default)]'
                }`}
              >
                {/* Nombre y Precio */}
                <div className="min-w-0 flex-1">
                  <p className="font-black text-sm text-[var(--text-primary)] leading-tight">{item.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs font-black text-[var(--accent)]">{formatCurrency(item.price)}</span>
                    <span className="text-[10px] text-[var(--text-muted)] font-medium truncate">{item.category?.name}</span>
                  </div>
                </div>

                {/* Botones de acción táctil */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {inCartQty === 0 ? (
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => addItem(item, false)}
                        className="h-8.5 px-3 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-black text-xs gap-1 shadow-xs active:scale-95 cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5 stroke-[3]" />
                        <span>Agregar</span>
                      </Button>
                      <button
                        type="button"
                        onClick={() => addItem(item, true)}
                        className="h-8.5 px-2 rounded-xl bg-amber-500/15 text-amber-800 dark:text-amber-300 font-bold text-[10px] border border-amber-500/30 hover:bg-amber-500/25 active:scale-95 transition cursor-pointer"
                        title="Agregar para llevar"
                      >
                        🥡 Llevar
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      {/* Contador directo en el producto */}
                      <div className="flex items-center gap-1 bg-[var(--bg-elevated)] p-1 rounded-xl border border-[var(--border-subtle)]">
                        <button
                          type="button"
                          onClick={() => {
                            if (dineInItem) updateQty(dineInKey, -1)
                            else if (takeawayItem) updateQty(takeawayKey, -1)
                          }}
                          className="h-7 w-7 rounded-lg bg-[var(--bg-panel)] flex items-center justify-center text-[var(--text-primary)] hover:bg-rose-50 hover:text-rose-600 active:scale-90 font-black transition cursor-pointer"
                        >
                          <Minus className="h-3.5 w-3.5 stroke-[3]" />
                        </button>
                        <span className="w-5 text-center font-black text-sm text-[var(--text-primary)]">
                          {inCartQty}
                        </span>
                        <button
                          type="button"
                          onClick={() => addItem(item, false)}
                          className="h-7 w-7 rounded-lg bg-[var(--accent)] text-white flex items-center justify-center active:scale-90 font-black transition shadow-2xs cursor-pointer"
                        >
                          <Plus className="h-3.5 w-3.5 stroke-[3]" />
                        </button>
                      </div>

                      {/* Botón rápido para sumar para llevar */}
                      <button
                        type="button"
                        onClick={() => addItem(item, true)}
                        className="h-8 px-1.5 rounded-xl bg-amber-500/15 text-amber-800 dark:text-amber-300 font-bold text-[10px] border border-amber-500/30 hover:bg-amber-500/25 active:scale-95 transition cursor-pointer"
                        title="Sumar para llevar"
                      >
                        +🥡
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Desktop Sticky Right Cart Panel */}
      <aside className="hidden lg:flex sticky top-4 max-h-[calc(100vh-6rem)] flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-sm">
        <div className="border-b border-[var(--border-subtle)] p-4">
          <h2 className="font-black text-lg text-[var(--text-primary)]">Cuenta actual</h2>
          <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
            <span>{cart.reduce((s, i) => s + i.quantity, 0)} producto(s)</span>
            <b className="text-sm font-black text-[var(--accent)]">{formatCurrency(total)}</b>
          </div>
        </div>

        <div className="flex-1 space-y-2.5 overflow-y-auto p-4 min-h-0">
          {cart.map(item => (
            <div key={item.cartKey} className={`rounded-xl border p-3 ${item.takeaway ? 'border-amber-500/40 bg-amber-500/5' : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-black text-[var(--text-primary)]">{item.name}</p>
                    {item.takeaway ? (
                      <span className="rounded-full bg-amber-500 text-slate-950 font-black px-2 py-0.2 text-[9px] uppercase tracking-wide">
                        🥡 Llevar
                      </span>
                    ) : (
                      <span className="rounded-full bg-blue-500/15 text-blue-700 font-bold px-1.5 py-0.2 text-[9px]">
                        🍽️ Mesa
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-black text-[var(--accent)] mt-0.5">{formatCurrency(item.price * item.quantity)}</p>
                </div>
                <div className="flex items-center gap-1 rounded-lg bg-[var(--bg-panel)] p-1 border border-[var(--border-subtle)]">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => updateQty(item.cartKey, -1)}><Minus className="h-3 w-3" /></Button>
                  <span className="w-6 text-center text-xs font-black">{item.quantity}</span>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => updateQty(item.cartKey, 1)}><Plus className="h-3 w-3" /></Button>
                </div>
              </div>

              {/* Toggles Mesa vs Llevar */}
              <div className="mt-2 flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => toggleTakeaway(item.cartKey, false)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-black transition-all ${
                    !item.takeaway
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  🍽️ En Mesa
                </button>
                <button
                  type="button"
                  onClick={() => toggleTakeaway(item.cartKey, true)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-black transition-all ${
                    item.takeaway
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  🥡 Para Llevar
                </button>
              </div>

              <Input
                value={item.notes || ''}
                onChange={e => updateNotes(item.cartKey, e.target.value)}
                placeholder="Nota: sin cebolla, salsas aparte..."
                className="mt-2 h-8 text-xs bg-[var(--bg-panel)]"
              />

              {/* Quick Chips for notes */}
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
            </div>
          ))}
          {cart.length === 0 && (
            <div className="py-12 text-center text-sm text-[var(--text-muted)]">
              <p className="font-medium">Cuenta vacía</p>
              <p className="text-xs">Toca los productos para agregarlos.</p>
            </div>
          )}
        </div>

        <div className="space-y-2.5 border-t border-[var(--border-subtle)] p-4 bg-[var(--bg-panel)] rounded-b-2xl">
          <Textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Nota general para cocina o caja..."
            rows={2}
            className="text-xs resize-none"
          />
          <Button
            onClick={submit}
            disabled={saving || cart.length === 0}
            className="h-12 w-full gap-2 bg-[var(--accent)] text-[var(--accent-fg)] font-black text-base shadow-md hover:bg-[var(--accent-hover)] transition-all"
          >
            <Send className="h-5 w-5" />
            {saving ? 'Guardando...' : editOrderId ? 'Guardar y avisar cocina' : `Enviar a cocina (${formatCurrency(total)})`}
          </Button>
          <p className="flex items-center justify-center gap-1 text-[10px] text-[var(--text-muted)]">
            <Save className="h-3 w-3" />
            Despacha automáticamente a las estaciones correspondientes.
          </p>
        </div>
      </aside>

      {/* Mobile Floating Cart Button Bar */}
      {cart.length > 0 && (
        <div className="fixed bottom-20 left-3 right-3 z-30 lg:hidden animate-in fade-in slide-in-from-bottom-3 duration-200">
          <button
            type="button"
            onClick={() => setShowMobileCart(true)}
            className="flex w-full items-center justify-between rounded-2xl bg-[var(--accent)] px-4 py-3.5 text-white shadow-2xl active:scale-95 transition-all"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-black text-[var(--accent)] shadow">
                {cart.reduce((s, i) => s + i.quantity, 0)}
              </span>
              <span className="text-xs sm:text-sm font-black">Ver Cuenta ({tableLabel || 'Sin nombre'})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm sm:text-base font-black">{formatCurrency(total)}</span>
              <span className="rounded-xl bg-black/20 px-2.5 py-1 text-xs font-bold">Revisar →</span>
            </div>
          </button>
        </div>
      )}

      {/* Mobile Cart Sheet / Modal */}
      <Dialog open={showMobileCart} onOpenChange={setShowMobileCart}>
        <DialogContent className="max-w-md p-0 overflow-hidden bg-[var(--bg-panel)] rounded-2xl border-none">
          <div className="border-b border-[var(--border-subtle)] p-4 flex justify-between items-center bg-[var(--bg-panel)]">
            <div>
              <h2 className="font-black text-base sm:text-lg text-[var(--text-primary)]">Cuenta ({tableLabel || 'Sin nombre'})</h2>
              <p className="text-xs text-[var(--text-secondary)]">{cart.reduce((s, i) => s + i.quantity, 0)} producto(s) - <b className="text-[var(--accent)]">{formatCurrency(total)}</b></p>
            </div>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-xs font-bold" onClick={() => setShowMobileCart(false)}>✕</Button>
          </div>

          <div className="max-h-[50vh] space-y-2.5 overflow-y-auto p-4 min-h-0">
            {cart.map(item => (
              <div key={item.cartKey} className={`rounded-xl border p-2.5 ${item.takeaway ? 'border-amber-500/40 bg-amber-500/5' : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-xs sm:text-sm font-black text-[var(--text-primary)]">{item.name}</p>
                      {item.takeaway ? (
                        <span className="rounded-full bg-amber-500 text-slate-950 font-black px-1.5 py-0.2 text-[9px] uppercase tracking-wide">
                          🥡 Llevar
                        </span>
                      ) : (
                        <span className="rounded-full bg-blue-500/15 text-blue-700 font-bold px-1.5 py-0.2 text-[9px]">
                          🍽️ Mesa
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-black text-[var(--accent)] mt-0.5">{formatCurrency(item.price * item.quantity)}</p>
                  </div>
                  <div className="flex items-center gap-1 rounded-lg bg-[var(--bg-panel)] p-1 border border-[var(--border-subtle)]">
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => updateQty(item.cartKey, -1)}><Minus className="h-3 w-3" /></Button>
                    <span className="w-5 text-center text-xs font-black">{item.quantity}</span>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => updateQty(item.cartKey, 1)}><Plus className="h-3 w-3" /></Button>
                  </div>
                </div>

                {/* Toggles Mesa vs Llevar */}
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => toggleTakeaway(item.cartKey, false)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-black transition-all ${
                      !item.takeaway
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border border-[var(--border-subtle)]'
                    }`}
                  >
                    🍽️ En Mesa
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleTakeaway(item.cartKey, true)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-black transition-all ${
                      item.takeaway
                        ? 'bg-amber-600 text-white shadow-sm'
                        : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border border-[var(--border-subtle)]'
                    }`}
                  >
                    🥡 Para Llevar
                  </button>
                </div>

                <Input
                  value={item.notes || ''}
                  onChange={e => updateNotes(item.cartKey, e.target.value)}
                  placeholder="Nota: sin cebolla, salsas aparte..."
                  className="mt-1.5 h-7 text-xs bg-[var(--bg-panel)]"
                />

                {/* Quick Chips for notes */}
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
              </div>
            ))}
          </div>

          <div className="space-y-2 border-t border-[var(--border-subtle)] p-4 bg-[var(--bg-panel)]">
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Nota general para cocina o caja..."
              rows={2}
              className="text-xs resize-none"
            />
            <Button
              onClick={() => {
                setShowMobileCart(false)
                submit()
              }}
              disabled={saving || cart.length === 0}
              className="h-12 w-full gap-2 bg-[var(--accent)] text-[var(--accent-fg)] font-black text-sm shadow-md hover:bg-[var(--accent-hover)] transition-all"
            >
              <Send className="h-4 w-4" />
              {saving ? 'Guardando...' : editOrderId ? 'Guardar y avisar cocina' : `Enviar a cocina (${formatCurrency(total)})`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
