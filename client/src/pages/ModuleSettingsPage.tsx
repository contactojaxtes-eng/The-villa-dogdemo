import { useMemo, useState } from 'react'
import {
  BadgeCheck,
  Bike,
  ChefHat,
  CheckCircle2,
  Eye,
  EyeOff,
  LayoutDashboard,
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
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { alerts } from '@/lib/alerts'
import { useAuth } from '@/hooks/useAuth'
import {
  allNavItems,
  getHiddenModules,
  hasNavItemAccess,
  MODULE_VISIBILITY_STORAGE_KEY,
  type NavItem,
} from '@/lib/navigation'

interface ModuleDef {
  id: string
  name: string
  description: string
  icon: any
  section: string
  paths: string[]
}

const MODULE_DEFINITIONS: ModuleDef[] = [
  {
    id: 'dashboard',
    name: 'Inicio y Métricas',
    description: 'Resumen ejecutivo de ventas del día, pedidos y estado de caja.',
    icon: LayoutDashboard,
    section: 'Principal',
    paths: ['/dashboard'],
  },
  {
    id: 'dispatch',
    name: 'Despachos Activos',
    description: 'Tablero de pedidos en ruta, asignación de domiciliarios y entregas.',
    icon: Bike,
    section: 'Principal',
    paths: ['/dispatch'],
  },
  {
    id: 'orders',
    name: 'Pedidos (POS y Historial)',
    description: 'Toma de nuevos pedidos, caja rápida e historial completo de comandas.',
    icon: ScrollText,
    section: 'Principal & Gestión',
    paths: ['/orders/new', '/orders'],
  },
  {
    id: 'tables',
    name: 'Mesas y Salón',
    description: 'Gestión de mesas abiertas, toma de pedidos de salón y cuentas.',
    icon: UtensilsCrossed,
    section: 'Principal',
    paths: ['/tables', '/tables/new'],
  },
  {
    id: 'kitchen',
    name: 'Cocina y Estaciones',
    description: 'Pantalla de preparación de comandas en tiempo real y configuración de estaciones.',
    icon: ChefHat,
    section: 'Principal & Admin',
    paths: ['/kitchen', '/settings/kitchen-stations'],
  },
  {
    id: 'payment_validation',
    name: 'Validación de Pagos',
    description: 'Revisión y aprobación de transferencias bancarias (Nequi, Bancolombia, Daviplata).',
    icon: BadgeCheck,
    section: 'Principal',
    paths: ['/payment-validation'],
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Chat',
    description: 'Conversaciones con clientes, toma directa de pedidos y soporte.',
    icon: MessageCircle,
    section: 'Principal',
    paths: ['/chat'],
  },
  {
    id: 'customers',
    name: 'Clientes',
    description: 'Directorio de clientes frecuentes, direcciones guardadas y créditos.',
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
    description: 'Catálogo de platos, precios, adiciones, combos y disponibilidad.',
    icon: PackagePlus,
    section: 'Gestión',
    paths: ['/products'],
  },
  {
    id: 'zones',
    name: 'Barrios y Tarifas',
    description: 'Configuración de tarifas de envío por barrio en Montería.',
    icon: MapPin,
    section: 'Gestión',
    paths: ['/zones'],
  },
  {
    id: 'cash',
    name: 'Cajas y Turnos',
    description: 'Aperturas de caja, arqueos, registro de gastos y cierres de turno.',
    icon: Wallet,
    section: 'Gestión',
    paths: ['/cash-registers', '/cash-control'],
  },
  {
    id: 'users',
    name: 'Usuarios y Roles',
    description: 'Gestión de personal, asignación de roles y matriz de permisos por empleado.',
    icon: Users,
    section: 'Administración',
    paths: ['/users'],
  },
  {
    id: 'settings',
    name: 'Configuración del Sistema',
    description: 'Visibilidad de módulos del menú y personalización operativa.',
    icon: Settings,
    section: 'Administración',
    paths: ['/settings/modules'],
  },
]

export default function ModuleSettingsPage() {
  const { user } = useAuth()
  const [hiddenModules, setHiddenModules] = useState<string[]>(() => getHiddenModules())

  const accessibleModules = useMemo(() => {
    return MODULE_DEFINITIONS.filter(def => {
      // Verificar si el usuario tiene permiso para al menos una ruta de este módulo
      return allNavItems.some(item => item.module === def.id && hasNavItemAccess(user, item))
    })
  }, [user])

  const persist = (next: string[]) => {
    setHiddenModules(next)
    localStorage.setItem(MODULE_VISIBILITY_STORAGE_KEY, JSON.stringify(next))
    window.dispatchEvent(new Event('the-villa-dog-modules-changed'))
  }

  const toggleModule = (moduleId: string) => {
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

  const hideAllExceptEssential = () => {
    // Mantener activos los módulos básicos (dashboard, orders, tables, kitchen)
    const essentials = ['dashboard', 'orders', 'tables', 'kitchen', 'cash', 'settings']
    const toHide = accessibleModules.filter(m => !essentials.includes(m.id)).map(m => m.id)
    persist(toHide)
    alerts.success('Vista Simplificada Activada', 'Se ocultaron los módulos secundarios del menú.')
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
            Personaliza qué secciones aparecen en la barra lateral para trabajar de forma ágil y ordenada.
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
            onClick={hideAllExceptEssential}
            className="h-10 px-4 rounded-xl border-[var(--border-default)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] font-bold text-xs gap-2 cursor-pointer"
            title="Mostrar solo módulos esenciales (Mesas, Pedidos, Cocina, Caja)"
          >
            <Sparkles className="h-4 w-4 text-[var(--accent)]" />
            Modo Salón & Cocina
          </Button>
        </div>
      </div>

      {/* Barra de Estado */}
      <div className="flex items-center justify-between p-4 rounded-2xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] shadow-sm">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-sm font-bold text-[var(--text-primary)]">
            Estado del Menú Lateral:
          </span>
          <span className="text-xs text-[var(--text-muted)]">
            <strong className="text-emerald-600 dark:text-emerald-400">{activeCount}</strong> visibles de <strong className="text-[var(--text-primary)]">{accessibleModules.length}</strong> disponibles
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

      {/* Grid de Módulos */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {accessibleModules.map(module => {
          const Icon = module.icon
          const isVisible = !hiddenModules.includes(module.id)

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
                  {isVisible ? 'Visible en la barra lateral' : 'Oculto de la barra lateral'}
                </span>

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
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
