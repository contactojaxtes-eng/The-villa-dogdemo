import { useMemo, useState } from 'react'
import {
  BadgeCheck,
  BarChart3,
  Bike,
  ChefHat,
  CheckCircle2,
  Eye,
  EyeOff,
  LayoutDashboard,
  Lock,
  MapPin,
  MessageCircle,
  PackagePlus,
  PlusCircle,
  RotateCcw,
  ScrollText,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Users,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { alerts } from '@/lib/alerts'
import { useAuth } from '@/hooks/useAuth'
import {
  allNavItems,
  getHiddenModules,
  hasNavItemAccess,
  MODULE_VISIBILITY_STORAGE_KEY,
} from '@/lib/navigation'

interface ModuleDef {
  id: string
  name: string
  description: string
  icon: any
  section: string
  paths: string[]
  isPermanent?: boolean
}

const MODULE_DEFINITIONS: ModuleDef[] = [
  // ── SALÓN Y MESAS ──
  {
    id: 'tables',
    name: 'Mesas Abiertas (Salón)',
    description: 'Gestión de mesas activas, estado de cocina y cobros del salón.',
    icon: UtensilsCrossed,
    section: 'Salón',
    paths: ['/tables'],
  },
  {
    id: 'tables_new',
    name: 'Nuevo Pedido Mesa',
    description: 'Toma rápida de pedidos de salón para abrir mesas automáticamente.',
    icon: PlusCircle,
    section: 'Salón',
    paths: ['/tables/new'],
  },
  {
    id: 'tables_history',
    name: 'Historial Pedidos Mesa',
    description: 'Historial completo de pedidos y cuentas cerradas en salón.',
    icon: ScrollText,
    section: 'Salón',
    paths: ['/tables/history'],
  },

  // ── DOMICILIOS Y DESPACHOS ──
  {
    id: 'dispatch',
    name: 'Despachos Activos (Domicilios)',
    description: 'Tablero de pedidos en ruta, asignación de domiciliarios y entregas.',
    icon: Bike,
    section: 'Domicilios',
    paths: ['/dispatch'],
  },
  {
    id: 'orders_new',
    name: 'Nuevo Pedido Domicilio',
    description: 'Toma rápida de pedidos de mostrador y pedidos para despacho.',
    icon: PlusCircle,
    section: 'Domicilios',
    paths: ['/orders/new'],
  },
  {
    id: 'orders_history',
    name: 'Historial Domicilios',
    description: 'Consulta de pedidos despachados, entregados y cancelados.',
    icon: ScrollText,
    section: 'Domicilios',
    paths: ['/orders'],
  },

  // ── COCINA ──
  {
    id: 'kitchen',
    name: 'Pantalla de Cocina en Vivo',
    description: 'Pantalla de preparación de comandas en tiempo real.',
    icon: ChefHat,
    section: 'Cocina',
    paths: ['/kitchen'],
  },
  {
    id: 'kitchen_stations',
    name: 'Estaciones de Cocina',
    description: 'Configuración de áreas de cocción y categorías asignadas a cocineros.',
    icon: ChefHat,
    section: 'Cocina',
    paths: ['/settings/kitchen-stations'],
  },

  // ── CAJA Y FINANZAS ──
  {
    id: 'cash_registers',
    name: 'Cajas Registradoras',
    description: 'Creación de cajas, saldos y asignación de cajeros.',
    icon: Wallet,
    section: 'Caja',
    paths: ['/cash-registers'],
  },
  {
    id: 'cash_control',
    name: 'Control de Caja y Turnos',
    description: 'Aperturas de turno, arqueos, registro de gastos y cierres de caja.',
    icon: BarChart3,
    section: 'Caja',
    paths: ['/cash-control'],
  },
  {
    id: 'payment_validation',
    name: 'Validación de Pagos',
    description: 'Revisión y confirmación de transferencias (Nequi, Bancolombia, Daviplata).',
    icon: BadgeCheck,
    section: 'Caja',
    paths: ['/payment-validation'],
  },

  // ── OPERACIÓN Y GESTIÓN ──
  {
    id: 'whatsapp',
    name: 'WhatsApp Chat',
    description: 'Conversaciones con clientes, pedidos automáticos y atención.',
    icon: MessageCircle,
    section: 'Gestión',
    paths: ['/chat'],
  },
  {
    id: 'customers',
    name: 'Clientes',
    description: 'Directorio de clientes frecuentes, direcciones y cartera.',
    icon: Users,
    section: 'Gestión',
    paths: ['/customers'],
  },
  {
    id: 'drivers',
    name: 'Domiciliarios',
    description: 'Directorio de repartidores en turno, liquidaciones y conteo de viajes.',
    icon: Bike,
    section: 'Gestión',
    paths: ['/drivers'],
  },
  {
    id: 'products',
    name: 'Productos y Menú',
    description: 'Catálogo de platos, precios, combos y recetas.',
    icon: PackagePlus,
    section: 'Gestión',
    paths: ['/products'],
  },
  {
    id: 'zones',
    name: 'Barrios y Tarifas',
    description: 'Configuración de tarifas de flete y zonas de entrega en Montería.',
    icon: MapPin,
    section: 'Gestión',
    paths: ['/zones'],
  },

  // ── ADMINISTRACIÓN Y PRINCIPAL ──
  {
    id: 'dashboard',
    name: 'Inicio y Métricas',
    description: 'Resumen ejecutivo de ventas del día, pedidos y balance.',
    icon: LayoutDashboard,
    section: 'Principal',
    paths: ['/dashboard'],
  },
  {
    id: 'users',
    name: 'Usuarios y Roles',
    description: 'Gestión de personal, asignación de roles y permisos.',
    icon: Users,
    section: 'Administración',
    paths: ['/users'],
  },
  {
    id: 'settings',
    name: 'Configuración del Sistema',
    description: 'Módulo administrativo permanente para gestionar visibilidad del sistema.',
    icon: Settings,
    section: 'Administración',
    paths: ['/settings/modules'],
    isPermanent: true,
  },
]

export default function ModuleSettingsPage() {
  const { user } = useAuth()
  const [hiddenModules, setHiddenModules] = useState<string[]>(() => getHiddenModules())

  const accessibleModules = useMemo(() => {
    return MODULE_DEFINITIONS.filter(def => {
      return allNavItems.some(item => item.module === def.id && hasNavItemAccess(user, item))
    })
  }, [user])

  const persist = (next: string[]) => {
    // Sanitizar para que 'settings' nunca quede en la lista de ocultos
    const sanitized = next.filter(id => id !== 'settings' && id !== 'superadmin')
    setHiddenModules(sanitized)
    localStorage.setItem(MODULE_VISIBILITY_STORAGE_KEY, JSON.stringify(sanitized))
    window.dispatchEvent(new Event('the-villa-dog-modules-changed'))
  }

  const toggleModule = (moduleId: string) => {
    if (moduleId === 'settings' || moduleId === 'superadmin') {
      alerts.warning('Módulo permanente', 'La Configuración del Sistema siempre debe permanecer visible para evitar bloqueos.')
      return
    }

    const next = hiddenModules.includes(moduleId)
      ? hiddenModules.filter(id => id !== moduleId)
      : [...hiddenModules, moduleId]
    persist(next)
    alerts.toast(
      next.includes(moduleId) ? 'Módulo ocultado del menú' : 'Módulo activado en el menú'
    )
  }

  const showAll = () => {
    persist([])
    alerts.success('Menú Completo Activado', 'Todos los módulos están ahora visibles en la barra lateral.')
  }

  const hideAllExceptSalon = () => {
    // Modo Salón: mantener activo mesas, cocina, productos y caja
    const essentials = ['tables', 'tables_new', 'tables_history', 'kitchen', 'cash_registers', 'cash_control', 'settings', 'dashboard']
    const toHide = accessibleModules.filter(m => !essentials.includes(m.id) && !m.isPermanent).map(m => m.id)
    persist(toHide)
    alerts.success('Modo Salón Activado', 'Se ocultaron domicilios, chats y secciones no requeridas en salón.')
  }

  const activeCount = accessibleModules.filter(m => !hiddenModules.includes(m.id)).length

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-black text-[var(--text-primary)] antifont tracking-wider">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)]">
              <SlidersHorizontal className="h-5 w-5" />
            </div>
            CONFIGURACIÓN DE MÓDULOS
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Activa o desactiva cada módulo de forma 100% independiente para adaptar el sistema a tu operación.
          </p>
        </div>

        {/* Acciones Rápidas */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={showAll}
            className="h-10 px-4 rounded-xl border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold text-xs gap-2 cursor-pointer shadow-sm"
          >
            <CheckCircle2 className="h-4 w-4" />
            Mostrar Todos ({accessibleModules.length})
          </Button>

          <Button
            variant="outline"
            onClick={hideAllExceptSalon}
            className="h-10 px-4 rounded-xl border-[var(--border-default)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] font-bold text-xs gap-2 cursor-pointer"
            title="Activar solo módulos esenciales de Salón y Mesas"
          >
            <Sparkles className="h-4 w-4 text-[var(--accent)]" />
            Modo Solo Mesas
          </Button>
        </div>
      </div>

      {/* Barra de Estado */}
      <div className="flex items-center justify-between p-4 rounded-2xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-sm font-bold text-[var(--text-primary)]">
            Módulos Visibles:
          </span>
          <span className="text-xs text-[var(--text-muted)]">
            <strong className="text-emerald-600 dark:text-emerald-400">{activeCount}</strong> activos de <strong className="text-[var(--text-primary)]">{accessibleModules.length}</strong> disponibles
          </span>
        </div>

        {hiddenModules.length > 0 && (
          <button
            type="button"
            onClick={showAll}
            className="text-xs font-bold text-[var(--accent)] hover:underline flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restablecer todo
          </button>
        )}
      </div>

      {/* Grid de Módulos Separados */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {accessibleModules.map(module => {
          const Icon = module.icon
          const isVisible = !hiddenModules.includes(module.id)
          const isPermanent = module.isPermanent

          return (
            <Card
              key={module.id}
              className={`p-5 rounded-2xl border transition-all duration-200 flex flex-col justify-between ${
                isVisible
                  ? 'border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-sm hover:border-[var(--border-default)]'
                  : 'border-rose-500/20 bg-rose-500/[0.02] opacity-75'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3.5 min-w-0">
                  <div
                    className={`h-11 w-11 rounded-2xl flex items-center justify-center shrink-0 transition-colors ${
                      isVisible
                        ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                        : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-bold text-[var(--text-primary)]">
                        {module.name}
                      </h3>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--bg-elevated)] text-[var(--text-muted)] uppercase">
                        {module.section}
                      </span>
                    </div>

                    <p className="text-xs text-[var(--text-secondary)] mt-1 line-clamp-2">
                      {module.description}
                    </p>

                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      {module.paths.map(p => (
                        <span key={p} className="text-[10px] font-mono text-[var(--text-muted)] bg-[var(--bg-subtle)] px-2 py-0.5 rounded-md border border-[var(--border-subtle)]">
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer Switch Button */}
              <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--text-muted)]">
                  {isPermanent
                    ? '🔒 Siempre visible (Administración)'
                    : isVisible
                    ? 'Visible en la barra lateral'
                    : 'Oculto de la barra lateral'}
                </span>

                {isPermanent ? (
                  <span className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                    <Lock className="h-3.5 w-3.5" />
                    <span>Permanente</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleModule(module.id)}
                    className={`inline-flex h-9 items-center justify-center gap-2 rounded-xl px-4 text-xs font-bold transition-all cursor-pointer shadow-sm ${
                      isVisible
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 border border-rose-500/20'
                    }`}
                  >
                    {isVisible ? (
                      <>
                        <Eye className="h-4 w-4" />
                        <span>Visible</span>
                      </>
                    ) : (
                      <>
                        <EyeOff className="h-4 w-4" />
                        <span>Oculto</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
