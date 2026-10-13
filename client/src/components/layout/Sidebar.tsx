import { Link, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { cn } from '@/lib/utils'
import {
  allNavItems,
  getFirstAllowedPath,
  getHiddenModules,
  getSidebarOrder,
  hasNavItemAccess,
  saveSidebarOrder,
  type NavItem,
} from '@/lib/navigation'
import { BrandLogo } from '@/components/brand/BrandLogo'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Bell, BellOff, ChevronLeft, ChevronRight, Crown, GripVertical, LogOut, Moon, Search, Sun, X } from 'lucide-react'
import { isNotificationsMuted, toggleNotificationsMuted } from '@/lib/notificationSettings'
import { SiteSwitcher } from './SiteSwitcher'

const roleLabels: Record<string, string> = {
  SUPERADMIN: 'Super Administrador',
  ADMIN: 'Administrador',
  CASHIER: 'Cajero',
  DELIVERY_MANAGER: 'Gestor de Domicilios',
  DISPATCHER: 'Despachador de Domicilios',
  WAITER: 'Mesero',
  KITCHEN: 'Cocinero',
  DELIVERY_DRIVER: 'Domiciliario',
  ACCOUNTANT: 'Contador',
  ACCOUNTING_ASSISTANT: 'Auxiliar Contable',
}

interface SidebarProps {
  onClose?: () => void
  isCollapsed?: boolean
  onToggleCollapse?: () => void
}

const PREPARATION_ROUTES = new Set([
  '/products',
  '/superadmin/sites',
  '/users',
  '/zones',
  '/cash-registers',
  '/settings/kitchen-stations',
  '/settings/modules',
])

