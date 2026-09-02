import { Link, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'
import {
  allNavItems,
  getFirstAllowedPath,
  getHiddenModules,
  hasNavItemAccess,
  SIDEBAR_ORDER_STORAGE_KEY,
  type NavItem,
} from '@/lib/navigation'
import { BrandLogo } from '@/components/brand/BrandLogo'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ChevronLeft, ChevronRight, Crown, LogOut, Moon, Sun, X } from 'lucide-react'

const roleLabels: Record<string, string> = {
  SUPERADMIN: 'Super Administrador',
  ADMIN: 'Administrador',
  CASHIER: 'Cajero',
  DELIVERY_MANAGER: 'Gestor de Domicilios',
  WAITER: 'Mesero',
  KITCHEN: 'Cocinero',
  ACCOUNTANT: 'Contador',
  ACCOUNTING_ASSISTANT: 'Auxiliar Contable',
}

interface SidebarProps {
  onClose?: () => void
  isCollapsed?: boolean
  onToggleCollapse?: () => void
}

export function Sidebar({ onClose, isCollapsed = false, onToggleCollapse }: SidebarProps) {
  const location = useLocation()
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const initials = user?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '??'
  const [hiddenModules, setHiddenModules] = useState<string[]>(() => getHiddenModules())

  useEffect(() => {
    const syncModules = () => setHiddenModules(getHiddenModules())
    window.addEventListener('storage', syncModules)
    window.addEventListener('the-villa-dog-modules-changed', syncModules)
    return () => {
      window.removeEventListener('storage', syncModules)
      window.removeEventListener('the-villa-dog-modules-changed', syncModules)
    }
  }, [])

  const hasItemAccess = (item: NavItem) => {
    if (!hasNavItemAccess(user, item)) return false
    return !hiddenModules.includes(item.module)
  }

  const [navOrder, setNavOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_ORDER_STORAGE_KEY)
      if (saved) return JSON.parse(saved)
    } catch {
      return allNavItems.map(i => i.href)
    }
    return allNavItems.map(i => i.href)
  })

  useEffect(() => {
    localStorage.setItem(SIDEBAR_ORDER_STORAGE_KEY, JSON.stringify(navOrder))
  }, [navOrder])

  const [isEditing, setIsEditing] = useState(false)
  const displayItems = navOrder
    .map(href => allNavItems.find(i => i.href === href))
    .filter((item): item is NavItem => Boolean(item && hasItemAccess(item)))
  const missingItems = allNavItems.filter(i => !navOrder.includes(i.href) && hasItemAccess(i))
  const finalItems = [...displayItems, ...missingItems]

  const moveItem = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return
    if (direction === 'down' && index === finalItems.length - 1) return
    const newOrder = [...finalItems.map(i => i.href)]
    const targetIdx = direction === 'up' ? index - 1 : index + 1
    const temp = newOrder[index]
    newOrder[index] = newOrder[targetIdx]
    newOrder[targetIdx] = temp
    setNavOrder(newOrder)
  }

  return (
    <aside
      className={cn(
        "niche-sidebar flex h-screen shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-subtle)] relative transition-all duration-300 overflow-visible z-20"
      )}
      style={{ width: isCollapsed ? '64px' : '256px' }}
    >
      {onClose && (
        <Button variant="ghost" size="icon" onClick={onClose} className="absolute top-4 right-4 h-8 w-8 rounded-xl text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] md:hidden z-20 cursor-pointer">
          <X className="h-4 w-4" />
        </Button>
      )}

      {!onClose && onToggleCollapse && (
        <button
          onClick={onToggleCollapse}
          className="absolute -right-3 top-8 z-30 h-6 w-6 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-panel)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] shadow-md hover:scale-105 active:scale-97 transition-all cursor-pointer"
          title={isCollapsed ? "Expandir menu" : "Contraer menu"}
        >
          {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
        </button>
      )}

      <div className="border-b border-[var(--border-subtle)] px-4 py-4 flex items-center justify-center">
        <Link to={getFirstAllowedPath(user) || '/profile'} className={cn("flex justify-center rounded-2xl bg-[var(--bg-base)] border border-[var(--border-subtle)] transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]", isCollapsed ? "h-9 w-9 items-center p-0" : "py-3.5 px-4 w-full shadow-md")}>
          {isCollapsed ? <span className="text-sm font-black text-[var(--accent)]">V</span> : <BrandLogo compact imageClassName="w-32" />}
        </Link>
      </div>

      <nav className={cn("flex-1 overflow-y-auto py-4", isCollapsed ? "px-1.5" : "px-3")}>
        <ul className="space-y-0.5 mt-2">
          {finalItems.map((item, index) => {
            const Icon = item.icon
            const active = location.pathname === item.href || (
              item.href !== '/dashboard' &&
              item.href !== '/orders/new' &&
              item.href !== '/orders' &&
              item.href !== '/superadmin' &&
              location.pathname.startsWith(item.href + '/')
            )
            const showHeader = index === 0 || item.section !== finalItems[index - 1].section
            return (
              <li key={item.href} className="relative group">
                {showHeader && !isCollapsed && (
                  <div className={cn("mb-1 px-3 flex items-center justify-between", index === 0 ? "" : "mt-4")}>
                    <p className={cn("text-[10px] font-bold tracking-widest uppercase flex items-center gap-1", item.section === 'SuperAdmin' ? 'text-amber-500' : 'text-[var(--text-muted)]')}>
                      {item.section === 'SuperAdmin' && <Crown className="h-2.5 w-2.5" />}
                      {item.section}
                    </p>
                    {index === 0 && (
                      <div className="flex items-center gap-1">
                        {isEditing && (
                          <button
                            type="button"
                            onClick={() => {
                              const defaultOrder = allNavItems.map(i => i.href)
                              setNavOrder(defaultOrder)
                              localStorage.setItem(SIDEBAR_ORDER_STORAGE_KEY, JSON.stringify(defaultOrder))
                            }}
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded-md border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
                            title="Restablecer orden predeterminado"
                          >
                            RESTABLECER
                          </button>
                        )}
                        <button onClick={() => setIsEditing(!isEditing)} className={cn("text-[9px] font-bold px-2 py-0.5 rounded-md border cursor-pointer", isEditing ? "bg-[var(--accent)] text-white border-transparent" : "text-[var(--text-muted)] border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]")}>
                          {isEditing ? 'LISTO' : 'ORGANIZAR'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex items-center">
                  <Link
                    to={item.href}
                    title={isCollapsed ? item.label : undefined}
                    className={cn(
                      'relative flex items-center py-2.5 text-sm z-10 transition-all duration-200 flex-1',
                      isCollapsed ? 'justify-center px-0' : 'gap-3 px-3',
                      active && !isCollapsed && (item.section === 'SuperAdmin' ? 'font-semibold text-amber-500 pl-3' : 'font-semibold text-[var(--accent)] pl-3'),
                      active && isCollapsed && (item.section === 'SuperAdmin' ? 'text-amber-500' : 'text-[var(--accent)]'),
                      !active && 'text-[var(--text-link)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    {active && (
                      <motion.div
                        layoutId="sidebar-active-indicator"
                        className={cn("absolute inset-0 -z-10", item.section === 'SuperAdmin' ? 'bg-amber-500/10' : 'bg-[var(--accent-muted)]', isCollapsed ? "rounded-xl mx-1.5" : cn('border-l-4 rounded-r-xl', item.section === 'SuperAdmin' ? 'border-amber-500' : 'border-[var(--accent)]'))}
                        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                      />
                    )}
                    <Icon className="h-4 w-4 shrink-0" />
                    {!isCollapsed && <span className="relative line-clamp-1">{item.label}</span>}
                  </Link>
                  {isEditing && !isCollapsed && (
                    <div className="flex flex-col ml-1 shrink-0">
                      <button onClick={() => moveItem(index, 'up')} disabled={index === 0} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-not-allowed">
                        <ChevronLeft className="h-3.5 w-3.5 rotate-90" />
                      </button>
                      <button onClick={() => moveItem(index, 'down')} disabled={index === finalItems.length - 1} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:cursor-not-allowed">
                        <ChevronRight className="h-3.5 w-3.5 rotate-90" />
                      </button>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </nav>

      {isCollapsed ? (
        <div className="border-t border-[var(--border-subtle)] py-4 px-2 flex flex-col items-center gap-3">
          <Link to="/profile" title="Mi perfil">
            <Avatar className="h-8 w-8 ring-2 ring-[var(--border-default)] hover:ring-[var(--accent)] transition-all cursor-pointer">
              <AvatarFallback className="bg-[var(--bg-base)] text-[10px] font-extrabold text-[var(--text-primary)]">{initials}</AvatarFallback>
            </Avatar>
          </Link>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] rounded-xl" onClick={toggleTheme} title="Cambiar tema">
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-[var(--text-secondary)] hover:text-[var(--destructive)] hover:bg-[var(--bg-hover)] rounded-xl" onClick={logout} title="Cerrar sesion">
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <div className="border-t border-[var(--border-subtle)] p-3 flex items-center justify-between gap-2">
          <Link to="/profile" className="flex items-center gap-2.5 min-w-0 group" title="Mi perfil">
            <Avatar className="h-9 w-9 shrink-0 ring-2 ring-[var(--border-default)] group-hover:ring-[var(--accent)] transition-all">
              <AvatarFallback className="bg-[var(--bg-base)] text-xs font-extrabold text-[var(--text-primary)]">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">{user?.name}</p>
              <p className="text-[9px] text-[var(--text-muted)] font-medium uppercase tracking-wider">{roleLabels[user?.role || ''] || user?.role}</p>
            </div>
          </Link>
          <div className="flex gap-0.5 shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" onClick={toggleTheme} title="Cambiar tema">
              {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-[var(--text-secondary)] hover:text-[var(--destructive)] hover:bg-[var(--bg-hover)]" onClick={logout} title="Cerrar sesion">
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </aside>
  )
}
