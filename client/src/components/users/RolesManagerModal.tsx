import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { 
  Shield, 
  Plus, 
  Edit3, 
  Trash2, 
  Check, 
  X, 
  Loader2, 
  Sparkles, 
  SlidersHorizontal,
  CheckSquare,
  Square,
  Lock,
  Crown,
  UserCheck,
  Bike,
  BarChart3,
  Calculator,
  Layers,
  Palette
} from 'lucide-react'
import { SYSTEM_MODULES_PERMISSIONS, ALL_PERMISSION_KEYS } from '@/lib/permissions'
import { SecurityActionConfirmModal } from '@/components/auth/SecurityActionConfirmModal'

export interface RoleData {
  id: string
  code: string
  name: string
  description?: string | null
  color?: string | null
  icon?: string | null
  permissions: string[] | any
  isSystem: boolean
  active: boolean
}

interface RolesManagerModalProps {
  open: boolean
  onClose: () => void
  onRolesUpdated?: () => void
}

const PRESET_COLORS = [
  '#F59E0B', '#3B82F6', '#10B981', '#8B5CF6', 
  '#EC4899', '#06B6D4', '#E11D48', '#6366F1'
]

export function RolesManagerModal({ open, onClose, onRolesUpdated }: RolesManagerModalProps) {
  const [roles, setRoles] = useState<RoleData[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRole, setSelectedRole] = useState<RoleData | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [isCreatingNew, setIsCreatingNew] = useState(false)

  // Form states
  const [roleName, setRoleName] = useState('')
  const [roleCode, setRoleCode] = useState('')
  const [roleDescription, setRoleDescription] = useState('')
  const [roleColor, setRoleColor] = useState('#10B981')
  const [rolePermissions, setRolePermissions] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  // Security authorization modal
  const [showSecurityModal, setShowSecurityModal] = useState(false)
  const [pendingAction, setPendingAction] = useState<{ type: 'SAVE' | 'DELETE'; roleId?: string } | null>(null)

  const loadRoles = async () => {
    setLoading(true)
    try {
      const data = await api.get<RoleData[]>('/roles')
      const filtered = (data || []).filter(r => r.code !== 'SUPERADMIN')
      setRoles(filtered)
      if (filtered && filtered.length > 0) {
        setSelectedRole(filtered[0])
      }
    } catch (err: any) {
      console.error('Error cargando roles:', err)
      alerts.error('Error', 'No se pudieron cargar los roles')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      loadRoles()
      setIsCreatingNew(false)
      setIsEditing(false)
    }
  }, [open])

  useEffect(() => {
    if (selectedRole && !isCreatingNew) {
      setRoleName(selectedRole.name)
      setRoleCode(selectedRole.code)
      setRoleDescription(selectedRole.description || '')
      setRoleColor(selectedRole.color || '#10B981')
      let perms = selectedRole.permissions
      if (typeof perms === 'string') {
        try { perms = JSON.parse(perms) } catch (e) { perms = [] }
      }
      setRolePermissions(Array.isArray(perms) ? perms : [])
    }
  }, [selectedRole, isCreatingNew])

  const handleStartCreate = () => {
    setIsCreatingNew(true)
    setIsEditing(true)
    setRoleName('')
    setRoleCode('')
    setRoleDescription('')
    setRoleColor('#10B981')
    setRolePermissions([])
  }

  const handleStartEdit = (role: RoleData) => {
    setSelectedRole(role)
    setIsCreatingNew(false)
    setIsEditing(true)
  }

  const handleTogglePermission = (key: string) => {
    if (!isEditing) return
    setRolePermissions(prev => 
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    )
  }

  const handleToggleModuleAll = (moduleKeys: string[]) => {
    if (!isEditing) return
    const allSelected = moduleKeys.every(k => rolePermissions.includes(k))
    if (allSelected) {
      setRolePermissions(prev => prev.filter(k => !moduleKeys.includes(k)))
    } else {
      setRolePermissions(prev => Array.from(new Set([...prev, ...moduleKeys])))
    }
  }

  const handleRequestSave = (e: React.FormEvent) => {
    e.preventDefault()
    if (!roleName.trim()) {
      alerts.error('Campo requerido', 'Por favor ingresa un nombre para el rol')
      return
    }
    if (isCreatingNew && !roleCode.trim()) {
      alerts.error('Campo requerido', 'Por favor define un código para el rol')
      return
    }

    setPendingAction({ type: 'SAVE' })
    setShowSecurityModal(true)
  }

  const handleExecuteSave = async () => {
    setSaving(true)
    try {
      if (isCreatingNew) {
        await api.post('/roles', {
          name: roleName.trim(),
          code: roleCode.trim().toUpperCase().replace(/\s+/g, '_'),
          description: roleDescription.trim() || undefined,
          color: roleColor,
          permissions: rolePermissions,
        })
        alerts.success('¡Rol Creado!', `El rol "${roleName}" ha sido creado y guardado en el sistema.`)
      } else if (selectedRole) {
        await api.put(`/roles/${selectedRole.id}`, {
          name: roleName.trim(),
          description: roleDescription.trim() || undefined,
          color: roleColor,
          permissions: rolePermissions,
        })
        alerts.success('¡Rol Actualizado!', `Los cambios del rol "${roleName}" han sido guardados.`)
      }

      setIsEditing(false)
      setIsCreatingNew(false)
      await loadRoles()
      if (onRolesUpdated) onRolesUpdated()
    } catch (err: any) {
      alerts.error('Error al guardar rol', err.message || 'No se pudo guardar el rol')
    } finally {
      setSaving(false)
    }
  }

  const handleRequestDelete = (role: RoleData) => {
    if (role.isSystem) {
      alerts.error('Acción no permitida', 'Los roles predeterminados del sistema no pueden eliminarse.')
      return
    }
    setPendingAction({ type: 'DELETE', roleId: role.id })
    setShowSecurityModal(true)
  }

  const handleExecuteDelete = async () => {
    if (!pendingAction?.roleId) return
    setSaving(true)
    try {
      await api.delete(`/roles/${pendingAction.roleId}`)
      alerts.success('Rol Eliminado', 'El rol ha sido desactivado con éxito.')
      setSelectedRole(null)
      await loadRoles()
      if (onRolesUpdated) onRolesUpdated()
    } catch (err: any) {
      alerts.error('No se pudo eliminar el rol', err.message || 'Error desconocido')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          className="relative w-full max-w-5xl h-[88vh] max-h-[820px] bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-3xl shadow-2xl overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
                <SlidersHorizontal className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-black text-[var(--text-primary)] leading-tight">
                  Gestor Dinámico de Roles y Permisos
                </h2>
                <p className="text-xs text-[var(--text-secondary)]">
                  Crea roles personalizados (ej: Mesero, Jefe Cocina), renómbralos y ajusta su matriz de accesos.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={handleStartCreate}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-9 px-4 rounded-xl text-xs flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Crear Nuevo Rol</span>
              </Button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Body: Split View (List Roles Left | Edit Permissions Right) */}
          <div className="flex-1 flex overflow-hidden">
            {/* Left Sidebar: Role List */}
            <div className="w-72 sm:w-80 border-r border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 flex flex-col p-4 space-y-2 overflow-y-auto shrink-0">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--text-muted)] px-2 mb-1 block">
                Roles Configurados ({roles.length})
              </span>

              {loading ? (
                <div className="p-8 flex flex-col items-center justify-center text-center space-y-2">
                  <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)]" />
                  <span className="text-xs text-[var(--text-muted)]">Cargando roles...</span>
                </div>
              ) : (
                roles.map(r => {
                  const isSelected = selectedRole?.id === r.id && !isCreatingNew
                  return (
                    <div
                      key={r.id}
                      onClick={() => { setSelectedRole(r); setIsCreatingNew(false); setIsEditing(false); }}
                      className={`p-3 rounded-2xl border transition-all cursor-pointer text-left flex items-center justify-between group ${
                        isSelected
                          ? 'bg-[var(--bg-panel)] border-[var(--accent)] shadow-md'
                          : 'bg-[var(--bg-elevated)] border-[var(--border-subtle)] hover:border-[var(--text-muted)]/40'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span 
                          className="w-3 h-3 rounded-full shrink-0 shadow-xs" 
                          style={{ backgroundColor: r.color || '#10B981' }} 
                        />
                        <div className="truncate">
                          <p className="text-xs font-black text-[var(--text-primary)] truncate">{r.name}</p>
                          <p className="text-[10px] font-mono text-[var(--text-muted)] uppercase truncate">{r.code}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {r.isSystem ? (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-amber-500/30 text-amber-600 dark:text-amber-400 font-extrabold bg-amber-500/10">
                            Sistema
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-indigo-500/30 text-indigo-600 dark:text-indigo-400 font-extrabold bg-indigo-500/10">
                            Custom
                          </Badge>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Right Pane: Role Details & Permissions Matrix */}
            <div className="flex-1 flex flex-col bg-[var(--bg-panel)] overflow-hidden">
              {isCreatingNew || selectedRole ? (
                <form onSubmit={handleRequestSave} className="flex-1 flex flex-col overflow-hidden">
                  {/* Top Bar: Basic Info & Actions */}
                  <div className="p-5 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/20 space-y-4 shrink-0">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h3 className="text-sm font-black text-[var(--text-primary)] flex items-center gap-2">
                          <span 
                            className="w-3.5 h-3.5 rounded-full shrink-0" 
                            style={{ backgroundColor: roleColor }} 
                          />
                          {isCreatingNew ? 'Nuevo Rol Personalizado' : `Configuración de Rol: ${roleName}`}
                        </h3>
                        <p className="text-[11px] text-[var(--text-secondary)]">
                          {isCreatingNew
                            ? 'Define el nombre, código y permisos que tendrán los usuarios con este rol.'
                            : selectedRole?.isSystem
                            ? 'Rol protegido del sistema. Puedes renombrarlo y ajustar su plantilla de permisos.'
                            : 'Rol personalizado. Puedes modificar su nombre, color y accesos.'}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {!isEditing ? (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => handleStartEdit(selectedRole!)}
                              className="h-8 px-3 text-xs font-bold rounded-xl border-[var(--border-subtle)] cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5 mr-1" />
                              <span>Editar Rol</span>
                            </Button>
                            {!selectedRole?.isSystem && (
                              <Button
                                type="button"
                                variant="destructive"
                                onClick={() => handleRequestDelete(selectedRole!)}
                                className="h-8 px-3 text-xs font-bold rounded-xl cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5 mr-1" />
                                <span>Eliminar</span>
                              </Button>
                            )}
                          </>
                        ) : (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => { setIsEditing(false); setIsCreatingNew(false); }}
                              className="h-8 px-3 text-xs font-semibold rounded-xl"
                            >
                              Cancelar
                            </Button>
                            <Button
                              type="submit"
                              disabled={saving}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-8 px-4 rounded-xl text-xs shadow-sm flex items-center gap-1 cursor-pointer"
                            >
                              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                              <span>Guardar Rol</span>
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Inputs Row */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                      <div>
                        <Label className="text-[11px] font-bold text-[var(--text-primary)]">Nombre del Rol *</Label>
                        <Input
                          value={roleName}
                          onChange={(e) => {
                            setRoleName(e.target.value)
                            if (isCreatingNew && !roleCode) {
                              setRoleCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '_'))
                            }
                          }}
                          disabled={!isEditing}
                          placeholder="Ej: Mesero de Salón"
                          className="h-9 text-xs rounded-xl mt-1 bg-[var(--bg-elevated)] border-[var(--border-subtle)]"
                        />
                      </div>

                      <div>
                        <Label className="text-[11px] font-bold text-[var(--text-primary)]">Código Identificador *</Label>
                        <Input
                          value={roleCode}
                          onChange={(e) => setRoleCode(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
                          disabled={!isCreatingNew || !isEditing}
                          placeholder="MESERO"
                          className="h-9 text-xs font-mono rounded-xl mt-1 bg-[var(--bg-elevated)] border-[var(--border-subtle)] uppercase"
                        />
                      </div>

                      <div>
                        <Label className="text-[11px] font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                          <Palette className="w-3 h-3" /> Color del Rol
                        </Label>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          {PRESET_COLORS.map(c => (
                            <button
                              type="button"
                              key={c}
                              disabled={!isEditing}
                              onClick={() => setRoleColor(c)}
                              className={`w-6 h-6 rounded-full border-2 transition-transform cursor-pointer ${
                                roleColor === c ? 'border-[var(--text-primary)] scale-110 shadow-sm' : 'border-transparent hover:scale-105'
                              }`}
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Permissions Checklist Area */}
                  <div className="flex-1 overflow-y-auto p-5 space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-wider">
                          Matriz de Permisos por Módulo ({rolePermissions.length} de {ALL_PERMISSION_KEYS.length} seleccionados)
                        </h4>
                        <p className="text-[11px] text-[var(--text-secondary)]">
                          {isEditing ? 'Haz clic en las casillas para otorgar o remover permisos predeterminados.' : 'Vista de solo lectura. Haz clic en "Editar Rol" para modificar accesos.'}
                        </p>
                      </div>

                      {isEditing && (
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setRolePermissions([...ALL_PERMISSION_KEYS])}
                            className="h-7 text-[10px] font-bold border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 rounded-lg cursor-pointer"
                          >
                            Seleccionar Todos
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setRolePermissions([])}
                            className="h-7 text-[10px] font-bold text-red-500 hover:bg-red-500/10 rounded-lg cursor-pointer"
                          >
                            Desmarcar Todos
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {SYSTEM_MODULES_PERMISSIONS.map(mod => {
                        const moduleActionKeys = mod.actions.map(a => a.key)
                        const allModuleSelected = moduleActionKeys.every(k => rolePermissions.includes(k))
                        const someModuleSelected = moduleActionKeys.some(k => rolePermissions.includes(k))

                        return (
                          <div 
                            key={mod.id} 
                            className="p-4 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] space-y-3"
                          >
                            <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)]/60">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
                                <h5 className="text-xs font-black text-[var(--text-primary)]">{mod.name}</h5>
                              </div>

                              {isEditing && (
                                <button
                                  type="button"
                                  onClick={() => handleToggleModuleAll(moduleActionKeys)}
                                  className="text-[10px] font-bold text-[var(--accent)] hover:underline cursor-pointer"
                                >
                                  {allModuleSelected ? 'Quitar todo' : 'Todos'}
                                </button>
                              )}
                            </div>

                            <div className="space-y-2">
                              {mod.actions.map(act => {
                                const isChecked = rolePermissions.includes(act.key)
                                return (
                                  <div
                                    key={act.key}
                                    onClick={() => handleTogglePermission(act.key)}
                                    className={`flex items-center gap-2.5 p-2 rounded-xl border transition-colors ${
                                      isChecked
                                        ? 'bg-emerald-500/10 border-emerald-500/30 text-[var(--text-primary)]'
                                        : 'bg-[var(--bg-panel)]/50 border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-panel)]'
                                    } ${isEditing ? 'cursor-pointer' : 'cursor-default opacity-85'}`}
                                  >
                                    {isChecked ? (
                                      <CheckSquare className="w-4 h-4 text-emerald-500 shrink-0" />
                                    ) : (
                                      <Square className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                                    )}
                                    <div className="min-w-0">
                                      <p className="text-xs font-bold leading-tight">{act.label}</p>
                                      <p className="text-[10px] font-mono opacity-60 truncate">{act.key}</p>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </form>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-[var(--text-muted)] space-y-2">
                  <SlidersHorizontal className="w-8 h-8 opacity-40" />
                  <p className="text-xs font-semibold">Selecciona un rol a la izquierda o crea uno nuevo.</p>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Security Action Authorization Modal */}
      <SecurityActionConfirmModal
        open={showSecurityModal}
        actionName={
          pendingAction?.type === 'SAVE'
            ? isCreatingNew ? `Crear Rol "${roleName}"` : `Guardar Cambios en Rol "${roleName}"`
            : `Eliminar Rol "${selectedRole?.name}"`
        }
        title="Autorización de Seguridad Requerida"
        description="Esta acción modificará la estructura de permisos y roles del sistema."
        onClose={() => setShowSecurityModal(false)}
        onSuccess={async () => {
          setShowSecurityModal(false)
          if (pendingAction?.type === 'SAVE') {
            await handleExecuteSave()
          } else if (pendingAction?.type === 'DELETE') {
            await handleExecuteDelete()
          }
        }}
      />
    </>
  )
}
