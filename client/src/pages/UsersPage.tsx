import { useState, useEffect, useMemo } from 'react'
import { io } from 'socket.io-client'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import {
  Plus, Users, Shield, User as UserIcon, Edit, Trash2, AlertTriangle, Loader2, Crown, Lock, Bike, Phone,
  Mail, UserCheck, KeyRound, Eye, EyeOff, LogIn, Calculator, BarChart3, FileSpreadsheet, ShieldCheck,
  CheckSquare, Square, Search, RefreshCw, Sparkles, Check, SlidersHorizontal, MessageSquare, ShoppingBag,
  Wallet, Receipt, Package, MapPin, Settings, CheckCircle2, XCircle, Clock
} from 'lucide-react'
import { alerts } from '@/lib/alerts'
import {
  SYSTEM_MODULES_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  getDefaultPermissionsForRole,
  ALL_PERMISSION_KEYS,
  PermissionModule
} from '@/lib/permissions'
import { RolesManagerModal, RoleData } from '@/components/users/RolesManagerModal'
import { SecurityActionConfirmModal } from '@/components/auth/SecurityActionConfirmModal'

interface UserData {
  id: string
  name: string
  email: string
  role: string
  permissions?: string[] | null
  phone: string
  photo: string | null
  active: boolean
  mustVerifyEmail?: boolean
  emailVerified?: boolean
  createdAt: string
}

const fadeUp = {
  hidden: { opacity: 0, y: 15 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } },
}

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
}

const defaultRoleColors: Record<string, string> = {
  SUPERADMIN: '#F59E0B',
  ADMIN: '#3B82F6',
  CASHIER: '#10B981',
  DELIVERY_MANAGER: '#8B5CF6',
  ACCOUNTANT: '#0EA5E9',
  ACCOUNTING_ASSISTANT: '#06B6D4',
}

const roleIcons: Record<string, any> = {
  SUPERADMIN: Crown,
  ADMIN: Shield,
  CASHIER: UserCheck,
  DELIVERY_MANAGER: Bike,
  ACCOUNTANT: BarChart3,
  ACCOUNTING_ASSISTANT: Calculator,
}

const roleBadgeLabels: Record<string, string> = {
  SUPERADMIN: 'Super Admin',
  ADMIN: 'Admin',
  CASHIER: 'Cajero',
  DELIVERY_MANAGER: 'Gestor',
  ACCOUNTANT: 'Contador',
  ACCOUNTING_ASSISTANT: 'Auxiliar Contable',
}

const moduleIcons: Record<string, any> = {
  whatsapp: MessageSquare,
  orders: ShoppingBag,
  dispatch: Bike,
  customers: Users,
  cash: Wallet,
  expenses: Receipt,
  products: Package,
  inventory: Package,
  zones: MapPin,
  reports: BarChart3,
  users_settings: Settings,
}

