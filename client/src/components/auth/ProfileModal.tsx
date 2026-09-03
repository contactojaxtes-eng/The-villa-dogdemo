import React, { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import { alerts } from '@/lib/alerts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { 
  User as UserIcon, 
  Mail, 
  Phone, 
  Lock, 
  ShieldCheck, 
  X, 
  Save, 
  KeyRound, 
  Eye, 
  EyeOff, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  XCircle,
  Send
} from 'lucide-react'

interface ProfileModalProps {
  open: boolean
  onClose: () => void
}

const roleLabels: Record<string, string> = {
  SUPERADMIN: 'Super Administrador',
  ADMIN: 'Administrador General',
  CASHIER: 'Cajero / Punto de Venta',
  DELIVERY_MANAGER: 'Gestor de Domicilios',
  WAITER: 'Mesero',
  KITCHEN: 'Cocinero',
  ACCOUNTANT: 'Contador',
  ACCOUNTING_ASSISTANT: 'Auxiliar Contable',
}

export function ProfileModal({ open, onClose }: ProfileModalProps) {
  const { user, updateProfile, requestEmailChange, verifyCurrentEmailStep1, confirmNewEmailStep2, requestPasswordChange, confirmPasswordChange } = useAuth()
  const [activeTab, setActiveTab] = useState<'profile' | 'password'>('profile')

  // Profile Form States
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  // Email Change 2FA OTP States (2-step verification)
  const [showEmailOtpModal, setShowEmailOtpModal] = useState(false)
  const [emailOtpStep, setEmailOtpStep] = useState<number>(1)
  const [pendingNewEmail, setPendingNewEmail] = useState('')
  const [emailOtpCode, setEmailOtpCode] = useState('')
  const [emailOtpLoading, setEmailOtpLoading] = useState(false)
  const [emailOtpError, setEmailOtpError] = useState('')
  const [emailOtpCurrent, setEmailOtpCurrent] = useState('')

  // Password Form States
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [passwordError, setPasswordError] = useState('')

  // Password OTP Modal States
  const [showPasswordOtpModal, setShowPasswordOtpModal] = useState(false)
  const [passwordOtpCode, setPasswordOtpCode] = useState('')
  const [passwordOtpLoading, setPasswordOtpLoading] = useState(false)
  const [passwordOtpError, setPasswordOtpError] = useState('')
  const [passwordOtpSentTo, setPasswordOtpSentTo] = useState('')
  const [passwordCountdown, setPasswordCountdown] = useState(0)

  useEffect(() => {
    let timer: any
    if (passwordCountdown > 0) {
      timer = setTimeout(() => setPasswordCountdown(c => c - 1), 1000)
    }
    return () => clearTimeout(timer)
  }, [passwordCountdown])

  useEffect(() => {
    if (user && open) {
      setName(user.name || '')
      setEmail(user.email || '')
      setPhone(user.phone || '')
      setActiveTab('profile')
      setPasswordError('')
      setPasswordSuccess(false)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setShowCurrentPassword(false)
      setShowNewPassword(false)
      setShowConfirmPassword(false)
    }
  }, [user, open])

  const initials = user?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '??'

  // Strict Password Strength Calculation
  const passwordCriteria = useMemo(() => {
    const pwd = newPassword || ''
    const hasMinLen = pwd.length >= 8
    const hasUpper = /[A-Z]/.test(pwd)
    const hasNumber = /[0-9]/.test(pwd)
    const hasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pwd)
    const score = [hasMinLen, hasUpper, hasNumber, hasSpecial].filter(Boolean).length
    const isStrong = pwd.length >= 4
    return { hasMinLen, hasUpper, hasNumber, hasSpecial, score, isStrong }
  }, [newPassword])

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      alerts.error('El nombre no puede estar vacío')
      return
    }
    if (!email.trim()) {
      alerts.error('El correo no puede estar vacío')
      return
    }
    setSavingProfile(true)
    try {
      // 1. Guardar nombre y teléfono
      await updateProfile({
        name: name.trim(),
        phone: phone.trim(),
      })

      // 2. Si el correo cambió respecto al actual:
      if (email.trim().toLowerCase() !== user?.email?.toLowerCase()) {
        const res = await requestEmailChange(email.trim().toLowerCase())
        if (res.requiresOtp) {
          setPendingNewEmail(email.trim().toLowerCase())
          setEmailOtpStep(res.step || 1)
          setEmailOtpCurrent(res.currentEmail || user?.email || '')
          setEmailOtpCode('')
          setEmailOtpError('')
          setShowEmailOtpModal(true)
          setSavingProfile(false)
          return
        }
        setEmail(res.newEmail || email.trim().toLowerCase())
      }

      alerts.success('Perfil actualizado correctamente')
    } catch (err: any) {
      alerts.error('Error al actualizar perfil', err.message || 'No se pudo guardar los cambios')
    } finally {
      setSavingProfile(false)
    }
  }

  const handleCloseEmailOtpModal = () => {
    setShowEmailOtpModal(false)
    setEmail(user?.email || '')
    setPendingNewEmail('')
    setEmailOtpStep(1)
    setEmailOtpCode('')
    setEmailOtpError('')
  }

  const handleConfirmEmailOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setEmailOtpError('')
    if (emailOtpCode.length < 6) {
      setEmailOtpError('Ingresa el código completo de 6 dígitos')
      return
    }
    setEmailOtpLoading(true)
    try {
      if (emailOtpStep === 1) {
        // Paso 1: Validar código del correo actual -> Pasa a Paso 2
        await verifyCurrentEmailStep1(pendingNewEmail, emailOtpCode)
        setEmailOtpStep(2)
        setEmailOtpCode('')
        setEmailOtpError('')
        alerts.success('Paso 1 completado', 'Revisa tu nuevo correo para el código de activación.')
      } else {
        // Paso 2: Validar código del nuevo correo -> Guarda en DB y activa
        await confirmNewEmailStep2(pendingNewEmail, emailOtpCode)
        setShowEmailOtpModal(false)
        setEmail(pendingNewEmail)
        alerts.success('¡Correo activado con éxito!', 'El nuevo correo quedó vinculado y el anterior desvinculado.')
      }
    } catch (err: any) {
      setEmailOtpError(err.message || 'Código de seguridad incorrecto o expirado (Válido por 5 minutos)')
    } finally {
      setEmailOtpLoading(false)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError('')
    setPasswordSuccess(false)

    if (!currentPassword) {
      setPasswordError('Ingresa tu contraseña actual')
      return
    }
    if (!passwordCriteria.isStrong) {
      setPasswordError('La nueva contrasena debe tener al menos 4 caracteres.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Las nuevas contraseñas no coinciden')
      return
    }

    if (currentPassword === newPassword) {
      setPasswordError('La nueva contraseña no puede ser igual a la actual')
      return
    }

    setSavingPassword(true)
    try {
      const res = await requestPasswordChange(currentPassword, newPassword)
      if (res.requiresOtp) {
        setPasswordOtpSentTo(res.sentTo || user?.email || '')
        setPasswordOtpCode('')
        setPasswordOtpError('')
        setPasswordCountdown(60)
        setShowPasswordOtpModal(true)
        alerts.info('Código Enviado', 'Enviamos un código de seguridad de 6 dígitos a tu correo para autorizar el cambio.')
      } else {
        setPasswordSuccess(true)
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        alerts.success('¡Contraseña actualizada con éxito!')
      }
    } catch (err: any) {
      setPasswordError(err.message || 'No se pudo procesar la solicitud')
    } finally {
      setSavingPassword(false)
    }
  }

  const handleResendPasswordOtp = async () => {
    if (passwordCountdown > 0) return
    setPasswordOtpLoading(true)
    setPasswordOtpError('')
    try {
      const res = await requestPasswordChange(currentPassword, newPassword)
      setPasswordCountdown(60)
      alerts.success('Código Reenviado', `Enviamos un nuevo código a ${res.sentTo || user?.email}`)
    } catch (err: any) {
      setPasswordOtpError(err.message || 'No se pudo reenviar el código')
    } finally {
      setPasswordOtpLoading(false)
    }
  }

  const handleConfirmPasswordOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordOtpError('')
    if (passwordOtpCode.length < 6) {
      setPasswordOtpError('Ingresa el código de 6 dígitos que te enviamos al correo')
      return
    }
    setPasswordOtpLoading(true)
    try {
      await confirmPasswordChange(currentPassword, newPassword, passwordOtpCode)
      setShowPasswordOtpModal(false)
      setPasswordSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordOtpCode('')
      alerts.success('¡Contraseña actualizada con éxito!')
    } catch (err: any) {
      setPasswordOtpError(err.message || 'Código de seguridad incorrecto o expirado (Válido por 5 minutos)')
    } finally {
      setPasswordOtpLoading(false)
    }
  }

  if (!open) return null

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative w-full max-w-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-3xl shadow-2xl overflow-hidden z-10 flex flex-col max-h-[90vh]"
        >
          {/* Neon Top Border */}
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent" />

          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40">
            <div className="flex items-center gap-3.5">
              <div className="h-11 w-11 rounded-2xl bg-[var(--accent)]/15 border border-[var(--accent)]/25 flex items-center justify-center text-[var(--accent)] shadow-sm">
                <UserIcon className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-[var(--text-primary)] font-comfortaa">Mi Perfil & Seguridad</h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="outline" className="border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[10px] text-[var(--accent)] font-semibold px-2 py-0.5">
                    {roleLabels[user?.role || ''] || user?.role}
                  </Badge>
                  <span className="text-[11px] text-[var(--text-muted)] font-mono">{user?.email}</span>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-xl transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tabs Switcher */}
          <div className="flex border-b border-[var(--border-subtle)] bg-[var(--bg-base)]/50 px-6 pt-2">
            <button
              type="button"
              onClick={() => setActiveTab('profile')}
              className={`flex items-center gap-2 pb-3 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
                activeTab === 'profile'
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <UserIcon className="h-3.5 w-3.5" />
              Datos Básicos
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('password')}
              className={`flex items-center gap-2 pb-3 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
                activeTab === 'password'
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <KeyRound className="h-3.5 w-3.5" />
              Cambiar Contraseña
            </button>
          </div>

          {/* Tab Content */}
          <div className="p-6 overflow-y-auto space-y-5">
            {activeTab === 'profile' ? (
              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-[var(--text-secondary)] font-medium pl-1">Nombre Completo</Label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--text-muted)]">
                      <UserIcon className="h-4 w-4" />
                    </div>
                    <Input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      className="pl-10.5 bg-[var(--bg-input)] border-[var(--border-default)] text-[var(--text-primary)] text-xs h-10.5 rounded-xl"
                      placeholder="Tu nombre"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-[var(--text-secondary)] font-medium pl-1 flex items-center justify-between">
                    <span>Correo Electrónico (Gmail / Personal)</span>
                    <span className="text-[10px] text-[var(--accent)] font-normal">Para alertas y recuperación</span>
                  </Label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--text-muted)]">
                      <Mail className="h-4 w-4" />
                    </div>
                    <Input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="pl-10.5 bg-[var(--bg-input)] border-[var(--border-default)] text-[var(--text-primary)] text-xs h-10.5 rounded-xl"
                      placeholder="correo@gmail.com"
                      required
                    />
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)] pl-1">
                    Si cambias este correo, te enviaremos un código de confirmación a tu correo actual.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-[var(--text-secondary)] font-medium pl-1">Teléfono / WhatsApp</Label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--text-muted)]">
                      <Phone className="h-4 w-4" />
                    </div>
                    <Input
                      type="tel"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      className="pl-10.5 bg-[var(--bg-input)] border-[var(--border-default)] text-[var(--text-primary)] text-xs h-10.5 rounded-xl"
                      placeholder="300 000 0000"
                    />
                  </div>
                </div>

                <div className="pt-3">
                  <Button
                    type="submit"
                    disabled={savingProfile}
                    className="w-full h-11 bg-gradient-to-r from-[#E30613] to-[#C40510] hover:opacity-95 text-white font-bold text-xs rounded-xl shadow-lg shadow-[#E30613]/20 cursor-pointer"
                  >
                    {savingProfile ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Guardando Cambios...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <Save className="h-4 w-4" /> Guardar Mis Datos
                      </span>
                    )}
                  </Button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleChangePassword} className="space-y-4">
                {passwordSuccess && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-center gap-2.5 text-xs text-emerald-400">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>Tu contraseña ha sido actualizada con éxito.</span>
                  </div>
                )}

                {passwordError && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 flex items-center gap-2.5 text-xs text-rose-400">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{passwordError}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs text-[var(--text-secondary)] font-medium pl-1">Contraseña Actual</Label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--text-muted)]">
                      <Lock className="h-4 w-4" />
                    </div>
                    <Input
                      type={showCurrentPassword ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={e => setCurrentPassword(e.target.value)}
                      className="pl-10.5 pr-10.5 bg-[var(--bg-input)] border-[var(--border-default)] text-[var(--text-primary)] text-xs h-10.5 rounded-xl"
                      placeholder="Escribe tu clave actual"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                    >
                      {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-[var(--text-secondary)] font-medium pl-1">Nueva Contraseña</Label>
                    {newPassword && (
                      <span className={`text-[11px] font-bold ${
                        passwordCriteria.score <= 2 ? 'text-red-500' : passwordCriteria.score === 3 ? 'text-amber-500' : 'text-emerald-500'
                      }`}>
                        {passwordCriteria.score <= 1 ? 'Muy Débil' : passwordCriteria.score === 2 ? 'Regular' : passwordCriteria.score === 3 ? 'Buena' : 'Muy Segura'}
                      </span>
                    )}
                  </div>

                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--text-muted)]">
                      <KeyRound className="h-4 w-4" />
                    </div>
                    <Input
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      className="pl-10.5 pr-10.5 bg-[var(--bg-input)] border-[var(--border-default)] text-[var(--text-primary)] text-xs h-10.5 rounded-xl font-mono"
                      placeholder="Minimo 4 caracteres"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                    >
                      {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  {/* Password Strength Checklist & Bar */}
                  {newPassword.length > 0 && (
                    <div className="space-y-2 p-3 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl mt-1.5 animate-in fade-in duration-200">
                      {/* 4-segment strength bar */}
                      <div className="grid grid-cols-4 gap-1.5">
                        {[1, 2, 3, 4].map(idx => (
                          <div
                            key={idx}
                            className={`h-1.5 rounded-full transition-all ${
                              passwordCriteria.score >= idx
                                ? passwordCriteria.score <= 2 ? 'bg-red-500' : passwordCriteria.score === 3 ? 'bg-amber-500' : 'bg-emerald-500'
                                : 'bg-[var(--border-default)]'
                            }`}
                          />
                        ))}
                      </div>

                      {/* 4-point Checklist */}
                      <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                        <div className={`flex items-center gap-1.5 ${passwordCriteria.hasMinLen ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-[var(--text-muted)]'}`}>
                          {passwordCriteria.hasMinLen ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" /> : <XCircle className="w-3.5 h-3.5 shrink-0 opacity-40" />}
                      <span>Minimo 4 caracteres</span>
                        </div>

                        <div className={`flex items-center gap-1.5 ${passwordCriteria.hasUpper ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-[var(--text-muted)]'}`}>
                          {passwordCriteria.hasUpper ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" /> : <XCircle className="w-3.5 h-3.5 shrink-0 opacity-40" />}
                          <span>1 Mayúscula (A-Z)</span>
                        </div>

                        <div className={`flex items-center gap-1.5 ${passwordCriteria.hasNumber ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-[var(--text-muted)]'}`}>
                          {passwordCriteria.hasNumber ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" /> : <XCircle className="w-3.5 h-3.5 shrink-0 opacity-40" />}
                          <span>1 Número (0-9)</span>
                        </div>

                        <div className={`flex items-center gap-1.5 ${passwordCriteria.hasSpecial ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-[var(--text-muted)]'}`}>
                          {passwordCriteria.hasSpecial ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" /> : <XCircle className="w-3.5 h-3.5 shrink-0 opacity-40" />}
                          <span>1 Símbolo (!@#$*...)</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-[var(--text-secondary)] font-medium pl-1">Confirmar Nueva Contraseña</Label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--text-muted)]">
                      <ShieldCheck className="h-4 w-4" />
                    </div>
                    <Input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className="pl-10.5 pr-10.5 bg-[var(--bg-input)] border-[var(--border-default)] text-[var(--text-primary)] text-xs h-10.5 rounded-xl font-mono"
                      placeholder="Repite la nueva contraseña"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                    >
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="pt-3">
                  <Button
                    type="submit"
                    disabled={savingPassword || !currentPassword || !newPassword || !confirmPassword || !passwordCriteria.isStrong}
                    className="w-full h-11 bg-gradient-to-r from-[#E30613] to-[#C40510] hover:opacity-95 text-white font-bold text-xs rounded-xl shadow-lg shadow-[#E30613]/20 cursor-pointer disabled:opacity-50"
                  >
                    {savingPassword ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Actualizando...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <KeyRound className="h-4 w-4" /> Actualizar Contraseña
                      </span>
                    )}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </motion.div>
      </div>

      {/* Email Change 2FA Security Modal */}
      <AnimatePresence>
        {showEmailOtpModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleCloseEmailOtpModal}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-md bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-3xl shadow-2xl overflow-hidden p-6 z-10 space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2.5 rounded-2xl ${emailOtpStep === 1 ? 'bg-amber-500/15 text-amber-500 border-amber-500/25' : 'bg-emerald-500/15 text-emerald-500 border-emerald-500/25'} border`}>
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-[var(--text-primary)] font-comfortaa">
                        {emailOtpStep === 1 ? 'Paso 1: Autorizar Desvinculación' : 'Paso 2: Activar Nuevo Correo'}
                      </h3>
                    </div>
                    <p className="text-[11px] text-[var(--text-secondary)]">
                      {emailOtpStep === 1 ? 'Confirmación con tu correo actual' : 'Verificación de tu nuevo correo'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCloseEmailOtpModal}
                  className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-xl transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {emailOtpStep === 1 ? (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-300 space-y-1">
                  <p>🔒 Enviamos un código de autorización de 6 dígitos a tu <strong>correo actual</strong>:</p>
                  <p className="font-mono font-bold text-white text-xs py-0.5">{emailOtpCurrent}</p>
                  <p className="text-[11px] text-amber-400/80 pt-1">
                    ⏱️ <strong>Vigencia:</strong> 5 minutos.<br/>
                    Una vez autorizado, te enviaremos el código final a tu nuevo correo (<strong className="text-white">{pendingNewEmail}</strong>) para activarlo.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-300 space-y-1">
                  <p>✅ ¡Paso 1 autorizado! Enviamos el código de activación a tu <strong>NUEVO correo</strong>:</p>
                  <p className="font-mono font-bold text-white text-xs py-0.5">{pendingNewEmail}</p>
                  <p className="text-[11px] text-emerald-400/80 pt-1">
                    ⏱️ <strong>Vigencia:</strong> 5 minutos.<br/>
                    Ingrésalo a continuación para confirmar que lo recibiste y dejar tu cuenta 100% activa con el nuevo correo.
                  </p>
                </div>
              )}

              <form onSubmit={handleConfirmEmailOtp} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-[var(--text-secondary)]">
                    {emailOtpStep === 1 ? 'Código de Autorización (Correo Actual)' : 'Código de Activación (Nuevo Correo)'}
                  </Label>
                  <Input
                    type="text"
                    maxLength={6}
                    placeholder="Ej: 719402"
                    value={emailOtpCode}
                    onChange={e => setEmailOtpCode(e.target.value.replace(/\D/g, ''))}
                    className="h-11 text-center text-lg font-mono tracking-widest rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]"
                    required
                    autoFocus
                  />
                </div>

                {emailOtpError && (
                  <p className="rounded-xl border border-red-500/25 bg-red-500/8 px-3.5 py-2 text-xs text-red-400">
                    {emailOtpError}
                  </p>
                )}

                <div className="flex gap-2 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleCloseEmailOtpModal}
                    className="flex-1 h-11 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-xl cursor-pointer"
                    disabled={emailOtpLoading}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={emailOtpLoading || emailOtpCode.length < 6}
                    className="flex-1 h-11 bg-gradient-to-r from-[#E30613] to-[#C40510] hover:opacity-95 text-white font-bold rounded-xl text-xs uppercase tracking-wider cursor-pointer shadow-lg shadow-[#E30613]/20 disabled:opacity-50"
                  >
                    {emailOtpLoading ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verificando...
                      </span>
                    ) : emailOtpStep === 1 ? (
                      'Continuar a Paso 2 →'
                    ) : (
                      'Activar Nuevo Correo'
                    )}
                  </Button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Password Change 2FA OTP Modal */}
      <AnimatePresence>
        {showPasswordOtpModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPasswordOtpModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-md bg-[var(--bg-panel)] border border-amber-500/30 rounded-3xl shadow-2xl overflow-hidden p-6 z-10 space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-2xl bg-amber-500/15 text-amber-500 border border-amber-500/30">
                    <KeyRound className="h-5 w-5 animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[var(--text-primary)] font-comfortaa">Autorizar Cambio de Clave</h3>
                    <p className="text-[11px] text-amber-400/90 font-medium">Verificación de Seguridad 2FA</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPasswordOtpModal(false)}
                  className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5 rounded-xl transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3.5 text-xs text-amber-300 space-y-1.5">
                <p className="font-semibold text-amber-200 text-sm">🔒 Confirmación de Seguridad</p>
                <p className="text-xs text-amber-300/90">
                  Enviamos un <strong>código de autorización de 6 dígitos</strong> a tu correo registrado:
                </p>
                <p className="font-mono font-bold text-white text-xs bg-black/40 py-1.5 px-3 rounded-lg border border-amber-500/20 text-center">{passwordOtpSentTo}</p>
                <p className="text-[11px] text-amber-400/80 pt-0.5 text-center">⏱️ <strong>Vigencia:</strong> 5 minutos.</p>
              </div>

              <form onSubmit={handleConfirmPasswordOtp} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-[var(--text-secondary)] pl-1">
                    Código de Confirmación (6 Dígitos)
                  </Label>
                  <Input
                    type="text"
                    maxLength={6}
                    placeholder="Ej: 849201"
                    value={passwordOtpCode}
                    onChange={e => setPasswordOtpCode(e.target.value.replace(/\D/g, ''))}
                    className="h-12 text-center text-2xl font-mono font-bold tracking-widest rounded-xl bg-[var(--bg-elevated)] border-amber-500/40 text-[var(--text-primary)] focus:border-amber-500 shadow-inner"
                    required
                    autoFocus
                  />
                </div>

                {passwordOtpError && (
                  <p className="rounded-xl border border-red-500/25 bg-red-500/8 px-3.5 py-2 text-xs text-red-400">
                    {passwordOtpError}
                  </p>
                )}

                <div className="flex items-center justify-center pt-1">
                  {passwordCountdown > 0 ? (
                    <span className="text-[11px] text-[var(--text-muted)]">
                      Reenviar código en <strong className="text-amber-400">{passwordCountdown}s</strong>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleResendPasswordOtp}
                      disabled={passwordOtpLoading}
                      className="text-xs font-bold text-amber-400 hover:underline cursor-pointer flex items-center gap-1"
                    >
                      <Send className="w-3 h-3" /> ¿No recibiste el código? Reenviar
                    </button>
                  )}
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowPasswordOtpModal(false)}
                    className="flex-1 h-11 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-xl cursor-pointer"
                    disabled={passwordOtpLoading}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={passwordOtpLoading || passwordOtpCode.length < 6}
                    className="flex-1 h-11 bg-gradient-to-r from-amber-500 to-amber-600 hover:opacity-95 text-black font-bold rounded-xl text-xs uppercase tracking-wider cursor-pointer shadow-lg shadow-amber-500/20 disabled:opacity-50"
                  >
                    {passwordOtpLoading ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verificando...
                      </span>
                    ) : (
                      'Confirmar y Guardar'
                    )}
                  </Button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </AnimatePresence>
  )
}
