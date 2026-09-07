import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  ChefHat,
  Plus,
  Edit2,
  Trash2,
  Check,
  ExternalLink,
  Utensils,
  Users,
  Layers,
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Sliders,
  Split,
  Coffee,
  ShieldCheck,
  Save,
  Clock,
  Timer,
  BellRing,
  RotateCcw
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { io } from '@/lib/socket'
import { playUrgentBell } from '@/lib/sound'
import { toast } from 'sonner'

interface Category {
  id: string
  name: string
}

interface User {
  id: string
  name: string
  role: string
  email?: string
}

export interface CookStatus {
  active?: boolean
  onBreak?: boolean
  breakMinutes?: number
  breakStartedAt?: number
  breakUntil?: number | null
  breakReason?: string
}

interface Station {
  id: string
  name: string
  color: string
  priority: number
  active: boolean
  categories: Category[]
  users: User[]
}

const COLOR_PALETTE = [
  { label: 'Rojo', hex: '#EF4444' },
  { label: 'Naranja', hex: '#F97316' },
  { label: 'Verde', hex: '#10B981' },
  { label: 'Azul', hex: '#3B82F6' },
  { label: 'Morado', hex: '#8B5CF6' },
  { label: 'Rosa', hex: '#EC4899' },
]

export default function KitchenStationsPage() {
  const [stations, setStations] = useState<Station[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [cookStatuses, setCookStatuses] = useState<Record<string, CookStatus>>({})
  const [now, setNow] = useState(Date.now())
  const [loading, setLoading] = useState(true)
  const notifiedBreaks = useRef<Set<string>>(new Set())

  // Modal de Tiempo de Cena / Descanso
  const [breakModalUser, setBreakModalUser] = useState<User | null>(null)
  const [breakMinutes, setBreakMinutes] = useState(15)
  const [customMinutes, setCustomMinutes] = useState('')
  const [breakReason, setBreakReason] = useState('Cena')
  const [submittingBreak, setSubmittingBreak] = useState(false)

  // Routing Rules Settings
  const [routingSettings, setRoutingSettings] = useState({
    smartDrinkRouting: true,
    splitByChannel: true,
    multiStationDrinkTarget: 'general',
  })
  const [savingSettings, setSavingSettings] = useState(false)

  // Modal State para Crear / Editar Estación
  const [openModal, setOpenModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState('#EF4444')
  const [active, setActive] = useState(true)
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])

  const loadData = async () => {
    try {
      setLoading(true)
      const [sts, cats, usrs, settings, cooksStatus] = await Promise.all([
        api.get<Station[]>('/kitchen/stations'),
        api.get<any[]>('/menu/categories?includeInactive=true'),
        api.get<User[]>('/users'),
        api.get<any>('/kitchen/settings').catch(() => ({ smartDrinkRouting: true, splitByChannel: true })),
        api.get<Record<string, CookStatus>>('/kitchen/cooks/status').catch(() => ({})),
      ])
      const stationChannels = settings?.stationChannels || {}
      setStations((sts || []).filter(station => {
        const channel = stationChannels[station.id]
        return channel !== 'DELIVERY'
      }))
      setCategories((cats || []).map(c => ({ id: c.id, name: c.name })))
      setUsers(usrs || [])
      setCookStatuses(cooksStatus || {})
      if (settings) {
        setRoutingSettings({
          smartDrinkRouting: settings.smartDrinkRouting !== false,
          splitByChannel: settings.splitByChannel !== false,
          multiStationDrinkTarget: settings.multiStationDrinkTarget || 'general',
        })
      }
    } catch (err: any) {
      console.error('Error cargando datos de estaciones:', err)
      alerts.error('Error al cargar', 'No se pudieron cargar las estaciones.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Socket en tiempo real para cambios de disponibilidad y fin de descansos
  useEffect(() => {
    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      transports: ['websocket', 'polling'],
    })

    socket.on('kitchenCookStatusChanged', (newStatuses: Record<string, CookStatus>) => {
      setCookStatuses(newStatuses || {})
    })

    socket.on('cookBreakFinished', (payload: any) => {
      playUrgentBell()
      alerts.warning(
        `⏰ ¡Tiempo de ${payload.breakReason || 'cena'} terminado!`,
        `El cocinero "${payload.userName}" ha cumplido sus ${payload.breakMinutes || 15} minutos. Ya puedes llamarlo para que retome sus funciones.`
      )
      setCookStatuses(prev => ({
        ...prev,
        [payload.userId]: { ...(prev[payload.userId] || {}), onBreak: false }
      }))
    })

    return () => { socket.disconnect() }
  }, [])

  // Contador regresivo en tiempo real cada 1 segundo
  useEffect(() => {
    const interval = setInterval(() => {
      const current = Date.now()
      setNow(current)

      // Comprobar si algún temporizador de cocinero llegó a 00:00 localmente
      Object.entries(cookStatuses).forEach(([userId, status]) => {
        if (status?.onBreak && status?.breakUntil) {
          const key = `${userId}:${status.breakUntil}`
          if (current >= status.breakUntil && !notifiedBreaks.current.has(key)) {
            notifiedBreaks.current.add(key)
            playUrgentBell()
            const cookUser = users.find(u => u.id === userId)
            const cookName = cookUser?.name || 'Cocinero'
            alerts.warning(
              `⏰ ¡Tiempo de ${status.breakReason || 'cena'} terminado!`,
              `El cocinero "${cookName}" ha cumplido sus ${status.breakMinutes || 15} minutos. Ya puedes avisarle para que retome sus funciones en la cocina.`
            )
            setCookStatuses(prev => ({
              ...prev,
              [userId]: { ...(prev[userId] || {}), onBreak: false }
            }))
          }
        }
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [cookStatuses, users])

  const getRemainingSeconds = (breakUntil?: number | null) => {
    if (!breakUntil) return 0
    return Math.max(0, Math.floor((breakUntil - now) / 1000))
  }

  const formatCountdown = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60)
    const secs = totalSec % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const toggleCookActive = async (userId: string, currentActive: boolean) => {
    const newActive = !currentActive
    try {
      setCookStatuses(prev => ({
        ...prev,
        [userId]: { ...(prev[userId] || {}), active: newActive }
      }))
      await api.post(`/kitchen/cooks/${userId}/status`, { active: newActive })
      toast.success(
        newActive
          ? 'Cocinero activado: recibirá pedidos equitativamente'
          : 'Cocinero desactivado: no recibirá pedidos (se dividen en los demás)'
      )
    } catch (err: any) {
      alerts.error('Error', err.message || 'No se pudo cambiar el estado del cocinero')
      loadData()
    }
  }

  const openBreakModal = (user: User) => {
    setBreakModalUser(user)
    setBreakMinutes(15)
    setCustomMinutes('')
    setBreakReason('Cena')
  }

  const confirmStartBreak = async () => {
    if (!breakModalUser) return
    const mins = customMinutes ? parseInt(customMinutes) || 15 : breakMinutes
    if (mins <= 0) {
      alerts.warning('Tiempo inválido', 'Por favor ingresa un número de minutos mayor a 0.')
      return
    }

    setSubmittingBreak(true)
    try {
      const until = Date.now() + mins * 60 * 1000
      setCookStatuses(prev => ({
        ...prev,
        [breakModalUser.id]: {
          ...(prev[breakModalUser.id] || {}),
          onBreak: true,
          breakMinutes: mins,
          breakUntil: until,
          breakReason,
          breakStartedAt: Date.now(),
        }
      }))
      await api.post(`/kitchen/cooks/${breakModalUser.id}/status`, {
        onBreak: true,
        breakMinutes: mins,
        breakReason,
      })
      toast.info(`🍽️ ${breakModalUser.name} inició tiempo de ${breakReason.toLowerCase()} (${mins} min)`)
      setBreakModalUser(null)
    } catch (err: any) {
      alerts.error('Error', err.message || 'No se pudo iniciar el tiempo de descanso')
    } finally {
      setSubmittingBreak(false)
    }
  }

  const endCookBreak = async (userId: string) => {
    try {
      setCookStatuses(prev => ({
        ...prev,
        [userId]: { ...(prev[userId] || {}), onBreak: false, breakUntil: null }
      }))
      await api.post(`/kitchen/cooks/${userId}/status`, { onBreak: false })
      toast.success('Cocinero reincorporado: ya está listo para recibir pedidos nuevamente')
    } catch (err: any) {
      alerts.error('Error', err.message || 'No se pudo reincorporar al cocinero')
      loadData()
    }
  }

  const extendCookBreak = async (userId: string, additionalMinutes: number) => {
    const currentStatus = cookStatuses[userId]
    const remainingSec = getRemainingSeconds(currentStatus?.breakUntil)
    const newTotalMinutes = Math.max(1, Math.round(remainingSec / 60) + additionalMinutes)

    try {
      const until = Date.now() + newTotalMinutes * 60 * 1000
      setCookStatuses(prev => ({
        ...prev,
        [userId]: {
          ...(prev[userId] || {}),
          onBreak: true,
          breakMinutes: newTotalMinutes,
          breakUntil: until,
        }
      }))
      await api.post(`/kitchen/cooks/${userId}/status`, {
        onBreak: true,
        breakMinutes: newTotalMinutes,
      })
      toast.success(`Tiempo extendido: +${additionalMinutes} min`)
    } catch (err: any) {
      alerts.error('Error', err.message || 'No se pudo extender el tiempo')
    }
  }

  const saveRoutingSettings = async () => {
    setSavingSettings(true)
    try {
      await api.post('/kitchen/settings', { ...routingSettings, splitByChannel: true })
      alerts.success(
        'Reglas de Cocina Actualizadas',
        'La distribución de bebidas y platos ha sido guardada en el sistema.'
      )
    } catch (err: any) {
      alerts.error('Error al guardar reglas', err.message || 'No se pudieron guardar las reglas')
    } finally {
      setSavingSettings(false)
    }
  }

  // Filtrar y ordenar cocineros primero
  const kitchenStaff = users.filter(u => (u as any).active !== false).sort((a, b) => {
    if (a.role === 'KITCHEN' && b.role !== 'KITCHEN') return -1
    if (b.role === 'KITCHEN' && a.role !== 'KITCHEN') return 1
    return a.name.localeCompare(b.name)
  })

  const openCreateModal = () => {
    setEditingId(null)
    setName('')
    setColor('#EF4444')
    setActive(true)
    setSelectedCategoryIds([])
    setSelectedUserIds([])
    setOpenModal(true)
  }

  const openEditModal = (station: Station) => {
    setEditingId(station.id)
    setName(station.name)
    setColor(station.color || '#EF4444')
    setActive(station.active !== false)
    setSelectedCategoryIds((station.categories || []).map(c => c.id))
    setSelectedUserIds((station.users || []).map(u => u.id))
    setOpenModal(true)
  }

  const toggleCategory = (catId: string) => {
    setSelectedCategoryIds(prev =>
      prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
    )
  }

  const toggleUser = (userId: string) => {
    setSelectedUserIds(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    )
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      alerts.warning('Nombre requerido', 'Por favor ingresa un nombre para la estación.')
      return
    }

    setSaving(true)
    try {
      await api.post('/kitchen/stations', {
        id: editingId || undefined,
        name: name.trim(),
        color,
        active,
        categoryIds: selectedCategoryIds,
        userIds: selectedUserIds,
        priority: 0,
      })

      alerts.success(
        editingId ? 'Estación actualizada' : 'Estación creada',
        `La estación "${name}" quedó guardada y sincronizada en tiempo real.`
      )
      setOpenModal(false)
      loadData()
    } catch (err: any) {
      alerts.error('Error al guardar', err.message || 'No se pudo guardar la estación.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (station: Station) => {
    const ok = await alerts.confirm(
      `¿Eliminar estación "${station.name}"?`,
      'Los pedidos de estas categorías pasarán a mostrarse en Cocina General.',
      'Eliminar Estación',
      'Cancelar'
    )
    if (!ok) return

    try {
      await api.delete(`/kitchen/stations/${station.id}`)
      alerts.success('Estación eliminada', 'La estación ha sido retirada de la cocina activa.')
      loadData()
    } catch (err: any) {
      // Fallback a desactivar si la DB tiene pedidos vinculados
      try {
        await api.post('/kitchen/stations', {
          id: station.id,
          name: station.name,
          active: false,
          categoryIds: [],
          userIds: [],
        })
        alerts.success('Estación desactivada', 'La estación ha sido pausada de la cocina activa.')
        loadData()
      } catch (e: any) {
        alerts.error('Error', err.message || 'No se pudo retirar la estación.')
      }
    }
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-black text-[var(--text-primary)] antifont tracking-wider">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-500">
              <ChefHat className="h-6 w-6" />
            </div>
            ESTACIONES DE COCINA · MESAS
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Esta pantalla conserva la operación del salón. La cocina de domicilios se configura por separado.
          </p>
        </div>

        <Button
          onClick={openCreateModal}
          className="h-11 px-5 rounded-2xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold text-xs gap-2 shadow-lg shadow-[var(--accent)]/15 cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Nueva Estación
        </Button>
      </div>

      {/* Configuración rápida de despacho */}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-[var(--accent)]" />
            <h2 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-wider">
              Distribución Automática
            </h2>
          </div>
          <Button
            onClick={saveRoutingSettings}
            disabled={savingSettings}
            size="sm"
            className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold gap-1.5 self-start sm:self-auto"
          >
            <Save className="h-3 w-3" />
            {savingSettings ? 'Guardando...' : 'Guardar'}
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
          <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs font-bold cursor-pointer hover:border-[var(--accent)] transition">
            <input
              type="checkbox"
              checked={routingSettings.smartDrinkRouting}
              onChange={e => setRoutingSettings(prev => ({ ...prev, smartDrinkRouting: e.target.checked }))}
              className="rounded h-4 w-4 text-[var(--accent)] cursor-pointer"
            />
            <span className="text-[var(--text-primary)]">Vincular bebida al plato de comida</span>
          </label>

          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="h-4 w-4" />
            <span>Cocina de mesas protegida e independiente de domicilios</span>
          </div>
        </div>
      </div>

      {/* Grid de Estaciones */}
      {loading ? (
        <div className="p-12 text-center text-sm text-[var(--text-muted)] animate-pulse">
          Cargando estaciones de cocina...
        </div>
      ) : stations.length === 0 ? (
        <div className="p-10 rounded-2xl border border-dashed border-[var(--border-default)] text-center space-y-3 bg-[var(--bg-panel)]">
          <ChefHat className="h-10 w-10 mx-auto text-[var(--text-muted)] opacity-50" />
          <h3 className="text-base font-bold text-[var(--text-primary)]">No hay estaciones configuradas</h3>
          <p className="text-xs text-[var(--text-secondary)]">Crea estaciones como "Perros Calientes" o "Hamburguesas".</p>
          <Button onClick={openCreateModal} size="sm" className="bg-[var(--accent)] font-bold text-xs">
            Crear Primera Estación
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {stations.map(station => {
            const hasCategories = (station.categories || []).length > 0
            const hasUsers = (station.users || []).length > 0

            return (
              <div
                key={station.id}
                className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm hover:border-[var(--accent)] transition-all flex flex-col justify-between relative overflow-hidden"
              >
                {/* Borde superior de color de la estación */}
                <div className="absolute top-0 left-0 right-0 h-1.5" style={{ backgroundColor: station.color || '#EF4444' }} />

                <div className="space-y-3 pt-1">
                  {/* Título y Estado */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-black text-[var(--text-primary)] flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: station.color || '#EF4444' }} />
                        {station.name}
                      </h3>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full inline-block mt-1 ${station.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-zinc-500/10 text-zinc-500'}`}>
                        {station.active ? '● Activa en Turno' : '○ Pausada'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditModal(station)}
                        className="h-7 w-7 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        title="Editar estación"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(station)}
                        className="h-7 w-7 rounded-lg text-rose-500 hover:bg-rose-50"
                        title="Eliminar estación"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Platos que prepara */}
                  <div className="space-y-1 p-2.5 rounded-xl bg-[var(--bg-elevated)] text-xs">
                    <span className="text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1">
                      <Utensils className="h-3 w-3 text-orange-500" /> Platos:
                    </span>
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {hasCategories ? (
                        station.categories.map(c => (
                          <span key={c.id} className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-[var(--bg-panel)] text-[var(--text-primary)] border border-[var(--border-subtle)]">
                            {c.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] font-bold text-amber-600">Todos los platos</span>
                      )}
                    </div>
                  </div>

                  {/* Cocineros asignados */}
                  <div className="space-y-1.5 p-2.5 rounded-xl bg-[var(--bg-elevated)] text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1">
                        <Users className="h-3 w-3 text-blue-500" /> Cocineros ({station.users?.length || 0}):
                      </span>
                      <span className="text-[9px] text-[var(--text-muted)] font-bold">
                        Reparto automático
                      </span>
                    </div>

                    {hasUsers ? (
                      <div className="space-y-1.5 pt-1">
                        {station.users.map(u => {
                          const status = cookStatuses[u.id] || { active: true, onBreak: false }
                          const isActive = status.active !== false
                          const remainingSec = getRemainingSeconds(status.breakUntil)
                          const isOnBreak = Boolean(status.onBreak && remainingSec > 0)

                          return (
                            <div
                              key={u.id}
                              className={`p-2 rounded-xl border transition-all flex flex-col gap-1.5 ${
                                isOnBreak
                                  ? 'bg-amber-500/10 border-amber-500/40 text-amber-900 dark:text-amber-200 shadow-xs'
                                  : !isActive
                                  ? 'bg-zinc-500/10 border-zinc-500/20 text-zinc-500 opacity-75'
                                  : 'bg-[var(--bg-panel)] border-[var(--border-subtle)] text-[var(--text-primary)]'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1.5">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="text-xs shrink-0">👨‍🍳</span>
                                  <span className="font-bold text-xs truncate" title={u.name}>{u.name}</span>
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                  {isOnBreak ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-white shadow-xs animate-pulse">
                                      <span>🍽️ CENA</span>
                                      <span className="font-mono text-[11px]">{formatCountdown(remainingSec)}</span>
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => toggleCookActive(u.id, isActive)}
                                      title={isActive ? 'Clic para desactivar (no recibirá pedidos)' : 'Clic para activar (recibirá pedidos)'}
                                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black transition cursor-pointer ${
                                        isActive
                                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
                                          : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 hover:bg-rose-500/25'
                                      }`}
                                    >
                                      <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                      {isActive ? 'Activo' : 'Inactivo'}
                                    </button>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center justify-between gap-1 pt-1 border-t border-[var(--border-subtle)]/60 text-[10px]">
                                {isOnBreak ? (
                                  <>
                                    <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold flex items-center gap-1 truncate">
                                      ⏱️ Restan: <strong className="font-mono text-[11px]">{formatCountdown(remainingSec)}</strong>
                                    </span>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => extendCookBreak(u.id, 5)}
                                        className="px-1.5 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-700 dark:text-amber-300 font-black cursor-pointer transition text-[9px]"
                                        title="Agregar 5 minutos más"
                                      >
                                        +5m
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => endCookBreak(u.id)}
                                        className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer transition shadow-xs text-[10px]"
                                        title="Terminar cena y reincorporar"
                                      >
                                        Reincorporar
                                      </button>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <span className="text-[10px] text-[var(--text-muted)] truncate">
                                      {isActive ? 'Recibe pedidos' : 'Pausado (no le caen pedidos)'}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => openBreakModal(u)}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-orange-500/10 hover:bg-orange-500 hover:text-white text-orange-600 dark:text-orange-400 font-bold transition cursor-pointer shrink-0 text-[10px]"
                                      title="Programar tiempo de cena o descanso"
                                    >
                                      <span>🍽️ Cena / Pausa</span>
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <span className="text-[11px] text-[var(--text-muted)] italic">Todos los cocineros</span>
                    )}
                  </div>
                </div>

                {/* Abrir pantalla */}
                <div className="mt-3.5 pt-2.5 border-t border-[var(--border-subtle)] flex items-center justify-between">
                  <span className="text-[11px] text-[var(--text-muted)]">Pantalla KDS</span>
                  <Link
                    to={`/kitchen?station=${station.id}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-[var(--bg-elevated)] hover:bg-[var(--accent)] hover:text-white text-[var(--text-primary)] transition"
                  >
                    <span>Abrir Cocina</span>
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal Sencillo para Crear / Editar Estación */}
      <Dialog open={openModal} onOpenChange={setOpenModal}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl shadow-2xl p-0 overflow-hidden max-w-xl w-[95vw] max-h-[90vh] flex flex-col">
          <div className="h-1.5 w-full shrink-0" style={{ backgroundColor: color }} />

          <div className="p-6 pb-3 flex items-center justify-between border-b border-[var(--border-subtle)] shrink-0">
            <DialogTitle className="text-lg font-black text-[var(--text-primary)] flex items-center gap-2">
              <ChefHat className="h-5 w-5 text-[var(--accent)]" />
              {editingId ? 'Editar Estación de Cocina' : 'Crear Nueva Estación de Cocina'}
            </DialogTitle>
          </div>

          <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
            {/* 1. Nombre */}
            <div className="space-y-1.5">
              <Label className="text-xs font-black uppercase text-[var(--text-secondary)] tracking-wider">
                1. Nombre de la Estación *
              </Label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Ej: Estación Perros, Plancha Hamburguesas, Domicilios..."
                className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-default)] font-bold text-sm"
              />
            </div>

            {/* 2. Color */}
            <div className="space-y-2">
              <Label className="text-xs font-black uppercase text-[var(--text-secondary)] tracking-wider">
                2. Color de Identificación
              </Label>
              <div className="flex items-center gap-2.5 flex-wrap">
                {COLOR_PALETTE.map(c => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setColor(c.hex)}
                    className={`h-9 px-3 rounded-xl border flex items-center gap-2 text-xs font-bold transition-all cursor-pointer ${
                      color === c.hex
                        ? 'border-black dark:border-white shadow-md scale-105'
                        : 'border-transparent opacity-75 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: `${c.hex}20`, color: c.hex }}
                  >
                    <span className="h-3.5 w-3.5 rounded-full shrink-0" style={{ backgroundColor: c.hex }} />
                    {c.label}
                    {color === c.hex && <Check className="h-3.5 w-3.5 ml-1" />}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Categorías */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-black uppercase text-[var(--text-secondary)] tracking-wider">
                  3. ¿Qué platos se preparan en esta estación?
                </Label>
                <span className="text-[11px] text-[var(--text-muted)]">
                  {selectedCategoryIds.length === 0 ? 'Todos los platos' : `${selectedCategoryIds.length} seleccionados`}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {categories.map(cat => {
                  const isChecked = selectedCategoryIds.includes(cat.id)
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => toggleCategory(cat.id)}
                      className={`p-3 rounded-2xl border text-left text-xs font-bold transition-all flex items-center justify-between cursor-pointer ${
                        isChecked
                          ? 'bg-[var(--accent)]/10 border-[var(--accent)] text-[var(--accent)] shadow-xs'
                          : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-default)]'
                      }`}
                    >
                      <span className="truncate">🍔 {cat.name}</span>
                      <div
                        className={`h-4 w-4 rounded-md flex items-center justify-center shrink-0 ml-1 ${
                          isChecked ? 'bg-[var(--accent)] text-white' : 'border border-[var(--border-default)]'
                        }`}
                      >
                        {isChecked && <Check className="h-3 w-3 stroke-[3]" />}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 4. Cocineros */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-black uppercase text-[var(--text-secondary)] tracking-wider">
                  4. ¿Quiénes son los cocineros encargados?
                </Label>
                <span className="text-[11px] text-[var(--text-muted)]">
                  {selectedUserIds.length === 0 ? 'Cualquiera' : `${selectedUserIds.length} asignados`}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-1 custom-scrollbar">
                {kitchenStaff.map(u => {
                  const isChecked = selectedUserIds.includes(u.id)
                  const isKitchen = u.role === 'KITCHEN'
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => toggleUser(u.id)}
                      className={`p-2.5 rounded-2xl border text-left text-xs font-bold transition-all flex items-center justify-between cursor-pointer ${
                        isChecked
                          ? 'bg-blue-500/10 border-blue-500 text-blue-600 dark:text-blue-400 shadow-xs'
                          : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-default)]'
                      }`}
                    >
                      <div className="truncate min-w-0 pr-1">
                        <span className="truncate block font-semibold text-[var(--text-primary)]">
                          👨‍🍳 {u.name}
                        </span>
                        <span className="text-[10px] text-[var(--text-muted)] font-normal block truncate">
                          {isKitchen ? 'Cocinero' : u.role}
                        </span>
                      </div>
                      <div
                        className={`h-4 w-4 rounded-md flex items-center justify-center shrink-0 ${
                          isChecked ? 'bg-blue-600 text-white' : 'border border-[var(--border-default)]'
                        }`}
                      >
                        {isChecked && <Check className="h-3 w-3 stroke-[3]" />}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Estado Activo */}
            <label className="flex items-center gap-2.5 p-3 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs font-bold cursor-pointer">
              <input
                type="checkbox"
                checked={active}
                onChange={e => setActive(e.target.checked)}
                className="rounded border-[var(--border-default)] h-4 w-4 text-[var(--accent)]"
              />
              <span>Estación Activa (mostrar en la pantalla de cocina)</span>
            </label>

            {/* Footer Buttons */}
            <div className="pt-3 border-t border-[var(--border-subtle)] flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpenModal(false)}
                className="h-10 px-4 rounded-xl border-[var(--border-default)] text-xs font-bold"
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="h-10 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold gap-2 shadow-md cursor-pointer"
              >
                <Check className="h-4 w-4" />
                {saving ? 'Guardando...' : editingId ? 'Guardar Cambios' : 'Crear Estación'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal para Programar Tiempo de Cena / Descanso */}
      <Dialog open={!!breakModalUser} onOpenChange={open => { if (!open) setBreakModalUser(null) }}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl shadow-2xl p-0 overflow-hidden max-w-md w-[95vw]">
          <div className="h-1.5 w-full bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500" />

          <div className="p-5 border-b border-[var(--border-subtle)]">
            <DialogTitle className="text-base font-black text-[var(--text-primary)] flex items-center gap-2">
              <span className="text-lg">🍽️</span>
              Tiempo de Cena / Pausa para {breakModalUser?.name}
            </DialogTitle>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Durante este tiempo, <strong>no se le asignarán pedidos</strong> y las comandas se repartirán automáticamente entre los otros cocineros activos.
            </p>
          </div>

          <div className="p-5 space-y-4">
            {/* Opciones rápidas de minutos */}
            <div className="space-y-1.5">
              <Label className="text-xs font-black uppercase text-[var(--text-secondary)] tracking-wider">
                Selecciona la duración:
              </Label>
              <div className="grid grid-cols-3 gap-2">
                {[15, 20, 30, 45, 60].map(mins => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => { setBreakMinutes(mins); setCustomMinutes('') }}
                    className={`py-2.5 px-3 rounded-xl border text-xs font-black transition-all cursor-pointer ${
                      breakMinutes === mins && !customMinutes
                        ? 'bg-orange-500 text-white border-orange-600 shadow-md scale-102'
                        : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] hover:border-orange-500'
                    }`}
                  >
                    ⏱️ {mins} min
                  </button>
                ))}
              </div>
            </div>

            {/* O tiempo manual */}
            <div className="space-y-1.5">
              <Label className="text-xs font-black uppercase text-[var(--text-secondary)] tracking-wider">
                O escribe los minutos exactos:
              </Label>
              <div className="relative">
                <Input
                  type="number"
                  min="1"
                  max="180"
                  placeholder="Ej: 10, 12, 25..."
                  value={customMinutes}
                  onChange={e => {
                    setCustomMinutes(e.target.value)
                    const val = parseInt(e.target.value)
                    if (val > 0) setBreakMinutes(val)
                  }}
                  className="h-10 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-default)] font-bold text-sm pr-16"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)] font-bold">
                  minutos
                </span>
              </div>
            </div>

            {/* Motivo de pausa */}
            <div className="space-y-1.5">
              <Label className="text-xs font-black uppercase text-[var(--text-secondary)] tracking-wider">
                Motivo:
              </Label>
              <div className="flex gap-2">
                {['Cena', 'Almuerzo', 'Descanso'].map(reason => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => setBreakReason(reason)}
                    className={`py-1.5 px-3 rounded-lg border text-xs font-bold transition-all cursor-pointer ${
                      breakReason === reason
                        ? 'bg-amber-500/20 border-amber-500 text-amber-700 dark:text-amber-300 font-black'
                        : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-muted)]'
                    }`}
                  >
                    {reason}
                  </button>
                ))}
              </div>
            </div>

            {/* Preview Box */}
            <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 text-xs text-orange-950 dark:text-orange-200 space-y-1">
              <div className="font-black flex items-center gap-1.5">
                <span>⏱️ Duración asignada:</span>
                <span className="text-sm font-mono font-black text-orange-600 dark:text-orange-400">
                  {customMinutes ? customMinutes : breakMinutes} minutos
                </span>
              </div>
              <p className="text-[11px] opacity-85">
                Al llegar a 00:00 se disparará una alerta sonora de campana y una notificación visual en pantalla para avisarle al cocinero.
              </p>
            </div>
          </div>

          <div className="p-4 bg-[var(--bg-elevated)] border-t border-[var(--border-subtle)] flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setBreakModalUser(null)}
              className="h-9 px-4 rounded-xl border-[var(--border-default)] text-xs font-bold"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={confirmStartBreak}
              disabled={submittingBreak}
              className="h-9 px-4 rounded-xl bg-orange-600 hover:bg-orange-700 text-white text-xs font-black gap-1.5 shadow-md cursor-pointer"
            >
              <span>🍽️ Iniciar {breakReason} ({customMinutes ? customMinutes : breakMinutes}m)</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
