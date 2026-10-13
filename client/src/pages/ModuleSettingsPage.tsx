import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  BadgeCheck,
  BarChart3,
  Bike,
  Bot,
  ChefHat,
  CheckCircle2,
  Clock3,
  CreditCard,
  Download,
  Edit2,
  ExternalLink,
  Image as ImageIcon,
  LayoutDashboard,
  Link2,
  Loader2,
  Lock,
  MapPin,
  MessageCircle,
  MonitorSmartphone,
  Package,
  PackagePlus,
  Plus,
  PlusCircle,
  Printer,
  QrCode,
  RotateCcw,
  Save,
  ScrollText,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Tablet,
  Trash2,
  Upload,
  Users,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { alerts } from '@/lib/alerts'
import { api } from '@/lib/api'
import { io } from '@/lib/socket'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import {
  allNavItems,
  getHiddenModules,
  hasNavItemAccess,
  saveHiddenModules,
} from '@/lib/navigation'
import type { ModuleVisibilityResponse } from '@/lib/moduleVisibility'

interface ModuleDef {
  id: string
  name: string
  description: string
  icon: LucideIcon
  section: string
  isPermanent?: boolean
}

interface WhatsappSettings {
  chatbotEnabled: boolean
  orderReaderEnabled: boolean
  businessHoursEnabled: boolean
  outOfServiceMessage: string
  restaurantHours: string
  digitalMenuUrl: string
  menuShareMessage: string
  menuText: string
  paymentQrMode: 'IMAGE' | 'ACCOUNT'
  paymentAccountText: string
  paymentQrName?: string | null
  paymentQrCaption: string
}

type KitchenChannel = 'DINING' | 'DELIVERY' | 'BOTH'
type DeliveryKitchenMode = 'PRINT' | 'TABLET' | 'BOTH'

interface KitchenSettings {
  smartDrinkRouting: boolean
  splitByChannel: boolean
  multiStationDrinkTarget: string
  deliveryKitchenMode: DeliveryKitchenMode
  deliveryAutoPrint: boolean
  stationChannels: Record<string, KitchenChannel>
}

interface KitchenStation {
  id: string
  name: string
  active: boolean
  color?: string
  priority?: number
  categories?: Array<{ id: string; name: string }>
  users?: KitchenUser[]
}

interface KitchenUser {
  id: string
  name: string
  role: string
  active?: boolean
}

interface CookStatus {
  active?: boolean
  onBreak?: boolean
  breakUntil?: number | null
  breakMinutes?: number
  breakReason?: string
}

interface DeliveryStationDraft {
  id?: string
  name: string
  color: string
  active: boolean
  categoryIds: string[]
  userIds: string[]
}

interface PrinterConfig {
  id: string
  name: string
  mode?: string
  ip: string
  port: number
  paper: string
  categories?: string[]
  type?: string
  enabled?: boolean
  channel?: KitchenChannel
}

interface PrinterSettings {
  autoPrint?: boolean
  printers: PrinterConfig[]
}

type SettingsTab = 'MODULES' | 'WHATSAPP' | 'DELIVERY_KITCHEN'

const MODULE_DEFINITIONS: ModuleDef[] = [
  { id: 'tables', name: 'Mesas abiertas', description: 'Cuentas activas y cobros del salón.', icon: UtensilsCrossed, section: 'Salón' },
  { id: 'tables_new', name: 'Nuevo pedido de mesa', description: 'Toma rápida de pedidos del salón.', icon: PlusCircle, section: 'Salón' },
  { id: 'tables_history', name: 'Historial de mesas', description: 'Cuentas y pedidos cerrados del salón.', icon: ScrollText, section: 'Salón' },
  { id: 'dispatch', name: 'Despachos activos', description: 'Asignación de domiciliarios y entregas.', icon: Bike, section: 'Domicilios' },
  { id: 'orders_new', name: 'Nuevo domicilio', description: 'Toma manual de pedidos para entrega o recogida.', icon: PlusCircle, section: 'Domicilios' },
  { id: 'orders_history', name: 'Historial de domicilios', description: 'Consulta de pedidos y entregas.', icon: ScrollText, section: 'Domicilios' },
  { id: 'kitchen', name: 'Cocina en vivo', description: 'Comandas en preparación y listas.', icon: ChefHat, section: 'Cocina' },
  { id: 'kitchen_stations', name: 'Estaciones de cocina', description: 'Áreas, categorías y cocineros.', icon: ChefHat, section: 'Cocina' },
  { id: 'cash_registers', name: 'Cajas registradoras', description: 'Cajas y asignación de cajeros.', icon: Wallet, section: 'Caja' },
  { id: 'cash_control', name: 'Control de caja', description: 'Aperturas, gastos, arqueos y cierres.', icon: BarChart3, section: 'Caja' },
  { id: 'payment_validation', name: 'Validar pagos', description: 'Revisión de comprobantes de transferencia.', icon: BadgeCheck, section: 'Caja' },
  { id: 'whatsapp', name: 'WhatsApp', description: 'Atención de chats y toma de pedidos.', icon: MessageCircle, section: 'Gestión' },
  { id: 'customers', name: 'Clientes', description: 'Directorio de clientes y direcciones.', icon: Users, section: 'Gestión' },
  { id: 'drivers', name: 'Domiciliarios', description: 'Historial por repartidor, entregas y liquidaciones.', icon: Bike, section: 'Gestión' },
  { id: 'products', name: 'Productos y menú', description: 'Carta, precios, categorías y recetas.', icon: PackagePlus, section: 'Gestión' },
  { id: 'zones', name: 'Barrios y tarifas', description: 'Zonas de entrega y valor del domicilio.', icon: MapPin, section: 'Gestión' },
  { id: 'dashboard', name: 'Inicio y métricas', description: 'Resumen de ventas y operación.', icon: LayoutDashboard, section: 'Principal' },
  { id: 'users', name: 'Usuarios y roles', description: 'Personal, permisos y accesos.', icon: Users, section: 'Administración' },
  { id: 'settings', name: 'Configuración', description: 'Ajustes operativos del sistema.', icon: Settings, section: 'Administración', isPermanent: true },
]

const fieldClass = 'h-10 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10'
const textAreaClass = 'min-h-24 w-full resize-y rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10'

const defaultWhatsappSettings = (): WhatsappSettings => ({
  chatbotEnabled: false,
  orderReaderEnabled: false,
  businessHoursEnabled: false,
  outOfServiceMessage: '¡Hola! En este momento estamos cerrados. Volvemos a atender desde las {abre}.',
  restaurantHours: '12:00 - 23:00',
  digitalMenuUrl: '',
  menuShareMessage: '🍽️ *CARTA DIGITAL THE VILLA DOG*\n\nMira nuestra carta actualizada y arma tu pedido aquí:',
  menuText: '📋 *MENÚ Y PRECIOS VILLA DOG*\n\nLa carta se generará automáticamente desde Productos y Menú.',
  paymentQrMode: 'ACCOUNT',
  paymentAccountText: '',
  paymentQrCaption: '',
})

const toTimeInput = (value: string, fallback: string) => {
  const match = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i)
  if (!match) return fallback
  let hour = Number(match[1])
  const minute = Number(match[2] || 0)
  const period = (match[3] || '').replace(/\./g, '').toLowerCase()
  if (period === 'pm' && hour < 12) hour += 12
  if (period === 'am' && hour === 12) hour = 0
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return fallback
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

interface MetaConnectionTestResult {
  success: boolean
  message: string
  displayPhoneNumber?: string
  verifiedName?: string
  qualityRating?: string
  status?: string
  hint?: string
}

const parseRestaurantSchedule = (value: string) => {
  const [opening, closing] = String(value || '').split('-').map(part => part.trim())
  return { openingTime: toTimeInput(opening, '12:00'), closingTime: toTimeInput(closing, '23:00') }
}

const defaultKitchenSettings: KitchenSettings = {
  smartDrinkRouting: false,
  splitByChannel: true,
  multiStationDrinkTarget: 'none',
  deliveryKitchenMode: 'PRINT',
  deliveryAutoPrint: true,
  stationChannels: {},
}

const getErrorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback



