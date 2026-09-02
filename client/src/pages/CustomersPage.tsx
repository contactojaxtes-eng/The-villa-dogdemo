import { useState, useEffect, useMemo, useRef } from 'react'
import { io } from '@/lib/socket'
import { useAuth } from '@/hooks/useAuth'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { 
  Users, Search, Plus, Phone, MapPin, User, DollarSign, History, 
  Wallet, ArrowLeft, Loader2, FileText, CheckCircle2, AlertTriangle, Calendar,
  Edit, Trash2
} from 'lucide-react'
import { formatCurrency } from '@/lib/utils'

interface Customer {
  id: string
  name: string
  phone: string
  address: string | null
  active: boolean
  createdAt: string
  totalDebt: number
}

interface CustomerDetail extends Customer {
  orders: {
    id: string
    orderNumber: number
    total: number
    status: string
    paymentMethod: string
    paymentStatus: string
    createdAt: string
  }[]
  payments: {
    id: string
    amount: number
    method: string
    reference: string | null
    notes: string | null
    createdAt: string
  }[]
}

export default function CustomersPage() {
  const { user } = useAuth()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Modales
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [customerDetail, setCustomerDetail] = useState<CustomerDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Formulario nuevo / editar cliente
  const [isEditMode, setIsEditMode] = useState(false)
  const [editCustomerId, setEditCustomerId] = useState('')
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [submittingCustomer, setSubmittingCustomer] = useState(false)

  // Formulario de Abono
  const [abonoAmount, setAbonoAmount] = useState('')
  const [abonoMethod, setAbonoMethod] = useState('CASH')
  const [abonoReference, setAbonoReference] = useState('')
  const [abonoNotes, setAbonoNotes] = useState('')
  const [submittingAbono, setSubmittingAbono] = useState(false)
  const [activeTab, setActiveTab] = useState<'abono' | 'pedidos' | 'abonos'>('abono')
  const [abonoError, setAbonoError] = useState('')
  const [filterTab, setFilterTab] = useState<'ALL' | 'DEBT' | 'CLEAN'>('ALL')

  const debtCount = useMemo(() => customers.filter(c => c.totalDebt > 0).length, [customers])
  const cleanCount = useMemo(() => customers.filter(c => c.totalDebt === 0).length, [customers])
  const totalDebtSum = useMemo(() => customers.reduce((sum, c) => sum + c.totalDebt, 0), [customers])

  const filteredCustomers = useMemo(() => {
    let result = customers
    if (filterTab === 'DEBT') {
      result = result.filter(c => c.totalDebt > 0)
    } else if (filterTab === 'CLEAN') {
      result = result.filter(c => c.totalDebt === 0)
    }
    return result
  }, [customers, filterTab])

  const searchQueryRef = useRef(searchQuery)
  searchQueryRef.current = searchQuery

  const loadCustomers = async (search?: string, silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const data = await api.get<Customer[]>(`/customers${search ? `?search=${search}` : ''}`)
      setCustomers(data)
    } catch (err: any) {
      if (!silent) setError(err.message || 'No se pudieron cargar los clientes')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    loadCustomers()
  }, [])

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      transports: ['websocket', 'polling'],
    })

    socket.on('customersChanged', () => {
      loadCustomers(searchQueryRef.current, true)
    })

    return () => {
      socket.disconnect()
    }
  }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    loadCustomers(searchQuery)
  }

  const handleOpenEdit = (cust: Customer) => {
    setIsEditMode(true)
    setEditCustomerId(cust.id)
    setNewName(cust.name)
    setNewPhone(cust.phone)
    setIsCreateOpen(true)
  }

  const handleDeleteCustomer = async (id: string) => {
    if (!window.confirm('¿Estás seguro de que deseas eliminar este cliente? Se desactivará de la lista activa.')) {
      return
    }
    try {
      await api.delete(`/customers/${id}`)
      setSuccess('Cliente eliminado con éxito')
      loadCustomers()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err: any) {
      setError(err.message || 'No se pudo eliminar el cliente')
    }
  }

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmittingCustomer(true)

    const cleanedPhone = newPhone.replace(/\D/g, '')
    if (cleanedPhone.length !== 10 || !cleanedPhone.startsWith('3')) {
      setError('El celular debe tener 10 dígitos y empezar con 3.')
      setSubmittingCustomer(false)
      return
    }

    try {
      if (isEditMode) {
        await api.put(`/customers/${editCustomerId}`, {
          name: newName,
          phone: cleanedPhone
        })
        setSuccess('Cliente actualizado con éxito')
      } else {
        await api.post('/customers', {
          name: newName,
          phone: cleanedPhone
        })
        setSuccess('Cliente registrado con éxito')
      }
      setIsCreateOpen(false)
      setNewName('')
      setNewPhone('')
      setIsEditMode(false)
      setEditCustomerId('')
      loadCustomers()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err: any) {
      setError(err.message || 'Error al registrar el cliente')
    } finally {
      setSubmittingCustomer(false)
    }
  }

  const loadCustomerDetail = async (id: string) => {
    setLoadingDetail(true)
    setAbonoError('')
    try {
      const data = await api.get<CustomerDetail>(`/customers/${id}`)
      setCustomerDetail(data)
      setSelectedCustomerId(id)
    } catch (err: any) {
      setError(err.message || 'No se pudo cargar el detalle del cliente')
    } finally {
      setLoadingDetail(false)
    }
  }

  const handleRegisterAbono = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedCustomerId || !customerDetail) return
    setAbonoError('')
    setSubmittingAbono(true)

    const amountNum = parseFloat(abonoAmount)
    if (isNaN(amountNum) || amountNum <= 0) {
      setAbonoError('El monto del abono debe ser mayor a cero.')
      setSubmittingAbono(false)
      return
    }

    try {
      await api.post(`/customers/${selectedCustomerId}/payments`, {
        amount: amountNum,
        method: abonoMethod,
        reference: abonoReference || undefined,
        notes: abonoNotes || undefined
      })
      setSuccess('Abono registrado correctamente')
      setAbonoAmount('')
      setAbonoReference('')
      setAbonoNotes('')
      // Recargar datos
      await loadCustomerDetail(selectedCustomerId)
      loadCustomers()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err: any) {
      setAbonoError(err.message || 'Error al registrar abono. Verifica si tienes la caja abierta.')
    } finally {
      setSubmittingAbono(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 min-h-0 flex-1 overflow-y-auto">
      {/* HEADER PANEL */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="antifont text-2xl md:text-3xl tracking-wider text-[var(--text-primary)]">GESTIÓN DE CLIENTES</h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">Lleva el control de cartera, deudas, abonos e historial de compras de tus clientes.</p>
        </div>
        <Button
          onClick={() => setIsCreateOpen(true)}
          className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold rounded-xl h-10 px-4 flex items-center gap-1.5 shadow-lg shadow-[var(--accent)]/15 transition-all text-xs cursor-pointer self-start sm:self-auto uppercase tracking-wider"
        >
          <Plus className="h-4 w-4" /> Nuevo Cliente
        </Button>
      </div>

      {/* ALERT MESSAGES */}
      {error && (
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 px-4 py-3 text-xs text-[var(--destructive)] shrink-0">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-xs text-emerald-500 shrink-0">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* BANNER DE CARTERA PENDIENTE */}
      {debtCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl border border-red-500/20 bg-red-500/5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10 text-red-500 border border-red-500/20 font-bold">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-[var(--text-primary)]">
                Cartera Total Pendiente: <span className="text-red-500 font-extrabold text-sm">{formatCurrency(totalDebtSum)}</span>
              </p>
              <p className="text-[11px] text-[var(--text-secondary)]">
                {debtCount} {debtCount === 1 ? 'cliente tiene' : 'clientes tienen'} saldo pendiente de pago.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => setFilterTab('DEBT')}
            className="bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl text-xs h-9 px-3.5 gap-1.5 cursor-pointer shadow-sm"
          >
            <AlertTriangle className="h-3.5 w-3.5" /> Ver Clientes Pendientes ({debtCount})
          </Button>
        </div>
      )}

      {/* SEARCH AND FILTER PILLS */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form onSubmit={handleSearch} className="flex gap-2 w-full md:max-w-md shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar por nombre o teléfono..."
              className="w-full bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl pl-10 text-xs h-10 focus:border-[var(--accent)] placeholder-[var(--text-muted)]"
            />
          </div>
          <Button
            type="submit"
            className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-xl text-xs h-10 px-4 cursor-pointer"
          >
            Buscar
          </Button>
        </form>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setFilterTab('ALL')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              filterTab === 'ALL' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Todos · {customers.length}
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('DEBT')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              filterTab === 'DEBT' ? 'bg-red-500 text-white shadow-sm' : 'text-red-500 hover:bg-red-500/10'
            }`}
          >
            Con Deudas · {debtCount}
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('CLEAN')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              filterTab === 'CLEAN' ? 'bg-emerald-500 text-white shadow-sm' : 'text-emerald-500 hover:bg-emerald-500/10'
            }`}
          >
            Al Día · {cleanCount}
          </button>
        </div>
      </div>

      {/* CLIENTS GRID */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 flex-1">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" />
          <p className="text-xs text-[var(--text-secondary)]">Cargando clientes...</p>
        </div>
      ) : filteredCustomers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 rounded-2xl border border-dashed border-[var(--border-subtle)] flex-1">
          <Users className="h-10 w-10 text-[var(--text-muted)]" />
          <div className="text-center">
            <p className="text-sm font-semibold text-[var(--text-secondary)]">
              {filterTab === 'DEBT' ? 'No hay clientes con saldo pendiente de pago' : 'No se encontraron clientes'}
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {filterTab === 'DEBT' ? 'Todos tus clientes registrados están al día en sus cuentas.' : 'Ingresa clientes para llevar el control de sus compras y cartera.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCustomers.map(c => (
            <Card
              key={c.id}
              className={`rounded-2xl overflow-hidden hover:shadow-md transition-all ${
                c.totalDebt > 0
                  ? 'border border-red-500/30 bg-red-500/5'
                  : 'border border-[var(--border-subtle)] bg-[var(--bg-panel)]'
              }`}
            >
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-sm font-bold text-[var(--text-primary)] truncate">{c.name}</CardTitle>
                    <CardDescription className="text-xs text-[var(--text-muted)] flex items-center gap-1.5 mt-1">
                      <Phone className="h-3 w-3" /> {c.phone}
                    </CardDescription>
                  </div>
                  {c.totalDebt > 0 ? (
                    <Badge className="bg-red-500/10 text-red-500 border border-red-500/20 font-extrabold text-[10px] py-0.5 px-2">
                      Debe: {formatCurrency(c.totalDebt)}
                    </Badge>
                  ) : (
                    <Badge className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-extrabold text-[10px] py-0.5 px-2">
                      Al día
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="flex gap-2">
                  <Button
                    onClick={() => loadCustomerDetail(c.id)}
                    className={`flex-1 text-xs h-9 rounded-xl font-bold cursor-pointer transition-all ${
                      c.totalDebt > 0
                        ? 'bg-red-500 hover:bg-red-600 text-white shadow-sm'
                        : 'bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    {c.totalDebt > 0 ? 'Ver Ficha y Cobrar Abono' : 'Ver Ficha y Cartera'}
                  </Button>
                  <Button
                    onClick={() => handleOpenEdit(c)}
                    size="icon"
                    className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] h-9 w-9 rounded-xl cursor-pointer"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    onClick={() => handleDeleteCustomer(c.id)}
                    size="icon"
                    className="bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/25 h-9 w-9 rounded-xl cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* DIALOG CREAR/EDITAR CLIENTE */}
      <Dialog open={isCreateOpen} onOpenChange={(open) => {
        setIsCreateOpen(open)
        if (!open) {
          setIsEditMode(false)
          setEditCustomerId('')
          setNewName('')
          setNewPhone('')
        }
      }}>
        <DialogContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-[var(--text-primary)] uppercase">
              {isEditMode ? 'Editar Cliente' : 'Registrar Nuevo Cliente'}
            </DialogTitle>
            <DialogDescription className="text-xs text-[var(--text-secondary)]">
              {isEditMode ? 'Modifica los datos del cliente registrado.' : 'Los clientes registrados podrán recibir ventas a crédito.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateCustomer} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-[var(--text-secondary)]">Nombre del Cliente *</Label>
              <Input
                required
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Ej: Jose Perez"
                className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl h-10 text-xs focus:border-[var(--accent)]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-[var(--text-secondary)]">Celular (10 dígitos) *</Label>
              <Input
                required
                value={newPhone}
                onChange={e => setNewPhone(e.target.value)}
                placeholder="Ej: 3001234567"
                maxLength={10}
                className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl h-10 text-xs focus:border-[var(--accent)]"
              />
            </div>
            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setIsCreateOpen(false)
                  setIsEditMode(false)
                  setEditCustomerId('')
                  setNewName('')
                  setNewPhone('')
                }}
                className="rounded-xl text-xs h-10 px-4 hover:bg-[var(--bg-elevated)] cursor-pointer"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={submittingCustomer}
                className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold rounded-xl h-10 px-4 text-xs cursor-pointer"
              >
                {submittingCustomer ? 'Guardando...' : (isEditMode ? 'Guardar Cambios' : 'Registrar Cliente')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DIALOG DETALLE CLIENTE Y CARTERA */}
      <Dialog open={selectedCustomerId !== null} onOpenChange={(open) => { if (!open) { setSelectedCustomerId(null); setCustomerDetail(null); } }}>
        <DialogContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-3xl max-w-3xl overflow-hidden p-0 max-h-[85vh] flex flex-col">
          {loadingDetail || !customerDetail ? (
            <div className="flex flex-col items-center justify-center p-20 gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" />
              <p className="text-xs text-[var(--text-secondary)]">Cargando detalles de cuenta...</p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* MODAL HEADER */}
              <div className="p-6 border-b border-[var(--border-subtle)] bg-[var(--bg-panel)]">
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                  <div>
                    <h3 className="text-base font-bold text-[var(--text-primary)] uppercase flex items-center gap-2">
                      <User className="h-5 w-5 text-[var(--accent)]" /> {customerDetail.name}
                    </h3>
                    <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-[var(--text-secondary)]">
                      <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {customerDetail.phone}</span>
                      {customerDetail.address && (
                        <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {customerDetail.address}</span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 flex items-center gap-3.5 shrink-0">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10 border border-red-500/20 text-red-500">
                      <Wallet className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wide">Deuda Pendiente</p>
                      <p className="text-lg font-black text-red-500 leading-none mt-1">{formatCurrency(customerDetail.totalDebt)}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* TABS CONTAINER */}
              <div className="flex-1 overflow-hidden flex flex-col">
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="px-6 border-b border-[var(--border-subtle)]/50 bg-[var(--bg-panel)]/50 shrink-0">
                    <div className="flex gap-4">
                      {(['abono', 'pedidos', 'abonos'] as const).map(tab => (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setActiveTab(tab)}
                          className={`rounded-none border-b-2 px-1 py-3 text-xs font-bold transition-colors cursor-pointer ${
                            activeTab === tab
                              ? 'border-[var(--accent)] text-[var(--accent)]'
                              : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          {tab === 'abono' && 'Registrar Abono'}
                          {tab === 'pedidos' && `Historial Pedidos (${customerDetail.orders.length})`}
                          {tab === 'abonos' && `Historial Abonos (${customerDetail.payments.length})`}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6 min-h-0">
                    {/* TAB REGISTRAR ABONO */}
                    {activeTab === 'abono' && (
                      <div className="space-y-4">
                      <Card className="border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40 p-4 rounded-2xl">
                        <CardTitle className="text-xs font-bold text-[var(--text-primary)] uppercase mb-3">Nuevo Abono a la Cartera</CardTitle>
                        
                        {abonoError && (
                          <div className="flex items-center gap-2 rounded-xl border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 p-2.5 text-xs text-[var(--destructive)] mb-3">
                            <AlertTriangle className="h-4 w-4 shrink-0" />
                            <span>{abonoError}</span>
                          </div>
                        )}

                        {customerDetail.totalDebt === 0 ? (
                          <div className="py-8 text-center text-xs text-[var(--text-muted)]">
                            El cliente se encuentra al día. No es necesario registrar abonos.
                          </div>
                        ) : (
                          <form onSubmit={handleRegisterAbono} className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-1">
                                <Label className="text-xs font-semibold text-[var(--text-secondary)]">Monto del Abono *</Label>
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--text-muted)]">$</span>
                                  <Input
                                    required
                                    type="number"
                                    min={500}
                                    step={100}
                                    value={abonoAmount}
                                    onChange={e => setAbonoAmount(e.target.value)}
                                    placeholder="Ej: 15000"
                                    className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl h-10 pl-7 text-xs focus:border-[var(--accent)] font-bold text-[var(--text-primary)]"
                                  />
                                </div>
                              </div>

                              <div className="space-y-1">
                                <Label className="text-xs font-semibold text-[var(--text-secondary)]">Método de Pago</Label>
                                <select
                                  value={abonoMethod}
                                  onChange={e => setAbonoMethod(e.target.value)}
                                  className="w-full bg-[var(--bg-input)] border border-[var(--border-default)] rounded-xl h-10 px-3 text-xs text-[var(--text-primary)] focus:border-[var(--accent)] font-semibold"
                                >
                                  <option value="CASH">Efectivo</option>
                                  <option value="TRANSFER">Transferencia</option>
                                </select>
                              </div>
                            </div>

                            {abonoMethod === 'TRANSFER' && (
                              <div className="space-y-1">
                                <Label className="text-xs font-semibold text-[var(--text-secondary)]">Referencia de Transferencia</Label>
                                <Input
                                  value={abonoReference}
                                  onChange={e => setAbonoReference(e.target.value)}
                                  placeholder="Ej: Nro de Comprobante / Transacción"
                                  className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl h-10 text-xs focus:border-[var(--accent)]"
                                />
                              </div>
                            )}

                            <div className="space-y-1">
                              <Label className="text-xs font-semibold text-[var(--text-secondary)]">Notas / Observaciones</Label>
                              <Input
                                value={abonoNotes}
                                onChange={e => setAbonoNotes(e.target.value)}
                                placeholder="Ej: Abono parcial de la semana"
                                className="bg-[var(--bg-input)] border-[var(--border-default)] rounded-xl h-10 text-xs focus:border-[var(--accent)]"
                              />
                            </div>

                            <Button
                              type="submit"
                              disabled={submittingAbono}
                              className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold rounded-xl h-10 text-xs uppercase tracking-wider cursor-pointer"
                            >
                              {submittingAbono ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                              {submittingAbono ? 'Procesando Abono...' : 'Confirmar y Registrar Abono'}
                            </Button>
                          </form>
                        )}
                      </Card>
                      </div>
                    )}

                    {/* TAB HISTORIAL PEDIDOS */}
                    {activeTab === 'pedidos' && (
                      customerDetail.orders.length === 0 ? (
                        <div className="text-center py-10 text-xs text-[var(--text-muted)]">
                          El cliente no tiene pedidos registrados en el sistema.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {customerDetail.orders.map(order => {
                            const isCredit = order.paymentMethod === 'CREDIT'
                            const isCourtesy = order.paymentMethod === 'CORTESIA'

                            return (
                              <div
                                key={order.id}
                                className="flex flex-col p-3.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)]/50 text-xs space-y-2"
                              >
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="font-bold text-[var(--text-primary)] text-sm">Pedido #{order.orderNumber}</p>
                                    <p className="text-[10px] text-[var(--text-muted)] flex items-center gap-1 mt-0.5">
                                      <Calendar className="h-3 w-3" /> {new Date(order.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <div className="text-right">
                                      <p className="font-extrabold text-[var(--text-primary)] text-sm">{formatCurrency(order.total)}</p>
                                      <span className="text-[9px] font-bold text-[var(--text-secondary)] block">
                                        {isCourtesy ? 'Cortesía' : isCredit ? 'Venta a Crédito' : order.paymentMethod}
                                      </span>
                                    </div>
                                    <div>
                                      {isCourtesy ? (
                                        <Badge className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-extrabold text-[10px] py-0.5 px-2">Cortesía</Badge>
                                      ) : isCredit ? (
                                        customerDetail.totalDebt > 0 ? (
                                          <Badge className="bg-red-500/10 text-red-500 border border-red-500/20 font-extrabold text-[10px] py-0.5 px-2">Pendiente por Pagar</Badge>
                                        ) : (
                                          <Badge className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-extrabold text-[10px] py-0.5 px-2">Liquidado</Badge>
                                        )
                                      ) : (
                                        <Badge className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-extrabold text-[10px] py-0.5 px-2">Pagado</Badge>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Detailed Items Preview */}
                                {(order as any).items && (order as any).items.length > 0 && (
                                  <div className="pt-2 border-t border-[var(--border-subtle)]/50 space-y-1 bg-[var(--bg-elevated)]/40 p-2.5 rounded-xl">
                                    <p className="text-[9px] font-extrabold text-[var(--text-muted)] uppercase tracking-wider mb-1">Productos del pedido:</p>
                                    {(order as any).items.map((item: any, idx: number) => (
                                      <div key={idx} className="flex items-center justify-between text-[11px] text-[var(--text-primary)]">
                                        <span className="font-semibold">{item.quantity}x {item.menuItem?.name || item.name || 'Producto'}</span>
                                        <span className="font-bold text-[var(--text-secondary)]">{formatCurrency((item.unitPrice || item.price || 0) * item.quantity)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )
                    )}

                    {/* TAB HISTORIAL ABONOS */}
                    {activeTab === 'abonos' && (
                      customerDetail.payments.length === 0 ? (
                        <div className="text-center py-10 text-xs text-[var(--text-muted)]">
                          No se han registrado abonos para este cliente todavía.
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          {customerDetail.payments.map(pay => (
                            <div
                              key={pay.id}
                              className="flex items-start justify-between p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)]/50 text-xs"
                            >
                              <div>
                                <p className="font-extrabold text-emerald-500">+{formatCurrency(pay.amount)}</p>
                                <p className="text-[10px] text-[var(--text-muted)] flex items-center gap-1 mt-1.5">
                                  <Calendar className="h-3 w-3" /> {new Date(pay.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </p>
                                {pay.notes && (
                                  <p className="text-[10px] text-[var(--text-secondary)] italic mt-1 font-medium bg-[var(--bg-input)]/45 p-1 px-1.5 rounded-lg border border-[var(--border-subtle)]/40 w-fit">
                                    Obs: {pay.notes}
                                  </p>
                                )}
                              </div>
                              <div className="text-right">
                                <Badge className="bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20 font-bold text-[9px] py-0.5 px-2">
                                  {pay.method === 'CASH' ? 'Efectivo' : 'Transferencia'}
                                </Badge>
                                {pay.reference && (
                                  <p className="text-[9px] text-[var(--text-muted)] mt-1 font-semibold">Ref: {pay.reference}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    )}
                  </div>
                </div>
              </div>

              {/* MODAL FOOTER */}
              <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-panel)] shrink-0 flex justify-end">
                <Button
                  onClick={() => { setSelectedCustomerId(null); setCustomerDetail(null); }}
                  className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] text-xs h-10 px-6 rounded-xl font-bold cursor-pointer"
                >
                  Cerrar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
