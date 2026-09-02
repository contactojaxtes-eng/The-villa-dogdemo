import { useState, useEffect, FormEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { useAuth } from '@/hooks/useAuth'
import { alerts } from '@/lib/alerts'
import { User as UserIcon, Mail, Phone, Lock, CheckCircle2, Loader2, KeyRound, Eye, EyeOff, ShieldCheck, X } from 'lucide-react'

const roleLabels: Record<string, string> = {
  SUPERADMIN: 'Super Admin',
  ADMIN: 'Admin',
  CASHIER: 'Cajero',
  DELIVERY_MANAGER: 'Gestor domicilios',
  ACCOUNTANT: 'Contador',
  ACCOUNTING_ASSISTANT: 'Auxiliar contable',
}

export default function ProfilePage() {
  const { user, updateProfile, requestEmailChange, verifyCurrentEmailStep1, confirmNewEmailStep2, requestPasswordChange, confirmPasswordChange } = useAuth()
  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [phone, setPhone] = useState(user?.phone || '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [profileError, setProfileError] = useState('')

  // Email Change OTP Modal states (2-step verification)
  const [showEmailOtpModal, setShowEmailOtpModal] = useState(false)
  const [emailOtpStep, setEmailOtpStep] = useState<number>(1)
  const [pendingNewEmail, setPendingNewEmail] = useState('')
  const [emailOtpCode, setEmailOtpCode] = useState('')
  const [emailOtpLoading, setEmailOtpLoading] = useState(false)
  const [emailOtpError, setEmailOtpError] = useState('')
  const [emailOtpCurrent, setEmailOtpCurrent] = useState('')

  // Password States
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordSaved, setPasswordSaved] = useState(false)
  const [passwordError, setPasswordError] = useState('')

  // Password OTP Modal States
  const [showPasswordOtpModal, setShowPasswordOtpModal] = useState(false)
  const [passwordOtpCode, setPasswordOtpCode] = useState('')
  const [passwordOtpLoading, setPasswordOtpLoading] = useState(false)
  const [passwordOtpError, setPasswordOtpError] = useState('')
  const [passwordOtpSentTo, setPasswordOtpSentTo] = useState('')

  useEffect(() => {
    if (user) {
      setName(user.name || '')
      setEmail(user.email || '')
      setPhone(user.phone || '')
    }
  }, [user])

  const initials = user?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '??'

  // Password Strength Calculation
  const hasMinLength = newPassword.length >= 8
  const hasUpper = /[A-Z]/.test(newPassword)
  const hasLower = /[a-z]/.test(newPassword)
  const hasNumber = /[0-9]/.test(newPassword)
  const hasSpecial = /[^A-Za-z0-9]/.test(newPassword)

  const strengthScore = [hasMinLength, hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length

  const getStrengthLabel = () => {
    if (strengthScore <= 2) return { text: 'Débil', color: 'bg-red-500 text-red-500' }
    if (strengthScore === 3) return { text: 'Media', color: 'bg-amber-500 text-amber-500' }
    if (strengthScore === 4) return { text: 'Buena', color: 'bg-blue-500 text-blue-500' }
    return { text: 'Excelente', color: 'bg-emerald-500 text-emerald-500' }
  }

  const strength = getStrengthLabel()

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault()
    setSavingProfile(true)
    setProfileError('')

    try {
      // 1. Actualizar Nombre y Teléfono
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
      }

      setProfileSaved(true)
      alerts.success('Perfil actualizado correctamente')
      setTimeout(() => setProfileSaved(false), 2500)
    } catch (err: any) {
      setProfileError(err.message || 'Error al guardar el perfil')
      alerts.error('Error', err.message || 'Error al guardar el perfil')
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

  const handleConfirmEmailOtp = async (e: FormEvent) => {
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
        const res = await verifyCurrentEmailStep1(pendingNewEmail, emailOtpCode)
        setEmailOtpStep(2)
        setEmailOtpCode('')
        setEmailOtpError('')
        alerts.success('Paso 1 completado', 'Revisa tu nuevo correo para el código de activación.')
      } else {
        // Paso 2: Validar código del nuevo correo -> Guarda en DB y activa
        await confirmNewEmailStep2(pendingNewEmail, emailOtpCode)
        setShowEmailOtpModal(false)
        setEmail(pendingNewEmail)
        setProfileSaved(true)
        alerts.success('¡Correo activado con éxito!', 'El nuevo correo quedó vinculado y el anterior desvinculado.')
        setTimeout(() => setProfileSaved(false), 2500)
      }
    } catch (err: any) {
      setEmailOtpError(err.message || 'Código de seguridad incorrecto o expirado (Válido por 5 minutos)')
    } finally {
      setEmailOtpLoading(false)
    }
  }

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault()
    setPasswordError('')
    if (!currentPassword) {
      setPasswordError('Ingresa tu contraseña actual')
      return
    }
    if (newPassword.length < 6) {
      setPasswordError('La nueva contraseña debe tener al menos 6 caracteres')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Las contraseñas nuevas no coinciden')
      return
    }
    if (currentPassword === newPassword) {
      setPasswordError('La nueva contraseña no puede ser igual a la actual')
      return
    }
    setChangingPassword(true)
    try {
      const res = await requestPasswordChange(currentPassword, newPassword)
      setPasswordOtpSentTo(res.sentTo || user?.email || '')
      setPasswordOtpCode('')
      setPasswordOtpError('')
      setShowPasswordOtpModal(true)
      alerts.info('Código enviado', 'Enviamos un código de seguridad a tu correo para autorizar el cambio.')
    } catch (err: any) {
      setPasswordError(err.message || 'No se pudo procesar el cambio de contraseña')
      alerts.error('Error', err.message || 'No se pudo procesar el cambio de contraseña')
    } finally {
      setChangingPassword(false)
    }
  }

  const handleConfirmPasswordOtp = async (e: FormEvent) => {
    e.preventDefault()
    setPasswordOtpError('')
    if (passwordOtpCode.length < 6) {
      setPasswordOtpError('Ingresa el código de 6 dígitos enviado a tu correo')
      return
    }
    setPasswordOtpLoading(true)
    try {
      await confirmPasswordChange(currentPassword, newPassword, passwordOtpCode)
      setShowPasswordOtpModal(false)
      setPasswordSaved(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordOtpCode('')
      alerts.success('¡Contraseña actualizada con éxito!')
      setTimeout(() => setPasswordSaved(false), 2500)
    } catch (err: any) {
      setPasswordOtpError(err.message || 'Código de seguridad incorrecto o expirado (Válido por 5 minutos)')
    } finally {
      setPasswordOtpLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="MI PERFIL" description="Administra tu información personal, correo de notificaciones y contraseña de acceso." />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Card 1: Información Personal */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="niche-card-premium border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl overflow-hidden h-full shadow-lg">
            <CardHeader className="pb-4 border-b border-[var(--border-subtle)]/40 bg-[var(--bg-elevated)]/30">
              <CardTitle className="text-base font-extrabold text-[var(--text-primary)] tracking-wide uppercase flex items-center gap-2 font-comfortaa">
                <UserIcon className="h-5 w-5 text-[var(--accent)]" /> Información Personal
              </CardTitle>
              <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">Tus datos de contacto y recuperación.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div className="flex items-center gap-4 pb-2 border-b border-[var(--border-subtle)]/30">
                  <Avatar className="h-16 w-16 ring-2 ring-[var(--accent)]/30">
                    <AvatarFallback className="bg-[var(--accent)]/15 text-lg font-extrabold text-[var(--accent)]">{initials}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-bold text-[var(--text-primary)] font-mono">{user?.email}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20 px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">
                        {roleLabels[user?.role || ''] || user?.role}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-[var(--text-secondary)]">Nombre Completo</Label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--text-muted)]">
                      <UserIcon className="h-4 w-4" />
                    </div>
                    <Input className="h-11 pl-10.5 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] text-xs" value={name} onChange={e => setName(e.target.value)} required />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-[var(--text-secondary)] flex justify-between items-center">
                    <span>Correo Electrónico (Gmail / Personal)</span>
                    <span className="text-[10px] text-[var(--accent)] font-normal">Para alertas y recuperación</span>
                  </Label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--text-muted)]">
                      <Mail className="h-4 w-4" />
                    </div>
                    <Input 
                      type="email"
                      className="h-11 pl-10.5 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] text-xs" 
                      value={email} 
                      onChange={e => setEmail(e.target.value)} 
                      placeholder="tu-correo@gmail.com" 
                      required 
                    />
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)] pl-1">
                    Si cambias este correo, te enviaremos un código de seguridad a tu correo actual para autorizarlo.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-[var(--text-secondary)]">Teléfono / WhatsApp</Label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--text-muted)]">
                      <Phone className="h-4 w-4" />
                    </div>
                    <Input className="h-11 pl-10.5 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] text-xs" value={phone} onChange={e => setPhone(e.target.value)} placeholder="3001234567" />
                  </div>
                </div>

                {profileError && (
                  <p className="rounded-xl border border-red-500/25 bg-red-500/8 px-3.5 py-2.5 text-xs text-red-400">{profileError}</p>
                )}

                <div className="pt-2">
                  <Button type="submit" disabled={savingProfile} className="w-full h-11 bg-gradient-to-r from-[#90BF50] to-[#7AAF40] hover:opacity-95 text-[#0D0D0D] font-bold rounded-xl text-xs uppercase tracking-wider cursor-pointer shadow-lg shadow-[#90BF50]/20">
                    {savingProfile ? (
                      <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Guardando...</span>
                    ) : profileSaved ? (
                      <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Guardado Exitosamente</span>
                    ) : (
                      'Guardar Cambios'
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </motion.div>

        {/* Card 2: Cambiar Contraseña */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <Card className="niche-card-premium border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl overflow-hidden h-full shadow-lg">
            <CardHeader className="pb-4 border-b border-[var(--border-subtle)]/40 bg-[var(--bg-elevated)]/30">
              <CardTitle className="text-base font-extrabold text-[var(--text-primary)] tracking-wide uppercase flex items-center gap-2 font-comfortaa">
                <KeyRound className="h-5 w-5 text-[var(--accent)]" /> Cambiar Contraseña
              </CardTitle>
              <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">Necesitas tu contraseña actual para cambiarla.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-[var(--text-secondary)]">Contraseña Actual</Label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--text-muted)]">
                      <Lock className="h-4 w-4" />
                    </div>
                    <Input 
                      type={showCurrentPassword ? 'text' : 'password'} 
                      className="h-11 pl-10.5 pr-10.5 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] text-xs" 
                      value={currentPassword} 
                      onChange={e => setCurrentPassword(e.target.value)} 
                      placeholder="Escribe tu clave actual"
                      required 
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-[var(--text-secondary)]">Nueva Contraseña</Label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--text-muted)]">
                      <KeyRound className="h-4 w-4" />
                    </div>
                    <Input 
                      type={showNewPassword ? 'text' : 'password'} 
                      className="h-11 pl-10.5 pr-10.5 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] text-xs" 
                      value={newPassword} 
                      onChange={e => setNewPassword(e.target.value)} 
                      placeholder="Mínimo 8 caracteres (recomendado)"
                      required 
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  {/* Password Strength Meter */}
                  {newPassword.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-[var(--text-muted)]">Nivel de seguridad:</span>
                        <span className="font-semibold text-[var(--text-primary)]">{strength.text}</span>
                      </div>
                      <div className="h-1.5 w-full bg-[var(--bg-input)] rounded-full overflow-hidden flex gap-1">
                        <div className={`h-full rounded-full transition-all ${strengthScore >= 1 ? strength.color : 'bg-transparent'} flex-1`} />
                        <div className={`h-full rounded-full transition-all ${strengthScore >= 2 ? strength.color : 'bg-transparent'} flex-1`} />
                        <div className={`h-full rounded-full transition-all ${strengthScore >= 3 ? strength.color : 'bg-transparent'} flex-1`} />
                        <div className={`h-full rounded-full transition-all ${strengthScore >= 4 ? strength.color : 'bg-transparent'} flex-1`} />
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-[var(--text-secondary)]">Confirmar Nueva Contraseña</Label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--text-muted)]">
                      <ShieldCheck className="h-4 w-4" />
                    </div>
                    <Input 
                      type={showNewPassword ? 'text' : 'password'} 
                      className="h-11 pl-10.5 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] text-xs" 
                      value={confirmPassword} 
                      onChange={e => setConfirmPassword(e.target.value)} 
                      placeholder="Repite la nueva contraseña"
                      required 
                    />
                  </div>
                </div>

                {passwordError && (
                  <p className="rounded-xl border border-red-500/25 bg-red-500/8 px-3.5 py-2.5 text-xs text-red-400">{passwordError}</p>
                )}

                <div className="pt-2">
                  <Button type="submit" disabled={changingPassword || !currentPassword || !newPassword} className="w-full h-11 bg-gradient-to-r from-[#90BF50] to-[#7AAF40] hover:opacity-95 text-[#0D0D0D] font-bold rounded-xl text-xs uppercase tracking-wider cursor-pointer shadow-lg shadow-[#90BF50]/20 disabled:opacity-50">
                    {changingPassword ? (
                      <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Actualizando...</span>
                    ) : passwordSaved ? (
                      <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Contraseña Actualizada</span>
                    ) : (
                      'Actualizar Contraseña'
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Email Change Security OTP Modal */}
      <AnimatePresence>
        {showEmailOtpModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleCloseEmailOtpModal}
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
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
                    className="flex-1 h-11 bg-gradient-to-r from-[#90BF50] to-[#7AAF40] hover:opacity-95 text-[#0D0D0D] font-bold rounded-xl text-xs uppercase tracking-wider cursor-pointer shadow-lg shadow-[#90BF50]/20 disabled:opacity-50"
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
    </div>
  )
}