export default function UsersPage() {
  const { user: currentUser, startImpersonation } = useAuth()
  const isSuperAdmin = currentUser?.role === 'SUPERADMIN'
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null)

  const handleImpersonate = async (u: UserData) => {
    const ok = await alerts.confirm(
      `¿Entrar como ${u.name}?`,
      'Vas a iniciar una sesión de soporte con los permisos de este usuario. Podrás volver a tu cuenta en cualquier momento.',
      'Entrar',
      'Cancelar'
    )
    if (!ok) return
    setImpersonatingId(u.id)
    try {
      await startImpersonation(u.id)
    } catch (err: any) {
      alerts.error('No se pudo iniciar sesión de soporte', err.message || 'Intenta nuevamente')
      setImpersonatingId(null)
    }
  }

  const [users, setUsers] = useState<UserData[]>([])
  const [rolesList, setRolesList] = useState<RoleData[]>([])
  const [openRolesModal, setOpenRolesModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [modalTab, setModalTab] = useState<'profile' | 'permissions'>('profile')
  const [permissionSearch, setPermissionSearch] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [role, setRole] = useState('CASHIER')
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([])
  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [pwdUserId, setPwdUserId] = useState<string | null>(null)
  const [pwdUserName, setPwdUserName] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showNewPwd, setShowNewPwd] = useState(false)
  const [pwdSubmitting, setPwdSubmitting] = useState(false)
  const [pwdSuccess, setPwdSuccess] = useState(false)
  const [activeTab, setActiveTab] = useState<'active' | 'inactive'>('active')
  const [showSecurityModal, setShowSecurityModal] = useState(false)
  const [pendingSecurityAction, setPendingSecurityAction] = useState<{
    type: 'SUBMIT' | 'DELETE' | 'TOGGLE'
    actionName: string
    userId?: string
    userActive?: boolean
    isEdit?: boolean
    editId?: string | null
    payload?: any
  } | null>(null)

  const parseUserPerms = (perms: any, uRole: string): string[] => {
    if (perms === null || perms === undefined) {
      return getDefaultPermissionsForRole(uRole)
    }
    if (Array.isArray(perms)) {
      return perms
    }
    if (typeof perms === 'string') {
      try {
        const parsed = JSON.parse(perms)
        if (Array.isArray(parsed)) return parsed
      } catch {
        return getDefaultPermissionsForRole(uRole)
      }
    }
    return getDefaultPermissionsForRole(uRole)
  }

  const loadUsers = () => {
    api.get<UserData[]>('/users')
      .then(usrs => setUsers(usrs.sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1
        const order = ['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER', 'ACCOUNTANT', 'ACCOUNTING_ASSISTANT']
        const ai = order.indexOf(a.role)
        const bi = order.indexOf(b.role)
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
      })))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  const loadRoles = () => {
    api.get<RoleData[]>('/roles')
      .then(data => setRolesList((data || []).filter(r => r.code !== 'SUPERADMIN')))
      .catch(console.error)
  }

  useEffect(() => {
    loadUsers()
    loadRoles()
  }, [])

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      transports: ['websocket', 'polling'],
    })

    socket.on('usersChanged', () => {
      loadUsers()
    })

    socket.on('rolesChanged', () => {
      loadRoles()
    })

    return () => {
      socket.disconnect()
    }
  }, [])

  const availableRoles = useMemo(() => {
    if (rolesList.length > 0) {
      return rolesList
        .filter(r => isSuperAdmin || r.code !== 'SUPERADMIN')
        .map(r => ({
          value: r.code,
          label: `${r.name}${r.isSystem ? ' (Sistema)' : ' (Personalizado)'}`,
          color: r.color || '#10B981',
          permissions: r.permissions,
        }))
    }
    return [
      ...(isSuperAdmin ? [{ value: 'SUPERADMIN', label: 'Super Administrador (Ingeniero)', color: '#F59E0B' }] : []),
      { value: 'ADMIN', label: 'Administrador (Acceso Total)', color: '#3B82F6' },
      { value: 'CASHIER', label: 'Cajero (Caja, Pedidos, Domicilios)', color: '#10B981' },
      { value: 'DELIVERY_MANAGER', label: 'Gestor de Domicilios (WhatsApp, Despachos)', color: '#8B5CF6' },
      { value: 'ACCOUNTANT', label: 'Contador (Reportes, Caja, Liquidaciones)', color: '#0EA5E9' },
      { value: 'ACCOUNTING_ASSISTANT', label: 'Auxiliar Contable (Reportes, Gastos)', color: '#06B6D4' },
    ]
  }, [rolesList, isSuperAdmin])

  const passwordCriteria = useMemo(() => {
    return {
      minLength: password.length >= 8,
      hasUpper: /[A-Z]/.test(password),
      hasNumber: /[0-9]/.test(password),
      hasSymbol: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password),
    }
  }, [password])

  const passwordScore = useMemo(() => {
    if (!password) return 0
    let score = 0
    if (passwordCriteria.minLength) score += 1
    if (passwordCriteria.hasUpper) score += 1
    if (passwordCriteria.hasNumber) score += 1
    if (passwordCriteria.hasSymbol) score += 1
    return score
  }, [passwordCriteria, password])

  const validatePhone = (p: string) => {
    if (!p) {
      setPhoneError('')
      return true
    }
    if (p.length !== 10) {
      setPhoneError('Debe tener 10 dígitos (ej: 3001234567)')
      return false
    }
    setPhoneError('')
    return true
  }

  const handlePhoneChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 10)
    setPhone(digits)
    validatePhone(digits)
  }

  const handleRoleChange = (newRole: string) => {
    setRole(newRole)
    const foundRole = rolesList.find(r => r.code === newRole)
    if (foundRole && foundRole.permissions) {
      let perms = foundRole.permissions
      if (typeof perms === 'string') {
        try { perms = JSON.parse(perms) } catch (e) { perms = [] }
      }
      setSelectedPermissions(Array.isArray(perms) ? perms : getDefaultPermissionsForRole(newRole))
    } else {
      setSelectedPermissions(getDefaultPermissionsForRole(newRole))
    }
  }

  const resetForm = () => {
    setEditMode(false)
    setEditId(null)
    setName('')
    setEmail('')
    setPassword('')
    setShowPassword(false)
    setRole('CASHIER')
    setSelectedPermissions(getDefaultPermissionsForRole('CASHIER'))
    setPhone('')
    setPhoneError('')
    setModalTab('profile')
    setPermissionSearch('')
  }

  const openCreate = () => {
    resetForm()
    setOpen(true)
  }

  const openEdit = (u: UserData) => {
    if (u.role === 'SUPERADMIN' && !isSuperAdmin) {
      alerts.error('Operación denegada', 'Solo el Super Administrador puede modificar esta cuenta')
      return
    }
    setEditMode(true)
    setEditId(u.id)
    setName(u.name)
    setEmail(u.email)
    setPassword('')
    setShowPassword(false)
    setRole(u.role)
    setPhone(u.phone || '')
    setPhoneError('')
    setModalTab('profile')
    setPermissionSearch('')

    const currentPerms = parseUserPerms(u.permissions, u.role)
    setSelectedPermissions([...currentPerms])
    setOpen(true)
  }

  const togglePermission = (key: string) => {
    setSelectedPermissions(prev => {
      if (prev.includes(key)) {
        return prev.filter(k => k !== key)
      } else {
        return [...prev, key]
      }
    })
  }

  const toggleModuleAll = (module: PermissionModule) => {
    const moduleKeys = module.actions.map(a => a.key)
    setSelectedPermissions(prev => {
      const remaining = prev.filter(k => !moduleKeys.includes(k))
      return [...remaining, ...moduleKeys]
    })
  }

  const toggleModuleNone = (module: PermissionModule) => {
    const moduleKeys = module.actions.map(a => a.key)
    setSelectedPermissions(prev => prev.filter(k => !moduleKeys.includes(k)))
  }

  const selectAllPermissions = () => {
    setSelectedPermissions([...ALL_PERMISSION_KEYS])
  }

  const clearAllPermissions = () => {
    setSelectedPermissions([])
  }

  const resetToRoleDefaults = () => {
    const foundRole = rolesList.find(r => r.code === role)
    if (foundRole && foundRole.permissions) {
      let perms = foundRole.permissions
      if (typeof perms === 'string') {
        try { perms = JSON.parse(perms) } catch (e) { perms = [] }
      }
      setSelectedPermissions(Array.isArray(perms) ? perms : getDefaultPermissionsForRole(role))
    } else {
      setSelectedPermissions(getDefaultPermissionsForRole(role))
    }
    alerts.toast('Permisos restablecidos a los valores del rol.')
  }

  const filteredModules = useMemo(() => {
    const q = permissionSearch.trim().toLowerCase()
    if (!q) return SYSTEM_MODULES_PERMISSIONS
    return SYSTEM_MODULES_PERMISSIONS.map(m => {
      const matchModule = m.name.toLowerCase().includes(q)
      const matchingActions = m.actions.filter(a =>
        matchModule || a.label.toLowerCase().includes(q) || a.key.toLowerCase().includes(q)
      )
      return {
        ...m,
        actions: matchingActions,
      }
    }).filter(m => m.actions.length > 0)
  }, [permissionSearch])

  const handleSubmit = async () => {
    const cleanName = name.trim()
    let cleanEmail = email.trim()
    if (!cleanEmail && cleanName) {
      cleanEmail = cleanName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '')
      setEmail(cleanEmail)
    }

    if (!cleanName) {
      setModalTab('profile')
      alerts.warning('Nombre Requerido', 'Por favor ingresa el nombre completo del usuario en Datos Básicos.')
      return
    }
    if (!cleanEmail) {
      setModalTab('profile')
      alerts.warning('Usuario / Login Requerido', 'Por favor ingresa un nombre de usuario o login en Datos Básicos.')
      return
    }
    if (phone && phone.length !== 10) {
      setModalTab('profile')
      setPhoneError('Debe tener 10 dígitos')
      alerts.warning('Teléfono Inválido', 'El teléfono debe tener 10 dígitos (ej: 3001234567).')
      return
    }
    if (!editMode) {
      if (!password || password.length < 3) {
        setModalTab('profile')
        alerts.warning('Contraseña Requerida', 'Por favor ingresa una clave provisional (mínimo 3 caracteres).')
        return
      }
    } else if (password && password.length < 3) {
      setModalTab('profile')
      alerts.warning('Contraseña muy corta', 'La contraseña debe tener al menos 3 caracteres.')
      return
    }

    if (editMode && editId) {
      const editing = users.find(u => u.id === editId)
      if (editing?.role === 'SUPERADMIN' && !isSuperAdmin) {
        alerts.error('Operación denegada', 'El Super Administrador no se puede modificar desde aquí')
        return
      }
    }

    const payload: any = {
      name: cleanName,
      email: cleanEmail,
      role,
      permissions: [...selectedPermissions],
      phone: phone || undefined,
    }
    if (password) {
      payload.password = password
    }

    setPendingSecurityAction({
      type: 'SUBMIT',
      actionName: editMode ? `Actualizar Usuario "${cleanName}"` : `Crear Nuevo Usuario "${cleanName}"`,
      isEdit: editMode,
      editId: editMode ? editId : null,
      payload,
    })
    setShowSecurityModal(true)
  }

  const executeSaveUser = async (action?: any) => {
    setSubmitting(true)
    try {
      const isEdit = action?.isEdit !== undefined ? action.isEdit : editMode
      const targetEditId = action?.editId || editId

      const cleanName = name.trim()
      let cleanEmail = email.trim().toLowerCase()
      if (!cleanEmail && cleanName) {
        cleanEmail = cleanName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '')
      }

      const payload: any = action?.payload || {
        name: cleanName,
        email: cleanEmail,
        role,
        permissions: [...selectedPermissions],
        phone: phone || undefined,
        ...(password ? { password } : {}),
      }

      if (isEdit && targetEditId) {
        await api.put(`/users/${targetEditId}`, payload)
        alerts.success('Usuario Actualizado', `Los datos y ${payload.permissions?.length || 0} permisos de "${payload.name}" han sido guardados.`)
      } else {
        await api.post('/users', payload)
        alerts.success('¡Usuario Creado!', `El usuario "${payload.name}" fue creado exitosamente con ${payload.permissions?.length || 0} permisos asignados.`)
      }
      setOpen(false)
      resetForm()
      loadUsers()
    } catch (err: any) {
      alerts.error('Error al guardar', err.message || 'No se pudo guardar el usuario')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteUserClick = (u: UserData) => {
    if (u.role === 'SUPERADMIN') {
      alerts.error('Operación denegada', 'El Super Administrador no se puede eliminar')
      return
    }
    setPendingSecurityAction({
      type: 'DELETE',
      actionName: `Eliminar Definitivamente al Usuario "${u.name}"`,
      userId: u.id,
    })
    setShowSecurityModal(true)
  }

  const executeDeleteUser = async (action?: any) => {
    const targetUserId = action?.userId || pendingSecurityAction?.userId
    if (!targetUserId) return
    setDeleting(true)
    try {
      await api.delete(`/users/${targetUserId}`)
      alerts.success('Usuario Eliminado', 'El usuario ha sido retirado definitivamente del sistema.')
      setPendingSecurityAction(null)
      loadUsers()
    } catch (err: any) {
      alerts.error('Error al eliminar', err.message || 'No se pudo eliminar el usuario')
    } finally {
      setDeleting(false)
    }
  }

  const toggleActive = async (id: string, active: boolean) => {
    const targetUser = users.find(u => u.id === id)
    setPendingSecurityAction({
      type: 'TOGGLE',
      actionName: active ? `Desactivar Cuenta de "${targetUser?.name || 'Usuario'}"` : `Reactivar Cuenta de "${targetUser?.name || 'Usuario'}"`,
      userId: id,
      userActive: active,
    })
    setShowSecurityModal(true)
  }

  const executeToggleActive = async (action?: any) => {
    const targetUserId = action?.userId || pendingSecurityAction?.userId
    const userActive = action?.userActive !== undefined ? action.userActive : pendingSecurityAction?.userActive
    if (!targetUserId) return
    try {
      await api.put(`/users/${targetUserId}`, { active: !userActive })
      alerts.success('Estado Actualizado', 'El estado del usuario ha sido modificado exitosamente.')
      setPendingSecurityAction(null)
      loadUsers()
    } catch (err: any) {
      alerts.error('Error al actualizar', err.message || 'No se pudo cambiar el estado')
    }
  }

  const openPasswordDialog = (u: UserData) => {
    setPwdUserId(u.id)
    setPwdUserName(u.name)
    setNewPassword('')
    setShowNewPwd(false)
    setPwdSuccess(false)
  }

  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 8) {
      alerts.warning('Contraseña muy corta', 'La nueva contraseña debe tener al menos 8 caracteres.')
      return
    }
    setPwdSubmitting(true)
    try {
      await api.put(`/users/${pwdUserId}`, { password: newPassword })
      setPwdSuccess(true)
      alerts.success('Contraseña Actualizada', `La contraseña de ${pwdUserName} ha sido cambiada.`)
      setTimeout(() => {
        setPwdUserId(null)
      }, 1200)
    } catch (err: any) {
      alerts.error('Error al cambiar contraseña', err.message || 'No se pudo actualizar la contraseña')
    } finally {
      setPwdSubmitting(false)
    }
  }

  const activeUsers = users.filter(u => u.active)
  const inactiveUsers = users.filter(u => !u.active)
  const displayedUsers = activeTab === 'active' ? activeUsers : inactiveUsers

  const getInitials = (n: string) => {
    return n.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
  }

  const getRoleColor = (roleCode: string) => {
    const found = rolesList.find(r => r.code === roleCode)
    return found?.color || defaultRoleColors[roleCode] || '#10B981'
  }

  const getRoleLabel = (roleCode: string) => {
    const found = rolesList.find(r => r.code === roleCode)
    return found?.name || roleBadgeLabels[roleCode] || roleCode
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}>
          <div className="h-12 w-12 rounded-full border-[3px] border-[var(--accent)] border-t-transparent shadow-lg shadow-[var(--accent)]/20" />
        </motion.div>
        <p className="text-sm text-[var(--text-muted)] animate-pulse">Cargando directorio de usuarios...</p>
      </div>
    )
  }

  return (
    <motion.div className="space-y-7" initial="hidden" animate="visible" variants={stagger}>
      
      {/* ── Header ── */}
      <motion.div className="flex flex-wrap items-center justify-between gap-4" variants={fadeUp}>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl shadow-lg shadow-[var(--accent)]/10"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))' }}>
            <Users className="h-5 w-5 text-[var(--accent-fg)]" />
          </div>
          <div>
            <h2 className="antifont text-4xl tracking-wider text-[var(--text-primary)] leading-none">DIRECTORIO DE USUARIOS</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Gestión de empleados, roles dinámicos y matriz de permisos por módulo.</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Botón Gestor de Roles Dinámicos */}
          <Button
            variant="outline"
            onClick={() => setOpenRolesModal(true)}
            className="h-11 px-4 text-xs font-bold rounded-xl border-[var(--border-subtle)] bg-[var(--bg-panel)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] shadow-sm flex items-center gap-2 cursor-pointer"
          >
            <SlidersHorizontal className="h-4 w-4 text-[var(--accent)]" />
            <span>Gestionar Roles & Permisos</span>
          </Button>

          {/* Botón Crear Usuario */}
          <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); setOpen(v); }}>
            <DialogTrigger asChild>
              <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                <Button 
                  className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold shadow-lg shadow-[var(--accent)]/15 rounded-xl h-11 px-5 gap-2 cursor-pointer" 
                  onClick={openCreate}
                >
                  <Plus className="h-4 w-4" /> Nuevo Usuario
                </Button>
              </motion.div>
            </DialogTrigger>

            <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl shadow-2xl p-0 overflow-hidden max-w-4xl w-[95vw] max-h-[90vh] flex flex-col">
              <div className="h-1.5 w-full shrink-0" style={{ background: 'linear-gradient(90deg, var(--accent), #10B981, #06B6D4)' }} />
              
              <div className="p-6 pb-3 flex items-center justify-between border-b border-[var(--border-subtle)] shrink-0">
                <div>
                  <DialogTitle className="text-xl font-bold text-[var(--text-primary)] tracking-tight flex items-center gap-2">
                    <UserIcon className="h-5 w-5 text-[var(--accent)]" />
                    {editMode ? 'Editar Usuario y Permisos' : 'Crear Nuevo Usuario'}
                  </DialogTitle>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Define credenciales de acceso seguras y ajusta la matriz de permisos.</p>
                </div>

                {/* Tabs Switcher */}
                <div className="flex items-center gap-1.5 p-1 bg-[var(--bg-subtle)] rounded-xl border border-[var(--border-subtle)]">
                  <button
                    onClick={() => setModalTab('profile')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      modalTab === 'profile'
                        ? 'bg-[var(--bg-panel)] text-[var(--text-primary)] shadow-sm'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <UserIcon className="h-3.5 w-3.5" /> Datos Básicos
                  </button>
                  <button
                    onClick={() => setModalTab('permissions')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                      modalTab === 'permissions'
                        ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" /> Matriz de Permisos
                    <span className="ml-1 px-1.5 py-0.2 bg-black/20 text-[10px] rounded-full font-mono font-bold">
                      {selectedPermissions.length}
                    </span>
                  </button>
                </div>
              </div>
              
              {/* Modal Body with Scroll */}
              <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
                {modalTab === 'profile' ? (
                  <div className="space-y-4 max-w-xl mx-auto py-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Nombre Completo *</Label>
                      <Input 
                        className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-default)] focus:border-[var(--accent)]/50 focus:ring-1 focus:ring-[var(--accent)]/50 text-[var(--text-primary)] transition-all font-semibold" 
                        value={name} 
                        onChange={e => {
                          const val = e.target.value
                          setName(val)
                          if (!editMode) {
                            const autoLogin = val.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '')
                            setEmail(autoLogin)
                          }
                        }} 
                        placeholder="Escribe el nombre completo" 
                      />
                    </div>
                    
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Usuario / Login de Acceso *</Label>
                      <Input 
                        type="text" 
                        className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-default)] focus:border-[var(--accent)]/50 focus:ring-1 focus:ring-[var(--accent)]/50 text-[var(--text-primary)] transition-all font-semibold" 
                        value={email} 
                        onChange={e => setEmail(e.target.value)} 
                        placeholder="Escribe el usuario o login" 
                      />
                      <p className="text-[10px] text-[var(--text-muted)]">
                        Puede ser cualquier nombre de usuario. Al primer ingreso se le solicitará vincular su correo personal.
                      </p>
                    </div>

                    {/* Password Input */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                        Contraseña {editMode ? '(Opcional)' : 'Provisional *'}
                      </Label>

                      <div className="relative">
                        <Input 
                          type={showPassword ? 'text' : 'password'} 
                          className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-default)] focus:border-[var(--accent)]/50 focus:ring-1 focus:ring-[var(--accent)]/50 text-[var(--text-primary)] transition-all pr-10 font-mono text-xs" 
                          value={password} 
                          onChange={e => setPassword(e.target.value)} 
                          placeholder={editMode ? 'Dejar en blanco para mantener la actual' : 'Escribe una clave provisional (ej: 1234)'} 
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-3 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <p className="text-[10px] text-[var(--text-muted)]">
                        {editMode 
                          ? 'Si escribes una clave nueva se actualizará directamente.' 
                          : 'Clave provisional. Al ingresar por primera vez, el usuario deberá vincular su correo personal y crear su contraseña segura definitiva.'
                        }
                      </p>
                    </div>
                    
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Teléfono de Contacto</Label>
                      <Input 
                        className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-default)] focus:border-[var(--accent)]/50 focus:ring-1 focus:ring-[var(--accent)]/50 text-[var(--text-primary)] transition-all font-semibold" 
                        value={phone} 
                        onChange={e => handlePhoneChange(e.target.value)} 
                        placeholder="3001234567" 
                        maxLength={10} 
                      />
                      {phoneError && <p className="text-xs text-[var(--destructive)] mt-1">{phoneError}</p>}
                      {!phoneError && phone.length > 0 && phone.length < 10 && <p className="text-xs text-[var(--text-secondary)] mt-1">{phone.length}/10 dígitos</p>}
                    </div>
                    
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Rol de Acceso Asignado</Label>
                        <span className="text-[11px] text-[var(--text-muted)]">Aplica la plantilla base de permisos de ese rol</span>
                      </div>
                      {editMode && users.find(u => u.id === editId)?.role === 'SUPERADMIN' ? (
                        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs font-bold text-amber-500">
                          <Lock className="h-4 w-4 shrink-0" /> SUPER ADMIN (Rol inmutable)
                        </div>
                      ) : (
                        <Select value={role} onValueChange={handleRoleChange}>
                          <SelectTrigger className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-default)] focus:border-[var(--accent)]/50 text-[var(--text-primary)]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl">
                            {availableRoles.map(r => (
                              <SelectItem key={r.value} value={r.value} className="hover:bg-[var(--bg-hover)] text-[var(--text-primary)] cursor-pointer">
                                <span className="flex items-center gap-2">
                                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                                  {r.label}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>

                    <div className="pt-3">
                      <div className="flex items-center justify-between p-3.5 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                        <div>
                          <p className="text-xs font-bold text-[var(--text-primary)]">Permisos Granulares Activos</p>
                          <p className="text-[11px] text-[var(--text-secondary)]">Puedes personalizar cada permiso en la pestaña "Matriz de Permisos"</p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setModalTab('permissions')}
                          className="rounded-xl border-[var(--border-default)] font-bold text-xs gap-1.5 cursor-pointer"
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--accent)]" /> Configurar Permisos ({selectedPermissions.length})
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ── Granular Permissions Matrix ── */
                  <div className="space-y-4">
                    {/* Top Matrix Controls */}
                    <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                      <div className="flex items-center gap-2 flex-1 min-w-[240px]">
                        <Search className="h-4 w-4 text-[var(--text-muted)] shrink-0" />
                        <Input
                          placeholder="Buscar módulo o acción (ej. responder, anular, gastos)..."
                          value={permissionSearch}
                          onChange={e => setPermissionSearch(e.target.value)}
                          className="h-9 bg-[var(--bg-panel)] border-[var(--border-subtle)] text-xs rounded-xl"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={selectAllPermissions}
                          className="h-8 text-xs font-bold rounded-lg border-[var(--border-default)] text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 cursor-pointer"
                        >
                          <CheckSquare className="h-3.5 w-3.5 mr-1" /> Seleccionar Todos
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={clearAllPermissions}
                          className="h-8 text-xs font-bold rounded-lg border-[var(--border-default)] text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                        >
                          <Square className="h-3.5 w-3.5 mr-1" /> Deseleccionar Todos
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={resetToRoleDefaults}
                          className="h-8 text-xs font-bold rounded-lg border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer"
                          title="Restablecer a los permisos sugeridos para este rol"
                        >
                          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Valores por Rol
                        </Button>
                      </div>
                    </div>

                    {/* Summary Bar */}
                    <div className="flex items-center justify-between px-2 text-xs font-semibold text-[var(--text-secondary)]">
                      <span>Módulos y Acciones del Sistema</span>
                      <span className="flex items-center gap-1.5 font-mono text-[var(--accent)] font-bold">
                        <ShieldCheck className="h-4 w-4" />
                        {selectedPermissions.length} de {ALL_PERMISSION_KEYS.length} permisos habilitados
                      </span>
                    </div>

                    {/* Permissions Table by Module */}
                    <div className="border border-[var(--border-subtle)] rounded-2xl overflow-hidden bg-[var(--bg-panel)] divide-y divide-[var(--border-subtle)]">
                      {filteredModules.map(mod => {
                        const ModIcon = moduleIcons[mod.id] || Shield
                        const moduleKeys = mod.actions.map(a => a.key)
                        const activeInModule = moduleKeys.filter(k => selectedPermissions.includes(k)).length
                        const allActive = activeInModule === moduleKeys.length
                        const noneActive = activeInModule === 0

                        return (
                          <div key={mod.id} className="grid grid-cols-1 md:grid-cols-12 hover:bg-[var(--bg-subtle)]/40 transition-colors">
                            {/* Left Column: Module Info & Quick Buttons */}
                            <div className="md:col-span-4 p-4 border-b md:border-b-0 md:border-r border-[var(--border-subtle)] bg-[var(--bg-elevated)]/30 flex flex-col justify-between">
                              <div>
                                <div className="flex items-center gap-2 font-bold text-sm text-[var(--text-primary)]">
                                  <div className="h-7 w-7 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] flex items-center justify-center shrink-0">
                                    <ModIcon className="h-4 w-4" />
                                  </div>
                                  <span>{mod.name}</span>
                                </div>
                                <p className="text-[11px] text-[var(--text-muted)] mt-1 ml-9">
                                  {activeInModule} de {mod.actions.length} acciones
                                </p>
                              </div>

                              {/* Quick Row Buttons */}
                              <div className="flex items-center gap-2 mt-3 pt-2 border-t border-[var(--border-subtle)]/60 text-xs">
                                <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Acciones:</span>
                                <button
                                  type="button"
                                  onClick={() => toggleModuleAll(mod)}
                                  className={`text-[11px] font-bold transition-colors cursor-pointer ${
                                    allActive ? 'text-[var(--accent)] underline' : 'text-blue-500 hover:underline'
                                  }`}
                                >
                                  Todas
                                </button>
                                <span className="text-[var(--text-muted)]">-</span>
                                <button
                                  type="button"
                                  onClick={() => toggleModuleNone(mod)}
                                  className={`text-[11px] font-bold transition-colors cursor-pointer ${
                                    noneActive ? 'text-[var(--destructive)] underline' : 'text-[var(--text-muted)] hover:text-[var(--destructive)] hover:underline'
                                  }`}
                                >
                                  Ninguna
                                </button>
                              </div>
                            </div>

                            {/* Right Column: Checkbox Action Grid */}
                            <div className="md:col-span-8 p-4">
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {mod.actions.map(action => {
                                  const isChecked = selectedPermissions.includes(action.key)
                                  return (
                                    <label
                                      key={action.key}
                                      onClick={() => togglePermission(action.key)}
                                      className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer select-none text-xs ${
                                        isChecked
                                          ? 'border-[var(--accent)]/40 bg-[var(--accent)]/5 text-[var(--text-primary)] shadow-sm'
                                          : 'border-[var(--border-subtle)] bg-[var(--bg-panel)] text-[var(--text-secondary)] hover:border-[var(--border-default)]'
                                      }`}
                                    >
                                      <div className={`h-4 w-4 rounded-md flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                                        isChecked ? 'bg-emerald-600 text-white shadow-sm' : 'border border-[var(--border-default)] bg-[var(--bg-elevated)]'
                                      }`}>
                                        {isChecked && <Check className="h-3 w-3 stroke-[3]" />}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <span className={`font-semibold leading-tight block ${isChecked ? 'text-[var(--text-primary)]' : ''}`}>
                                          {action.label}
                                        </span>
                                        <span className="text-[10px] text-[var(--text-muted)] font-mono block truncate mt-0.5">
                                          {action.key}
                                        </span>
                                      </div>
                                    </label>
                                  )
                                })}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="p-4 px-6 border-t border-[var(--border-subtle)] bg-[var(--bg-subtle)]/40 flex items-center justify-between shrink-0">
                <div className="text-xs text-[var(--text-muted)] font-medium">
                  {modalTab === 'profile' ? (
                    <span>Configura los accesos en la pestaña <strong>Matriz de Permisos</strong></span>
                  ) : (
                    <span>Total asignado: <strong className="text-[var(--text-primary)]">{selectedPermissions.length} permisos</strong></span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 px-4 rounded-xl border-[var(--border-default)] font-bold text-xs"
                    onClick={() => setOpen(false)}
                    disabled={submitting}
                  >
                    Cerrar
                  </Button>
                  <Button 
                    className="h-10 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-lg shadow-emerald-900/20 rounded-xl transition-all gap-2 cursor-pointer" 
                    onClick={handleSubmit} 
                    disabled={submitting}
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    {submitting ? 'Guardando...' : editMode ? 'Guardar Cambios' : 'Crear Usuario'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </motion.div>

      {/* ── Sub Navigation Tabs (Activos / Inactivos) ── */}
      <motion.div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-2" variants={fadeUp}>
        <button
          onClick={() => setActiveTab('active')}
          className={`pb-2 px-3 text-xs font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === 'active'
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          ACTIVOS ({activeUsers.length})
        </button>
        <button
          onClick={() => setActiveTab('inactive')}
          className={`pb-2 px-3 text-xs font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === 'inactive'
              ? 'border-[var(--destructive)] text-[var(--destructive)]'
              : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          INACTIVOS ({inactiveUsers.length})
        </button>
      </motion.div>

      {/* ── Users Grid ── */}
      <motion.div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5" variants={stagger}>
        {displayedUsers.map(u => {
          const RoleIcon = roleIcons[u.role] || UserIcon
          const isCurrent = currentUser?.id === u.id
          const userPerms = parseUserPerms(u.permissions, u.role)
          const defaultPerms = getDefaultPermissionsForRole(u.role)
          const isCustomPerms = u.permissions !== null && u.permissions !== undefined && (
            userPerms.length !== defaultPerms.length ||
            userPerms.some(p => !defaultPerms.includes(p))
          )

          return (
            <motion.div
              key={u.id}
              variants={fadeUp}
              whileHover={{ y: -3 }}
              className={`rounded-3xl border transition-all overflow-hidden bg-[var(--bg-panel)] flex flex-col justify-between p-5 relative shadow-sm ${
                u.active
                  ? 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:shadow-md'
                  : 'border-rose-500/20 bg-rose-500/[0.02] opacity-80'
              }`}
            >
              <div className="space-y-4">
                {/* User Top Row: Avatar, Name, Email, Action Icons */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-12 w-12 rounded-2xl flex items-center justify-center text-white font-bold text-base shadow-sm shrink-0"
                      style={{ backgroundColor: getRoleColor(u.role) }}
                    >
                      {getInitials(u.name)}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-[var(--text-primary)] truncate flex items-center gap-2">
                        {u.name}
                        {isCurrent && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-bold">
                            TÚ
                          </span>
                        )}
                      </h3>
                      <p className="text-xs text-[var(--text-secondary)] truncate flex items-center gap-1 mt-0.5">
                        <Mail className="h-3 w-3 shrink-0" /> {u.email}
                      </p>
                    </div>
                  </div>

                    {/* Action Icons */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => openEdit(u)}
                        className="h-8 w-8 rounded-xl flex items-center justify-center text-emerald-600 hover:bg-emerald-500/10 transition-colors cursor-pointer"
                        title="Editar usuario y matriz de permisos"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => openPasswordDialog(u)}
                        className="h-8 w-8 rounded-xl flex items-center justify-center text-purple-600 hover:bg-purple-500/10 transition-colors cursor-pointer"
                        title="Cambiar contraseña"
                      >
                        <KeyRound className="h-4 w-4" />
                      </button>
                      {isSuperAdmin && u.id !== currentUser?.id && u.role !== 'SUPERADMIN' && (
                        <button
                          onClick={() => handleImpersonate(u)}
                          className="h-8 w-8 rounded-xl flex items-center justify-center text-amber-600 hover:bg-amber-500/10 transition-colors cursor-pointer"
                          title="Iniciar sesión de soporte"
                        >
                          {impersonatingId === u.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                        </button>
                      )}
                      {u.role !== 'SUPERADMIN' && u.id !== currentUser?.id && (
                        <button
                          onClick={() => handleDeleteUserClick(u)}
                          className="h-8 w-8 rounded-xl flex items-center justify-center text-rose-600 hover:bg-rose-500/10 transition-colors cursor-pointer"
                          title="Eliminar usuario definitivamente"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                </div>

                {/* Role and Info Badges */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <div
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold border"
                    style={{
                      borderColor: `${getRoleColor(u.role)}30`,
                      backgroundColor: `${getRoleColor(u.role)}10`,
                      color: getRoleColor(u.role),
                    }}
                  >
                    <RoleIcon className="h-3.5 w-3.5" />
                    {getRoleLabel(u.role)}
                  </div>

                  <div className={`px-2.5 py-1 rounded-xl text-[11px] font-bold ${
                    u.active ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'
                  }`}>
                    {u.active ? 'ACTIVO' : 'INACTIVO'}
                  </div>

                  {u.mustVerifyEmail && (
                    <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[10px] font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20">
                      <Clock className="h-3 w-3" />
                      <span>Clave Provisional (48h)</span>
                    </div>
                  )}

                  {u.phone && (
                    <div className="text-xs text-[var(--text-secondary)] font-mono flex items-center gap-1 ml-auto">
                      <Phone className="h-3 w-3" /> {u.phone}
                    </div>
                  )}
                </div>

                {/* Granular Permissions Indicator Pill */}
                <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between text-xs">
                  <span className="text-[var(--text-muted)] text-[11px] flex items-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5 text-[var(--accent)]" /> Permisos:
                  </span>
                  <button
                    onClick={() => { openEdit(u); setModalTab('permissions'); }}
                    className="text-[11px] font-bold text-[var(--accent)] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <span>{userPerms.length} de {ALL_PERMISSION_KEYS.length} acciones</span>
                    {isCustomPerms && (
                      <span className="px-1.5 py-0.2 rounded-full bg-blue-500/10 text-blue-600 text-[10px] font-bold">
                        Personalizado
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Bottom Toggle Button */}
              {u.role !== 'SUPERADMIN' && (
                <div className="mt-4 pt-3 border-t border-[var(--border-subtle)]">
                  <button
                    onClick={() => toggleActive(u.id, u.active)}
                    className={`w-full py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                      u.active
                        ? 'text-rose-600 hover:bg-rose-500/10'
                        : 'text-emerald-600 hover:bg-emerald-500/10'
                    }`}
                  >
                    {u.active ? 'DESACTIVAR CUENTA' : 'REACTIVAR CUENTA'}
                  </button>
                </div>
              )}
            </motion.div>
          )
        })}
      </motion.div>

      {/* ── Password Change Dialog ── */}
      <Dialog open={!!pwdUserId} onOpenChange={(v) => { if (!v) setPwdUserId(null); }}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl max-w-sm p-0 overflow-hidden shadow-2xl">
          <div className="h-1.5 w-full" style={{ background: 'linear-gradient(90deg, #8B5CF6, #6366F1)' }} />
          <div className="p-6">
            <DialogHeader className="pb-4">
              <DialogTitle className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-purple-500" /> Cambiar Contraseña
              </DialogTitle>
              <DialogDescription className="text-xs text-[var(--text-secondary)] mt-1">
                Cambiar contraseña de <strong className="text-[var(--text-primary)]">{pwdUserName}</strong>
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Nueva Contraseña *</Label>
                <div className="relative">
                  <Input 
                    type={showNewPwd ? 'text' : 'password'}
                    className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-default)] focus:border-purple-500/50 pr-10 text-[var(--text-primary)] font-semibold" 
                    value={newPassword} 
                    onChange={e => setNewPassword(e.target.value)} 
                    placeholder="Mínimo 8 caracteres" 
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPwd(!showNewPwd)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    {showNewPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {pwdSuccess && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 text-xs font-bold flex items-center gap-2">
                  <Check className="h-4 w-4" /> Contraseña actualizada correctamente
                </div>
              )}
            </div>

            <DialogFooter className="mt-6 flex gap-2">
              <Button variant="outline" className="border-[var(--border-default)] rounded-xl h-11 flex-1 font-bold text-xs" onClick={() => setPwdUserId(null)} disabled={pwdSubmitting}>
                Cancelar
              </Button>
              <Button 
                className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl h-11 flex-1 font-bold text-xs gap-1.5 cursor-pointer shadow-lg shadow-purple-600/20" 
                onClick={handleChangePassword} 
                disabled={pwdSubmitting || newPassword.length < 8}
              >
                {pwdSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                {pwdSubmitting ? 'Guardando...' : 'Actualizar'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dynamic Roles Manager Modal ── */}
      <RolesManagerModal
        open={openRolesModal}
        onClose={() => setOpenRolesModal(false)}
        onRolesUpdated={() => {
          loadRoles()
          loadUsers()
        }}
      />

      {/* ── Dual Security Action Confirmation Modal (Style Meta) ── */}
      <SecurityActionConfirmModal
        open={showSecurityModal}
        actionName={pendingSecurityAction?.actionName || 'Confirmar Acción'}
        title="Confirmación de Seguridad Requerida"
        description="Esta acción afectará los accesos y credenciales de usuarios en el sistema."
        onClose={() => {
          setShowSecurityModal(false)
          setPendingSecurityAction(null)
        }}
        onSuccess={async () => {
          const action = pendingSecurityAction
          setShowSecurityModal(false)
          setPendingSecurityAction(null)
          if (action?.type === 'SUBMIT') {
            await executeSaveUser(action)
          } else if (action?.type === 'DELETE') {
            await executeDeleteUser(action)
          } else if (action?.type === 'TOGGLE') {
            await executeToggleActive(action)
          }
        }}
      />
    </motion.div>
  )
}
