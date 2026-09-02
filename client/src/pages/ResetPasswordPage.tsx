import { useState, FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '@/hooks/useAuth'
import { BrandLogo } from '@/components/brand/BrandLogo'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Lock, Loader2, ArrowLeft, CheckCircle2, Eye, EyeOff } from 'lucide-react'

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const { resetPassword } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden')
      return
    }
    if (newPassword.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres')
      return
    }
    setLoading(true)
    try {
      await resetPassword(token, newPassword)
      setDone(true)
      setTimeout(() => navigate('/login', { replace: true }), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'El enlace es inválido o ha expirado')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--bg-base)] p-4">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f29370f_1px,transparent_1px),linear-gradient(to_bottom,#1f29370f_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-30 pointer-events-none" />

      <motion.div
        className="relative z-10 w-full max-w-md"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="flex justify-center mb-6">
          <BrandLogo imageClassName="w-40" />
        </div>

        <Card className="w-full border-[var(--border-subtle)] bg-[var(--bg-panel)]/80 backdrop-blur-xl shadow-2xl relative overflow-hidden rounded-3xl">
          <div className="absolute top-0 left-0 w-8 h-[2px] bg-[var(--accent)]" />
          <div className="absolute top-0 left-0 w-[2px] h-8 bg-[var(--accent)]" />
          <div className="absolute bottom-0 right-0 w-8 h-[2px] bg-[var(--accent)]" />
          <div className="absolute bottom-0 right-0 w-[2px] h-8 bg-[var(--accent)]" />

          <CardHeader className="pb-4 pt-6 text-center">
            <CardTitle className="text-2xl font-bold tracking-tight text-[var(--text-primary)] font-comfortaa">
              Restablecer Contraseña
            </CardTitle>
            <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
              Elige tu nueva contraseña de acceso.
            </p>
          </CardHeader>

          <CardContent className="pb-6">
            {!token ? (
              <div className="rounded-xl border border-red-500/25 bg-red-500/8 px-3.5 py-3 text-xs text-red-400 text-center">
                Enlace inválido. Solicita uno nuevo desde "¿Olvidaste tu contraseña?".
              </div>
            ) : done ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-3 py-6 text-center"
              >
                <CheckCircle2 className="h-12 w-12 text-[var(--accent)]" />
                <p className="text-sm text-[var(--text-primary)] font-semibold">Contraseña actualizada</p>
                <p className="text-xs text-[var(--text-secondary)]">Redirigiendo a inicio de sesión...</p>
              </motion.div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="newPassword" className="text-[var(--text-secondary)] text-xs font-medium pl-1">Nueva Contraseña</Label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[var(--text-muted)]">
                      <Lock className="h-4 w-4" />
                    </div>
                    <Input
                      id="newPassword"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      className="pl-10.5 pr-10.5 bg-[var(--bg-input)] border-[var(--border-default)] text-[var(--text-primary)] h-11 rounded-xl"
                      required
                    />
                    <button
                      type="button"
                      className="absolute top-1/2 right-3 -translate-y-1/2 text-white/40 hover:text-white"
                      onClick={() => setShowPassword(v => !v)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword" className="text-[var(--text-secondary)] text-xs font-medium pl-1">Confirmar Contraseña</Label>
                  <Input
                    id="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    className="bg-[var(--bg-input)] border-[var(--border-default)] text-[var(--text-primary)] h-11 rounded-xl"
                    required
                  />
                </div>

                <AnimatePresence mode="wait">
                  {error && (
                    <motion.p
                      className="rounded-xl border border-red-500/25 bg-red-500/8 px-3.5 py-2.5 text-xs text-red-400"
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    >
                      {error}
                    </motion.p>
                  )}
                </AnimatePresence>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-11.5 rounded-xl bg-gradient-to-r from-[#90BF50] to-[#7AAF40] font-bold text-[#0D0D0D] uppercase text-xs tracking-wide"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Restablecer Contraseña'}
                </Button>
              </form>
            )}

            <Link
              to="/login"
              className="mt-5 flex items-center justify-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Volver a Iniciar Sesión
            </Link>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
