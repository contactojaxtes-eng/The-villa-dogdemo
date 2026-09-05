import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { formatCurrency, formatThousandsInput, parseThousandsInput } from '@/lib/utils'
import { Wallet, Plus, User, ArrowUpRight, DollarSign, LockOpen, Lock, Loader2, CheckCircle2, Banknote, CreditCard, Smartphone, TrendingUp, Receipt, AlertTriangle, X, Trash2, Printer, Edit } from 'lucide-react'
import { PageHeader } from '@/components/ui/PageHeader'
import { io } from '@/lib/socket'
import { printClosingSmart, printOpeningSmart } from '@/lib/printer'
import { alerts } from '@/lib/alerts'

interface CashRegister {
  id: string
  name: string
  description: string | null
  manager: { id: string; name: string } | null
  closings: { id: string; isOpen: boolean; user: { id: string; name: string }; initialCash: number; shiftStart: string }[]
}

interface UserOption { id: string; name: string; role: string; active?: boolean }

interface Summary {
  orderCount: number
  totalSales: number
  totalCash: number
  totalTransfer: number
  totalNequi: number
  totalBancolombia: number
  totalDaviplata: number
  totalTips: number
  totalExpenses: number
  isOpen?: boolean
  initialCash?: number
  cashInDrawer?: number
}

interface CashSummary {
  totalCash: number
  totalTransfers: number
  totalNequi: number
  totalBancolombia: number
  totalDaviplata: number
  totalSales: number
  totalTips: number
  totalExpenses: number
  creditSales: number
  totalCreditPayments: number
  orderCount: number
  isOpen: boolean
  initialCash: number
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } }
} as const

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 22 } }
} as const

