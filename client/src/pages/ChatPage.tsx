import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { type Socket } from 'socket.io-client'
import { io } from '@/lib/socket'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { 
  MessageCircle, Send, UserCheck, UserPlus, UserX, PlusCircle, User, 
  Phone, Clock, AlertCircle, AlertTriangle, ArrowLeft, Loader2, Trash2, Paperclip, FileText, Camera,
  Mic, MicOff, Check, CheckCheck, CheckCircle2, Pencil, Search, Lock,
  ChevronDown, Copy, ChevronLeft, ChevronRight, MapPin, ExternalLink, Download, Forward, QrCode, Reply, X,
  MessageSquareText, Bell, BellOff, Bot, BotOff,
  Eye, Shield, RotateCw, ZoomIn, ZoomOut
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mp3Recorder } from '@/lib/mp3Recorder'
import { WhatsAppMedia, WhatsAppDocument } from '@/components/whatsapp/WhatsAppMedia'
import type { EmbeddedOrderParams } from './NewOrderPage'

const EmbeddedNewOrderPage = React.lazy(() => import('./NewOrderPage'))

type Session = {
  id: string
  phone: string
  customerPhone?: string | null
  customerName: string | null
  lastMessageAt: string
  assignedToId: string | null
  assignedTo: { id: string; name: string } | null
  unreadCount?: number
  /** Query for which the server confirmed a historical message match. */
  searchMatchedFor?: string | null
  /** The latest message that matched the active global search query. */
  searchMatches?: SearchMatch[]
  activeOrder?: { id: string; orderNumber: number; status: string; total?: number } | null
  messages: Message[]
}

type ChatFilter = 'TODAY' | 'ALL' | 'UNREAD' | 'WAITING' | 'MINE' | 'UNASSIGNED'

const orderSessionsForFilter = (items: Session[], filter: ChatFilter) => {
  if (filter !== 'UNREAD') return items
  return [...items].sort((a, b) => {
    const aTime = new Date(a.lastMessageAt || 0).getTime() || 0
    const bTime = new Date(b.lastMessageAt || 0).getTime() || 0
    return aTime - bTime
  })
}

type SearchMatch = {
  id: string
  content: string
  direction: 'IN' | 'OUT' | string
  messageType: string
  createdAt: string
}

type SessionPage = {
  items: Session[]
  nextCursor: string | null
}

type Message = {
  id: string
  direction: 'IN' | 'OUT'
  content: string
  messageType: string
  status: string
  isEdited?: boolean
  createdAt: string
  waMessageId?: string | null
  reaction?: string | null
  replyToContent?: string | null
  replyToDirection?: 'IN' | 'OUT' | null
}

const formatMessageTime = (dateStr?: string | null) => {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  
  const isToday = d.toDateString() === now.toDateString()
  
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
  
  if (isToday) {
    return timeStr
  } else if (isYesterday) {
    return `Ayer, ${timeStr}`
  } else {
    const dateOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
    if (d.getFullYear() !== now.getFullYear()) {
      dateOpts.year = '2-digit'
    }
    return `${d.toLocaleDateString([], dateOpts)}, ${timeStr}`
  }
}

const formatSessionTime = (dateStr?: string | null) => {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  
  const isToday = d.toDateString() === now.toDateString()
  
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  
  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
  } else if (isYesterday) {
    return 'Ayer'
  } else {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }
}

const formatSeparatorDate = (dateStr?: string | null) => {
  if (!dateStr) return 'Hoy'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return 'Hoy'
  const now = new Date()
  
  const isToday = d.toDateString() === now.toDateString()
  
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  
  if (isToday) return 'Hoy'
  if (isYesterday) return 'Ayer'
  
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}

const formatTemplateContent = (text: string) => {
  if (!text) return text
  if (text.includes('[Plantilla: actualizacion_sistema_niche]')) {
    return '📢 ¡Hola! Te informamos sobre la actualización de nuestro sistema de atención y domicilios en The Villa Dog.'
  }
  if (text.includes('[Plantilla: niche_aviso_servicio]')) {
    return '📢 Estimado(a) cliente, le confirmamos la actualización de nuestro canal oficial de atención en The Villa Dog.'
  }
  if (text.includes('[Plantilla: notificacion_atencion_niche]')) {
    return '📢 ¡Hola! 👋 Queremos confirmar la recepción de tu mensaje. En un momento un asesor de The Villa Dog te atenderá.'
  }
  if (text.includes('[Plantilla: niche_prueba]')) {
    return '📢 ¡Hola! Gracias por comunicarte con The Villa Dog.'
  }
  if (text.startsWith('[Plantilla: ') && text.endsWith(']')) {
    const name = text.replace('[Plantilla: ', '').replace(']', '')
    return `📢 Plantilla Meta: ${name}`
  }
  return text
}

const MessageStatus = ({ 
  status, 
  direction, 
  isList = false, 
  onRetry 
}: { 
  status: string; 
  direction: 'IN' | 'OUT'; 
  isList?: boolean; 
  onRetry?: () => void 
}) => {
  if (direction === 'IN') return null;
  
  const defaultIconColor = isList ? 'text-[var(--text-muted)]' : 'text-emerald-100/70';
  const norm = (status || 'sent').toLowerCase();

  if (norm === 'read') {
    return <span title="Leído por el cliente"><CheckCheck className="h-3.5 w-3.5 text-[#34B7F1] inline shrink-0" /></span>
  }
  if (norm === 'delivered') {
    return <span title="Entregado al celular"><CheckCheck className={cn("h-3.5 w-3.5 inline shrink-0", defaultIconColor)} /></span>
  }
  if (norm === 'pending' || norm === 'sending') {
    return <span title="Enviando..."><Clock className={cn("h-2.5 w-2.5 animate-pulse inline shrink-0", defaultIconColor)} /></span>
  }
  if (norm === 'failed') {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (onRetry) onRetry()
        }}
        className={cn(
          "inline-flex items-center gap-1 text-red-200 hover:text-white font-bold cursor-pointer transition-colors",
          onRetry ? "hover:scale-105" : ""
        )}
        title="Error al enviar a WhatsApp. Haz clic para reintentar"
      >
        <AlertCircle className="h-3.5 w-3.5 text-red-200 inline shrink-0 animate-bounce" />
        {onRetry && !isList && <span className="text-[9px] underline font-sans">Reintentar</span>}
      </button>
    )
  }
  return <span title="Enviado a WhatsApp"><Check className={cn("h-3.5 w-3.5 inline shrink-0", defaultIconColor)} /></span>
}

interface ChatInputBarProps {
  disabled: boolean
  compact?: boolean
  onSendText: (text: string) => void
  onSendMenuCarta: () => void
  sendingMenu: boolean
  onSendPaymentQr: () => void
  sendingPaymentQr: boolean
  fileInputRef: React.RefObject<HTMLInputElement | null>
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onPasteScreenshot?: () => void
  uploadingMedia: boolean
  isRecording: boolean
  recordingTime: number
  startRecording: () => void
  stopRecording: () => void
  cancelRecording: () => void
  placeholder: string
  replyingTo?: Message | null
  onCancelReply?: () => void
  onSendLocation?: () => void
  sendingLocation?: boolean
  onTyping?: (isTyping: boolean) => void
  inputRef?: React.RefObject<HTMLInputElement | null>
}

const ChatInputBar = React.memo(({
  disabled,
  compact = false,
  onSendText,
  onSendMenuCarta,
  sendingMenu,
  onSendPaymentQr,
  sendingPaymentQr,
  fileInputRef,
  handleFileChange,
  uploadingMedia,
  isRecording,
  recordingTime,
  startRecording,
  stopRecording,
  cancelRecording,
  placeholder,
  replyingTo,
  onCancelReply,
  onSendLocation,
  sendingLocation,
  onTyping,
  inputRef,
  onPasteScreenshot
}: ChatInputBarProps) => {
  const [localText, setLocalText] = useState('')
  const typingTimerRef = useRef<any>(null)

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setLocalText(val)
    if (onTyping && !disabled) {
      if (val.trim().length > 0) {
        onTyping(true)
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
        typingTimerRef.current = setTimeout(() => {
          onTyping(false)
        }, 2500)
      } else {
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
        onTyping(false)
      }
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!localText.trim() || disabled) return
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
    onTyping?.(false)
    onSendText(localText.trim())
    setLocalText('')
  }

  return (
    <div>
    {replyingTo && (
      <div className="px-3 pt-2 pb-1 bg-[var(--bg-panel)] border-t border-[var(--border-subtle)] flex items-center gap-2">
        <div className="flex-1 bg-[var(--bg-elevated)] rounded-xl px-3 py-2 border-l-4 border-[var(--accent)]">
          <p className="text-[10px] font-extrabold text-[var(--accent)] mb-0.5">
            {replyingTo.direction === 'IN' ? 'Cliente' : 'Tú'}
          </p>
          <p className="text-xs text-[var(--text-secondary)] line-clamp-2">
            {replyingTo.messageType === 'image' ? '📷 Imagen' : replyingTo.messageType === 'audio' ? '🎤 Audio' : replyingTo.messageType === 'document' ? '📄 Documento' : replyingTo.content}
          </p>
        </div>
        <button type="button" onClick={onCancelReply} className="p-1 hover:bg-[var(--bg-hover)] rounded-lg transition-colors">
          <X className="h-4 w-4 text-[var(--text-secondary)]" />
        </button>
      </div>
    )}
    <form
      onSubmit={handleSubmit}
      className={cn(
        "border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-2.5 flex min-w-0 flex-col gap-1.5",
        !compact && "xl:flex-row xl:items-center"
      )}
    >
      <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
      <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:shrink-0">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 rounded-xl border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] shrink-0 flex items-center justify-center cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploadingMedia || isRecording || sendingMenu || sendingPaymentQr}
          title="Adjuntar foto, video, audio o documento"
        >
          {uploadingMedia ? <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" /> : <Paperclip className="h-4 w-4" />}
        </Button>

        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 rounded-xl border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 shrink-0 flex items-center justify-center cursor-pointer"
          onClick={onPasteScreenshot}
          disabled={disabled || uploadingMedia || isRecording || sendingMenu || sendingPaymentQr}
          title="Pegar captura de pantalla (Ctrl + X)"
        >
          <Camera className="h-4 w-4" />
        </Button>

        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9 rounded-xl border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] shrink-0 flex items-center justify-center cursor-pointer"
          onClick={onSendLocation}
          disabled={disabled || uploadingMedia || isRecording || sendingMenu || sendingPaymentQr || sendingLocation}
          title="Enviar ubicación"
        >
          {sendingLocation ? <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" /> : <MapPin className="h-4 w-4" />}
        </Button>

        <Button
          type="button"
          className="h-9 px-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-extrabold text-[10px] shrink-0 flex items-center gap-1 cursor-pointer shadow-sm transition-all border-0"
          onClick={onSendMenuCarta}
          disabled={disabled || uploadingMedia || isRecording || sendingMenu || sendingPaymentQr}
          title="Enviar carta al cliente"
        >
          {sendingMenu ? <Loader2 className="h-3.5 w-3.5 animate-spin text-white" /> : <FileText className="h-3.5 w-3.5 text-white" />}
          <span>Carta</span>
        </Button>

        <Button
          type="button"
          className="h-9 px-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-extrabold text-[10px] shrink-0 flex items-center gap-1 cursor-pointer shadow-sm shadow-indigo-600/20 transition-all border-0"
          onClick={onSendPaymentQr}
          disabled={disabled || uploadingMedia || isRecording || sendingMenu || sendingPaymentQr}
          title="Enviar QR o datos de pago configurados"
        >
          {sendingPaymentQr ? <Loader2 className="h-3.5 w-3.5 animate-spin text-white" /> : <QrCode className="h-3.5 w-3.5 text-white" />}
          <span>Cobro</span>
        </Button>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2">
      {isRecording ? (
        <div className="min-w-0 flex-1 flex items-center justify-between bg-red-500/10 border border-red-500/20 rounded-xl px-3 h-10 sm:h-11 text-red-500 text-xs font-bold animate-pulse">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-red-500" />
            <span>Grabando Nota de Voz: {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}</span>
          </div>
          <Button 
            type="button" 
            variant="ghost" 
            className="h-8 text-xs font-bold text-[var(--text-secondary)] hover:text-red-500 px-2"
            onClick={cancelRecording}
          >
            Cancelar
          </Button>
        </div>
      ) : (
        <Input
          ref={inputRef}
          className="min-w-0 flex-1 h-10 sm:h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] text-base sm:text-xs px-3 sm:px-4"
          value={localText}
          onChange={handleInputChange}
          placeholder={placeholder}
          disabled={disabled || uploadingMedia}
          inputMode="text"
          autoComplete="off"
          enterKeyHint="send"
          autoFocus
        />
      )}

      {localText.trim() === '' && !isRecording && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] shrink-0 flex items-center justify-center cursor-pointer"
          onClick={startRecording}
          disabled={disabled || uploadingMedia}
          title="Grabar Nota de Voz"
        >
          <Mic className="h-4 w-4" />
        </Button>
      )}

      {isRecording && (
        <Button
          type="button"
          className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-red-500 hover:bg-red-600 text-white shrink-0 flex items-center justify-center shadow-lg shadow-red-500/15 animate-bounce cursor-pointer"
          onClick={stopRecording}
          title="Enviar Nota de Voz"
        >
          <MicOff className="h-4 w-4" />
        </Button>
      )}

      {localText.trim() !== '' && !isRecording && (
        <Button
          type="submit"
          className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent)]/90 text-[var(--accent-fg)] shrink-0 flex items-center justify-center shadow-lg shadow-[var(--accent)]/15 cursor-pointer"
          disabled={disabled || uploadingMedia}
          title="Enviar Mensaje"
        >
          <Send className="h-4 w-4" />
        </Button>
      )}
      </div>
    </form>
    </div>
  )
})

import {
  getCachedMessages,
  getCachedSessions,
  globalActiveSessionIdCache,
  globalMessagesCache,
  globalSessionsCache,
  removeCachedMessages,
  setCachedMessages,
  setCachedSessions,
  setGlobalActiveSessionIdCache,
} from '@/lib/chatCache'
export { globalSessionsCache, globalActiveSessionIdCache }

export function getAssignedInfo(
  session: Session | null | undefined,
  currentUser: { id?: string; name?: string; role?: string } | null | undefined
): {
  isMine: boolean
  isAssigned: boolean
  assignedName: string
  statusText: string
  badgeVariant: 'mine' | 'other' | 'unassigned'
} {
  if (!session) {
    return { isMine: false, isAssigned: false, assignedName: '', statusText: 'Sin asignar', badgeVariant: 'unassigned' }
  }

  const assignedId = session.assignedToId || (typeof session.assignedTo === 'string' ? session.assignedTo : session.assignedTo?.id) || null
  const assignedObj = (session.assignedTo && typeof session.assignedTo === 'object') ? session.assignedTo : null

  if (!assignedId && !assignedObj) {
    return { isMine: false, isAssigned: false, assignedName: '', statusText: 'Sin asignar', badgeVariant: 'unassigned' }
  }

  const isMine = Boolean(currentUser?.id && (assignedId === currentUser.id || assignedObj?.id === currentUser.id))
  if (isMine) {
    return { isMine: true, isAssigned: true, assignedName: currentUser?.name || 'Mío', statusText: 'Mío', badgeVariant: 'mine' }
  }

  const rawName = assignedObj?.name?.trim() || (session as any).assignedToName?.trim() || ''
  const assignedName = rawName ? rawName.split(' ')[0] : 'otro asesor'
  return {
    isMine: false,
    isAssigned: true,
    assignedName,
    statusText: `Tomado por: ${assignedName}`,
    badgeVariant: 'other'
  }
}

export function formatSessionPhone(rawPhone?: string | null): string {
  if (!rawPhone) return ''
  const clean = rawPhone.replace(/\D/g, '')
  const p10 = (clean.length === 12 && clean.startsWith('57')) ? clean.slice(2) : clean
  if (p10.length === 10 && p10.startsWith('3')) {
    return `+57 ${p10.slice(0, 3)} ${p10.slice(3, 6)} ${p10.slice(6)}`
  }
  return rawPhone
}

export function getCallablePhoneNumber(session?: Session | null): string | null {
  if (!session) return null
  if (session.customerPhone) {
    const clean = session.customerPhone.replace(/\D/g, '')
    const p10 = (clean.length === 12 && clean.startsWith('57')) ? clean.slice(2) : clean
    if (p10.length === 10 && p10.startsWith('3')) return p10
  }
  const clean = (session.phone || '').replace(/\D/g, '')
  const p10 = (clean.length === 12 && clean.startsWith('57')) ? clean.slice(2) : clean
  if (p10.length === 10 && p10.startsWith('3')) {
    return p10
  }
  return null
}

export function getSessionDisplayName(session?: Session | null): string {
  if (!session) return 'Cliente'
  const name = (session.customerName || '').trim()
  const cleanPhone = (session.phone || '').replace(/\D/g, '')
  const isTechnicalName = /^(wa_lead_|user_|id_|c_|wamid\.)/i.test(name) || 
    (name.length >= 14 && /^\d+$/.test(name)) || 
    name === session.phone || 
    (cleanPhone.length >= 14 && name.replace(/\D/g, '') === cleanPhone)
  if (!name || isTechnicalName) {
    const callable = getCallablePhoneNumber(session)
    return formatSessionPhone(callable || session.phone) || 'Cliente'
  }
  return name
}

const normalizeSearchValue = (value: string) => value
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')

const escapeSearchRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const getSearchSnippet = (session: Session, query: string) => {
  const normalizedQuery = normalizeSearchValue(query.trim())
  if (!normalizedQuery) return ''

  const candidates = [
    ...(session.searchMatches || []),
    ...(session.messages || []),
  ]
  const matchingMessage = candidates.find(message =>
    normalizeSearchValue(message.content || '').includes(normalizedQuery)
  )
  if (!matchingMessage?.content) return ''

  const content = matchingMessage.content.trim()
  const rawIndex = content.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase())
  const normalizedIndex = normalizeSearchValue(content).indexOf(normalizedQuery)
  const matchIndex = rawIndex >= 0 ? rawIndex : normalizedIndex
  const radius = 52
  const start = Math.max(0, matchIndex - radius)
  const end = Math.min(content.length, matchIndex + query.trim().length + radius)
  return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`
}

const HighlightedSearchText = ({ text, query }: { text: string; query: string }) => {
  const cleanQuery = query.trim()
  if (!cleanQuery || !text) return <>{text}</>
  const parts = text.split(new RegExp(`(${escapeSearchRegExp(cleanQuery)})`, 'ig'))
  return (
    <>
      {parts.map((part, index) => {
        const isMatch = part.toLocaleLowerCase() === cleanQuery.toLocaleLowerCase()
        return isMatch
          ? <mark key={`${part}-${index}`} className="rounded bg-emerald-200/80 px-0.5 text-emerald-900 dark:bg-emerald-400/30 dark:text-emerald-100">{part}</mark>
          : <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
      })}
    </>
  )
}

const getSearchSuggestionReason = (session: Session, query: string) => {
  const rawQuery = query.trim()
  const isOrderQuery = /^(#|pedido\s*|orden\s*|factura\s*)/i.test(rawQuery)
  const normalizedQuery = normalizeSearchValue(rawQuery.replace(/^(#|pedido\s*|orden\s*|factura\s*)/i, ''))
  const name = normalizeSearchValue(session.customerName || '')
  const latestMessage = normalizeSearchValue(session.messages?.[0]?.content || '')
  const digits = normalizedQuery.replace(/\D/g, '')
  const phone = (session.phone || '').replace(/\D/g, '')
  const customerPhone = (session.customerPhone || '').replace(/\D/g, '')

  if (isOrderQuery || !normalizedQuery) return '#pedido'
  if (digits && (phone.includes(digits) || customerPhone.includes(digits))) return 'teléfono'
  if (name.includes(normalizedQuery)) return 'cliente'
  if (session.searchMatches?.length) return 'mensaje'
  if (latestMessage.includes(normalizedQuery)) return 'mensaje'
  if (/^\d+$/.test(normalizedQuery)) return '#pedido'
  return 'coincidencia'
}

function ChatPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const requestedSessionId = searchParams.get('session')
  
  const [sessions, setSessions] = useState<Session[]>(() => (globalSessionsCache || []).map(session => ({ ...session, lastMessageAt: session.lastMessageAt || '', assignedToId: session.assignedToId || null, assignedTo: session.assignedTo || null, messages: session.messages || [] })))
  // Iniciar siempre en modo vacío (sin chat seleccionado) estilo WhatsApp Web
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [messages, rawSetMessages] = useState<Message[]>([])
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [message, setMessage] = useState('')
  const [loadingSessions, setLoadingSessions] = useState(() => !globalSessionsCache || globalSessionsCache.length === 0)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  const [activeOrder, setActiveOrder] = useState<any | null>(null)
  const [embeddedOrder, setEmbeddedOrder] = useState<EmbeddedOrderParams | null>(null)
  const [recording, setRecording] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  
  const [chatSearch, setChatSearch] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const [chatFilter, setChatFilter] = useState<ChatFilter>('TODAY')
  const [displayLimit, setDisplayLimit] = useState(100)
  const [isMutedWa, setIsMutedWa] = useState(() => localStorage.getItem('niche_mute_wa_toasts') === 'true')
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [chatbotEnabled, setChatbotEnabled] = useState<boolean | null>(null)
  const [togglingChatbot, setTogglingChatbot] = useState(false)
  const chatSearchRef = useRef(chatSearch)
  const chatFilterRef = useRef(chatFilter)
  const sessionsRequestIdRef = useRef(0)
  const loadMoreRequestIdRef = useRef(0)
  const activeOrderRequestIdRef = useRef(0)
  const sessionQueryRef = useRef({ search: '', filter: 'TODAY' })
  const tabsRef = useRef<HTMLDivElement>(null)
  const statusReloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readSyncTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const searchBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chatInputRef = useRef<HTMLInputElement>(null)

  // Poner el foco y cursor automáticamente en la barra de texto al seleccionar cualquier chat
  useEffect(() => {
    if (activeSession?.id) {
      const t1 = setTimeout(() => {
        chatInputRef.current?.focus()
      }, 50)
      const t2 = setTimeout(() => {
        chatInputRef.current?.focus()
      }, 200)
      return () => {
        clearTimeout(t1)
        clearTimeout(t2)
      }
    }
  }, [activeSession?.id])

  // Sincronizar y detectar la orden activa de este cliente en tiempo real para habilitar botón de editar
  useEffect(() => {
    const requestId = ++activeOrderRequestIdRef.current
    if (!activeSession) {
      setActiveOrder(null)
      return
    }
    // Los pedidos históricos creados antes del vínculo chatSessionId llegan
    // como activeOrder únicamente cuando el servidor encuentra una sola
    // coincidencia segura por teléfono. Lo conservamos mientras intentamos la
    // consulta exacta; nunca volvemos a buscar por nombre o por otro chat.
    const legacyFallback = activeSession.activeOrder || null
    setActiveOrder(legacyFallback)
    api.get<any>(`/orders?chatSessionId=${encodeURIComponent(activeSession.id)}&limit=10&compact=true&orderType=DELIVERY,PICKUP`)
      .then(res => {
        if (requestId !== activeOrderRequestIdRef.current) return
        const orders = Array.isArray(res) ? res : (res as any)?.orders || []
        const active = orders.find((o: any) => !['CANCELLED', 'DELIVERED'].includes(o.status))
        setActiveOrder(active ? {
          id: active.id,
          orderNumber: active.orderNumber,
          status: active.status,
          total: active.total,
          chatSessionId: active.chatSessionId,
        } : legacyFallback)
      })
      .catch(() => {
        if (requestId === activeOrderRequestIdRef.current) setActiveOrder(legacyFallback)
      })
  }, [activeSession?.id])

  const toggleMuteWa = () => {
    const next = !isMutedWa
    setIsMutedWa(next)
    localStorage.setItem('niche_mute_wa_toasts', String(next))
    localStorage.setItem('niche_mute_sounds', String(next))
    if (next) {
      alerts.info('Avisos Silenciados', 'No recibirás popups ni sonidos de nuevos mensajes de WhatsApp.')
    } else {
      alerts.success('Avisos Activados', 'Recibirás avisos y sonidos de nuevos mensajes.')
    }
  }

  const [stats, setStats] = useState<{ total: number; today: number; unread: number; unanswered: number; waiting: number; unassigned: number; mine: number }>({
    total: 0,
    today: 0,
    unread: 0,
    unanswered: 0,
    waiting: 0,
    unassigned: 0,
    mine: 0,
  })
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const sessionCursorRef = useRef<string | null>(null)
  const hasMoreRef = useRef(true)
  const loadingMoreRef = useRef(false)
  const messagesCacheRef = useRef<Record<string, Message[]>>(globalMessagesCache)
  const messagesRequestIdRef = useRef(0)
  const olderMessagesRequestIdRef = useRef(0)

  useEffect(() => {
    chatSearchRef.current = chatSearch
  }, [chatSearch])

  useEffect(() => {
    chatFilterRef.current = chatFilter
  }, [chatFilter])

  useEffect(() => {
    const query = sessionQueryRef.current
    setCachedSessions(query.search, query.filter, sessions)
  }, [sessions])

  const scrollTabs = (direction: 'left' | 'right') => {
    if (tabsRef.current) {
      tabsRef.current.scrollBy({
        left: direction === 'left' ? -150 : 150,
        behavior: 'smooth'
      })
    }
  }

  // WhatsApp Message Action States (Edit, Delete, Copy, Floating Menu)
  const [editingMessage, setEditingMessage] = useState<Message | null>(null)
  const [editText, setEditText] = useState('')
  const [deletingMessage, setDeletingMessage] = useState<Message | null>(null)
  const [activeMsgMenuId, setActiveMsgMenuId] = useState<string | null>(null)
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)

  // Edit Customer Name State
  const [isEditingContactName, setIsEditingContactName] = useState(false)
  const [contactNameInput, setContactNameInput] = useState('')
  const [savingContactName, setSavingContactName] = useState(false)

  const handleSaveContactName = async () => {
    if (!activeSession || !contactNameInput.trim()) {
      setIsEditingContactName(false)
      return
    }
    const newName = contactNameInput.trim()
    setSavingContactName(true)
    try {
      await api.put(`/whatsapp/sessions/${activeSession.id}`, { customerName: newName })
      setActiveSession(prev => prev ? { ...prev, customerName: newName } : null)
      setSessions(prev => prev.map(s => s.id === activeSession.id ? { ...s, customerName: newName } : s))
      setIsEditingContactName(false)
      alerts.success('Nombre Actualizado', `El contacto ahora se llama "${newName}".`)
    } catch (err: any) {
      alerts.error('Error al guardar', err?.message || 'No se pudo actualizar el nombre')
    } finally {
      setSavingContactName(false)
    }
  }

  useEffect(() => {
    if (activeSession) {
      setGlobalActiveSessionIdCache(activeSession.id)
      try {
        localStorage.setItem('niche_last_active_whatsapp_session_id', activeSession.id)
      } catch (e) {}
    }
  }, [activeSession])
  const lastLoadTimeRef = useRef<number>(0)

  const filteredSessions = useMemo(() => {
    if (!sessions || sessions.length === 0) return []

    // 0. Deduplicar estrictamente por número telefónico normalizado (10 dígitos) o ID
    const seenKeys = new Set<string>()
    const dedupedList: Session[] = []
    
    for (const s of sessions) {
      if (!s) continue
      const raw = (s.phone || '').trim()
      const clean = raw.replace(/\D/g, '')
      const phone10 = clean.length === 12 && clean.startsWith('57') ? clean.slice(2) : clean
      const key = (phone10 && phone10.length >= 7) ? phone10 : (raw || s.id)
      if (!seenKeys.has(key)) {
        seenKeys.add(key)
        dedupedList.push(s)
      }
    }

    const rawQ = chatSearch.trim().toLowerCase()
    const q = rawQ.replace(/^(#|pedido\s*|orden\s*|factura\s*)/i, '').trim()

    // El chat abierto puede tener más historial cargado que el resumen de la
    // lista. Inclúyelo si la palabra aparece allí, aunque la consulta del
    // servidor todavía esté llegando o ese mensaje sea muy antiguo.
    if (rawQ && activeSession && messages.some(item => normalizeSearchValue(item.content || '').includes(normalizeSearchValue(rawQ)))) {
      const activeIndex = dedupedList.findIndex(item => item.id === activeSession.id)
      if (activeIndex >= 0) {
        dedupedList[activeIndex] = { ...dedupedList[activeIndex], searchMatchedFor: normalizeSearchValue(rawQ) }
      } else {
        dedupedList.unshift({ ...activeSession, searchMatchedFor: normalizeSearchValue(rawQ) })
      }
    }

    // 1. Si NO hay búsqueda, filtrar estrictamente por la pestaña activa (TODAY, MINE, etc.)
    if (!rawQ) {
      let baseList = dedupedList
      if (chatFilter === 'MINE') {
        baseList = baseList.filter(s => {
          const assignedId = s.assignedToId || (typeof s.assignedTo === 'string' ? s.assignedTo : s.assignedTo?.id)
          return Boolean(user?.id && (assignedId === user.id || s.assignedTo?.id === user.id))
        })
      } else if (chatFilter === 'UNASSIGNED') {
        baseList = baseList.filter(s => {
          const assignedId = s.assignedToId || (typeof s.assignedTo === 'string' ? s.assignedTo : s.assignedTo?.id)
          return !assignedId
        })
      } else if (chatFilter === 'WAITING') {
        baseList = baseList.filter(s => (s as any).waitingForAdvisor === true)
      } else if (chatFilter === 'UNREAD') {
        baseList = baseList.filter(s => (s.unreadCount || 0) > 0)
      } else if (chatFilter === 'TODAY') {
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)
        baseList = baseList.filter(s => new Date(s.lastMessageAt).getTime() >= todayStart.getTime())
      }
      return orderSessionsForFilter(baseList, chatFilter)
    }

    // 2. Si HAY búsqueda activa en la lupa, la búsqueda es GLOBAL (sobre todos los resultados encontrados)
    const searchDigits = q.replace(/\D/g, '')
    const searchNum = searchDigits ? parseInt(searchDigits, 10) : NaN

    // IMPORTANTE: Al buscar texto o números, NO restringir por la pestaña (TODAY/MINE) para mostrar coincidencias globales
    const searchBase = dedupedList

    return orderSessionsForFilter(searchBase.filter(s => {
      // Cuando la API encontró la coincidencia en un mensaje antiguo, la
      // sesión solo trae el último mensaje como resumen. No la descartes al
      // volver a filtrar en el cliente: hacerlo ocultaba chats históricos.
      if (s.searchMatchedFor === normalizeSearchValue(rawQ)) return true

      // 2.1 Coincidencia por número de pedido (ej. 23, #23, pedido 23)
      if (!isNaN(searchNum) && (s.activeOrder?.orderNumber === searchNum || (s as any).orderNumber === searchNum)) return true

      // 2.2 Coincidencia por nombre o @ (insensible a mayúsculas y tildes)
      const cName = (s.customerName || '').toLowerCase()
      const normCName = cName.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      const normQ = q.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      if (cName.includes(rawQ) || cName.includes(q) || normCName.includes(normQ)) return true

      // 2.3 Coincidencia por palabras individuales (ej. "Fabian Cavadia")
      const words = rawQ.split(/\s+/).filter(w => w.length >= 2 && !w.startsWith('#'))
      if (words.length > 0 && words.every(w => {
        const normW = w.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        return cName.includes(w) || normCName.includes(normW)
      })) return true

      // 2.4 Coincidencia por teléfono real, ID o dígitos del nombre
      const cleanPhone = (s.phone || '').replace(/\D/g, '')
      const cleanCustPhone = (s.customerPhone || '').replace(/\D/g, '')
      const cleanNameDigits = (s.customerName || '').replace(/\D/g, '')
      const isDummyCust = cleanCustPhone === '3000000000' || cleanCustPhone === '0000000000' || cleanCustPhone.length < 7

      if (searchDigits.length >= 2 && searchDigits !== '3000000000') {
        const s10 = (searchDigits.length === 12 && searchDigits.startsWith('57')) ? searchDigits.slice(2) : searchDigits
        const cleanPhone10 = (cleanPhone.length === 12 && cleanPhone.startsWith('57')) ? cleanPhone.slice(2) : cleanPhone
        const cleanCustPhone10 = (cleanCustPhone.length === 12 && cleanCustPhone.startsWith('57')) ? cleanCustPhone.slice(2) : cleanCustPhone

        if (cleanPhone.includes(searchDigits) || 
            cleanPhone10.includes(s10) ||
            cleanPhone.includes(s10) ||
            (!isDummyCust && (cleanCustPhone.includes(searchDigits) || cleanCustPhone10.includes(s10) || cleanCustPhone.includes(s10))) ||
            (cleanNameDigits.length >= 6 && cleanNameDigits.includes(s10)) ||
            cleanPhone.startsWith(searchDigits) ||
            cleanPhone.startsWith('57' + s10) ||
            cleanPhone10.startsWith(s10)) return true
      } else if (searchDigits.length === 1) {
        if (cleanPhone.startsWith(searchDigits) || (!isDummyCust && cleanCustPhone.startsWith(searchDigits)) || cleanPhone.startsWith('57' + searchDigits)) return true
      }

      if ((s.id || '').toLowerCase().includes(rawQ)) return true
      if ((s.phone || '').toLowerCase().includes(rawQ)) return true

      // 2.5 Coincidencia por último mensaje
      const latestMsg = s.messages?.[0]?.content?.toLowerCase() || ''
      if (latestMsg && latestMsg.includes(rawQ)) return true

      return false
    }), chatFilter)
  }, [sessions, chatSearch, chatFilter, user, activeSession, messages])

  const searchSuggestions = useMemo(() => {
    const query = chatSearch.trim()
    if (!query) return []
    return filteredSessions.slice(0, 6).map(session => ({
      session,
      name: getSessionDisplayName(session),
      phone: formatSessionPhone(getCallablePhoneNumber(session) || session.customerPhone || session.phone),
      reason: getSearchSuggestionReason(session, query),
      snippet: getSearchSnippet(session, query),
    }))
  }, [chatSearch, filteredSessions])

  const tabCounts = useMemo(() => {
    return {
      countToday: stats.today || 0,
      countAll: stats.total || 0,
      countUnread: stats.unread || 0,
      countUnanswered: stats.unanswered || 0,
      countWaiting: stats.waiting || 0,
      countUnassigned: stats.unassigned || 0,
      countMine: stats.mine || 0,
    }
  }, [stats])

  const activeAssignedInfo = useMemo(() => {
    return getAssignedInfo(activeSession, user)
  }, [activeSession, user])

  useEffect(() => {
    const handleGlobalClick = () => {
      setActiveMsgMenuId(null)
    }
    window.addEventListener('click', handleGlobalClick)
    return () => window.removeEventListener('click', handleGlobalClick)
  }, [])

  const socketRef = useRef<Socket | null>(null)
  const activeSessionRef = useRef<Session | null>(activeSession)
  useEffect(() => {
    activeSessionRef.current = activeSession
  }, [activeSession])

  // Real-time chat viewers and typing indicators
  const [chatViewers, setChatViewers] = useState<Record<string, { userId: string; userName: string }[]>>({})
  const [typingUsers, setTypingUsers] = useState<Record<string, { userId: string; userName: string; timestamp: number }>>({})

  // Emit chat presence join/leave when activeSession changes
  useEffect(() => {
    if (!socketRef.current || !activeSession?.id) return
    const sId = activeSession.id
    socketRef.current.emit('chatViewJoin', { sessionId: sId })

    return () => {
      if (socketRef.current) {
        socketRef.current.emit('chatViewLeave', { sessionId: sId })
      }
    }
  }, [activeSession?.id])

  // Periodic prune of stale typing indicators (> 3.5s old)
  useEffect(() => {
    const interval = setInterval(() => {
      setTypingUsers(prev => {
        const now = Date.now()
        let changed = false
        const next: typeof prev = {}
        for (const [k, v] of Object.entries(prev)) {
          if (now - v.timestamp < 3500) {
            next[k] = v
          } else {
            changed = true
          }
        }
        return changed ? next : prev
      })
    }, 1500)
    return () => clearInterval(interval)
  }, [])

  const handleTyping = (isTyping: boolean) => {
    if (!socketRef.current || !activeSession?.id) return
    socketRef.current.emit('chatTyping', { sessionId: activeSession.id, isTyping })
  }

  const setMessagesCached = (update: React.SetStateAction<Message[]>) => {
    rawSetMessages(previous => {
      const next = typeof update === 'function'
        ? (update as (current: Message[]) => Message[])(previous)
        : update
      const sessionId = activeSessionRef.current?.id
      if (sessionId) {
        setCachedMessages(sessionId, next)
        messagesCacheRef.current[sessionId] = next.slice(-180)
      }
      return next
    })
  }

  const canManageChatbot = ['ADMIN', 'SUPERADMIN'].includes(user?.role || '')

  useEffect(() => {
    if (!canManageChatbot) return
    api.get<{ chatbotEnabled?: boolean }>('/whatsapp/settings')
      .then(settings => setChatbotEnabled(settings.chatbotEnabled === true))
      .catch(() => setChatbotEnabled(null))
  }, [canManageChatbot])

  const toggleChatbot = async () => {
    if (chatbotEnabled === null || togglingChatbot) return
    const next = !chatbotEnabled
    setTogglingChatbot(true)
    try {
      const updated = await api.put<{ chatbotEnabled?: boolean }>('/whatsapp/settings', { chatbotEnabled: next })
      setChatbotEnabled(updated.chatbotEnabled === true)
      alerts.toast(next ? 'Chatbot activado' : 'Chatbot pausado')
    } catch (err: any) {
      alerts.error('No se pudo cambiar el chatbot', err?.message || 'Inténtalo nuevamente.')
    } finally {
      setTogglingChatbot(false)
    }
  }

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesViewportRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingMedia, setUploadingMedia] = useState(false)

  // Voice recording states
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const mp3RecorderRef = useRef<any>(null)
  const recordingTimerRef = useRef<any>(null)

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current)
      }
    }
  }, [])

  const startRecording = async () => {
    try {
      const recorder = new Mp3Recorder()
      mp3RecorderRef.current = recorder
      await recorder.start()
      
      setIsRecording(true)
      setRecordingTime(0)

      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1)
      }, 1000)

    } catch (err) {
      console.error('Error al iniciar grabación de voz:', err)
      alert('No se pudo acceder al micrófono. Asegúrate de dar los permisos.')
    }
  }

  const stopRecording = async () => {
    if (!mp3RecorderRef.current) return
    setIsRecording(false)
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
    }



    setUploadingMedia(true)
    try {
      const audioBlob = mp3RecorderRef.current.stop()
      const file = new File([audioBlob], `voice_note_${Date.now()}.mp3`, { type: 'audio/mp3' })
      
      const formData = new FormData()
      formData.append('file', file)
      formData.append('phone', activeSession!.phone)
      formData.append('type', 'audio')
      if (activeSession?.id) formData.append('sessionId', activeSession.id)
      if (activeOrder?.id) formData.append('orderId', activeOrder.id)

      await api.post('/whatsapp/send-media', formData)
      setActiveSession(prev => prev && prev.id === activeSession!.id ? { ...prev, unreadCount: 0 } : prev)
      setSessions(prev => prev.map(s => s.id === activeSession!.id ? { ...s, unreadCount: 0 } : s))
      loadSessions(activeSession!.id)
    } catch (err: any) {
      console.error('Error enviando nota de voz:', err)
      alert(err.message || 'Error al enviar la nota de voz.')
    } finally {
      setUploadingMedia(false)
      mp3RecorderRef.current = null
    }
  }

  const cancelRecording = () => {
    if (mp3RecorderRef.current) {
      mp3RecorderRef.current.cancel()
      mp3RecorderRef.current = null
    }
    setIsRecording(false)
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
    }
  }

  const loadStats = async () => {
    try {
      const res = await api.get<any>('/whatsapp/sessions/stats')
      if (res) setStats(res)
    } catch (e) {}
  }

  // Fetch active sessions with optional search, filter or full historic query
  const loadSessions = async (selectId?: string, searchParam?: string, fetchAll?: boolean, targetFilter?: string) => {
    const requestId = ++sessionsRequestIdRef.current
    const activeFilter = targetFilter !== undefined ? targetFilter : chatFilterRef.current
    const activeSearch = searchParam !== undefined ? searchParam.trim() : chatSearchRef.current.trim()
    const cachedSessions = !fetchAll ? getCachedSessions(activeSearch, activeFilter) : null
    loadMoreRequestIdRef.current += 1
    loadingMoreRef.current = false
    setLoadingMore(false)
    if (cachedSessions !== null) {
      setSessions(cachedSessions as Session[])
      setLoadingSessions(false)
    } else {
      setLoadingSessions(true)
    }
    sessionCursorRef.current = null
    hasMoreRef.current = true
    setHasMore(true)
    try {
      sessionQueryRef.current = { search: activeSearch, filter: activeFilter }
      const queryParams = new URLSearchParams()
      if (activeSearch) {
        queryParams.set('search', activeSearch)
      } else if (activeFilter && activeFilter !== 'ALL') {
        queryParams.set('filter', activeFilter)
      }
      if (fetchAll) {
        queryParams.set('all', 'true')
      } else {
        queryParams.set('pagination', 'cursor')
        queryParams.set('limit', '60')
      }
      const queryString = queryParams.toString() ? `?${queryParams.toString()}` : ''

      const data = await api.get<Session[] | SessionPage>(`/whatsapp/sessions${queryString}`)
      if (requestId !== sessionsRequestIdRef.current) return
      const safeData = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : [])
      const searchMarker = activeSearch ? normalizeSearchValue(activeSearch) : null
      if (!fetchAll) {
        const nextCursor = Array.isArray(data) ? null : data?.nextCursor || null
        sessionCursorRef.current = nextCursor
        hasMoreRef.current = Boolean(nextCursor)
        setHasMore(Boolean(nextCursor))
      }
      // Deduplicar sesiones de forma segura (solo por teléfono estándar válido de 10 dígitos)
      const seen = new Set<string>()
      const uniqueSessions: Session[] = []
      for (const s of safeData) {
        const cleanDigits = (s.phone || '').replace(/\D/g, '')
        const isStd = (cleanDigits.length === 10 || (cleanDigits.length === 12 && cleanDigits.startsWith('57'))) && cleanDigits !== '3000000000' && cleanDigits !== '0000000000' && !/^0+$/.test(cleanDigits)
        const phone10 = isStd ? (cleanDigits.length === 12 ? cleanDigits.slice(2) : cleanDigits) : null
        const key = phone10 || s.id
        if (!seen.has(key)) {
          seen.add(key)
          uniqueSessions.push(searchMarker ? { ...s, searchMatchedFor: searchMarker } : { ...s, searchMatchedFor: null })
        }
      }
      if (selectId && !uniqueSessions.some(session => session.id === selectId)) {
        const selectedSession = await api.get<Session>(`/whatsapp/sessions/${selectId}`).catch(() => null)
        if (requestId !== sessionsRequestIdRef.current) return
        if (selectedSession) {
          uniqueSessions.unshift({ ...selectedSession, messages: selectedSession.messages || [], searchMatchedFor: searchMarker })
        }
      }
      if (!fetchAll) setCachedSessions(activeSearch, activeFilter, uniqueSessions)
      setSessions(uniqueSessions)
      setActiveSession(prevActive => {
        if (selectId) {
          const foundSelect = uniqueSessions.find(s => s.id === selectId)
          if (foundSelect) return foundSelect
        }
        if (prevActive) {
          const updatedPrev = uniqueSessions.find(s => s.id === prevActive.id)
          if (updatedPrev) {
            if (updatedPrev.customerName === prevActive.customerName &&
                updatedPrev.assignedToId === prevActive.assignedToId &&
                updatedPrev.phone === prevActive.phone &&
                (updatedPrev as any).waitingForAdvisor === (prevActive as any).waitingForAdvisor &&
                JSON.stringify(updatedPrev.assignedTo) === JSON.stringify(prevActive.assignedTo)) {
              return prevActive
            }
            return {
              ...prevActive,
              ...updatedPrev,
              messages: (prevActive.messages && prevActive.messages.length > 0) ? prevActive.messages : (updatedPrev.messages || []),
            }
          }
          return prevActive
        }
        // Modo inicial: no autoseleccionar ningún chat para evitar marcar como leído en silencio
        return null
      })
    } catch (err) {
      if (requestId === sessionsRequestIdRef.current) console.error('Error cargando sesiones:', err)
    } finally {
      if (requestId === sessionsRequestIdRef.current) setLoadingSessions(false)
    }
  }

  // Progressive scroll: load next 60 sessions on bottom scroll without lag
  const loadMoreSessions = async () => {
    if (loadingMoreRef.current || !hasMoreRef.current || loadingSessions) return
    const requestId = sessionsRequestIdRef.current
    const loadMoreRequestId = ++loadMoreRequestIdRef.current
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const cursor = sessionCursorRef.current
      if (!cursor) {
        hasMoreRef.current = false
        setHasMore(false)
        return
      }
      const queryParams = new URLSearchParams()
      const activeQuery = sessionQueryRef.current
      if (activeQuery.search) queryParams.set('search', activeQuery.search)
      if (activeQuery.filter && activeQuery.filter !== 'ALL') queryParams.set('filter', activeQuery.filter)
      queryParams.set('pagination', 'cursor')
      queryParams.set('cursor', cursor)
      queryParams.set('limit', '60')
      const queryString = `?${queryParams.toString()}`

      const data = await api.get<SessionPage>(`/whatsapp/sessions${queryString}`)
      if (requestId !== sessionsRequestIdRef.current || loadMoreRequestId !== loadMoreRequestIdRef.current) return
      const safeData = Array.isArray(data?.items) ? data.items : []
      sessionCursorRef.current = data?.nextCursor || null
      hasMoreRef.current = Boolean(data?.nextCursor)
      setHasMore(Boolean(data?.nextCursor))
      if (safeData.length > 0) {
        setSessions(prev => {
          const seen = new Set(prev.map(s => {
            const clean = (s.phone || '').replace(/\D/g, '')
            const isStd = (clean.length === 10 || (clean.length === 12 && clean.startsWith('57'))) && clean !== '3000000000' && clean !== '0000000000' && !/^0+$/.test(clean)
            return (isStd ? (clean.length === 12 ? clean.slice(2) : clean) : null) || s.id
          }))
          const newItems: Session[] = []
          const searchMarker = activeQuery.search ? normalizeSearchValue(activeQuery.search) : null
          for (const s of safeData) {
            const clean = (s.phone || '').replace(/\D/g, '')
            const isStd = (clean.length === 10 || (clean.length === 12 && clean.startsWith('57'))) && clean !== '3000000000' && clean !== '0000000000' && !/^0+$/.test(clean)
            const key = (isStd ? (clean.length === 12 ? clean.slice(2) : clean) : null) || s.id
            if (!seen.has(key)) {
              seen.add(key)
              newItems.push(searchMarker ? { ...s, searchMatchedFor: searchMarker } : { ...s, searchMatchedFor: null })
            }
          }
          return [...prev, ...newItems]
        })
      } else if (!data?.nextCursor) {
        hasMoreRef.current = false
        setHasMore(false)
      }
    } catch (err) {
      if (requestId === sessionsRequestIdRef.current) console.error('Error cargando más sesiones:', err)
    } finally {
      if (loadMoreRequestId === loadMoreRequestIdRef.current) {
        setLoadingMore(false)
        loadingMoreRef.current = false
      }
    }
  }

  // Live server search for any historic customer phone or name
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    const timer = setTimeout(() => {
      loadSessions(undefined, chatSearch.trim())
    }, 300)
    return () => clearTimeout(timer)
  }, [chatSearch])

  // Fetch message history for selected session with instant 0ms in-memory cache
  const loadMessages = async (sessionId: string, initialSession?: Session | null, force = false) => {
    const requestId = ++messagesRequestIdRef.current
    const requestStartedAt = Date.now()
    olderMessagesRequestIdRef.current += 1
    setLoadingOlderMessages(false)
    // 1. Si ya tenemos mensajes cacheados en memoria, renderizar al instante sin spinner
    const cached = (getCachedMessages(sessionId) as Message[] | null) || messagesCacheRef.current[sessionId]
    if (cached && cached.length > 0) {
      setMessagesCached(cached)
      setLoadingMessages(false)
    } else if (initialSession?.messages && initialSession.messages.length > 0) {
      setMessagesCached(initialSession.messages)
      setLoadingMessages(false)
    } else {
      setMessagesCached([])
      setLoadingMessages(true)
    }

    try {
      const data = await api.get<Message[]>(`/whatsapp/sessions/${sessionId}/messages?limit=120`, { force })
      if (requestId !== messagesRequestIdRef.current || activeSessionRef.current?.id !== sessionId) return
      const safeMessages = Array.isArray(data) ? data : []
      setHasOlderMessages(safeMessages.length === 120)
      setMessagesCached(current => {
        const knownIds = new Set(safeMessages.map(item => item.id))
        const knownWaIds = new Set(safeMessages.map(item => item.waMessageId).filter(Boolean))
        const serverOutgoingContent = new Set(safeMessages.filter(item => item.direction === 'OUT').map(item => item.content))
        const earliestServerTime = safeMessages.reduce((earliest, item) => {
          const timestamp = new Date(item.createdAt).getTime()
          return Number.isFinite(timestamp) ? Math.min(earliest, timestamp) : earliest
        }, Number.POSITIVE_INFINITY)
        const serverReturnedFullHistory = safeMessages.length < 120
        const currentOnly = current.filter(item => {
          if (knownIds.has(item.id) || (item.waMessageId && knownWaIds.has(item.waMessageId))) return false
          const isOptimistic = String(item.id).startsWith('temp-') || String(item.id).startsWith('opt-')
          if (isOptimistic) return !(item.direction === 'OUT' && serverOutgoingContent.has(item.content))

          // Reconciliar eliminaciones ocurridas durante una desconexión sin borrar
          // mensajes antiguos que quedaron fuera de la ventana de 120 ni eventos
          // nuevos recibidos por Socket.IO mientras esta petición estaba en vuelo.
          const itemTime = new Date(item.createdAt).getTime()
          if (Number.isFinite(itemTime) && itemTime >= requestStartedAt) return true
          if (!serverReturnedFullHistory && Number.isFinite(itemTime) && itemTime < earliestServerTime) return true
          return false
        })
        const merged = [...safeMessages, ...currentOnly]
          .sort((a, b) => {
            const byDate = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
            return byDate || a.id.localeCompare(b.id)
          })
        messagesCacheRef.current[sessionId] = merged
        return merged
      })
      if (safeMessages.length > 0) {
        const newest = safeMessages[safeMessages.length - 1]
        setSessions(prev => prev.map(s => s.id === sessionId ? {
          ...s,
          lastMessageAt: new Date(newest.createdAt).getTime() > new Date(s.lastMessageAt || 0).getTime() ? newest.createdAt : s.lastMessageAt,
          messages: [newest, ...(s.messages?.filter(m => m.id !== newest.id) || [])]
        } : s))
      }
    } catch (err) {
      if (requestId === messagesRequestIdRef.current) console.error('Error cargando mensajes:', err)
    } finally {
      if (requestId === messagesRequestIdRef.current) setLoadingMessages(false)
    }
  }

  const loadOlderMessages = async () => {
    if (!activeSession || loadingOlderMessages || !hasOlderMessages || messages.length === 0) return
    const oldest = messages[0]?.createdAt
    const oldestId = messages[0]?.id
    if (!oldest || !oldestId) return
    const sessionId = activeSession.id
    const requestId = ++olderMessagesRequestIdRef.current
    const viewport = messagesViewportRef.current
    const previousHeight = viewport?.scrollHeight || 0
    setLoadingOlderMessages(true)
    try {
      const older = await api.get<Message[]>(
        `/whatsapp/sessions/${sessionId}/messages?limit=120&before=${encodeURIComponent(oldest)}&beforeId=${encodeURIComponent(oldestId)}`
      )
      if (requestId !== olderMessagesRequestIdRef.current || activeSessionRef.current?.id !== sessionId) return
      const safeOlder = Array.isArray(older) ? older : []
      setHasOlderMessages(safeOlder.length === 120)
      setMessagesCached(current => {
        const known = new Set(current.map(item => item.id))
        const merged = [...safeOlder.filter(item => !known.has(item.id)), ...current]
        messagesCacheRef.current[sessionId] = merged
        return merged
      })
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (viewport) viewport.scrollTop += viewport.scrollHeight - previousHeight
      }))
    } catch (err: any) {
      if (requestId === olderMessagesRequestIdRef.current && activeSessionRef.current?.id === sessionId) {
        alerts.error('No se pudo cargar el historial', err?.message || 'Inténtalo nuevamente.')
      }
    } finally {
      if (requestId === olderMessagesRequestIdRef.current) setLoadingOlderMessages(false)
    }
  }

  // Socket connection and listener
  useEffect(() => {
    loadSessions(requestedSessionId || undefined)
    loadStats()

    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      transports: ['websocket', 'polling'],
    })
    socketRef.current = socket
    setRealtimeStatus('connecting')

    let connectedOnce = false
    socket.on('connect', () => {
      setRealtimeStatus('connected')
      socket.emit('joinRoom', 'whatsapp')
      socket.emit('getChatViewers')
      if (activeSessionRef.current?.id) {
        socket.emit('chatViewJoin', { sessionId: activeSessionRef.current.id })
      }
      if (connectedOnce) {
        loadSessions()
        loadStats()
        const currentSession = activeSessionRef.current
        if (currentSession?.id) loadMessages(currentSession.id, currentSession, true)
      }
      connectedOnce = true
    })
    socket.on('disconnect', () => setRealtimeStatus(socket.active ? 'connecting' : 'disconnected'))
    socket.on('connect_error', () => setRealtimeStatus(socket.active ? 'connecting' : 'disconnected'))
    socket.io.on('reconnect_attempt', () => setRealtimeStatus('connecting'))
    socket.io.on('reconnect_failed', () => setRealtimeStatus('disconnected'))
    socket.on('allChatViewers', (data: Record<string, { userId: string; userName: string }[]>) => {
      setChatViewers(data || {})
    })
    socket.on('chatViewersUpdated', ({ sessionId, viewers }: { sessionId: string; viewers: { userId: string; userName: string }[] }) => {
      setChatViewers(prev => ({ ...prev, [sessionId]: viewers || [] }))
    })
    socket.on('chatTypingUpdated', ({ sessionId, userId, userName, isTyping }: { sessionId: string; userId: string; userName: string; isTyping: boolean }) => {
      setTypingUsers(prev => {
        const next = { ...prev }
        if (isTyping) {
          next[sessionId] = { userId, userName, timestamp: Date.now() }
        } else {
          if (next[sessionId]?.userId === userId) {
            delete next[sessionId]
          }
        }
        return next
      })
    })
    socket.on('whatsappSettingsUpdated', (settings: { chatbotEnabled?: boolean }) => {
      if (typeof settings?.chatbotEnabled === 'boolean') setChatbotEnabled(settings.chatbotEnabled)
    })
    socket.on('chatSessionAssigned', (payload: any) => {
      if (!payload || !payload.sessionId) return
      setSessions(prev => prev.map(s => {
        const isMatch = s.id === payload.sessionId
        return isMatch ? {
          ...s,
          assignedToId: payload.assignedToId,
          assignedTo: payload.assignedTo,
          waitingForAdvisor: payload.waitingForAdvisor ?? false
        } : s
      }))

      setActiveSession(curr => {
        if (!curr) return null
        const isMatch = curr.id === payload.sessionId
        return isMatch ? {
          ...curr,
          assignedToId: payload.assignedToId,
          assignedTo: payload.assignedTo,
          waitingForAdvisor: payload.waitingForAdvisor ?? false
        } : curr
      })
    })

    socket.on('whatsappSessionUpdated', (payload: any) => {
      if (typeof payload?.totalUnread === 'number') {
        setStats(prev => ({ ...prev, unread: payload.totalUnread }))
      }

      if (payload?.unassignedAll || payload?.cashClosed || payload?.cashOpened) {
        loadSessions()
        return
      }

      if (payload?.orderCreated || payload?.orderUpdated) {
        // Actualizar el pedido activo en segundo plano SIN parpadeo ni recarga de la pantalla
        if (payload?.sessionId && activeSessionRef.current?.id === payload.sessionId) {
          // La consulta del pedido activo usa siempre el ID exacto de sesión.
          const requestId = ++activeOrderRequestIdRef.current
          api.get<any>(`/orders?chatSessionId=${encodeURIComponent(payload.sessionId)}&limit=10&compact=true&orderType=DELIVERY,PICKUP`)
            .then(res => {
              if (requestId !== activeOrderRequestIdRef.current) return
              const list = Array.isArray(res) ? res : (res as any)?.orders || []
              setActiveOrder(list.find((o: any) => !['DELIVERED', 'CANCELLED'].includes(o.status)) || null)
            })
            .catch(() => {})
        }
        return
      }

      if (!payload || !payload.sessionId) return
      setSessions(prev => {
        return prev.map(s => {
          const isMatch = s.id === payload.sessionId
          
          if (!isMatch) return s
          return {
            ...s,
            ...(payload.customerName ? { customerName: payload.customerName } : {}),
            ...(payload.lastMessageAt ? { lastMessageAt: payload.lastMessageAt } : {}),
            ...(typeof payload.unreadCount === 'number' ? { unreadCount: payload.unreadCount } : {}),
            ...(payload.assignedToId !== undefined ? { assignedToId: payload.assignedToId } : {}),
            ...(payload.assignedTo !== undefined ? { assignedTo: payload.assignedTo } : {}),
            ...(payload.waitingForAdvisor !== undefined ? { waitingForAdvisor: payload.waitingForAdvisor } : {}),
          }
        })
      })

      setActiveSession(current => {
        if (!current) return null
        const isMatch = current.id === payload.sessionId

        if (isMatch) {
          return {
            ...current,
            ...(payload.customerName ? { customerName: payload.customerName } : {}),
            ...(payload.lastMessageAt ? { lastMessageAt: payload.lastMessageAt } : {}),
            ...(typeof payload.unreadCount === 'number' ? { unreadCount: payload.unreadCount } : {}),
            ...(payload.assignedToId !== undefined ? { assignedToId: payload.assignedToId } : {}),
            ...(payload.assignedTo !== undefined ? { assignedTo: payload.assignedTo } : {}),
            ...(payload.waitingForAdvisor !== undefined ? { waitingForAdvisor: payload.waitingForAdvisor } : {}),
          }
        }
        return current
      })
    })

    socket.on('whatsappMessage', (payload: {
      id?: string
      waMessageId?: string
      sessionId: string
      phone: string
      customerName: string
      content: string
      messageType?: string
      direction: 'IN' | 'OUT'
      status?: string
      assignedToId?: string | null
      assignedTo?: { id: string; name: string } | string | null
      createdAt: string
      replyToContent?: string | null
      replyToDirection?: 'IN' | 'OUT' | null
    }) => {
      // 1. Reload/update session list
      const isIncoming = payload.direction === 'IN'
      const isActiveIncoming = isIncoming && activeSessionRef.current?.id === payload.sessionId
      setSessions(prev => {
        const idx = prev.findIndex(s => {
          return s.id === payload.sessionId
        })

        const msgId = payload.id || payload.waMessageId || Math.random().toString()
        const updatedMsg: Message = {
          id: msgId,
          waMessageId: payload.waMessageId,
          direction: payload.direction,
          content: payload.content,
          messageType: payload.messageType || 'text',
          status: payload.status || (payload.direction === 'OUT' ? 'sent' : 'received'),
          createdAt: payload.createdAt || new Date().toISOString(),
          replyToContent: payload.replyToContent || null,
          replyToDirection: payload.replyToDirection || null,
        }

        const payloadAssignedId = payload.assignedToId || (typeof payload.assignedTo === 'string' ? payload.assignedTo : payload.assignedTo?.id) || null
        const payloadAssignedObj = (payload.assignedTo && typeof payload.assignedTo === 'object') ? payload.assignedTo : null

        if (idx !== -1) {
          const target = prev[idx]
          const next = [...prev]
          const currentUnread = target.unreadCount || 0
          const existingMsgs = target.messages || []
          
          let updatedMsgs: Message[]
          if (!isIncoming) {
            const optIdx = existingMsgs.findIndex(m => (String(m.id || '').startsWith('temp-') || String(m.id || '').startsWith('opt-')) && m.content === payload.content)
            if (optIdx !== -1) {
              const copy = [...existingMsgs]
              copy[optIdx] = updatedMsg
              updatedMsgs = copy
            } else if (!existingMsgs.some(m => m.id === msgId || (payload.waMessageId && m.waMessageId === payload.waMessageId))) {
              updatedMsgs = [updatedMsg, ...existingMsgs]
            } else {
              updatedMsgs = existingMsgs
            }
          } else {
            updatedMsgs = [updatedMsg, ...existingMsgs]
          }

          next[idx] = {
            ...target,
            customerName: payload.customerName || target.customerName,
            lastMessageAt: payload.createdAt || new Date().toISOString(),
            // REGLA OBLIGATORIA: Un chat no se marca como leído hasta que la última respuesta sea de un asesor/admin.
            // Aunque el chat esté abierto en pantalla, los mensajes entrantes aumentan el contador de no leídos hasta responder.
            unreadCount: isIncoming ? currentUnread + 1 : currentUnread,
            messages: updatedMsgs,
            ...(payloadAssignedId !== undefined ? { assignedToId: payloadAssignedId } : {}),
            ...(payloadAssignedObj !== null ? { assignedTo: payloadAssignedObj } : {})
          }
          return next.sort((a, b) => (new Date(b.lastMessageAt || 0).getTime() || 0) - (new Date(a.lastMessageAt || 0).getTime() || 0))
        } else {
          // Add new session, ensuring no duplicate exists in prev
          const filteredPrev = prev.filter(s => s.id !== payload.sessionId)

          const newSession: Session = {
            id: payload.sessionId,
            phone: payload.phone,
            customerName: payload.customerName,
            lastMessageAt: payload.createdAt || new Date().toISOString(),
            assignedToId: payloadAssignedId,
            assignedTo: payloadAssignedObj,
            unreadCount: isIncoming ? 1 : 0,
            messages: [updatedMsg]
          }
          return [newSession, ...filteredPrev]
        }
      })

      // 2. If it's the active chat, update active session and append message
      setActiveSession(current => {
        if (current) {
          if (current.id === payload.sessionId) {

            setMessagesCached(prevMsgs => {
              const msgId = payload.id || payload.waMessageId || Math.random().toString()
              
              // 1. Exact ID or waMessageId already present -> do nothing
              if (prevMsgs.some(m => m.id === msgId || (payload.waMessageId && m.waMessageId === payload.waMessageId))) {
                messagesCacheRef.current[current.id] = prevMsgs
                return prevMsgs
              }

              // 2. If this is an OUT message matching an optimistic pending temp message, REPLACE it in place
              if (payload.direction === 'OUT') {
                const optIdx = prevMsgs.findIndex(m => 
                  (String(m.id || '').startsWith('temp-') || String(m.id || '').startsWith('opt-')) && 
                  m.direction === 'OUT' && 
                  m.content === payload.content
                )
                if (optIdx !== -1) {
                  const next = [...prevMsgs]
                  next[optIdx] = {
                    id: msgId,
                    waMessageId: payload.waMessageId,
                    direction: payload.direction,
                    content: payload.content,
                    messageType: payload.messageType || 'text',
                    status: payload.status || 'sent',
                    createdAt: payload.createdAt || next[optIdx].createdAt,
                    replyToContent: payload.replyToContent || next[optIdx].replyToContent,
                    replyToDirection: payload.replyToDirection || next[optIdx].replyToDirection
                  }
                  messagesCacheRef.current[current.id] = next
                  return next
                }
              }

              // 3. Otherwise append normally
              const res = [...prevMsgs, {
                id: msgId,
                waMessageId: payload.waMessageId,
                direction: payload.direction,
                content: payload.content,
                messageType: payload.messageType || 'text',
                status: payload.status || (payload.direction === 'OUT' ? 'sent' : 'received'),
                createdAt: payload.createdAt || new Date().toISOString(),
                replyToContent: payload.replyToContent || null,
                replyToDirection: payload.replyToDirection || null
              }]
              messagesCacheRef.current[current.id] = res
              return res
            })

            return {
              ...current,
              customerName: payload.customerName || current.customerName,
              lastMessageAt: payload.createdAt || new Date().toISOString(),
              ...(isActiveIncoming ? { unreadCount: 0 } : {})
            }
          }
        }
        return current
      })
    })

    socket.on('whatsappAudioTranscribed', (payload: {
      messageId: string
      waMessageId?: string
      sessionId: string
      content: string
    }) => {
      if (!payload?.messageId || !payload?.sessionId || !payload?.content) return
      const matchesMessage = (message: Message) => (
        message.id === payload.messageId || (!!payload.waMessageId && message.waMessageId === payload.waMessageId)
      )
      const withTranscript = (message: Message) => matchesMessage(message) ? { ...message, content: payload.content } : message

      setSessions(previous => previous.map(session => session.id === payload.sessionId
        ? { ...session, messages: (session.messages || []).map(withTranscript) }
        : session,
      ))
      setMessagesCached(previous => {
        const next = previous.map(withTranscript)
        if (activeSessionRef.current?.id === payload.sessionId) {
          messagesCacheRef.current[payload.sessionId] = next
        }
        return next
      })
    })

    socket.on('whatsappMessageReaction', (payload: { messageId: string; waMessageId: string; sessionId: string; reaction: string | null }) => {
      setMessagesCached(prevMsgs => prevMsgs.map(m => {
        if (m.id === payload.messageId || (payload.waMessageId && m.waMessageId === payload.waMessageId)) {
          return { ...m, reaction: payload.reaction || undefined }
        }
        return m
      }))
    })

    socket.on('whatsappMessageStatus', (payload: {
      messageId: string
      waMessageId?: string
      sessionId?: string
      status: string
    }) => {
      const matchId = (m: Message) => 
        m.id === payload.messageId || 
        m.waMessageId === payload.messageId ||
        (payload.waMessageId && (m.id === payload.waMessageId || m.waMessageId === payload.waMessageId))

      setMessagesCached(prev => prev.map(m => matchId(m) ? {
        ...m,
        status: payload.status
      } : m))

      setSessions(prev => {
        let exists = false
        const next = prev.map(s => {
          if (s.id === payload.sessionId) exists = true
          if (!s.messages || s.messages.length === 0) return s
          const updatedMsgs = s.messages.map(m => matchId(m) ? {
            ...m,
            status: payload.status
          } : m)
          return { ...s, messages: updatedMsgs }
        })

        // Los estados delivered/read no descargan la lista completa de sesiones; se reflejan mediante Socket.IO sin polling.

        return next
      })
    })

    socket.on('chatMessageDeleted', (payload: { messageId: string; sessionId: string }) => {
      setMessagesCached(prev => prev.filter(m => m.id !== payload.messageId))
      setSessions(prev => prev.map(s => {
        if (s.id === payload.sessionId && s.messages) {
          return { ...s, messages: s.messages.filter(m => m.id !== payload.messageId) }
        }
        return s
      }))
    })

    socket.on('chatMessageEdited', (payload: { messageId: string; sessionId: string; content: string; status?: string; isEdited?: boolean }) => {
      setMessagesCached(prev => prev.map(m => (m.id === payload.messageId || m.waMessageId === payload.messageId) ? {
        ...m,
        content: payload.content,
        status: payload.status || m.status,
        isEdited: payload.isEdited !== undefined ? payload.isEdited : m.isEdited
      } : m))

      setSessions(prev => prev.map(s => {
        if (s.id === payload.sessionId && s.messages) {
          const updatedMsgs = s.messages.map(m => (m.id === payload.messageId || m.waMessageId === payload.messageId) ? {
            ...m,
            content: payload.content,
            status: payload.status || m.status,
            isEdited: payload.isEdited !== undefined ? payload.isEdited : m.isEdited
          } : m)
          return { ...s, messages: updatedMsgs }
        }
        return s
      }))
    })

    socket.on('cashStatusChanged', () => {
      loadStats()
    })

    socket.on('cashRegistersChanged', () => {
      loadStats()
    })

    return () => {
      socketRef.current = null
      Object.values(readSyncTimersRef.current).forEach(timer => clearTimeout(timer))
      readSyncTimersRef.current = {}
      socket.disconnect()
    }
  }, [])

  // Load messages when active session changes
  useEffect(() => {
    setReplyingTo(null)
    setMessage('')
    if (activeSession) {
      loadMessages(activeSession.id, activeSession)
    } else {
      messagesRequestIdRef.current += 1
      olderMessagesRequestIdRef.current += 1
      setMessagesCached([])
      setHasOlderMessages(false)
    }
  }, [activeSession?.id])

  // Socket.IO mantiene el chat al día. Solo reconciliamos al recuperar foco si
  // la conexión sigue caída; una reconexión correcta ya sincroniza arriba.
  useEffect(() => {
    const handleFocus = () => {
      if (socketRef.current?.connected) return
      if (activeSession?.id) {
        api.get<Message[]>(`/whatsapp/sessions/${activeSession.id}/messages`)
          .then(newMsgs => {
            if (newMsgs && Array.isArray(newMsgs)) {
              setMessagesCached(prev => {
                if (newMsgs.length !== prev.length) return newMsgs
                for (let i = 0; i < newMsgs.length; i++) {
                  if (newMsgs[i].id !== prev[i]?.id || newMsgs[i].status !== prev[i]?.status) {
                    return newMsgs
                  }
                }
                return prev
              })
            }
          })
          .catch(() => {})
      }
    }

    window.addEventListener('focus', handleFocus)

    return () => {
      window.removeEventListener('focus', handleFocus)
    }
  }, [activeSession?.id])

  const userIsNearBottomRef = useRef(true)
  const prevSessionIdRef = useRef<string | null>(null)
  const prevMsgCountRef = useRef<number>(0)

  // Scroll to bottom ONLY when session changes or a brand new message arrives
  useEffect(() => {
    const isNewSession = activeSession?.id !== prevSessionIdRef.current
    const isNewMessage = messages.length > prevMsgCountRef.current
    prevMsgCountRef.current = messages.length

    if (isNewSession) {
      prevSessionIdRef.current = activeSession?.id || null
      userIsNearBottomRef.current = true
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
    } else if (isNewMessage && userIsNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, activeSession?.id])

  // Media Preview Dialog State (validación de captura previa como WhatsApp Web)
  const [pendingMedia, setPendingMedia] = useState<{
    file: File
    previewUrl: string
    caption: string
  } | null>(null)
  const lastPasteTimeRef = useRef<number>(0)

  const handleSendMediaFile = async (file: File, captionText?: string) => {
    const currentSession = activeSessionRef.current || activeSession
    if (!file || !currentSession) return

    let type: 'image' | 'audio' | 'document' = 'document'
    if (file.type.startsWith('image/')) {
      type = 'image'
    } else if (file.type.startsWith('audio/')) {
      type = 'audio'
    }

    let uploadFile = file
    if (!uploadFile.name || uploadFile.name === 'blob' || uploadFile.name === 'image.png') {
      const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : 'png'
      uploadFile = new File([file], `captura_${Date.now()}.${ext}`, { type: file.type || 'image/png' })
    }

    setUploadingMedia(true)
    alerts.toast('Enviando imagen a WhatsApp...')

    const formData = new FormData()
    formData.append('file', uploadFile)
    formData.append('phone', currentSession.phone)
    formData.append('type', type)
    if (captionText?.trim()) {
      formData.append('caption', captionText.trim())
    }
    if (currentSession?.id) formData.append('sessionId', currentSession.id)
    if (activeOrder?.id) formData.append('orderId', activeOrder.id)

    try {
      await api.post('/whatsapp/send-media', formData)
      setActiveSession(prev => prev && prev.id === currentSession.id ? { ...prev, unreadCount: 0 } : prev)
      setSessions(prev => prev.map(s => s.id === currentSession.id ? { ...s, unreadCount: 0 } : s))
    } catch (err: any) {
      console.error('Error enviando imagen:', err)
      alerts.error('Error', err.message || 'Error al enviar la imagen por WhatsApp.')
    } finally {
      setUploadingMedia(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const openMediaPreview = (file: File, initialCaption = '') => {
    if (file.type.startsWith('image/')) {
      const previewUrl = URL.createObjectURL(file)
      setPendingMedia({
        file,
        previewUrl,
        caption: initialCaption || ''
      })
    } else {
      void handleSendMediaFile(file, initialCaption)
    }
  }

  const handleConfirmSendMedia = async () => {
    if (!pendingMedia || uploadingMedia) return
    const { file, caption, previewUrl } = pendingMedia
    URL.revokeObjectURL(previewUrl)
    setPendingMedia(null)
    await handleSendMediaFile(file, caption)
  }

  const handleCancelSendMedia = () => {
    if (pendingMedia?.previewUrl) {
      URL.revokeObjectURL(pendingMedia.previewUrl)
    }
    setPendingMedia(null)
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    openMediaPreview(file)
  }

  const handlePasteScreenshotFromClipboard = async () => {
    const now = Date.now()
    if (now - lastPasteTimeRef.current < 600) return
    lastPasteTimeRef.current = now

    if (!navigator.clipboard || !navigator.clipboard.read) {
      alerts.toast('Lectura directa de portapapeles no soportada en este navegador.')
      return
    }

    try {
      const items = await navigator.clipboard.read()
      let foundImage = false

      for (const item of items) {
        const imageType = item.types.find(t => t.startsWith('image/'))
        if (imageType) {
          foundImage = true
          const blob = await item.getType(imageType)
          const ext = imageType === 'image/jpeg' ? 'jpg' : imageType === 'image/webp' ? 'webp' : 'png'
          const file = new File([blob], `captura_${Date.now()}.${ext}`, { type: imageType })
          openMediaPreview(file)
          return
        }
      }

      if (!foundImage) {
        alerts.toast('No hay ninguna captura de pantalla en el portapapeles.')
      }
    } catch (err: any) {
      console.warn('Error leyendo portapapeles:', err)
      alerts.toast('No se pudo acceder a la captura. Asegúrate de haber copiado una imagen.')
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Atajo exclusivo: Ctrl + X (o Cmd + X) para pegar captura de pantalla en el sistema
      if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'X')) {
        const currentSession = activeSessionRef.current
        if (!currentSession) return

        // Si hay algún diálogo abierto, no interferir
        const isModalOpen = document.querySelector('[role="dialog"]') !== null
        if (isModalOpen) return

        // Si el usuario tiene texto seleccionado dentro de un input/textarea, permitir el CORTAR texto normal
        const target = e.target as HTMLElement | null
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
          const inputEl = target as HTMLInputElement | HTMLTextAreaElement
          if (typeof inputEl.selectionStart === 'number' && 
              typeof inputEl.selectionEnd === 'number' && 
              inputEl.selectionStart !== inputEl.selectionEnd) {
            return
          }
        }

        // Interceptar Ctrl + X para pegar la captura de pantalla
        e.preventDefault()
        e.stopPropagation()
        void handlePasteScreenshotFromClipboard()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  // Send message with 0ms Optimistic UI for instant responsiveness
  const handleSendMessageText = async (textToSend: string) => {
    if (!textToSend.trim() || !activeSession) return



    const cleanText = textToSend.trim()

    // 1. Mostrar la burbuja de mensaje de inmediato en 0ms
    const tempId = `temp-${Date.now()}`
    const optimisticMsg: Message = {
      id: tempId,
      direction: 'OUT',
      content: cleanText,
      messageType: 'text',
      status: 'sending',
      createdAt: new Date().toISOString(),
      ...(replyingTo ? {
        replyToContent: replyingTo.messageType === 'image' ? '📷 Imagen' : replyingTo.messageType === 'audio' ? '🎤 Audio' : replyingTo.content,
        replyToDirection: replyingTo.direction
      } : {})
    }

    const replyWaId = replyingTo?.waMessageId || null
    const replyContent = replyingTo ? (replyingTo.messageType === 'image' ? '📷 Imagen' : replyingTo.messageType === 'audio' ? '🎤 Audio' : replyingTo.content) : null
    setReplyingTo(null)

    setMessagesCached(prev => [...prev, optimisticMsg])
    setSessions(prev => {
      const updated = prev.map(s => s.id === activeSession.id ? {
        ...s,
        unreadCount: 0,
        lastMessageAt: new Date().toISOString(),
        messages: [optimisticMsg, ...(s.messages?.filter(m => m.id !== optimisticMsg.id) || [])]
      } : s)
      return updated.sort((a, b) => (new Date(b.lastMessageAt || 0).getTime() || 0) - (new Date(a.lastMessageAt || 0).getTime() || 0))
    })
    setActiveSession(prev => prev && prev.id === activeSession.id ? { ...prev, unreadCount: 0 } : prev)

    // 2. Enviar a la API en segundo plano
    try {
      const result = await api.post<{
        sent: boolean
        message?: Message & { sessionId?: string }
      }>('/whatsapp/send', {
        phone: activeSession.phone,
        text: cleanText,
        sessionId: activeSession.id,
        orderId: activeOrder?.id || undefined,
        ...(replyWaId ? { replyToWaMessageId: replyWaId, replyToContent: replyContent } : {})
      })

      // El socket suele confirmar primero. Esta respuesta sirve de respaldo cuando
      // la red en tiempo real está lenta y evita dejar el mensaje como "enviando".
      if (result.message) {
        const persisted = result.message
        setMessagesCached(prev => {
          const alreadyPresent = prev.some(message =>
            message.id === persisted.id ||
            Boolean(persisted.waMessageId && message.waMessageId === persisted.waMessageId)
          )
          if (alreadyPresent) return prev.filter(message => message.id !== tempId)
          return prev.map(message => message.id === tempId ? persisted : message)
        })
        setSessions(prev => prev.map(session => session.id === activeSession.id ? {
          ...session,
          lastMessageAt: persisted.createdAt,
          messages: [
            persisted,
            ...(session.messages || []).filter(message =>
              message.id !== tempId &&
              message.id !== persisted.id &&
              (!persisted.waMessageId || message.waMessageId !== persisted.waMessageId)
            )
          ]
        } : session))
      } else {
        setMessagesCached(prev => prev.map(message => message.id === tempId ? { ...message, status: 'sent' } : message))
      }
    } catch (err: any) {
      console.error('Error enviando mensaje:', err)
      setMessagesCached(prev => prev.map(message => message.id === tempId ? { ...message, status: 'failed' } : message))
      setSessions(prev => prev.map(session => session.id === activeSession.id ? {
        ...session,
        messages: (session.messages || []).map(message => message.id === tempId ? { ...message, status: 'failed' } : message)
      } : session))
      alerts.error('Error de Envío', err.message || 'No se pudo entregar el mensaje de WhatsApp. Inténtalo de nuevo.')
    }
  }

  const handleRetryFailedMessage = async (failedMsg: Message) => {
    if (!activeSession || !failedMsg) return
    const text = failedMsg.content
    if (!failedMsg.messageType || failedMsg.messageType === 'text') {
      setMessagesCached(prev => prev.map(m => m.id === failedMsg.id ? { ...m, status: 'sending' } : m))
      setSessions(prev => prev.map(s => s.id === activeSession.id ? {
        ...s,
        messages: (s.messages || []).map(m => m.id === failedMsg.id ? { ...m, status: 'sending' } : m)
      } : s))

      try {
        const result = await api.post<{
          sent: boolean
          message?: Message & { sessionId?: string }
        }>('/whatsapp/send', {
          phone: activeSession.phone,
          text: text,
          sessionId: activeSession.id,
          orderId: activeOrder?.id || undefined,
        })
        if (result.message) {
          const persisted = result.message
          setMessagesCached(prev => prev.map(m => m.id === failedMsg.id ? persisted : m))
          setSessions(prev => prev.map(session => session.id === activeSession.id ? {
            ...session,
            lastMessageAt: persisted.createdAt,
            messages: [persisted, ...(session.messages || []).filter(m => m.id !== failedMsg.id)]
          } : session))
        } else {
          setMessagesCached(prev => prev.map(m => m.id === failedMsg.id ? { ...m, status: 'sent' } : m))
        }
        alerts.toast('Mensaje reenviado exitosamente')
      } catch (err: any) {
        console.error('Error reintentando mensaje:', err)
        setMessagesCached(prev => prev.map(m => m.id === failedMsg.id ? { ...m, status: 'failed' } : m))
        setSessions(prev => prev.map(s => s.id === activeSession.id ? {
          ...s,
          messages: (s.messages || []).map(m => m.id === failedMsg.id ? { ...m, status: 'failed' } : m)
        } : s))
        alerts.error('Error de Reintento', err.message || 'No se pudo entregar el mensaje de WhatsApp. Inténtalo de nuevo.')
      }
    } else {
      alerts.toast('Para mensajes con archivo o multimedia, por favor adjúntalos nuevamente.')
    }
  }

  const [sendingMenu, setSendingMenu] = useState(false)
  const [sendingPaymentQr, setSendingPaymentQr] = useState(false)
  const lastSendMenuAtRef = useRef<number>(0)
  const lastSendQrAtRef = useRef<number>(0)

  // Send Restaurant Carta / Menu to active WhatsApp chat
  const handleSendMenuCarta = async () => {
    if (!activeSession || sendingMenu) return
    const now = Date.now()
    if (now - lastSendMenuAtRef.current < 4000) {
      console.warn('Debounce Enviar Carta evitado')
      return
    }
    lastSendMenuAtRef.current = now

    setSendingMenu(true)
    try {
      await api.post('/whatsapp/send-menu', { phone: activeSession.phone })
      setActiveSession(prev => prev && prev.id === activeSession.id ? { ...prev, unreadCount: 0 } : prev)
      setSessions(prev => prev.map(s => s.id === activeSession.id ? { ...s, unreadCount: 0 } : s))
    } catch (err: any) {
      console.error('Error enviando carta:', err)
      alerts.error('Error al enviar carta', err.message || 'No se pudo entregar la carta.')
    } finally {
      setSendingMenu(false)
    }
  }

  // Send Restaurant Payment QR to active WhatsApp chat
  const handleSendPaymentQr = async () => {
    if (!activeSession || sendingPaymentQr) return
    const now = Date.now()
    if (now - lastSendQrAtRef.current < 4000) {
      console.warn('Debounce Enviar QR evitado')
      return
    }
    lastSendQrAtRef.current = now

    setSendingPaymentQr(true)
    try {
      await api.post('/whatsapp/send-payment-qr', {
        phone: activeSession.phone,
        orderId: activeOrder?.id || undefined,
        sessionId: activeSession.id,
      })
      setActiveSession(prev => prev && prev.id === activeSession.id ? { ...prev, unreadCount: 0 } : prev)
      setSessions(prev => prev.map(s => s.id === activeSession.id ? { ...s, unreadCount: 0 } : s))
    } catch (err: any) {
      console.error('Error enviando QR de pago:', err)
      alerts.error('Error al enviar QR de pago', err.message || 'No se pudo entregar el QR de pago.')
    } finally {
      setSendingPaymentQr(false)
    }
  }

  const [sendingLocation, setSendingLocation] = useState(false)

  // Send GPS Location to active WhatsApp chat
  const handleSendLocation = async () => {
    if (!activeSession || sendingLocation) return

    if (!navigator.geolocation) {
      alerts.error('No Disponible', 'Tu navegador no soporta geolocalización.')
      return
    }

    setSendingLocation(true)
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        })
      })

      const { latitude, longitude } = position.coords

      await api.post('/whatsapp/send-location', {
        phone: activeSession.phone,
        latitude,
        longitude,
        name: 'The Villa Dog',
        address: 'Punto de Domicilios'
      })
      setActiveSession(prev => prev && prev.id === activeSession.id ? { ...prev, unreadCount: 0 } : prev)
      setSessions(prev => prev.map(s => s.id === activeSession.id ? { ...s, unreadCount: 0 } : s))
    } catch (err: any) {
      if (err?.code === 1) {
        alerts.error('Permiso Denegado', 'Debes permitir el acceso a la ubicación en tu navegador.')
      } else if (err?.code === 2) {
        alerts.error('Ubicación No Disponible', 'No se pudo obtener tu ubicación GPS.')
      } else if (err?.code === 3) {
        alerts.error('Tiempo Agotado', 'Se agotó el tiempo para obtener la ubicación.')
      } else {
        console.error('Error enviando ubicación:', err)
        alerts.error('Error', err.message || 'No se pudo enviar la ubicación.')
      }
    } finally {
      setSendingLocation(false)
    }
  }

  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null)
  const [forwardSearch, setForwardSearch] = useState('')
  const [forwardSearchResults, setForwardSearchResults] = useState<Session[]>([])
  const [loadingForwardSearch, setLoadingForwardSearch] = useState(false)
  const [sendingForward, setSendingForward] = useState<string | null>(null)

  // Búsqueda en tiempo real en TODA la base de datos (7,000+ chats) para reenviar
  useEffect(() => {
    if (!forwardingMessage) {
      setForwardSearchResults([])
      setLoadingForwardSearch(false)
      return
    }
    const q = forwardSearch.trim()
    if (!q) {
      setForwardSearchResults([])
      setLoadingForwardSearch(false)
      return
    }

    setLoadingForwardSearch(true)
    const timer = setTimeout(async () => {
      try {
        const results = await api.get<Session[]>(`/whatsapp/sessions?search=${encodeURIComponent(q)}&limit=40`)
        setForwardSearchResults(Array.isArray(results) ? results : [])
      } catch (err) {
        console.error('Error buscando contactos para reenviar:', err)
        setForwardSearchResults([])
      } finally {
        setLoadingForwardSearch(false)
      }
    }, 200)

    return () => clearTimeout(timer)
  }, [forwardSearch, forwardingMessage])

  // Forward message to any selected session in 0.05s directly via server
  const handleForwardMessageToSession = async (targetSession: Session) => {
    if (!forwardingMessage || sendingForward) return

    setSendingForward(targetSession.id)
    try {
      await api.post('/whatsapp/forward', {
        phone: targetSession.phone,
        content: forwardingMessage.content,
        type: forwardingMessage.messageType || 'text'
      })

      alerts.success('Mensaje Reenviado', `El mensaje se reenvió con éxito a ${targetSession.customerName || targetSession.phone}.`)
      setForwardingMessage(null)
      loadSessions(targetSession.id)
    } catch (err: any) {
      console.error('Error reenviando mensaje:', err)
      alerts.error('Error al reenviar', err.message || 'No se pudo reenviar el mensaje.')
    } finally {
      setSendingForward(null)
    }
  }

  const handleForwardMessageToPhone = async (phone: string) => {
    if (!forwardingMessage || sendingForward) return
    
    setSendingForward('new')
    try {
      await api.post('/whatsapp/forward', {
        phone: phone,
        content: forwardingMessage.content,
        type: forwardingMessage.messageType || 'text'
      })
      
      alerts.success('Mensaje Reenviado', `El mensaje se reenvió con éxito al ${phone}.`)
      setForwardingMessage(null)
      loadSessions()
    } catch (err: any) {
      console.error('Error reenviando mensaje:', err)
      alerts.error('Error al reenviar', err.message || 'No se pudo reenviar el mensaje.')
    } finally {
      setSendingForward(null)
    }
  }

  // Claim/assign session to current user
  const handleClaimSession = async (sessionToClaim?: Session | null, silent?: boolean): Promise<boolean> => {
    const targetSession = sessionToClaim || activeSession
    if (!targetSession || !user) return false
    if (targetSession.assignedToId === user.id) return true

    if (targetSession.assignedToId && targetSession.assignedToId !== user.id) {
      const isSupervisor = ['ADMIN', 'SUPERADMIN', 'DELIVERY_MANAGER'].includes(user.role || '')
      const otherName = targetSession.assignedTo?.name || 'otra asesora'
      if (!isSupervisor) {
        alerts.info('Chat ocupado', `Esta conversación está siendo atendida en tiempo real por ${otherName}.`)
        return false
      }
      const confirm = await alerts.confirm(
        '¿Reasignar conversación?',
        `Esta conversación está tomada por ${otherName}. ¿Deseas reasignártela a ti para atender al cliente?`,
        'Sí, Reclamar',
        'Cancelar'
      )
      if (!confirm) return false
    }

    try {
      const updated = await api.put<Session>(`/whatsapp/sessions/${targetSession.id}/assign`, {
        userId: user.id
      })
      const assignedTo = updated?.assignedTo || { id: user.id, name: user.name }
      setActiveSession(prev => {
        if (!prev || prev.id !== targetSession.id) return prev
        return {
          ...prev,
          ...(updated || {}),
          assignedTo,
          assignedToId: user.id,
          waitingForAdvisor: false,
          messages: prev.messages || [],
        }
      })
      setSessions(prev => (prev || []).map(s => {
        if (s.id !== targetSession.id) return s
        return {
          ...s,
          ...(updated || {}),
          assignedTo,
          assignedToId: user.id,
          waitingForAdvisor: false,
          messages: s.messages || [],
        }
      }))
      if (!silent) {
        alerts.success('Chat Reclamado', 'Ahora estás atendiendo este chat en tiempo real.')
      }
      return true
    } catch (err: any) {
      console.error('Error al reclamar chat:', err)
      alerts.error('No se pudo tomar el chat', err?.message || 'No se pudo reclamar la conversación.')
      return false
    }
  }

  // Release/unassign session
  const handleReleaseSession = async (sessionToRelease?: any) => {
    const target = (sessionToRelease && typeof sessionToRelease === 'object' && typeof sessionToRelease.id === 'string' && !('nativeEvent' in sessionToRelease))
      ? sessionToRelease
      : activeSession
    if (!target || !target.id) return
    const isMine = target.assignedToId === user?.id
    const confirm = await alerts.confirm(
      '¿Liberar conversación?',
      isMine 
        ? 'El chat volverá a la cola general para que cualquier asesor disponible pueda atenderlo o responderlo.'
        : '¿Deseas soltar este chat para que vuelva a la cola general?',
      'Sí, Soltar',
      'Cancelar'
    )
    if (!confirm) return

    try {
      const updated = await api.put<Session>(`/whatsapp/sessions/${target.id}/assign`, {
        userId: null
      })
      setActiveSession(prev => {
        if (!prev || prev.id !== target.id) return prev
        return {
          ...prev,
          ...(updated || {}),
          assignedToId: null,
          assignedTo: null,
          messages: prev.messages || [],
        }
      })
      setSessions(prev => (prev || []).map(s => {
        if (s.id !== target.id) return s
        return {
          ...s,
          ...(updated || {}),
          assignedToId: null,
          assignedTo: null,
          messages: s.messages || [],
        }
      }))
      alerts.success('Chat Liberado', 'La conversación volvió a estar disponible en la cola general.')
    } catch (err: any) {
      console.error('Error al liberar chat:', err)
      alerts.error('No se pudo liberar el chat', err?.message || 'Actualiza la bandeja e inténtalo nuevamente.')
    }
  }

  // Release/unassign all sessions
  const handleUnassignAll = async () => {
    const confirm = await alerts.confirm(
      '¿Liberar chats asignados?',
      'Se desasignarán los chats para que vuelvan a la cola general y cualquier asesor o cajero de turno pueda responderlos.',
      'Sí, Liberar Chats',
      'Cancelar'
    )
    if (!confirm) return

    try {
      const res = await api.post<any>('/whatsapp/sessions/unassign-all', {})
      alerts.success('Chats Liberados', `Se liberaron ${res?.count || 0} chats a la cola general.`)
      loadSessions()
    } catch (err: any) {
      alerts.error('Error', err.message || 'No se pudieron liberar los chats.')
    }
  }

  // Delete/archive session
  const handleDeleteSession = async (targetSessionId?: string) => {
    const sessionToDeleteId = targetSessionId || activeSession?.id
    if (!sessionToDeleteId) return

    const ok = window.confirm('¿Estás seguro de que deseas eliminar permanentemente esta conversación y su historial de WhatsApp?')
    if (!ok) return

    try {
      await api.delete(`/whatsapp/sessions/${sessionToDeleteId}`)
      removeCachedMessages(sessionToDeleteId)
      if (activeSession?.id === sessionToDeleteId) {
        setActiveSession(null)
        navigate('/chat', { replace: true })
      }
      loadSessions()
    } catch (err: any) {
      alert('Error al eliminar la conversación.')
    }
  }

  // Quick send template to active chat
  const handleSendQuickTemplate = async (sessionToUse?: Session | null) => {
    const s = sessionToUse || activeSession
    if (!s) return

    const confirm = await alerts.confirm(
      '¿Enviar Plantilla Meta?',
      `Se enviará la plantilla oficial "niche_prueba" a ${s.phone} para abrir/reactivar la ventana de chat.`,
      'Enviar Plantilla',
      'Cancelar'
    )
    if (!confirm) return

    try {
      await api.post('/whatsapp/send-template', {
        phone: s.phone,
        templateName: 'niche_prueba',
        languageCode: 'es_EC',
        params: ['Cliente']
      })
      alerts.success('Plantilla Enviada', 'La plantilla de WhatsApp se entregó con éxito.')
      setActiveSession(prev => prev && prev.id === s.id ? { ...prev, unreadCount: 0 } : prev)
      setSessions(prev => prev.map(item => item.id === s.id ? { ...item, unreadCount: 0 } : item))
    } catch (err: any) {
      alerts.error('Error al enviar plantilla', err.message || 'No se pudo entregar la plantilla.')
    }
  }

  // Save edited message from dialog
  const handleSaveEditedMessage = async () => {
    if (!editingMessage || !editText.trim()) return
    try {
      await api.put(`/whatsapp/messages/${editingMessage.id}`, { content: editText.trim() })
      setMessagesCached(prev => prev.map(m => m.id === editingMessage.id ? { ...m, content: editText.trim(), isEdited: true } : m))
      setEditingMessage(null)
      setEditText('')
    } catch (err: any) {
      alert('Error al editar el mensaje.')
    }
  }

  // Confirm delete message from dialog with mode ('for_me' | 'for_everyone')
  const handleConfirmDeleteMessage = async (mode: 'for_me' | 'for_everyone' = 'for_everyone') => {
    if (!deletingMessage) return
    try {
      await api.delete(`/whatsapp/messages/${deletingMessage.id}?mode=${mode}`)
      if (mode === 'for_everyone') {
        setMessagesCached(prev => prev.map(m => m.id === deletingMessage.id ? {
          ...m,
          content: '🚫 Este mensaje fue eliminado',
          status: 'deleted'
        } : m))
      } else {
        setMessagesCached(prev => prev.filter(m => m.id !== deletingMessage.id))
      }
      setDeletingMessage(null)
    } catch (err: any) {
      alert('Error al eliminar el mensaje.')
    }
  }

  const handleCreateOrder = async () => {
    if (!activeSession) return

    const isAdmin = ['ADMIN', 'SUPERADMIN'].includes(user?.role || '')
    if (!isAdmin && user) {
      if (!activeSession.assignedToId) {
        const confirmClaim = await alerts.confirm(
          'Reclamar Chat requerido',
          'Debes pulsar "Reclamar Chat" primero para tomar el pedido de este cliente.\n\n¿Deseas reclamar este chat ahora mismo y abrir la orden?',
          'Sí, Reclamar y Tomar Pedido',
          'Cancelar'
        )
        if (!confirmClaim) return
        const claimed = await handleClaimSession(activeSession)
        if (!claimed) return
      } else if (activeSession.assignedToId !== user.id) {
        const canTakeover = ['DELIVERY_MANAGER', 'ADMIN', 'SUPERADMIN'].includes(user?.role || '')
        if (canTakeover) {
          const confirmTakeover = await alerts.confirm(
            'Reasignar para tomar pedido',
            `Este chat está asignado a ${activeAssignedInfo.assignedName || 'otra asesora'}.\n\n¿Deseas reclamar la conversación para ti y tomar el pedido?`,
            'Sí, Reclamar y Tomar Pedido',
            'Cancelar'
          )
          if (!confirmTakeover) return
          const claimed = await handleClaimSession(activeSession)
          if (!claimed) return
        } else {
          alerts.warning(
            'Chat de otra asesora',
            `Este chat está siendo atendido por ${activeAssignedInfo.assignedName || 'otra asesora'}. Debes tener el chat reclamado para tomar el pedido.`
          )
          return
        }
      }
    }

    let extractedName = activeSession.customerName || ''
    let rawPhone = activeSession.phone || ''
    
    // 1. Priorizar customerPhone si ya fue extraído de Meta o del chat
    let extractedPhone = ''
    if (activeSession.customerPhone) {
      const cClean = activeSession.customerPhone.replace(/\D/g, '')
      extractedPhone = (cClean.length === 12 && cClean.startsWith('57')) ? cClean.slice(2) : cClean
    }

    if (!extractedPhone) {
      const cleanDigits = rawPhone.replace(/\D/g, '')
      if (cleanDigits.length === 10 && cleanDigits.startsWith('3')) {
        extractedPhone = cleanDigits
      } else if (cleanDigits.length === 12 && cleanDigits.startsWith('573')) {
        extractedPhone = cleanDigits.slice(2)
      } else if (cleanDigits.length === 11 && cleanDigits.startsWith('1')) {
        extractedPhone = cleanDigits
      }
    }

    let extractedAddress = ''
    let extractedZone = ''

    // El pedido puede abrirse desde un chat antiguo. El historial ya viene
    // paginado por el servidor, así que no debemos descartar mensajes solo
    // por su fecha: el panel de Nuevo pedido decide el corte usando la última
    // confirmación real del pedido.
    const textMessages = [...messages]
      .filter(m => m.direction === 'IN')
      .reverse()

    for (const msg of textMessages) {
      const content = typeof msg?.content === 'string' ? msg.content : String(msg?.content || '')
      if (!content) continue

      // Extract GPS Location Link if shared
      if (!extractedAddress && (msg.messageType === 'location' || content.includes('maps.google.com') || content.includes('📍 Ubicación'))) {
        const mapsMatch = content.match(/https?:\/\/[^\s]+/)
        if (mapsMatch) {
          extractedAddress = mapsMatch[0]
        }
      }

      const nameMatch = content.match(/Nombre:\s*([^\n\r]+)/i)
      if (nameMatch) {
        const foundName = nameMatch[1].trim().replace(/^@+/, '')
        if (foundName && !/^\d+$/.test(foundName.replace(/[\s+()-]/g, ''))) {
          extractedName = foundName
        }
      }

      const addressMatch = content.match(/(Dirección|Direccion|Dir):\s*([^\n\r]+)/i)
      if (addressMatch && !extractedAddress) {
        extractedAddress = addressMatch[2].trim()
      } else if (!extractedAddress) {
        const streetPattern = /\b(calle|cl|carrera|cra|diagonal|dg|transversal|tv|avenida|av|manzana|mz|lote)\s+[\w\d\s#-]{3,40}/i
        const streetMatch = content.match(streetPattern)
        if (streetMatch) {
          extractedAddress = streetMatch[0].trim()
        }
      }

      // Escanear teléfono explícito, línea dedicada o patrón de 10 dígitos en el mensaje
      if (!extractedPhone) {
        const explicitPhoneMatch = content.match(/(?:tel[eé]fono|cel(?:ular)?|m[oó]vil|n[uú]mero|num|nro|wa|llamadas?)\s*[:=-]?\s*(?:57\s*)?(3\d{2}[\s.-]?\d{3}[\s.-]?\d{4})/i)
        if (explicitPhoneMatch) {
          const rawP = explicitPhoneMatch[1].replace(/\D/g, '')
          if (rawP.length === 10 && rawP.startsWith('3')) {
            extractedPhone = rawP
          }
        } else {
          // Revisar si el mensaje o alguna de sus líneas contiene exactamente un número de 10 dígitos (ej: "3206735694")
          const lines = content.split(/[\r\n]+/)
          for (const l of lines) {
            const lDigits = l.trim().replace(/\D/g, '')
            if (lDigits.length === 10 && lDigits.startsWith('3')) {
              extractedPhone = lDigits
              break
            } else if (lDigits.length === 12 && lDigits.startsWith('573')) {
              extractedPhone = lDigits.slice(2)
              break
            }
          }

          if (!extractedPhone) {
            const genericMatch = content.match(/\b(?:57\s*)?(3[0-9]{2})[\s.-]?([0-9]{3})[\s.-]?([0-9]{4})\b/)
            if (genericMatch) {
              extractedPhone = `${genericMatch[1]}${genericMatch[2]}${genericMatch[3]}`
            }
          }
        }
      }

      const domZoneMatch = content.match(/\*Domicilio\s*\(([^)]+)\)\:\*/i)
      if (domZoneMatch && !extractedZone) {
        extractedZone = domZoneMatch[1].trim()
      }

      const zoneMatch = content.match(/(Barrio|Zona|Sector):\s*([^\n\r]+)/i)
      if (zoneMatch && !extractedZone) {
        extractedZone = zoneMatch[2].trim()
      } else if (!extractedZone) {
        const barrioPattern = /\bbarrio\s+([a-záéíóúñ0-9\s]{3,30})/i
        const barrioMatch = content.match(barrioPattern)
        if (barrioMatch) {
          extractedZone = barrioMatch[1].trim()
        }
      }
    }

    // Fallback search inside address if zone wasn't matched explicitly
    if (extractedAddress && !extractedZone) {
      const addressZoneMatch = extractedAddress.match(/(barrio|zona|sector)\s+([^\n\r,.-]+)/i)
      if (addressZoneMatch) {
        extractedZone = addressZoneMatch[2].trim()
      }
    }

    // Si el nombre tiene @ o es el número de teléfono o un ID técnico, limpiarlo para que NewOrderPage consulte la BD
    if (extractedName.startsWith('@')) {
      extractedName = extractedName.replace(/^@+/, '').trim()
    }
    const cleanDigits = rawPhone.replace(/\D/g, '')
    const isNameTechnical = /^(wa_lead_|user_|id_|c_|wamid\.)/i.test(extractedName) || 
      /^\+?57\s*\d+/.test(extractedName) || 
      extractedName.replace(/\D/g, '') === cleanDigits ||
      /^\d+$/.test(extractedName.replace(/[\s+()-]/g, ''))
    if (isNameTechnical) {
      extractedName = ''
    }

    // Solo enviar teléfono si es un número real (10-12 dígitos), nunca un ID técnico largo
    let finalPhone = extractedPhone || activeSession.customerPhone || ''
    const rawDigits = finalPhone.replace(/\D/g, '')
    if (rawDigits.length >= 13 || rawDigits === '3000000000' || rawDigits === '0000000000') {
      finalPhone = ''
    }

    setEmbeddedOrder({
      chatSessionId: activeSession.id,
      phone: finalPhone,
      name: extractedName,
      address: extractedAddress,
      zone: extractedZone,
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5 sm:gap-2">
      {/* Barra compacta: maximiza el espacio disponible para la conversación. */}
      <div className="shrink-0 min-w-0 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2 py-2 shadow-sm flex items-center gap-2">
        <div className="hidden xl:flex items-center gap-2 shrink-0 pl-1 pr-2">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-[#EA580C] to-[#F97316] text-[#0D0D0D]">
            <MessageSquareText className="h-4.5 w-4.5" />
            <span className={cn(
              "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg-panel)]",
              realtimeStatus === 'connected' ? "bg-emerald-500" : realtimeStatus === 'connecting' ? "bg-amber-500 animate-pulse" : "bg-red-500"
            )} />
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-1.5">
              <h1 className="text-sm font-black uppercase tracking-wide text-[var(--text-primary)]">WhatsApp</h1>
              <Badge className={cn(
                "border px-1.5 py-0 text-[8px] font-black",
                realtimeStatus === 'connected'
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600"
                  : realtimeStatus === 'connecting'
                    ? "border-amber-500/25 bg-amber-500/10 text-amber-600"
                    : "border-red-500/25 bg-red-500/10 text-red-600"
              )}>
                {realtimeStatus === 'connected' ? 'EN VIVO' : realtimeStatus === 'connecting' ? 'CONECTANDO' : 'SIN CONEXIÓN'}
              </Badge>
            </div>
            <p className="text-[10px] font-medium text-[var(--text-muted)]">
              {realtimeStatus === 'connected'
                ? 'Atención en tiempo real'
                : realtimeStatus === 'connecting'
                  ? 'Conectando actualizaciones'
                  : 'Las actualizaciones pueden demorarse'}
            </p>
          </div>
        </div>

        <div ref={tabsRef} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {([
            ['TODAY', 'Hoy', tabCounts.countToday],
            ['ALL', 'Todos', tabCounts.countAll],
            ['UNREAD', 'No leídos', tabCounts.countUnread],
            ['UNASSIGNED', 'Sin asignar', tabCounts.countUnassigned],
            ['WAITING', 'En espera', tabCounts.countWaiting],
            ['MINE', 'Míos', tabCounts.countMine],
          ] as const).map(([filter, label, count]) => (
            <button
              key={filter}
              type="button"
              aria-pressed={chatFilter === filter}
              onClick={() => {
                setChatFilter(filter)
                loadSessions(undefined, chatSearch.trim(), false, filter)
              }}
              className={cn(
                "h-8 shrink-0 rounded-lg border px-2.5 text-[11px] font-bold transition-colors flex items-center gap-1.5",
                chatFilter === filter
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "border-transparent bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:text-[var(--text-primary)]"
              )}
            >
              <span>{label}</span>
              <span className={cn(
                "min-w-4 rounded-full px-1 text-center text-[9px] leading-4",
                chatFilter === filter ? "bg-black/15" : "bg-black/5 dark:bg-white/10"
              )}>{count}</span>
            </button>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <span
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-lg border px-2 text-[10px] font-black xl:hidden",
              realtimeStatus === 'connected'
                ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600"
                : realtimeStatus === 'connecting'
                  ? "border-amber-500/25 bg-amber-500/10 text-amber-600"
                  : "border-red-500/25 bg-red-500/10 text-red-600"
            )}
            role="status"
            aria-live="polite"
            title={realtimeStatus === 'connected' ? 'WhatsApp conectado en tiempo real' : realtimeStatus === 'connecting' ? 'Conectando WhatsApp' : 'WhatsApp sin conexión en tiempo real'}
          >
            <span className={cn(
              "h-2 w-2 rounded-full",
              realtimeStatus === 'connected' ? "bg-emerald-500" : realtimeStatus === 'connecting' ? "bg-amber-500 animate-pulse" : "bg-red-500"
            )} />
            <span className="hidden sm:inline">
              {realtimeStatus === 'connected' ? 'EN VIVO' : realtimeStatus === 'connecting' ? 'CONECTANDO' : 'SIN CONEXIÓN'}
            </span>
          </span>
          {chatFilter === 'MINE' && tabCounts.countMine > 0 && (
            <button
              type="button"
              onClick={handleUnassignAll}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 text-[11px] font-bold text-amber-600 hover:bg-amber-500/20"
              title="Liberar todos mis chats"
            >
              <UserX className="h-3.5 w-3.5" />
              <span className="hidden 2xl:inline">Liberar</span>
            </button>
          )}
          {canManageChatbot && (
            <button
              type="button"
              onClick={toggleChatbot}
              disabled={chatbotEnabled === null || togglingChatbot}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-lg border px-2 text-[10px] font-black transition-colors disabled:cursor-wait disabled:opacity-60",
                chatbotEnabled
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/15"
                  : "border-slate-400/30 bg-slate-500/10 text-[var(--text-secondary)] hover:bg-slate-500/15"
              )}
              title={chatbotEnabled ? 'Pausar respuestas automáticas' : 'Activar respuestas automáticas'}
            >
              {chatbotEnabled ? <Bot className="h-3.5 w-3.5" /> : <BotOff className="h-3.5 w-3.5" />}
              <span className="hidden 2xl:inline">IA {chatbotEnabled ? 'activa' : 'pausada'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={toggleMuteWa}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg border",
              isMutedWa
                ? "border-amber-500/30 bg-amber-500/10 text-amber-500"
                : "border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
            )}
            title={isMutedWa ? 'Activar avisos' : 'Silenciar avisos'}
          >
            {isMutedWa ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {/* ÁREA PRINCIPAL DE CHATS */}
      <div className="flex min-h-0 flex-1 gap-1.5 sm:gap-2">
        {/* SESSIONS PANEL (LEFT) */}
        <Card className={`w-full md:w-84 lg:w-96 shrink-0 border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl flex flex-col overflow-hidden shadow-xl ${embeddedOrder ? 'hidden' : activeSession ? 'hidden md:flex' : 'flex'}`}>
          <div className="flex-none p-3 border-b border-[var(--border-subtle)] relative z-10 bg-[var(--bg-base)]/80 backdrop-blur-md">
            <div className="relative flex items-center">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-secondary)] pointer-events-none" />
              <input
                type="text"
                placeholder="Buscar cliente, mensaje, teléfono o #pedido..."
                className="w-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-2xl pl-10 pr-9 py-2.5 text-xs sm:text-sm font-medium focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 transition-all shadow-inner placeholder:text-[var(--text-muted)]"
                value={chatSearch}
                onChange={e => setChatSearch(e.target.value)}
                onFocus={() => {
                  if (searchBlurTimerRef.current) clearTimeout(searchBlurTimerRef.current)
                  setSearchFocused(true)
                }}
                onBlur={() => {
                  searchBlurTimerRef.current = setTimeout(() => setSearchFocused(false), 160)
                }}
              />
              {chatSearch && (
                <button
                  type="button"
                  onClick={() => { setChatSearch(''); loadSessions(undefined, ''); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                  title="Limpiar búsqueda"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {searchFocused && chatSearch.trim() && (
              <div className="absolute left-3 right-3 top-[3.85rem] z-50 overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-2xl">
                {searchSuggestions.length > 0 ? searchSuggestions.map(({ session, name, phone, reason, snippet }) => (
                  <button
                    key={session.id}
                    type="button"
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => {
                      setSearchFocused(false)
                      navigate(`/chat?session=${encodeURIComponent(session.id)}`, { replace: true })
                      setGlobalActiveSessionIdCache(session.id)
                      try {
                        localStorage.setItem('niche_last_active_whatsapp_session_id', session.id)
                      } catch (e) {}
                      setReplyingTo(null)
                      setMessage('')
                      setActiveOrder(session.activeOrder || null)
                      setActiveSession(session)
                      setTimeout(() => chatInputRef.current?.focus(), 50)
                    }}
                    className="flex w-full items-center gap-2.5 border-b border-[var(--border-subtle)]/60 px-3 py-2.5 text-left last:border-b-0 hover:bg-[var(--bg-hover)]"
                  >
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback className="bg-[var(--accent)] text-[var(--accent-fg)] text-[10px] font-black">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-bold text-[var(--text-primary)]">{name}</span>
                      <span className="block truncate text-[10px] text-[var(--text-muted)]">{phone || 'Sin teléfono'} · {reason}</span>
                      {snippet && (
                        <span className="mt-0.5 block line-clamp-2 text-[11px] leading-4 text-[var(--text-secondary)]">
                          <HighlightedSearchText text={snippet} query={chatSearch} />
                        </span>
                      )}
                    </span>
                    {session.unreadCount ? <span className="rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-black text-[var(--accent-fg)]">{session.unreadCount}</span> : null}
                  </button>
                )) : (
                  <div className="px-3 py-3 text-[11px] text-[var(--text-muted)]">
                    Busca por nombre, una palabra del mensaje, teléfono, <strong>#pedido</strong> o <strong>@identificador</strong>.
                  </div>
                )}
              </div>
            )}
            {chatSearch.trim() && (
              <div className="flex items-center justify-between mt-2 px-1 text-[11px] font-semibold text-[var(--text-secondary)]">
                <span>Resultados: <strong className="text-[var(--text-primary)]">{filteredSessions.length}</strong> encontrados</span>
                <button
                  type="button"
                  onClick={() => { setChatSearch(''); loadSessions(undefined, ''); }}
                  className="text-xs text-[var(--accent)] hover:underline font-bold cursor-pointer"
                >
                  Ver todos
                </button>
              </div>
            )}
          </div>

          <div 
            className="flex-1 overflow-y-auto divide-y divide-[var(--border-subtle)]/30"
            onScroll={(e) => {
              const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
              if (scrollHeight - scrollTop - clientHeight < 300) {
                if (hasMore && !loadingMore && !loadingSessions) {
                  loadMoreSessions()
                }
              }
            }}
          >
            {loadingSessions ? (
              <div className="flex items-center justify-center p-8 text-[var(--text-secondary)]">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                <span className="text-xs font-medium">Cargando chats...</span>
              </div>
            ) : sessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center text-[var(--text-secondary)] space-y-2">
                <MessageCircle className="h-8 w-8 text-[var(--text-muted)]" />
                <p className="text-xs font-medium">No hay chats activos</p>
                <p className="text-[10px] text-[var(--text-muted)]">Los mensajes entrantes de WhatsApp aparecerán aquí automáticamente.</p>
              </div>
            ) : (
              (() => {
                if (filteredSessions.length === 0) {
                  return (
                    <div className="p-8 text-center text-[var(--text-muted)] text-xs">
                      No hay chats que coincidan con la búsqueda.
                    </div>
                  )
                }
                
                return filteredSessions.map((s: Session) => {
                  const isActive = activeSession?.id === s.id
                  const cleanPhone = formatSessionPhone(getCallablePhoneNumber(s) || s.customerPhone || s.phone)
                  const displayName = getSessionDisplayName(s)
                  const initials = displayName
                    ? displayName.replace(/^@/, '').trim().split(/\s+/).filter(Boolean).map((n: string) => n[0] || '').join('').substring(0, 2).toUpperCase()
                    : null
                  
                  let latestMsg = 'Sin mensajes'
                  if (s.messages && s.messages.length > 0) {
                    const m = s.messages[0]
                    if (m.messageType === 'image') latestMsg = '📷 Imagen'
                    else if (m.messageType === 'audio') latestMsg = '🎵 Mensaje de voz'
                    else if (m.messageType === 'document') latestMsg = '📄 Documento'
                    else if (m.content) latestMsg = m.content
                  } else if ((s as any).lastMessageContent || (s as any).lastMessageText) {
                    latestMsg = (s as any).lastMessageContent || (s as any).lastMessageText
                  }
                  const searchSnippet = chatSearch.trim() ? getSearchSnippet(s, chatSearch) : ''
                  
                  const assignedInfo = getAssignedInfo(s, user)
                  
                  const isRecent = new Date(s.lastMessageAt).getTime() >= Date.now() - 4 * 60 * 60 * 1000
                  const isWaiting = (s as any).waitingForAdvisor === true && isRecent

                  const isUnreadIncoming = (s.unreadCount || 0) > 0
                  const displayUnread = s.unreadCount || 0
                  
                  let btnClass = 'w-full text-left p-3.5 flex gap-3 transition-colors border-l-4 border-transparent pl-[10px]'
                  if (isActive) {
                    btnClass = 'w-full text-left p-3.5 flex gap-3 transition-colors bg-[var(--accent-muted)] border-l-4 border-[var(--accent)] pl-[10px]'
                  } else if (isWaiting) {
                    btnClass = 'w-full text-left p-3.5 flex gap-3 transition-colors bg-red-500/5 hover:bg-red-500/10 border-l-4 border-red-500 pl-[10px] animate-pulse'
                  } else {
                    btnClass = 'w-full text-left p-3.5 flex gap-3 transition-colors hover:bg-[var(--bg-hover)]'
                  }
                  
                  return (
                    <button
                      key={s.id}
                      onClick={async () => {
                        navigate(`/chat?session=${encodeURIComponent(s.id)}`, { replace: true })
                        setGlobalActiveSessionIdCache(s.id)
                        try {
                          localStorage.setItem('niche_last_active_whatsapp_session_id', s.id)
                        } catch (e) {}
                        setReplyingTo(null)
                        setMessage('')
                        if (s.activeOrder) {
                          setActiveOrder(s.activeOrder)
                        }
                        
                        // Abrir el chat para visualizarlo SIN reclamarlo ni marcarlo como leído automáticamente.
                        // Solo se marcará como leído cuando un asesor/admin envíe una respuesta.
                        setActiveSession(s)
                        setTimeout(() => chatInputRef.current?.focus(), 50)
                      }}
                      className={btnClass}
                    >
                      <Avatar className={`h-9 w-9 shrink-0 ring-2 ${isWaiting ? 'ring-red-500/50' : 'ring-[var(--border-default)]'}`}>
                        <AvatarFallback className={`text-xs font-extrabold ${isWaiting ? 'bg-red-500 text-white animate-pulse' : 'bg-[var(--accent)] text-[var(--accent-fg)]'}`}>
                          {initials ? initials : <User className="h-4 w-4" />}
                        </AvatarFallback>
                      </Avatar>
                      
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-1.5">
                          <p className="text-xs font-bold text-[var(--text-primary)] truncate flex items-center gap-1.5 min-w-0">
                            {isWaiting && (
                              <span className="relative flex h-2 w-2 shrink-0">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                              </span>
                            )}
                            <span className="truncate">{displayName}</span>
                            {s.customerPhone && !s.customerPhone.includes('3000000000') && !s.customerPhone.includes('0000000000') && (s.phone !== s.customerPhone || displayName.startsWith('@') || displayName.includes('@')) && (
                              <span className="text-[9px] font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20 shrink-0" title={`Teléfono real extraído: ${formatSessionPhone(s.customerPhone)}`}>
                                📱 {formatSessionPhone(s.customerPhone)}
                              </span>
                            )}
                            {s.activeOrder && (
                              <span 
                                className={cn(
                                  "text-[9px] font-black px-1.5 py-0.5 rounded-md border font-mono tracking-tight shrink-0 shadow-2xs",
                                  s.activeOrder.status === 'PENDING' ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30" :
                                  s.activeOrder.status === 'IN_PREPARATION' ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30" :
                                  s.activeOrder.status === 'IN_ROUTE' ? "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30 animate-pulse" :
                                  s.activeOrder.status === 'READY' ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" :
                                  "bg-[var(--bg-elevated)] text-[var(--text-secondary)] border-[var(--border-subtle)]"
                                )}
                                title={`Pedido #${s.activeOrder.orderNumber} (${s.activeOrder.status})`}
                              >
                                #{s.activeOrder.orderNumber}
                              </span>
                            )}
                          </p>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={cn(
                              "text-[10px] font-mono",
                              isUnreadIncoming ? "text-[#25D366] font-bold" : "text-[var(--text-muted)]"
                            )}>
                              {formatSessionTime(s.lastMessageAt)}
                            </span>
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between gap-1">
                          <p className={cn(
                            "text-[11px] truncate flex-1 flex items-center gap-1",
                            isUnreadIncoming ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)] font-medium"
                          )}>
                            {(() => {
                              const sessionTyping = typingUsers[s.id]
                              if (sessionTyping && sessionTyping.userId !== user?.id && Date.now() - sessionTyping.timestamp < 3500) {
                                return (
                                  <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1 animate-pulse truncate">
                                    <span>✍️</span> {sessionTyping.userName} está escribiendo...
                                  </span>
                                )
                              }
                              return (
                                <>
                                  {s.messages?.[0]?.direction === 'OUT' && (
                                    <MessageStatus status={s.messages?.[0]?.status || 'sent'} direction="OUT" isList={true} />
                                  )}
                                  <span className="truncate">
                                    {searchSnippet
                                      ? <HighlightedSearchText text={searchSnippet} query={chatSearch} />
                                      : latestMsg}
                                  </span>
                                </>
                              )
                            })()}
                          </p>
                          {isUnreadIncoming && (
                            <span className="bg-[#25D366] text-white font-extrabold text-[10px] h-4.5 min-w-[18px] px-1.5 rounded-full flex items-center justify-center shrink-0 shadow-sm animate-pulse">
                              {displayUnread}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between pt-1 gap-1">
                          <span className="text-[10px] text-[var(--text-secondary)] font-mono font-semibold flex items-center gap-1.5 truncate max-w-[55%]">
                            <Phone className="h-3 w-3 text-[var(--accent)] shrink-0" />
                            <span className="truncate">{cleanPhone}</span>
                            {s.customerPhone && s.customerPhone !== s.phone && !s.customerPhone.includes('3000000000') && !s.customerPhone.includes('0000000000') && (
                              <span className="text-emerald-600 dark:text-emerald-400 font-bold shrink-0">
                                · 📱 {formatSessionPhone(s.customerPhone)}
                              </span>
                            )}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            {(() => {
                              const viewers = (chatViewers[s.id] || []).filter(v => Boolean(v?.userId))
                              if (viewers.length === 0) return null
                              const rawViewerName = typeof viewers[0]?.userName === 'string' ? viewers[0].userName.trim() : 'Asesor'
                              const shortName = rawViewerName.split(' ')[0] || rawViewerName
                              const viewerTitles = viewers.map(v => typeof v?.userName === 'string' ? v.userName : 'Asesor').join(', ')
                              return (
                                <span className="inline-flex items-center gap-0.5 text-[8px] font-bold text-sky-600 dark:text-sky-400 bg-sky-500/15 border border-sky-500/30 px-1.5 py-0.5 rounded-md" title={`Viendo: ${viewerTitles}`}>
                                  <Eye className="h-2.5 w-2.5" />
                                  <span className="max-w-[60px] truncate">{shortName}</span>
                                </span>
                              )
                            })()}
                            {isWaiting ? (
                              <Badge className="text-[8px] uppercase font-extrabold py-0.5 px-2 bg-red-500 hover:bg-red-600 text-white animate-pulse shadow-sm">
                                Esperando Asesor
                              </Badge>
                            ) : assignedInfo.isMine ? (
                              <Badge variant="outline" className="text-[8px] uppercase font-bold py-0.5 px-2 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 flex items-center gap-1 shadow-2xs">
                                <User className="h-2.5 w-2.5 text-emerald-500" /> Atendiendo tú
                              </Badge>
                            ) : assignedInfo.isAssigned ? (
                              <Badge variant="outline" className="text-[8px] uppercase font-bold py-0.5 px-2 bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 flex items-center gap-1 shadow-2xs">
                                <User className="h-2.5 w-2.5 text-amber-500" /> {assignedInfo.statusText}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[8px] uppercase font-bold py-0.5 px-2 bg-slate-500/10 text-slate-500 border-slate-500/20 flex items-center gap-1 shadow-2xs">
                                Disponible
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                )
              })
              })()
            )}
            {loadingMore && (
              <div className="p-3 text-center text-xs text-[var(--text-secondary)] flex items-center justify-center gap-2 bg-[var(--bg-elevated)]/30">
                <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
                <span className="text-[11px] font-semibold">Cargando más conversaciones...</span>
              </div>
            )}
          </div>
        </Card>

        {/* CHAT BOARD PANEL (RIGHT) */}
        <Card className={cn(
          "border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl flex flex-col overflow-hidden",
          embeddedOrder
            ? "hidden md:flex md:w-[44%] lg:w-[40%] xl:w-[36%] md:flex-none min-w-[320px] max-w-[500px]"
            : `flex-1 ${!activeSession ? 'hidden md:flex' : 'flex'}`
        )}>
          {activeSession ? (
            <>
              {/* CHAT HEADER */}
              <div className={cn(
                "border-b border-[var(--border-subtle)]/40 shrink-0 bg-[var(--bg-elevated)]/30",
                embeddedOrder ? "p-2 sm:p-2.5 space-y-1.5" : "p-2.5 sm:p-3 space-y-2"
              )}>
                {/* ROW 1: Contact Identity (Left) + Key Actions (Right) */}
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="md:hidden h-8 w-8 text-[var(--text-secondary)] shrink-0" 
                      onClick={() => {
                        setGlobalActiveSessionIdCache(null)
                        try { localStorage.removeItem('niche_last_active_whatsapp_session_id') } catch (e) {}
                        setActiveSession(null)
                        navigate('/chat', { replace: true })
                      }}
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    
                    <Avatar className={cn("shrink-0 ring-2 ring-[var(--border-default)]", embeddedOrder ? "h-8 w-8" : "h-9 w-9")}>
                      <AvatarFallback className="bg-[var(--accent)] text-xs font-bold text-[var(--accent-fg)]">
                        {getSessionDisplayName(activeSession).substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    
                    <div className="min-w-0 flex-1">
                      {isEditingContactName ? (
                        <div className="flex items-center gap-1.5 animate-in fade-in zoom-in-95 duration-100">
                          <input
                            type="text"
                            value={contactNameInput}
                            onChange={(e) => setContactNameInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveContactName()
                              if (e.key === 'Escape') setIsEditingContactName(false)
                            }}
                            autoFocus
                            placeholder="Nombre..."
                            className="h-7 text-xs px-2.5 rounded-lg border border-[var(--accent)] bg-[var(--bg-panel)] text-[var(--text-primary)] font-bold outline-none focus:ring-1 focus:ring-[var(--accent)] max-w-[140px]"
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={savingContactName}
                            onClick={handleSaveContactName}
                            className="h-7 w-7 text-emerald-500 hover:bg-emerald-500/10 rounded-lg cursor-pointer shrink-0"
                            title="Guardar nombre"
                          >
                            {savingContactName ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setIsEditingContactName(false)}
                            className="h-7 w-7 text-red-500 hover:bg-red-500/10 rounded-lg cursor-pointer shrink-0"
                            title="Cancelar"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 min-w-0">
                          <h4 className="text-xs font-extrabold text-[var(--text-primary)] uppercase truncate max-w-[130px] sm:max-w-[190px]" title={getSessionDisplayName(activeSession)}>
                            {getSessionDisplayName(activeSession)}
                          </h4>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setContactNameInput(activeSession.customerName || '')
                              setIsEditingContactName(true)
                            }}
                            className="h-6 w-6 text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-muted)]/20 rounded-md cursor-pointer shrink-0"
                            title="Editar nombre del cliente"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions Toolbar */}
                  <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                    {/* Create or Edit Order Button (Solo cuando no está embebido) */}
                    {!embeddedOrder && activeOrder && (
                      <Button 
                        size="sm"
                        className="h-8 bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-[10px] uppercase tracking-wider rounded-lg flex items-center gap-1.5 shadow-md shadow-amber-500/20 px-2 sm:px-3 border border-amber-600/30 shrink-0 cursor-pointer"
                        onClick={() => {
                          const sessionRealPhone = (activeSession.customerPhone && activeSession.customerPhone !== '3000000000' ? activeSession.customerPhone : activeSession.phone) || ''
                          setEmbeddedOrder({
                            editOrderId: activeOrder.id,
                            chatSessionId: activeSession.id,
                            phone: sessionRealPhone,
                            name: activeSession.customerName || '',
                          })
                        }}
                        title={`Editar Pedido #${activeOrder.orderNumber} (${activeOrder.status})`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span>Editar #{activeOrder.orderNumber}</span>
                      </Button>
                    )}
                    {!embeddedOrder && (
                      <Button
                        size="sm"
                        className="h-8 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold text-[10px] uppercase tracking-wider rounded-lg flex items-center gap-1.5 shadow-md shadow-[var(--accent)]/10 px-2 sm:px-3 shrink-0 cursor-pointer"
                        onClick={handleCreateOrder}
                        title="Crear Nuevo Pedido"
                      >
                        <PlusCircle className="h-3.5 w-3.5" />
                        <span className={activeOrder ? "hidden sm:inline" : ""}>Nuevo Pedido</span>
                      </Button>
                    )}

                    {/* Claim/Release Session */}
                    {activeAssignedInfo.isMine ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold shrink-0 bg-emerald-500/10 px-2 py-1 rounded-lg border border-emerald-500/30 flex items-center gap-1">
                          <span className="relative flex h-2 w-2 shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                          </span>
                          <span className={embeddedOrder ? "hidden xl:inline" : "hidden sm:inline"}>Atendiendo tú</span>
                        </div>
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="h-8 border-amber-500/30 hover:bg-amber-500/10 text-xs rounded-lg text-amber-600 dark:text-amber-400 px-2 sm:px-2.5 cursor-pointer"
                          onClick={() => handleReleaseSession()}
                          title="Soltar chat a la cola general"
                        >
                          <UserX className="h-3.5 w-3.5 text-amber-500" />
                          <span className={embeddedOrder ? "hidden xl:inline ml-1" : "hidden sm:inline ml-1"}>Soltar</span>
                        </Button>
                      </div>
                    ) : activeAssignedInfo.isAssigned ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <div className="text-[10px] text-amber-600 dark:text-amber-400 font-bold shrink-0 bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/30 max-w-[120px] truncate flex items-center gap-1" title={`Tomado por: ${activeAssignedInfo.assignedName}`}>
                          <span className="relative flex h-2 w-2 shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                          </span>
                          <span className="truncate"><strong>{activeAssignedInfo.assignedName}</strong></span>
                        </div>
                        {['SUPERADMIN', 'ADMIN'].includes(user?.role || '') && (
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="h-8 border-red-500/20 hover:bg-red-500/10 text-red-500 rounded-lg flex items-center justify-center shrink-0 text-xs px-2 cursor-pointer"
                            onClick={() => handleReleaseSession()}
                            title="Forzar Soltar chat (Administrador)"
                          >
                            <UserX className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="h-8 border-amber-500/40 hover:bg-amber-500/20 text-xs rounded-lg text-amber-600 dark:text-amber-300 px-2 sm:px-2.5 font-bold cursor-pointer flex items-center gap-1"
                          onClick={() => handleClaimSession()}
                          title="Reclamar chat"
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          <span className={embeddedOrder ? "hidden xl:inline" : "hidden sm:inline"}>Reclamar</span>
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 shrink-0">
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 font-bold shrink-0 bg-slate-500/10 px-2 py-1 rounded-lg border border-slate-500/20 flex items-center gap-1">
                          <span className="h-2 w-2 rounded-full bg-slate-400" />
                          <span className={embeddedOrder ? "hidden xl:inline" : "hidden sm:inline"}>Sin asignar</span>
                        </div>
                        <Button 
                          size="sm" 
                          className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg px-2 sm:px-2.5 flex items-center gap-1 shadow-sm cursor-pointer"
                          onClick={() => handleClaimSession()}
                          title="Reclamar chat para atenderlo tú"
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          <span className={embeddedOrder ? "hidden xl:inline" : "hidden sm:inline"}>Reclamar</span>
                        </Button>
                      </div>
                    )}

                    {/* Delete/Archive Session (Solo Admin/Superadmin) */}
                    {(user?.role === 'ADMIN' || user?.role === 'SUPERADMIN') && (
                      <Button 
                        size="icon" 
                        variant="outline" 
                        className="h-8 w-8 border-red-500/30 hover:bg-red-500/10 text-red-500 rounded-lg shrink-0 flex items-center justify-center cursor-pointer"
                        onClick={() => handleDeleteSession()}
                        title="Eliminar Conversación"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}

                    {/* Cerrar / Deseleccionar Chat */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 rounded-lg shrink-0 cursor-pointer"
                      onClick={() => {
                        setGlobalActiveSessionIdCache(null)
                        try { localStorage.removeItem('niche_last_active_whatsapp_session_id') } catch (e) {}
                        setActiveSession(null)
                        navigate('/chat', { replace: true })
                      }}
                      title="Cerrar chat (Dejar sin conversación seleccionada)"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* ROW 2: Contact Phones & Viewers */}
                <div className="flex items-center justify-between gap-2 text-[10px] min-w-0 border-t border-[var(--border-subtle)]/25 pt-1.5 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0 truncate">
                    <span className="text-[10px] text-[var(--text-muted)] font-mono font-medium flex items-center gap-1 truncate">
                      <Phone className="h-2.5 w-2.5 text-[var(--accent)] shrink-0" />
                      <span className="truncate">{activeSession.phone}</span>
                    </span>
                    {activeSession.customerPhone && activeSession.customerPhone !== activeSession.phone && (
                      <span className="text-emerald-600 dark:text-emerald-400 font-mono font-bold truncate bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/25 shrink-0">
                        📱 Real: {formatSessionPhone(activeSession.customerPhone)}
                      </span>
                    )}
                  </div>

                  {/* Real-time viewers in this chat */}
                  {(() => {
                    const viewers = (chatViewers[activeSession.id] || []).filter(v => v.userId !== user?.id)
                    if (viewers.length === 0) return null
                    return (
                      <div className="flex items-center gap-1 text-[9px] font-bold text-sky-600 dark:text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded border border-sky-500/25 shrink-0 max-w-[150px] truncate" title={`${viewers.map(v => v.userName).join(', ')} en este chat`}>
                        <Eye className="h-2.5 w-2.5 shrink-0 animate-pulse" />
                        <span className="truncate">{viewers.map(v => v.userName).join(', ')}</span>
                      </div>
                    )
                  })()}
                </div>
              </div>

              {/* LIVE ATTENTION STATUS BANNER */}
              {activeAssignedInfo.isMine ? (
                <div className="px-3 sm:px-4 py-1.5 sm:py-2 bg-emerald-500/10 border-b border-emerald-500/20 flex items-center justify-between gap-2 text-xs font-bold text-emerald-600 dark:text-emerald-400 shrink-0 animate-in fade-in duration-150">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <span className="truncate">
                      Estás atendiendo este chat en tiempo real ({user?.name || 'Tú'})
                      {chatbotEnabled === true && <span className="ml-1 font-medium text-emerald-700/80 dark:text-emerald-300/80">· IA pausada</span>}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleReleaseSession()}
                    className="h-6 px-2 text-[10px] font-bold text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 rounded-md cursor-pointer shrink-0"
                  >
                    Soltar Chat
                  </Button>
                </div>
              ) : activeAssignedInfo.isAssigned ? (
                <div className="px-3 sm:px-4 py-1.5 sm:py-2 bg-amber-500/15 border-b border-amber-500/25 flex items-center justify-between gap-2 text-xs font-bold text-amber-700 dark:text-amber-300 shrink-0 animate-in fade-in duration-150">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                    </span>
                    <span className="truncate">⚠️ Chat tomado en tiempo real por: <strong className="underline ml-1">{activeAssignedInfo.assignedName}</strong></span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleClaimSession()}
                    className="h-6.5 px-2.5 text-[11px] font-extrabold border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 rounded-md cursor-pointer flex items-center gap-1 shrink-0"
                    title="Tomar este chat para responder tú"
                  >
                    <UserPlus className="h-3 w-3" />
                    <span>Reclamar Chat</span>
                  </Button>
                </div>
              ) : (
                <div className="px-3 sm:px-4 py-1.5 bg-[var(--bg-elevated)]/50 border-b border-[var(--border-subtle)]/40 flex items-center justify-between gap-2 text-xs font-medium text-[var(--text-secondary)] shrink-0">
                  <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
                    <span className="h-2 w-2 rounded-full bg-slate-400 shrink-0" />
                    <span className="truncate">Chat disponible (Sin asignar)</span>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleClaimSession()}
                    className="h-6.5 px-2.5 text-[11px] font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white rounded-md cursor-pointer flex items-center gap-1 shadow-sm shrink-0"
                  >
                    <UserPlus className="h-3 w-3" />
                    <span>Reclamar Chat</span>
                  </Button>
                </div>
              )}

              {/* MESSAGES BODY */}
              <div 
                ref={messagesViewportRef}
                className="flex-1 overflow-y-auto p-4 space-y-4 bg-[var(--bg-elevated)]/10"
                onScroll={(e) => {
                  const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
                  userIsNearBottomRef.current = (scrollHeight - scrollTop - clientHeight) < 200
                }}
              >
                {loadingMessages ? (
                  <div className="flex flex-col items-center justify-center h-full text-[var(--text-secondary)] space-y-2">
                    <Loader2 className="h-6 w-6 animate-spin text-[var(--accent)]" />
                    <span className="text-xs font-semibold uppercase tracking-wider">Cargando conversación...</span>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center text-[var(--text-secondary)] space-y-2">
                    <AlertCircle className="h-7 w-7 text-[var(--text-muted)]" />
                    <p className="text-xs font-medium">No hay mensajes previos</p>
                    <p className="text-[10px] text-[var(--text-muted)]">Escribe un mensaje abajo para iniciar la conversación.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {hasOlderMessages && (
                      <div className="flex justify-center pb-1">
                        <button
                          type="button"
                          onClick={loadOlderMessages}
                          disabled={loadingOlderMessages}
                          className="h-8 px-3 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[11px] font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-60"
                        >
                          {loadingOlderMessages ? 'Cargando…' : 'Cargar mensajes anteriores'}
                        </button>
                      </div>
                    )}
                    {(() => {
                      let prevDateStr: string | null = null
                      return messages.map((m, index) => {
                        if (!m) return null
                        const isIncoming = m.direction === 'IN'
                        const mDate = m.createdAt ? new Date(m.createdAt) : new Date()
                        const currentDateStr = isNaN(mDate.getTime()) ? 'Hoy' : mDate.toDateString()
                        const showDateSeparator = currentDateStr !== prevDateStr
                        prevDateStr = currentDateStr
                        
                        return (
                          <div key={m.id || index} className="space-y-4">
                            {showDateSeparator && (
                              <div className="flex justify-center my-4">
                                <span className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] text-[10px] font-bold px-3.5 py-1.5 rounded-full shadow-sm uppercase tracking-wider">
                                  {formatSeparatorDate(m.createdAt)}
                                </span>
                              </div>
                            )}
                            
                            <div className={`flex ${isIncoming ? 'justify-start' : 'justify-end'} group relative`}>
                              <div className={`max-w-[85%] sm:max-w-[75%] min-w-[140px] rounded-2xl p-3 pr-10 sm:pr-11 shadow-md flex flex-col space-y-1 relative group/msg ${
                                isIncoming 
                                  ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] rounded-tl-none border border-[var(--border-subtle)]/50' 
                                  : 'bg-[var(--accent)] text-[var(--accent-fg)] rounded-tr-none'
                              }`}>
                                {/* Botón Chevron & Menú de Opciones al estilo WhatsApp - Con margen y separación para no tapar nunca texto o números */}
                                <div className="absolute top-2 right-2 z-20">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setActiveMsgMenuId(activeMsgMenuId === m.id ? null : m.id)
                                    }}
                                    className={cn(
                                      "p-1 rounded-full transition-all cursor-pointer",
                                      activeMsgMenuId === m.id ? "opacity-100" : "opacity-0 group-hover/msg:opacity-100 focus:opacity-100",
                                      isIncoming 
                                        ? "bg-[var(--bg-panel)]/90 hover:bg-[var(--bg-panel)] text-[var(--text-secondary)] shadow-sm border border-[var(--border-subtle)]" 
                                        : "bg-black/30 hover:bg-black/50 text-white shadow-sm"
                                    )}
                                    title="Opciones del mensaje (responder o reenviar)"
                                  >
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  </button>

                                  {activeMsgMenuId === m.id && (
                                    <div 
                                      className={cn(
                                        "fixed w-44 bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl p-1.5 z-[9999] animate-in fade-in zoom-in-95 duration-150",
                                      )}
                                      style={{
                                        top: 'auto',
                                        ...(isIncoming ? { left: 'auto' } : { right: 'auto' }),
                                      }}
                                      ref={(el) => {
                                        if (el) {
                                          const btn = el.parentElement?.querySelector('button') as HTMLElement;
                                          if (btn) {
                                            const btnRect = btn.getBoundingClientRect();
                                            el.style.top = `${btnRect.bottom + 4}px`;
                                            if (isIncoming) {
                                              el.style.left = `${Math.max(8, btnRect.right - 176)}px`;
                                            } else {
                                              el.style.left = `${Math.max(8, btnRect.right - 176)}px`;
                                            }
                                          }
                                        }
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {(!m.messageType || m.messageType === 'text') && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            navigator.clipboard.writeText(m.content)
                                            setCopiedMsgId(m.id)
                                            setTimeout(() => setCopiedMsgId(null), 2000)
                                            setActiveMsgMenuId(null)
                                          }}
                                          className="w-full text-left px-3 py-2 text-xs font-bold flex items-center gap-2 hover:bg-[var(--bg-hover)] rounded-xl text-[var(--text-primary)] transition-colors"
                                        >
                                          {copiedMsgId === m.id ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 text-[var(--text-secondary)]" />}
                                          <span>{copiedMsgId === m.id ? '¡Copiado!' : 'Copiar texto'}</span>
                                        </button>
                                      )}

                                      {m.status !== 'deleted' && m.content !== '🚫 Este mensaje fue eliminado' && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setForwardingMessage(m)
                                            setActiveMsgMenuId(null)
                                            setForwardSearch('')
                                          }}
                                          className="w-full text-left px-3 py-2 text-xs font-bold flex items-center gap-2 hover:bg-[var(--bg-hover)] rounded-xl text-[var(--text-primary)] transition-colors"
                                        >
                                          <Forward className="h-3.5 w-3.5 text-emerald-500" />
                                          <span>Reenviar mensaje</span>
                                        </button>
                                      )}

                                      {m.status !== 'deleted' && m.content !== '🚫 Este mensaje fue eliminado' && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setReplyingTo(m)
                                            setActiveMsgMenuId(null)
                                          }}
                                          className="w-full text-left px-3 py-2 text-xs font-bold flex items-center gap-2 hover:bg-[var(--bg-hover)] rounded-xl text-[var(--accent)] transition-colors"
                                        >
                                          <Reply className="h-3.5 w-3.5 text-[var(--accent)]" />
                                          <span>Responder</span>
                                        </button>
                                      )}

                                      {!isIncoming && (!m.messageType || m.messageType === 'text') && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditingMessage(m)
                                            setEditText(m.content)
                                            setActiveMsgMenuId(null)
                                          }}
                                          className="w-full text-left px-3 py-2 text-xs font-bold flex items-center gap-2 hover:bg-[var(--bg-hover)] rounded-xl text-blue-500 transition-colors"
                                        >
                                          <Pencil className="h-3.5 w-3.5 text-blue-500" />
                                          <span>Editar mensaje</span>
                                        </button>
                                      )}

                                      {!isIncoming && m.status === 'failed' && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            handleRetryFailedMessage(m)
                                            setActiveMsgMenuId(null)
                                          }}
                                          className="w-full text-left px-3 py-2 text-xs font-bold flex items-center gap-2 hover:bg-emerald-500/10 rounded-xl text-emerald-500 transition-colors"
                                        >
                                          <RotateCw className="h-3.5 w-3.5 text-emerald-500" />
                                          <span>Reintentar envío</span>
                                        </button>
                                      )}

                                      {!isIncoming && (user?.role === 'ADMIN' || user?.role === 'SUPERADMIN') && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setDeletingMessage(m)
                                            setActiveMsgMenuId(null)
                                          }}
                                          className="w-full text-left px-3 py-2 text-xs font-bold flex items-center gap-2 hover:bg-red-500/10 rounded-xl text-red-500 transition-colors"
                                        >
                                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                                          <span>Eliminar mensaje</span>
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* Reply preview inside bubble estilo WhatsApp */}
                                {m.replyToContent && (
                                  <div className={cn(
                                    "rounded-xl px-3 py-1.5 mb-1.5 border-l-4 text-xs select-none transition-all",
                                    isIncoming
                                      ? "bg-[var(--bg-panel)]/85 border-emerald-500 text-[var(--text-primary)] shadow-2xs"
                                      : "bg-black/25 border-white/85 text-white shadow-2xs"
                                  )}>
                                    <p className={cn(
                                      "font-extrabold text-[10px] uppercase tracking-wider mb-0.5",
                                      isIncoming 
                                        ? (m.replyToDirection === 'OUT' ? "text-[var(--accent)]" : "text-emerald-600 dark:text-emerald-400")
                                        : "text-white font-black"
                                    )}>
                                      {m.replyToDirection === 'IN' ? (getSessionDisplayName(activeSession) || 'Cliente') : 'Tú'}
                                    </p>
                                    <p className={cn(
                                      "line-clamp-2 text-[11px] font-medium leading-snug",
                                      isIncoming ? "text-[var(--text-secondary)]" : "text-white/85"
                                    )}>
                                      {m.replyToContent}
                                    </p>
                                  </div>
                                )}

                                {m.messageType === 'image' ? (
                                  <WhatsAppMedia mediaId={m.content || ''} type="image" />
                                ) : m.messageType === 'video' ? (
                                  <WhatsAppMedia mediaId={m.content || ''} type="video" />
                                ) : m.messageType === 'audio' ? (
                                  <WhatsAppMedia mediaId={m.content || ''} type="audio" />
                                ) : m.messageType === 'document' ? (
                                  <WhatsAppDocument mediaId={m.content || ''} />
                                ) : (m.messageType === 'location' || (m.content && (m.content.includes('📍 Ubicación') || m.content.toLowerCase().includes('location') || m.content.includes('maps.google.com')))) ? (
                                  <div className="space-y-2 p-1.5 min-w-[200px]">
                                    <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-extrabold text-xs">
                                      <MapPin className="h-4 w-4 shrink-0 text-emerald-500 animate-bounce" />
                                      <span>Ubicación GPS Compartida</span>
                                    </div>
                                    {(() => {
                                      const mapsMatch = (m.content || '').match(/https?:\/\/[^\s]+/)
                                      const mapsUrl = mapsMatch ? mapsMatch[0] : null
                                      const cleanText = (m.content || '').replace(/https?:\/\/[^\s]+/, '').replace(/\[Mensaje de WhatsApp: location\]/i, '').trim()
                                      return (
                                        <div className="space-y-2">
                                          {cleanText && (
                                            <p className="text-[11px] font-medium opacity-90">
                                              {cleanText}
                                            </p>
                                          )}
                                          {mapsUrl ? (
                                            <a 
                                              href={mapsUrl} 
                                              target="_blank" 
                                              rel="noopener noreferrer" 
                                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500 text-white font-extrabold text-[11px] hover:bg-emerald-600 transition-colors shadow-sm cursor-pointer"
                                            >
                                              <MapPin className="h-3.5 w-3.5" />
                                              <span>Abrir en Google Maps / Waze</span>
                                              <ExternalLink className="h-3 w-3 ml-0.5" />
                                            </a>
                                          ) : (
                                            <p className="text-[10px] text-amber-500 font-semibold">Ubicación GPS compartida por el cliente</p>
                                          )}
                                        </div>
                                      )
                                    })()}
                                  </div>
                                ) : (
                                  <p className={cn(
                                    "text-[12px] leading-relaxed whitespace-pre-wrap break-words font-medium pr-6 sm:pr-7",
                                    m.status === 'deleted' || m.content === '🚫 Este mensaje fue eliminado' ? "italic opacity-70 flex items-center gap-1 text-slate-400" : ""
                                  )}>
                                    {formatTemplateContent(m.content || '')}
                                  </p>
                                )}

                                {/* Insignia de Reacción de WhatsApp (ej: ❤️, 👍, 😂, 🔥) */}
                                {m.reaction && (
                                  <div className={cn(
                                    "absolute -bottom-2 z-30 px-1.5 py-0.5 rounded-full bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-xs shadow-md animate-in zoom-in-75 duration-200 select-none",
                                    isIncoming ? "left-2" : "right-2"
                                  )}>
                                    {m.reaction}
                                  </div>
                                )}
                                <span className={`text-[10px] font-mono text-right ${
                                  isIncoming ? 'text-[var(--text-muted)]' : 'text-[var(--accent-fg)]/70'
                                } flex items-center justify-end gap-1.5 mt-1`}>
                                  {m.isEdited && m.status !== 'deleted' && m.content !== '🚫 Este mensaje fue eliminado' && (
                                    <span className="text-[9px] font-sans italic opacity-85">Editado</span>
                                  )}
                                  {!isIncoming && (
                                    <MessageStatus 
                                      status={m.status} 
                                      direction={m.direction} 
                                      onRetry={() => handleRetryFailedMessage(m)} 
                                    />
                                  )}
                                  {formatMessageTime(m.createdAt)}
                                </span>
                              </div>
                            </div>
                          </div>
                        )
                      })
                    })()}
                    {/* Indicador de que alguien está escribiendo en tiempo real */}
                    {(() => {
                      const typing = typingUsers[activeSession.id]
                      if (!typing || typing.userId === user?.id || Date.now() - typing.timestamp > 3500) return null
                      return (
                        <div className="flex items-center gap-2 px-3.5 py-2 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-2xl w-fit text-[var(--accent)] text-xs font-bold animate-pulse my-2 shadow-sm">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--accent)]"></span>
                          </span>
                          <span>✍️ {typing.userName} está escribiendo...</span>
                        </div>
                      )
                    })()}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* CHAT INPUT FORM & PERMISSION BANNERS */}
              {(() => {
                const isAdmin = ['ADMIN', 'SUPERADMIN'].includes(user?.role || '')

                if (isAdmin) {
                  if (activeAssignedInfo.isAssigned && !activeAssignedInfo.isMine) {
                    return (
                      <div className="bg-blue-500/10 border-t border-blue-500/20 px-2.5 sm:px-4 py-1.5 sm:py-2 flex items-center justify-between gap-2 text-blue-600 dark:text-blue-400 text-[11px] sm:text-xs font-medium shrink-0 animate-in fade-in duration-150">
                        <span className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
                          <Shield className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                          <span className="truncate">Atendido por <strong className="underline ml-0.5">{activeAssignedInfo.assignedName}</strong>. Puedes responder directamente.</span>
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-xs h-7 px-2 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15 rounded-lg cursor-pointer"
                            onClick={() => handleReleaseSession()}
                            title="Liberar a la cola general"
                          >
                            <UserX className="w-3 h-3 text-amber-500" />
                            <span className="hidden sm:inline ml-1">Soltar</span>
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs h-7 px-2.5 rounded-lg cursor-pointer flex items-center gap-1 shadow-sm"
                            onClick={() => handleClaimSession()}
                            title="Reasignar este chat a mi usuario"
                          >
                            <UserPlus className="w-3 h-3" />
                            <span>Reasignar</span>
                          </Button>
                        </div>
                      </div>
                    )
                  }
                  if (!activeAssignedInfo.isAssigned) {
                    return (
                      <div className="bg-slate-500/10 border-t border-slate-500/20 px-2.5 sm:px-4 py-1.5 sm:py-2 flex items-center justify-between gap-2 text-[var(--text-secondary)] text-[11px] sm:text-xs font-medium shrink-0 animate-in fade-in duration-150">
                        <span className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
                          <Shield className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                          <span className="truncate">Chat sin asignar. Puedes responder libremente.</span>
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-7 px-2.5 rounded-lg cursor-pointer flex items-center gap-1 shadow-sm shrink-0"
                          onClick={() => handleClaimSession()}
                        >
                          <UserPlus className="w-3 h-3" />
                          <span>Reclamar</span>
                        </Button>
                      </div>
                    )
                  }
                  return null
                }

                // Gestoras: manual claim required for taking orders, open for writing
                if (!activeAssignedInfo.isAssigned) {
                  return (
                    <div className="bg-emerald-500/10 border-t border-emerald-500/25 px-2.5 sm:px-4 py-1.5 sm:py-2 flex items-center justify-between gap-2 text-emerald-700 dark:text-emerald-300 text-[11px] sm:text-xs font-semibold shrink-0 animate-in fade-in duration-150">
                      <span className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
                        <UserPlus className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span className="truncate">Chat sin asignar. Reclámalo para <strong>Tomar Pedido</strong>.</span>
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs h-7 px-2.5 rounded-lg cursor-pointer flex items-center gap-1 shadow-sm shrink-0"
                        onClick={() => handleClaimSession()}
                      >
                        <UserPlus className="w-3 h-3" />
                        <span>Reclamar</span>
                      </Button>
                    </div>
                  )
                }

                if (activeAssignedInfo.isAssigned && !activeAssignedInfo.isMine) {
                  return (
                    <div className="bg-amber-500/10 border-t border-amber-500/20 px-2.5 sm:px-4 py-1.5 sm:py-2 flex items-center justify-between gap-2 text-amber-500 text-[11px] sm:text-xs font-semibold shrink-0 animate-in fade-in duration-150">
                      <span className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
                        <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span className="truncate">Atendido por <strong className="text-amber-400">{activeAssignedInfo.assignedName}</strong>.</span>
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        className="bg-amber-500 hover:bg-amber-600 text-black font-extrabold text-xs h-7 px-2.5 rounded-lg cursor-pointer shrink-0"
                        onClick={() => handleClaimSession()}
                      >
                        <UserPlus className="w-3 h-3 mr-1" /> Reclamar
                      </Button>
                    </div>
                  )
                }

                if (activeAssignedInfo.isAssigned && activeAssignedInfo.isMine) {
                  return (
                    <div className="bg-emerald-500/10 border-t border-emerald-500/20 px-2.5 sm:px-4 py-1 sm:py-1.5 flex items-center justify-between gap-2 text-emerald-600 dark:text-emerald-400 text-[11px] sm:text-xs font-medium shrink-0 animate-in fade-in duration-150">
                      <span className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
                        <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                        <span className="truncate">Chat asignado a ti. Control total activo.</span>
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-xs h-6 px-2 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15 rounded-lg cursor-pointer shrink-0"
                        onClick={() => handleReleaseSession()}
                        title="Liberar chat para que otra asesora lo atienda"
                      >
                        <UserX className="w-3 h-3 mr-1 text-amber-500" /> Soltar
                      </Button>
                    </div>
                  )
                }

                return null
              })()}

              {(() => {
                const isAdmin = ['ADMIN', 'SUPERADMIN'].includes(user?.role || '')
                const inputPlaceholder = isAdmin && activeAssignedInfo.isAssigned && !activeAssignedInfo.isMine
                  ? `Respondiendo como Administrador (asignado a ${activeAssignedInfo.assignedName})...`
                  : (!isAdmin && activeAssignedInfo.isAssigned && !activeAssignedInfo.isMine
                    ? `Escribe un mensaje aquí (chat de ${activeAssignedInfo.assignedName})...`
                    : "Escribe un mensaje aquí...")

                return (
                  <ChatInputBar
                    disabled={false}
                    compact={!!embeddedOrder}
                    onSendText={handleSendMessageText}
                    onSendMenuCarta={handleSendMenuCarta}
                    sendingMenu={sendingMenu}
                    onSendPaymentQr={handleSendPaymentQr}
                    sendingPaymentQr={sendingPaymentQr}
                    fileInputRef={fileInputRef}
                    handleFileChange={handleFileChange}
                    onPasteScreenshot={handlePasteScreenshotFromClipboard}
                    uploadingMedia={uploadingMedia}
                    isRecording={isRecording}
                    recordingTime={recordingTime}
                    startRecording={startRecording}
                    stopRecording={stopRecording}
                    cancelRecording={cancelRecording}
                    placeholder={inputPlaceholder}
                    replyingTo={replyingTo}
                    onCancelReply={() => setReplyingTo(null)}
                    onSendLocation={handleSendLocation}
                    sendingLocation={sendingLocation}
                    onTyping={handleTyping}
                    inputRef={chatInputRef}
                  />
                )
              })()}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-secondary)] space-y-4 p-8 bg-[var(--bg-elevated)]/5">
              <div className="h-20 w-20 rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)]/60 flex items-center justify-center shadow-inner">
                <MessageCircle className="h-10 w-10 text-[var(--accent)]" />
              </div>
              <div className="space-y-1.5 text-center max-w-sm">
                <p className="text-sm font-extrabold text-[var(--text-primary)] uppercase tracking-wider">Tablero de Atención WhatsApp</p>
                <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                  Selecciona una conversación del panel de la izquierda para comenzar a responder o tomar pedidos.
                </p>
                <div className="pt-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    Modo Espera Activo · No se marcarán chats en visto
                  </span>
                </div>
              </div>
            </div>
          )}
        </Card>

        {embeddedOrder && (
          <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)] shadow-2xl">
            <React.Suspense fallback={(
              <div className="flex h-full items-center justify-center gap-2 text-xs font-semibold text-[var(--text-secondary)]">
                <Loader2 className="h-5 w-5 animate-spin text-[var(--accent)]" />
                Abriendo pedido...
              </div>
            )}>
              <EmbeddedNewOrderPage
                key={`${embeddedOrder.chatSessionId}:${embeddedOrder.editOrderId || 'new'}`}
                embedded
                embeddedParams={embeddedOrder}
                onClose={() => setEmbeddedOrder(null)}
                onOrderSaved={(savedOrder) => {
                  const orderSummary = {
                    id: savedOrder.id || embeddedOrder.editOrderId || '',
                    orderNumber: savedOrder.orderNumber || 0,
                    status: savedOrder.status || 'PENDING',
                    total: savedOrder.total,
                  }
                  setActiveOrder(savedOrder)
                  setActiveSession(prev => prev ? { ...prev, activeOrder: orderSummary } : prev)
                  setSessions(prev => prev.map(session => session.id === embeddedOrder.chatSessionId
                    ? { ...session, activeOrder: orderSummary }
                    : session
                  ))
                  void loadSessions(undefined, chatSearchRef.current, false, chatFilterRef.current)
                }}
              />
            </React.Suspense>
          </section>
        )}
      </div>

      {/* Modal para Editar Mensaje */}
      <Dialog open={editingMessage !== null} onOpenChange={(open) => !open && setEditingMessage(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-extrabold text-[var(--text-primary)]">
              <Pencil className="h-4 w-4 text-blue-500" />
              Editar Mensaje
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-[var(--text-secondary)] font-medium">
              Modifica el contenido del mensaje seleccionado en el historial:
            </p>
            <Textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={4}
              className="w-full bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl text-xs font-medium focus:border-[var(--accent)]"
              placeholder="Escribe el nuevo contenido..."
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditingMessage(null)}
              className="h-9 text-xs font-bold rounded-xl"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleSaveEditedMessage}
              className="h-9 text-xs font-bold rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)]"
            >
              Guardar Cambios
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal Confirmación de Eliminación de Mensaje */}
      <Dialog open={deletingMessage !== null} onOpenChange={(open) => !open && setDeletingMessage(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-extrabold text-red-500">
              <Trash2 className="h-4 w-4 text-red-500" />
              Eliminar Mensaje
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <p className="text-xs text-[var(--text-primary)] font-medium">
              Selecciona cómo deseas eliminar este mensaje:
            </p>
            {deletingMessage && (
              <div className="p-3 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-secondary)] italic whitespace-pre-wrap break-words max-h-36 overflow-y-auto w-full">
                "{deletingMessage.content}"
              </div>
            )}
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeletingMessage(null)}
              className="h-9 text-xs font-bold rounded-xl"
            >
              Cancelar
            </Button>
            
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleConfirmDeleteMessage('for_me')}
              className="h-9 text-xs font-bold rounded-xl"
            >
              Eliminar para mí
            </Button>

            {(deletingMessage?.direction === 'OUT' || deletingMessage?.direction !== 'IN') && (
              <Button
                type="button"
                onClick={() => handleConfirmDeleteMessage('for_everyone')}
                className="h-9 text-xs font-bold rounded-xl bg-red-600 hover:bg-red-700 text-white"
              >
                Eliminar para todos
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal para Reenviar Mensaje */}
      <Dialog open={forwardingMessage !== null} onOpenChange={(open) => !open && setForwardingMessage(null)}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col p-0 overflow-hidden rounded-2xl">
          <DialogHeader className="p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)]">
            <DialogTitle className="flex items-center gap-2 text-base font-extrabold text-[var(--text-primary)]">
              <Forward className="h-4 w-4 text-emerald-500" />
              Reenviar Mensaje a WhatsApp
            </DialogTitle>
          </DialogHeader>

          <div className="p-4 space-y-3 flex-1 overflow-hidden flex flex-col">
            {forwardingMessage && (
              <div className="p-2.5 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl text-xs text-[var(--text-secondary)] italic max-h-20 overflow-y-auto">
                <span className="font-bold not-italic text-[var(--text-primary)] block text-[10px] uppercase mb-0.5">Mensaje a reenviar:</span>
                {forwardingMessage.content}
              </div>
            )}

            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-[var(--text-muted)]" />
              <Input
                placeholder="Buscar por nombre o celular en toda la base de datos..."
                value={forwardSearch}
                onChange={(e) => setForwardSearch(e.target.value)}
                className="pl-9 pr-8 h-9 text-xs rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)]"
              />
              {loadingForwardSearch && (
                <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-[var(--accent)]" />
              )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-1 pr-1 max-h-[320px]">
              {(() => {
                const rawSearch = forwardSearch.trim()
                const searchLower = rawSearch.toLowerCase()
                const searchDigits = rawSearch.replace(/\D/g, '')
                const isCallableDigits = searchDigits.length >= 7

                const seenIds = new Set<string>()
                const combinedList: Session[] = []

                // 1. Resultados directos de búsqueda global en servidor (7,000+ chats)
                for (const s of forwardSearchResults) {
                  if (!seenIds.has(s.id)) {
                    seenIds.add(s.id)
                    combinedList.push(s)
                  }
                }

                // 2. Sesiones locales en memoria
                for (const s of sessions) {
                  if (!seenIds.has(s.id)) {
                    const matchName = s.customerName && s.customerName.toLowerCase().includes(searchLower)
                    const matchPhone = (s.phone || '').includes(searchLower) || (s.customerPhone || '').includes(searchLower)
                    if (!rawSearch || matchName || matchPhone) {
                      seenIds.add(s.id)
                      combinedList.push(s)
                    }
                  }
                }

                return (
                  <div className="space-y-1.5">
                    {/* Botón directo si escribió un número de teléfono (>= 7 dígitos) */}
                    {isCallableDigits && (
                      <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/25 rounded-xl flex items-center justify-between gap-3 mb-2">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <Forward className="h-3.5 w-3.5" /> Reenviar a este número
                          </p>
                          <p className="text-[11px] font-mono text-[var(--text-secondary)] truncate mt-0.5">
                            📱 {searchDigits.length === 12 && searchDigits.startsWith('57') ? searchDigits.slice(2) : searchDigits}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          disabled={Boolean(sendingForward)}
                          onClick={() => handleForwardMessageToPhone(searchDigits.length === 12 && searchDigits.startsWith('57') ? searchDigits.slice(2) : searchDigits)}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-8 px-3 rounded-lg text-xs shrink-0 shadow-sm cursor-pointer"
                        >
                          {sendingForward === 'new' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <span>Enviar</span>
                          )}
                        </Button>
                      </div>
                    )}

                    {combinedList.length === 0 && !isCallableDigits && !loadingForwardSearch && (
                      <div className="p-6 text-center text-xs text-[var(--text-muted)]">
                        No se encontraron contactos para "{forwardSearch}". <br/>
                        <span className="opacity-75 block mt-1">Escribe un nombre o un número de celular para buscar o enviarlo directamente.</span>
                      </div>
                    )}

                    {combinedList.slice(0, 50).map(s => {
                      const isSendingThis = sendingForward === s.id
                      const isPhoneAsName = !s.customerName || /^\+?\d+$/.test(s.customerName.trim())
                      const cleanPhone = (s.phone || '').replace(/^57/, '')
                      const displayName = !isPhoneAsName ? s.customerName : (cleanPhone || s.phone || 'Cliente')
                      const initials = displayName
                        ? displayName.replace(/^@/, '').trim().split(/\s+/).filter(Boolean).map((n: string) => n[0] || '').join('').substring(0, 2).toUpperCase()
                        : null

                      return (
                        <div 
                          key={s.id}
                          className="flex items-center justify-between p-2.5 hover:bg-[var(--bg-hover)] rounded-xl transition-colors border border-transparent hover:border-[var(--border-subtle)]"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar className="h-8 w-8 rounded-full border border-[var(--border-subtle)] shrink-0">
                              <AvatarFallback className="bg-[var(--accent)] text-white text-[10px] font-black">
                                {initials || <User className="h-3.5 w-3.5" />}
                              </AvatarFallback>
                            </Avatar>
                            <div className="truncate">
                              <p className="text-xs font-bold text-[var(--text-primary)] truncate">{displayName}</p>
                              <p className="text-[10px] text-[var(--text-muted)] font-mono">{(s.phone || '').replace(/^57/, '')}</p>
                            </div>
                          </div>

                          <Button
                            type="button"
                            size="sm"
                            disabled={Boolean(sendingForward)}
                            onClick={() => handleForwardMessageToSession(s)}
                            className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shrink-0 flex items-center gap-1.5 shadow-sm cursor-pointer"
                          >
                            {isSendingThis ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Forward className="h-3.5 w-3.5" />
                            )}
                            <span>Reenviar</span>
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal de Validación / Vista Previa de Imagen pegada (estilo WhatsApp Web) */}
      <Dialog open={pendingMedia !== null} onOpenChange={(open) => !open && handleCancelSendMedia()}>
        <DialogContent className="max-w-md p-0 overflow-hidden bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-3xl shadow-2xl flex flex-col">
          <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-panel)]">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-full bg-emerald-500/15 text-emerald-600 flex items-center justify-center font-bold text-sm shrink-0">
                📷
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-black text-[var(--text-primary)]">Enviar imagen a WhatsApp</h3>
                <p className="text-[11px] text-[var(--text-secondary)] truncate">
                  Cliente: <strong className="text-[var(--text-primary)]">{activeSession?.customerName || activeSession?.phone}</strong>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleCancelSendMedia}
              className="p-1.5 rounded-xl hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Vista previa de la captura */}
          <div className="p-4 bg-slate-950/40 flex items-center justify-center min-h-[220px] max-h-[380px] overflow-hidden">
            {pendingMedia && (
              <img
                src={pendingMedia.previewUrl}
                alt="Vista previa captura"
                className="max-h-[350px] max-w-full object-contain rounded-xl shadow-lg border border-[var(--border-subtle)]"
              />
            )}
          </div>

          {/* Pie de foto / Comentario y Botón de Enviar */}
          <div className="p-4 bg-[var(--bg-panel)] space-y-3">
            <div className="relative flex items-center">
              <Input
                autoFocus
                value={pendingMedia?.caption || ''}
                onChange={(e) => setPendingMedia(prev => prev ? { ...prev, caption: e.target.value } : null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void handleConfirmSendMedia()
                  }
                }}
                placeholder="Escribe un mensaje o pie de foto (opcional)..."
                className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-default)] text-xs text-[var(--text-primary)] pr-12"
              />
              <button
                type="button"
                onClick={handleConfirmSendMedia}
                disabled={uploadingMedia}
                className="absolute right-1.5 h-8 w-8 rounded-lg bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white flex items-center justify-center shadow-md cursor-pointer transition disabled:opacity-50"
                title="Enviar por WhatsApp"
              >
                {uploadingMedia ? <Loader2 className="h-4 w-4 animate-spin text-white" /> : <Send className="h-4 w-4" />}
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
              <span>Presiona <b>Enter ↵</b> para enviar</span>
              <button
                type="button"
                onClick={handleCancelSendMedia}
                className="hover:underline text-[var(--text-secondary)] cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  )
}

class ChatPageErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  state = { hasError: false, error: null }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error }
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('ChatPage caught error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-[70vh] p-6 text-center space-y-4">
          <div className="p-4 rounded-full bg-rose-500/10 text-rose-500">
            <AlertTriangle className="h-10 w-10" />
          </div>
          <h2 className="text-lg font-bold text-[var(--text-primary)]">Ocurrió un error temporal al cargar el chat</h2>
          <p className="text-xs text-[var(--text-secondary)] max-w-md">
            No te preocupes. Haz clic en el botón de abajo para restablecer la vista de WhatsApp de forma segura.
          </p>
          <div className="flex items-center gap-3">
            <Button
              onClick={() => {
                this.setState({ hasError: false, error: null })
              }}
              variant="outline"
              className="text-xs font-bold px-4 py-2 rounded-xl cursor-pointer"
            >
              Reintentar
            </Button>
            <Button
              onClick={() => {
                try {
                  localStorage.removeItem('villa_dog_last_active_whatsapp_session_id')
                  localStorage.removeItem('niche_last_active_whatsapp_session_id')
                } catch(e){}
                window.location.href = '/chat'
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-xl cursor-pointer"
            >
              🔄 Restablecer Chat de WhatsApp
            </Button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function ChatPageWrapper() {
  return (
    <ChatPageErrorBoundary>
      <ChatPage />
    </ChatPageErrorBoundary>
  )
}