export default function ModuleSettingsPage() {
  const { user } = useAuth()
  const activeSiteId = user?.activeSite?.id
  const preparationMode = user?.activeSite?.preparationMode === true
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => preparationMode ? 'WHATSAPP' : 'MODULES')
  const [hiddenModules, setHiddenModules] = useState<string[]>(() => getHiddenModules(activeSiteId))
  const [loadingOperations, setLoadingOperations] = useState(true)
  const [savingSection, setSavingSection] = useState<SettingsTab | null>(null)
  const [savingModules, setSavingModules] = useState(false)
  const [downloadingBridge, setDownloadingBridge] = useState(false)
  const [uploadingQr, setUploadingQr] = useState(false)
  const [testingPrinterId, setTestingPrinterId] = useState<string | null>(null)
  const [clearingQueue, setClearingQueue] = useState(false)
  const [whatsapp, setWhatsapp] = useState<WhatsappSettings>(() => defaultWhatsappSettings())
  const [restaurantSchedule, setRestaurantSchedule] = useState(() => parseRestaurantSchedule(defaultWhatsappSettings().restaurantHours))
  const [kitchen, setKitchen] = useState<KitchenSettings>(defaultKitchenSettings)
  const [stations, setStations] = useState<KitchenStation[]>([])
  const [printing, setPrinting] = useState<PrinterSettings>({ printers: [] })
  const [menuCategories, setMenuCategories] = useState<Array<{ id: string; name: string }>>([])
  const [kitchenUsers, setKitchenUsers] = useState<KitchenUser[]>([])
  const [deliveryCookStatuses, setDeliveryCookStatuses] = useState<Record<string, CookStatus>>({})
  const [stationDraft, setStationDraft] = useState<DeliveryStationDraft | null>(null)
  const [savingStation, setSavingStation] = useState(false)
  const [busyCookId, setBusyCookId] = useState<string | null>(null)
  const [clockNow, setClockNow] = useState(Date.now())
  const [regeneratingMenu, setRegeneratingMenu] = useState(false)
  const [testingMeta, setTestingMeta] = useState(false)
  const [metaTestResult, setMetaTestResult] = useState<MetaConnectionTestResult | null>(null)

  useEffect(() => {
    const syncModules = () => setHiddenModules(getHiddenModules(activeSiteId))
    syncModules()
    window.addEventListener('storage', syncModules)
    window.addEventListener('the-villa-dog-modules-changed', syncModules)
    return () => {
      window.removeEventListener('storage', syncModules)
      window.removeEventListener('the-villa-dog-modules-changed', syncModules)
    }
  }, [activeSiteId])

  const accessibleModules = useMemo(
    () => MODULE_DEFINITIONS.filter(def => allNavItems.some(item => item.module === def.id && hasNavItemAccess(user, item))),
    [user],
  )

  const groupedModules = useMemo(() => {
    const groups = new Map<string, ModuleDef[]>()
    accessibleModules.forEach(module => groups.set(module.section, [...(groups.get(module.section) || []), module]))
    return [...groups.entries()]
  }, [accessibleModules])

  const deliveryStations = useMemo(() => stations.filter(station => {
    const configured = kitchen.stationChannels[station.id]
    if (configured) return configured === 'DELIVERY'
    return /domicilio/i.test(station.name)
  }), [kitchen.stationChannels, stations])

  const deliveryPrinters = useMemo(() => printing.printers.filter(printer => {
    const channel = printer.channel || (/domicilio/i.test(printer.name) ? 'DELIVERY' : 'DINING')
    return channel === 'DELIVERY' || channel === 'BOTH'
  }), [printing.printers])

  const availableKitchenUsers = useMemo(() => kitchenUsers
    .filter(candidate => candidate.active !== false && candidate.role === 'KITCHEN')
    .sort((a, b) => a.name.localeCompare(b.name)), [kitchenUsers])

  useEffect(() => {
    let active = true
    Promise.all([
      api.get<Partial<WhatsappSettings>>('/whatsapp/settings').catch(() => null),
      api.get<Partial<KitchenSettings>>('/kitchen/settings').catch(() => null),
      api.get<KitchenStation[]>('/kitchen/stations').catch(() => []),
      api.get<PrinterSettings>('/print/settings').catch(() => null),
      api.get<Array<{ id: string; name: string }>>('/menu/categories?includeInactive=true').catch(() => []),
      api.get<KitchenUser[]>('/users').catch(() => []),
      preparationMode
        ? Promise.resolve({} as Record<string, CookStatus>)
        : api.get<Record<string, CookStatus>>('/kitchen/delivery/cooks/status').catch(() => ({})),
    ]).then(([wa, kitchenSettings, stationRows, printerSettings, categoryRows, userRows, cookStatuses]) => {
      if (!active) return
      if (wa) {
        const fallback = defaultWhatsappSettings()
        let digitalMenuUrl = wa.digitalMenuUrl !== undefined
          ? String(wa.digitalMenuUrl || '')
          : fallback.digitalMenuUrl
        if (!window.location.hostname.includes('localhost') && /localhost|127\.0\.0\.1/.test(digitalMenuUrl)) {
          digitalMenuUrl = fallback.digitalMenuUrl
        }
        setWhatsapp({
          chatbotEnabled: wa.chatbotEnabled === true,
          orderReaderEnabled: wa.orderReaderEnabled === true,
          businessHoursEnabled: wa.businessHoursEnabled === true,
          outOfServiceMessage: wa.outOfServiceMessage || fallback.outOfServiceMessage,
          restaurantHours: wa.restaurantHours || fallback.restaurantHours,
          digitalMenuUrl,
          menuShareMessage: wa.menuShareMessage || fallback.menuShareMessage,
          menuText: wa.menuText || fallback.menuText,
          paymentQrMode: wa.paymentQrMode === 'IMAGE' ? 'IMAGE' : 'ACCOUNT',
          paymentAccountText: wa.paymentAccountText || '',
          paymentQrName: wa.paymentQrName || null,
          paymentQrCaption: wa.paymentQrCaption || '',
        })
        setRestaurantSchedule(parseRestaurantSchedule(wa.restaurantHours || fallback.restaurantHours))
      }
      if (kitchenSettings) {
        const deliveryKitchenMode = kitchenSettings.deliveryKitchenMode
        setKitchen({
          ...defaultKitchenSettings,
          ...kitchenSettings,
          deliveryKitchenMode: deliveryKitchenMode && ['PRINT', 'TABLET', 'BOTH'].includes(deliveryKitchenMode)
            ? deliveryKitchenMode
            : 'PRINT',
          stationChannels: kitchenSettings.stationChannels || {},
        })
      }
      setStations(stationRows || [])
      if (printerSettings) setPrinting({ ...printerSettings, printers: printerSettings.printers || [] })
      setMenuCategories(categoryRows || [])
      setKitchenUsers(userRows || [])
      setDeliveryCookStatuses(cookStatuses || {})
    }).finally(() => {
      if (active) setLoadingOperations(false)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (preparationMode) return
    const timer = window.setInterval(() => setClockNow(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [preparationMode])

  useEffect(() => {
    if (!user?.id || preparationMode) return
    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, { transports: ['websocket', 'polling'] })
    socket.on('whatsappSettingsUpdated', (updated: Partial<WhatsappSettings>) => {
      setWhatsapp(current => ({
        ...current,
        ...(typeof updated?.chatbotEnabled === 'boolean' ? { chatbotEnabled: updated.chatbotEnabled } : {}),
        ...(typeof updated?.orderReaderEnabled === 'boolean' ? { orderReaderEnabled: updated.orderReaderEnabled } : {}),
        ...(typeof updated?.businessHoursEnabled === 'boolean' ? { businessHoursEnabled: updated.businessHoursEnabled } : {}),
        ...(updated?.outOfServiceMessage !== undefined ? { outOfServiceMessage: updated.outOfServiceMessage } : {}),
        ...(updated?.restaurantHours !== undefined ? { restaurantHours: updated.restaurantHours } : {}),
        ...(updated?.digitalMenuUrl !== undefined ? { digitalMenuUrl: updated.digitalMenuUrl } : {}),
        ...(updated?.menuShareMessage ? { menuShareMessage: updated.menuShareMessage } : {}),
        ...(updated?.menuText !== undefined ? { menuText: updated.menuText } : {}),
        ...(updated?.paymentQrMode ? { paymentQrMode: updated.paymentQrMode } : {}),
        ...(updated?.paymentAccountText !== undefined ? { paymentAccountText: updated.paymentAccountText } : {}),
        ...(updated?.paymentQrCaption !== undefined ? { paymentQrCaption: updated.paymentQrCaption } : {}),
      }))
      if (updated?.restaurantHours !== undefined) setRestaurantSchedule(parseRestaurantSchedule(updated.restaurantHours))
    })
    socket.on('kitchenSettingsUpdated', (updated: KitchenSettings) => setKitchen(current => ({ ...current, ...updated })))
    socket.on('printerSettingsUpdated', (updated: PrinterSettings) => setPrinting({ ...updated, printers: updated.printers || [] }))
    socket.on('deliveryKitchenCookStatusChanged', (updated: Record<string, CookStatus>) => setDeliveryCookStatuses(updated || {}))
    socket.on('kitchenStationsChanged', () => {
      api.get<KitchenStation[]>('/kitchen/stations').then(rows => setStations(rows || [])).catch(() => {})
    })
    return () => { socket.disconnect() }
  }, [preparationMode, user?.id])

  const persistModules = async (next: string[], successMessage?: string) => {
    if (savingModules) return
    const previous = hiddenModules
    const sanitized = next.filter(id => id !== 'settings' && id !== 'superadmin')
    setHiddenModules(sanitized)
    setSavingModules(true)
    try {
      const updated = await api.put<ModuleVisibilityResponse>('/site-settings/module-visibility', {
        hiddenModules: sanitized,
      })
      const saved = saveHiddenModules(updated.hiddenModules, activeSiteId)
      setHiddenModules(saved)
      if (successMessage) alerts.toast(successMessage)
    } catch (error: unknown) {
      setHiddenModules(previous)
      alerts.error('No se guardaron los módulos', getErrorMessage(error, 'Inténtalo nuevamente.'))
    } finally {
      setSavingModules(false)
    }
  }

  const toggleModule = (moduleId: string) => {
    if (savingModules) return
    if (moduleId === 'settings' || moduleId === 'superadmin') {
      alerts.warning('Módulo permanente', 'Configuración debe permanecer visible.')
      return
    }
    const next = hiddenModules.includes(moduleId)
      ? hiddenModules.filter(id => id !== moduleId)
      : [...hiddenModules, moduleId]
    void persistModules(next)
  }

  const showAll = () => {
    void persistModules([], 'Todos los módulos están visibles en esta sede')
  }

  const useSalonMode = () => {
    const essentials = ['tables', 'tables_new', 'tables_history', 'kitchen', 'cash_registers', 'cash_control', 'settings', 'dashboard']
    void persistModules(
      accessibleModules.filter(module => !essentials.includes(module.id) && !module.isPermanent).map(module => module.id),
      'Vista de salón aplicada a esta sede',
    )
  }

  const saveWhatsapp = async () => {
    const menuUrl = whatsapp.digitalMenuUrl.trim()
    if (menuUrl && !/^https?:\/\//i.test(menuUrl)) {
      alerts.warning('Enlace incompleto', 'La dirección de la carta debe comenzar por http:// o https://.')
      return
    }
    setSavingSection('WHATSAPP')
    try {
      const updated = await api.put<WhatsappSettings>('/whatsapp/settings', {
        chatbotEnabled: whatsapp.chatbotEnabled,
        orderReaderEnabled: whatsapp.orderReaderEnabled,
        businessHoursEnabled: whatsapp.businessHoursEnabled,
        outOfServiceMessage: whatsapp.outOfServiceMessage.trim(),
        restaurantHours: `${restaurantSchedule.openingTime} - ${restaurantSchedule.closingTime}`,
        digital_menu_url: menuUrl,
        menuShareMessage: whatsapp.menuShareMessage,
        menuText: whatsapp.menuText,
        paymentQrMode: whatsapp.paymentQrMode,
        paymentAccountText: whatsapp.paymentAccountText,
        paymentQrCaption: whatsapp.paymentQrCaption,
      })
      setWhatsapp(current => ({
        ...current,
        chatbotEnabled: updated.chatbotEnabled === true,
        orderReaderEnabled: updated.orderReaderEnabled === true,
        businessHoursEnabled: updated.businessHoursEnabled === true,
        outOfServiceMessage: updated.outOfServiceMessage || current.outOfServiceMessage,
        restaurantHours: updated.restaurantHours || `${restaurantSchedule.openingTime} - ${restaurantSchedule.closingTime}`,
        digitalMenuUrl: updated.digitalMenuUrl !== undefined ? updated.digitalMenuUrl : (menuUrl || current.digitalMenuUrl),
        menuShareMessage: updated.menuShareMessage || current.menuShareMessage,
        menuText: updated.menuText || current.menuText,
        paymentQrMode: updated.paymentQrMode === 'IMAGE' ? 'IMAGE' : 'ACCOUNT',
        paymentAccountText: updated.paymentAccountText || '',
        paymentQrName: updated.paymentQrName || current.paymentQrName,
        paymentQrCaption: updated.paymentQrCaption || '',
      }))
      setRestaurantSchedule(parseRestaurantSchedule(updated.restaurantHours || `${restaurantSchedule.openingTime} - ${restaurantSchedule.closingTime}`))
      alerts.success('Configuración guardada', 'WhatsApp, carta y cobros quedaron sincronizados.')
    } catch (error: unknown) {
      alerts.error('No se pudo guardar', getErrorMessage(error, 'Inténtalo nuevamente.'))
    } finally {
      setSavingSection(null)
    }
  }

  const testMetaConnection = async () => {
    setTestingMeta(true)
    setMetaTestResult(null)
    try {
      const result = await api.post<MetaConnectionTestResult>('/whatsapp/test-meta', {})
      setMetaTestResult(result)
      if (result.success) {
        alerts.success('Conexión Meta verificada', result.message)
      } else {
        alerts.error('Meta rechazó la conexión', result.hint ? `${result.message} ${result.hint}` : result.message)
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'No se pudo comprobar la conexión con Meta.')
      setMetaTestResult({ success: false, message })
      alerts.error('No se pudo probar Meta', message)
    } finally {
      setTestingMeta(false)
    }
  }

  const regenerateMenu = async () => {
    setRegeneratingMenu(true)
    try {
      const res = await api.post<{ ok: boolean; menuText: string }>('/whatsapp/settings/regenerate-menu-text')
      if (res?.menuText) {
        setWhatsapp(current => ({ ...current, menuText: res.menuText }))
        alerts.success('Carta sincronizada', 'El texto se generó a partir de los productos y precios actuales del catálogo.')
      }
    } catch (error: unknown) {
      alerts.error('Error al regenerar', getErrorMessage(error, 'No se pudo actualizar el texto de la carta.'))
    } finally {
      setRegeneratingMenu(false)
    }
  }

  const uploadPaymentQr = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      alerts.warning('Archivo no válido', 'Selecciona una imagen JPG, PNG o WEBP.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      alerts.warning('Imagen muy pesada', 'Usa una imagen de máximo 5 MB.')
      return
    }
    setUploadingQr(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const result = await api.post<{ ok: boolean; name: string }>('/whatsapp/settings/payment-qr-file', form)
      setWhatsapp(current => ({ ...current, paymentQrName: result.name, paymentQrMode: 'IMAGE' }))
      alerts.toast('Imagen QR cargada')
    } catch (error: unknown) {
      alerts.error('No se pudo subir el QR', getErrorMessage(error, 'Inténtalo nuevamente.'))
    } finally {
      setUploadingQr(false)
    }
  }

  const deletePaymentQr = async () => {
    try {
      await api.delete('/whatsapp/settings/payment-qr-file')
      setWhatsapp(current => ({ ...current, paymentQrName: null, paymentQrMode: 'ACCOUNT' }))
      alerts.toast('Imagen QR eliminada')
    } catch (error: unknown) {
      alerts.error('No se pudo eliminar', getErrorMessage(error, 'Inténtalo nuevamente.'))
    }
  }

  const stationChannel = (station: KitchenStation): KitchenChannel => {
    const configured = kitchen.stationChannels[station.id]
    if (configured) return configured
    if (/domicilio/i.test(station.name)) return 'DELIVERY'
    if (/sal[oó]n/i.test(station.name)) return 'DINING'
    return 'DINING'
  }

  const openDeliveryStationEditor = (station?: KitchenStation) => {
    setStationDraft(station ? {
      id: station.id,
      name: station.name,
      color: station.color || '#F97316',
      active: station.active !== false,
      categoryIds: (station.categories || []).map(category => category.id),
      userIds: (station.users || []).map(candidate => candidate.id),
    } : {
      name: `Tablet domicilios ${deliveryStations.length + 1}`,
      color: '#F97316',
      active: true,
      categoryIds: [],
      userIds: [],
    })
  }

  const saveDeliveryStation = async () => {
    if (!stationDraft?.name.trim()) {
      alerts.warning('Escribe un nombre para la estación')
      return
    }
    if (stationDraft.userIds.length === 0) {
      alerts.warning('Asigna al menos un cocinero', 'El reparto automático necesita saber quiénes trabajan en esta tablet.')
      return
    }
    setSavingStation(true)
    try {
      await api.post('/kitchen/stations', {
        id: stationDraft.id,
        name: stationDraft.name.trim(),
        color: stationDraft.color,
        active: stationDraft.active,
        categoryIds: stationDraft.categoryIds,
        userIds: stationDraft.userIds,
        priority: deliveryStations.findIndex(station => station.id === stationDraft.id) + 1,
        channel: 'DELIVERY',
      })
      const [stationRows, updatedSettings] = await Promise.all([
        api.get<KitchenStation[]>('/kitchen/stations'),
        api.get<KitchenSettings>('/kitchen/settings'),
      ])
      setStations(stationRows || [])
      setKitchen(current => ({ ...current, ...updatedSettings }))
      setStationDraft(null)
      alerts.success('Estación de domicilios guardada', 'La tablet y sus cocineros quedaron separados de la cocina de mesas.')
    } catch (error: unknown) {
      alerts.error('No se pudo guardar la estación', getErrorMessage(error, 'Inténtalo nuevamente.'))
    } finally {
      setSavingStation(false)
    }
  }

  const setDeliveryStationActive = async (station: KitchenStation, active: boolean) => {
    try {
      await api.post('/kitchen/stations', {
        id: station.id,
        name: station.name,
        color: station.color || '#F97316',
        active,
        categoryIds: (station.categories || []).map(category => category.id),
        userIds: (station.users || []).map(candidate => candidate.id),
        priority: station.priority || 0,
        channel: 'DELIVERY',
      })
      setStations(current => current.map(item => item.id === station.id ? { ...item, active } : item))
      alerts.toast(active ? 'Tablet activada' : 'Tablet pausada')
    } catch (error: unknown) {
      alerts.error('No se pudo cambiar la tablet', getErrorMessage(error, 'Inténtalo nuevamente.'))
    }
  }

  const updateDeliveryCookStatus = async (userId: string, data: { active?: boolean; onBreak?: boolean; breakMinutes?: number; breakReason?: string }) => {
    setBusyCookId(userId)
    try {
      const updated = await api.post<Record<string, CookStatus>>(`/kitchen/delivery/cooks/${userId}/status`, data)
      setDeliveryCookStatuses(updated || {})
      if (data.onBreak === true) alerts.toast('Descanso iniciado; la tablet sigue recibiendo pedidos')
      else if (data.onBreak === false) alerts.toast('Cocinero reincorporado al reparto')
      else alerts.toast(data.active === false ? 'Cocinero fuera del reparto' : 'Cocinero disponible')
    } catch (error: unknown) {
      alerts.error('No se pudo cambiar la disponibilidad', getErrorMessage(error, 'Inténtalo nuevamente.'))
    } finally {
      setBusyCookId(null)
    }
  }

  const printerChannel = (printer: PrinterConfig): KitchenChannel =>
    printer.channel || (/domicilio/i.test(printer.name) ? 'DELIVERY' : 'DINING')

  const hasValidPrinterAddress = (printer: PrinterConfig) => {
    const raw = String(printer.ip || '').trim()
    if (!raw) return false
    if (raw.toUpperCase().startsWith('USB:')) {
      const shareName = raw.replace(/^USB:\s*/i, '').trim()
      return shareName.length > 0
    }
    const host = raw.replace(/^https?:\/\//i, '').split(':')[0].trim()
    return host.length > 0
  }

  const saveDeliveryKitchen = async () => {
    const invalidPrinter = printing.printers.find(printer => printer.enabled !== false && !printer.name.trim())
    if (invalidPrinter) {
      alerts.warning('Falta el nombre de una impresora')
      return
    }
    if (kitchen.deliveryAutoPrint && ['PRINT', 'BOTH'].includes(kitchen.deliveryKitchenMode)) {
      const deliveryPrinters = printing.printers.filter(printer => printer.enabled !== false && ['DELIVERY', 'BOTH'].includes(printerChannel(printer)))
      if (deliveryPrinters.length === 0) {
        alerts.warning('Falta la impresora de domicilios', 'Agrega una impresora y asígnala a Domicilios o Ambos.')
        return
      }
      const invalidAddress = deliveryPrinters.find(printer => !hasValidPrinterAddress(printer))
      if (invalidAddress) {
        alerts.warning('Conexión de impresora inválida', `Revisa la IP o el nombre USB compartido de ${invalidAddress.name}.`)
        return
      }
    }
    if (['TABLET', 'BOTH'].includes(kitchen.deliveryKitchenMode) && !deliveryStations.some(station => station.active && (station.users || []).length > 0)) {
      alerts.warning('Falta una tablet lista', 'Crea y activa al menos un puesto de domicilios con sus cocineros asignados.')
      return
    }
    setSavingSection('DELIVERY_KITCHEN')
    try {
      const savedKitchen = await api.post<KitchenSettings>('/kitchen/settings', {
        ...kitchen,
        splitByChannel: true,
        stationChannels: kitchen.stationChannels,
      })
      const normalizedPrinters = printing.printers.map(printer => ({
        ...printer,
        channel: printerChannel(printer),
      }))
      const savedPrinting = await api.put<PrinterSettings>('/print/settings', { printers: normalizedPrinters })
      setKitchen(savedKitchen)
      setPrinting(savedPrinting)
      alerts.success('Cocina de domicilios configurada', 'Las próximas comandas usarán esta distribución.')
    } catch (error: unknown) {
      alerts.error('No se pudo guardar', getErrorMessage(error, 'Inténtalo nuevamente.'))
    } finally {
      setSavingSection(null)
    }
  }

    const downloadStandaloneExe = () => {
    const link = document.createElement('a')
    link.href = '/downloads/TheVillaDogBridge.exe'
    link.download = 'TheVillaDogBridge.exe'
    document.body.appendChild(link)
    link.click()
    link.remove()
    alerts.success('Descargando TheVillaDogBridge.exe', 'Ejecutable técnico: usa una configuración local existente o solicita la vinculación inicial una sola vez.')
  }

  const downloadPortableZip = () => {
    const link = document.createElement('a')
    link.href = '/downloads/TheVillaDog-Puente-Portable.zip'
    link.download = 'TheVillaDog-Puente-Portable.zip'
    document.body.appendChild(link)
    link.click()
    link.remove()
    alerts.success('Descargando paquete portable', 'Paquete técnico sin credenciales embebidas. Para una instalación automática usa el botón recomendado.')
  }

  const downloadConfiguredBridge = async () => {
    setDownloadingBridge(true)
    try {
      const result = await api.get<{ token?: string }>('/print/bridge-token', { force: true })
      const token = String(result?.token || '').trim()
      if (token.length < 32) throw new Error('El puente de impresión todavía no tiene una llave válida en el servidor.')

      const configuredApiUrlFromEnv = String(import.meta.env.VITE_API_URL || '').trim()
      const configuredApiUrl = (/^(https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?(\/api)?$/i.test(configuredApiUrlFromEnv) || !configuredApiUrlFromEnv ? window.location.origin : configuredApiUrlFromEnv).replace(/\/+$/, '')
      const backendUrl = configuredApiUrl.replace(/\/api$/i, '')
      const safeToken = token.replace(/[\r\n"]/g, '')
      if (!/^[A-Za-z0-9._~-]{32,}$/.test(safeToken)) throw new Error('La llave del puente tiene un formato inválido.')

      const script = [
        '@echo off',
        'setlocal EnableExtensions DisableDelayedExpansion',
        'title Instalador Puente The Villa Dog',
        'color 0A',
        `set "BRIDGE_TOKEN=${safeToken}"`,
        'set "PRINT_BRIDGE_TOKEN=%BRIDGE_TOKEN%"',
        `set "BRIDGE_BACKEND_URL=${backendUrl}"`,
        'set "SOURCE_DIR=%~dp0"',
        'set "INSTALL_DIR=%LOCALAPPDATA%\\TheVillaDog\\PrinterBridge"',
        'set "TARGET_EXE=%INSTALL_DIR%\\TheVillaDogBridge.exe"',
        'set "CONFIG_PATH=%INSTALL_DIR%\\config.json"',
        'set "LAUNCHER_PATH=%INSTALL_DIR%\\iniciar_puente.vbs"',
        'set "UNINSTALL_PATH=%INSTALL_DIR%\\desinstalar_puente.bat"',
        'set "STARTUP_DIR=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"',
        'set "SHORTCUT_PATH=%STARTUP_DIR%\\TheVillaDogPrinterBridge.lnk"',
        '',
        'echo ============================================================== ',
        'echo      INSTALADOR DEL PUENTE DE IMPRESION - THE VILLA DOG       ',
        'echo ============================================================== ',
        'echo Servidor : %BRIDGE_BACKEND_URL%',
        'echo.',
        'if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%" >nul 2>&1',
        '',
        'rem 1. Copiar ejecutable local si existe o descargarlo del servidor',
        'if exist "%SOURCE_DIR%TheVillaDogBridge.exe" (',
        '  echo Usando TheVillaDogBridge.exe local...',
        '  copy /Y "%SOURCE_DIR%TheVillaDogBridge.exe" "%TARGET_EXE%" >nul',
        ') else if not exist "%TARGET_EXE%" (',
        '  echo Descargando TheVillaDogBridge.exe (autonomo, no requiere Node.js)...',
        '  where curl.exe >nul 2>&1',
        '  if not errorlevel 1 (',
        '    curl.exe --fail --location --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 180 --progress-bar --output "%TARGET_EXE%" "%BRIDGE_BACKEND_URL%/downloads/TheVillaDogBridge.exe"',
        '  ) else (',
        `    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference = 'SilentlyContinue'; try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 180 -Uri ($env:BRIDGE_BACKEND_URL + '/downloads/TheVillaDogBridge.exe') -OutFile $env:TARGET_EXE; exit 0 } catch { Write-Host $_; exit 1 }"`,
        '  )',
        ')',
        '',
        'if not exist "%TARGET_EXE%" (',
        '  echo [ERROR] No se pudo obtener el ejecutable.',
        '  echo Descarga TheVillaDogBridge.exe directamente desde la consola web y colocalo junto a este instalador.',
        '  pause',
        '  exit /b 1',
        ')',
        '',
        'rem 2. Guardar config.json con el token ya incluido',
        'echo Guardando configuracion...',
        `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$cfg = [ordered]@{ backendUrl = $env:BRIDGE_BACKEND_URL; bridgeToken = $env:BRIDGE_TOKEN; pollIntervalMs = 3000 }; $cfg | ConvertTo-Json | Set-Content -LiteralPath $env:CONFIG_PATH -Encoding UTF8"`,
        '',
        'rem 3. Detener instancias anteriores si existieran',
        'echo Deteniendo instancias anteriores...',
        'taskkill /F /IM TheVillaDogBridge.exe >nul 2>&1',
        'taskkill /F /IM Instalar-Impresion-TheVillaDog.exe >nul 2>&1',
        '',
        'rem 4. Crear lanzador silencioso (sin ventana de consola negra)',
        '(',
        '  echo Set shell = CreateObject^("WScript.Shell"^)',
        '  echo shell.CurrentDirectory = "%INSTALL_DIR%"',
        '  echo shell.Run """%TARGET_EXE%""", 0, False',
        ') > "%LAUNCHER_PATH%"',
        '',
        'rem 5. Crear acceso directo en el inicio de Windows',
        `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut($env:SHORTCUT_PATH); $s.TargetPath = $env:LAUNCHER_PATH; $s.WorkingDirectory = $env:INSTALL_DIR; $s.Description = 'The Villa Dog Printer Bridge'; $s.Save()\"`,
        '',
        'rem 6. Crear desinstalador',
        '(',
        '  echo @echo off',
        '  echo title Desinstalar Puente The Villa Dog',
        '  echo taskkill /F /IM TheVillaDogBridge.exe ^>nul 2^>^&1',
        '  echo del /Q "%SHORTCUT_PATH%" ^>nul 2^>^&1',
        '  echo echo [OK] Servicio detenido y acceso directo eliminado.',
        '  echo pause',
        ') > "%UNINSTALL_PATH%"',
        '',
        'rem 7. Arrancar el puente en segundo plano de inmediato',
        'echo Arrancando servicio...',
        'wscript.exe "%LAUNCHER_PATH%"',
        '',
        'echo.',
        'echo ============================================================== ',
        'echo      [OK] INSTALACION COMPLETADA CORRECTAMENTE                ',
        'echo ============================================================== ',
        'echo - Puente instalado en: %INSTALL_DIR%',
        'echo - Servicio activo en segundo plano.',
        'echo - Se iniciara automaticamente cada vez que enciendas el PC.',
        'echo ============================================================== ',
        'timeout /t 5 >nul 2>&1',
        'exit /b 0',
      ].join('\r\n') + '\r\n'

      const blob = new Blob([script], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'Instalar-Puente-TheVillaDog.bat'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      alerts.success('Instalador .BAT listo', 'Descárgalo y ejecútalo en cada computador. La llave ya viene incluida y no requiere Node.js.')
    } catch (error: unknown) {
      alerts.error('No se pudo preparar el instalador', getErrorMessage(error, 'Verifica que PRINT_BRIDGE_TOKEN esté guardada en el servidor.'))
    } finally {
      setDownloadingBridge(false)
    }
  }

  const updatePrinter = (id: string, changes: Partial<PrinterConfig>) => {
    setPrinting(current => ({ ...current, printers: current.printers.map(printer => printer.id === id ? { ...printer, ...changes } : printer) }))
  }

  const setPrinterConnectionType = (printer: PrinterConfig, type: 'NETWORK' | 'USB') => {
    const raw = String(printer.ip || '').trim().replace(/^USB:\s*/i, '')
    if (type === 'USB') {
      updatePrinter(printer.id, { ip: `USB:${raw}` })
      return
    }
    updatePrinter(printer.id, { ip: raw })
  }

  const addPrinter = () => {
    const id = `delivery-${Date.now()}`
    setPrinting(current => ({
      ...current,
      printers: [...current.printers, { id, name: 'Cocina domicilios', mode: 'local_bridge', ip: '', port: 9100, paper: '80', categories: [], type: 'estacion', enabled: true, channel: 'DELIVERY' }],
    }))
  }

  const testPrinter = async (printer: PrinterConfig) => {
    setTestingPrinterId(printer.id)
    try {
      const result = await api.post<{ ok: boolean; error?: string }>(`/print/test?target=${encodeURIComponent(printer.id)}`, {})
      if (!result.ok) throw new Error(result.error || 'La impresora no está configurada')
      alerts.success('Prueba enviada', 'El puente local debe imprimirla en unos segundos.')
    } catch (error: unknown) {
      alerts.error('No se pudo enviar la prueba', getErrorMessage(error, 'Revisa la IP y el puente local.'))
    } finally {
      setTestingPrinterId(null)
    }
  }

  const clearPrintQueue = async () => {
    setClearingQueue(true)
    try {
      await api.delete('/print/queue')
      alerts.success('Cola de impresión vaciada', 'Se eliminaron las comandas pendientes que estaban acumuladas.')
    } catch (error: unknown) {
      alerts.error('No se pudo limpiar la cola', getErrorMessage(error, 'Inténtalo nuevamente.'))
    } finally {
      setClearingQueue(false)
    }
  }

  const activeCount = accessibleModules.filter(module => !hiddenModules.includes(module.id)).length
  const allTabs: Array<{ id: SettingsTab; label: string; description: string; icon: LucideIcon }> = [
    { id: 'MODULES', label: 'Módulos', description: 'Organiza el menú lateral', icon: SlidersHorizontal },
    { id: 'WHATSAPP', label: 'WhatsApp y envíos', description: 'Bot, carta y cobros', icon: MessageCircle },
    { id: 'DELIVERY_KITCHEN', label: 'Cocina domicilios', description: 'Comandas, tablets e impresoras', icon: ChefHat },
  ]
  const tabs = allTabs

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 pb-8">
      <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)] text-[var(--accent-fg)]"><Settings className="h-5 w-5" /></div>
          <div><h1 className="text-xl font-black text-[var(--text-primary)]">Configuración</h1><p className="text-xs text-[var(--text-muted)]">Ajustes diarios de operación en un solo lugar.</p></div>
        </div>
        <div className={cn('flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold', preparationMode ? 'bg-amber-500/10 text-amber-700' : 'bg-emerald-500/10 text-emerald-600')}><CheckCircle2 className="h-4 w-4" /> {preparationMode ? 'Configuración aislada; tiempo real desactivado hasta activar la sede' : 'WhatsApp y cocina se sincronizan en tiempo real'}</div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {tabs.map(tab => {
          const Icon = tab.icon
          const selected = activeTab === tab.id
          return (
            <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={cn('flex items-center gap-3 rounded-2xl border p-3 text-left transition', selected ? 'border-[var(--accent)] bg-[var(--accent-muted)]/30 shadow-sm' : 'border-[var(--border-subtle)] bg-[var(--bg-panel)] hover:border-[var(--border-default)]')}>
              <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', selected ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]')}><Icon className="h-4 w-4" /></span>
              <span className="min-w-0"><span className="block text-sm font-black text-[var(--text-primary)]">{tab.label}</span><span className="block truncate text-[10px] text-[var(--text-muted)]">{tab.description}</span></span>
            </button>
          )
        })}
      </div>

      {activeTab === 'MODULES' && (
        <div className="space-y-3">
          <Card className="flex flex-col gap-3 rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-sm font-black text-[var(--text-primary)]">{activeCount} de {accessibleModules.length} módulos visibles</p><p className="text-xs text-[var(--text-muted)]">Esta selección se comparte con todos los usuarios y dispositivos de {user?.activeSite?.name || 'la sede'}.</p></div>
            <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={useSalonMode} disabled={savingModules} className="h-9 rounded-xl text-xs font-bold"><Sparkles className="mr-1.5 h-4 w-4 text-[var(--accent)]" /> Solo salón</Button><Button variant="outline" onClick={showAll} disabled={savingModules} className="h-9 rounded-xl text-xs font-bold text-emerald-600"><RotateCcw className="mr-1.5 h-4 w-4" /> Mostrar todo</Button></div>
          </Card>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {groupedModules.map(([section, modules]) => (
              <Card key={section} className="overflow-hidden rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)]">
                <div className="border-b border-[var(--border-subtle)] px-4 py-3"><h2 className="text-xs font-black uppercase tracking-wider text-[var(--text-secondary)]">{section}</h2></div>
                <div className="divide-y divide-[var(--border-subtle)]">
                  {modules.map(module => {
                    const Icon = module.icon
                    const visible = !hiddenModules.includes(module.id)
                    return (
                      <div key={module.id} className="flex items-center gap-3 px-4 py-3">
                        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', visible ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]')}><Icon className="h-4 w-4" /></span>
                        <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-[var(--text-primary)]">{module.name}</p><p className="truncate text-[11px] text-[var(--text-muted)]">{module.description}</p></div>
                        {module.isPermanent ? <span className="flex h-8 items-center gap-1 rounded-lg bg-blue-500/10 px-2 text-[10px] font-bold text-blue-600"><Lock className="h-3 w-3" /> Fijo</span> : (
                          <button type="button" role="switch" aria-checked={visible} aria-label={`${visible ? 'Ocultar' : 'Mostrar'} ${module.name}`} disabled={savingModules} onClick={() => toggleModule(module.id)} className={cn('relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-wait disabled:opacity-60', visible ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700')}><span className={cn('absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all', visible ? 'left-6' : 'left-1')} /></button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'WHATSAPP' && (loadingOperations ? <LoadingPanel label="Cargando configuración de WhatsApp..." /> : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {preparationMode && (
            <Card className="rounded-2xl border-blue-500/25 bg-blue-500/5 p-4 xl:col-span-2">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-black text-[var(--text-primary)]">Comprobar el número propio de esta sede</p>
                  <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">La prueba consulta los datos del número en Meta usando las variables de Railway. No envía mensajes, no descarga archivos y no habilita el webhook operativo.</p>
                </div>
                <Button type="button" variant="outline" onClick={() => void testMetaConnection()} disabled={testingMeta} className="h-10 shrink-0 rounded-xl font-black">
                  {testingMeta ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BadgeCheck className="mr-2 h-4 w-4" />}
                  Probar conexión Meta
                </Button>
              </div>
              {metaTestResult && (
                <div className={cn('mt-3 rounded-xl border px-3 py-2 text-xs leading-5', metaTestResult.success ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300' : 'border-red-500/25 bg-red-500/5 text-red-700 dark:text-red-300')}>
                  <p className="font-black">{metaTestResult.success ? 'Conexión correcta' : 'Conexión pendiente'}</p>
                  <p>{metaTestResult.message}</p>
                  {metaTestResult.success && (metaTestResult.verifiedName || metaTestResult.displayPhoneNumber) && (
                    <p className="mt-1 opacity-80">{[metaTestResult.verifiedName, metaTestResult.displayPhoneNumber].filter(Boolean).join(' · ')}</p>
                  )}
                </div>
              )}
            </Card>
          )}
          <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div className="flex gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600"><Bot className="h-5 w-5" /></span><div><h2 className="font-black text-[var(--text-primary)]">WhatsApp y chatbot</h2><p className="text-xs text-[var(--text-muted)]">Controla la atención automática desde aquí o desde el chat.</p></div></div>
              <button type="button" onClick={() => setWhatsapp(current => ({ ...current, chatbotEnabled: !current.chatbotEnabled }))} className={cn('h-9 rounded-xl border px-3 text-xs font-black transition', whatsapp.chatbotEnabled ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600' : 'border-slate-400/30 bg-slate-500/10 text-[var(--text-secondary)]')}>{whatsapp.chatbotEnabled ? 'Activo' : 'Pausado'}</button>
            </div>
            <div className="space-y-4">
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                <span><span className="block text-sm font-bold text-[var(--text-primary)]">Lectura automática para Nuevo Pedido</span><span className="mt-0.5 block text-[10px] leading-4 text-[var(--text-muted)]">Cuando está pausada, las asesoras toman el pedido manualmente y no se consulta la IA.</span></span>
                <button type="button" onClick={() => setWhatsapp(current => ({ ...current, orderReaderEnabled: !current.orderReaderEnabled }))} className={cn('h-9 shrink-0 rounded-xl border px-3 text-xs font-black transition', whatsapp.orderReaderEnabled ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600' : 'border-slate-400/30 bg-slate-500/10 text-[var(--text-secondary)]')}>{whatsapp.orderReaderEnabled ? 'Activa' : 'Pausada'}</button>
              </label>
              <section className={cn('rounded-2xl border p-4 transition', whatsapp.businessHoursEnabled ? 'border-amber-500/30 bg-amber-500/5' : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)]')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3"><span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', whatsapp.businessHoursEnabled ? 'bg-amber-500/15 text-amber-600' : 'bg-[var(--bg-panel)] text-[var(--text-muted)]')}><Clock3 className="h-4 w-4" /></span><div><h3 className="text-sm font-black text-[var(--text-primary)]">Cierre programado</h3><p className="mt-0.5 text-[11px] leading-4 text-[var(--text-muted)]">Fuera de este horario, WhatsApp responde el aviso de cierre sin usar la IA.</p></div></div>
                  <button type="button" role="switch" aria-checked={whatsapp.businessHoursEnabled} onClick={() => setWhatsapp(current => ({ ...current, businessHoursEnabled: !current.businessHoursEnabled }))} className={cn('h-9 shrink-0 rounded-xl border px-3 text-xs font-black transition', whatsapp.businessHoursEnabled ? 'border-amber-500/35 bg-amber-500/15 text-amber-700' : 'border-slate-400/30 bg-[var(--bg-panel)] text-[var(--text-secondary)]')}>{whatsapp.businessHoursEnabled ? 'Activo' : 'Desactivado'}</button>
                </div>
                {whatsapp.businessHoursEnabled && <div className="mt-4 space-y-3 border-t border-amber-500/15 pt-4">
                  <div className="grid grid-cols-2 gap-3"><label className="block"><span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-[var(--text-muted)]">Abre desde</span><input type="time" value={restaurantSchedule.openingTime} onChange={event => setRestaurantSchedule(current => ({ ...current, openingTime: event.target.value }))} className={fieldClass} /></label><label className="block"><span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-[var(--text-muted)]">Cierra desde</span><input type="time" value={restaurantSchedule.closingTime} onChange={event => setRestaurantSchedule(current => ({ ...current, closingTime: event.target.value }))} className={fieldClass} /></label></div>
                  <label className="block"><span className="mb-1.5 block text-xs font-bold text-[var(--text-secondary)]">Mensaje para clientes fuera de horario</span><textarea value={whatsapp.outOfServiceMessage} maxLength={1200} onChange={event => setWhatsapp(current => ({ ...current, outOfServiceMessage: event.target.value }))} className={cn(textAreaClass, 'min-h-24')} placeholder="Ej.: Estamos cerrados. Volvemos a atender desde las {abre}." /><span className="mt-1 block text-[10px] leading-4 text-[var(--text-muted)]">Puedes usar <strong>{'{abre}'}</strong> para mostrar la hora de apertura y <strong>{'{horario}'}</strong> para mostrar el horario completo.</span></label>
                  <p className="rounded-xl border border-amber-500/20 bg-[var(--bg-panel)] px-3 py-2 text-[11px] leading-4 text-[var(--text-secondary)]">Activo todos los días: atiende de <strong>{restaurantSchedule.openingTime}</strong> a <strong>{restaurantSchedule.closingTime}</strong>. El aviso se envía aun con el bot de respuestas pausado.</p>
                </div>}
              </section>
              <label className="block"><span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-[var(--text-secondary)]"><Link2 className="h-3.5 w-3.5" /> Enlace público de la carta</span><div className="flex gap-2"><input value={whatsapp.digitalMenuUrl} onChange={event => setWhatsapp(current => ({ ...current, digitalMenuUrl: event.target.value }))} className={fieldClass} placeholder="https://menu.tu-dominio.com/menu" /><a href={whatsapp.digitalMenuUrl || '/menu'} target="_blank" rel="noreferrer" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--accent)]" title="Abrir carta"><ExternalLink className="h-4 w-4" /></a></div><span className="mt-1.5 block text-[10px] leading-4 text-[var(--text-muted)]">Es el enlace que reciben los clientes. En producción usa un dominio o subdominio separado de la consola y del backend, por ejemplo <strong>menu.tu-dominio.com/menu</strong>. Si lo dejas vacío, WhatsApp enviará solo la lista de precios hasta que configures <strong>PUBLIC_MENU_URL</strong>.</span></label>
              <label className="block"><span className="mb-1.5 block text-xs font-bold text-[var(--text-secondary)]">Mensaje que acompaña la carta</span><textarea value={whatsapp.menuShareMessage} onChange={event => setWhatsapp(current => ({ ...current, menuShareMessage: event.target.value }))} className={textAreaClass} placeholder="Escribe el mensaje. Puedes usar {url}." /><span className="mt-1 block text-[10px] text-[var(--text-muted)]">Si escribes <strong>{'{url}'}</strong>, el enlace se insertará ahí. Si no, se agrega al final.</span></label>
              <label className="block">
                <span className="mb-1.5 flex items-center justify-between gap-2 text-xs font-bold text-[var(--text-secondary)]">
                  <span>Texto de la carta que se enviará</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={regenerateMenu}
                      disabled={regeneratingMenu}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1 text-[11px] font-bold text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)] transition disabled:opacity-50"
                      title="Volver a generar el texto con base en los productos y precios actuales del catálogo"
                    >
                      <RotateCcw className={cn('h-3 w-3', regeneratingMenu && 'animate-spin')} />
                      {regeneratingMenu ? 'Regenerando...' : 'Regenerar desde productos'}
                    </button>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-black text-emerald-600">
                      Editable
                    </span>
                  </div>
                </span>
                <textarea
                  value={whatsapp.menuText}
                  onChange={event => setWhatsapp(current => ({ ...current, menuText: event.target.value }))}
                  className={`${textAreaClass} min-h-64 font-mono text-xs leading-5`}
                  placeholder="Escribe o edita el texto de la carta que recibirán tus clientes..."
                  aria-label="Texto de la carta que se enviará"
                />
                <span className="mt-1 block text-[10px] text-[var(--text-muted)]">
                  Puedes editar libremente nombres, precios, notas o promociones. Para guardar los cambios pulsa <strong>Guardar WhatsApp y envíos</strong>. Si deseas restaurarlo automáticamente desde los productos vivos, pulsa <strong>Regenerar desde productos</strong>.
                </span>
              </label>

              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-300"><p className="font-bold">Carta sincronizada con Productos y Menú</p><p className="mt-0.5 opacity-80">El botón Carta de WhatsApp usa exactamente este contenido y recibe los cambios en vivo mediante Socket.IO.</p></div>
            </div>
          </Card>

          <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5">
            <div className="mb-5 flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600"><QrCode className="h-5 w-5" /></span><div><h2 className="font-black text-[var(--text-primary)]">Cobro por transferencia</h2><p className="text-xs text-[var(--text-muted)]">Elige qué recibe el cliente al pulsar QR.</p></div></div>
            <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl bg-[var(--bg-elevated)] p-1"><button type="button" onClick={() => setWhatsapp(current => ({ ...current, paymentQrMode: 'ACCOUNT' }))} className={cn('flex h-9 items-center justify-center gap-2 rounded-lg text-xs font-bold transition', whatsapp.paymentQrMode === 'ACCOUNT' ? 'bg-[var(--bg-panel)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-muted)]')}><CreditCard className="h-4 w-4" /> Datos de cuenta</button><button type="button" onClick={() => setWhatsapp(current => ({ ...current, paymentQrMode: 'IMAGE' }))} className={cn('flex h-9 items-center justify-center gap-2 rounded-lg text-xs font-bold transition', whatsapp.paymentQrMode === 'IMAGE' ? 'bg-[var(--bg-panel)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-muted)]')}><ImageIcon className="h-4 w-4" /> Imagen QR</button></div>
            {whatsapp.paymentQrMode === 'ACCOUNT' ? (
              <label className="block"><span className="mb-1.5 block text-xs font-bold text-[var(--text-secondary)]">Datos que se enviarán</span><textarea value={whatsapp.paymentAccountText} onChange={event => setWhatsapp(current => ({ ...current, paymentAccountText: event.target.value }))} className="min-h-44 w-full resize-y rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" placeholder={'💳 DATOS DE TRANSFERENCIA\nBanco o billetera:\nNúmero:\nTitular:'} /></label>
            ) : (
              <div className="space-y-3"><div className="flex min-h-36 flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 text-center">{whatsapp.paymentQrName ? <><QrCode className="mb-2 h-8 w-8 text-emerald-500" /><p className="max-w-full truncate text-sm font-bold text-[var(--text-primary)]">{whatsapp.paymentQrName}</p><button type="button" onClick={deletePaymentQr} className="mt-2 flex items-center gap-1 text-xs font-bold text-red-500"><Trash2 className="h-3.5 w-3.5" /> Quitar imagen</button></> : <><Upload className="mb-2 h-7 w-7 text-[var(--text-muted)]" /><p className="text-sm font-bold text-[var(--text-primary)]">Sube el QR oficial</p><p className="text-[10px] text-[var(--text-muted)]">JPG, PNG o WEBP · máximo 5 MB</p></>}<label className="mt-3 inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl bg-[var(--accent)] px-3 text-xs font-bold text-[var(--accent-fg)]">{uploadingQr ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{whatsapp.paymentQrName ? 'Cambiar imagen' : 'Seleccionar imagen'}<input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={uploadingQr} onChange={uploadPaymentQr} /></label></div><label className="block"><span className="mb-1.5 block text-xs font-bold text-[var(--text-secondary)]">Texto debajo de la imagen</span><textarea value={whatsapp.paymentQrCaption} onChange={event => setWhatsapp(current => ({ ...current, paymentQrCaption: event.target.value }))} className={textAreaClass} placeholder="Instrucciones o nombre del titular" /></label></div>
            )}
          </Card>
          <div className="flex justify-end xl:col-span-2"><Button onClick={saveWhatsapp} disabled={savingSection === 'WHATSAPP'} className="h-11 rounded-xl bg-[var(--accent)] px-5 font-bold text-[var(--accent-fg)]">{savingSection === 'WHATSAPP' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Guardar WhatsApp y envíos</Button></div>
        </div>
      ))}

      {activeTab === 'DELIVERY_KITCHEN' && (loadingOperations ? <LoadingPanel label="Cargando cocina de domicilios..." /> : (
        <div className="space-y-4">
          <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5">
            <div className="mb-4 flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600"><MonitorSmartphone className="h-5 w-5" /></span><div><h2 className="font-black text-[var(--text-primary)]">Salida de pedidos de domicilios</h2><p className="text-xs text-[var(--text-muted)]">Este ajuste no cambia la cocina de mesas.</p></div></div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{([{ id: 'PRINT', title: 'Comandas impresas', text: 'Para iniciar las pruebas', icon: Printer }, { id: 'TABLET', title: 'Tablets de cocina', text: 'Envía al tablero en vivo', icon: Tablet }, { id: 'BOTH', title: 'Impresión + tablets', text: 'Respaldo durante la transición', icon: MonitorSmartphone }] as const).map(option => { const Icon = option.icon; const selected = kitchen.deliveryKitchenMode === option.id; return <button key={option.id} type="button" onClick={() => setKitchen(current => ({ ...current, deliveryKitchenMode: option.id }))} className={cn('flex items-center gap-3 rounded-2xl border p-4 text-left transition', selected ? 'border-[var(--accent)] bg-[var(--accent-muted)]/25 ring-2 ring-[var(--accent)]/10' : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--border-default)]')}><span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', selected ? 'bg-[var(--accent)] text-[var(--accent-fg)]' : 'bg-[var(--bg-panel)] text-[var(--text-muted)]')}><Icon className="h-4 w-4" /></span><span><span className="block text-sm font-black text-[var(--text-primary)]">{option.title}</span><span className="block text-[10px] text-[var(--text-muted)]">{option.text}</span></span></button> })}</div>
            {['PRINT', 'BOTH'].includes(kitchen.deliveryKitchenMode) && <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3"><span><span className="block text-sm font-bold text-[var(--text-primary)]">Imprimir automáticamente al confirmar</span><span className="block text-[10px] text-[var(--text-muted)]">También genera una nueva comanda cuando cambia el pedido.</span></span><input type="checkbox" checked={kitchen.deliveryAutoPrint} onChange={event => setKitchen(current => ({ ...current, deliveryAutoPrint: event.target.checked }))} className="h-5 w-5 accent-[var(--accent)]" /></label>}
          </Card>

          {['PRINT', 'BOTH'].includes(kitchen.deliveryKitchenMode) && (
            <Card className="overflow-hidden rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)]">
              <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600"><Download className="h-5 w-5" /></span>
                  <div>
                    <h2 className="font-black text-[var(--text-primary)]">Puente de impresión para Windows</h2>
                    <p className="mt-0.5 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">Instálalo en Windows sin Node.js. El instalador recomendado se descarga ya vinculado a este restaurante, queda en segundo plano y arranca automáticamente con el computador.</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" onClick={downloadConfiguredBridge} disabled={downloadingBridge} title={preparationMode ? 'Instala el puente aislado de esta sede para probarlo antes de activarla' : undefined} className="h-10 rounded-xl bg-sky-600 px-4 text-xs font-black text-white shadow-sm transition hover:bg-sky-700">
                    {downloadingBridge ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />} Instalar automáticamente
                  </Button>
                  <Button type="button" onClick={downloadStandaloneExe} className="h-10 rounded-xl bg-emerald-600 px-4 text-xs font-black text-white shadow-sm transition hover:bg-emerald-700">
                    <Download className="mr-1.5 h-4 w-4" /> .EXE manual
                  </Button>
                  <Button type="button" onClick={downloadPortableZip} variant="outline" className="h-10 rounded-xl border-[var(--border-subtle)] px-3 text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                    <Package className="mr-1.5 h-4 w-4" /> ZIP técnico
                  </Button>
                </div>
              </div>
              <div className="grid border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] sm:grid-cols-3">
                <div className="p-4">
                  <p className="text-[10px] font-black uppercase tracking-wider text-emerald-600">1. .EXE directo (Sin Node)</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">Descarga <strong>TheVillaDogBridge.exe</strong>, ábrelo con doble clic y empieza a imprimir de inmediato. Es un binario 100% autónomo.</p>
                </div>
                <div className="border-y border-[var(--border-subtle)] p-4 sm:border-x sm:border-y-0">
                  <p className="text-[10px] font-black uppercase tracking-wider text-sky-600">2. .BAT instalador de fondo</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">Descarga el <strong>instalador .bat</strong> con tu llave preconfigurada. Instala el puente en segundo plano e inicia solo con Windows.</p>
                </div>
                <div className="p-4">
                  <p className="text-[10px] font-black uppercase tracking-wider text-violet-600">3. Paquete ZIP portable</p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">Incluye el .exe, el .bat, desinstalador y configuración listos para descomprimir o llevar en una memoria USB.</p>
                </div>
              </div>
            </Card>
          )}

          <div className={cn('grid grid-cols-1 gap-4', kitchen.deliveryKitchenMode === 'BOTH' && 'xl:grid-cols-[0.9fr_1.1fr]')}>
            {['TABLET', 'BOTH'].includes(kitchen.deliveryKitchenMode) && (
            <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div><h2 className="font-black text-[var(--text-primary)]">Tablets y equipo de domicilios</h2><p className="text-xs leading-5 text-[var(--text-muted)]">Cada puesto representa una tablet. Los pedidos rotan 1 a 1 entre sus cocineros disponibles.</p></div>
                <Button variant="outline" onClick={() => openDeliveryStationEditor()} className="h-9 shrink-0 rounded-xl text-xs font-bold"><Plus className="mr-1 h-4 w-4" /> Puesto</Button>
              </div>
              <div className="mb-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-300"><p className="font-bold">Separado de la cocina de mesas</p><p className="mt-0.5 opacity-80">El descanso de un cocinero saca solo a esa persona del reparto. La tablet continúa con los demás. Pausa el puesto únicamente si quieres detener esa tablet completa.</p></div>
              {deliveryStations.length === 0 ? (
                <button type="button" onClick={() => openDeliveryStationEditor()} className="w-full rounded-2xl border border-dashed border-[var(--border-default)] bg-[var(--bg-elevated)] p-7 text-center transition hover:border-[var(--accent)]"><Tablet className="mx-auto mb-2 h-7 w-7 text-[var(--accent)]" /><span className="block text-sm font-black text-[var(--text-primary)]">Crear primera tablet de domicilios</span><span className="mt-1 block text-[10px] text-[var(--text-muted)]">Después asignas sus categorías y cocineros.</span></button>
              ) : (
                <div className="space-y-3">
                  {deliveryStations.map((station, index) => (
                    <div key={station.id} className={cn('overflow-hidden rounded-2xl border bg-[var(--bg-elevated)]', station.active ? 'border-[var(--border-subtle)]' : 'border-amber-500/30 opacity-80')}>
                      <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] p-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white" style={{ backgroundColor: station.color || '#F97316' }}><Tablet className="h-4 w-4" /></span>
                        <div className="min-w-0 flex-1"><p className="truncate text-sm font-black text-[var(--text-primary)]">{station.name}</p><p className="text-[10px] text-[var(--text-muted)]">Tablet {index + 1} · {preparationMode ? (station.active ? 'preparada' : 'desactivada') : station.active ? 'recibiendo pedidos' : 'pausada'}</p></div>
                        <button type="button" onClick={() => openDeliveryStationEditor(station)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-[var(--text-secondary)]" title="Editar puesto"><Edit2 className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => setDeliveryStationActive(station, !station.active)} className={cn('h-8 rounded-lg border px-2.5 text-[10px] font-black', station.active ? 'border-amber-500/30 text-amber-600' : 'border-emerald-500/30 text-emerald-600')}>{station.active ? 'Pausar tablet' : 'Activar tablet'}</button>
                      </div>
                      <div className="p-3">
                        <div className="mb-3"><p className="text-[9px] font-black uppercase tracking-wider text-[var(--text-muted)]">Prepara</p><div className="mt-1 flex flex-wrap gap-1">{(station.categories || []).length > 0 ? (station.categories || []).map(category => <span key={category.id} className="rounded-md bg-[var(--bg-panel)] px-2 py-1 text-[10px] font-bold text-[var(--text-secondary)]">{category.name}</span>) : <span className="rounded-md bg-[var(--bg-panel)] px-2 py-1 text-[10px] font-bold text-[var(--text-secondary)]">Todos los platos</span>}</div></div>
                        <p className="mb-1.5 text-[9px] font-black uppercase tracking-wider text-[var(--text-muted)]">Cocineros y descansos</p>
                        <div className="space-y-1.5">
                          {(station.users || []).map(cook => {
                            const status = deliveryCookStatuses[cook.id] || { active: true, onBreak: false }
                            const remainingMinutes = status.breakUntil ? Math.max(0, Math.ceil((status.breakUntil - clockNow) / 60000)) : 0
                            const onBreak = Boolean(status.onBreak && remainingMinutes > 0)
                            const active = status.active !== false
                            return (
                              <div key={cook.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2">
                                <span className={cn('h-2 w-2 rounded-full', onBreak ? 'bg-amber-500' : active ? 'bg-emerald-500' : 'bg-slate-400')} />
                                <span className="min-w-28 flex-1 truncate text-xs font-bold text-[var(--text-primary)]">{cook.name}</span>
                                <span className="text-[9px] font-bold text-[var(--text-muted)]">{onBreak ? `${status.breakReason || 'Descanso'} · ${remainingMinutes} min` : active ? 'Disponible' : 'Fuera del reparto'}</span>
                                {busyCookId === cook.id ? <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" /> : onBreak ? (
                                  <button type="button" disabled={preparationMode} onClick={() => updateDeliveryCookStatus(cook.id, { onBreak: false })} className="h-7 rounded-lg bg-emerald-500/10 px-2 text-[9px] font-black text-emerald-600 disabled:opacity-40">Reincorporar</button>
                                ) : (
                                  <><button type="button" disabled={!active || preparationMode} onClick={() => updateDeliveryCookStatus(cook.id, { onBreak: true, breakMinutes: 15, breakReason: 'Descanso' })} className="h-7 rounded-lg bg-amber-500/10 px-2 text-[9px] font-black text-amber-700 disabled:opacity-40">Descanso 15m</button><button type="button" disabled={preparationMode} onClick={() => updateDeliveryCookStatus(cook.id, { active: !active })} className="h-7 rounded-lg border border-[var(--border-subtle)] px-2 text-[9px] font-black text-[var(--text-secondary)] disabled:opacity-40">{active ? 'Sacar' : 'Activar'}</button></>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            )}

            {['PRINT', 'BOTH'].includes(kitchen.deliveryKitchenMode) && (
            <Card className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-black text-[var(--text-primary)]">Impresoras de preparación</h2><p className="text-xs text-[var(--text-muted)]">La IP se cambia aquí y el puente local la recibe desde el servidor.</p></div><div className="flex items-center gap-2"><Button variant="outline" onClick={clearPrintQueue} disabled={clearingQueue} className="h-9 rounded-xl border-rose-500/30 text-xs font-bold text-rose-500 hover:bg-rose-500/10" title={preparationMode ? 'Elimina solamente las pruebas pendientes de esta sede' : 'Elimina comandas pendientes acumuladas'}>{clearingQueue ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1 h-3.5 w-3.5" />} Limpiar cola pendiente</Button><Button variant="outline" onClick={addPrinter} className="h-9 rounded-xl text-xs font-bold"><Plus className="mr-1 h-4 w-4" /> Agregar</Button></div></div>
              {deliveryPrinters.length === 0 ? (
                <button type="button" onClick={addPrinter} className="w-full rounded-2xl border border-dashed border-[var(--border-default)] p-8 text-sm font-bold text-[var(--text-muted)] hover:text-[var(--accent)]"><Plus className="mx-auto mb-2 h-5 w-5" /> Agregar impresora de domicilios</button>
              ) : (
                <div className="space-y-3">
                  {deliveryPrinters.map(printer => {
                    const isUsb = String(printer.ip || '').trim().toUpperCase().startsWith('USB:')
                    const addressValue = String(printer.ip || '').trim().replace(/^USB:\s*/i, '')
                    return (
                      <div key={printer.id} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[1.1fr_110px_1fr_82px_110px_auto]">
                          <input value={printer.name} onChange={event => updatePrinter(printer.id, { name: event.target.value })} className={fieldClass} placeholder="Nombre interno" />
                          <select value={isUsb ? 'USB' : 'NETWORK'} onChange={event => setPrinterConnectionType(printer, event.target.value as 'NETWORK' | 'USB')} className={fieldClass} aria-label="Tipo de conexión"><option value="NETWORK">Red / IP</option><option value="USB">USB</option></select>
                          <input value={addressValue} onChange={event => { const val = event.target.value.replace(/^USB:\s*/i, '').trimStart(); updatePrinter(printer.id, { ip: isUsb ? `USB:${val}` : val }) }} className={fieldClass} placeholder={isUsb ? 'Nombre en Windows (Ej: XP-80C o POS-80)' : 'IP local (Ej: 192.168.1.50)'} aria-label={isUsb ? 'Nombre compartido de la impresora' : 'IP local de la impresora'} />
                          <input type="number" min={1} max={65535} value={printer.port || 9100} onChange={event => updatePrinter(printer.id, { port: Number(event.target.value) || 9100 })} className={cn(fieldClass, isUsb && 'cursor-not-allowed opacity-40')} title={isUsb ? 'USB no usa puerto' : 'Puerto'} disabled={isUsb} />
                          <div className="flex h-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-2 text-[10px] font-black text-emerald-600">Domicilios</div>
                          <button type="button" onClick={() => setPrinting(current => ({ ...current, printers: current.printers.filter(item => item.id !== printer.id) }))} className="flex h-10 items-center justify-center rounded-xl border border-red-500/20 px-3 text-red-500" title="Eliminar"><Trash2 className="h-4 w-4" /></button>
                        </div>
                        <p className="mt-2 text-[10px] text-[var(--text-muted)]">{isUsb ? 'Escribe el nombre de la impresora tal como aparece en Windows (ej: XP-80C). El puente la detecta e imprime directamente sin necesidad de compartirla.' : 'La IP puede cambiarse desde aquí, incluso estando fuera del restaurante.'}</p>
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-3"><label className="flex items-center gap-1.5 text-xs font-bold text-[var(--text-secondary)]"><input type="checkbox" checked={printer.enabled !== false} onChange={event => updatePrinter(printer.id, { enabled: event.target.checked })} className="accent-[var(--accent)]" /> Activa</label><select value={printer.paper || '80'} onChange={event => updatePrinter(printer.id, { paper: event.target.value })} className="h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2 text-xs text-[var(--text-primary)]"><option value="80">Papel 80 mm</option><option value="58">Papel 58 mm</option></select></div>
                          <button type="button" disabled={testingPrinterId === printer.id || !hasValidPrinterAddress(printer)} onClick={() => testPrinter(printer)} className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 text-xs font-bold text-[var(--text-secondary)] disabled:opacity-50" title={preparationMode ? 'Envía una hoja de prueba solo a la cola aislada de esta sede' : 'Enviar una comanda de prueba a esta impresora'}>{testingPrinterId === printer.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />} Probar impresora</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="mt-4 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-xs text-sky-800 dark:text-sky-200"><p className="font-bold">Cómo viaja la impresión</p><p className="mt-0.5 opacity-80">El pedido puede salir desde cualquier lugar. El servidor guarda la comanda; el puente la descarga por Internet y la entrega dentro del restaurante por IP local o USB compartida.</p></div>
            </Card>
            )}
          </div>
          <div className="flex justify-end"><Button onClick={saveDeliveryKitchen} disabled={savingSection === 'DELIVERY_KITCHEN'} className="h-11 rounded-xl bg-[var(--accent)] px-5 font-bold text-[var(--accent-fg)]">{savingSection === 'DELIVERY_KITCHEN' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Guardar cocina de domicilios</Button></div>
        </div>
      ))}

      <Dialog open={stationDraft !== null} onOpenChange={open => { if (!open && !savingStation) setStationDraft(null) }}>
        <DialogContent className="flex max-h-[90vh] w-[95vw] max-w-2xl flex-col overflow-hidden rounded-3xl border-[var(--border-subtle)] bg-[var(--bg-panel)] p-0">
          {stationDraft && (
            <>
              <div className="border-b border-[var(--border-subtle)] p-5">
                <DialogTitle className="flex items-center gap-3 text-lg font-black text-[var(--text-primary)]"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600"><Tablet className="h-5 w-5" /></span>{stationDraft.id ? 'Editar puesto de domicilios' : 'Nueva tablet de domicilios'}</DialogTitle>
                <p className="ml-[52px] mt-[-8px] text-xs text-[var(--text-muted)]">Configura esta pantalla sin tocar las estaciones de las mesas.</p>
              </div>
              <div className="flex-1 space-y-5 overflow-y-auto p-5">
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <label><span className="mb-1.5 block text-xs font-black text-[var(--text-secondary)]">Nombre del puesto o tablet</span><input autoFocus value={stationDraft.name} onChange={event => setStationDraft(current => current ? { ...current, name: event.target.value } : current)} className={fieldClass} placeholder="Ej. Tablet perros y hamburguesas" /></label>
                  <label className="flex min-w-40 cursor-pointer items-center justify-between gap-3 self-end rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-xs font-bold text-[var(--text-secondary)]"><span>Tablet activa</span><input type="checkbox" checked={stationDraft.active} onChange={event => setStationDraft(current => current ? { ...current, active: event.target.checked } : current)} className="h-4 w-4 accent-[var(--accent)]" /></label>
                </div>

                <div>
                  <div className="mb-2 flex items-end justify-between gap-2"><div><p className="text-xs font-black text-[var(--text-primary)]">¿Qué prepara este puesto?</p><p className="text-[10px] text-[var(--text-muted)]">Sin selección funciona como puesto general para todos los platos.</p></div><span className="text-[10px] font-bold text-[var(--text-muted)]">{stationDraft.categoryIds.length} seleccionadas</span></div>
                  <div className="grid max-h-44 grid-cols-2 gap-2 overflow-y-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2 sm:grid-cols-3">
                    {menuCategories.map(category => {
                      const selected = stationDraft.categoryIds.includes(category.id)
                      return <button key={category.id} type="button" onClick={() => setStationDraft(current => current ? { ...current, categoryIds: selected ? current.categoryIds.filter(id => id !== category.id) : [...current.categoryIds, category.id] } : current)} className={cn('min-h-10 rounded-xl border px-2 text-left text-[10px] font-bold transition', selected ? 'border-orange-500 bg-orange-500/10 text-orange-700 dark:text-orange-300' : 'border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-secondary)]')}>{category.name}</button>
                    })}
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-end justify-between gap-2"><div><p className="text-xs font-black text-[var(--text-primary)]">Cocineros que comparten esta tablet</p><p className="text-[10px] text-[var(--text-muted)]">El sistema rota los pedidos equitativamente entre quienes estén disponibles.</p></div><span className="text-[10px] font-bold text-[var(--text-muted)]">{stationDraft.userIds.length} asignados</span></div>
                  {availableKitchenUsers.length === 0 ? <p className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700">Primero crea usuarios con rol Cocinero en Usuarios.</p> : (
                    <div className="grid max-h-52 grid-cols-1 gap-2 overflow-y-auto rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2 sm:grid-cols-2">
                      {availableKitchenUsers.map(candidate => {
                        const selected = stationDraft.userIds.includes(candidate.id)
                        const otherStation = deliveryStations.find(station => station.id !== stationDraft.id && (station.users || []).some(member => member.id === candidate.id))
                        return <button key={candidate.id} type="button" disabled={Boolean(otherStation)} onClick={() => setStationDraft(current => current ? { ...current, userIds: selected ? current.userIds.filter(id => id !== candidate.id) : [...current.userIds, candidate.id] } : current)} className={cn('flex min-h-11 items-center justify-between gap-2 rounded-xl border px-3 text-left transition', selected ? 'border-emerald-500 bg-emerald-500/10' : 'border-[var(--border-subtle)] bg-[var(--bg-panel)]', otherStation && 'cursor-not-allowed opacity-45')}><span className="min-w-0"><span className="block truncate text-xs font-bold text-[var(--text-primary)]">{candidate.name}</span><span className="block truncate text-[9px] text-[var(--text-muted)]">{otherStation ? `Ya está en ${otherStation.name}` : selected ? 'Participa en el reparto' : 'Disponible para asignar'}</span></span><span className={cn('h-4 w-4 shrink-0 rounded-md border', selected ? 'border-emerald-600 bg-emerald-600' : 'border-[var(--border-default)]')} /></button>
                      })}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-xs text-blue-700 dark:text-blue-300"><strong>Ejemplo:</strong> con 2 cocineros en esta tablet, los pedidos se asignan 1 y 1. Si uno entra en descanso, todos pasan temporalmente al otro; la tablet nunca se bloquea.</div>
              </div>
              <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4"><Button variant="outline" onClick={() => setStationDraft(null)} disabled={savingStation} className="rounded-xl">Cancelar</Button><Button onClick={saveDeliveryStation} disabled={savingStation} className="rounded-xl bg-[var(--accent)] font-bold text-[var(--accent-fg)]">{savingStation ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Guardar puesto</Button></div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function LoadingPanel({ label }: { label: string }) {
  return <Card className="flex min-h-64 flex-col items-center justify-center rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-muted)]"><Loader2 className="mb-3 h-6 w-6 animate-spin text-[var(--accent)]" /><p className="text-xs font-bold">{label}</p></Card>
}
