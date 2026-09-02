import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { BrandLogo } from '@/components/brand/BrandLogo'
import { InstallPWAButton } from '@/components/InstallPWAButton'
import { ProfileModal } from '@/components/auth/ProfileModal'
import { Sun, Moon, LogOut, Bell, BellOff } from 'lucide-react'
import { toast } from 'sonner'

const navItems = [
  { href: '/chat', label: 'WhatsApp', roles: ['ADMIN', 'SUPERADMIN', 'DELIVERY_MANAGER', 'CASHIER'] },
  { href: '/dashboard', label: 'Dashboard', roles: ['ADMIN', 'CASHIER', 'DELIVERY_MANAGER'] },
  { href: '/orders', label: 'Domicilios', roles: ['ADMIN', 'CASHIER', 'DELIVERY_MANAGER'] },
  { href: '/orders/new', label: 'Nuevo', roles: ['ADMIN', 'CASHIER', 'DELIVERY_MANAGER'] },
  { href: '/products', label: 'Productos', roles: ['ADMIN'] },
  { href: '/zones', label: 'Barrios', roles: ['ADMIN', 'SUPERADMIN', 'CASHIER', 'DELIVERY_MANAGER'] },
  { href: '/cash-registers', label: 'Caja', roles: ['ADMIN', 'CASHIER'] },
  { href: '/drivers', label: 'Repartidores', roles: ['ADMIN', 'CASHIER'] },
  { href: '/cash-control', label: 'Control de Caja', roles: ['ADMIN'] },
  { href: '/users', label: 'Usuarios', roles: ['ADMIN'] },
]

const roleLabels: Record<string, string> = {
  SUPERADMIN: 'Super Administrador',
  ADMIN: 'Administrador',
  CASHIER: 'Cajero',
  DELIVERY_MANAGER: 'Gestor Domicilios',
  WAITER: 'Mesero',
  KITCHEN: 'Cocinero',
  ACCOUNTANT: 'Contador',
  ACCOUNTING_ASSISTANT: 'Auxiliar Contable',
}

export function TopNav() {
  const location = useLocation()
  const { user, hasRole, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()

  const filteredItems = navItems.filter(item => hasRole(...item.roles))
  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
  const [isMutedWa, setIsMutedWa] = useState(() => localStorage.getItem('niche_mute_wa_toasts') === 'true')
  const [showProfileModal, setShowProfileModal] = useState(false)

  const toggleMuteWa = () => {
    const next = !isMutedWa
    setIsMutedWa(next)
    localStorage.setItem('niche_mute_wa_toasts', String(next))
    if (next) {
      toast.info('🔕 Avisos emergentes silenciados', {
        description: 'No recibirás popups de cada mensaje de WhatsApp.',
        duration: 3000,
      })
    } else {
      toast.success('🔔 Avisos emergentes activados', {
        description: 'Recibirás avisos de mensajes entrantes.',
        duration: 3000,
      })
    }
  }

  return (
    <motion.div
      className="sticky top-0 z-50 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)]/85 backdrop-blur-md shadow-sm"
      initial={{ y: -64, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const }}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 lg:px-6">
        <Link to="/dashboard" className="-ml-3 mr-2 flex shrink-0 items-center rounded-2xl bg-[#0E0E10] py-2 px-3.5 shadow-sm border border-white/5 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]">
          <BrandLogo compact imageClassName="w-24 md:w-28" />
        </Link>

        <nav className="flex flex-1 items-center gap-1 overflow-x-auto no-scrollbar">
          {filteredItems.map((item, index) => {
            const isActive = location.pathname === item.href || (item.href !== '/orders/new' && location.pathname.startsWith(item.href + '/'))
            return (
              <motion.div
                key={item.href}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + index * 0.04, duration: 0.3 }}
              >
                <Link
                  to={item.href}
                  className={cn(
                    'relative rounded-xl px-3.5 py-2 text-sm whitespace-nowrap transition-all duration-200 font-medium z-10',
                    isActive
                      ? 'text-[var(--accent)] font-semibold'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="topnav-active-indicator"
                      className="absolute inset-0 bg-[var(--accent-muted)] rounded-xl -z-10 shadow-inner"
                      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    />
                  )}
                  <span className="relative">{item.label}</span>
                </Link>
              </motion.div>
            )
          })}
        </nav>

        <motion.div
          className="ml-2 flex shrink-0 items-center gap-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.4 }}
        >
          <InstallPWAButton />
          <Button
            variant="ghost"
            size="icon"
            className="h-8.5 w-8.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] rounded-xl"
            onClick={toggleTheme}
            aria-label="Cambiar tema"
          >
            {theme === 'dark' ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
          </Button>
          <button
            onClick={toggleMuteWa}
            className={cn(
              "relative rounded-xl p-2 transition-all cursor-pointer",
              isMutedWa
                ? "text-amber-500/80 hover:bg-amber-500/10 hover:text-amber-500"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            )}
            title={isMutedWa ? "Avisos emergentes silenciados (Clic para activar)" : "Avisos emergentes activados (Clic para silenciar)"}
            aria-label="Silenciar o activar notificaciones de chat"
          >
            {isMutedWa ? (
              <BellOff className="h-4.5 w-4.5 text-amber-500" />
            ) : (
              <Bell className="h-4.5 w-4.5" />
            )}
            {isMutedWa && (
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-[var(--bg-panel)]" />
            )}
          </button>
          <div 
            className="flex items-center gap-2 border-l border-[var(--border-subtle)] pl-2 cursor-pointer group hover:opacity-90 transition-all"
            onClick={() => setShowProfileModal(true)}
            title="Mi Perfil y Cambiar Contraseña"
          >
            <Avatar className="h-8.5 w-8.5 ring-2 ring-[var(--border-subtle)] group-hover:ring-[var(--accent)] transition-all">
              <AvatarFallback className="bg-[var(--accent)] text-xs text-[var(--accent-fg)] font-bold">{user ? getInitials(user.name) : '??'}</AvatarFallback>
            </Avatar>
            <div className="hidden md:block text-left">
              <p className="text-xs leading-tight font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">{user?.name || 'Usuario'}</p>
              <Badge variant="outline" className="h-4 border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1 py-0 text-[9px] text-[var(--text-secondary)] font-semibold">{roleLabels[user?.role || ''] || user?.role || 'Equipo'}</Badge>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8.5 w-8.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--destructive)] rounded-xl"
            onClick={logout}
            aria-label="Cerrar sesión"
          >
            <LogOut className="h-4.5 w-4.5" />
          </Button>
        </motion.div>
      </div>

      {/* User Profile & Security Modal */}
      <ProfileModal open={showProfileModal} onClose={() => setShowProfileModal(false)} />
    </motion.div>
  )
}
