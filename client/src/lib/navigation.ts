import { hasUserPermission } from '@/lib/permissions'
import {
  BadgeCheck,
  BarChart3,
  Bike,
  Building2,
  ChefHat,
  Crown,
  HardDrive,
  LayoutDashboard,
  MapPin,
  MessageCircle,
  PackagePlus,
  PlusCircle,
  ScrollText,
  Settings,
  Users,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { DEFAULT_SITE_ID } from './multisite'

export const MODULE_VISIBILITY_STORAGE_KEY = 'the_villa_dog_hidden_modules'
export const SIDEBAR_ORDER_STORAGE_KEY = 'the_villa_dog_sidebar_order'

const PERMANENT_MODULES = new Set(['settings', 'superadmin'])

function siteStorageKey(base: string, siteId?: string | null) {
  const normalized = String(siteId || '').trim()
  return normalized ? `${base}:${normalized}` : base
}

function readSiteStorage(base: string, siteId?: string | null) {
  const scoped = siteStorageKey(base, siteId)
  const scopedValue = localStorage.getItem(scoped)
  if (scopedValue !== null) return scopedValue
  // Keep existing principal customizations after the multisite rollout.  A
  // secondary site never falls back to the principal preference.
  if (siteId === DEFAULT_SITE_ID) return localStorage.getItem(base)
  return siteId ? null : localStorage.getItem(base)
}

export function getSidebarOrder(siteId?: string | null): string[] {
  try {
    const saved = readSiteStorage(SIDEBAR_ORDER_STORAGE_KEY, siteId)
    const values: unknown = saved ? JSON.parse(saved) : null
    if (Array.isArray(values)) {
      const valid = values.filter((value): value is string => typeof value === 'string')
      if (valid.length) return valid
    }
  } catch {}
  return allNavItems.map(item => item.href)
}

export function saveSidebarOrder(order: string[], siteId?: string | null) {
  localStorage.setItem(siteStorageKey(SIDEBAR_ORDER_STORAGE_KEY, siteId), JSON.stringify(order))
}

export interface NavUser {
  role?: string
  globalRole?: string | null
  permissions?: unknown
}

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  roles: string[]
  permission?: string
  section: string
  module: string
}

export const allNavItems: NavItem[] = [
  // SECCIÓN PRINCIPAL
  { href: '/dashboard', label: 'Inicio', icon: LayoutDashboard, roles: ['ADMIN', 'CASHIER'], permission: 'cash.view', section: 'Principal', module: 'dashboard' },
  { href: '/dispatch', label: 'Despachos Activos', icon: Bike, roles: ['ADMIN', 'CASHIER', 'DISPATCHER'], permission: 'dispatch.view', section: 'Principal', module: 'dispatch' },
  { href: '/orders/new', label: 'Nuevo Pedido Domicilio', icon: PlusCircle, roles: ['ADMIN', 'CASHIER', 'DELIVERY_MANAGER'], permission: 'orders.create', section: 'Principal', module: 'orders_new' },
  { href: '/tables', label: 'Mesas', icon: UtensilsCrossed, roles: ['ADMIN', 'CASHIER', 'WAITER'], permission: 'tables.view', section: 'Principal', module: 'tables' },
  { href: '/tables/new', label: 'Nuevo Pedido Mesa', icon: PlusCircle, roles: ['ADMIN', 'CASHIER', 'WAITER'], permission: 'tables.create', section: 'Principal', module: 'tables_new' },
  { href: '/kitchen', label: 'Cocina', icon: ChefHat, roles: ['ADMIN', 'CASHIER', 'KITCHEN'], permission: 'kitchen.view', section: 'Principal', module: 'kitchen' },
  { href: '/payment-validation', label: 'Validar Pagos', icon: BadgeCheck, roles: ['ADMIN', 'CASHIER'], permission: 'payment_validation.view', section: 'Principal', module: 'payment_validation' },
  { href: '/chat', label: 'WhatsApp Chat', icon: MessageCircle, roles: ['ADMIN', 'DELIVERY_MANAGER', 'CASHIER'], permission: 'whatsapp.view', section: 'Principal', module: 'whatsapp' },
  { href: '/my-deliveries', label: 'Mis entregas', icon: Bike, roles: ['DELIVERY_DRIVER'], section: 'Principal', module: 'my_deliveries' },

  // SECCIÓN GESTIÓN
  { href: '/orders', label: 'Historial Domicilios', icon: ScrollText, roles: ['ADMIN', 'CASHIER', 'DELIVERY_MANAGER', 'DISPATCHER'], permission: 'orders.view', section: 'Gestion', module: 'orders_history' },
  { href: '/tables/history', label: 'Historial Pedidos Mesa', icon: ScrollText, roles: ['ADMIN', 'CASHIER', 'WAITER'], permission: 'tables.view', section: 'Gestion', module: 'tables_history' },
  { href: '/customers', label: 'Clientes', icon: Users, roles: ['ADMIN', 'CASHIER', 'DELIVERY_MANAGER'], permission: 'customers.view', section: 'Gestion', module: 'customers' },
  { href: '/drivers', label: 'Domiciliarios', icon: Bike, roles: ['ADMIN', 'CASHIER', 'DISPATCHER'], permission: 'drivers.view', section: 'Gestion', module: 'drivers' },
  { href: '/products', label: 'Productos y Menu', icon: PackagePlus, roles: ['ADMIN'], permission: 'products.view', section: 'Gestion', module: 'products' },
  { href: '/zones', label: 'Barrios y Tarifas', icon: MapPin, roles: ['ADMIN', 'CASHIER', 'DELIVERY_MANAGER'], permission: 'zones.view', section: 'Gestion', module: 'zones' },
  { href: '/cash-registers', label: 'Cajas Registradoras', icon: Wallet, roles: ['ADMIN', 'CASHIER'], permission: 'cash.view', section: 'Gestion', module: 'cash_registers' },
  { href: '/cash-control', label: 'Control de Caja y Turnos', icon: BarChart3, roles: ['ADMIN'], permission: 'cash.control', section: 'Gestion', module: 'cash_control' },

  // SECCIÓN ADMINISTRACIÓN
  { href: '/users', label: 'Usuarios', icon: Users, roles: ['ADMIN'], permission: 'users.view', section: 'Administracion', module: 'users' },
  { href: '/settings/kitchen-stations', label: 'Estaciones Cocina', icon: ChefHat, roles: ['ADMIN'], permission: 'kitchen_stations.manage', section: 'Administracion', module: 'kitchen_stations' },
  { href: '/settings/modules', label: 'Configuracion', icon: Settings, roles: ['ADMIN', 'SUPERADMIN'], permission: 'settings.modules', section: 'Administracion', module: 'settings' },

  // SECCIÓN SUPERADMIN
  { href: '/superadmin', label: 'Panel', icon: Crown, roles: ['SUPERADMIN'], section: 'SuperAdmin', module: 'superadmin' },
  { href: '/superadmin/sites', label: 'Sedes', icon: Building2, roles: ['SUPERADMIN'], section: 'SuperAdmin', module: 'superadmin' },
  { href: '/superadmin/config', label: 'Configuración técnica', icon: Settings, roles: ['SUPERADMIN'], section: 'SuperAdmin', module: 'superadmin' },
  { href: '/superadmin/audit-logs', label: 'Auditoría y errores', icon: ScrollText, roles: ['SUPERADMIN'], section: 'SuperAdmin', module: 'superadmin' },
  { href: '/superadmin/maintenance', label: 'Estado y mantenimiento', icon: HardDrive, roles: ['SUPERADMIN'], section: 'SuperAdmin', module: 'superadmin' },
]

