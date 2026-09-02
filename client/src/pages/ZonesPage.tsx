import { useState, useEffect } from 'react'
import { io } from '@/lib/socket'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { Plus, MapPin, Pencil, Trash2, Download, Search, AlertTriangle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { alerts } from '@/lib/alerts'

interface Zone { id: string; name: string; rate: number; km?: number | null; active: boolean; zoneGroup: string }

const SECTORS = ['Centro', 'Norte', 'Sur', 'Oriente', 'Occidente', 'Periferia', 'General']

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.04 } }
} as const

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 20 } }
} as const

export default function ZonesPage() {
  const [zones, setZones] = useState<Zone[]>([])
  const [sectors, setSectors] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [seeding, setSeeding] = useState(false)
  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [rate, setRate] = useState('')
  const [zoneGroup, setZoneGroup] = useState('Centro')
  const [km, setKm] = useState('')
  const [filterGroup, setFilterGroup] = useState('ALL')
  const [search, setSearch] = useState('')

  // Zone management dialog states
  const [manageZonesOpen, setManageZonesOpen] = useState(false)
  const [newSectorName, setNewSectorName] = useState('')
  const [editingSectorOldName, setEditingSectorOldName] = useState<string | null>(null)
  const [editingSectorNewName, setEditingSectorNewName] = useState('')
  const [confirmDeleteSector, setConfirmDeleteSector] = useState<string | null>(null)
  const [sectorError, setSectorError] = useState<string | null>(null)

  const loadZones = (showSpinner = false) => {
    if (showSpinner) setLoading(true)
    api.get<Zone[]>('/zones').then(setZones).finally(() => {
      if (showSpinner) setLoading(false)
    })
  }

  const loadSectors = () => {
    api.get<string[]>('/zones/groups').then(setSectors)
  }

  useEffect(() => { 
    loadZones(true) 
    loadSectors()
  }, [])

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      transports: ['websocket', 'polling'],
    })

    socket.on('zonesChanged', () => {
      loadZones(false)
      loadSectors()
    })

    return () => {
      socket.disconnect()
    }
  }, [])

  const seedBarrios = async () => {
    setSeeding(true)
    try {
      const result = await api.post<{ created: number; updated: number; total: number }>('/zones/seed-monteria')
      alerts.success('Barrios Cargados', `Listo: ${result.created} nuevos, ${result.updated} actualizados (${result.total} barrios)`)
      loadZones()
      loadSectors()
    } catch (e: any) {
      alerts.error('Error al cargar barrios', e.message || 'No se pudieron cargar los barrios.')
    } finally {
      setSeeding(false)
    }
  }

  const saveZone = async () => {
    if (!name || !rate) return
    const payload = {
      name,
      rate: parseFloat(rate),
      zoneGroup,
      km: km ? parseFloat(km) : null
    }
    if (editId) await api.put(`/zones/${editId}`, payload)
    else await api.post('/zones', payload)
    setOpen(false); setEditId(null); setName(''); setRate(''); setKm('')
    loadZones()
    loadSectors()
  }

  const addSector = async () => {
    if (!newSectorName.trim()) return
    setSectorError(null)
    try {
      await api.post('/zones/groups', { name: newSectorName })
      setNewSectorName('')
      loadSectors()
    } catch (e: any) {
      setSectorError(e.message || 'No se pudo crear la zona.')
    }
  }

  const updateSector = async (oldName: string) => {
    if (!editingSectorNewName.trim()) return
    setSectorError(null)
    try {
      await api.put(`/zones/groups/${encodeURIComponent(oldName)}`, { newName: editingSectorNewName })
      setEditingSectorOldName(null)
      setEditingSectorNewName('')
      loadSectors()
      loadZones()
    } catch (e: any) {
      setSectorError(e.message || 'No se pudo renombrar la zona.')
    }
  }

  const deleteSectorConfirm = async (sectorName: string) => {
    setSectorError(null)
    try {
      await api.delete(`/zones/groups/${encodeURIComponent(sectorName)}`)
      setConfirmDeleteSector(null)
      loadSectors()
      loadZones()
    } catch (e: any) {
      setSectorError(e.message || 'No se pudo eliminar la zona.')
    }
  }

  const filtered = zones.filter(z => {
    const matchGroup = filterGroup === 'ALL' || z.zoneGroup === filterGroup
    const matchSearch = !search || z.name.toLowerCase().includes(search.toLowerCase())
    return matchGroup && matchSearch
  })

  const grouped = filtered.reduce<Record<string, Zone[]>>((acc, z) => {
    const g = z.zoneGroup || 'General'
    if (!acc[g]) acc[g] = []
    acc[g].push(z)
    return acc
  }, {})

  const groups = sectors.length > 0 ? sectors : [...new Set(zones.map(z => z.zoneGroup))].sort()

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-[var(--text-secondary)]">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}>
          <div className="h-10 w-10 rounded-full border-2 border-[var(--accent)] border-t-transparent" />
        </motion.div>
        <span className="ml-3 font-medium">Cargando barrios...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="BARRIOS"
        description="Zonas de domicilio en Montería, Córdoba. Cada barrio tiene su tarifa."
        actions={
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              className="border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-xl h-11 px-5 font-bold text-xs uppercase tracking-wider" 
              onClick={() => setManageZonesOpen(true)}
            >
              Gestionar Zonas
            </Button>
            <Button 
              className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold shadow-lg shadow-[var(--accent)]/15 rounded-xl h-11 px-5 text-xs uppercase tracking-wider" 
              onClick={() => { setEditId(null); setName(''); setRate(''); setKm(''); setZoneGroup(sectors[0] || 'General'); setOpen(true) }}
            >
              <Plus className="mr-2 h-4 w-4" /> Nuevo barrio
            </Button>
          </div>
        }
      />

      {/* Filters and Search */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center justify-between">
        <div className="relative min-w-[240px] flex-1 max-w-md">
          <Search className="absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]" />
          <Input 
            className="pl-10 h-11 rounded-xl bg-[var(--bg-panel)] border-[var(--border-subtle)] focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] text-[var(--text-primary)]" 
            placeholder="Buscar barrio..." 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button 
            type="button" 
            onClick={() => setFilterGroup('ALL')} 
            className={`rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all duration-200 border ${filterGroup === 'ALL' ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] shadow-md shadow-[var(--accent)]/15' : 'bg-[var(--bg-panel)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
          >
            Todos ({zones.length})
          </button>
          {groups.map(g => (
            <button 
              key={g} 
              type="button" 
              onClick={() => setFilterGroup(g)} 
              className={`rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all duration-200 border ${filterGroup === g ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] shadow-md shadow-[var(--accent)]/15' : 'bg-[var(--bg-panel)] border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Grid of Sectorized Zones */}
      <div className="space-y-8">
        {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([group, items]) => (
          <div key={group} className="space-y-4">
            <div className="flex items-center gap-2 pb-1 border-b border-[var(--border-subtle)]/30">
              <MapPin className="h-4 w-4 text-[var(--accent)]" />
              <h3 className="text-xs uppercase font-extrabold tracking-widest text-[var(--text-secondary)]">{group}</h3>
              <Badge className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-secondary)] text-[10px] rounded-full px-2 py-0.5 font-bold">
                {items.length}
              </Badge>
            </div>
            
            <motion.div 
              variants={containerVariants} 
              initial="hidden" 
              animate="show" 
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            >
              {items.map(z => (
                <motion.div key={z.id} variants={itemVariants}>
                  <Card className="niche-card-premium border-[var(--border-subtle)] bg-[var(--bg-panel)] transition-all duration-300 relative overflow-hidden rounded-2xl group hover:-translate-y-1">
                    <CardContent className="p-5 relative z-10 flex flex-col justify-between h-full min-h-[140px]">
                      <div>
                        <p className="font-extrabold text-base text-[var(--text-primary)] tracking-wide group-hover:text-[var(--accent)] transition-colors">{z.name}</p>
                        <div className="flex items-baseline gap-2 mt-2">
                          <span className="text-2xl font-black text-[var(--accent)] tracking-tight">{formatCurrency(z.rate)}</span>
                          {z.km !== undefined && z.km !== null && (
                            <span className="text-xs font-semibold text-[var(--text-secondary)]">({z.km} km)</span>
                          )}
                        </div>
                      </div>
                      <div className="mt-4 flex gap-2 border-t border-[var(--border-subtle)]/50 pt-3">
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="h-8 text-xs font-bold text-[var(--accent)] hover:bg-[var(--accent-muted)] rounded-lg px-3 flex-1" 
                          onClick={() => { setEditId(z.id); setName(z.name); setRate(String(z.rate)); setZoneGroup(z.zoneGroup); setKm(z.km ? String(z.km) : ''); setOpen(true) }}
                        >
                          <Pencil className="mr-1.5 h-3.5 w-3.5" /> Editar
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="h-8 text-xs font-bold text-[var(--destructive)] hover:bg-[var(--destructive)]/10 rounded-lg px-3 flex-1" 
                          onClick={async () => {
                            const ok = await alerts.confirm(
                              '¿Eliminar Barrio?',
                              `¿Estás seguro de que deseas eliminar el barrio "${z.name}"?`,
                              'Sí, eliminar',
                              'Cancelar'
                            )
                            if (ok) {
                              try {
                                await api.delete(`/zones/${z.id}`)
                                alerts.success('Barrio eliminado', 'El barrio ha sido removido.')
                                loadZones()
                              } catch (err: any) {
                                alerts.error('Error', err.message || 'No se pudo eliminar el barrio.')
                              }
                            }
                          }}
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Borrar
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </motion.div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="py-20 text-center text-[var(--text-secondary)] border border-dashed border-[var(--border-subtle)] rounded-2xl bg-[var(--bg-panel)]/50">
          <MapPin className="mx-auto h-8 w-8 text-[var(--text-muted)] mb-3 animate-pulse" />
          <p className="font-medium">No se encontraron barrios con ese filtro o búsqueda.</p>
        </div>
      )}

      {/* Dialog creation/edit */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl max-w-md p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-[var(--text-primary)] tracking-tight">
              {editId ? 'Editar Barrio' : 'Nuevo Barrio'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-3">
            <div className="space-y-2">
              <Label className="text-xs uppercase font-extrabold tracking-wider text-[var(--text-secondary)]">Sector / Zona</Label>
              <Select value={zoneGroup} onValueChange={setZoneGroup}>
                <SelectTrigger className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] focus:ring-2 focus:ring-[var(--accent)]/20 text-[var(--text-primary)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)]">
                  {sectors.map(s => <SelectItem key={s} value={s} className="hover:bg-[var(--bg-hover)] text-[var(--text-primary)]">{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label className="text-xs uppercase font-extrabold tracking-wider text-[var(--text-secondary)]">Nombre del barrio</Label>
              <Input 
                className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] text-[var(--text-primary)]" 
                value={name} 
                onChange={e => setName(e.target.value)} 
                placeholder="Ej: El Recreo" 
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-xs uppercase font-extrabold tracking-wider text-[var(--text-secondary)]">Tarifa domicilio ($)</Label>
              <Input 
                type="number" 
                className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] text-[var(--text-primary)]" 
                value={rate} 
                onChange={e => setRate(e.target.value)} 
                placeholder="4000" 
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-xs uppercase font-extrabold tracking-wider text-[var(--text-secondary)]">Distancia en Kilómetros (Opcional)</Label>
              <Input 
                type="number" 
                step="0.1"
                className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] text-[var(--text-primary)]" 
                value={km} 
                onChange={e => setKm(e.target.value)} 
                placeholder="Ej: 3.5" 
              />
            </div>
            
            <Button 
              className="w-full h-11 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold shadow-lg shadow-[var(--accent)]/15 rounded-xl mt-4 text-sm uppercase tracking-wider" 
              onClick={saveZone}
            >
              Guardar Barrio
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog for managing zones */}
      <Dialog open={manageZonesOpen} onOpenChange={val => { setManageZonesOpen(val); if (!val) { setSectorError(null); setConfirmDeleteSector(null); } }}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl max-w-md p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-[var(--text-primary)] tracking-tight">
              Gestionar Zonas
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-3">
            {sectorError && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs font-semibold text-red-500 animate-in fade-in duration-200">
                {sectorError}
              </div>
            )}
            {/* Create new zone input */}
            <div className="flex gap-2">
              <Input 
                className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] text-[var(--text-primary)]" 
                value={newSectorName} 
                onChange={e => setNewSectorName(e.target.value)} 
                placeholder="Nombre de nueva zona (ej: Norte)" 
              />
              <Button 
                className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold rounded-xl h-11 px-4 text-xs uppercase tracking-wider"
                onClick={addSector}
              >
                Agregar
              </Button>
            </div>

            {/* List of existing zones */}
            <div className="max-h-[300px] overflow-y-auto space-y-2 pr-1">
              {sectors.map(sector => (
                <div key={sector} className="flex items-center justify-between p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] min-h-[62px]">
                  {editingSectorOldName === sector ? (
                    <div className="flex items-center gap-2 w-full">
                      <Input 
                        className="h-9 rounded-lg bg-[var(--bg-panel)] border-[var(--border-subtle)] focus:ring-2 focus:ring-[var(--accent)]/20 text-sm text-[var(--text-primary)] flex-1"
                        value={editingSectorNewName}
                        onChange={e => setEditingSectorNewName(e.target.value)}
                        placeholder="Nuevo nombre"
                      />
                      <Button 
                        size="sm"
                        className="h-9 px-3 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold rounded-lg text-xs"
                        onClick={() => updateSector(sector)}
                      >
                        OK
                      </Button>
                      <Button 
                        size="sm"
                        variant="ghost"
                        className="h-9 px-3 text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] rounded-lg text-xs"
                        onClick={() => { setEditingSectorOldName(null); setEditingSectorNewName(''); }}
                      >
                        Cancelar
                      </Button>
                    </div>
                  ) : confirmDeleteSector === sector ? (
                    <div className="flex items-center justify-between w-full animate-in fade-in duration-200">
                      <span className="text-[10px] text-[var(--destructive)] font-black uppercase tracking-wider">¿Eliminar zona y barrios?</span>
                      <div className="flex gap-1.5">
                        <Button 
                          size="sm" 
                          className="h-8 px-3 bg-[var(--destructive)] hover:bg-[var(--destructive)]/95 text-white font-bold rounded-lg text-xs"
                          onClick={() => deleteSectorConfirm(sector)}
                        >
                          Sí, eliminar
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="h-8 px-3 text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] rounded-lg text-xs font-bold"
                          onClick={() => setConfirmDeleteSector(null)}
                        >
                          No
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="font-semibold text-sm text-[var(--text-primary)]">{sector}</span>
                      <div className="flex gap-1.5">
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="h-8 w-8 p-0 text-[var(--accent)] hover:bg-[var(--accent-muted)] rounded-lg"
                          onClick={() => { setEditingSectorOldName(sector); setEditingSectorNewName(sector); setConfirmDeleteSector(null); }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="h-8 w-8 p-0 text-[var(--destructive)] hover:bg-[var(--destructive)]/10 rounded-lg"
                          onClick={() => { setConfirmDeleteSector(sector); setEditingSectorOldName(null); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
