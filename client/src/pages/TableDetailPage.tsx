import { ProtectedImage } from '@/components/ProtectedImage'
import { useEffect, useRef, useState } from 'react'
import { prepareReceiptPhoto } from '@/lib/receiptPhoto'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { io } from '@/lib/socket'
import { ArrowLeft, Camera, CheckCircle2, ChefHat, Clock, Eye, Image as ImageIcon, Pencil, PlusCircle, Trash2, Upload, User, Wallet, X, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { formatCurrency } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'

interface ProofPhoto {
  id: string
  file: File
  previewUrl: string
  name: string
}

export default function TableDetailPage() {
  const navigate = useNavigate()
  const { id = '' } = useParams()
  const { user } = useAuth()
  const [table, setTable] = useState<any>(null)
  const [method, setMethod] = useState<'CASH' | 'TRANSFER' | 'MIXED'>('CASH')
  const [amount, setAmount] = useState('')
  const [mixedCash, setMixedCash] = useState('')
  const [mixedTransfer, setMixedTransfer] = useState('')
  const [reference, setReference] = useState('')
  const [proofs, setProofs] = useState<ProofPhoto[]>([])
  const [zoomUrl, setZoomUrl] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [preparingPhoto, setPreparingPhoto] = useState(false)
  const photoSelection = useRef(0)
  const paymentAttempt = useRef({ signature: '', id: '' })
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = () => api.get<any>(`/tables/${id}`).then(t => {
    setTable(t)
    const bal = Math.max(t.balance ?? t.total ?? 0, 0)
    setAmount(String(bal))
    if (!mixedCash && !mixedTransfer) {
      setMixedCash(String(Math.floor(bal / 2)))
      setMixedTransfer(String(bal - Math.floor(bal / 2)))
    }
  }).catch(console.error)

  const handleMixedCashChange = (val: string) => {
    const raw = val.replace(/\D/g, '')
    const num = Number(raw) || 0
    setMixedCash(raw)
    const bal = Number(amount) || table?.balance || table?.total || 0
    const rem = Math.max(bal - num, 0)
    setMixedTransfer(String(rem))
  }

  const handleMixedTransferChange = (val: string) => {
    const raw = val.replace(/\D/g, '')
    const num = Number(raw) || 0
    setMixedTransfer(raw)
    const bal = Number(amount) || table?.balance || table?.total || 0
    const rem = Math.max(bal - num, 0)
    setMixedCash(String(rem))
  }

  const handleCancelOrder = async (orderId: string, orderNumber: number) => {
    const isWaiter = user?.role === 'WAITER'
    const promptMsg = isWaiter
      ? `¿Solicitar cancelación del Pedido #${orderNumber}?\n\nLa solicitud será enviada al Administrador/Cajero para su aprobación y retiro de la mesa. Escribe el motivo:`
      : `¿Cancelar Pedido #${orderNumber}?\n\nEscribe el motivo de la cancelación:`
    
    const reason = prompt(promptMsg, 'Cliente solicitó cancelación')
    if (reason === null) return
    if (!reason.trim()) {
      alerts.warning('Motivo requerido', 'Debes escribir el motivo de la cancelación.')
      return
    }

    try {
      const res: any = await api.put(`/orders/${orderId}/cancel`, { reason: reason.trim() })
      if (res?.requested || isWaiter) {
        alerts.success('Solicitud enviada a Caja', `La cancelación del pedido #${orderNumber} fue enviada al Administrador para su validación.`)
      } else {
        alerts.success('Pedido cancelado', `El pedido #${orderNumber} fue cancelado y retirado de la cuenta.`)
      }
      load()
    } catch (err: any) {
      alerts.error('No se pudo cancelar', err?.response?.data?.message || err?.message || 'Error al cancelar')
    }
  }

  useEffect(() => { load() }, [id])

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      query: { userId: user?.id, userName: user?.name, userRole: user?.role },
      transports: ['websocket', 'polling'],
    })
    socket.on('tableUpdated', (payload: any) => { if (payload?.id === id) load() })
    socket.on('tableClosed', (payload: any) => {
      if (payload?.id === id) {
        alerts.success('Mesa liberada', 'La cuenta ha sido completada y la mesa quedó libre.')
        navigate('/tables')
      }
    })
    socket.on('kitchenTicketReady', (payload: any) => {
      if (payload?.order?.tableId === id) {
        alerts.success('Pedido listo', `${payload.station?.name || 'Cocina'} marcó listo ${payload.order?.diningTable?.label || table?.label || ''}.`)
        load()
      }
    })
    socket.on('paymentValidated', (payload: any) => {
      if (payload?.table?.id === id) {
        alerts.success('Pago confirmado', 'El pago fue aprobado y validado en caja.')
        load()
      }
    })
    socket.on('paymentRejected', (payload: any) => {
      if (payload?.table?.id === id) {
        alerts.warning('Pago rechazado', payload?.reason ? `Motivo: ${payload.reason}` : 'El comprobante no fue aceptado.')
        load()
      }
    })
    return () => { socket.disconnect() }
  }, [id, user?.id, user?.name, user?.role, table?.label])

  useEffect(() => () => {
    proofs.forEach(p => URL.revokeObjectURL(p.previewUrl))
  }, [])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFiles = Array.from(e.target.files || [])
    e.target.value = ''
    if (rawFiles.length === 0) return

    setPreparingPhoto(true)
    try {
      const newItems: ProofPhoto[] = []
      for (const f of rawFiles) {
        const prepared = await prepareReceiptPhoto(f)
        newItems.push({
          id: crypto.randomUUID(),
          file: prepared,
          previewUrl: URL.createObjectURL(prepared),
          name: prepared.name,
        })
      }
      setProofs(prev => [...prev, ...newItems])
    } catch (error: any) {
      alerts.error('No se pudo procesar la foto', error.message)
    } finally {
      setPreparingPhoto(false)
    }
  }

  const removeProof = (proofId: string) => {
    setProofs(prev => {
      const target = prev.find(p => p.id === proofId)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter(p => p.id !== proofId)
    })
  }

  const clearProofs = () => {
    setProofs(prev => {
      prev.forEach(p => URL.revokeObjectURL(p.previewUrl))
      return []
    })
  }

  const submitPayment = async () => {
    if (sending || preparingPhoto) return
    if (method === 'TRANSFER' && proofs.length === 0) {
      alerts.warning('Foto obligatoria', 'Para pagos por transferencia es obligatorio tomar o subir la foto del comprobante.')
      return
    }

    if (method === 'MIXED') {
      const cash = Number(mixedCash) || 0
      const transfer = Number(mixedTransfer) || 0
      const bal = Number(amount) || table?.balance || table?.total || 0
      if (cash <= 0 || transfer <= 0) {
        alerts.warning('Montos requeridos', 'En pago mixto debes ingresar cuánto en efectivo y cuánto en transferencia.')
        return
      }
      if (Math.abs((cash + transfer) - bal) > 1) {
        alerts.warning('Montos no coinciden', `La suma de efectivo (${formatCurrency(cash)}) y transferencia (${formatCurrency(transfer)}) debe ser igual al total (${formatCurrency(bal)}).`)
        return
      }
      if (proofs.length === 0) {
        alerts.warning('Foto obligatoria', 'Para pagos mixtos debes tomar o subir la foto del comprobante de transferencia.')
        return
      }
    }

    setSending(true)
    try {
      const form = new FormData()
      const photoSignatures = proofs.map(p => p.name).join(',')
      const signature = `${id}:${method}:${amount}:${mixedCash}:${mixedTransfer}:${reference}:${photoSignatures}`
      if (paymentAttempt.current.signature !== signature) paymentAttempt.current = { signature, id: crypto.randomUUID() }
      form.append('clientMutationId', paymentAttempt.current.id)
      form.append('method', method)
      form.append('amount', amount || String(table?.balance || table?.total || 0))
      if (method === 'MIXED') {
        form.append('cashAmount', mixedCash)
        form.append('transferAmount', mixedTransfer)
      }
      form.append('reference', reference)
      proofs.forEach((p, idx) => {
        form.append('proofs', p.file)
        if (idx === 0) form.append('proof', p.file) // compatibilidad total con endpoints existentes
      })
      const result = await api.post<any>(`/tables/${id}/payments`, form)

      if (method === 'CASH') {
        alerts.success('Cobro registrado', result.table?.status === 'CLOSED' ? 'La cuenta quedó pagada y cerrada.' : 'La cuenta está pagada. Se cerrará cuando cocina termine el pedido.')
        if (result.table?.status === 'CLOSED') navigate('/tables')
        else await load()
        return
      }

      alerts.success('Pago enviado a caja', method === 'MIXED' ? 'Pago mixto enviado para validación en caja.' : 'Comprobante(s) enviado(s) para validación en caja.')
      clearProofs()
      setReference('')
      await load()
    } catch (err: any) {
      alerts.error('No se pudo enviar pago', err?.response?.data?.message || err.message)
    } finally {
      setSending(false)
    }
  }

  const validatePayment = async (paymentId: string) => {
    setActionLoading(paymentId)
    try {
      const result = await api.put<any>(`/payment-validation/${paymentId}/validate`, {})
      alerts.toast(result.table?.status === 'CLOSED' ? '✅ Pago validado: Cuenta cerrada' : '✅ Pago validado')
      if (result.table?.status === 'CLOSED') navigate('/tables')
      else await load()
    } catch (err: any) {
      alerts.error('Error al validar pago', err?.response?.data?.message || err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const rejectPayment = async (paymentId: string) => {
    const reasonText = prompt('Motivo del rechazo de este pago:')
    if (reasonText === null) return
    setActionLoading(paymentId)
    try {
      await api.put(`/payment-validation/${paymentId}/reject`, { reason: reasonText.trim() || 'Comprobante ilegible o no válido' })
      alerts.warning('Pago rechazado', 'Se registró el rechazo del pago.')
      await load()
    } catch (err: any) {
      alerts.error('Error al rechazar pago', err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const closeTable = async () => {
    try {
      await api.put(`/tables/${id}/close`, {})
      alerts.success('Mesa cerrada', 'La cuenta quedó cerrada correctamente.')
      await load()
    } catch (err: any) {
      alerts.error('No se pudo cerrar mesa', err.message)
    }
  }

  if (!table) return <div className="p-8 text-center text-sm text-[var(--text-secondary)]">Cargando mesa...</div>

  const pendingReview = table.orders?.some((order: any) => order.paymentStatus === 'PENDING_REVIEW')
  const isStaff = ['ADMIN', 'SUPERADMIN', 'CASHIER'].includes(user?.role || '')

  return (
    <div className="space-y-4 pb-32">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon"><Link to="/tables"><ArrowLeft className="h-5 w-5" /></Link></Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black text-[var(--text-primary)]">{table.label}</h1>
              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black tracking-wider border ${
                table.status === 'CLOSED'
                  ? 'bg-[var(--bg-elevated)] text-[var(--text-muted)] border-[var(--border-subtle)]'
                  : table.balance === 0
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                  : 'bg-[var(--accent)]/10 text-[var(--accent)] border-[var(--accent)]/25'
              }`}>
                {table.status === 'CLOSED'
                  ? 'CERRADA'
                  : table.balance === 0
                  ? (table.kitchenStatus === 'READY' ? '✅ COBRADA · ¡LISTA PARA ENTREGAR! 🏃' : '✅ COBRADA · EN PREPARACIÓN 👨‍🍳')
                  : 'MESA ABIERTA'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-[var(--text-secondary)]">
              <span className="flex items-center gap-1 font-medium text-[var(--text-secondary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-2 py-0.5 rounded-md">
                👤 Tomado por: <strong className="text-[var(--text-primary)]">{table.openedBy?.name || 'Mesero'}</strong>
              </span>
              <span>•</span>
              <span className="text-xs text-[var(--text-secondary)] font-medium bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-2 py-0.5 rounded-md">
                Atendiendo: <strong className="text-[var(--text-primary)]">{user?.name}</strong>
              </span>
            </div>
          </div>
        </div>
        {(() => {
          const activeOrder = table.orders?.find((o: any) => !['DELIVERED', 'CANCELLED'].includes(o.status)) || table.orders?.[0]
          const isCancelling = activeOrder?.status === 'CANCELLATION_REQUESTED'
          return (
            <div className="flex gap-2 items-center flex-wrap">
              <Button asChild variant="outline" className="gap-2 border-[var(--border-default)] font-black text-xs sm:text-sm" disabled={isCancelling}>
                <Link to={activeOrder ? `/tables/new?tableId=${table.id}&editOrderId=${activeOrder.id}` : `/tables/new?tableId=${table.id}`}>
                  <Pencil className="h-4 w-4 text-[var(--accent)]" />Editar productos
                </Link>
              </Button>
              {table.status === 'OPEN' && (
                isCancelling ? (
                  <div className="rounded-xl px-3 py-2 bg-amber-500/15 border border-amber-500/30 text-amber-800 dark:text-amber-200 font-bold text-xs flex items-center gap-1.5 shadow-xs">
                    <Clock className="h-4 w-4 text-amber-600 animate-pulse" />
                    <span>⏳ Cancelación solicitada (en espera de Caja)</span>
                  </div>
                ) : table.balance === 0 && (table.orders?.length || 0) > 0 ? (
                  table.kitchenStatus === 'ACTIVE' || table.kitchenStatus === 'SENT' ? (
                    <div className="rounded-xl px-3 py-2 bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 font-black text-xs flex items-center gap-1.5 shadow-xs">
                      <ChefHat className="h-4 w-4 text-amber-600 animate-pulse" />
                      <span>Cocinando (Mesa ya cobrada)</span>
                    </div>
                  ) : (
                    <Button
                      onClick={closeTable}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs sm:text-sm gap-1.5 cursor-pointer shadow-xs"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Cerrar mesa
                    </Button>
                  )
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => activeOrder && handleCancelOrder(activeOrder.id, activeOrder.orderNumber)}
                    disabled={!activeOrder}
                    className="border-rose-300 text-rose-600 hover:bg-rose-50 font-black text-xs sm:text-sm gap-1.5 cursor-pointer"
                  >
                    <XCircle className="h-4 w-4" /> Cancelar pedido
                  </Button>
                )
              )}
            </div>
          )
        })()}
      </div>

      <div className="grid gap-4 items-start lg:grid-cols-[1fr_380px]">
        {/* Orders Column: order-1 on mobile so waitresses can immediately view, edit, or cancel orders */}
        <section className="min-w-0 space-y-3 order-1 lg:order-1">
          <h2 className="font-black text-sm uppercase tracking-wider text-[var(--text-muted)]">Envíos y Comida en Mesa</h2>
          {table.orders?.map((order: any) => (
            <div key={order.id} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] pb-2.5">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-black text-[var(--text-primary)]">Pedido #{order.orderNumber}</p>
                    <span className="text-xs font-bold text-amber-700 bg-amber-500/10 px-2 py-0.5 rounded-md">
                      👤 {order.waiter?.name || table.openedBy?.name || 'Mesero'}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{new Date(order.createdAt).toLocaleTimeString()} - Cocina: <b className="text-[var(--accent)]">{order.kitchenStatus}</b></p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                  order.status === 'CANCELLED'
                    ? 'bg-rose-500/15 text-rose-700 dark:text-rose-400'
                    : order.status === 'CANCELLATION_REQUESTED'
                    ? 'bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-400/40 animate-pulse'
                    : order.paymentStatus === 'CONFIRMED'
                    ? 'bg-emerald-500/10 text-emerald-600'
                    : 'bg-amber-500/10 text-amber-600'
                }`}>
                  {order.status === 'CANCELLED' ? 'CANCELADO' : order.status === 'CANCELLATION_REQUESTED' ? '⏳ CANCELACIÓN SOLICITADA' : order.paymentStatus === 'CONFIRMED' ? 'PAGADO' : 'PENDIENTE'}
                </span>
              </div>

              {/* Items List */}
              <div className="mt-3 space-y-1.5">
                {order.items?.map((item: any) => (
                  <div key={item.id} className="flex items-start justify-between rounded-xl bg-[var(--bg-elevated)] p-2.5 text-sm">
                    <div>
                      <b className="text-[var(--text-primary)]">{item.quantity} x {item.menuItem?.name || item.nameSnapshot}</b>
                      {item.notes && <p className="text-xs text-[var(--text-muted)] mt-0.5">Nota: {item.notes}</p>}
                    </div>
                    <b className="text-[var(--accent)]">{formatCurrency(item.totalPrice || (item.unitPrice * item.quantity) || 0)}</b>
                  </div>
                ))}
              </div>

              {/* Change log if edited */}
              {order.changeLogs?.length > 0 && (
                <div className="mt-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800">
                  <b className="block font-black">Historial de edición:</b>
                  {order.changeLogs[0].summary}
                </div>
              )}

              {/* Kitchen Tickets Badges */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {order.kitchenTickets?.map((ticket: any) => (
                  <span key={ticket.id} className="rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/30 px-2 py-0.5 text-[10px] font-black text-[var(--accent)]">
                    {ticket.station?.name}: {ticket.status === 'READY' ? 'LISTO' : ticket.status === 'PREPARING' ? 'EN PREPARACIÓN' : ticket.status === 'CANCELLED' ? 'CANCELADO' : 'NUEVO'}
                  </span>
                ))}
              </div>

              {order.status === 'CANCELLATION_REQUESTED' && (
                <div className="mt-2.5 rounded-xl border border-amber-400/40 bg-amber-500/15 p-2.5 text-xs text-amber-900 dark:text-amber-200 font-bold flex items-center gap-1.5">
                  <Clock className="h-4 w-4 shrink-0 text-amber-600 animate-pulse" />
                  <span>Solicitud de cancelación en revisión por Caja/Admin{order.cancellationReason ? `: "${order.cancellationReason}"` : ''}</span>
                </div>
              )}

              {order.status === 'CANCELLED' && (
                <div className="mt-2.5 rounded-xl border border-rose-300 bg-rose-500/10 p-2.5 text-xs text-rose-700 dark:text-rose-400 font-bold flex items-center gap-1.5">
                  <XCircle className="h-4 w-4 shrink-0" />
                  <span>Pedido cancelado{order.cancellationReason ? `: ${order.cancellationReason}` : ''}</span>
                </div>
              )}
            </div>
          ))}
          {(!table.orders || table.orders.length === 0) && (
            <div className="p-8 text-center text-sm text-[var(--text-muted)] border border-dashed rounded-2xl">
              No hay pedidos enviados en esta mesa aún.
            </div>
          )}
        </section>

        {/* Payment and Billing Column: order-2 on mobile */}
        <aside className="min-w-0 space-y-4 order-2 lg:order-2">
          {/* Balance card */}
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm">
            <div className="flex justify-between items-center text-sm text-[var(--text-secondary)]">
              <span>Total de la Cuenta</span>
              <span className="font-bold text-[var(--text-primary)]">{formatCurrency(table.total || 0)}</span>
            </div>
            <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] flex justify-between items-end">
              <div>
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-bold">Saldo Pendiente</p>
                <p className={`text-3xl font-black ${table.balance > 0 ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}>
                  {formatCurrency(table.balance || 0)}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-black border ${
                table.balance === 0
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                  : 'bg-[var(--accent)]/10 border-[var(--accent)]/30 text-[var(--accent)]'
              }`}>
                {table.balance === 0
                  ? (table.kitchenStatus === 'READY' ? '✅ COBRADA · ¡LISTA!' : '✅ COBRADA · EN COCINA')
                  : 'POR COBRAR'}
              </span>
            </div>
          </div>

          {/* Payment Box */}
          {pendingReview && <div role="status" className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 text-sm text-[var(--text-primary)] font-bold flex items-center gap-2">⏳ Pago enviado a caja. Pendiente de validación.</div>}
          {table.status === 'OPEN' && table.balance > 0 && !pendingReview && (
            <div className="space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm animate-in fade-in slide-in-from-top-2">
              {table.kitchenStatus === 'READY' ? (
                <div className="rounded-xl bg-emerald-500/15 border border-emerald-500/30 p-2 text-xs font-black text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>¡Pedido listo en cocina! Pasa a recogerlo y registra el cobro.</span>
                </div>
              ) : (
                <div className="rounded-xl bg-blue-500/10 border border-blue-500/25 p-2.5 text-xs font-medium text-blue-800 dark:text-blue-300 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-blue-600 shrink-0" />
                  <span><strong>Cobro anticipado:</strong> Puedes cobrar ahora mismo. La cocina continuará preparando los platos normalmente.</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <h2 className="font-black text-sm uppercase tracking-wider text-[var(--text-primary)]">Registrar Cobro</h2>
                <span className="text-[11px] text-[var(--text-muted)] font-medium">Cobro de cuenta</span>
              </div>

              {/* Method Tabs - 3 MÉTODOS */}
              <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-[var(--bg-elevated)] p-1.5">
                {[
                  { id: 'CASH', label: '💵 Efectivo' },
                  { id: 'TRANSFER', label: '📲 Transferencia' },
                  { id: 'MIXED', label: '🔀 Mixto' },
                ].map(m => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMethod(m.id as 'CASH' | 'TRANSFER' | 'MIXED')}
                    className={`rounded-lg py-2.5 text-xs font-black transition-all cursor-pointer ${
                      method === m.id
                        ? 'bg-[var(--accent)] text-white shadow-sm scale-[1.02]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-[var(--text-secondary)]">Total a cobrar</label>
                <Input
                  value={amount}
                  readOnly
                  aria-label="Saldo completo a cobrar"
                  placeholder="Valor recibido"
                  className="font-bold text-base h-11 bg-[var(--bg-elevated)]"
                />
              </div>

              {/* Desglose para Pago Mixto */}
              {method === 'MIXED' && (
                <div className="space-y-2 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-3 shadow-xs">
                  <span className="text-xs font-black text-[var(--accent)] flex items-center gap-1.5">
                    🔀 Desglose de Pago Mixto
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] font-bold text-[var(--text-secondary)] block mb-1">
                        💵 En Efectivo
                      </label>
                      <Input
                        type="number"
                        value={mixedCash}
                        onChange={e => handleMixedCashChange(e.target.value)}
                        placeholder="Ej: 5000"
                        className="font-bold text-sm h-10 bg-[var(--bg-panel)]"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-[var(--text-secondary)] block mb-1">
                        📲 En Transferencia
                      </label>
                      <Input
                        type="number"
                        value={mixedTransfer}
                        onChange={e => handleMixedTransferChange(e.target.value)}
                        placeholder="Ej: 15000"
                        className="font-bold text-sm h-10 bg-[var(--bg-panel)]"
                      />
                    </div>
                  </div>
                  <div className="flex justify-between text-[11px] font-bold pt-1 border-t border-[var(--border-subtle)] text-[var(--text-secondary)]">
                    <span>Suma: <strong>{formatCurrency((Number(mixedCash) || 0) + (Number(mixedTransfer) || 0))}</strong></span>
                    <span>Total mesa: <strong>{formatCurrency(Number(amount) || table?.balance || 0)}</strong></span>
                  </div>
                </div>
              )}

              <Input
                value={reference}
                onChange={e => setReference(e.target.value)}
                placeholder="Referencia o nota opcional"
                className="text-xs"
              />

              {/* Transfer Proof Photo Upload Section */}
              {method !== 'CASH' && (
                <div className="space-y-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-amber-900 dark:text-amber-200">
                      📸 Comprobantes de Transferencia {proofs.length > 0 ? `(${proofs.length})` : '(Obligatorio)'}
                    </span>
                    {preparingPhoto ? (
                      <span role="status" className="text-xs text-amber-600 font-bold animate-pulse">Procesando foto…</span>
                    ) : proofs.length > 0 ? (
                      <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-black">
                        ✓ {proofs.length} lista{proofs.length === 1 ? '' : 's'}
                      </span>
                    ) : (
                      <span className="text-[11px] text-rose-500 font-bold">Mínimo 1 foto</span>
                    )}
                  </div>

                  {/* 2 Opciones en comprobante: Tomar foto o Subir comprobante(s) */}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-[var(--accent)] bg-[var(--accent)]/10 p-3 text-center transition hover:bg-[var(--accent)]/20 active:scale-95 shadow-sm">
                      <Camera className="h-5 w-5 text-[var(--accent)]" />
                      <span className="text-xs font-black text-[var(--accent)] leading-tight">
                        {proofs.length > 0 ? '+ Tomar otra foto' : 'Tomar foto con cámara'}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={handleFileChange}
                      />
                    </label>

                    <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 text-center transition hover:bg-[var(--bg-hover)] active:scale-95 shadow-sm">
                      <Upload className="h-5 w-5 text-[var(--text-secondary)]" />
                      <span className="text-xs font-black text-[var(--text-secondary)] leading-tight">
                        {proofs.length > 0 ? '+ Subir de galería' : 'Subir de galería'}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={handleFileChange}
                      />
                    </label>
                  </div>

                  {/* Previews of all selected photos */}
                  {proofs.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <div className="flex items-center justify-between text-[11px] font-bold text-[var(--text-secondary)]">
                        <span>Fotos preparadas para enviar:</span>
                        <button
                          type="button"
                          onClick={clearProofs}
                          className="text-rose-500 hover:underline font-black cursor-pointer text-[10px]"
                        >
                          Quitar todas
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {proofs.map((p, idx) => (
                          <div
                            key={p.id}
                            className="flex items-center justify-between gap-2 rounded-xl bg-[var(--bg-panel)] p-2 border border-[var(--border-subtle)] shadow-xs"
                          >
                            <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                              <img
                                src={p.previewUrl}
                                alt={`Comprobante ${idx + 1}`}
                                className="h-12 w-12 shrink-0 rounded-lg object-cover border border-[var(--border-subtle)]"
                              />
                              <div className="min-w-0 truncate text-xs">
                                <p className="font-black text-[var(--text-primary)] truncate">
                                  Comprobante #{idx + 1}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => setZoomUrl(p.previewUrl)}
                                  className="text-[var(--accent)] font-bold hover:underline flex items-center gap-1 text-[11px] mt-0.5 cursor-pointer"
                                >
                                  <Eye className="h-3 w-3" /> Ver grande
                                </button>
                              </div>
                            </div>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-rose-500 hover:bg-rose-500/10 rounded-lg cursor-pointer shrink-0"
                              onClick={() => removeProof(p.id)}
                              title="Eliminar esta foto"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Submit Button */}
              <Button
                disabled={sending || preparingPhoto || (method !== 'CASH' && proofs.length === 0)}
                onClick={submitPayment}
                className="w-full h-11 font-black text-sm gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white shadow-md transition-all cursor-pointer"
              >
                {sending
                  ? 'Procesando...'
                  : method === 'CASH'
                  ? `💵 Cobrar en Efectivo (${formatCurrency(Number(amount) || table.balance)})`
                  : method === 'TRANSFER'
                  ? `📤 Enviar Comprobante${proofs.length > 1 ? `s (${proofs.length})` : ''} (${formatCurrency(Number(amount) || table.balance)})`
                  : `🔀 Enviar Pago Mixto (${formatCurrency(Number(amount) || table.balance)})`}
              </Button>
            </div>
          )}

          {table.status === 'OPEN' && table.balance === 0 && !pendingReview && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs font-bold text-emerald-900 dark:text-emerald-200 flex flex-col gap-2 shadow-xs">
              <div className="flex items-center gap-2 font-black text-sm text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>Cuenta Cobrada por Adelantado ✅</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                {table.kitchenStatus === 'READY'
                  ? '¡El pedido ya está listo en cocina! Puedes entregarlo a la mesa y cerrar la cuenta.'
                  : 'Esta cuenta ya fue cobrada y confirmada. La cocina continuará preparando los platos normalmente.'}
              </p>
            </div>
          )}

          {/* Transfer Proofs & Payments List */}
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm">
            <h2 className="mb-3 font-black text-sm uppercase tracking-wider text-[var(--text-primary)]">Comprobantes y Pagos</h2>
            <div className="space-y-2.5">
              {table.transferProofs?.map((p: any) => {
                const proofImageUrl = `/payment-validation/proofs/${p.id}/image`
                const isPending = p.status === 'PENDING' || p.status === 'PENDING_REVIEW'
                return (
                  <div key={p.id} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-xs space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="font-black text-sm text-[var(--text-primary)]">{p.method === 'CASH' ? '💵 EFECTIVO' : '📲 TRANSFERENCIA'} - {formatCurrency(p.amount)}</span>
                        <p className="text-[11px] text-[var(--text-muted)]">Subido por: <b className="text-[var(--text-secondary)]">{p.submittedBy?.name || 'Mesero'}</b></p>
                      </div>
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${
                        p.status === 'CONFIRMED' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300' :
                        p.status === 'REJECTED' ? 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300' : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
                      }`}>
                        {p.status === 'CONFIRMED' ? 'APROBADO' : p.status === 'REJECTED' ? 'RECHAZADO' : 'POR VALIDAR'}
                      </span>
                    </div>

                    {p.method !== 'CASH' && (p.fileBase64 || p.filePath) ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setZoomUrl(proofImageUrl)}
                          className="flex items-center gap-1.5 rounded-lg bg-[var(--bg-panel)] px-2.5 py-1 text-xs font-bold text-[var(--accent)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition cursor-pointer"
                        >
                          <Eye className="h-3.5 w-3.5" /> Ver comprobante
                        </button>
                      </div>
                    ) : p.method === 'CASH' ? (
                      <div className="text-[11px] text-[var(--text-muted)] font-medium flex items-center gap-1.5 bg-[var(--bg-panel)] p-2 rounded-lg border border-[var(--border-subtle)]">
                        <span>💵</span>
                        <span>Cobro en efectivo entregado a la mesera. Pendiente de recepción y validación en caja.</span>
                      </div>
                    ) : null}

                    {p.rejectionReason && (
                      <p className="text-rose-600 bg-rose-500/10 p-2 rounded-lg font-medium">Motivo rechazo: {p.rejectionReason}</p>
                    )}

                    {/* Admin / Cashier Action Buttons directly from Table view */}
                    {isStaff && isPending && (
                      <div className="flex gap-2 pt-1 border-t border-[var(--border-subtle)]">
                        <Button
                          size="sm"
                          disabled={actionLoading === p.paymentId}
                          onClick={() => validatePayment(p.paymentId)}
                          className="h-8 flex-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-bold text-xs gap-1 cursor-pointer"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Validar Pago
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={actionLoading === p.paymentId}
                          onClick={() => rejectPayment(p.paymentId)}
                          className="h-8 flex-1 border-rose-300 text-rose-600 hover:bg-rose-50 font-bold text-xs gap-1 cursor-pointer"
                        >
                          <XCircle className="h-3.5 w-3.5" /> Rechazar
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
              {(!table.transferProofs || table.transferProofs.length === 0) && (
                <p className="text-xs text-[var(--text-muted)] text-center py-3">No hay comprobantes de transferencia registrados.</p>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Full Resolution Zoom Modal for Image */}
      <Dialog open={!!zoomUrl} onOpenChange={v => !v && setZoomUrl(null)}>
        <DialogContent className="max-w-md w-[92vw] bg-[var(--bg-panel)] p-3.5 border border-[var(--border-default)] text-[var(--text-primary)] rounded-2xl shadow-2xl flex flex-col items-center">
          <div className="flex w-full justify-between items-center pb-2 border-b border-[var(--border-subtle)] px-1">
            <span className="text-sm font-black flex items-center gap-1.5 text-[var(--text-primary)]">
              <ImageIcon className="h-4 w-4 text-[var(--accent)]" /> Comprobante de Transferencia
            </span>
            <Button size="sm" variant="ghost" className="h-8 px-2 text-xs font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" onClick={() => setZoomUrl(null)}>
              ✕ Cerrar
            </Button>
          </div>
          {zoomUrl && (
            <div className="max-h-[78vh] w-full flex items-center justify-center overflow-auto rounded-xl bg-[var(--bg-elevated)] p-1.5 mt-2">
              <ProtectedImage
                endpoint={zoomUrl}
                alt="Comprobante completo"
                className="max-h-[74vh] w-auto max-w-full object-contain rounded-lg shadow-sm"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
