import React, { useState, useEffect, useRef } from 'react'
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
    if (!silent) setLoading(true)
    try {
      const data = await api.get<any>(`/whatsapp/order-chat/${order.id}`)
      if (data) {
        if (data.order) setCurrentOrder(data.order)
        setSession(data.session || null)
        setMessages(data.messages || [])
        setTransferProofs(data.transferProofs || [])
      }
    } catch (err: any) {
      console.error('Error cargando chat de orden:', err)
      if (!silent) {
        alerts.toast('No se pudo cargar el chat de WhatsApp del pedido', 'error')
      }
    } finally {
      if (!silent) setLoading(false)
      scrollToBottom(false)
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
      if (!newMsg) return
      const isTargetSession = session && newMsg.sessionId === session.id
      const cleanCustomerPhone = (currentOrder?.customerPhone || '').replace(/\D/g, '')
      const msgPhone = (newMsg.phone || newMsg.customerPhone || '').replace(/\D/g, '')
      const isTargetPhone = cleanCustomerPhone && msgPhone && (
        cleanCustomerPhone.includes(msgPhone) || msgPhone.includes(cleanCustomerPhone)
      )

      if (isTargetSession || isTargetPhone) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id || (m.waMessageId && m.waMessageId === newMsg.waMessageId))) {
            return prev
          }
          return [...prev, newMsg]
        })
        scrollToBottom(true)
      }
    })

    return () => {
      socket.disconnect()
    }
  }, [isOpen, session?.id, currentOrder?.customerPhone])

  const handleCopyPhone = () => {
    if (!currentOrder?.customerPhone) return
    navigator.clipboard.writeText(currentOrder.customerPhone)
    setCopiedPhone(true)
    setTimeout(() => setCopiedPhone(false), 2000)
    alerts.toast('Teléfono copiado al portapapeles', 'info')
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="relative w-full max-w-3xl h-[92vh] sm:h-[88vh] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabecera del Modal */}
        <div className="p-3.5 sm:p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 px-2.5 py-1 rounded-xl text-xs font-black tracking-wide">
                <MessageSquare className="w-4 h-4 text-emerald-500" />
                <span>WHATSAPP #{currentOrder?.orderNumber}</span>
              </div>
              <span className="text-sm sm:text-base font-bold text-[var(--text-primary)] truncate max-w-[180px] sm:max-w-xs">
                {currentOrder?.customerName || 'Cliente'}
              </span>
            </div>

            <div className="flex items-center gap-1 sm:gap-2">
              <button
                type="button"
                onClick={() => loadChat(false)}
                className="p-1.5 sm:p-2 rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                title="Actualizar chat"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>

              {session?.id && (
                <a
                  href={`/chat?session=${session.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1.5 sm:p-2 rounded-xl text-[var(--text-secondary)] hover:text-emerald-500 hover:bg-emerald-500/10 transition-colors flex items-center gap-1 text-xs font-semibold cursor-pointer"
                  title="Abrir en pantalla completa de WhatsApp"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span className="hidden sm:inline">Abrir Completo</span>
                </a>
              )}

              <button
                type="button"
                onClick={onClose}
                className="p-1.5 sm:p-2 rounded-xl text-[var(--text-secondary)] hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                title="Cerrar modal (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Subcabecera: Datos del pedido y del cliente */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs bg-[var(--bg-surface)] p-2.5 rounded-xl border border-[var(--border-subtle)]/60">
            {/* Teléfono */}
            <div className="flex items-center justify-between sm:justify-start gap-2">
              <div className="flex items-center gap-1.5 text-[var(--text-secondary)] font-medium">
                <Phone className="w-3.5 h-3.5 text-emerald-500" />
                <span className="font-mono font-bold text-[var(--text-primary)]">{currentOrder?.customerPhone || 'Sin teléfono'}</span>
              </div>
              {currentOrder?.customerPhone && (
                <button
                  type="button"
                  onClick={handleCopyPhone}
                  className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                  title="Copiar teléfono"
                >
                  {copiedPhone ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>

            {/* Dirección */}
            <div className="flex items-center gap-1.5 text-[var(--text-secondary)] truncate">
              <MapPin className="w-3.5 h-3.5 text-orange-500 shrink-0" />
              <span className="truncate" title={currentOrder?.customerAddress}>
                {currentOrder?.customerAddress || 'Sin dirección'}
              </span>
            </div>

            {/* Total */}
            <div className="flex items-center justify-end gap-1.5 font-bold text-[var(--text-primary)]">
              <span className="text-[10px] text-[var(--text-secondary)] font-semibold uppercase">Total a cobrar:</span>
              <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                ${Number(currentOrder?.total || 0).toLocaleString('es-CO')}
              </span>
            </div>
          </div>

          {/* BARRA DE RECTIFICACIÓN DE PAGO (CLAVE PARA EL USUARIO) */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <Receipt className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span className="text-xs font-bold text-[var(--text-primary)]">Método de Pago:</span>
              </div>
              <span className={`px-2 py-0.5 rounded-lg text-xs font-black uppercase tracking-wide ${
                isTransferMethod
                  ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30'
                  : isCashMethod
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                  : 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border border-purple-500/30'
              }`}>
                {getPaymentMethodLabel(paymentMethod)}
              </span>
            </div>

            {/* Botones de rectificación rápida */}
            {!isDeliveryStaff && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold text-[var(--text-secondary)] hidden sm:inline">Rectificar:</span>
                <button
                  type="button"
                  onClick={() => handleQuickPaymentChange('CASH')}
                  disabled={isUpdatingPayment || isCashMethod}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                    isCashMethod
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-[var(--bg-surface)] hover:bg-emerald-500/15 hover:text-emerald-600 text-[var(--text-secondary)] border border-[var(--border-subtle)]'
                  }`}
                  title="Marcar pago en Efectivo"
                >
                  💵 Efectivo
                </button>

                <button
                  type="button"
                  onClick={() => handleQuickPaymentChange('TRANSFER')}
                  disabled={isUpdatingPayment || isTransferMethod}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                    isTransferMethod
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-[var(--bg-surface)] hover:bg-blue-500/15 hover:text-blue-600 text-[var(--text-secondary)] border border-[var(--border-subtle)]'
                  }`}
                  title="Marcar pago por Transferencia"
                >
                  📱 Transferencia
                </button>

                <button
                  type="button"
                  onClick={() => handleQuickPaymentChange('NEQUI')}
                  disabled={isUpdatingPayment || paymentMethod === 'NEQUI'}
                  className="px-2 py-1 rounded-lg text-xs font-bold bg-[var(--bg-surface)] hover:bg-purple-500/15 hover:text-purple-600 text-[var(--text-secondary)] border border-[var(--border-subtle)] transition-all cursor-pointer"
                  title="Marcar pago por Nequi"
                >
                  💜 Nequi
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Banner de Comprobantes Adjuntos en la Orden (si existen) */}
        {transferProofs.length > 0 && (
          <div className="px-4 py-2 bg-blue-500/10 border-b border-blue-500/20 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <FileCheck className="w-4 h-4 text-blue-500 shrink-0" />
              <span className="font-bold text-blue-700 dark:text-blue-300">
                {transferProofs.length} Comprobante(s) de transferencia registrado(s) en este pedido
              </span>
            </div>
            <div className="flex items-center gap-2">
              {transferProofs.map((proof, idx) => (
                <button
                  key={proof.id || idx}
                  type="button"
                  onClick={() => {
                    const src = proof.fileBase64 
                      ? (proof.fileBase64.startsWith('data:') ? proof.fileBase64 : `data:${proof.mimeType || 'image/jpeg'};base64,${proof.fileBase64}`)
                      : proof.filePath;
                    setFullScreenProof(src);
                  }}
                  className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold shadow-sm transition-all cursor-pointer flex items-center gap-1"
                >
                  <Eye className="w-3 h-3" />
                  Ver Comprobante #{idx + 1}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Modal de Comprobante en Grande */}
        {fullScreenProof && (
          <div 
            className="fixed inset-0 z-[99999] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4 select-none"
            onClick={() => setFullScreenProof(null)}
          >
            <div className="relative max-w-4xl max-h-[88vh] flex flex-col items-center">
              <button
                type="button"
                onClick={() => setFullScreenProof(null)}
                className="absolute -top-10 right-0 p-1.5 rounded-xl bg-white/20 hover:bg-red-500 text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
              <img 
                src={fullScreenProof} 
                alt="Comprobante Transferencia" 
                className="max-h-[80vh] max-w-[90vw] object-contain rounded-xl shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        )}

        {/* CUERPO DEL CHAT (BURBUJAS DE WHATSAPP REALES) */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 bg-[#efeae2]/10 dark:bg-black/20">
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
                Aún no hay historial de chat registrado para {currentOrder?.customerPhone || 'este cliente'}. Puedes enviarle un mensaje escribiendo aquí abajo.
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
                      className={`relative max-w-[85%] sm:max-w-[75%] rounded-2xl p-3 shadow-sm border ${
                        isCustomer
                          ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border-[var(--border-subtle)] rounded-tl-sm'
                          : 'bg-emerald-600 text-white border-emerald-500/40 rounded-tr-sm'
                      }`}
                    >
                      {/* Remitente tag */}
                      <div className="text-[10px] font-black tracking-wider uppercase mb-1 opacity-75">
                        {isCustomer ? (currentOrder?.customerName || 'Cliente') : 'The Villa Dog'}
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
                      <div className={`text-[9px] mt-1 flex items-center justify-end gap-1 font-mono ${
                        isCustomer ? 'text-[var(--text-secondary)]' : 'text-emerald-100'
                      }`}>
                        <span>{formatMessageTime(msg.createdAt)}</span>
                        {!isCustomer && (
                          <span className="text-[10px] font-bold">✓✓</span>
                        )}
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
          className="p-3 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 flex items-center gap-2"
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={`Escribe a ${currentOrder?.customerName || 'el cliente'} por WhatsApp...`}
            disabled={isSending}
            className="flex-1 px-3.5 py-2.5 text-xs sm:text-sm bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl text-[var(--text-primary)] placeholder-[var(--text-secondary)]/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          />
          <button
            type="submit"
            disabled={isSending || !inputText.trim()}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
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
      </div>
    </div>
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
