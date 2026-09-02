import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { 
  ShieldCheck, 
  Lock, 
  Mail, 
  KeyRound, 
  Eye, 
  EyeOff, 
  Loader2, 
  AlertCircle, 
  CheckCircle2, 
  X, 
  Send 
} from 'lucide-react'
import { alerts } from '@/lib/alerts'

interface SecurityActionConfirmModalProps {
  open: boolean
  title?: string
  description?: string
  actionName: string
  onClose: () => void
  onSuccess: () => void | Promise<void>
}

export function SecurityActionConfirmModal({
  open,
  title = 'Confirmación de Seguridad',
  description = 'Por seguridad del sistema, autoriza esta acción administrativa.',
  actionName,
  onClose,
  onSuccess,
}: SecurityActionConfirmModalProps) {
  const { user } = useAuth()
  const [method, setMethod] = useState<'PASSWORD' | 'OTP'>('PASSWORD')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [otpCode, setOtpCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  // OTP state
  const [otpSent, setOtpSent] = useState(false)
  const [sendingOtp, setSendingOtp] = useState(false)
  const [countdown, setCountdown] = useState(0)

  const userEmail = (user?.email || '').trim().toLowerCase()
  const hasValidEmail = userEmail.includes('@') && !userEmail.endsWith('@thevilladog.local')
  const maskedEmail = hasValidEmail
    ? userEmail.replace(/(.{2})(.*)(@.*)/, '$1***$3')
    : null

  useEffect(() => {
    if (open) {
      setPassword('')
      setShowPassword(false)
      setOtpCode('')
      setError('')
      setOtpSent(false)
      // Si la cuenta no tiene correo personal verificado, la única vía permitida es OTP al SuperAdmin
      setMethod(hasValidEmail ? 'PASSWORD' : 'OTP')
    }
  }, [open, hasValidEmail])

  useEffect(() => {
    let timer: any
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(c => c - 1), 1000)
    }
    return () => clearTimeout(timer)
  }, [countdown])

  const handleSendOtp = async () => {
    setSendingOtp(true)
    setError('')
    try {
      const res = await api.post<any>('/auth/action-auth/request-otp', { actionName })
      setOtpSent(true)
      setCountdown(60)
      alerts.success('Código Enviado', res.message || 'Código de seguridad enviado al correo')
    } catch (err: any) {
      setError(err.message || 'No se pudo enviar el código al correo')
    } finally {
      setSendingOtp(false)
    }
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (method === 'PASSWORD' && !password) {
      setError('Por favor ingresa tu contraseña actual.')
      return
    }

    if (method === 'OTP' && (!otpCode || otpCode.trim().length !== 6)) {
      setError('Por favor ingresa el código de 6 dígitos que llegó al correo.')
      return
    }

    setLoading(true)
    try {
      await api.post('/auth/action-auth/verify', {
        method,
        password: method === 'PASSWORD' ? password : undefined,
        otpCode: method === 'OTP' ? otpCode.trim() : undefined,
      })

      onClose()
      await onSuccess()
    } catch (err: any) {
      setError(err.message || 'Verificación fallida. Revisa los datos ingresados.')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm pointer-events-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="relative w-full max-w-md bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-black text-[var(--text-primary)] leading-tight">{title}</h3>
                <p className="text-[11px] text-[var(--text-secondary)]">{actionName}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={loading}
              className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleVerify} className="p-5 space-y-4">
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              {description}
            </p>

            {/* Selector de Método */}
            {hasValidEmail ? (
              <div className="grid grid-cols-2 gap-2 p-1 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl">
                <button
                  type="button"
                  onClick={() => { setMethod('PASSWORD'); setError(''); }}
                  className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                    method === 'PASSWORD'
                      ? 'bg-[var(--accent)] text-white shadow-sm'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Contraseña Actual</span>
                </button>

                <button
                  type="button"
                  onClick={() => { setMethod('OTP'); setError(''); }}
                  className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                    method === 'OTP'
                      ? 'bg-[var(--accent)] text-white shadow-sm'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>Código a Correo</span>
                </button>
              </div>
            ) : (
              <div className="p-3.5 bg-amber-500/10 border border-amber-500/25 rounded-xl space-y-1.5">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                  <Mail className="w-4 h-4 shrink-0" />
                  <span className="text-xs font-bold uppercase tracking-wider">Autorización Obligatoria por OTP</span>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                  Por seguridad preventiva de la operación, esta cuenta requiere autorización mediante código OTP enviado al correo del Super Administrador.
                </p>
              </div>
            )}

            {/* Error banner */}
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/25 rounded-xl text-red-500 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Opción 1: Contraseña Actual */}
            {method === 'PASSWORD' && (
              <div className="space-y-2">
                <Label className="text-xs font-bold text-[var(--text-primary)]">
                  Ingresa tu contraseña ({user?.name || 'Administrador'})
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-[var(--text-muted)]" />
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    autoFocus
                    className="pl-9 pr-10 h-10 text-xs rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            {/* Opción 2: Código OTP */}
            {method === 'OTP' && (
              <div className="space-y-3">
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                      {hasValidEmail ? 'Correo registrado:' : 'Correo de Seguridad (SuperAdmin):'}
                    </p>
                    <p className="text-xs font-mono text-[var(--text-primary)] truncate">
                      {hasValidEmail ? maskedEmail : 'so***@gmail.com'}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={sendingOtp || countdown > 0}
                    onClick={handleSendOtp}
                    className="h-8 px-3 text-[11px] font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
                  >
                    {sendingOtp ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : countdown > 0 ? (
                      `Reenviar en ${countdown}s`
                    ) : (
                      <span className="flex items-center gap-1">
                        <Send className="w-3 h-3" />
                        {otpSent ? 'Reenviar' : 'Enviar Código'}
                      </span>
                    )}
                  </Button>
                </div>

                {otpSent && (
                  <div className="space-y-2 animate-in fade-in duration-200">
                    <Label className="text-xs font-bold text-[var(--text-primary)]">
                      Código de 6 dígitos
                    </Label>
                    <Input
                      type="text"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="123456"
                      autoFocus
                      className="h-11 text-center font-mono text-lg font-black tracking-widest rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)]"
                    />
                    <p className="text-[10px] text-[var(--text-muted)] text-center">
                      Revisa tu bandeja de entrada o spam.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Footer buttons */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
              <Button
                type="button"
                variant="ghost"
                disabled={loading}
                onClick={onClose}
                className="h-9 px-4 text-xs font-semibold rounded-xl"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={loading || (method === 'OTP' && (!otpSent || otpCode.length !== 6)) || (method === 'PASSWORD' && !password)}
                className="h-9 px-5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm flex items-center gap-1.5"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Verificando...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Autorizar y Continuar</span>
                  </>
                )}
              </Button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}
