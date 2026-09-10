import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { formatCurrency, formatDate, getStatusColor, getStatusLabel, cleanNotes, groupOrderItems } from '@/lib/utils'
import { ArrowLeft, User, Phone, MapPin, Clock, CreditCard, UtensilsCrossed, Star, Edit, XCircle, Loader2, DollarSign, Printer } from 'lucide-react'
import { motion } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { printComandaSmart, openCashDrawer } from '@/lib/printer'

interface OrderDetail {
  id: string; orderNumber: number; customerName: string; customerPhone: string; customerAddress: string
  subtotal: number; tax: number; deliveryFee: number; total: number; tip: number
  status: string; paymentMethod: string; paymentStatus: string; rated: boolean; rating: number | null
  notes: string | null; createdAt: string; updatedAt: string; orderType: string
  waiter: { id: string; name: string; phone: string }
  assignee: { id: string; name: string } | null
  zone: { name: string; rate: number } | null
  items: { id: string; quantity: number; unitPrice: number; totalPrice: number; notes: string | null; menuItem: { name: string } }[]
  payment: { id: string; method: string; status: string; reference: string | null; proofImage: string | null } | null
  cancellationReason: string | null;
  cancelledAt: string | null;
  cancelledById: string | null;
  cancelledBy: { id: string; name: string } | null;
  cashRegister?: { name: string } | null;
  deliveryDriver?: { id: string; name: string; phone: string } | null;
}

