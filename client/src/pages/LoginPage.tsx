import { useState, useEffect, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { brand } from '@/lib/brand'
import { api } from '@/lib/api'
import { BrandLogo } from '@/components/brand/BrandLogo'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Sun, Moon, Loader2, Eye, EyeOff, UtensilsCrossed, MapPin, Bike, Clock, TrendingUp, Lock, Mail, ArrowRight, CheckCircle2, X, Key, ShieldCheck, ShieldAlert } from 'lucide-react'



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

function DeliverySimulator({ activeRoute }: { activeRoute: any }) {
  const riderName = activeRoute?.riderName || 'Moto #3 (Carlos)'
  const address = activeRoute?.address || 'Montería, Calle 32 #12'
  const status = activeRoute?.status || 'En ruta'
  const remainingTime = activeRoute?.remainingTime || '2 min rest.'
  const isActive = activeRoute ? activeRoute.isActive : true

  // Determine positions of rider icon when not animating
  let riderX = 80
  let riderY = 100
  if (status === 'Entregado') {
    riderX = 320
    riderY = 160
  }

  return (
    <div className="relative w-full h-[220px] bg-black/55 border border-[#90BF50]/15 rounded-2xl overflow-hidden p-4 flex flex-col justify-between shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_10px_30px_rgba(0,0,0,0.5)]">
      {/* Grid overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#333_1px,transparent_1px),linear-gradient(to_bottom,#333_1px,transparent_1px)] bg-[size:16px_16px] opacity-10" />
      
      {/* Simulator title & live status */}
      <div className="flex justify-between items-center z-10">
        <span className="text-[10px] font-mono text-[#90BF50]/75 tracking-wider uppercase font-semibold">SIMULADOR THE VILLA DOG RADAR</span>
        <span className={cn(
          "flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full font-medium border",
          isActive 
            ? "text-[#90BF50] bg-[#90BF50]/10 border-[#90BF50]/20" 
            : "text-white/60 bg-white/5 border-white/10"
        )}>
          {isActive && <span className="h-1.5 w-1.5 rounded-full bg-[#90BF50] animate-pulse" />}
          {status}
        </span>
      </div>

      {/* SVG Map Path */}
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <svg viewBox="0 0 400 200" className="w-full h-full text-white/5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {/* Conceptual streets */}
          <path d="M 20,40 L 380,40" strokeDasharray="4 4" className="opacity-30" />
          <path d="M 20,100 L 380,100" className="opacity-30" />
          <path d="M 20,160 L 380,160" strokeDasharray="4 4" className="opacity-30" />
          
          <path d="M 80,10 L 80,190" className="opacity-30" />
          <path d="M 200,10 L 200,190" strokeDasharray="4 4" className="opacity-30" />
          <path d="M 320,10 L 320,190" className="opacity-30" />

          {/* Delivery Route Path */}
          <motion.path 
            d="M 80,100 L 200,100 L 200,40 L 320,40 L 320,160" 
            stroke="#90BF50" 
            strokeWidth="3"
            strokeDasharray="400"
            strokeDashoffset="400"
            animate={isActive ? { strokeDashoffset: [400, 0] } : { strokeDashoffset: status === 'Entregado' ? 0 : 400 }}
            transition={isActive ? { duration: 12, repeat: Infinity, ease: 'linear' } : { duration: 0.5 }}
          />

          {/* Local / Starting Point */}
          <g transform="translate(80, 100)">
            <circle r="6" fill="#90BF50" className="opacity-50" />
            <circle r="3" fill="#0D0D0D" />
            <text x="10" y="3" fill="#90BF50" className="text-[10px] font-bold font-comfortaa" stroke="none">LOCAL</text>
          </g>

          {/* Client / Destination Point */}
          <g transform="translate(320, 160)">
            <circle r="6" fill="#EF4444" className="opacity-50" />
            <circle r="3" fill="#FFF" />
            <text x="-48" y="3" fill="#FFF" className="text-[9px] font-medium" stroke="none">Domicilio</text>
          </g>

          {/* Moving delivery rider dot/icon */}
          {isActive ? (
            <motion.g
              animate={{
                x: [80, 200, 200, 320, 320],
                y: [100, 100, 40, 40, 160]
              }}
              transition={{
                duration: 12,
                repeat: Infinity,
                ease: 'linear'
              }}
            >
              <circle r="10" fill="#90BF50" className="opacity-25 animate-ping" />
              <circle r="5" fill="#90BF50" />
            </motion.g>
          ) : (
            <g transform={`translate(${riderX}, ${riderY})`}>
              <circle r="8" fill="#90BF50" className="opacity-40" />
              <circle r="4" fill="#90BF50" />
            </g>
          )}
        </svg>
      </div>

      {/* Rider Info Card inside simulator */}
      <div className="z-10 bg-[#141414]/90 border border-white/5 backdrop-blur-md rounded-xl p-2 flex items-center justify-between text-[11px] shadow-lg">
        <div className="flex items-center gap-2">
          <div className="bg-[#90BF50]/15 p-1 rounded-lg text-[#90BF50]">
            <Bike className="h-3.5 w-3.5" />
          </div>
          <div>
            <p className="font-bold text-white leading-none">{riderName}</p>
            <p className="text-[9px] text-white/55 mt-0.5">{address}</p>
          </div>
        </div>
        <div className="text-right">
          <p className={cn("font-mono font-bold leading-none", isActive ? "text-[#90BF50]" : "text-white/70")}>{status}</p>
          <p className="text-[9px] text-white/55 mt-0.5">{remainingTime}</p>
        </div>
      </div>
    </div>
  )
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
          navigate('/dashboard', { replace: true })
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
            navigate('/superadmin', { replace: true })
          } else {
            navigate('/dashboard', { replace: true })
          }
        }
      }, 1000)
    } catch (err: any) {
      setLockoutError(err.message || 'Código de seguridad incorrecto o expirado')
    } finally {
      setLockoutLoading(false)
    }
  }

  const [stats, setStats] = useState<{
    pedidosHoy: number;
    entregaPromedio: number;
    operadores: { name: string; role: string; initials: string; color: string }[];
    activeRoute: {
      riderName: string;
      address: string;
      status: string;
      remainingTime: string;
      isActive: boolean;
    } | null;
  } | null>(null)

  useEffect(() => {
    let active = true
    const fetchStats = async () => {
      try {
        const data = await api.get<any>('/public/login-stats')
        if (active) {
          setStats(data)
        }
      } catch (err) {
        console.error('Error fetching login stats:', err)
      }
    }
    fetchStats()
    const interval = setInterval(fetchStats, 10000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (isAuthenticated) {
      if (user?.role === 'SUPERADMIN') {
        navigate('/superadmin', { replace: true })
      } else {
        navigate('/dashboard', { replace: true })
      }
    }
  }, [isAuthenticated, navigate, user])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--bg-base)] p-4 md:p-8 selection:bg-[var(--accent)]/30 selection:text-[var(--text-primary)]">
      {/* Cyber Grid Background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f29370f_1px,transparent_1px),linear-gradient(to_bottom,#1f29370f_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-30 pointer-events-none" />

      {/* Tech Laser Scanline */}
      <motion.div 
        className="pointer-events-none absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[var(--accent)]/30 to-transparent z-0"
        animate={{ top: ['0%', '100%'] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
      />

      {/* Ambient Glowing Light Orbs */}
      <motion.div
        className="pointer-events-none absolute -left-32 -top-32 h-[450px] w-[450px] rounded-full opacity-[0.18] blur-[120px]"
        style={{ backgroundColor: brand.colors.limaMoss }}
        animate={{ scale: [1, 1.25, 1], opacity: [0.15, 0.22, 0.15], x: [0, 40, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="pointer-events-none absolute -bottom-40 -right-32 h-[550px] w-[550px] rounded-full opacity-[0.15] blur-[140px]"
        style={{ backgroundColor: '#7AAF40' }}
        animate={{ scale: [1.15, 1, 1.15], opacity: [0.12, 0.2, 0.12], x: [0, -40, 0] }}
        transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="pointer-events-none absolute left-1/2 top-1/3 h-80 w-80 -translate-x-1/2 rounded-full opacity-[0.06] blur-[90px]"
        style={{ backgroundColor: brand.colors.limaMoss }}
        animate={{ y: [0, -40, 0], scale: [0.9, 1.15, 0.9] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Floaty Cyber Particles */}
      {[...Array(8)].map((_, i) => (
        <motion.div
          key={i}
          className="pointer-events-none absolute h-1 w-1 rounded-full bg-[var(--accent)]/60 z-0"
          style={{ left: `${10 + i * 12}%`, top: `${15 + (i % 3) * 25}%` }}
          animate={{
            y: [0, -60, 0],
            opacity: [0, 0.7, 0],
            scale: [0.6, 1.8, 0.6],
          }}
          transition={{
            duration: 4 + i * 0.6,
            repeat: Infinity,
            delay: i * 0.7,
            ease: 'easeInOut',
          }}
        />
      ))}

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
        {/* Left Side: Brand presentation and route map */}
        <motion.section
          className="flex flex-col justify-center min-h-[500px] lg:pr-6"
          variants={slideInLeft}
        >
          <motion.div
            className="w-fit rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)]/60 backdrop-blur-md px-5 py-3"
            whileHover={{ scale: 1.02 }}
            transition={{ type: 'spring', stiffness: 300 }}
          >
            <BrandLogo imageClassName="w-48 sm:w-56" />
          </motion.div>

          <motion.div className="mt-8 max-w-xl" variants={itemVariants}>
            <motion.p
              className="mb-2 text-xs font-bold tracking-[0.4em] text-[var(--accent)] uppercase"
              initial={{ opacity: 0, letterSpacing: '0.1em' }}
              animate={{ opacity: 1, letterSpacing: '0.4em' }}
              transition={{ delay: 0.8, duration: 0.8 }}
            >
              {brand.slogan}
            </motion.p>
            <motion.h1
              className="antifont text-5xl leading-none text-[var(--text-primary)] md:text-7xl tracking-wide"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.6 }}
            >
              THE VILLA DOG
            </motion.h1>
          </motion.div>

          {/* Real-time Domicilio Simulator Grid (hidden on mobile, gorgeous on md+) */}
          <motion.div 
            className="relative mt-8 hidden md:block w-full max-w-md lg:max-w-lg z-10"
            variants={itemVariants}
          >
            {/* Delivery Map Simulator component */}
            <DeliverySimulator activeRoute={stats?.activeRoute} />

            {/* Floating Widget 1: Total Orders */}
            <motion.div
              className="absolute -top-5 -right-5 bg-[var(--bg-panel)]/90 border border-[var(--accent)]/20 rounded-2xl p-3 shadow-xl backdrop-blur-md flex items-center gap-3 z-20"
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            >
              <div className="bg-[var(--accent)]/10 p-2 rounded-xl text-[var(--accent)]">
                <TrendingUp className="h-4.5 w-4.5" />
              </div>
              <div className="pr-1.5">
                <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] block font-semibold">Pedidos Hoy</span>
                <span className="text-base font-bold text-[var(--text-primary)] font-mono leading-none">
                  {stats ? stats.pedidosHoy : '---'}
                </span>
              </div>
            </motion.div>

            {/* Floating Widget 2: Average Delivery Time */}
            <motion.div
              className="absolute -bottom-5 -left-5 bg-[var(--bg-panel)]/90 border border-purple-500/20 rounded-2xl p-3 shadow-xl backdrop-blur-md flex items-center gap-3 z-20"
              animate={{ y: [0, 6, 0] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
            >
              <div className="bg-purple-500/10 p-2 rounded-xl text-purple-400">
                <Clock className="h-4.5 w-4.5" />
              </div>
              <div className="pr-1.5">
                <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] block font-semibold">Entrega Promedio</span>
                <span className="text-base font-bold text-[var(--text-primary)] font-mono leading-none">
                  {stats ? `${stats.entregaPromedio} min` : '---'}
                </span>
              </div>
            </motion.div>

            {/* Floating Widget 3: Connected staff */}
            <motion.div
              className="absolute bottom-1/2 -right-6 bg-[var(--bg-panel)]/90 border border-blue-500/20 rounded-2xl p-2.5 shadow-xl backdrop-blur-md flex items-center gap-2 z-20"
              animate={{ x: [0, 4, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 0.6 }}
            >
              <div className="flex -space-x-1.5">
                {stats && stats.operadores.length > 0 ? (
                  stats.operadores.slice(0, 3).map((op, index) => (
                    <div 
                      key={index}
                      className="h-5 w-5 rounded-full border border-[var(--border-subtle)] flex items-center justify-center text-[8px] font-bold text-white font-mono shadow-sm"
                      style={{ backgroundColor: op.color }}
                      title={`${op.name} (${op.role})`}
                    >
                      {op.initials.slice(0, 1)}
                    </div>
                  ))
                ) : (
                  <>
                    <div className="h-5 w-5 rounded-full border border-[var(--border-subtle)] bg-emerald-500 flex items-center justify-center text-[8px] font-bold text-white font-mono">J</div>
                    <div className="h-5 w-5 rounded-full border border-[var(--border-subtle)] bg-blue-500 flex items-center justify-center text-[8px] font-bold text-white font-mono">A</div>
                    <div className="h-5 w-5 rounded-full border border-[var(--border-subtle)] bg-amber-500 flex items-center justify-center text-[8px] font-bold text-white font-mono">C</div>
                  </>
                )}
              </div>
              <div className="pr-1">
                <span className="text-[8px] uppercase tracking-wider text-[var(--text-muted)] block font-semibold leading-none mb-0.5">Operadores</span>
                <span className="text-[10px] font-bold text-[var(--text-primary)] flex items-center gap-1 leading-none">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#10B981] animate-pulse" />
                  {stats ? `${stats.operadores.length} en línea` : '3 en línea'}
                </span>
              </div>
            </motion.div>
          </motion.div>

          <motion.div
            className="mt-6 flex items-center gap-3"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.2, duration: 0.5 }}
          >
            <div className="flex items-center gap-2 rounded-full border border-[var(--accent)]/15 bg-[var(--accent)]/8 px-3.5 py-1.5">
              <UtensilsCrossed className="h-3.5 w-3.5 text-[var(--accent)]" />
              <span className="text-[11px] font-medium text-[var(--accent)]/90">Montería, Col</span>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-panel)]/50 px-3.5 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
              <span className="text-[11px] font-medium text-[var(--text-secondary)]">Sistema Activo</span>
            </div>
          </motion.div>
        </motion.section>

        {/* Right Side: Login Card and Forms */}
        <motion.div className="flex items-center w-full" variants={slideInRight}>
          <Card className="w-full border-[var(--border-subtle)] bg-[var(--bg-panel)]/80 backdrop-blur-xl shadow-2xl relative overflow-hidden rounded-3xl">
            {/* Neon Corner Accents */}
            <div className="absolute top-0 left-0 w-8 h-[2px] bg-[var(--accent)]" />
            <div className="absolute top-0 left-0 w-[2px] h-8 bg-[var(--accent)]" />
            <div className="absolute bottom-0 right-0 w-8 h-[2px] bg-[var(--accent)]" />
            <div className="absolute bottom-0 right-0 w-[2px] h-8 bg-[var(--accent)]" />

            <CardHeader className="pb-4 pt-6 text-center lg:text-left">
              <motion.div variants={itemVariants}>
                <CardTitle className="text-2xl font-bold tracking-tight text-[var(--text-primary)] font-comfortaa">
                  Iniciar Sesión
                </CardTitle>
                <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
                  Ingresa tus credenciales autorizadas para operar THE VILLA DOG.
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
                      id="email" 
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
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="pl-10.5 pr-10.5 bg-[var(--bg-input)] border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:ring-[var(--accent)]/15 h-11 transition-all duration-300 rounded-xl"
                      required
                    />
                    <motion.button
                      type="button"
                      className="absolute top-1/2 right-3 -translate-y-1/2 text-white/40 hover:text-white"
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
                      className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-300 space-y-2.5 shadow-lg"
                      initial={{ opacity: 0, y: -10, height: 0 }}
                      animate={{ opacity: 1, y: 0, height: 'auto' }}
                      exit={{ opacity: 0, y: -10, height: 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      <div className="flex items-start gap-2.5">
                        <ShieldAlert className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                        <p className="leading-relaxed text-red-200">{error}</p>
                      </div>

                      {(error.includes('bloqueada') || error.includes('intentos') || error.includes('código') || error.includes('ACCOUNT_LOCKED')) && (
                        <Button
                          type="button"
                          onClick={() => {
                            setLockoutEmail(email.trim() || 'softwaresjja@gmail.com')
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
                    className="w-full h-11.5 relative overflow-hidden rounded-xl bg-gradient-to-r from-[#90BF50] to-[#7AAF40] font-semibold text-[#0D0D0D] transition-all duration-300 shadow-[0_4px_20px_-4px_rgba(144,191,80,0.4)] hover:shadow-[0_8px_24px_-2px_rgba(144,191,80,0.6)] disabled:opacity-50 disabled:cursor-not-allowed group cursor-pointer"
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
                          Ingresar al Sistema
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
                    className="text-xs text-[var(--accent)] hover:text-[#a8d962] hover:underline transition-colors font-medium cursor-pointer"
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
                      className="flex-1 h-11 bg-gradient-to-r from-[#90BF50] to-[#7AAF40] hover:opacity-95 text-[#0D0D0D] font-bold text-xs rounded-xl shadow-lg shadow-[#90BF50]/20 disabled:opacity-50 cursor-pointer"
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
                      className="flex-1 h-11 bg-gradient-to-r from-[#90BF50] to-[#7AAF40] hover:opacity-95 text-[#0D0D0D] font-bold text-xs rounded-xl shadow-lg shadow-[#90BF50]/20 disabled:opacity-50 cursor-pointer"
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
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3.5 text-xs text-red-300 space-y-1.5">
                    <p className="font-semibold text-red-200 text-sm">🚨 Cuenta Bloqueada Preventivamente</p>
                    <p className="text-xs text-red-300/90">
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
