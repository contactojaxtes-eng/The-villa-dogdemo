import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { getFirstAllowedPath } from '@/lib/navigation'
import { BrandLogo } from '@/components/brand/BrandLogo'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Sun, Moon, Loader2, Eye, EyeOff, UtensilsCrossed, ChefHat, ReceiptText, Lock, Mail, ArrowRight, CheckCircle2, X, Key, ShieldCheck, ShieldAlert, Send } from 'lucide-react'



const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1, delayChildren: 0.2 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] as const } },
}

const slideInLeft = {
  hidden: { opacity: 0, x: -60 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] as const } },
}

const slideInRight = {
  hidden: { opacity: 0, x: 60 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] as const } },
}

const scaleIn = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] as const } },
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Forgot password & OTP modal states
  const [showForgotModal, setShowForgotModal] = useState(false)
  const [forgotStep, setForgotStep] = useState<'email' | 'otp' | 'done'>('email')
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotError, setForgotError] = useState('')
  const [forgotCountdown, setForgotCountdown] = useState(0)

  useEffect(() => {
    let timer: any
    if (forgotCountdown > 0) {
      timer = setTimeout(() => setForgotCountdown(c => c - 1), 1000)
    }
    return () => clearTimeout(timer)
  }, [forgotCountdown])

  // OTP Direct Reset States
  const [otpCode, setOtpCode] = useState('')
  const [newOtpPassword, setNewOtpPassword] = useState('')
  const [confirmOtpPassword, setConfirmOtpPassword] = useState('')
  const [showOtpPass, setShowOtpPass] = useState(false)
  const [otpLoading, setOtpLoading] = useState(false)
  const [otpError, setOtpError] = useState('')

  // Brute Force Lockout States
  const [showLockoutModal, setShowLockoutModal] = useState(false)
  const [lockoutEmail, setLockoutEmail] = useState('')
  const [lockoutOtpCode, setLockoutOtpCode] = useState('')
  const [lockoutPassword, setLockoutPassword] = useState('')
  const [showLockoutPassword, setShowLockoutPassword] = useState(false)
  const [lockoutLoading, setLockoutLoading] = useState(false)
  const [lockoutError, setLockoutError] = useState('')
  const [lockoutSuccess, setLockoutSuccess] = useState(false)

  const { login, forgotPassword, resetPassword, unlockAccount, isAuthenticated, user } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()

  const handleForgotSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!forgotEmail.trim()) {
      setForgotError('Ingresa tu usuario o correo electrónico')
      return
    }
    setForgotLoading(true)
    setForgotError('')
    try {
      await forgotPassword(forgotEmail.trim())
      setForgotStep('otp')
      setForgotCountdown(60)
      setOtpCode('')
      setNewOtpPassword('')
      setConfirmOtpPassword('')
      setOtpError('')
    } catch (err: any) {
      setForgotError(err.message || 'No se pudo procesar la solicitud')
    } finally {
      setForgotLoading(false)
    }
  }

  const handleOtpSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setOtpError('')
    if (otpCode.length < 6) {
      setOtpError('Ingresa el código de 6 dígitos que te enviamos al correo')
      return
    }
    if (newOtpPassword.length < 6) {
      setOtpError('La contraseña debe tener al menos 6 caracteres')
      return
    }
    if (newOtpPassword !== confirmOtpPassword) {
      setOtpError('Las nuevas contraseñas no coinciden')
      return
    }
    setOtpLoading(true)
    try {
      await resetPassword(otpCode, newOtpPassword)
      setForgotStep('done')
      setEmail(forgotEmail)
      setPassword(newOtpPassword)
      setTimeout(async () => {
        try {
          await login(forgotEmail, newOtpPassword)
          navigate('/', { replace: true })
        } catch (e) {
          setShowForgotModal(false)
        }
      }, 1500)
    } catch (err: any) {
      setOtpError(err.message || 'Código de 6 dígitos inválido o expirado')
    } finally {
      setOtpLoading(false)
    }
  }

  const handleUnlockSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLockoutError('')
    if (lockoutOtpCode.length < 6) {
      setLockoutError('Ingresa el código de 6 dígitos enviado a tu correo')
      return
    }
    setLockoutLoading(true)
    try {
      const res = await unlockAccount(lockoutEmail, lockoutOtpCode)
      setLockoutSuccess(true)
      setTimeout(() => {
        setShowLockoutModal(false)
        if (res.user) {
          if (res.user.role === 'SUPERADMIN') {
            navigate(getFirstAllowedPath(user) || '/profile', { replace: true })
          } else {
            navigate('/', { replace: true })
          }
        }
      }, 1000)
    } catch (err: any) {
      setLockoutError(err.message || 'Código de seguridad incorrecto o expirado')
    } finally {
      setLockoutLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthenticated) {
      if (user?.role === 'SUPERADMIN') {
        navigate(getFirstAllowedPath(user) || '/profile', { replace: true })
      } else {
        navigate('/', { replace: true })
      }
    }
  }, [isAuthenticated, navigate, user])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email.trim(), password)
    } catch (err: any) {
      const errorMsg = err instanceof Error ? err.message : (err?.message || 'Error al iniciar sesión')
      setError(errorMsg)

      // Si se superaron los 3 intentos o la cuenta ya está bloqueada:
      if (
        errorMsg.includes('bloqueada preventivamente') || 
        errorMsg.includes('ACCOUNT_LOCKED') || 
        errorMsg.includes('3 intentos') ||
        errorMsg.includes('código de seguridad a tu correo')
      ) {
        setLockoutEmail(email)
        setLockoutPassword(password)
        setLockoutOtpCode('')
        setLockoutError('')
        setLockoutSuccess(false)
        setShowLockoutModal(true)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-shell relative flex min-h-screen items-center justify-center bg-[var(--bg-base)] px-5 py-16 sm:px-10">
      <div className="pointer-events-none absolute top-0 left-0 h-1 w-full bg-[#E30613]" />

      {/* Theme Toggle Button */}
      <motion.div
        className="absolute top-6 right-6 z-20"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8, duration: 0.5 }}
      >
        <Button 
          variant="ghost" 
          size="icon" 
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] backdrop-blur-md rounded-xl h-10 w-10 transition-colors" 
          onClick={toggleTheme} 
          aria-label="Cambiar tema"
        >
          {theme === 'dark' ? <Sun className="h-5 w-5 text-[var(--accent)]" /> : <Moon className="h-5 w-5" />}
        </Button>
      </motion.div>

      {/* Main Grid Container */}
      <motion.div
        className="relative z-10 grid w-full max-w-6xl gap-10 lg:grid-cols-[1.1fr_0.9fr] items-center"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <motion.section className="flex flex-col justify-center lg:pr-12" variants={slideInLeft}>
          <div className="mb-8 flex items-center gap-4">
            <BrandLogo imageClassName="w-28 sm:w-36" />
            <span className="border-l border-[var(--border-default)] pl-4 text-xs font-semibold tracking-[0.16em] text-[var(--text-secondary)]">COMIDAS<br />RÁPIDAS</span>
          </div>
          <p className="mb-4 text-xs font-bold uppercase tracking-[0.22em] text-[var(--accent)]">Tu operación, en un solo lugar</p>
          <h1 className="max-w-lg text-4xl font-bold leading-[1.08] tracking-tight text-[var(--text-primary)] sm:text-6xl">Buen sabor.<br /><span className="text-[var(--accent)]">Todo en orden.</span></h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-[var(--text-secondary)]">Del primer pedido al cierre de caja. Menos vueltas para tu equipo, una mejor experiencia para tus clientes.</p>
          <div className="mt-9 hidden gap-3 sm:grid sm:grid-cols-3">
            {[{ icon: UtensilsCrossed, label: 'Mesas', text: 'Toma el pedido' }, { icon: ChefHat, label: 'Cocina', text: 'Prepara y entrega' }, { icon: ReceiptText, label: 'Caja', text: 'Cobra y cierra' }].map(({ icon: Icon, label, text }) => (
              <div key={label} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4">
                <Icon className="mb-4 h-5 w-5 text-[var(--accent)]" />
                <p className="text-sm font-semibold">{label}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{text}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 hidden text-xs text-[var(--text-muted)] lg:block">THE VILLA DOG · Montería, Colombia</p>
        </motion.section>

        {/* Right Side: Login Card and Forms */}
        <motion.div className="flex items-center w-full" variants={slideInRight}>
          <Card className="w-full border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-[0_20px_70px_-30px_var(--shadow-color)] relative overflow-hidden rounded-3xl sm:p-4">
            

            <CardHeader className="pb-4 pt-6 text-center lg:text-left">
              <motion.div variants={itemVariants}>
                <CardTitle className="text-2xl font-bold tracking-tight text-[var(--text-primary)] font-comfortaa">
                  Bienvenido de nuevo
                </CardTitle>
                <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
                  Ingresa a tu cuenta para comenzar el turno.
                </p>
              </motion.div>
            </CardHeader>

            <CardContent className="pb-6">
              <motion.form onSubmit={handleSubmit} className="space-y-4" variants={containerVariants} initial="hidden" animate="visible">
                {/* Email input field */}
                <motion.div className="space-y-1.5" variants={itemVariants}>
                  <Label htmlFor="email" className="text-[var(--text-secondary)] text-xs font-medium pl-1">Usuario / Correo</Label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--text-muted)] group-focus-within:text-[var(--accent)] transition-colors duration-200">
                      <Mail className="h-4 w-4" />
                    </div>
                    <Input 
                      id="email" autoComplete="username" autoCapitalize="none" spellCheck={false} 
                      type="text" 
                      placeholder="Usuario / Correo" 
                      value={email} 
                      onChange={e => setEmail(e.target.value)} 
                      className="pl-10.5 bg-[var(--bg-input)] border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:ring-[var(--accent)]/15 h-11 transition-all duration-300 rounded-xl"
                      required 
                    />
                  </div>
                </motion.div>

                {/* Password input field */}
                <motion.div className="space-y-1.5" variants={itemVariants}>
                  <Label htmlFor="password" className="text-[var(--text-secondary)] text-xs font-medium pl-1">Contraseña</Label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--text-muted)] group-focus-within:text-[var(--accent)] transition-colors duration-200">
                      <Lock className="h-4 w-4" />
                    </div>
                    <Input
                      id="password" autoComplete="current-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="pl-10.5 pr-10.5 bg-[var(--bg-input)] border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:ring-[var(--accent)]/15 h-11 transition-all duration-300 rounded-xl"
                      required
                    />
                    <motion.button
                      type="button"
                      className="absolute top-1/2 right-3 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      onClick={() => setShowPassword(value => !value)}
                      aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      whileTap={{ scale: 0.85 }}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </motion.button>
                  </div>
                </motion.div>

                {/* Error Banner with AnimatePresence */}
                <AnimatePresence mode="wait">
                  {error && (
                    <motion.div
                      role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-[var(--destructive)] space-y-2.5 shadow-lg"
                      initial={{ opacity: 0, y: -10, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: 'auto' }}
                      exit={{ opacity: 0, y: -10, height: 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      <div className="flex items-start gap-2.5">
                        <ShieldAlert className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                        <p className="leading-relaxed text-[var(--destructive)]">{error}</p>
                      </div>

                      {(error.includes('bloqueada') || error.includes('intentos') || error.includes('código') || error.includes('ACCOUNT_LOCKED')) && (
                        <Button
                          type="button"
                          onClick={() => {
                            setLockoutEmail(email.trim())
                            setLockoutPassword(password)
                            setLockoutOtpCode('')
                            setLockoutError('')
                            setLockoutSuccess(false)
                            setShowLockoutModal(true)
                          }}
                          className="w-full h-10 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-600 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-red-600/30 transition-all cursor-pointer uppercase tracking-wider"
                        >
                          <Key className="h-4 w-4" /> Ingresar Código para Desbloquear
                        </Button>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Submit Button */}
                <motion.div variants={itemVariants} className="pt-2">
                  <motion.button
                    type="submit"
                    className="w-full h-11.5 relative overflow-hidden rounded-xl bg-gradient-to-r from-[#E30613] to-[#C40510] font-bold text-white transition-all duration-300 shadow-[0_4px_20px_-4px_rgba(227,6,19,0.4)] hover:shadow-[0_8px_24px_-2px_rgba(227,6,19,0.6)] disabled:opacity-50 disabled:cursor-not-allowed group cursor-pointer"
                    disabled={loading}
                    whileHover={{ scale: loading ? 1 : 1.015 }}
                    whileTap={{ scale: loading ? 1 : 0.98 }}
                  >
                    {/* Shimmer reflection effect on hover */}
                    <div className="absolute inset-0 w-1/2 h-full bg-white/20 transform -skew-x-12 -translate-x-full group-hover:animate-shimmer pointer-events-none" />

                    <AnimatePresence mode="wait">
                      {loading ? (
                        <motion.span 
                          key="loading" 
                          className="flex items-center justify-center gap-2 text-xs" 
                          initial={{ opacity: 0 }} 
                          animate={{ opacity: 1 }} 
                          exit={{ opacity: 0 }}
                        >
                          <Loader2 className="h-4 w-4 animate-spin text-[#0D0D0D]" /> Ingresando...
                        </motion.span>
                      ) : (
                        <motion.span 
                          key="enter" 
                          className="flex items-center justify-center gap-1.5 text-xs tracking-wide uppercase font-bold text-[#0D0D0D]"
                          initial={{ opacity: 0 }} 
                          animate={{ opacity: 1 }} 
                          exit={{ opacity: 0 }}
                        >
                          Entrar a mi turno
                          <ArrowRight className="h-4 w-4 text-[#0D0D0D]" />
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.button>
                </motion.div>

                <motion.div variants={itemVariants} className="text-center pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setForgotEmail(email ? email.trim() : '')
                      setForgotStep('email')
                      setForgotError('')
                      setShowForgotModal(true)
                    }}
                    className="text-xs text-[var(--accent)] hover:text-[var(--accent-hover)] hover:underline transition-colors font-medium cursor-pointer"
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
                </motion.div>
              </motion.form>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      {/* Forgot Password Modal Dialog */}
      <AnimatePresence>
        {showForgotModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowForgotModal(false)}
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            />

            {/* Modal Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-3xl shadow-2xl overflow-hidden p-6 z-10"
            >
              {/* Neon border accents */}
              <div className="absolute top-0 left-0 w-8 h-[2px] bg-[var(--accent)]" />
              <div className="absolute top-0 left-0 w-[2px] h-8 bg-[var(--accent)]" />

              {/* Close Button */}
              <button
                type="button"
                onClick={() => setShowForgotModal(false)}
                className="absolute top-4 right-4 p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-xl transition-colors"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="flex items-center gap-3 mb-4">
                <div className="p-2.5 rounded-2xl bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/20">
                  <Key className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-[var(--text-primary)] font-comfortaa">
                    {forgotStep === 'otp' ? 'Ingresar Código de 6 Dígitos' : forgotStep === 'done' ? '¡Éxito!' : 'Recuperar Contraseña'}
                  </h3>
                  <p className="text-[11px] text-[var(--text-secondary)]">
                    {forgotStep === 'otp' ? 'Escribe el código recibido en tu Gmail' : 'Te enviaremos un código y enlace a tu correo.'}
                  </p>
                </div>
              </div>

              {forgotStep === 'done' ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="space-y-4 py-3 text-center"
                >
                  <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-[var(--text-primary)]">¡Contraseña restablecida!</p>
                    <p className="text-xs text-[var(--text-secondary)]">Iniciando sesión automáticamente...</p>
                  </div>
                </motion.div>
              ) : forgotStep === 'otp' ? (
                <motion.form
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  onSubmit={handleOtpSubmit}
                  className="space-y-4"
                >
                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-400 flex items-center justify-between">
                    <span className="truncate">Código enviado a <strong>{forgotEmail}</strong></span>
                    <button 
                      type="button" 
                      onClick={() => setForgotStep('email')} 
                      className="text-[10px] underline font-bold cursor-pointer text-emerald-300 ml-2"
                    >
                      Cambiar
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="otpCode" className="text-xs text-[var(--text-secondary)] pl-1 flex items-center justify-between">
                      <span>Código de Seguridad (6 Dígitos)</span>
                      <span className="text-[10px] text-[var(--accent)] font-mono">Revisa tu Gmail</span>
                    </Label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--text-muted)]">
                        <Key className="h-4 w-4" />
                      </div>
                      <Input
                        id="otpCode"
                        type="text"
                        maxLength={6}
                        placeholder="Ej: 849201"
                        value={otpCode}
                        onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
                        className="pl-10.5 text-center text-lg font-mono tracking-widest bg-[var(--bg-input)] border-[var(--border-default)] text-[var(--text-primary)] h-11 rounded-xl"
                        required
                        autoFocus
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="newOtpPass" className="text-xs text-[var(--text-secondary)] pl-1">
                      Nueva Contraseña
                    </Label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--text-muted)]">
                        <Lock className="h-4 w-4" />
                      </div>
                      <Input
                        id="newOtpPass"
                        type={showOtpPass ? 'text' : 'password'}
                        placeholder="Mínimo 6 caracteres"
                        value={newOtpPassword}
                        onChange={e => setNewOtpPassword(e.target.value)}
                        className="pl-10.5 pr-10.5 bg-[var(--bg-input)] border-[var(--border-default)] text-[var(--text-primary)] text-xs h-11 rounded-xl"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowOtpPass(!showOtpPass)}
                        className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                      >
                        {showOtpPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="confirmOtpPass" className="text-xs text-[var(--text-secondary)] pl-1">
                      Confirmar Nueva Contraseña
                    </Label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--text-muted)]">
                        <ShieldCheck className="h-4 w-4" />
                      </div>
                      <Input
                        id="confirmOtpPass"
                        type={showOtpPass ? 'text' : 'password'}
                        placeholder="Repite la nueva contraseña"
                        value={confirmOtpPassword}
                        onChange={e => setConfirmOtpPassword(e.target.value)}
                        className="pl-10.5 bg-[var(--bg-input)] border-[var(--border-default)] text-[var(--text-primary)] text-xs h-11 rounded-xl"
                        required
                      />
                    </div>
                  </div>

                  {otpError && (
                    <p className="rounded-xl border border-red-500/25 bg-red-500/8 px-3.5 py-2 text-xs text-red-400">
                      {otpError}
                    </p>
                  )}

                  <div className="flex items-center justify-center pt-1">
                    {forgotCountdown > 0 ? (
                      <span className="text-[11px] text-[var(--text-muted)]">
                        Reenviar código en <strong className="text-[var(--accent)]">{forgotCountdown}s</strong>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleForgotSubmit}
                        disabled={forgotLoading}
                        className="text-xs font-bold text-[var(--accent)] hover:underline cursor-pointer flex items-center gap-1"
                      >
                        <Send className="w-3 h-3" /> ¿No recibiste el código? Reenviar
                      </button>
                    )}
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setForgotStep('email')}
                      className="flex-1 h-11 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-xl cursor-pointer"
                      disabled={otpLoading}
                    >
                      Atrás
                    </Button>
                    <Button
                      type="submit"
                      disabled={otpLoading || otpCode.length < 6 || !newOtpPassword}
                      className="flex-1 h-11 bg-gradient-to-r from-[#E30613] to-[#C40510] hover:opacity-95 text-white font-bold text-xs rounded-xl shadow-lg shadow-[#E30613]/20 disabled:opacity-50 cursor-pointer"
                    >
                      {otpLoading ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verificando...
                        </span>
                      ) : (
                        'Restablecer y Entrar'
                      )}
                    </Button>
                  </div>
                </motion.form>
              ) : (
                <form onSubmit={handleForgotSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="forgotEmail" className="text-xs text-[var(--text-secondary)] pl-1">
                      Usuario o Correo Registrado
                    </Label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--text-muted)]">
                        <Mail className="h-4 w-4" />
                      </div>
                      <Input
                        id="forgotEmail"
                        type="text"
                        placeholder="Escribe tu usuario o correo personal"
                        value={forgotEmail}
                        onChange={e => setForgotEmail(e.target.value)}
                        className="pl-10.5 bg-[var(--bg-input)] border-[var(--border-default)] text-[var(--text-primary)] text-xs h-11 rounded-xl"
                        required
                        autoFocus
                      />
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)] pl-1">
                      Te enviaremos un código de seguridad de 6 dígitos para restablecer tu contraseña.
                    </p>
                  </div>

                  {forgotError && (
                    <p className="rounded-xl border border-red-500/25 bg-red-500/8 px-3.5 py-2 text-xs text-red-400">
                      {forgotError}
                    </p>
                  )}

                  <div className="flex gap-2 pt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setShowForgotModal(false)}
                      className="flex-1 h-11 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-xl cursor-pointer"
                      disabled={forgotLoading}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      disabled={forgotLoading || !forgotEmail.trim()}
                      className="flex-1 h-11 bg-gradient-to-r from-[#E30613] to-[#C40510] hover:opacity-95 text-white font-bold text-xs rounded-xl shadow-lg shadow-[#E30613]/20 disabled:opacity-50 cursor-pointer"
                    >
                      {forgotLoading ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Enviando...
                        </span>
                      ) : (
                        'Enviar Código de Seguridad'
                      )}
                    </Button>
                  </div>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Brute Force Lockout Security Modal */}
      <AnimatePresence>
        {showLockoutModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowLockoutModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-md bg-[#130E0E] border border-red-500/30 rounded-3xl shadow-2xl overflow-hidden p-6 z-10 space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-2xl bg-red-500/15 text-red-500 border border-red-500/30">
                    <ShieldAlert className="h-5 w-5 animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white font-comfortaa">Bloqueo Preventivo</h3>
                    <p className="text-[11px] text-red-400/80">Protección contra Ataques de Fuerza Bruta</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowLockoutModal(false)}
                  className="p-1.5 text-[var(--text-muted)] hover:text-white hover:bg-white/5 rounded-xl transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {lockoutSuccess ? (
                <div className="py-6 text-center space-y-3">
                  <div className="h-12 w-12 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <h4 className="text-sm font-bold text-white">¡Cuenta Desbloqueada con Éxito!</h4>
                  <p className="text-xs text-[var(--text-secondary)]">Ingresando al sistema de forma segura...</p>
                </div>
              ) : (
                <>
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3.5 text-xs text-[var(--destructive)] space-y-1.5">
                    <p className="font-semibold text-[var(--destructive)] text-sm">🚨 Cuenta Bloqueada Preventivamente</p>
                    <p className="text-xs text-[var(--destructive)]/90">
                      Detectamos 3 intentos fallidos de contraseña. Enviamos un <strong>código de 6 dígitos</strong> a tu correo para que puedas entrar de inmediato:
                    </p>
                    <p className="font-mono font-bold text-white text-xs bg-black/40 py-1.5 px-3 rounded-lg border border-red-500/20 text-center">{lockoutEmail}</p>
                    <p className="text-[11px] text-red-400/80 pt-0.5 text-center">⏱️ <strong>Vigencia:</strong> 15 minutos.</p>
                  </div>

                  <form onSubmit={handleUnlockSubmit} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-[var(--text-secondary)] pl-1 font-medium">
                        Código de Acceso de 6 Dígitos (recibido en tu correo)
                      </Label>
                      <Input
                        type="text"
                        maxLength={6}
                        placeholder="Ej: 849201"
                        value={lockoutOtpCode}
                        onChange={e => setLockoutOtpCode(e.target.value.replace(/\D/g, ''))}
                        className="h-12 text-center text-2xl font-mono font-bold tracking-widest bg-[var(--bg-input)] border-red-500/40 text-white rounded-xl focus:border-red-500 shadow-inner"
                        required
                        autoFocus
                      />
                    </div>

                    {lockoutError && (
                      <p className="rounded-xl border border-red-500/25 bg-red-500/8 px-3.5 py-2 text-xs text-red-400">
                        {lockoutError}
                      </p>
                    )}

                    <div className="flex gap-2 pt-2">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setShowLockoutModal(false)}
                        className="flex-1 h-11 text-xs text-[var(--text-muted)] hover:text-white rounded-xl cursor-pointer"
                        disabled={lockoutLoading}
                      >
                        Cancelar
                      </Button>
                      <Button
                        type="submit"
                        disabled={lockoutLoading || lockoutOtpCode.length < 6}
                        className="flex-1 h-11 bg-gradient-to-r from-red-600 to-red-500 hover:opacity-95 text-white font-bold text-xs rounded-xl shadow-lg shadow-red-500/20 disabled:opacity-50 cursor-pointer uppercase tracking-wider"
                      >
                        {lockoutLoading ? (
                          <span className="flex items-center gap-2">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verificando...
                          </span>
                        ) : (
                          'Entrar al Sistema'
                        )}
                      </Button>
                    </div>
                  </form>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