export function Sidebar({ onClose, isCollapsed = false, onToggleCollapse }: SidebarProps) {
  const location = useLocation()
  const { user, logout } = useAuth()
  const activeSiteId = user?.activeSite?.id
  const preparationMode = user?.activeSite?.preparationMode === true
  const { theme, toggleTheme } = useTheme()
  const initials = user?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '??'
  const [hiddenModules, setHiddenModules] = useState<string[]>(() => getHiddenModules(activeSiteId))
  const [isMuted, setIsMuted] = useState(() => isNotificationsMuted())

  useEffect(() => {
    const syncModules = () => setHiddenModules(getHiddenModules(activeSiteId))
    const syncMute = () => setIsMuted(isNotificationsMuted())
    window.addEventListener('storage', syncModules)
    window.addEventListener('storage', syncMute)
    window.addEventListener('the-villa-dog-modules-changed', syncModules)
    window.addEventListener('the-villa-dog-mute-changed', syncMute)
    return () => {
      window.removeEventListener('storage', syncModules)
      window.removeEventListener('storage', syncMute)
      window.removeEventListener('the-villa-dog-modules-changed', syncModules)
      window.removeEventListener('the-villa-dog-mute-changed', syncMute)
    }
  }, [activeSiteId])

  const handleToggleMute = () => {
    const next = toggleNotificationsMuted()
    setIsMuted(next)
  }

  const hasItemAccess = (item: NavItem) => {
    if (!hasNavItemAccess(user, item)) return false
    if (preparationMode) return PREPARATION_ROUTES.has(item.href)
    // La entrada del portal del domiciliario es fija para ese rol. No debe
    // desaparecer por una preferencia de módulos guardada por administración.
    if (user?.role === 'DELIVERY_DRIVER' && item.href === '/my-deliveries') return true
    return !hiddenModules.includes(item.module)
  }

  const [navOrder, setNavOrder] = useState<string[]>(() => getSidebarOrder(activeSiteId))

  useEffect(() => {
    setHiddenModules(getHiddenModules(activeSiteId))
    setNavOrder(getSidebarOrder(activeSiteId))
  }, [activeSiteId])

  useEffect(() => {
    saveSidebarOrder(navOrder, activeSiteId)
  }, [navOrder, activeSiteId])

  const [isEditing, setIsEditing] = useState(false)
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [navQuery, setNavQuery] = useState('')

  const displayItems = navOrder
    .map(href => allNavItems.find(i => i.href === href))
    .filter((item): item is NavItem => Boolean(item && hasItemAccess(item)))
  const missingItems = allNavItems.filter(i => !navOrder.includes(i.href) && hasItemAccess(i))
  const finalItems = [...displayItems, ...missingItems]
  const normalizedNavQuery = navQuery.trim().toLocaleLowerCase('es-CO')
  const visibleItems = isEditing || !normalizedNavQuery
    ? finalItems
    : finalItems.filter(item => `${item.label} ${item.section}`.toLocaleLowerCase('es-CO').includes(normalizedNavQuery))
  const isItemActive = (item: NavItem) => location.pathname === item.href || (
    item.href !== '/dashboard' &&
    item.href !== '/orders/new' &&
    item.href !== '/orders' &&
    item.href !== '/superadmin' &&
    location.pathname.startsWith(item.href + '/')
  )
  const activeItem = finalItems.find(isItemActive)
  const compactActiveLabel = activeItem?.label.replace(/^WhatsApp\s+/i, '')?.split(' ')[0] || 'Menú'

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

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', index.toString())
    setDraggedIdx(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverIdx !== index) {
      setDragOverIdx(index)
    }
  }

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault()
    if (draggedIdx === null || draggedIdx === targetIndex) {
      setDraggedIdx(null)
      setDragOverIdx(null)
      return
    }
    const newOrder = [...finalItems.map(i => i.href)]
    const [moved] = newOrder.splice(draggedIdx, 1)
    newOrder.splice(targetIndex, 0, moved)
    setNavOrder(newOrder)
    saveSidebarOrder(newOrder, activeSiteId)
    setDraggedIdx(null)
    setDragOverIdx(null)
  }

  return (
    <TooltipPrimitive.Provider delayDuration={120} skipDelayDuration={80}>
      <aside
        className={cn(
          "niche-sidebar flex shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-panel)] relative transition-all duration-300 overflow-visible z-20",
          onClose ? "w-full h-full max-h-[100dvh]" : "h-screen"
        )}
        style={{ width: isCollapsed ? '72px' : onClose ? '100%' : '256px' }}
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

      <div className={cn("border-b border-[var(--border-subtle)] shrink-0 flex items-center justify-center", isCollapsed ? "px-3 py-3.5" : "px-3 py-3")}>
        <Link to={preparationMode ? '/superadmin/sites' : (getFirstAllowedPath(user, activeSiteId) || '/profile')} className={cn("flex justify-center rounded-2xl bg-white border border-slate-200/80 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]", isCollapsed ? "h-11 w-11 items-center p-1 shadow-xs" : "py-2 px-3 w-full shadow-2xs")} onClick={onClose}>
          {isCollapsed ? <span className="text-sm font-black text-[#E30613]">V</span> : <BrandLogo compact imageClassName="w-24" />}
        </Link>
      </div>

      <div className={cn('shrink-0 border-b border-[var(--border-subtle)]', isCollapsed ? 'px-4 py-2' : 'px-3 py-2.5')}>
        <SiteSwitcher compact={isCollapsed} />
      </div>

      <nav className={cn("flex-1 min-h-0 overflow-y-auto overflow-x-hidden", isCollapsed ? "px-2 py-2" : "px-3 py-2")}>
        {!isCollapsed && (
          <div className="relative mb-3 px-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="search"
              value={navQuery}
              onChange={event => setNavQuery(event.target.value)}
              disabled={isEditing}
              placeholder="Buscar módulo..."
              aria-label="Buscar módulo en el menú"
              className="h-9 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] py-2 pl-9 pr-8 text-xs font-medium text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
            />
            {navQuery && !isEditing && (
              <button
                type="button"
                onClick={() => setNavQuery('')}
                className="absolute right-2.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                title="Limpiar búsqueda"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}
        <ul className={cn("space-y-1", !isCollapsed && "mt-2")}>
          {visibleItems.map((item, index) => {
            const Icon = item.icon
            const active = isItemActive(item)
            const showHeader = index === 0 || item.section !== visibleItems[index - 1].section
            return (
              <li
                key={item.href}
                className={cn(
                  "relative group transition-all duration-150",
                  isEditing && !isCollapsed && "cursor-grab active:cursor-grabbing",
                  dragOverIdx === index && "bg-[var(--accent)]/15 ring-2 ring-[var(--accent)] rounded-xl scale-[1.02]",
                  draggedIdx === index && "opacity-40"
                )}
                draggable={isEditing && !isCollapsed}
                onDragStart={e => handleDragStart(e, index)}
                onDragOver={e => handleDragOver(e, index)}
                onDragLeave={() => { if (dragOverIdx === index) setDragOverIdx(null) }}
                onDrop={e => handleDrop(e, index)}
                onDragEnd={() => { setDraggedIdx(null); setDragOverIdx(null) }}
              >
                {showHeader && isCollapsed && index > 0 && (
                  <div className="mx-2 my-2 h-px bg-[var(--border-subtle)]" aria-hidden="true" />
                )}
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
                              saveSidebarOrder(defaultOrder, activeSiteId)
                            }}
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded-md border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer"
                            title="Restablecer orden predeterminado"
                          >
                            RESTABLECER
                          </button>
                        )}
                        {!navQuery && (
                          <button onClick={() => setIsEditing(!isEditing)} className={cn("text-[9px] font-bold px-2 py-0.5 rounded-md border cursor-pointer", isEditing ? "bg-[var(--accent)] text-white border-transparent" : "text-[var(--text-muted)] border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]")}>
                            {isEditing ? 'LISTO' : 'ORGANIZAR'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex items-center">
                  {isEditing && !isCollapsed && (
                    <div className="text-[var(--text-muted)] group-hover:text-[var(--text-primary)] cursor-grab shrink-0 pl-1">
                      <GripVertical className="h-4 w-4" />
                    </div>
                  )}
                  <TooltipPrimitive.Root>
                    <TooltipPrimitive.Trigger asChild>
                      <Link
                        to={item.href}
                        onClick={e => { if (isEditing) e.preventDefault() }}
                        aria-label={isCollapsed ? item.label : undefined}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'relative flex items-center text-sm z-10 transition-all duration-200 flex-1 rounded-xl',
                          isCollapsed ? (active ? 'min-h-12 flex-col justify-center gap-0.5 px-0 py-1' : 'h-10 justify-center px-0') : 'py-2.5 gap-3 px-3',
                          active && !isCollapsed && (item.section === 'SuperAdmin' ? 'font-semibold text-amber-500 pl-3' : 'font-semibold text-[var(--accent)] pl-3'),
                          active && isCollapsed && (item.section === 'SuperAdmin' ? 'text-amber-500' : 'text-[var(--accent)]'),
                          !active && 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                        )}
                      >
                        {active && (
                          <motion.div
                            layoutId="sidebar-active-indicator"
                            className={cn("absolute inset-0 -z-10 rounded-xl", item.section === 'SuperAdmin' ? 'bg-amber-500/10' : 'bg-[var(--accent-muted)]', !isCollapsed && cn('border-l-4 rounded-l-none', item.section === 'SuperAdmin' ? 'border-amber-500' : 'border-[var(--accent)]'))}
                            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                          />
                        )}
                        <Icon className={cn("shrink-0", isCollapsed ? "h-[19px] w-[19px]" : "h-4 w-4")} />
                        {!isCollapsed && <span className="relative line-clamp-1">{item.label}</span>}
                        {isCollapsed && active && (
                          <span className="max-w-[58px] truncate text-[8px] font-black uppercase tracking-[0.08em]">{compactActiveLabel}</span>
                        )}
                      </Link>
                    </TooltipPrimitive.Trigger>
                    {isCollapsed && (
                      <TooltipPrimitive.Portal>
                        <TooltipPrimitive.Content
                          side="right"
                          sideOffset={10}
                          className="z-[100] rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold text-white shadow-xl data-[state=delayed-open]:animate-in data-[state=closed]:animate-out"
                        >
                          {item.label}
                          <span className="ml-2 text-[9px] font-semibold uppercase tracking-wider text-slate-400">{item.section}</span>
                          <TooltipPrimitive.Arrow className="fill-slate-950" />
                        </TooltipPrimitive.Content>
                      </TooltipPrimitive.Portal>
                    )}
                  </TooltipPrimitive.Root>
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
          {!isCollapsed && visibleItems.length === 0 && (
            <li className="rounded-xl border border-dashed border-[var(--border-subtle)] px-3 py-6 text-center text-xs text-[var(--text-secondary)]">
              No hay módulos que coincidan con “{navQuery}”.
            </li>
          )}
        </ul>
      </nav>

      {isCollapsed ? (
        <div className="border-t border-[var(--border-subtle)] py-2.5 px-2 flex flex-col items-center gap-1">
          <Link to="/profile" title="Mi perfil">
            <Avatar className="mb-1.5 h-9 w-9 ring-2 ring-[var(--border-default)] hover:ring-[var(--accent)] transition-all cursor-pointer">
              <AvatarFallback className="bg-[var(--bg-base)] text-[10px] font-extrabold text-[var(--text-primary)]">{initials}</AvatarFallback>
            </Avatar>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-8 w-8 rounded-xl transition cursor-pointer", isMuted ? "text-amber-500 hover:bg-amber-500/15" : "text-emerald-500 hover:bg-emerald-500/15")}
            onClick={handleToggleMute}
            title={isMuted ? "Notificaciones silenciadas (clic para activar)" : "Notificaciones activadas (clic para silenciar)"}
          >
            {isMuted ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] rounded-xl cursor-pointer" onClick={toggleTheme} title="Cambiar tema">
            {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-[var(--text-secondary)] hover:text-[var(--destructive)] hover:bg-rose-500/10 rounded-xl cursor-pointer" onClick={logout} title="Cerrar sesion">
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <div className="border-t border-[var(--border-subtle)] p-3 shrink-0 bg-[var(--bg-panel)] flex items-center justify-between gap-2 shadow-xs">
          <Link to="/profile" className="flex items-center gap-2.5 min-w-0 group" title="Mi perfil" onClick={onClose}>
            <Avatar className="h-9 w-9 shrink-0 ring-2 ring-[var(--border-default)] group-hover:ring-[var(--accent)] transition-all">
              <AvatarFallback className="bg-[var(--bg-base)] text-xs font-extrabold text-[var(--text-primary)]">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">{user?.name}</p>
              <p className="text-[9px] text-[var(--text-muted)] font-medium uppercase tracking-wider">{roleLabels[user?.role || ''] || user?.role}</p>
            </div>
          </Link>
          <div className="flex gap-1 shrink-0 items-center">
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8 rounded-xl transition cursor-pointer", isMuted ? "text-amber-500 hover:bg-amber-500/15" : "text-emerald-500 hover:bg-emerald-500/15")}
              onClick={handleToggleMute}
              title={isMuted ? "Notificaciones silenciadas (clic para activar)" : "Notificaciones activadas (clic para silenciar)"}
            >
              {isMuted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] rounded-xl cursor-pointer" onClick={toggleTheme} title="Cambiar tema">
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 rounded-xl cursor-pointer" onClick={logout} title="Cerrar sesion">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      </aside>
    </TooltipPrimitive.Provider>
  )
}
