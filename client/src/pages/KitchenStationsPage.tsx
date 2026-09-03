import { useEffect, useState } from 'react'
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
  Save
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'

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
  const [loading, setLoading] = useState(true)

  // Routing Rules Settings
  const [routingSettings, setRoutingSettings] = useState({
    smartDrinkRouting: true,
    splitByChannel: true,
    multiStationDrinkTarget: 'general',
  })
  const [savingSettings, setSavingSettings] = useState(false)

  // Modal State
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
      const [sts, cats, usrs, settings] = await Promise.all([
        api.get<Station[]>('/kitchen/stations'),
        api.get<any[]>('/menu/categories?includeInactive=true'),
        api.get<User[]>('/users'),
        api.get<any>('/kitchen/settings').catch(() => ({ smartDrinkRouting: true, splitByChannel: true })),
      ])
      setStations(sts || [])
      setCategories((cats || []).map(c => ({ id: c.id, name: c.name })))
      setUsers(usrs || [])
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

  const saveRoutingSettings = async () => {
    setSavingSettings(true)
    try {
      await api.post('/kitchen/settings', routingSettings)
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
            ESTACIONES DE COCINA
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Asigna qué platos prepara cada cocinero en su pantalla (ej: Perros, Hamburguesas o Cocina General).
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

          <label className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs font-bold cursor-pointer hover:border-[var(--accent)] transition">
            <input
              type="checkbox"
              checked={routingSettings.splitByChannel}
              onChange={e => setRoutingSettings(prev => ({ ...prev, splitByChannel: e.target.checked }))}
              className="rounded h-4 w-4 text-[var(--accent)] cursor-pointer"
            />
            <span className="text-[var(--text-primary)]">Separar estaciones de Salón y Domicilio</span>
          </label>
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
                  <div className="space-y-1 p-2.5 rounded-xl bg-[var(--bg-elevated)] text-xs">
                    <span className="text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1">
                      <Users className="h-3 w-3 text-blue-500" /> Cocineros:
                    </span>
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {hasUsers ? (
                        station.users.map(u => (
                          <span key={u.id} className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-blue-500/10 text-blue-700 border border-blue-500/20">
                            👨‍🍳 {u.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-[var(--text-muted)] italic">Todos los cocineros</span>
                      )}
                    </div>
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
    </div>
  )
}