export default function OrderDetailPage() {
  const { user } = useAuth()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [order, setOrder] = useState<OrderDetail | null>(null)
  const [loading, setLoading] = useState(true)

  const loadOrder = () => {
    if (!id || id === 'active') return
    api.get<OrderDetail>(`/orders/${id}`).then(res => {
      if (res && !Array.isArray(res) && res.id) {
        setOrder(res)
      } else {
        setOrder(null)
      }
    }).catch(console.error).finally(() => setLoading(false))
  }

  useEffect(() => { loadOrder() }, [id])

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelConfirmStep, setCancelConfirmStep] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [collectDialogOpen, setCollectDialogOpen] = useState(false)
  const [collectMethod, setCollectMethod] = useState('CASH')
  const [collectReference, setCollectReference] = useState('')
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false)
  const [printInvoiceOnCollect, setPrintInvoiceOnCollect] = useState(true)
  const [kickDrawerOnCollect, setKickDrawerOnCollect] = useState(true)

  useEffect(() => {
    if (order && !Array.isArray(order)) {
      setCollectMethod(order.paymentMethod || 'CASH')
      setCollectReference('')
    }
  }, [collectDialogOpen, order])

  const handleCollectPayment = async () => {
    if (!order || Array.isArray(order)) return
    setIsSubmittingPayment(true)
    try {
      const updatedOrder = await api.put<any>(`/orders/${order.id}/payment`, {
        method: collectMethod,
        paymentStatus: 'CONFIRMED',
        reference: collectReference || null,
      })
      const shouldKick = collectMethod === 'CASH'
      if (printInvoiceOnCollect) {
        await printComandaSmart(updatedOrder, 'caja', user?.role, false, shouldKick)
      } else if (shouldKick) {
        await openCashDrawer()
      }
      setCollectDialogOpen(false)
      loadOrder()
    } catch (err: any) {
      alert(err.message || 'Error al registrar el pago')
    } finally {
      setIsSubmittingPayment(false)
    }
  }

  const handleCancelOrder = async () => {
    if (!cancelConfirmStep) {
      if (cancelReason.trim().length < 3) {
        alert('Escribe el motivo de cancelación (mínimo 3 caracteres)')
        return
      }
      setCancelConfirmStep(true)
      return
    }
    setCancelling(true)
    try {
      await api.put(`/orders/${id}/cancel`, { reason: cancelReason || 'Cancelado' })
      setCancelDialogOpen(false)
      setCancelReason('')
      setCancelConfirmStep(false)
      loadOrder()
    } catch (err: any) {
      alert(err.message || 'Error al cancelar el pedido')
    } finally {
      setCancelling(false)
    }
  }

  const updateStatus = async (newStatus: string) => {
    if (!id || id === 'active') return
    await api.put(`/orders/${id}/status`, { status: newStatus })
    loadOrder()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-[var(--text-secondary)]">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}>
          <div className="h-10 w-10 rounded-full border-2 border-[var(--accent)] border-t-transparent" />
        </motion.div>
        <span className="ml-3 font-medium">Cargando detalles del pedido...</span>
      </div>
    )
  }

  if (!order || Array.isArray(order) || !order.id) {
    return (
      <div className="p-8 text-center text-[var(--text-secondary)]">
        <p className="font-bold text-lg">Pedido no encontrado</p>
        <Button variant="outline" className="mt-4 rounded-xl" onClick={() => navigate('/orders')}>
          Volver a Pedidos
        </Button>
      </div>
    )
  }

  const nextStatus: Record<string, string> = {
    PENDING: 'PREPARING', PREPARING: 'READY', READY: 'IN_ROUTE', IN_ROUTE: 'DELIVERED',
  }
  const nextLabel: Record<string, string> = {
    PENDING: 'Mover a Cocina', PREPARING: 'Marcar Listo', READY: 'Enviar a Ruta', IN_ROUTE: 'Marcar Entregado',
  }

  return (
    <div className="space-y-6 max-w-4xl pb-12">
      <div className="flex flex-wrap items-center gap-4 border-b border-[var(--border-subtle)] pb-4">
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => navigate('/orders')} 
          className="rounded-xl hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)] text-[var(--text-secondary)]"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h2 className="text-3xl antifont text-[var(--text-primary)] tracking-wider leading-none">PEDIDO #{order.orderNumber}</h2>
          <p className="text-[var(--text-secondary)] text-xs mt-1.5">{formatDate(order.createdAt)}</p>
        </div>
        <Badge 
          variant="outline" 
          className="ml-auto px-3.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider shadow-sm"
          style={{ 
            borderColor: `${getStatusColor(order.status)}40`, 
            color: getStatusColor(order.status),
            backgroundColor: `${getStatusColor(order.status)}08`
          }}
        >
          {getStatusLabel(order.status)}
        </Badge>
      </div>

      {order.status === 'CANCELLED' && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }} 
          animate={{ opacity: 1, y: 0 }}
          className="border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 shadow-md rounded-2xl overflow-hidden p-5 space-y-2"
        >
          <div className="flex items-center gap-2 text-[var(--destructive)] font-bold">
            <XCircle className="h-5 w-5 animate-pulse" />
            <span className="tracking-wide uppercase text-sm font-black">PEDIDO ANULADO / CANCELADO</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm pt-2.5 border-t border-[var(--destructive)]/10 text-[var(--text-primary)]">
            <div>
              <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Motivo de Anulación</p>
              <p className="font-semibold mt-0.5 italic">"{order.cancellationReason || 'Sin motivo especificado'}"</p>
            </div>
            {order.cancelledBy && (
              <div>
                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Anulado Por</p>
                <p className="font-bold mt-0.5">{order.cancelledBy.name}</p>
              </div>
            )}
            {order.cancelledAt && (
              <div>
                <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Fecha de Anulación</p>
                <p className="font-semibold mt-0.5">{formatDate(order.cancelledAt)}</p>
              </div>
            )}
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-md rounded-2xl">
          <CardHeader className="pb-3 pt-5 px-5 border-b border-[var(--border-subtle)]/50">
            <CardTitle className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-2">
              <User className="h-4 w-4 text-[var(--accent)]" /> Datos del Cliente
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <span className="font-semibold text-[var(--text-secondary)]">Nombre:</span>
              <span className="font-bold">{order.customerName}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <span className="font-semibold text-[var(--text-secondary)]">Teléfono:</span>
              <a href={`tel:${order.customerPhone}`} className="hover:underline font-bold text-[var(--accent)]">{order.customerPhone}</a>
            </div>
            <div className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
              <span className="font-semibold text-[var(--text-secondary)] shrink-0">Dirección:</span>
              <span className="font-semibold">{order.customerAddress}</span>
            </div>
            {order.notes && (
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3 text-xs text-[var(--text-secondary)] italic mt-2">
                Notas: "{order.notes}"
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-md rounded-2xl">
          <CardHeader className="pb-3 pt-5 px-5 border-b border-[var(--border-subtle)]/50">
            <CardTitle className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-[var(--accent)]" /> Detalles de Registro
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <span className="font-semibold text-[var(--text-secondary)]">Registrado por:</span>
              <span className="font-bold">{order.waiter.name}</span>
            </div>
            {order.assignee && (
              <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                <span className="font-semibold text-[var(--text-secondary)]">Operador Asignado:</span>
                <span className="font-bold text-[var(--accent)]">{order.assignee.name}</span>
              </div>
            )}
            {order.deliveryDriver && (
              <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                <span className="font-semibold text-[var(--text-secondary)]">Domiciliario:</span>
                <span className="font-bold text-[var(--accent)]">
                  {order.deliveryDriver.name} ({order.deliveryDriver.phone})
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <span className="font-semibold text-[var(--text-secondary)]">Caja Asignada:</span>
              {order.cashRegister ? (
                <span className="font-bold text-[var(--accent)]">{order.cashRegister.name}</span>
              ) : (
                <span className="text-amber-500 font-bold text-[10px] uppercase bg-amber-500/5 px-2 py-0.5 rounded-full border border-amber-500/20">Fuera de Caja (Manual)</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <span className="font-semibold text-[var(--text-secondary)]">Método Pago:</span>
              <Badge variant="secondary" className="bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-md font-bold px-2 py-0.5 text-xs text-[var(--text-secondary)] mr-2">
                {getStatusLabel(order.paymentMethod)}
              </Badge>
              <Badge 
                variant="outline" 
                className="px-2 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider"
                style={{ 
                  borderColor: `${getStatusColor(order.paymentStatus)}30`, 
                  color: getStatusColor(order.paymentStatus),
                  backgroundColor: `${getStatusColor(order.paymentStatus)}08`
                }}
              >
                {getStatusLabel(order.paymentStatus)}
              </Badge>
            </div>
            {order.zone && (
              <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
                <span className="font-semibold text-[var(--text-secondary)]">Zona Domicilio:</span>
                <span className="font-bold">{order.zone.name} (+{formatCurrency(order.zone.rate)})</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
              <span className="font-semibold text-[var(--text-secondary)]">Último Cambio:</span>
              <span className="font-semibold text-xs text-[var(--text-muted)]">{formatDate(order.updatedAt)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-lg rounded-2xl">
        <CardHeader className="pb-3 pt-5 px-5 border-b border-[var(--border-subtle)]">
          <CardTitle className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
            <UtensilsCrossed className="h-5 w-5 text-[var(--accent)]" /> Platos del Pedido
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5">
          <div className="space-y-3">
            {groupOrderItems(order.items || []).map(item => (
              <div key={item.id} className="p-3.5 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                      <UtensilsCrossed className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-[var(--text-primary)]">{item.menuItem.name}</p>
                      {item.notes && cleanNotes(item.notes) && !item.notes.startsWith('Adición para:') && (
                        <p className="text-xs text-[var(--text-secondary)] mt-0.5">Instrucciones: "{cleanNotes(item.notes)}"</p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold text-[var(--text-secondary)]">{item.quantity}x {user?.role !== 'DELIVERY_MANAGER' ? formatCurrency(item.unitPrice) : ''}</p>
                    {user?.role !== 'DELIVERY_MANAGER' && (
                      <p className="text-[var(--accent)] font-extrabold text-sm mt-0.5">{formatCurrency(item.totalPrice)}</p>
                    )}
                  </div>
                </div>

                {item.additions && item.additions.length > 0 && (
                  <div className="pl-3 border-l-2 border-[var(--accent)]/30 space-y-2 pt-1">
                    {item.additions.map(add => (
                      <div key={add.id} className="flex items-center justify-between text-xs bg-[var(--bg-panel)]/50 rounded-xl p-2.5 border border-[var(--border-subtle)]/50">
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-[var(--text-primary)] truncate">{add.menuItem.name} <span className="text-[10px] text-[var(--accent)] font-semibold">[Adición]</span></p>
                        </div>
                        <div className="text-right ml-2">
                          <p className="text-[11px] font-semibold text-[var(--text-secondary)]">{add.quantity}x {user?.role !== 'DELIVERY_MANAGER' ? formatCurrency(add.unitPrice) : ''}</p>
                          {user?.role !== 'DELIVERY_MANAGER' && (
                            <p className="text-[var(--accent)] font-bold text-xs mt-0.5">{formatCurrency(add.totalPrice)}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {user?.role !== 'DELIVERY_MANAGER' && (
            <div className="mt-6 space-y-2.5 text-sm border-t border-[var(--border-subtle)] pt-4 max-w-md ml-auto">
              <div className="flex justify-between text-[var(--text-secondary)]"><span>Subtotal</span><span className="font-semibold text-[var(--text-primary)]">{formatCurrency(order.subtotal)}</span></div>
              <div className="flex justify-between text-[var(--text-secondary)]"><span>Tarifa Domicilio</span><span className="font-semibold text-[var(--text-primary)]">{formatCurrency(order.deliveryFee)}</span></div>
              <div className="flex justify-between text-[var(--text-secondary)]"><span>Impoconsumo (8%)</span><span className="font-semibold text-[var(--text-primary)]">{formatCurrency(order.tax)}</span></div>
              <div className="h-px w-full bg-[var(--border-default)] my-1" />
              <div className="flex justify-between text-[var(--text-primary)] font-bold text-base"><span>TOTAL FACTURADO</span><span className="text-[var(--accent)] font-extrabold text-lg">{formatCurrency(order.total)}</span></div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-md rounded-2xl">
        <CardHeader className="pb-3 pt-5 px-5 border-b border-[var(--border-subtle)]/50">
          <CardTitle className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider">Acciones del Pedido</CardTitle>
        </CardHeader>
        <CardContent className="p-5 flex flex-wrap items-center gap-3">
          {/* Direct Status Transition Buttons Removed - Managed automatically via Print and Cobro */}
          {order.paymentStatus !== 'CONFIRMED' && (
            <Button
              className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-extrabold shadow-lg shadow-[var(--accent)]/15 h-11 px-5 rounded-xl border-0 cursor-pointer transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => setCollectDialogOpen(true)}
              title="Registrar Cobro"
            >
              <DollarSign className="h-5 w-5" /> Registrar Cobro
            </Button>
          )}
          {order.status !== 'CANCELLED' && ['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER', 'DISPATCHER', 'WAITER'].includes(user?.role || '') && (
            <Button 
              variant="outline" 
              className="h-11 px-5 rounded-xl font-bold border-[var(--border-default)] hover:bg-[var(--bg-hover)] flex items-center gap-1.5 cursor-pointer"
              onClick={() => navigate(order.tableId ? `/tables/new?tableId=${order.tableId}&editOrderId=${order.id}` : `/orders/new?edit=${order.id}`)}
            >
              <Edit className="h-4 w-4 text-[var(--accent)]" /> Editar Pedido
            </Button>
          )}
          {['PENDING', 'PREPARING', 'READY', 'IN_ROUTE'].includes(order.status) && ['SUPERADMIN', 'ADMIN'].includes(user?.role || '') && (
            <Button 
              variant="destructive" 
              className="h-11 px-5 rounded-xl font-bold transition-all shadow-sm bg-[var(--destructive)]/10 hover:bg-[var(--destructive)] hover:text-white text-[var(--destructive)] border border-[var(--destructive)]/20"
              onClick={() => { setCancelDialogOpen(true); setCancelConfirmStep(false); setCancelReason('') }}
            >
              Cancelar Pedido
            </Button>
          )}
          {order.status === 'DELIVERED' && !order.rated && (
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-[var(--text-secondary)] uppercase">Calificar Entrega:</span>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map(star => (
                  <Button 
                    key={star} 
                    variant="ghost" 
                    size="sm" 
                    className="text-[var(--text-muted)] hover:text-yellow-500 rounded-lg h-9 w-9 p-0 hover:bg-yellow-500/10" 
                    onClick={async () => { await api.put(`/orders/${order.id}/rate`, { rating: star }); loadOrder() }}
                  >
                    <Star className="h-5 w-5" />
                  </Button>
                ))}
              </div>
            </div>
          )}
          {order.rated && (
            <div className="flex items-center gap-2 text-[var(--success)] font-bold text-sm bg-[var(--success)]/10 px-3 py-1.5 rounded-xl border border-[var(--success)]/20">
              <Star className="h-4 w-4 fill-[var(--success)]" />
              <span>Pedido calificado con {order.rating} estrellas</span>
            </div>
          )}
          {['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER', 'DISPATCHER', 'WAITER'].includes(user?.role || '') && (
            <div className="flex flex-wrap gap-2.5 ml-auto pt-2 sm:pt-0">
              <Button
                variant="outline"
                className="h-11 px-4 rounded-xl font-bold border-[var(--border-default)] hover:bg-[var(--bg-hover)] flex items-center gap-2 text-emerald-600 hover:text-emerald-500 cursor-pointer"
                onClick={async () => {
                  const shouldKick = order.paymentMethod === 'CASH';
                  alerts.toast(`Enviando pedido #${order.orderNumber} a impresión...`, 'info');
                  const res = await printComandaSmart(order as any, undefined, user?.role, false, shouldKick);
                  if (res?.error) {
                    alerts.error('Error al imprimir', res.error);
                  } else {
                    alerts.toast(`Pedido #${order.orderNumber} enviado a la impresora`, 'success');
                  }
                  loadOrder();
                }}
              >
                <Printer className="h-4 w-4" /> Imprimir Factura / Comanda
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Diálogo de Cancelación de Pedido */}
      <Dialog open={cancelDialogOpen} onOpenChange={open => { if (!open) { setCancelDialogOpen(false); setCancelConfirmStep(false); setCancelReason('') } }}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl shadow-2xl p-0 overflow-hidden max-w-md">
          <div className="h-1.5 w-full bg-[var(--destructive)]" />
          <div className="p-6">
            <DialogHeader className="pb-3">
              <DialogTitle className="text-[var(--text-primary)] text-xl font-bold flex items-center gap-2">
                <XCircle className="h-5.5 w-5.5 text-[var(--destructive)]" />
                {cancelConfirmStep ? `¿Confirmar cancelación #${order.orderNumber}?` : `Cancelar Pedido #${order.orderNumber}`}
              </DialogTitle>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Esta acción liberará insumos y cancelará la facturación del pedido</p>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              {!cancelConfirmStep ? (
                <>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    Esta acción anulará la comanda de forma permanente, restablecerá los ingredientes al inventario y eliminará el registro de venta diaria. Debes especificar el motivo de la cancelación.
                  </p>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Motivo de Cancelación *</Label>
                    <Textarea 
                      value={cancelReason} 
                      onChange={e => setCancelReason(e.target.value)} 
                      placeholder="Ej: Cliente canceló, dirección incorrecta, pedido duplicado..." 
                      rows={3} 
                      className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl text-sm focus:border-[var(--destructive)]/50 focus:ring-1 focus:ring-[var(--destructive)]/50 transition-all font-semibold text-[var(--text-primary)]"
                    />
                  </div>
                  <Button variant="destructive" className="w-full h-12 rounded-xl font-bold shadow-md shadow-[var(--destructive)]/10 transition-all mt-3" onClick={handleCancelOrder}>
                    Continuar
                  </Button>
                </>
              ) : (
                <>
                  <div className="rounded-2xl border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 p-4 text-sm text-[var(--destructive)] space-y-1.5">
                    <p className="text-xs font-bold uppercase tracking-wider opacity-85">Motivo especificado:</p>
                    <p className="font-semibold italic">"{cancelReason}"</p>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    ¿Estás seguro de que deseas proceder? Esta acción no se puede deshacer.
                  </p>
                  <div className="flex gap-3 mt-3">
                    <Button variant="outline" className="flex-1 h-12 rounded-xl font-bold text-sm border-[var(--border-default)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] bg-[var(--bg-panel)]" onClick={() => setCancelConfirmStep(false)}>Volver</Button>
                    <Button variant="destructive" className="flex-1 h-12 rounded-xl font-bold text-sm shadow-md shadow-[var(--destructive)]/10 transition-all" onClick={handleCancelOrder} disabled={cancelling}>
                      {cancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Confirmar Anulación
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialogo de Cobro de Pedido */}
      <Dialog open={collectDialogOpen} onOpenChange={open => { if (!open) setCollectDialogOpen(false) }}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl shadow-2xl p-0 overflow-hidden max-w-md">
          <div className="h-1.5 w-full bg-emerald-600" />
          <div className="p-6">
            <DialogHeader className="pb-3">
              <DialogTitle className="text-[var(--text-primary)] text-xl font-bold flex items-center gap-2">
                <DollarSign className="h-5.5 w-5.5 text-emerald-500" />
                Registrar Cobro - Pedido #{order.orderNumber}
              </DialogTitle>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Confirma el cobro de la comanda con el repartidor</p>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-center">
                <p className="text-xs font-bold text-emerald-600 uppercase tracking-widest">Total a Cobrar</p>
                <p className="text-3xl font-black text-[var(--text-primary)] tracking-tight mt-1">{formatCurrency(order.total)}</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Método de Pago *</Label>
                <Select value={collectMethod} onValueChange={setCollectMethod}>
                  <SelectTrigger className="w-full h-11 bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl text-sm focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50">
                    <SelectValue placeholder="Selecciona un método" />
                  </SelectTrigger>
                  <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-2xl">
                    <SelectItem value="CASH">Efectivo</SelectItem>
                    <SelectItem value="TRANSFER">Transferencia</SelectItem>
                    <SelectItem value="CREDIT">Crédito</SelectItem>
                    <SelectItem value="CORTESIA">Cortesía</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Referencia de Pago (Opcional)</Label>
                <Input
                  value={collectReference}
                  onChange={(e: any) => setCollectReference(e.target.value)}
                  placeholder="Número de aprobación, comprobante, etc."
                  className="h-11 bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl text-sm focus:border-[var(--accent)]/50 focus:ring-1 focus:ring-[var(--accent)]/50 transition-all font-semibold text-[var(--text-primary)]"
                />
              </div>

              {/* Checkbox to print invoice */}
              <div className="flex items-center gap-2.5 py-1 px-1">
                <input
                  type="checkbox"
                  id="printInvoiceOnCollect"
                  checked={printInvoiceOnCollect}
                  onChange={e => setPrintInvoiceOnCollect(e.target.checked)}
                  className="h-4.5 w-4.5 accent-[var(--accent)] rounded cursor-pointer shrink-0"
                />
                <Label htmlFor="printInvoiceOnCollect" className="text-xs font-bold text-[var(--text-secondary)] cursor-pointer select-none leading-none text-[var(--text-primary)]">
                  Imprimir factura de caja (Caja)
                </Label>
              </div>

              <div className="flex gap-3 mt-3">
                <Button variant="outline" className="flex-1 h-12 rounded-xl font-bold text-sm border-[var(--border-default)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] bg-[var(--bg-panel)]" onClick={() => setCollectDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button className="flex-1 h-12 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] rounded-xl font-bold text-sm shadow-md shadow-[var(--accent)]/10 border-0 cursor-pointer transition-all" onClick={handleCollectPayment} disabled={isSubmittingPayment}>
                  {isSubmittingPayment ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Confirmar Cobro
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
