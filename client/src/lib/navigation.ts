import { hasUserPermission } from '@/lib/permissions'
import {
  BadgeCheck,
  BarChart3,
  Bike,
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

export const MODULE_VISIBILITY_STORAGE_KEY = 'the_villa_dog_hidden_modules'
export const SIDEBAR_ORDER_STORAGE_KEY = 'the_villa_dog_sidebar_order'

export interface NavUser {
  role?: string
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
  { href: '/superadmin/config', label: 'Configuración técnica', icon: Settings, roles: ['SUPERADMIN'], section: 'SuperAdmin', module: 'superadmin' },
  { href: '/superadmin/audit-logs', label: 'Auditoría y errores', icon: ScrollText, roles: ['SUPERADMIN'], section: 'SuperAdmin', module: 'superadmin' },
  { href: '/superadmin/maintenance', label: 'Estado y mantenimiento', icon: HardDrive, roles: ['SUPERADMIN'], section: 'SuperAdmin', module: 'superadmin' },
]

export function getHiddenModules(): string[] {
  try {
    const saved = localStorage.getItem(MODULE_VISIBILITY_STORAGE_KEY)
    const values: unknown = saved ? JSON.parse(saved) : []
    const list = Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string') : []
    // 'settings' y 'superadmin' NUNCA pueden ser ocultados para evitar bloqueos
    return list.filter(id => id !== 'settings' && id !== 'superadmin')
  } catch {
    return []
  }
}

export function hasNavItemAccess(user: NavUser | null | undefined, item: NavItem) {
  if (!user) return false
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

export function getFirstAllowedPath(user: NavUser | null | undefined) {
  if (user?.role === 'DELIVERY_DRIVER') return '/my-deliveries'
  const hiddenModules = getHiddenModules()
  return allNavItems.find(item => hasNavItemAccess(user, item) && !hiddenModules.includes(item.module))?.href
}
