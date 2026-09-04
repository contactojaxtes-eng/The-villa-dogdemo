import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Sidebar } from './Sidebar'
import { Menu, Eye, LogOut, PlusCircle, ScrollText, UtensilsCrossed, ChefHat, Clock, Maximize, Minimize, Moon, Sun, Bell, BellOff } from 'lucide-react'
import { BrandLogo } from '@/components/brand/BrandLogo'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'
import { ErrorBoundary } from '../ErrorBoundary'
import { autoReconnectUsbDevices } from '@/lib/useUsbPrinter'
import { ForceEmailVerificationModal } from '@/components/auth/ForceEmailVerificationModal'
import { isNotificationsMuted, toggleNotificationsMuted } from '@/lib/notificationSettings'

export function AppLayout() {
  const location = useLocation()
  const { user, isImpersonating, stopImpersonation, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true')
  // Modo pantalla completa exclusiva de tablet: ÚNICAMENTE para usuarios con rol KITCHEN (cocineros).
  // Administradores y cajeros ven la barra lateral normal para navegar fluidamente.
  const isDedicatedKitchen = user?.role === 'KITCHEN'
  const isKitchen = isDedicatedKitchen || location.pathname === '/kitchen'
  // Las meseras operan exclusivamente con la barra inferior nativa (Mesas, Nuevo Pedido, Historial)
  const isWaiter = user?.role === 'WAITER'

  const [isFullscreen, setIsFullscreen] = useState(false)
  const [timeStr, setTimeStr] = useState(() => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
  const [isMuted, setIsMuted] = useState(() => isNotificationsMuted())

  useEffect(() => {
    const syncMute = () => setIsMuted(isNotificationsMuted())
    window.addEventListener('storage', syncMute)
    window.addEventListener('the-villa-dog-mute-changed', syncMute)
    return () => {
      window.removeEventListener('storage', syncMute)
      window.removeEventListener('the-villa-dog-mute-changed', syncMute)
    }
  }, [])

  const handleToggleMute = () => {
    const next = toggleNotificationsMuted()
    setIsMuted(next)
  }

  // Auto-reconnect WebUSB printers silently on mount
  useEffect(() => {
    autoReconnectUsbDevices(['caja', 'cocina', 'bar']).catch(() => {})
  }, [])

  // Close mobile sidebar on navigation
  useEffect(() => {
    setIsMobileMenuOpen(false)
  }, [location.pathname])

  // Reloj en vivo para tablet de cocina
  useEffect(() => {
    if (!isDedicatedKitchen) return
    const timer = setInterval(() => {
      setTimeStr(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    }, 1000)
    return () => clearInterval(timer)
  }, [isDedicatedKitchen])

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {})
      setIsFullscreen(true)
    } else {
      document.exitFullscreen?.().catch(() => {})
      setIsFullscreen(false)
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-base)]">
      {/* Desktop Sidebar: Oculta en modo Cocinero dedicado (Tablet KITCHEN) y para Meseras (WAITER) */}
      {!isDedicatedKitchen && !isWaiter && (
        <div className="hidden md:flex shrink-0 overflow-visible">
          <Sidebar 
            isCollapsed={isCollapsed} 
            onToggleCollapse={() => {
              const next = !isCollapsed
              setIsCollapsed(next)
              localStorage.setItem('sidebar-collapsed', String(next))
            }} 
          />
        </div>
      )}

      {/* Mobile Drawer Sidebar (solo si no es cocina ni mesero) */}
      {!isDedicatedKitchen && !isWaiter && (
        <AnimatePresence>
          {isMobileMenuOpen && (
            <>
              {/* Backdrop */}
              <motion.div
                className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsMobileMenuOpen(false)}
              />
              {/* Drawer Container */}
              <motion.div
                className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] h-[100dvh] max-h-[100dvh] md:hidden flex flex-col overflow-hidden shadow-2xl"
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              >
                <Sidebar onClose={() => setIsMobileMenuOpen(false)} />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Impersonation Banner */}
        {isImpersonating && (
          <div className="flex shrink-0 items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-xs font-bold text-black">
            <Eye className="h-4 w-4" />
            <span>Estás operando como <strong>{user?.name}</strong> · Sesión de soporte SuperAdmin</span>
            <button
              onClick={() => stopImpersonation()}
              className="ml-2 flex items-center gap-1 rounded-lg bg-black/15 px-2.5 py-1 uppercase tracking-wide hover:bg-black/25 transition-colors cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" /> Volver a mi cuenta
            </button>
          </div>
        )}

        {/* Kitchen Top Bar (Barra superior dedicada para Tablets de Cocina) */}
        {isDedicatedKitchen ? (
          <header className="flex h-14 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 sm:px-4 shrink-0 shadow-xs">
            <div className="flex items-center gap-2.5">
              <div className="flex rounded-xl bg-[var(--bg-base)] py-1 px-2 border border-[var(--border-subtle)]">
                <BrandLogo compact imageClassName="w-20 sm:w-24" />
              </div>
              <span className="hidden sm:inline-block h-4 w-px bg-[var(--border-subtle)]" />
              <span className="hidden sm:flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-[var(--accent)]">
                <ChefHat className="h-4 w-4" /> Pantalla de Cocina
              </span>
            </div>

            {/* Reloj del Turno */}
            <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-[var(--text-secondary)] bg-[var(--bg-elevated)] px-2.5 py-1 rounded-xl border border-[var(--border-subtle)]">
              <Clock className="h-3.5 w-3.5 text-[var(--accent)]" />
              <span>{timeStr}</span>
            </div>

            {/* Acciones para Tablet */}
            <div className="flex items-center gap-1.5">
              <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[var(--bg-elevated)] text-xs font-bold text-[var(--text-primary)] border border-[var(--border-subtle)]">
                <span>👨‍🍳 {user?.name}</span>
              </div>

              <button
                type="button"
                onClick={toggleFullScreen}
                className="h-8 w-8 rounded-xl flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition cursor-pointer"
                title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa para tablet"}
              >
                {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              </button>

              <button
                type="button"
                onClick={toggleTheme}
                className="h-8 w-8 rounded-xl flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition cursor-pointer"
                title="Cambiar tema"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>

              {user?.role === 'KITCHEN' ? (
                <button
                  type="button"
                  onClick={logout}
                  className="h-8 px-2.5 rounded-xl text-xs font-bold text-rose-500 hover:bg-rose-500/10 flex items-center gap-1 transition cursor-pointer"
                  title="Cerrar sesión de cocina"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Salir</span>
                </button>
              ) : (
                <Link
                  to="/"
                  className="h-8 px-2.5 rounded-xl text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] flex items-center gap-1 transition border border-[var(--border-subtle)]"
                  title="Volver al menú principal"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Menú</span>
                </Link>
              )}
            </div>
          </header>
        ) : (
          /* Mobile Top Header normal */
          <header className="flex h-14 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] px-3 md:hidden shrink-0">
            {!isWaiter ? (
              <button
                onClick={() => setIsMobileMenuOpen(true)}
                className="rounded-xl p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] active:scale-95 transition-all cursor-pointer"
                aria-label="Abrir menú"
              >
                <Menu className="h-6 w-6" />
              </button>
            ) : (
              <div className="w-10" />
            )}
            <div className="flex rounded-2xl bg-white py-1 px-2.5 border border-slate-200/80 shadow-2xs">
              <BrandLogo compact imageClassName="w-20" />
            </div>
            {/* Acciones directas en móvil: Notificaciones, Tema y Salir sin abrir el menú */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleToggleMute}
                className={cn(
                  "h-8 w-8 rounded-xl flex items-center justify-center transition cursor-pointer",
                  isMuted ? "text-amber-500 hover:bg-amber-500/15" : "text-emerald-500 hover:bg-emerald-500/15"
                )}
                title={isMuted ? "Notificaciones silenciadas (clic para activar)" : "Notificaciones activadas (clic para silenciar)"}
              >
                {isMuted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={toggleTheme}
                className="h-8 w-8 rounded-xl flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition cursor-pointer"
                title="Cambiar tema"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={logout}
                className="h-8 px-2 rounded-xl flex items-center gap-1 text-xs font-bold text-rose-500 hover:bg-rose-500/10 transition cursor-pointer"
                title="Cerrar sesión"
              >
                <LogOut className="h-4 w-4" />
                <span className="text-[11px]">Salir</span>
              </button>
            </div>
          </header>
        )}

        <main className={cn("flex-1 overflow-y-auto", isKitchen ? "p-2 sm:p-3" : "p-3 md:p-6 pb-32 md:pb-8")}>
          <div className={cn(isKitchen ? "w-full max-w-none" : "mx-auto max-w-7xl min-h-full")}>
            <ErrorBoundary key={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>

        {/* Waiter Native Mobile Bottom Navigation Bar */}
        {user?.role === 'WAITER' && !location.pathname.startsWith('/tables/new') && (
          <nav className="fixed bottom-0 left-0 right-0 z-30 flex h-16 items-center justify-around border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] px-2 shadow-lg md:hidden">
            <Link
              to="/tables"
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 py-1 text-xs font-black transition-all",
                location.pathname === '/tables'
                  ? "text-[var(--accent)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              )}
            >
              <UtensilsCrossed className="h-5 w-5" />
              <span>Mesas</span>
            </Link>

            <Link
              to="/tables/new"
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 py-1 text-xs font-black transition-all",
                location.pathname === '/tables/new'
                  ? "text-[var(--accent)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              )}
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-md -mt-3">
                <PlusCircle className="h-6 w-6" />
              </div>
              <span className="-mt-0.5">Nuevo Pedido</span>
            </Link>

            <Link
              to="/tables/history"
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 py-1 text-xs font-black transition-all",
                location.pathname === '/tables/history'
                  ? "text-[var(--accent)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              )}
            >
              <ScrollText className="h-5 w-5" />
              <span>Historial</span>
            </Link>
          </nav>
        )}
      </div>

      <ForceEmailVerificationModal />
    </div>
  )
}

