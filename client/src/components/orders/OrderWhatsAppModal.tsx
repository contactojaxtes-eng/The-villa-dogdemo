import React, { useState, useEffect, useRef } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  X,
  Send,
  Loader2,
  Phone,
  MapPin,
  DollarSign,
  Copy,
  Check,
  ExternalLink,
  MessageSquare,
  AlertCircle,
  RefreshCw,
  Clock,
  ArrowRightLeft,
  Receipt,
  FileCheck,
  Eye,
} from 'lucide-react'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { useAuth } from '@/hooks/useAuth'
import { WhatsAppMedia, WhatsAppDocument } from '@/components/whatsapp/WhatsAppMedia'
import { type Socket } from 'socket.io-client'
import { io } from '@/lib/socket'

interface OrderWhatsAppModalProps {
  order: any
  isOpen: boolean
  onClose: () => void
  onPaymentUpdated?: (newMethod?: string) => void
}

interface ChatMessage {
  id: string
  waMessageId?: string | null
  direction: string
  content: string
  messageType: string
  status: string
  createdAt: string
  reaction?: string | null
}

export default function OrderWhatsAppModal({
  order,
  isOpen,
  onClose,
  onPaymentUpdated,
}: OrderWhatsAppModalProps) {
  const { user } = useAuth()
  const isAdmin = ['SUPERADMIN', 'ADMIN'].includes(user?.role || '')
  const isDeliveryStaff = !isAdmin && (
    ['DELIVERY_MANAGER', 'DISPATCHER'].includes(user?.role || '') ||
    Boolean(user?.role && /dispatch|domicil/i.test(user.role))
  )

  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<any | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [transferProofs, setTransferProofs] = useState<any[]>([])
  const [inputText, setInputText] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [isUpdatingPayment, setIsUpdatingPayment] = useState(false)
  const [copiedPhone, setCopiedPhone] = useState(false)
  const [currentOrder, setCurrentOrder] = useState<any>(order)
  const [fullScreenProof, setFullScreenProof] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const socketRef = useRef<Socket | null>(null)
  const loadRequestIdRef = useRef(0)

  useEffect(() => {
    setSession(null)
    setMessages([])
    setTransferProofs([])
  }, [order?.id])

  useEffect(() => {
    setCurrentOrder(order)
  }, [order])

  const scrollToBottom = (smooth = true) => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' })
    }, 100)
  }

  const loadChat = async (silent = false) => {
    if (!order?.id) return
    const requestId = ++loadRequestIdRef.current
    if (!silent) setLoading(true)
    try {
      const data = await api.get<any>(`/whatsapp/order-chat/${order.id}`)
      if (data && requestId === loadRequestIdRef.current) {
        if (data.order) setCurrentOrder(data.order)
        setSession(data.session || null)
        setMessages(data.messages || [])
        setTransferProofs(data.transferProofs || [])
      }
    } catch (err: any) {
      console.error('Error cargando chat de orden:', err)
      if (!silent) {
        void alerts.error('No se pudo cargar el chat', 'No fue posible abrir la conversación de WhatsApp de este pedido.')
      }
    } finally {
      if (requestId === loadRequestIdRef.current) {
        if (!silent) setLoading(false)
        scrollToBottom(false)
      }
    }
  }

  useEffect(() => {
    if (isOpen && order?.id) {
      loadChat()
    }
  }, [isOpen, order?.id])

  // Socket listener para mensajes en tiempo real
  useEffect(() => {
    if (!isOpen) return

    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      query: { userId: user?.id, userName: user?.name },
      transports: ['websocket', 'polling'],
    })
    socketRef.current = socket

    socket.on('whatsappMessage', (newMsg: any) => {
      if (!newMsg || !session?.id || newMsg.sessionId !== session.id) return
      setMessages((prev) => {
        if (prev.some((m) => m.id === newMsg.id || (m.waMessageId && m.waMessageId === newMsg.waMessageId))) {
          return prev
        }
        return [...prev, newMsg]
      })
      scrollToBottom(true)
    })

    return () => {
      socket.disconnect()
    }
  }, [isOpen, session?.id, user?.id, user?.name])

  const handleCopyPhone = () => {
    if (!currentOrder?.customerPhone) return
    navigator.clipboard.writeText(currentOrder.customerPhone)
    setCopiedPhone(true)
    setTimeout(() => setCopiedPhone(false), 2000)
    alerts.toast('Teléfono copiado al portapapeles')
  }

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const text = inputText.trim()
    if (!text || isSending || !currentOrder?.id) return

    setIsSending(true)
    try {
      const res = await api.post<any>(`/whatsapp/order-chat/${currentOrder.id}/send`, { text })
      setInputText('')
      if (res && res.messageId) {
        setMessages((prev) => [
          ...prev,
          {
            id: res.messageId,
            waMessageId: res.messageId,
            direction: 'OUT',
            content: text,
            messageType: 'text',
            status: 'sent',
            createdAt: new Date().toISOString(),
          },
        ])
      } else {
        loadChat(true)
      }
      scrollToBottom(true)
    } catch (err: any) {
      alerts.error('Error al enviar mensaje', err.message || 'No se pudo enviar el mensaje por WhatsApp.')
    } finally {
      setIsSending(false)
    }
  }

  const handleQuickPaymentChange = async (newMethod: string) => {
    if (isDeliveryStaff) {
      alerts.warning('Acción restringida', 'El despachador de domicilio no tiene permisos para modificar métodos de pago.')
      return
    }
    if (isUpdatingPayment || !currentOrder?.id) return

    setIsUpdatingPayment(true)
    try {
      const tot = Number(currentOrder.total) || 0
      const isCash = newMethod === 'CASH'
      const isTransfer = ['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'].includes(newMethod)

      await api.put(`/orders/${currentOrder.id}/payment`, {
        method: newMethod,
        paymentStatus: currentOrder.paymentStatus || 'PENDING',
        cashAmount: isCash ? tot : 0,
        transferAmount: isTransfer ? tot : 0,
      })

      setCurrentOrder((prev: any) => ({
        ...prev,
        paymentMethod: newMethod,
        cashAmount: isCash ? tot : 0,
        transferAmount: isTransfer ? tot : 0,
      }))

      alerts.success(
        'Método de Pago Rectificado',
        `El pedido #${currentOrder.orderNumber} se actualizó a ${getPaymentMethodLabel(newMethod)}.`
      )
      onPaymentUpdated?.(newMethod)
    } catch (err: any) {
      alerts.error('Error al cambiar método de pago', err.message || 'No se pudo actualizar el método de pago.')
    } finally {
      setIsUpdatingPayment(false)
    }
  }

  if (!isOpen || !order) return null

  const paymentMethod = (currentOrder?.paymentMethod || 'CASH').toUpperCase()
  const isTransferMethod = ['TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'].includes(paymentMethod)
  const isCashMethod = paymentMethod === 'CASH'

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        />
        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] z-[120] translate-x-[-50%] translate-y-[-50%] w-[96vw] max-w-5xl lg:max-w-6xl h-[92vh] sm:h-[90vh] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden outline-none animate-in zoom-in-95 duration-200"
          data-scroll-locked-ignore="true"
          onClick={(e) => e.stopPropagation()}
          onPointerDownOutside={(e) => {
            e.stopPropagation()
          }}
          onInteractOutside={(e) => {
            e.stopPropagation()
          }}
          onEscapeKeyDown={(e) => {
            e.stopPropagation()
            onClose()
          }}
        >
          {/* Cabecera del Modal */}
          <div className="p-4 sm:p-5 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 flex flex-col gap-3 shrink-0">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
                <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 px-3 py-1.5 rounded-xl text-xs sm:text-sm font-black tracking-wide shrink-0">
                  <MessageSquare className="w-4 h-4 text-emerald-500" />
                  <span>WHATSAPP #{currentOrder?.orderNumber}</span>
                </div>
                <span className="text-base sm:text-lg font-black text-[var(--text-primary)] truncate">
                  {currentOrder?.customerName || 'Cliente'}
                </span>
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => loadChat(false)}
                  className="p-2 rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                  aria-label="Actualizar conversación de WhatsApp"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>

                {session?.id && (
                  <a
                    href={`/chat?session=${session.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2 rounded-xl text-[var(--text-secondary)] hover:text-emerald-500 hover:bg-emerald-500/10 transition-colors flex items-center gap-1.5 text-xs font-bold cursor-pointer"
                    aria-label="Abrir en pantalla completa de WhatsApp"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span className="hidden sm:inline">Abrir Completo</span>
                  </a>
                )}

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose()
                  }}
                  className="p-2 rounded-xl text-[var(--text-secondary)] hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                  aria-label="Cerrar modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Subcabecera: Datos del pedido y del cliente organizados */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs bg-[var(--bg-surface)] p-3 rounded-2xl border border-[var(--border-subtle)]">
              {/* Teléfono */}
              <div className="flex items-center justify-between sm:justify-start gap-2">
                <div className="flex items-center gap-1.5 text-[var(--text-secondary)] font-medium">
                  <Phone className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span className="font-mono font-bold text-sm text-[var(--text-primary)]">
                    {currentOrder?.customerPhone || 'Sin teléfono'}
                  </span>
                </div>
                {currentOrder?.customerPhone && (
                  <button
                    type="button"
                    onClick={handleCopyPhone}
                    className="p-1 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                    aria-label="Copiar teléfono"
                  >
                    {copiedPhone ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>

              {/* Dirección */}
              <div className="flex items-center gap-1.5 text-[var(--text-secondary)] truncate">
                <MapPin className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                <span className="truncate font-medium" title={currentOrder?.customerAddress}>
                  {currentOrder?.customerAddress || 'Sin dirección'}
                </span>
              </div>

              {/* Total a cobrar */}
              <div className="flex items-center justify-start sm:justify-end gap-2 font-bold text-[var(--text-primary)]">
                <span className="text-[10px] text-[var(--text-secondary)] font-bold uppercase tracking-wider">
                  Total a cobrar:
                </span>
                <span className="text-base font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                  ${Number(currentOrder?.total || 0).toLocaleString('es-CO')}
                </span>
              </div>
            </div>

            {/* BARRA DE RECTIFICACIÓN DE PAGO */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/25">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <Receipt className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span className="text-xs font-bold text-[var(--text-primary)]">Método de Pago:</span>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-xl text-xs font-black uppercase tracking-wide ${
                    isTransferMethod
                      ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30'
                      : isCashMethod
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                      : 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30'
                  }`}
                >
                  {getPaymentMethodLabel(paymentMethod)}
                </span>
              </div>

              {/* Botones de rectificación rápida */}
              {!isDeliveryStaff && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-bold text-[var(--text-secondary)] hidden md:inline">
                    Rectificar a:
                  </span>
                  <button
                    type="button"
                    onClick={() => handleQuickPaymentChange('CASH')}
                    disabled={isUpdatingPayment || isCashMethod}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      isCashMethod
                        ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-600/30'
                        : 'bg-[var(--bg-surface)] hover:bg-emerald-500/15 hover:text-emerald-600 text-[var(--text-secondary)] border border-[var(--border-subtle)]'
                    }`}
                  >
                    💵 Efectivo
                  </button>

                  <button
                    type="button"
                    onClick={() => handleQuickPaymentChange('TRANSFER')}
                    disabled={isUpdatingPayment || isTransferMethod}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      isTransferMethod
                        ? 'bg-blue-600 text-white shadow-sm ring-2 ring-blue-600/30'
                        : 'bg-[var(--bg-surface)] hover:bg-blue-500/15 hover:text-blue-600 text-[var(--text-secondary)] border border-[var(--border-subtle)]'
                    }`}
                  >
                    📱 Transferencia
                  </button>

                  <button
                    type="button"
                    onClick={() => handleQuickPaymentChange('NEQUI')}
                    disabled={isUpdatingPayment || paymentMethod === 'NEQUI'}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      paymentMethod === 'NEQUI'
                        ? 'bg-purple-600 text-white shadow-sm ring-2 ring-purple-600/30'
                        : 'bg-[var(--bg-surface)] hover:bg-purple-500/15 hover:text-purple-600 text-[var(--text-secondary)] border border-[var(--border-subtle)]'
                    }`}
                  >
                    💜 Nequi
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Banner de Comprobantes Adjuntos en la Orden (si existen) */}
          {transferProofs.length > 0 && (
            <div className="px-4 py-2.5 bg-blue-500/10 border-b border-blue-500/20 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
              <div className="flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-blue-500 shrink-0" />
                <span className="font-bold text-blue-700 dark:text-blue-300">
                  {transferProofs.length} Comprobante(s) de transferencia registrado(s)
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {transferProofs.map((proof, idx) => (
                  <button
                    key={proof.id || idx}
                    type="button"
                    onClick={() => {
                      const src = proof.fileBase64
                        ? proof.fileBase64.startsWith('data:')
                          ? proof.fileBase64
                          : `data:${proof.mimeType || 'image/jpeg'};base64,${proof.fileBase64}`
                        : proof.filePath
                      setFullScreenProof(src)
                    }}
                    className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold shadow-sm transition-all cursor-pointer flex items-center gap-1"
                  >
                    <Eye className="w-3 h-3" />
                    Ver Comprobante #{idx + 1}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Modal de Comprobante en Pantalla Completa */}
          {fullScreenProof && (
            <div
              className="fixed inset-0 z-[150] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 select-none"
              onClick={() => setFullScreenProof(null)}
            >
              <div className="relative max-w-5xl max-h-[90vh] flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => setFullScreenProof(null)}
                  className="absolute -top-12 right-0 p-2 rounded-xl bg-white/20 hover:bg-red-500 text-white transition-colors cursor-pointer"
                  aria-label="Cerrar visor"
                >
                  <X className="w-6 h-6" />
                </button>
                <img
                  src={fullScreenProof}
                  alt="Comprobante Transferencia"
                  className="max-h-[82vh] max-w-[92vw] object-contain rounded-2xl shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>
          )}

          {/* CUERPO DEL CHAT (BURBUJAS DE WHATSAPP REALES) */}
          <div
            className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 bg-[#efeae2]/15 dark:bg-black/25 overscroll-contain select-text scrollbar-thin scrollbar-thumb-[var(--border-default)] scrollbar-track-transparent"
            data-scroll-locked-ignore="true"
            data-radix-scroll-area-viewport=""
            style={{
              overscrollBehavior: 'contain',
              WebkitOverflowScrolling: 'touch',
              touchAction: 'pan-y',
            }}
            onWheel={(e) => {
              e.stopPropagation()
            }}
          >
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--text-secondary)]">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                <span className="text-xs font-semibold">Cargando conversación de WhatsApp...</span>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-6 text-center text-[var(--text-secondary)]">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mb-3 text-emerald-500">
                  <MessageSquare className="w-6 h-6" />
                </div>
                <p className="text-sm font-bold text-[var(--text-primary)]">No hay mensajes previos con este número</p>
                <p className="text-xs text-[var(--text-secondary)] max-w-sm mt-1">
                  Aún no hay historial de chat registrado para {currentOrder?.customerPhone || 'este cliente'}. Puedes
                  enviarle un mensaje escribiendo aquí abajo.
                </p>
              </div>
            ) : (
              <>
                {messages.map((msg, index) => {
                  const isCustomer = msg.direction === 'IN'
                  const isImage = msg.messageType === 'image'
                  const isAudio = msg.messageType === 'audio'
                  const isVideo = msg.messageType === 'video'
                  const isDoc = msg.messageType === 'document'

                  return (
                    <div
                      key={msg.id || index}
                      className={`flex ${isCustomer ? 'justify-start' : 'justify-end'} animate-in fade-in duration-150`}
                    >
                      <div
                        className={`relative max-w-[85%] sm:max-w-[70%] rounded-2xl p-3 sm:p-3.5 shadow-sm border ${
                          isCustomer
                            ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border-[var(--border-subtle)] rounded-tl-sm'
                            : 'bg-emerald-600 text-white border-emerald-500/40 rounded-tr-sm'
                        }`}
                      >
                        {/* Remitente tag */}
                        <div className="text-[10px] font-black tracking-wider uppercase mb-1 opacity-75">
                          {isCustomer ? currentOrder?.customerName || 'Cliente' : 'The Villa Dog'}
                        </div>

                        {/* Contenido según tipo */}
                        {isImage ? (
                          <div className="mt-1">
                            <WhatsAppMedia mediaId={msg.content} type="image" />
                          </div>
                        ) : isAudio ? (
                          <div className="mt-1">
                            <WhatsAppMedia mediaId={msg.content} type="audio" />
                          </div>
                        ) : isVideo ? (
                          <div className="mt-1">
                            <WhatsAppMedia mediaId={msg.content} type="video" />
                          </div>
                        ) : isDoc ? (
                          <div className="mt-1">
                            <WhatsAppDocument mediaId={msg.content} />
                          </div>
                        ) : (
                          <p className="text-xs sm:text-sm whitespace-pre-wrap leading-relaxed select-text font-normal break-words">
                            {msg.content}
                          </p>
                        )}

                        {/* Hora */}
                        <div
                          className={`text-[9px] mt-1.5 flex items-center justify-end gap-1 font-mono ${
                            isCustomer ? 'text-[var(--text-secondary)]' : 'text-emerald-100'
                          }`}
                        >
                          <span>{formatMessageTime(msg.createdAt)}</span>
                          {!isCustomer && <span className="text-[10px] font-bold">✓✓</span>}
                        </div>
                      </div>
                    </div>
                  )
                })}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* PIE DEL MODAL: ENVÍO DE MENSAJE DE WHATSAPP DIRECTO */}
          <form
            onSubmit={handleSendMessage}
            className="p-3 sm:p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 flex items-center gap-2.5 shrink-0"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={`Escribe a ${currentOrder?.customerName || 'el cliente'} por WhatsApp...`}
              disabled={isSending}
              className="flex-1 px-4 py-2.5 text-xs sm:text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl text-[var(--text-primary)] placeholder-[var(--text-secondary)]/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
            <button
              type="submit"
              disabled={isSending || !inputText.trim()}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
            >
              {isSending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span className="hidden sm:inline">Enviar</span>
                </>
              )}
            </button>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function getPaymentMethodLabel(method: string): string {
  switch (method?.toUpperCase()) {
    case 'CASH':
      return '💵 Efectivo'
    case 'TRANSFER':
      return '📱 Transferencia'
    case 'NEQUI':
      return '💜 Nequi'
    case 'BANCOLOMBIA':
      return '💛 Bancolombia'
    case 'DAVIPLATA':
      return '❤️ Daviplata'
    case 'MIXED':
      return '🔀 Mixto'
    case 'CREDIT':
      return '💳 Crédito'
    case 'CORTESIA':
      return '🎁 Cortesía'
    default:
      return method || 'Efectivo'
  }
}

function formatMessageTime(dateString?: string): string {
  if (!dateString) return ''
  try {
    const d = new Date(dateString)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true })
  } catch {
    return ''
  }
}
