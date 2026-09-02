import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Sidebar } from './Sidebar'
import { Menu, Eye, LogOut } from 'lucide-react'
import { BrandLogo } from '@/components/brand/BrandLogo'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import { ErrorBoundary } from '../ErrorBoundary'
import { autoReconnectUsbDevices } from '@/lib/useUsbPrinter'
import { ForceEmailVerificationModal } from '@/components/auth/ForceEmailVerificationModal'

export function AppLayout() {
  const location = useLocation()
  const { user, isImpersonating, stopImpersonation } = useAuth()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true')

  // Auto-reconnect WebUSB printers silently on mount
  useEffect(() => {
    autoReconnectUsbDevices(['caja', 'cocina', 'bar']).catch(() => {})
  }, [])

  // Close mobile sidebar on navigation
  useEffect(() => {
    setIsMobileMenuOpen(false)
  }, [location.pathname])

  return (
    <div className={cn("flex h-screen overflow-hidden bg-[var(--bg-base)]", user?.role === 'SUPERADMIN' && "superadmin-shell")}>
      {/* Desktop Sidebar */}
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

      {/* Mobile Drawer Sidebar */}
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
              className="fixed inset-y-0 left-0 z-50 w-64 md:hidden"
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

        {/* Mobile Top Header */}
        <header className="flex h-16 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-panel)] px-4 md:hidden shrink-0">
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="rounded-xl p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] active:scale-95 transition-all cursor-pointer"
            aria-label="Abrir menú"
          >
            <Menu className="h-6 w-6" />
          </button>
          <div className="flex rounded-2xl bg-[var(--bg-base)] py-1.5 px-3 border border-[var(--border-subtle)]">
            <BrandLogo compact imageClassName="w-24" />
          </div>
          <div className="w-10" /> {/* Spacer to center the logo */}
        </header>

        <main className="flex-1 overflow-y-auto p-3 md:p-6">
          <div className="mx-auto max-w-7xl h-full">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>

      <ForceEmailVerificationModal />
    </div>
  )
}