export default function CashRegistersPage() {
  const { user, hasRole } = useAuth()
  const isAdmin = hasRole('SUPERADMIN', 'ADMIN')
  const [registers, setRegisters] = useState<CashRegister[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [summaries, setSummaries] = useState<Record<string, Summary>>({})
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', managerId: 'NONE' })
  const [editRegId, setEditRegId] = useState<string | null>(null)
  const [isCreatingNewUser, setIsCreatingNewUser] = useState(false)
  const [newUserForm, setNewUserForm] = useState({ name: '', email: '', password: '', role: 'CASHIER', phone: '' })

  // Open cash dialog
  const [openCashDialog, setOpenCashDialog] = useState(false)
  const [openCashRegisterId, setOpenCashRegisterId] = useState('')
  const [initialCash, setInitialCash] = useState('0')
  const [openingLoading, setOpeningLoading] = useState(false)

  // Close cash dialog
  const [closeCashDialog, setCloseCashDialog] = useState(false)
  const [closeCashRegisterId, setCloseCashRegisterId] = useState('')
  const [closeSummary, setCloseSummary] = useState<CashSummary | null>(null)
  const [closeRegSummary, setCloseRegSummary] = useState<Summary | null>(null)
  const [closingLoading, setClosingLoading] = useState(false)
  const [closeNotes, setCloseNotes] = useState('')

  // Close result
  const [closeSuccess, setCloseSuccess] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [regs, usrs] = await Promise.all([
        api.get<CashRegister[]>('/cash-registers'),
        isAdmin ? api.get<UserOption[]>('/users?active=true') : Promise.resolve([]),
      ])
      setRegisters(regs)
      setUsers(usrs.filter(u => u.active !== false && ['CASHIER', 'ADMIN', 'SUPERADMIN'].includes(u.role)))

      const sums: Record<string, Summary> = {}
      for (const r of regs) {
        try {
          const s = await api.get<Summary>(`/cash-registers/${r.id}/summary`)
          if (s) sums[r.id] = s
        } catch (err) {
          console.error(`Error cargando sumario de caja ${r.id}:`, err)
        }
      }
      setSummaries(sums)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load().catch(console.error)

    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      transports: ['websocket', 'polling'],
    })

    const handleRefresh = () => {
      load().catch(console.error)
    }

    socket.on('cashRegistersChanged', handleRefresh)
    socket.on('cashStatusChanged', handleRefresh)
    socket.on('orderCreated', handleRefresh)
    socket.on('orderUpdated', handleRefresh)
    socket.on('orderStatusChanged', handleRefresh)
    socket.on('tableOrderSubmitted', handleRefresh)
    socket.on('tableClosed', handleRefresh)
    socket.on('paymentSubmitted', handleRefresh)
    socket.on('paymentValidated', handleRefresh)
    socket.on('paymentUpdated', handleRefresh)
    socket.on('expenseCreated', handleRefresh)

    return () => {
      socket.disconnect()
    }
  }, [])

  const handleSave = async () => {
    if (!form.name.trim()) {
      alert('El nombre de la caja es requerido')
      return
    }
    try {
      let finalManagerId = form.managerId === 'NONE' || !form.managerId ? null : form.managerId

      if (isCreatingNewUser) {
        if (!newUserForm.name.trim() || !newUserForm.email.trim() || !newUserForm.password.trim()) {
          alert('Por favor completa todos los campos requeridos para el nuevo usuario (Nombre, Email y Contraseña).')
          return
        }
        const createdUser = await api.post<any>('/users', {
          name: newUserForm.name,
          email: newUserForm.email,
          password: newUserForm.password,
          role: newUserForm.role,
          phone: newUserForm.phone || undefined
        })
        finalManagerId = createdUser.id
      }

      const payload = {
        name: form.name,
        description: form.description || undefined,
        managerId: finalManagerId
      }

      if (editRegId) {
        await api.put(`/cash-registers/${editRegId}`, payload)
      } else {
        await api.post('/cash-registers', payload)
      }
      setDialogOpen(false)
      resetForm()
      load()
    } catch (err: any) {
      alert(err.message || 'Error al guardar caja')
    }
  }

  const resetForm = () => {
    setEditRegId(null)
    setForm({ name: '', description: '', managerId: 'NONE' })
    setIsCreatingNewUser(false)
    setNewUserForm({ name: '', email: '', password: '', role: 'CASHIER', phone: '' })
  }

  const openEdit = (reg: CashRegister) => {
    setEditRegId(reg.id)
    setForm({
      name: reg.name,
      description: reg.description || '',
      managerId: reg.manager?.id || 'NONE'
    })
    setIsCreatingNewUser(false)
    setDialogOpen(true)
  }

  const handleOpenCash = async () => {
    setOpeningLoading(true)
    try {
      const openingResult = await api.post<any>('/payments/opening', { 
        initialCash: parseThousandsInput(initialCash),
        cashRegisterId: openCashRegisterId 
      })
      const regId = openCashRegisterId
      setOpenCashDialog(false)
      setInitialCash('0')
      alerts.success('Caja Abierta', 'El turno de caja ha sido abierto exitosamente.')
      load()
    } catch (err: any) {
      alerts.error('Error al abrir caja', err.message || 'No se pudo abrir la caja registradora.')
    } finally {
      setOpeningLoading(false)
    }
  }

  const prepareCloseCash = async (regId: string) => {
    setCloseCashRegisterId(regId)
    setCloseNotes('')
    setCloseSuccess(false)
    try {
      const [userSummary, regSummary] = await Promise.all([
        api.get<CashSummary>(`/payments/closing/today?cashRegisterId=${regId}`).catch(err => {
          console.warn('Error cargando userSummary:', err)
          return null
        }),
        api.get<Summary>(`/cash-registers/${regId}/summary`).catch(err => {
          console.warn('Error cargando regSummary:', err)
          return null
        }),
      ])

      const fallbackSummary: CashSummary = {
        totalCash: regSummary?.totalCash || 0,
        totalTransfers: regSummary?.totalTransfer || 0,
        totalNequi: regSummary?.totalNequi || 0,
        totalBancolombia: regSummary?.totalBancolombia || 0,
        totalDaviplata: regSummary?.totalDaviplata || 0,
        totalSales: regSummary?.totalSales || 0,
        totalTips: regSummary?.totalTips || 0,
        totalExpenses: regSummary?.totalExpenses || 0,
        orderCount: regSummary?.orderCount || 0,
        isOpen: regSummary?.isOpen ?? true,
        initialCash: regSummary?.initialCash || 0,
        creditSales: 0,
        totalCreditPayments: 0,
      }

      if (!regSummary && !userSummary) {
        throw new Error('No se pudo obtener el resumen financiero de la caja.')
      }

      setCloseSummary(userSummary || fallbackSummary)
      setCloseRegSummary(regSummary || (userSummary as any))
      setCloseCashDialog(true)
    } catch (err: any) {
      alerts.error('Error al cargar resumen', err.message || 'No se pudo cargar el resumen financiero.')
    }
  }

  const handleCloseCash = async (shouldPrint = true) => {
    const ok = await alerts.confirm(
      '¿Cerrar Caja?',
      '¿Estás seguro de que deseas cerrar la caja registradora? Esta acción finalizará el turno actual.',
      'Sí, cerrar',
      'Cancelar'
    )
    if (!ok) return

    setClosingLoading(true)
    try {
      const closing = await api.post<any>('/payments/closing', { 
        notes: closeNotes || undefined,
        cashRegisterId: closeCashRegisterId 
      })

      if (shouldPrint) {
        try {
          // Fetch full detailed Z report data before printing
          const detail = await api.get<any>(`/payments/closing/${closing.id}/detail`)
          await printClosingSmart({ ...closing, user: { name: user?.name }, _detail: detail }, user?.role)
        } catch (printErr) {
          console.error('Error al imprimir cierre', printErr)
        }
      }

      setCloseSuccess(true)
      alerts.success('Caja Cerrada', 'El turno de caja ha sido cerrado correctamente.')
      setTimeout(() => {
        setCloseCashDialog(false)
        setCloseSuccess(false)
        load()
      }, 2000)
    } catch (err: any) {
      alerts.error('Error al cerrar caja', err.message || 'No se pudo completar el cierre.')
    } finally {
      setClosingLoading(false)
    }
  }

  const handleDelete = async (regId: string) => {
    const ok = await alerts.confirm(
      '¿Eliminar Caja?',
      '¿Estás seguro de que deseas eliminar esta caja registradora permanentemente?',
      'Sí, eliminar',
      'Cancelar'
    )
    if (!ok) return
    try {
      await api.delete(`/cash-registers/${regId}`)
      alerts.success('Caja Eliminada', 'La caja registradora ha sido removida.')
      load()
    } catch (err: any) {
      alerts.error('Error al eliminar caja', err.message || 'No se pudo eliminar la caja.')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-[var(--text-secondary)]">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}>
          <div className="h-10 w-10 rounded-full border-2 border-[var(--accent)] border-t-transparent" />
        </motion.div>
        <span className="ml-3 font-medium">Cargando control de caja...</span>
      </div>
    )
  }

      const displayRegisters = registers

      return (
        <div className="space-y-6">
          <PageHeader
            title="CAJA"
            description="Administra las cajas registradoras. Abre, opera y cierra turnos de caja."
            actions={
              isAdmin ? (
                <Button 
                  className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold shadow-lg shadow-[var(--accent)]/15 rounded-xl h-11 px-5 text-xs uppercase tracking-wider" 
                  onClick={() => { resetForm(); setDialogOpen(true); }}
                >
                  <Plus className="mr-2 h-4 w-4" /> Nueva caja
                </Button>
              ) : undefined
            }
          />

          <motion.div 
            variants={containerVariants} 
            initial="hidden" 
            animate="show" 
            className="grid gap-6 md:grid-cols-2"
          >
            {displayRegisters.map(reg => {
              const sum = summaries[reg.id]
          const openClosing = reg.closings.find(c => c.isOpen)
          const isOpen = !!openClosing
          const isOperator = openClosing?.user?.id === user?.id
          const canOperate = isAdmin || (isOpen ? isOperator : user?.role === 'CASHIER')

          return (
            <motion.div key={reg.id} variants={itemVariants}>
              <Card className="niche-card-premium border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl relative overflow-hidden group">
                <div className={`absolute -right-8 -top-8 w-24 h-24 bg-gradient-to-br ${isOpen ? 'from-[var(--accent)]/10' : 'from-gray-500/5'} to-transparent rounded-full blur-2xl`} />
                
                <CardContent className="p-6 relative z-10 space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Wallet className="h-5 w-5 text-[var(--accent)]" />
                        <h3 className="font-extrabold text-lg text-[var(--text-primary)] tracking-wide group-hover:text-[var(--accent)] transition-colors">{reg.name}</h3>
                      </div>
                      {reg.description && (
                        <p className="text-xs text-[var(--text-secondary)] font-medium leading-relaxed max-w-sm">{reg.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {isAdmin && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 rounded-lg transition-all"
                            onClick={() => openEdit(reg)}
                            title="Editar Caja"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-[var(--text-muted)] hover:text-[var(--destructive)] hover:bg-[var(--destructive)]/10 rounded-lg transition-all"
                            onClick={() => handleDelete(reg.id)}
                            title="Eliminar Caja"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      <Badge className={`text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full tracking-wider ${isOpen ? 'bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20 animate-pulse' : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] border border-[var(--border-subtle)]'}`}>
                        {isOpen ? 'Abierta' : 'Cerrada'}
                      </Badge>
                    </div>
                  </div>

                  {/* Open shift info */}
                  {openClosing && (
                    <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] bg-[var(--accent)]/10 border border-[var(--accent)]/20 rounded-xl p-3">
                      <User className="h-4 w-4 text-[var(--accent)]" />
                      <div>
                        <p className="font-bold text-[var(--text-primary)]">Operador actual: {openClosing.user.name}</p>
                        <p className="text-[10px] text-[var(--text-muted)]">Apertura: {new Date(openClosing.shiftStart).toLocaleString('es-CO')} | Base: {formatCurrency(openClosing.initialCash)}</p>
                      </div>
                    </div>
                  )}

                  {reg.manager && !isOpen && (
                    <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-xl p-3">
                      <User className="h-4 w-4 text-[var(--text-muted)]" />
                      <p><span className="text-[var(--text-muted)]">Encargado:</span> <strong className="text-[var(--text-primary)]">{reg.manager.name}</strong></p>
                    </div>
                  )}

                  {/* Summary grid */}
                  {sum && (
                    <div className="grid grid-cols-2 gap-3 text-sm pt-4 border-t border-[var(--border-subtle)]/40">
                      <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3">
                        <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Ventas Totales</p>
                        <p className="text-lg font-black text-[var(--accent)] mt-0.5">{formatCurrency(isOpen ? sum.totalSales : 0)}</p>
                        <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                          {isOpen ? `${sum.orderCount} pedidos del turno` : '0 pedidos (Caja cerrada)'}
                        </p>
                      </div>

                      <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3">
                        <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Efectivo en Caja</p>
                        <p className="text-lg font-black text-[var(--text-primary)] mt-0.5">
                          {formatCurrency(isOpen ? (sum.cashInDrawer ?? ((sum.initialCash || 0) + (sum.totalCash || 0))) : 0)}
                        </p>
                        <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                          {isOpen ? `Base (${formatCurrency(sum.initialCash || 0)}) + Ventas (${formatCurrency(sum.totalCash || 0)})` : 'Recaudado en físico'}
                        </p>
                      </div>

                      <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3">
                        <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Transferencias & Digitales</p>
                        <p className="text-base font-extrabold text-[var(--text-primary)] mt-0.5">
                          {formatCurrency(isOpen ? (sum.totalTransfer || 0) : 0)}
                        </p>
                        <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">Bancos / Nequi / Daviplata</p>
                      </div>

                      <div className="rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-3">
                        <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Total General del Turno</p>
                        <p className="text-base font-extrabold text-emerald-400 mt-0.5">
                          {formatCurrency(isOpen ? ((sum.initialCash || 0) + (sum.totalSales || 0)) : 0)}
                        </p>
                        <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">Inicial + Ventas Totales</p>
                      </div>
                    </div>
                  )}

                  {/* Action buttons */}
                  {canOperate && (
                    <div className="flex gap-2 pt-2">
                      {!isOpen ? (
                        <Button
                          className="flex-1 h-11 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold shadow-lg shadow-[var(--accent)]/15 rounded-xl text-xs uppercase tracking-wider gap-2"
                          onClick={() => { setOpenCashRegisterId(reg.id); setOpenCashDialog(true); setInitialCash('0') }}
                        >
                          <LockOpen className="h-4 w-4" /> Abrir Caja
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          className="flex-1 h-11 border-[var(--destructive)]/30 text-[var(--destructive)] hover:bg-[var(--destructive)]/10 font-bold rounded-xl text-xs uppercase tracking-wider gap-2"
                          onClick={() => prepareCloseCash(reg.id)}
                        >
                          <Lock className="h-4 w-4" /> Cerrar Caja
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )
        })}
      </motion.div>

      {registers.length === 0 && (
        <div className="py-20 text-center text-[var(--text-secondary)] border border-dashed border-[var(--border-subtle)] rounded-2xl bg-[var(--bg-panel)]/50">
          <Wallet className="mx-auto h-8 w-8 text-[var(--text-muted)] mb-3 animate-pulse" />
          <p className="font-medium">No hay cajas registradoras creadas. Crea una para iniciar contabilidad.</p>
        </div>
      )}

      {/* ── Open Cash Dialog ── */}
      <Dialog open={openCashDialog} onOpenChange={setOpenCashDialog}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl max-w-sm p-0 overflow-hidden shadow-2xl">
          <div className="h-1.5 w-full" style={{ background: 'linear-gradient(90deg, var(--accent), #EA580C)' }} />
          <div className="p-6">
            <DialogHeader className="pb-4">
              <DialogTitle className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
                <LockOpen className="h-5 w-5 text-[var(--accent)]" /> Abrir Caja
              </DialogTitle>
              <DialogDescription className="text-xs text-[var(--text-secondary)] mt-1">
                Ingresa el monto inicial en efectivo con el que inicias el turno.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase font-extrabold tracking-wider text-[var(--text-secondary)]">Monto Inicial (Efectivo)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] font-bold">$</span>
                  <Input 
                    type="text"
                    className="h-12 pl-8 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-default)] focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] text-[var(--text-primary)] text-lg font-bold" 
                    value={formatThousandsInput(initialCash)} 
                    onChange={e => setInitialCash(e.target.value.replace(/\D/g, ''))} 
                    placeholder="0" 
                    autoFocus
                  />
                </div>
              </div>
              <Button 
                className="w-full h-12 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold shadow-lg shadow-[var(--accent)]/15 rounded-xl text-sm uppercase tracking-wider gap-2" 
                onClick={handleOpenCash}
                disabled={openingLoading}
              >
                {openingLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockOpen className="h-4 w-4" />}
                {openingLoading ? 'Abriendo...' : 'Confirmar Apertura'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Close Cash Dialog (Reporte Z) ── */}
      <Dialog open={closeCashDialog} onOpenChange={v => { if (!closingLoading) setCloseCashDialog(v) }}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl max-w-md p-0 overflow-hidden shadow-2xl max-h-[92vh] flex flex-col">
          <div className="h-1.5 w-full bg-gradient-to-r from-[var(--destructive)] to-orange-500 shrink-0" />
          <div className="p-6 overflow-y-auto flex-1">
            <DialogHeader className="pb-4">
              <DialogTitle className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
                <Receipt className="h-5 w-5 text-[var(--destructive)]" /> Cierre de Caja — Reporte Z
              </DialogTitle>
              <DialogDescription className="text-xs text-[var(--text-secondary)] mt-1">
                Resumen del turno actual. Confirma para cerrar caja.
              </DialogDescription>
            </DialogHeader>

            <AnimatePresence mode="wait">
              {closeSuccess ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center gap-3 py-8"
                >
                  <div className="h-16 w-16 rounded-full bg-[var(--accent)]/15 flex items-center justify-center">
                    <CheckCircle2 className="h-8 w-8 text-[var(--accent)]" />
                  </div>
                  <p className="text-lg font-bold text-[var(--accent)]">¡Caja Cerrada!</p>
                  <p className="text-xs text-[var(--text-secondary)]">Turno finalizado correctamente</p>
                </motion.div>
              ) : closeRegSummary && closeSummary ? (
                <motion.div
                  key="summary"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="space-y-4 pt-2"
                >
                  {/* Report Z Summary */}
                  <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 space-y-3">
                    <div className="flex justify-between items-center pb-2 border-b border-[var(--border-subtle)]/50">
                      <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">Base Inicial</span>
                      <span className="font-bold text-[var(--text-primary)]">{formatCurrency(closeSummary.initialCash)}</span>
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5"><Banknote className="h-3.5 w-3.5 text-emerald-500" /> Efectivo</span>
                        <span className="font-bold text-[var(--text-primary)]">{formatCurrency(closeRegSummary.totalCash)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5 text-blue-500" /> Transferencias</span>
                        <span className="font-bold text-[var(--text-primary)]">{formatCurrency(closeRegSummary.totalTransfer)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5"><Smartphone className="h-3.5 w-3.5 text-purple-500" /> Nequi</span>
                        <span className="font-bold text-[var(--text-primary)]">{formatCurrency(closeRegSummary.totalNequi)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5"><Smartphone className="h-3.5 w-3.5 text-red-500" /> Daviplata</span>
                        <span className="font-bold text-[var(--text-primary)]">{formatCurrency(closeRegSummary.totalDaviplata)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5 text-yellow-500" /> Bancolombia</span>
                        <span className="font-bold text-[var(--text-primary)]">{formatCurrency(closeRegSummary.totalBancolombia)}</span>
                      </div>
                    </div>

                    <div className="border-t border-[var(--border-subtle)]/50 pt-2 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-[var(--text-secondary)]">Propinas</span>
                        <span className="font-semibold text-[var(--text-primary)]">{formatCurrency(closeRegSummary.totalTips)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-[var(--text-secondary)]">Gastos</span>
                        <span className="font-semibold text-[var(--destructive)]">-{formatCurrency(closeSummary.totalExpenses)}</span>
                      </div>
                    </div>

                    <div className="border-t-2 border-[var(--accent)]/30 pt-3 flex justify-between items-center">
                      <span className="text-sm font-extrabold uppercase tracking-wider text-[var(--accent)]">Total Ventas</span>
                      <span className="text-xl font-black text-[var(--accent)]">{formatCurrency(closeRegSummary.totalSales)}</span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-[var(--text-muted)]">
                      <span>Pedidos procesados</span>
                      <span className="font-bold">{closeRegSummary.orderCount}</span>
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase font-extrabold tracking-wider text-[var(--text-secondary)]">Notas del cierre (Opcional)</Label>
                    <Input
                      className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-default)] focus:ring-2 focus:ring-[var(--destructive)]/20 text-[var(--text-primary)]"
                      value={closeNotes}
                      onChange={e => setCloseNotes(e.target.value)}
                      placeholder="Ej: Sobrante de $5.000 en efectivo"
                    />
                  </div>

                  {/* Confirm buttons */}
                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <Button
                      variant="outline"
                      className="h-11 rounded-xl font-bold text-xs border-[var(--border-default)]"
                      onClick={() => setCloseCashDialog(false)}
                      disabled={closingLoading}
                    >
                      Cancelar
                    </Button>
                    <Button
                      className="h-11 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-xs uppercase tracking-wider gap-2 shadow-md"
                      onClick={() => handleCloseCash(false)}
                      disabled={closingLoading}
                    >
                      <Lock className="h-4 w-4" /> Solo Cerrar
                    </Button>
                    <Button
                      className="h-11 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold rounded-xl text-xs uppercase tracking-wider gap-2 shadow-md col-span-2 border-0 cursor-pointer"
                      onClick={() => handleCloseCash(true)}
                      disabled={closingLoading}
                    >
                      <Printer className="h-4 w-4" /> Cerrar e Imprimir
                    </Button>
                  </div>
                </motion.div>
              ) : (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-[var(--accent)]" />
                </div>
              )}
            </AnimatePresence>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Create Register Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl max-w-md p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-[var(--text-primary)] tracking-tight">
              {editRegId ? 'Editar Caja Registradora' : 'Nueva Caja Registradora'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-3">
            <div className="space-y-2">
              <Label className="text-xs uppercase font-extrabold tracking-wider text-[var(--text-secondary)]">Nombre de la Caja</Label>
              <Input 
                className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] text-[var(--text-primary)]" 
                value={form.name} 
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))} 
                placeholder="Ej: Caja Principal 1" 
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-xs uppercase font-extrabold tracking-wider text-[var(--text-secondary)]">Descripción</Label>
              <Input 
                className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] focus:ring-2 focus:ring-[var(--accent)]/20 focus:border-[var(--accent)] text-[var(--text-primary)]" 
                value={form.description} 
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))} 
                placeholder="Ej: Caja de barra y domicilios nocturnos" 
              />
            </div>

             <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-xs uppercase font-extrabold tracking-wider text-[var(--text-secondary)]">
                  Cajero Encargado (Opcional)
                </Label>
                <button
                  type="button"
                  className="text-xs font-bold text-[var(--accent)] hover:underline"
                  onClick={() => setIsCreatingNewUser(!isCreatingNewUser)}
                >
                  {isCreatingNewUser ? 'Seleccionar existente' : '➕ Crear nuevo usuario'}
                </button>
              </div>

              {!isCreatingNewUser ? (
                <Select 
                  value={form.managerId || 'NONE'} 
                  onValueChange={val => setForm(p => ({ ...p, managerId: val }))}
                >
                  <SelectTrigger className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)]">
                    <SelectValue placeholder="Sin cajero asignado" />
                  </SelectTrigger>
                  <SelectContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl">
                    <SelectItem value="NONE" className="text-[var(--text-primary)]">Sin cajero asignado</SelectItem>
                    {users.map(u => (
                      <SelectItem key={u.id} value={u.id} className="text-[var(--text-primary)]">
                        {u.name} ({u.role === 'CASHIER' ? 'Cajero' : u.role === 'ADMIN' ? 'Admin' : u.role === 'DELIVERY_MANAGER' ? 'Gestor' : u.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 space-y-3 mt-2">
                  <p className="text-[10px] font-bold text-[var(--accent)] uppercase tracking-wider">Crear nuevo usuario e ingresar al sistema</p>
                  
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-bold text-[var(--text-secondary)]">Nombre completo</Label>
                    <Input
                      className="h-9 rounded-lg bg-[var(--bg-panel)] border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                      value={newUserForm.name}
                      onChange={e => setNewUserForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="Ej: Adriana Gómez"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-bold text-[var(--text-secondary)]">Usuario / Email</Label>
                    <Input
                      className="h-9 rounded-lg bg-[var(--bg-panel)] border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                      value={newUserForm.email}
                      onChange={e => setNewUserForm(p => ({ ...p, email: e.target.value }))}
                      placeholder="Ej: adriana o adriana@thevilladog.local"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-bold text-[var(--text-secondary)]">Contraseña</Label>
                    <Input
                      type="password"
                      className="h-9 rounded-lg bg-[var(--bg-panel)] border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                      value={newUserForm.password}
                      onChange={e => setNewUserForm(p => ({ ...p, password: e.target.value }))}
                      placeholder="Contraseña del usuario"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-bold text-[var(--text-secondary)]">Teléfono (Opcional)</Label>
                    <Input
                      className="h-9 rounded-lg bg-[var(--bg-panel)] border-[var(--border-subtle)] text-xs text-[var(--text-primary)]"
                      value={newUserForm.phone}
                      onChange={e => setNewUserForm(p => ({ ...p, phone: e.target.value }))}
                      placeholder="Ej: 3001234567"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-bold text-[var(--text-secondary)]">Rol de usuario</Label>
                    <Select 
                      value={newUserForm.role}
                      onValueChange={val => setNewUserForm(p => ({ ...p, role: val }))}
                    >
                      <SelectTrigger className="h-9 rounded-lg bg-[var(--bg-panel)] border-[var(--border-subtle)] text-xs text-[var(--text-primary)]">
                        <SelectValue placeholder="Selecciona el rol" />
                      </SelectTrigger>
                      <SelectContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-xl">
                        <SelectItem value="CASHIER" className="text-xs text-[var(--text-primary)]">Cajero</SelectItem>
                        <SelectItem value="ADMIN" className="text-xs text-[var(--text-primary)]">Administrador</SelectItem>
                        <SelectItem value="DELIVERY_MANAGER" className="text-xs text-[var(--text-primary)]">Gestor de Domicilios</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>
            
            <Button 
              className="w-full h-11 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold shadow-lg shadow-[var(--accent)]/15 rounded-xl mt-4 text-sm uppercase tracking-wider" 
              onClick={handleSave}
            >
              {editRegId ? 'Guardar Cambios' : 'Crear Caja'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
