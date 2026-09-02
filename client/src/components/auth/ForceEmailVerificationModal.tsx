import React, { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { 
  ShieldCheck, 
  Mail, 
  Send, 
  Loader2, 
  AlertCircle, 
  CheckCircle2, 
  LogOut, 
  Lock, 
  ArrowLeft,
  Sparkles,
  KeyRound,
  Eye,
  EyeOff,
  XCircle,
  Check
} from 'lucide-react'

export function ForceEmailVerificationModal() {
  const { user, updateCurrentUser, logout } = useAuth()
  
  // Steps: 1 = Email input, 2 = OTP verification, 3 = New Strong Password setup
  const [step, setStep] = useState<1 | 2 | 3>(1)
  
  // Email states
  const [emailInput, setEmailInput] = useState('')
  const [otpCode, setOtpCode] = useState('')
  
  // Password states
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  
  // General states
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState(0)

  // Show only if user is logged in AND mustVerifyEmail is true or emailVerified is false
  const shouldShow = Boolean(user && (user.mustVerifyEmail === true || user.emailVerified === false))

  useEffect(() => {
    if (user && shouldShow) {
      const currentEmail = (user.email || '').trim().toLowerCase()
      if (currentEmail.includes('@') && !currentEmail.endsWith('@thevilladog.local')) {
        setEmailInput(currentEmail)
      } else {
        setEmailInput('')
      }
      setStep(1)
      setOtpCode('')
      setNewPassword('')
      setConfirmPassword('')
      setError('')
    }
  }, [user, shouldShow])

  useEffect(() => {
    let timer: any
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(c => c - 1), 1000)
    }
    return () => clearTimeout(timer)
  }, [countdown])

  // Strict Password Strength Calculation
  const passwordCriteria = useMemo(() => {
    const pwd = newPassword || ''
    const hasMinLen = pwd.length >= 8
    const hasUpper = /[A-Z]/.test(pwd)
    const hasNumber = /[0-9]/.test(pwd)
    const hasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pwd)
    const score = [hasMinLen, hasUpper, hasNumber, hasSpecial].filter(Boolean).length
    const isStrong = hasMinLen && hasUpper && hasNumber && hasSpecial
    return { hasMinLen, hasUpper, hasNumber, hasSpecial, score, isStrong }
  }, [newPassword])

  // Step 1: Send OTP to Email
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const clean = emailInput.trim().toLowerCase()
    if (!clean || !clean.includes('@') || clean.endsWith('@thevilladog.local')) {
      setError('Por favor ingresa un correo electrónico personal válido (ej: tu_nombre@gmail.com)')
      return
    }

    setLoading(true)
    try {
      await api.post('/auth/setup-email/request-otp', { targetEmail: clean })
      setStep(2)
      setCountdown(60)
      alerts.success('Código Enviado', `Enviamos un código de 6 dígitos a ${clean}`)
    } catch (err: any) {
      setError(err.message || 'No se pudo enviar el código de verificación al correo')
    } finally {
      setLoading(false)
    }
  }

  // Step 2: Validate OTP Code locally and advance to Step 3 (Set Password)
  const handleProceedToPassword = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const cleanOtp = otpCode.trim()
    if (!cleanOtp || cleanOtp.length !== 6) {
      setError('Por favor ingresa el código de 6 dígitos que llegó a tu correo.')
      return
    }

    setStep(3)
  }

  // Step 3: Complete Onboarding (Verify OTP + Update Email + Set Strong Password)
  const handleCompleteOnboarding = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!passwordCriteria.isStrong) {
      setError('Tu nueva contraseña debe cumplir con todos los 4 requisitos de seguridad.')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden. Por favor verifícalas.')
      return
    }

    setLoading(true)
    try {
      const res = await api.post<{ success: boolean; message: string; user: any }>('/auth/setup-email/verify-otp', {
        targetEmail: emailInput.trim().toLowerCase(),
        otpCode: otpCode.trim(),
        newPassword: newPassword.trim(),
      })

      alerts.success('¡Cuenta 100% Configurada!', 'Tu correo ha sido verificado y tu nueva contraseña segura ha sido guardada.')
      if (res?.user) {
        updateCurrentUser(res.user)
      }
    } catch (err: any) {
      setError(err.message || 'El código de verificación es incorrecto o ya expiró.')
    } finally {
      setLoading(false)
    }
  }

  if (!shouldShow) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative w-full max-w-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-3xl shadow-2xl overflow-hidden p-6 sm:p-8 space-y-6 max-h-[95vh] overflow-y-auto"
      >
        {/* Top Header Badge */}
        <div className="text-center space-y-3">
          <div className="w-14 h-14 rounded-3xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 flex items-center justify-center mx-auto shadow-inner">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <div>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 mb-1">
              <Sparkles className="w-3 h-3" /> Configuración de Primer Ingreso
            </span>
            <h2 className="text-xl font-black text-[var(--text-primary)] tracking-tight">
              {step === 1 && 'Paso 1: Vincula tu Correo Personal'}
              {step === 2 && 'Paso 1: Confirma el Código'}
              {step === 3 && 'Paso 2: Crea tu Contraseña Segura'}
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-sm mx-auto">
              {step === 1 && `¡Hola ${user?.name}! Para proteger tu cuenta y permitir recuperación de acceso, ingresa tu correo personal.`}
              {step === 2 && `Ingresa el código de 6 dígitos que enviamos a tu correo para verificar que lo recibes correctamente.`}
              {step === 3 && `Define tu contraseña personal definitiva con los requisitos de seguridad requeridos.`}
            </p>
          </div>

          {/* Progress Indicators */}
          <div className="flex items-center justify-center gap-2 pt-1">
            <div className={`h-2 rounded-full transition-all ${step === 1 || step === 2 ? 'w-8 bg-emerald-500' : 'w-2 bg-emerald-500/40'}`} />
            <div className={`h-2 rounded-full transition-all ${step === 3 ? 'w-8 bg-emerald-500' : 'w-2 bg-[var(--border-default)]'}`} />
          </div>
        </div>

        {error && (
          <div className="p-3.5 bg-red-500/10 border border-red-500/25 rounded-2xl text-red-500 text-xs font-semibold flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="leading-tight">{error}</span>
          </div>
        )}

        {/* ── STEP 1: Input Email ── */}
        {step === 1 && (
          <form onSubmit={handleSendOtp} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-bold text-[var(--text-primary)]">
                Tu Correo Electrónico Personal / Laboral *
              </Label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-3 h-4 w-4 text-[var(--text-muted)]" />
                <Input
                  type="email"
                  required
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="Escribe tu correo personal"
                  autoFocus
                  className="pl-10 h-11 text-xs rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] font-medium"
                />
              </div>
              <p className="text-[10px] text-[var(--text-muted)]">
                Te enviaremos un código de seguridad de 6 dígitos para validar el acceso a tu buzón.
              </p>
            </div>

            <Button
              type="submit"
              disabled={loading || !emailInput.trim()}
              className="w-full h-11 text-xs font-black rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Enviando código...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Enviar Código de Verificación</span>
                </>
              )}
            </Button>
          </form>
        )}

        {/* ── STEP 2: Input 6-digit OTP ── */}
        {step === 2 && (
          <form onSubmit={handleProceedToPassword} className="space-y-4">
            <div className="p-3 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-2xl flex items-center justify-between text-xs">
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Código enviado a:</p>
                <p className="font-mono font-bold text-[var(--text-primary)] truncate">{emailInput}</p>
              </div>
              <button
                type="button"
                onClick={() => { setStep(1); setError(''); }}
                className="text-[11px] font-bold text-[var(--accent)] hover:underline flex items-center gap-0.5 shrink-0"
              >
                <ArrowLeft className="w-3 h-3" /> Cambiar
              </button>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold text-[var(--text-primary)] block text-center">
                Ingresa el código de 6 dígitos recibido
              </Label>
              <Input
                type="text"
                maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                autoFocus
                className="h-12 text-center font-mono text-2xl font-black tracking-widest rounded-2xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] shadow-inner"
              />
            </div>

            <div className="flex items-center justify-center">
              {countdown > 0 ? (
                <span className="text-[11px] text-[var(--text-muted)]">
                  Reenviar código en <strong className="text-[var(--text-primary)]">{countdown}s</strong>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={loading}
                  className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                >
                  ¿No recibiste el código? Reenviar
                </button>
              )}
            </div>

            <Button
              type="submit"
              disabled={loading || otpCode.trim().length !== 6}
              className="w-full h-11 text-xs font-black rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Continuar a Crear Contraseña →</span>
            </Button>
          </form>
        )}

        {/* ── STEP 3: Setup Strong Permanent Password ── */}
        {step === 3 && (
          <form onSubmit={handleCompleteOnboarding} className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <button
                type="button"
                onClick={() => { setStep(2); setError(''); }}
                className="text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Volver al código
              </button>
              <span className="text-[11px] font-mono text-emerald-500 font-bold">
                ✓ Correo: {emailInput}
              </span>
            </div>

            {/* New Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold text-[var(--text-primary)]">
                  Nueva Contraseña Segura *
                </Label>
                {newPassword && (
                  <span className={`text-[11px] font-bold ${
                    passwordCriteria.score <= 2 ? 'text-red-500' : passwordCriteria.score === 3 ? 'text-amber-500' : 'text-emerald-500'
                  }`}>
                    {passwordCriteria.score <= 1 ? 'Muy Débil' : passwordCriteria.score === 2 ? 'Regular' : passwordCriteria.score === 3 ? 'Buena' : 'Muy Segura'}
                  </span>
                )}
              </div>

              <div className="relative">
                <KeyRound className="absolute left-3.5 top-3.5 h-4 w-4 text-[var(--text-muted)]" />
                <Input
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Escribe tu nueva contraseña segura"
                  autoFocus
                  className="pl-10 pr-10 h-11 text-xs rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-3.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {/* Password Strength Bar & Checklist */}
              {newPassword.length > 0 && (
                <div className="space-y-2 p-3 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl mt-1.5 animate-in fade-in duration-200">
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

                  <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                    <div className={`flex items-center gap-1.5 ${passwordCriteria.hasMinLen ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-[var(--text-muted)]'}`}>
                      {passwordCriteria.hasMinLen ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" /> : <XCircle className="w-3.5 h-3.5 shrink-0 opacity-40" />}
                      <span>Mínimo 8 caracteres</span>
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

            {/* Confirm Password */}
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-[var(--text-primary)]">
                Confirmar Nueva Contraseña *
              </Label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3.5 h-4 w-4 text-[var(--text-muted)]" />
                <Input
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repite la nueva contraseña"
                  className="pl-10 pr-10 h-11 text-xs rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-3.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading || !passwordCriteria.isStrong || !newPassword || !confirmPassword}
              className="w-full h-12 text-xs font-black rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-900/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Configurando tu cuenta...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Finalizar y Entrar al Sistema</span>
                </>
              )}
            </Button>
          </form>
        )}

        {/* Footer Logout Option */}
        <div className="pt-2 border-t border-[var(--border-subtle)] text-center">
          <button
            type="button"
            onClick={logout}
            className="text-xs text-[var(--text-muted)] hover:text-red-400 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Cerrar sesión / Cambiar de cuenta</span>
          </button>
        </div>
      </motion.div>
    </div>
  )
}