export function getHiddenModules(siteId?: string | null): string[] {
  try {
    const saved = readSiteStorage(MODULE_VISIBILITY_STORAGE_KEY, siteId)
    const values: unknown = saved ? JSON.parse(saved) : []
    return sanitizeHiddenModules(values)
  } catch {
    return []
  }
}

export function sanitizeHiddenModules(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(value => /^[a-z][a-z0-9_]{0,63}$/.test(value))
    // Configuración y SuperAdmin son rutas de recuperación permanentes.
    .filter(value => !PERMANENT_MODULES.has(value)))]
    .slice(0, 64)
}

export function saveHiddenModules(hiddenModules: unknown, siteId?: string | null) {
  const sanitized = sanitizeHiddenModules(hiddenModules)
  localStorage.setItem(
    siteStorageKey(MODULE_VISIBILITY_STORAGE_KEY, siteId),
    JSON.stringify(sanitized),
  )
  window.dispatchEvent(new CustomEvent('the-villa-dog-modules-changed', {
    detail: { siteId: siteId || null, hiddenModules: sanitized },
  }))
  return sanitized
}

export function hasNavItemAccess(user: NavUser | null | undefined, item: NavItem) {
  if (!user) return false
  // La gestión de sedes es el único acceso del ADMIN_GENERAL dentro del
  // bloque técnico. Las demás pantallas SuperAdmin siguen reservadas al
  // SuperAdmin real.
  if (item.href === '/superadmin/sites') {
    return user.globalRole === 'SUPERADMIN' || user.globalRole === 'ADMIN_GENERAL' || user.role === 'SUPERADMIN'
  }
  if (item.section === 'SuperAdmin' || (item.roles.length === 1 && item.roles[0] === 'SUPERADMIN')) {
    return user.role === 'SUPERADMIN'
  }

  // El portal de entregas es exclusivo del domiciliario. El superadmin puede
  // consultar y administrar el historial desde "Domiciliarios", pero no debe
  // recibir el portal operativo que solo funciona con la sesión del repartidor.
  if (item.href === '/my-deliveries') {
    return user.role === 'DELIVERY_DRIVER'
  }

  if (user.role === 'SUPERADMIN') return true

  // Meseras (WAITER): Exclusivamente mesas y ventas de salón
  if (user.role === 'WAITER') {
    return ['/tables', '/tables/new', '/tables/history'].includes(item.href)
  }

  // Cocineros (KITCHEN): Exclusivamente cocina
  if (user.role === 'KITCHEN') {
    return ['/kitchen'].includes(item.href)
  }

  // Los domiciliarios no navegan módulos operativos generales. El servidor
  // también verifica que cada pedido mostrado y cobrado les pertenezca.
  if (user.role === 'DELIVERY_DRIVER') {
    return item.href === '/my-deliveries'
  }

  if (item.permission) return hasUserPermission(user, item.permission)
  return item.roles.includes(user.role || '')
}

export function getFirstAllowedPath(user: NavUser | null | undefined, siteId?: string | null) {
  if (user?.role === 'DELIVERY_DRIVER') return '/my-deliveries'
  const hiddenModules = getHiddenModules(siteId)
  return allNavItems.find(item => hasNavItemAccess(user, item) && !hiddenModules.includes(item.module))?.href
}
