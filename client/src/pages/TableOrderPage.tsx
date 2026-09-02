import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Minus, Plus, Save, Search, Send, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { formatCurrency } from '@/lib/utils'
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

const QUICK_TABLES = ['Mesa 1', 'Mesa 2', 'Mesa 3', 'Mesa 4', 'Mesa 5', 'Mesa 6', 'Mesa 7', 'Mesa 8', 'Mesa 9', 'Mesa 10']
const QUICK_CHIPS = ['Sin cebolla', 'Salsas aparte', 'Sin ripio', 'Bien dorado', 'Sin salsas', 'Poco picante']

export default function TableOrderPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const existingTableId = params.get('tableId') || ''
  const editOrderId = params.get('editOrderId') || ''
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL')
  const [tableLabel, setTableLabel] = useState('Mesa 1')
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [pending, setPending] = useState<OfflineTableOrder[]>([])
  const [online, setOnline] = useState(navigator.onLine)
  const [saving, setSaving] = useState(false)
  const [showMobileCart, setShowMobileCart] = useState(false)

  const loadPending = useCallback(() => listOfflineOrders().then(setPending).catch(() => setPending([])), [])

  useEffect(() => {
    api.get<Category[]>('/menu/categories').then(setCategories).catch(console.error)
    loadPending()
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
  }, [editOrderId, loadPending])

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
    const effectiveTableLabel = (tableLabel.trim() || 'Mesa 1')
    if (cart.length === 0) {
      alerts.warning('Pedido vacío', 'Agrega al menos un producto a la cuenta.')
      return
    }

    const totalCount = cart.reduce((s, i) => s + i.quantity, 0)
    const takeawayCount = cart.filter(i => i.takeaway || i.notes?.includes('[PARA LLEVAR]')).reduce((s, i) => s + i.quantity, 0)
    const dineInCount = totalCount - takeawayCount

    let summaryText = `${totalCount} producto(s)`
    if (takeawayCount > 0 && dineInCount > 0) {
      summaryText += ` (${dineInCount} para comer en mesa, ${takeawayCount} para llevar)`
    } else if (takeawayCount > 0) {
      summaryText += ` (Todos para llevar)`
    }

    // Confirmación interactiva antes de enviar a cocina
    const confirmed = await alerts.confirm(
      '¿Enviar pedido a cocina?',
      `${effectiveTableLabel}: ${summaryText} • Total: ${formatCurrency(total)}`,
      '🚀 Enviar a cocina',
      'Revisar pedido',
      'question'
    )
    if (!confirmed) return

    const clientMutationId = crypto.randomUUID()
    const payload: OfflineTableOrderPayload = {
      clientMutationId,
      tableId: existingTableId || undefined,
      tableLabel: effectiveTableLabel,
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
      alerts.toast(`Pedido enviado a cocina para ${res?.table?.label || tableLabel}`)
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
    <div className="grid min-h-[calc(100dvh-95px)] gap-4 items-start lg:grid-cols-[1fr_370px]">
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon"><Link to="/tables"><ArrowLeft className="h-5 w-5" /></Link></Button>
            <div>
              <h1 className="text-2xl font-black text-[var(--text-primary)]">{editOrderId ? 'Editar Pedido' : 'Nuevo Pedido'}</h1>
              <p className="text-xs text-[var(--text-secondary)]">{online ? 'Conectado: despacho directo a estaciones de cocina.' : 'Sin conexión: guardando en este dispositivo.'}</p>
            </div>
          </div>
          {!online && <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-black text-amber-600"><WifiOff className="h-4 w-4" />Sin conexión</span>}
        </div>

        {pending.length > 0 && (
          <div className="flex items-center justify-between rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700">
            <span>{pending.length} pedido(s) pendientes por sincronizar.</span>
            <Button size="sm" variant="outline" onClick={syncPending}>Reintentar</Button>
          </div>
        )}

        {!existingTableId && (
          <div className="space-y-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-black text-[var(--text-muted)] uppercase tracking-wider mr-1">Mesas:</span>
              {QUICK_TABLES.map(label => {
                const isSelected = tableLabel === label
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setTableLabel(label)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-black transition-all ${
                      isSelected
                        ? 'bg-[var(--accent)] text-white shadow-sm scale-105 ring-2 ring-[var(--accent)]'
                        : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)]'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <Input
              value={tableLabel}
              onChange={e => setTableLabel(e.target.value)}
              placeholder="Nombre de mesa o cuenta: Mesa 1, Carro rojo, Barra..."
              className="h-11 text-base font-bold"
            />
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto..." className="pl-9" />
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          <button
            type="button"
            onClick={() => setSelectedCategory('ALL')}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-black whitespace-nowrap transition-all ${
              selectedCategory === 'ALL'
                ? 'bg-[var(--accent)] text-white shadow-sm'
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
              className={`rounded-xl px-3.5 py-1.5 text-xs font-black whitespace-nowrap transition-all ${
                selectedCategory === c.id
                  ? 'bg-[var(--accent)] text-white shadow-sm'
                  : 'bg-[var(--bg-panel)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {c.name} ({c.items.length})
            </button>
          ))}
        </div>

        {/* Product Grid - 2 columns on mobile */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {items.map(item => {
            const inCartQty = cart.filter(c => c.menuItemId === item.id).reduce((s, c) => s + c.quantity, 0)
            return (
              <div
                key={item.id}
                onClick={() => addItem(item, false)}
                className={`relative rounded-2xl border p-2.5 sm:p-3.5 text-left shadow-sm transition-all hover:scale-[1.01] active:scale-95 cursor-pointer flex flex-col justify-between ${
                  inCartQty > 0
                    ? 'border-[var(--accent)] bg-[var(--accent)]/5 ring-1 ring-[var(--accent)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-panel)] hover:border-[var(--accent)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-1">
                    <p className="font-black text-xs sm:text-sm text-[var(--text-primary)] pr-2 line-clamp-2">{item.name}</p>
                    {inCartQty > 0 && (
                      <span className="shrink-0 flex h-5 w-5 sm:h-6 sm:w-6 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] sm:text-xs font-black text-white shadow">
                        {inCartQty}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] sm:text-xs text-[var(--text-muted)] truncate">{item.category?.name}</p>
                </div>
                <div className="mt-2 flex items-center justify-between gap-1">
                  <p className="text-xs sm:text-sm font-black text-[var(--accent)]">{formatCurrency(item.price)}</p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      addItem(item, true)
                    }}
                    className="rounded-lg bg-amber-500/20 text-amber-900 dark:text-amber-300 px-2 py-0.5 text-[10px] font-black hover:bg-amber-500/30 transition border border-amber-500/30"
                    title="Agregar para llevar"
                  >
                    🥡 +1 Llevar
                  </button>
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
              <span className="text-xs sm:text-sm font-black">Ver Cuenta ({tableLabel || 'Mesa 1'})</span>
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
              <h2 className="font-black text-base sm:text-lg text-[var(--text-primary)]">Cuenta ({tableLabel || 'Mesa 1'})</h2>
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
