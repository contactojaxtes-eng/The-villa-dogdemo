import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { formatCurrency, formatDateShort, cn, getLocalDateString } from '@/lib/utils'
import { alerts } from '@/lib/alerts'
import {
  Plus, Receipt, Trash2, Filter, DollarSign, BarChart3, Calendar,
  Loader2, Wallet, Building2
} from 'lucide-react'

interface Expense { id: string; description: string; amount: number; date: string; category: { name: string }; user: { name: string } }
interface Category { id: string; name: string }
interface Ingredient { id: string; name: string; unit: string }

const fadeUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] as const } } }
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.07 } } }

// Brand manual colors: Musgo de Lima (#90BF50) and coordinated forest/sage shades
const catPalette = ['#90BF50', '#7EA743', '#6B8E3B', '#587532', '#A4C96C', '#B9D68A', '#788070', '#A4ACA0']

function parseDescription(desc: string) {
  const parts = desc.split('|').map(p => p.trim())
  return {
    nombre: parts[0] || desc,
    descripcion: parts[1] || '',
    sede: parts[2] || 'Principal',
  }
}

function todayStr() { return getLocalDateString() }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return getLocalDateString(d) }
function monthStart() { const d = new Date(); d.setDate(1); return getLocalDateString(d) }

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [summary, setSummary] = useState<{ total: number; totalItems: number; byCategory: { name: string; total: number; count: number }[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [catFilter, setCatFilter] = useState('all')

  const [preset, setPreset] = useState<'today' | 'month' | 'all' | 'custom'>('month')
  const [startDate, setStartDate] = useState(monthStart())
  const [endDate, setEndDate] = useState(todayStr())
  const [selectedMonth, setSelectedMonth] = useState(String(new Date().getMonth() + 1).padStart(2, '0'))
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString())

  const handleMonthYearChange = (month: string, year: string) => {
    setSelectedMonth(month)
    setSelectedYear(year)
    if (!month) {
      setStartDate(`${year}-01-01`)
      setEndDate(`${year}-12-31`)
    } else {
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate()
      setStartDate(`${year}-${month}-01`)
      setEndDate(`${year}-${month}-${String(lastDay).padStart(2, '0')}`)
    }
    setPreset('custom')
  }

  const handleSelectRange = (p: 'today' | 'month' | 'all' | 'custom') => {
    setPreset(p)
    const currentYear = new Date().getFullYear().toString()
    const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0')
    switch (p) {
      case 'today':
        setStartDate(todayStr())
        setEndDate(todayStr())
        setSelectedMonth(currentMonth)
        setSelectedYear(currentYear)
        break
      case 'month':
        setStartDate(monthStart())
        setEndDate(todayStr())
        setSelectedMonth(currentMonth)
        setSelectedYear(currentYear)
        break
      case 'all':
        setStartDate('')
        setEndDate('')
        setSelectedMonth('')
        setSelectedYear(currentYear)
        break
      case 'custom':
        break
    }
  }

  // Form state
  const [open, setOpen] = useState(false)
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [amount, setAmount] = useState('')
  const [catId, setCatId] = useState('')
  const [sede, setSede] = useState('Principal')
  const [saving, setSaving] = useState(false)

  // Linking to inventory state
  const [linkToInventory, setLinkToInventory] = useState(false)
  const [ingredientId, setIngredientId] = useState('')
  const [quantity, setQuantity] = useState('')

  const loadData = () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (catFilter && catFilter !== 'all') params.set('categoryId', catFilter)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)

    const summaryParams = new URLSearchParams()
    if (startDate) summaryParams.set('startDate', startDate)
    if (endDate) summaryParams.set('endDate', endDate)

    Promise.all([
      api.get<Expense[]>(`/expenses?${params}`),
      api.get<Category[]>('/expenses/categories'),
      api.get<{ total: number; totalItems: number; byCategory: { name: string; total: number; count: number }[] }>(`/expenses/summary?${summaryParams}`),
      api.get<Ingredient[]>('/inventory/ingredients'),
    ]).then(([e, c, s, ings]) => {
      setExpenses(e)
      setCategories(c)
      setSummary(s)
      setIngredients(ings)
    }).catch(console.error).finally(() => setLoading(false))
  }

  useEffect(() => { loadData() }, [catFilter, startDate, endDate])

  const createExpense = async () => {
    if (!nombre || !amount || !catId) return
    setSaving(true)
    try {
      const fullDesc = descripcion
        ? `${nombre} | ${descripcion} | ${sede}`
        : `${nombre} | - | ${sede}`
      
      const payload: any = {
        description: fullDesc,
        amount: parseFloat(amount),
        categoryId: catId,
      }

      if (linkToInventory && ingredientId && quantity) {
        payload.ingredientId = ingredientId
        payload.quantity = parseFloat(quantity)
      }

      await api.post('/expenses', payload)
      setOpen(false); setNombre(''); setDescripcion(''); setAmount(''); setCatId(''); setSede('Principal')
      setLinkToInventory(false); setIngredientId(''); setQuantity('')
      loadData()
    } finally { setSaving(false) }
  }

  const deleteExpense = async (id: string) => {
    const ok = await alerts.confirm(
      '¿Eliminar Gasto?',
      '¿Estás seguro de que deseas eliminar este registro de gasto?',
      'Sí, eliminar',
      'Cancelar'
    )
    if (!ok) return
    try {
      await api.delete(`/expenses/${id}`)
      alerts.success('Gasto eliminado', 'El gasto ha sido eliminado correctamente.')
      loadData()
    } catch (err: any) {
      alerts.error('Error', err.message || 'No se pudo eliminar el gasto.')
    }
  }

  const dailyAvg = useMemo(() => {
    if (!summary || summary.totalItems === 0) return 0
    return summary.total / 30
  }, [summary])

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-40 gap-4">
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}>
        <div className="h-12 w-12 rounded-full border-[3px] border-[var(--accent)] border-t-transparent shadow-lg shadow-[var(--accent)]/20" />
      </motion.div>
      <p className="text-sm text-[var(--text-muted)] animate-pulse">Cargando gastos...</p>
    </div>
  )

  return (
    <motion.div className="space-y-7" initial="hidden" animate="visible" variants={stagger}>

      {/* ── Header ── */}
      <motion.div className="flex flex-wrap items-center justify-between gap-4" variants={fadeUp}>
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl shadow-lg shadow-[var(--accent)]/10" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))' }}>
              <Receipt className="h-5 w-5 text-[var(--accent-fg)]" />
            </div>
            <div>
              <h2 className="antifont text-4xl tracking-wider text-[var(--text-primary)] leading-none">GASTOS</h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">Control de egresos, compras e insumos del restaurante.</p>
            </div>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <Button className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold shadow-lg shadow-[var(--accent)]/15 rounded-xl h-11 px-5 gap-2">
                <Plus className="h-4 w-4" /> Nuevo Gasto
              </Button>
            </motion.div>
          </DialogTrigger>
          <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl shadow-2xl p-0 max-w-md overflow-hidden">
            <div className="h-1.5 w-full" style={{ background: 'linear-gradient(90deg, var(--accent), var(--accent-hover))' }} />
            <div className="p-6">
              <DialogHeader className="pb-4">
                <DialogTitle className="text-[var(--text-primary)] text-xl font-bold flex items-center gap-2">
                  <Receipt className="h-5 w-5 text-[var(--accent)]" />
                  Registrar Gasto
                </DialogTitle>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Registra los egresos del restaurante</p>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Nombre del Gasto *</Label>
                  <Input
                    value={nombre}
                    onChange={e => setNombre(e.target.value)}
                    placeholder="Ej: Compra de queso mozzarella"
                    className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 focus:border-[var(--accent)]/50 focus:ring-1 focus:ring-[var(--accent)]/30 transition-all font-semibold text-[var(--text-primary)]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Monto ($) *</Label>
                    <CurrencyInput
                      value={amount}
                      onChange={v => setAmount(v)}
                      placeholder="0"
                      prefixSymbol={true}
                      className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 font-bold focus:border-[var(--accent)]/50 focus:ring-1 focus:ring-[var(--accent)]/30 transition-all text-[var(--text-primary)]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Categoría *</Label>
                    <Select value={catId} onValueChange={setCatId}>
                      <SelectTrigger className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 focus:border-[var(--accent)]/50 focus:ring-1 focus:ring-[var(--accent)]/30 transition-all text-[var(--text-primary)]">
                        <SelectValue placeholder="Seleccionar…" />
                      </SelectTrigger>
                      <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-2xl">
                        {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Detalles / Concepto</Label>
                  <Input
                    value={descripcion}
                    onChange={e => setDescripcion(e.target.value)}
                    placeholder="Ej: 5 kilos para la semana"
                    className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 focus:border-[var(--accent)]/50 focus:ring-1 focus:ring-[var(--accent)]/30 transition-all font-semibold text-[var(--text-primary)]"
                  />
                </div>
                <div className="space-y-3 p-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/40">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={linkToInventory}
                      onChange={e => setLinkToInventory(e.target.checked)}
                      className="rounded border-[var(--border-default)] text-[var(--accent)] focus:ring-[var(--accent)]/30"
                    />
                    <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Vincular a Inventario</span>
                  </label>

                  {linkToInventory && (
                    <div className="grid grid-cols-2 gap-3 pt-1.5">
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Insumo / Ingrediente *</Label>
                        <Select value={ingredientId} onValueChange={setIngredientId}>
                          <SelectTrigger className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-10 text-xs">
                            <SelectValue placeholder="Seleccionar…" />
                          </SelectTrigger>
                          <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-2xl">
                            {ingredients.map(i => (
                              <SelectItem key={i.id} value={i.id} className="text-xs">{i.name} ({i.unit})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Cantidad Comprada *</Label>
                        <Input
                          type="number"
                          value={quantity}
                          onChange={e => setQuantity(e.target.value)}
                          placeholder="Cantidad"
                          className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-10 font-bold focus:border-[var(--accent)]/50 focus:ring-1 focus:ring-[var(--accent)]/30 transition-all text-xs text-[var(--text-primary)]"
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Sede</Label>
                  <Select value={sede} onValueChange={setSede}>
                    <SelectTrigger className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 focus:border-[var(--accent)]/50 focus:ring-1 focus:ring-[var(--accent)]/30 transition-all text-[var(--text-primary)]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-2xl">
                      <SelectItem value="Principal">Sede Principal</SelectItem>
                      <SelectItem value="Domicilios">Domicilios</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold h-12 rounded-xl shadow-lg shadow-[var(--accent)]/15 transition-all text-sm gap-2"
                  onClick={createExpense}
                  disabled={saving || !nombre || !amount || !catId || (linkToInventory && (!ingredientId || !quantity))}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {saving ? 'Registrando…' : 'Registrar Gasto'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </motion.div>

      {/* ── Filtro de Fechas ── */}
      <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Período:</span>
          <div className="flex flex-wrap gap-1">
            {[
              { id: 'today', label: 'Hoy' },
              { id: 'month', label: 'Este mes' },
              { id: 'all', label: 'Todo' },
              { id: 'custom', label: 'Personalizado' },
            ].map(opt => (
              <Button
                key={opt.id}
                variant={preset === opt.id ? 'default' : 'ghost'}
                className={cn(
                  "h-8 px-3 rounded-lg text-xs font-bold transition-all",
                  preset === opt.id 
                    ? "bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)]" 
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                )}
                onClick={() => handleSelectRange(opt.id as any)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Selector de Año */}
          <select
            value={selectedYear}
            onChange={e => handleMonthYearChange(selectedMonth, e.target.value)}
            className="h-8 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)] px-2 text-xs font-bold text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--accent)] cursor-pointer"
          >
            <option value="2026">Año: 2026</option>
            <option value="2025">Año: 2025</option>
            <option value="2024">Año: 2024</option>
          </select>

          {/* Selector de Mes */}
          <select
            value={selectedMonth}
            onChange={e => handleMonthYearChange(e.target.value, selectedYear)}
            className="h-8 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)] px-2 text-xs font-bold text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--accent)] cursor-pointer"
          >
            <option value="">Todo el año</option>
            <option value="01">Enero</option>
            <option value="02">Febrero</option>
            <option value="03">Marzo</option>
            <option value="04">Abril</option>
            <option value="05">Mayo</option>
            <option value="06">Junio</option>
            <option value="07">Julio</option>
            <option value="08">Agosto</option>
            <option value="09">Septiembre</option>
            <option value="10">Octubre</option>
            <option value="11">Noviembre</option>
            <option value="12">Diciembre</option>
          </select>

          {preset === 'custom' && (
            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
              <span className="text-[10px] text-[var(--text-muted)] font-bold ml-1">o Fechas:</span>
              <input
                type="date"
                value={startDate}
                onChange={e => { setStartDate(e.target.value); setPreset('custom'); setSelectedMonth(''); setSelectedYear('') }}
                className="h-8 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)] px-2.5 text-xs font-bold text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--accent)] cursor-pointer"
              />
              <span className="text-xs text-[var(--text-muted)] font-bold">al</span>
              <input
                type="date"
                value={endDate}
                onChange={e => { setEndDate(e.target.value); setPreset('custom'); setSelectedMonth(''); setSelectedYear('') }}
                className="h-8 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)] px-2.5 text-xs font-bold text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--accent)] cursor-pointer"
              />
            </div>
          )}
        </div>
      </motion.div>

      {/* ── KPI Cards ── */}
      {summary && (
        <motion.div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" variants={fadeUp}>
          {[
            {
              label: 'Total Gastos (Mes)', value: formatCurrency(summary.total), icon: DollarSign,
              color: '#90BF50', glowFrom: 'rgba(144,191,80,0.18)', glowTo: 'transparent',
              sub: `${summary.totalItems} registros`
            },
            {
              label: 'Promedio Diario', value: formatCurrency(dailyAvg), icon: BarChart3,
              color: '#7EA743', glowFrom: 'rgba(126,167,67,0.18)', glowTo: 'transparent',
              sub: 'Estimado mensual'
            },
            ...(summary.byCategory.slice(0, 2).map((c, i) => ({
              label: c.name, value: formatCurrency(c.total), icon: i === 0 ? Wallet : Building2,
              color: i === 0 ? '#6B8E3B' : '#587532',
              glowFrom: i === 0 ? 'rgba(107,142,59,0.18)' : 'rgba(88,117,50,0.18)',
              glowTo: 'transparent',
              sub: `${c.count} gastos`
            }))),
          ].map((s) => {
            const Icon = s.icon
            return (
              <motion.div
                key={s.label}
                className="relative overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-5"
                style={{ boxShadow: `0 4px 24px -8px ${s.color}25` }}
                whileHover={{ y: -3, boxShadow: `0 12px 36px -8px ${s.color}35` }}
                transition={{ duration: 0.25 }}
              >
                <div
                  className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full blur-2xl"
                  style={{ background: `radial-gradient(circle, ${s.glowFrom}, ${s.glowTo})` }}
                />
                <div className="pointer-events-none absolute inset-0 opacity-[0.03]"
                  style={{ backgroundImage: `radial-gradient(circle, ${s.color} 1px, transparent 1px)`, backgroundSize: '16px 16px' }}
                />
                <div className="relative flex items-center gap-4">
                  <div
                    className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl shadow-lg"
                    style={{ background: `linear-gradient(135deg, ${s.color}25, ${s.color}10)`, border: `1px solid ${s.color}30` }}
                  >
                    <Icon className="h-6 w-6" style={{ color: s.color }} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">{s.label}</p>
                    <p className="text-2xl font-black text-[var(--text-primary)] tracking-tight mt-0.5 leading-none">{s.value}</p>
                    <p className="text-[11px] text-[var(--text-muted)] mt-1">{s.sub}</p>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </motion.div>
      )}

      {/* ── Filtros por Categoría ── */}
      <motion.div variants={fadeUp} className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap justify-between">
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <Filter className="h-4 w-4 text-[var(--accent)]" />
            <span className="font-bold uppercase tracking-wider text-[11px] text-[var(--text-muted)]">Filtrar por categoría:</span>
          </div>

          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setCatFilter('all')}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-black transition-all cursor-pointer ${catFilter === 'all' ? 'bg-[var(--accent)] text-[var(--accent-fg)] border border-transparent shadow-md' : 'border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--text-primary)] bg-[var(--bg-panel)]'}`}
            >
              Todas ({expenses.length})
            </button>
            {categories.map((c, i) => {
              const color = catPalette[i % catPalette.length]
              const isActive = catFilter === c.id
              return (
                <button
                  key={c.id}
                  onClick={() => setCatFilter(c.id)}
                  className="rounded-xl px-3.5 py-1.5 text-xs font-black transition-all border cursor-pointer"
                  style={isActive
                    ? { backgroundColor: color, color: '#fff', borderColor: color, boxShadow: `0 4px 12px ${color}30` }
                    : { borderColor: `${color}30`, color, backgroundColor: `${color}08` }
                  }
                >
                  {c.name}
                </button>
              )
            })}
          </div>
        </div>

        {/* Tabla de Gastos */}
        <Card className="border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-xl rounded-3xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] text-left text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-subtle)]/50">
                  <th className="px-6 py-4 font-black">Fecha</th>
                  <th className="px-6 py-4 font-black">Nombre del Gasto</th>
                  <th className="px-6 py-4 font-black">Detalles / Concepto</th>
                  <th className="px-6 py-4 font-black">Categoría</th>
                  <th className="px-6 py-4 font-black">Sede</th>
                  <th className="px-6 py-4 font-black">Registró</th>
                  <th className="px-6 py-4 text-right font-black">Monto</th>
                  <th className="px-6 py-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {expenses.map((e) => {
                  const catIdx = categories.findIndex(c => c.name === e.category.name)
                  const color = catPalette[catIdx >= 0 ? catIdx % catPalette.length : 0]
                  const parsed = parseDescription(e.description)

                  return (
                    <tr key={e.id} className="hover:bg-[var(--bg-hover)] transition-colors group">
                      <td className="px-6 py-3.5 text-xs text-[var(--text-secondary)] font-bold whitespace-nowrap">
                        {formatDateShort(e.date)}
                      </td>
                      <td className="px-6 py-3.5 text-sm font-bold text-[var(--text-primary)]">
                        {parsed.nombre}
                      </td>
                      <td className="px-6 py-3.5 text-xs text-[var(--text-secondary)] font-medium max-w-[200px] truncate" title={parsed.descripcion}>
                        {parsed.descripcion || '-'}
                      </td>
                      <td className="px-6 py-3.5">
                        <Badge
                          variant="outline"
                          className="text-[9px] py-0.5 px-2.5 rounded-full font-black uppercase tracking-wider border"
                          style={{ borderColor: `${color}30`, color, backgroundColor: `${color}10` }}
                        >
                          {e.category.name}
                        </Badge>
                      </td>
                      <td className="px-6 py-3.5">
                        <Badge
                          variant="outline"
                          className="text-[9px] py-0.5 px-2.5 rounded-full font-black uppercase tracking-wider border-[var(--accent)]/20 text-[var(--accent)] bg-[var(--accent)]/5"
                        >
                          {parsed.sede}
                        </Badge>
                      </td>
                      <td className="px-6 py-3.5 text-xs text-[var(--text-muted)] font-medium">
                        {e.user.name}
                      </td>
                      <td className="px-6 py-3.5 text-right font-black text-[var(--text-primary)] text-sm whitespace-nowrap">
                        {formatCurrency(e.amount)}
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteExpense(e.id)}
                          className="h-8 w-8 text-[var(--destructive)] hover:bg-[var(--destructive)]/10 rounded-lg md:opacity-0 md:group-hover:opacity-100 transition-all cursor-pointer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}

                {expenses.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-20 bg-[var(--bg-panel)]/50">
                      <Receipt className="h-12 w-12 text-[var(--text-muted)] mb-3 opacity-30 mx-auto" />
                      <p className="text-[var(--text-secondary)] font-bold">No se encontraron gastos</p>
                      <p className="text-xs text-[var(--text-muted)] mt-1">
                        {catFilter !== 'all' ? 'Intenta seleccionando otra categoría' : 'Registra tu primer gasto con el botón de arriba'}
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </motion.div>
    </motion.div>
  )
}
