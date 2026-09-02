import { useEffect, useState, useMemo } from 'react'
import { io } from 'socket.io-client'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { formatDate, formatCurrency } from '@/lib/utils'
import { alerts } from '@/lib/alerts'
import { Textarea } from '@/components/ui/textarea'
import {
  Plus, AlertTriangle, Pencil, Trash2, ArrowUp, ArrowDown, History,
  Package, ChefHat, Warehouse, DollarSign, Loader2, Search, X,
  TrendingDown, ShieldAlert, Layers, UtensilsCrossed, Edit, TrendingUp, Calendar,
  Users, ReceiptText
} from 'lucide-react'

interface Ingredient {
  id: string
  name: string
  code?: string | null
  unit: string
  purchaseUnit?: string | null
  conversionFactor?: number
  stock: number
  minStock: number
  costPerUnit: number
}

interface Movement {
  id: string
  type: string
  quantity: number
  stockBefore: number
  stockAfter: number
  notes: string | null
  createdAt: string
  ingredient: { name: string; unit: string }
  order?: { orderNumber: number } | null
}

interface RecipeItem {
  id: string
  quantity: number
  wastePercentage?: number
  unit?: string | null
  ingredient: {
    id: string
    name: string
    unit: string
    costPerUnit: number
  }
}

export const convertUnit = (quantity: number, fromUnit?: string | null, toUnit?: string | null): number => {
  if (!fromUnit || !toUnit || fromUnit.toLowerCase().trim() === toUnit.toLowerCase().trim()) {
    return quantity
  }
  const from = fromUnit.toLowerCase().trim()
  const to = toUnit.toLowerCase().trim()

  if (from === 'kg' && to === 'g') return quantity * 1000
  if (from === 'g' && to === 'kg') return quantity / 1000
  if (from === 'l' && to === 'ml') return quantity * 1000
  if (from === 'ml' && to === 'l') return quantity / 1000

  return quantity
}

interface MenuItem {
  id: string
  name: string
  price: number
  description?: string | null
  categoryId: string
  recipe?: {
    id: string
    items: RecipeItem[]
  } | null
}

interface MenuCategory {
  id: string
  name: string
  count?: number
}

interface Supplier {
  id: string
  name: string
  nit: string | null
  phone: string | null
  address: string | null
}

interface PurchaseItem {
  id: string
  quantity: number
  unitCost: number
  totalCost: number
  ingredient: { name: string; unit: string }
}

interface Purchase {
  id: string
  invoiceNumber: string
  purchaseDate: string
  total: number
  notes: string | null
  supplier: { name: string }
  items: PurchaseItem[]
}

type Tab = 'ingredients' | 'purchases' | 'suppliers' | 'movements'

const emptyIng = { name: '', code: '', unit: 'unidad', purchaseUnit: '', conversionFactor: '1', stock: '0', minStock: '5', costPerUnit: '0' }
const emptyProduct = { name: '', price: '', description: '', categoryId: '' }
const emptySupplier = { name: '', nit: '', phone: '', address: '' }

const fadeUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] as const } } }
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.07 } } }

export default function InventoryPage() {
  const [tab, setTab] = useState<Tab>('ingredients')
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [lowStock, setLowStock] = useState<Ingredient[]>([])
  const [movements, setMovements] = useState<Movement[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [recipeCategoryFilter, setRecipeCategoryFilter] = useState<string>('ALL')
  const [loading, setLoading] = useState(true)



  // Ingredients dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyIng)

  // Recipe dialog state
  const [recipeDialog, setRecipeDialog] = useState(false)
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null)
  const [recipeItems, setRecipeItems] = useState<{ ingredientId: string; quantity: number; wastePercentage?: number; unit?: string }[]>([])

  // Adjust stock dialog state
  const [adjustDialog, setAdjustDialog] = useState<Ingredient | null>(null)
  const [adjustQty, setAdjustQty] = useState('1')
  const [adjustType, setAdjustType] = useState<'IN' | 'OUT'>('IN')

  // Product CRUD dialog state
  const [productDialogOpen, setProductDialogOpen] = useState(false)
  const [editProductItem, setEditProductItem] = useState<MenuItem | null>(null)
  const [productForm, setProductForm] = useState(emptyProduct)
  const [savingProduct, setSavingProduct] = useState(false)

  // Suppliers & Purchases state
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false)
  const [editSupplierId, setEditSupplierId] = useState<string | null>(null)
  const [supplierForm, setSupplierForm] = useState(emptySupplier)
  const [savingSupplier, setSavingSupplier] = useState(false)

  const [purchaseDialogOpen, setPurchaseDialogOpen] = useState(false)
  const [purchaseForm, setPurchaseForm] = useState({
    supplierId: '',
    invoiceNumber: '',
    purchaseDate: new Date().toISOString().split('T')[0],
    notes: '',
    items: [{ ingredientId: '', quantity: '1', unitCost: '0' }]
  })
  const [savingPurchase, setSavingPurchase] = useState(false)

  const [search, setSearch] = useState('')

  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [ings, low, cats, movs, sups, purs] = await Promise.all([
        api.get<Ingredient[]>('/inventory/ingredients'),
        api.get<Ingredient[]>('/inventory/ingredients/low-stock'),
        api.get<(MenuCategory & { items: MenuItem[] })[]>('/menu/categories'),
        api.get<Movement[]>('/inventory/movements?limit=40'),
        api.get<Supplier[]>('/inventory/suppliers').catch(() => []),
        api.get<Purchase[]>('/inventory/purchases').catch(() => []),
      ])
      setIngredients(ings)
      setLowStock(low)
      setCategories(cats.map(c => ({ id: c.id, name: c.name, count: c.items?.length || 0 })))
      setMenuItems(cats.flatMap(c => c.items))
      setMovements(movs)
      setSuppliers(sups)
      setPurchases(purs)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      transports: ['websocket', 'polling'],
    })

    socket.on('inventoryChanged', () => {
      load(true)
    })

    socket.on('menuUpdated', () => {
      load(true)
    })

    return () => {
      socket.disconnect()
    }
  }, [])

  // Supplier handlers
  const openCreateSupplier = () => { setEditSupplierId(null); setSupplierForm(emptySupplier); setSupplierDialogOpen(true) }
  const openEditSupplier = (sup: Supplier) => {
    setEditSupplierId(sup.id)
    setSupplierForm({ name: sup.name, nit: sup.nit || '', phone: sup.phone || '', address: sup.address || '' })
    setSupplierDialogOpen(true)
  }

  const saveSupplier = async () => {
    if (!supplierForm.name) return
    setSavingSupplier(true)
    try {
      if (editSupplierId) await api.put(`/inventory/suppliers/${editSupplierId}`, supplierForm)
      else await api.post('/inventory/suppliers', supplierForm)
      setSupplierDialogOpen(false)
      load()
    } finally {
      setSavingSupplier(false)
    }
  }

  const deleteSupplier = async (id: string) => {
    const ok = await alerts.confirm(
      '¿Eliminar Proveedor?',
      '¿Estás seguro de que deseas eliminar este proveedor?',
      'Sí, eliminar',
      'Cancelar'
    )
    if (!ok) return
    try {
      await api.delete(`/inventory/suppliers/${id}`)
      alerts.success('Proveedor eliminado', 'El proveedor ha sido eliminado correctamente.')
      load()
    } catch (err: any) {
      alerts.error('Error', err.message || 'No se pudo eliminar el proveedor.')
    }
  }

  // Purchase handlers
  const openCreatePurchase = () => {
    setPurchaseForm({
      supplierId: suppliers[0]?.id || '',
      invoiceNumber: '',
      purchaseDate: new Date().toISOString().split('T')[0],
      notes: '',
      items: [{ ingredientId: ingredients[0]?.id || '', quantity: '1', unitCost: '0' }]
    })
    setPurchaseDialogOpen(true)
  }

  const handleAddPurchaseItem = () => {
    setPurchaseForm(p => ({
      ...p,
      items: [...p.items, { ingredientId: ingredients[0]?.id || '', quantity: '1', unitCost: '0' }]
    }))
  }

  const handleRemovePurchaseItem = (index: number) => {
    if (purchaseForm.items.length === 1) return
    setPurchaseForm(p => ({
      ...p,
      items: p.items.filter((_, i) => i !== index)
    }))
  }

  const handleUpdatePurchaseItem = (index: number, key: string, value: string) => {
    setPurchaseForm(p => {
      const items = [...p.items]
      items[index] = { ...items[index], [key]: value }
      return { ...p, items }
    })
  }

  const savePurchase = async () => {
    if (!purchaseForm.supplierId || !purchaseForm.invoiceNumber) {
      alert('Por favor ingresa el proveedor y el número de factura')
      return
    }
    const invalidItem = purchaseForm.items.find(i => !i.ingredientId || parseFloat(i.quantity) <= 0 || parseFloat(i.unitCost) < 0)
    if (invalidItem) {
      alert('Todos los ítems deben tener un ingrediente, cantidad mayor a 0 y costo mayor o igual a 0')
      return
    }

    setSavingPurchase(true)
    try {
      const payload = {
        supplierId: purchaseForm.supplierId,
        invoiceNumber: purchaseForm.invoiceNumber,
        purchaseDate: purchaseForm.purchaseDate,
        notes: purchaseForm.notes || null,
        items: purchaseForm.items.map(item => ({
          ingredientId: item.ingredientId,
          quantity: parseFloat(item.quantity),
          unitCost: parseFloat(item.unitCost)
        }))
      }
      await api.post('/inventory/purchases', payload)
      setPurchaseDialogOpen(false)
      load()
    } catch (err: any) {
      alert(err.message || 'Error al registrar la compra')
    } finally {
      setSavingPurchase(false)
    }
  }

  useEffect(() => { load() }, [])

  const stats = useMemo(() => {
    const totalValue = ingredients.reduce((s, i) => s + (i.stock * i.costPerUnit), 0)
    const lowCount = lowStock.length
    const totalIngredients = ingredients.length
    return { totalValue, lowCount, totalIngredients }
  }, [ingredients, lowStock])

  const filteredIngredients = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return ingredients
    return ingredients.filter(i => 
      i.name.toLowerCase().includes(q) || 
      (i.code && i.code.toLowerCase().includes(q))
    )
  }, [ingredients, search])

  const filteredMenuItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    let items = menuItems
    if (recipeCategoryFilter !== 'ALL') {
      items = items.filter(i => i.categoryId === recipeCategoryFilter)
    }
    if (!q) return items
    return items.filter(i => i.name.toLowerCase().includes(q))
  }, [menuItems, search, recipeCategoryFilter])
  // Helpers for ingredients
  const openCreate = () => {
    setEditId(null)
    setForm({ name: '', code: '', unit: 'g', purchaseUnit: '', conversionFactor: '1', stock: '0', minStock: '0', costPerUnit: '0' })
    setDialogOpen(true)
  }
  const openEdit = (i: Ingredient) => {
    setEditId(i.id)
    setForm({
      name: i.name,
      code: i.code || '',
      unit: i.unit,
      purchaseUnit: i.purchaseUnit || '',
      conversionFactor: String(i.conversionFactor || 1),
      stock: String(i.stock),
      minStock: String(i.minStock),
      costPerUnit: String(i.costPerUnit),
    })
    setDialogOpen(true)
  }
  const handleSave = async () => {
    if (!form.name || !form.code || !form.unit || !form.stock || !form.minStock || !form.costPerUnit) return
    const data = {
      name: form.name,
      code: form.code.trim().toUpperCase(),
      unit: form.unit,
      purchaseUnit: form.purchaseUnit || null,
      conversionFactor: parseFloat(form.conversionFactor) || 1,
      stock: parseFloat(form.stock),
      minStock: parseFloat(form.minStock),
      costPerUnit: parseFloat(form.costPerUnit),
    }
    if (editId) await api.put(`/inventory/ingredients/${editId}`, data)
    else await api.post('/inventory/ingredients', data)
    setDialogOpen(false)
    load()
  }
  const deleteIngredient = async (id: string) => {
    const ok = await alerts.confirm(
      '¿Eliminar Ingrediente?',
      '¿Estás seguro de que deseas eliminar este ingrediente del inventario?',
      'Sí, eliminar',
      'Cancelar'
    )
    if (!ok) return
    try {
      await api.delete(`/inventory/ingredients/${id}`)
      alerts.success('Ingrediente eliminado', 'El ingrediente ha sido retirado.')
      load()
    } catch (err: any) {
      alerts.error('Error', err.message || 'No se pudo eliminar el ingrediente.')
    }
  }

  const doAdjust = async () => {
    if (!adjustDialog) return
    await api.post(`/inventory/ingredients/${adjustDialog.id}/adjust`, {
      quantity: parseFloat(adjustQty),
      type: adjustType,
    })
    setAdjustDialog(null)
    load()
  }

  // Helpers for Recipes
  const openRecipe = async (item: MenuItem) => {
    setSelectedItem(item)
    const recipe = await api.get<{ items: { ingredientId: string; quantity: number; wastePercentage?: number; unit?: string | null }[] } | null>(`/inventory/recipes/${item.id}`).catch(() => null)
    setRecipeItems(recipe?.items?.length ? recipe.items.map(ri => {
      const ing = ingredients.find(i => i.id === ri.ingredientId)
      return { 
        ingredientId: ri.ingredientId, 
        quantity: ri.quantity, 
        wastePercentage: ri.wastePercentage || 0,
        unit: ri.unit || ing?.unit || 'unidad'
      }
    }) : [{ ingredientId: ingredients[0]?.id || '', quantity: 1, wastePercentage: 0, unit: ingredients[0]?.unit || 'unidad' }])
    setRecipeDialog(true)
  }

  const saveRecipe = async () => {
    if (!selectedItem) return
    await api.post(`/inventory/recipes/${selectedItem.id}`, {
      items: recipeItems.filter(r => r.ingredientId).map(r => ({
        ingredientId: r.ingredientId,
        quantity: r.quantity,
        wastePercentage: r.wastePercentage || 0,
        unit: r.unit
      }))
    })
    setRecipeDialog(false)
    load()
  }

  // Recipe Cost / Profit Calculations
  const getMenuItemStats = (item: MenuItem) => {
    const cost = item.recipe?.items?.reduce((sum, ri) => {
      const ing = ri.ingredient ?? ingredients.find(i => i.id === ri.ingredient?.id)
      const costPerUnit = ing?.costPerUnit ?? 0
      const convertedQty = convertUnit(ri.quantity, ri.unit || ing?.unit || 'unidad', ing?.unit || 'unidad')
      const wasteFactor = 1 - (ri.wastePercentage || 0) / 100
      const grossQuantity = convertedQty / (wasteFactor > 0 ? wasteFactor : 1)
      return sum + (grossQuantity * costPerUnit)
    }, 0) || 0

    const profit = item.price - cost
    const margin = item.price > 0 ? (profit / item.price) * 100 : 0
    return { cost, profit, margin }
  }

  // Real-time stats within the Recipe Dialog
  const recipeStats = useMemo(() => {
    if (!selectedItem) return { cost: 0, profit: 0, margin: 0 }
    const cost = recipeItems.reduce((sum, ri) => {
      const ing = ingredients.find(i => i.id === ri.ingredientId)
      const convertedQty = convertUnit(ri.quantity, ri.unit || ing?.unit || 'unidad', ing?.unit || 'unidad')
      const wasteFactor = 1 - (ri.wastePercentage || 0) / 100
      const grossQuantity = convertedQty / (wasteFactor > 0 ? wasteFactor : 1)
      return sum + (grossQuantity * (ing?.costPerUnit || 0))
    }, 0)
    const price = selectedItem.price
    const profit = price - cost
    const margin = price > 0 ? (profit / price) * 100 : 0
    return { cost, profit, margin }
  }, [recipeItems, selectedItem, ingredients])

  // Helpers for Products CRUD
  const openCreateProduct = () => {
    setEditProductItem(null)
    setProductForm({
      name: '',
      price: '',
      description: '',
      categoryId: categories[0]?.id || '',
    })
    setProductDialogOpen(true)
  }

  const openEditProduct = (item: MenuItem) => {
    setEditProductItem(item)
    setProductForm({
      name: item.name,
      price: String(item.price),
      description: item.description || '',
      categoryId: item.categoryId,
    })
    setProductDialogOpen(true)
  }

  const saveProduct = async () => {
    if (!productForm.name || !productForm.price || !productForm.categoryId) return
    setSavingProduct(true)
    try {
      const payload = {
        name: productForm.name,
        price: parseFloat(productForm.price),
        description: productForm.description || null,
        categoryId: productForm.categoryId,
      }

      if (editProductItem) {
        await api.put(`/menu/items/${editProductItem.id}`, payload)
        setProductDialogOpen(false)
        load()
      } else {
        const created: MenuItem = await api.post('/menu/items', payload)
        setProductDialogOpen(false)
        await load()
        // Open recipe configuration for the newly created dish immediately!
        setTimeout(() => {
          openRecipe(created)
        }, 200)
      }
    } finally {
      setSavingProduct(false)
    }
  }

  const deleteProduct = async (id: string) => {
    if (!confirm('🗑️ ¿Eliminar permanentemente este plato del menú?')) return
    await api.delete(`/menu/items/${id}?force=true`)
    load()
  }

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'ingredients', label: 'Ingredientes', icon: Package },
    { id: 'purchases', label: 'Compras', icon: ReceiptText },
    { id: 'suppliers', label: 'Proveedores', icon: Users },
    { id: 'movements', label: 'Movimientos', icon: History },
  ]

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-40 gap-4">
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}>
        <div className="h-12 w-12 rounded-full border-[3px] border-[var(--accent)] border-t-transparent shadow-lg shadow-[var(--accent)]/20" />
      </motion.div>
      <p className="text-sm text-[var(--text-muted)] animate-pulse">Cargando inventario...</p>
    </div>
  )

  return (
    <motion.div className="space-y-7" initial="hidden" animate="visible" variants={stagger}>

      {/* ── Header ── */}
      <motion.div className="flex flex-wrap items-center justify-between gap-4" variants={fadeUp}>
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl shadow-lg shadow-[var(--accent)]/20" style={{ background: 'linear-gradient(135deg, var(--accent), #6aaa32)' }}>
              <Warehouse className="h-5 w-5 text-[var(--accent-fg)]" />
            </div>
            <div>
              <h2 className="antifont text-4xl tracking-wider text-[var(--text-primary)] leading-none">INVENTARIO</h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">Insumos, recetas de platos y márgenes de ganancia.</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'ingredients' && (
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <Button className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold shadow-lg shadow-[var(--accent)]/20 rounded-xl h-11 px-5 gap-2" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Nuevo Ingrediente
              </Button>
            </motion.div>
          )}
          {tab === 'purchases' && (
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <Button className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold shadow-lg shadow-[var(--accent)]/20 rounded-xl h-11 px-5 gap-2" onClick={openCreatePurchase}>
                <Plus className="h-4 w-4" /> Registrar Compra / Factura
              </Button>
            </motion.div>
          )}
          {tab === 'suppliers' && (
            <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
              <Button className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold shadow-lg shadow-blue-600/20 rounded-xl h-11 px-5 gap-2" onClick={openCreateSupplier}>
                <Plus className="h-4 w-4" /> Nuevo Proveedor
              </Button>
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* ── Low Stock Alert ── */}
      <AnimatePresence>
        {lowStock.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 p-4 shadow-inner">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/15">
                <ShieldAlert className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-sm font-bold text-red-500">¡Stock bajo!</p>
                <p className="text-xs text-red-400/80 mt-0.5">{lowStock.map(i => i.name).join(', ')}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── KPI Cards ── */}
      <motion.div className="grid grid-cols-1 sm:grid-cols-3 gap-4" variants={fadeUp}>
        {[
          {
            label: 'Valor Total Inventario', value: formatCurrency(stats.totalValue), icon: DollarSign,
            color: '#10B981', glowFrom: 'rgba(16,185,129,0.18)', glowTo: 'transparent',
            sub: `${stats.totalIngredients} ingredientes`
          },
          {
            label: 'Stock Bajo', value: stats.lowCount, icon: AlertTriangle,
            color: stats.lowCount > 0 ? '#EF4444' : '#10B981',
            glowFrom: stats.lowCount > 0 ? 'rgba(239,68,68,0.18)' : 'rgba(16,185,129,0.18)',
            glowTo: 'transparent',
            sub: stats.lowCount > 0 ? 'Requieren reabastecimiento' : 'Todo en orden'
          },
          {
            label: 'Total Ingredientes', value: stats.totalIngredients, icon: Layers,
            color: '#3B82F6', glowFrom: 'rgba(59,130,246,0.18)', glowTo: 'transparent',
            sub: `${menuItems.length} platos con receta posible`
          },
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
              <div className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full blur-2xl"
                style={{ background: `radial-gradient(circle, ${s.glowFrom}, ${s.glowTo})` }} />
              <div className="pointer-events-none absolute inset-0 opacity-[0.03]"
                style={{ backgroundImage: `radial-gradient(circle, ${s.color} 1px, transparent 1px)`, backgroundSize: '16px 16px' }} />
              <div className="relative flex items-center gap-4">
                <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl shadow-lg"
                  style={{ background: `linear-gradient(135deg, ${s.color}25, ${s.color}10)`, border: `1px solid ${s.color}30` }}>
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

      {/* ── Tab Switcher ── */}
      <motion.div variants={fadeUp}>
        <div className="flex gap-1 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] p-1.5">
          {tabs.map(t => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex-1 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all cursor-pointer ${
                  tab === t.id
                    ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-md shadow-[var(--accent)]/20'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            )
          })}
        </div>
      </motion.div>

      {tab === 'ingredients' && (
        <motion.div variants={fadeUp}>
          <div className="relative group">
            <Search className="absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--accent)] transition-colors" />
            <Input
              className="rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] py-6 pl-11 pr-4 text-sm focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 transition-all shadow-sm placeholder:text-[var(--text-muted)]"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar ingrediente..."
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute top-1/2 right-4 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </motion.div>
      )}

      {/* ── TAB: Ingredients ── */}
      {tab === 'ingredients' && (
        <motion.div variants={fadeUp}>
          <Card className="border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-xl rounded-3xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-left text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-subtle)]/50">
                    <th className="px-6 py-4 font-black">Código</th>
                    <th className="px-6 py-4 font-black">Ingrediente</th>
                    <th className="px-6 py-4 font-black">Stock Actual</th>
                    <th className="px-6 py-4 font-black">Mínimo</th>
                    <th className="px-6 py-4 font-black">Costo/Unidad</th>
                    <th className="px-6 py-4 font-black">Valor Total</th>
                    <th className="px-6 py-4 font-black text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {filteredIngredients.map(ing => {
                    const isLow = ing.stock <= ing.minStock
                    const stockPercent = ing.minStock > 0 ? (ing.stock / (ing.minStock * 3)) * 100 : 100
                    const barColor = isLow ? '#EF4444' : stockPercent < 50 ? '#F59E0B' : '#10B981'
                    return (
                      <tr key={ing.id} className="hover:bg-[var(--bg-hover)] transition-colors group">
                        <td className="px-6 py-3.5 font-extrabold text-xs text-[var(--text-muted)] tracking-wider">
                          {ing.code || '—'}
                        </td>
                        <td className="px-6 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                              style={{ background: `${barColor}15`, border: `1px solid ${barColor}25` }}>
                              <Package className="h-4 w-4" style={{ color: barColor }} />
                            </div>
                            <div>
                              <span className="font-bold text-[var(--text-primary)]">{ing.name}</span>
                              {isLow && (
                                <Badge variant="destructive" className="ml-2 text-[9px] py-0 px-1.5 rounded-full font-black">Bajo</Badge>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-3.5">
                          <div className="space-y-1.5">
                            <span className="font-black text-sm" style={{ color: barColor }}>
                              {ing.stock.toLocaleString('de-DE')} <span className="text-[var(--text-muted)] font-normal text-xs">{ing.unit}</span>
                            </span>
                            <div className="h-1.5 w-20 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(stockPercent, 100)}%`, background: barColor }} />
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-3.5 text-xs text-[var(--text-muted)] font-medium">{ing.minStock.toLocaleString('de-DE')}</td>
                        <td className="px-6 py-3.5 text-xs text-[var(--text-secondary)] font-bold">{formatCurrency(ing.costPerUnit)}</td>
                        <td className="px-6 py-3.5 text-xs text-[var(--text-primary)] font-bold">{formatCurrency(ing.stock * ing.costPerUnit)}</td>
                        <td className="px-6 py-3.5">
                          <div className="flex justify-end gap-1">
                            <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg text-green-500 hover:bg-green-500/10 cursor-pointer"
                              onClick={() => { setAdjustDialog(ing); setAdjustQty('1'); setAdjustType('IN') }}>
                              <ArrowUp className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg text-orange-500 hover:bg-orange-500/10 cursor-pointer"
                              onClick={() => { setAdjustDialog(ing); setAdjustQty('1'); setAdjustType('OUT') }}>
                              <ArrowDown className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg text-[var(--accent)] hover:bg-[var(--accent-muted)] cursor-pointer"
                              onClick={() => openEdit(ing)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg text-[var(--destructive)] hover:bg-[var(--destructive)]/10 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                              onClick={() => deleteIngredient(ing.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {filteredIngredients.length === 0 && (
                <div className="py-20 text-center">
                  <Package className="h-12 w-12 text-[var(--text-muted)] mx-auto mb-3 opacity-30" />
                  <p className="text-[var(--text-secondary)] font-bold">{search ? 'Sin resultados' : 'Sin ingredientes'}</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">{search ? 'Intenta con otro término' : 'Crea el primer ingrediente'}</p>
                </div>
              )}
            </div>
          </Card>
        </motion.div>
      )}



      {/* ── TAB: Purchases ── */}
      {tab === 'purchases' && (
        <motion.div variants={fadeUp} className="space-y-4">
          <Card className="border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-xl rounded-3xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-left text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-subtle)]/50">
                    <th className="px-6 py-4 font-black">Nro. Factura</th>
                    <th className="px-6 py-4 font-black">Fecha Compra</th>
                    <th className="px-6 py-4 font-black">Proveedor</th>
                    <th className="px-6 py-4 font-black">Total Factura</th>
                    <th className="px-6 py-4 font-black">Detalles (Insumos)</th>
                    <th className="px-6 py-4 font-black">Notas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {purchases.map(p => (
                    <tr key={p.id} className="hover:bg-[var(--bg-hover)] transition-colors">
                      <td className="px-6 py-3.5 font-bold text-[var(--text-primary)]">
                        <span className="font-mono text-xs uppercase tracking-wider bg-[var(--bg-elevated)] border border-[var(--border-subtle)] px-2 py-0.5 rounded text-[var(--accent)] font-semibold">
                          {p.invoiceNumber}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-xs text-[var(--text-secondary)] font-bold">{formatDate(p.purchaseDate)}</td>
                      <td className="px-6 py-3.5 text-sm font-semibold">{p.supplier.name}</td>
                      <td className="px-6 py-3.5 font-black text-[var(--accent)] text-sm">{formatCurrency(p.total)}</td>
                      <td className="px-6 py-3.5">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {p.items?.map(item => (
                            <Badge key={item.id} variant="secondary" className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[10px] py-0.5 px-2 rounded-lg font-bold">
                              {item.ingredient?.name}: {item.quantity} {item.ingredient?.unit}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-3.5 text-xs text-[var(--text-muted)]">{p.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {purchases.length === 0 && (
                <div className="py-20 text-center">
                  <ReceiptText className="h-12 w-12 text-[var(--text-muted)] mx-auto mb-3 opacity-30" />
                  <p className="text-[var(--text-secondary)] font-bold">Sin facturas registradas</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Registra la primera factura de insumos comprados</p>
                </div>
              )}
            </div>
          </Card>
        </motion.div>
      )}

      {/* ── TAB: Suppliers ── */}
      {tab === 'suppliers' && (
        <motion.div variants={fadeUp} className="space-y-4">
          <Card className="border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-xl rounded-3xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-left text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-subtle)]/50">
                    <th className="px-6 py-4 font-black">Proveedor</th>
                    <th className="px-6 py-4 font-black">NIT / Identificación</th>
                    <th className="px-6 py-4 font-black">Teléfono</th>
                    <th className="px-6 py-4 font-black">Dirección</th>
                    <th className="px-6 py-4 font-black text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {suppliers.map(sup => (
                    <tr key={sup.id} className="hover:bg-[var(--bg-hover)] transition-colors group">
                      <td className="px-6 py-3.5 font-bold text-[var(--text-primary)]">{sup.name}</td>
                      <td className="px-6 py-3.5 text-xs font-mono text-[var(--text-secondary)]">{sup.nit || '—'}</td>
                      <td className="px-6 py-3.5 text-xs font-semibold">{sup.phone || '—'}</td>
                      <td className="px-6 py-3.5 text-xs text-[var(--text-secondary)]">{sup.address || '—'}</td>
                      <td className="px-6 py-3.5">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg text-[var(--accent)] hover:bg-[var(--accent-muted)] cursor-pointer"
                            onClick={() => openEditSupplier(sup)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8 rounded-lg text-[var(--destructive)] hover:bg-[var(--destructive)]/10 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                            onClick={() => deleteSupplier(sup.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {suppliers.length === 0 && (
                <div className="py-20 text-center">
                  <Users className="h-12 w-12 text-[var(--text-muted)] mx-auto mb-3 opacity-30" />
                  <p className="text-[var(--text-secondary)] font-bold">Sin proveedores</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Registra tu primer proveedor de insumos</p>
                </div>
              )}
            </div>
          </Card>
        </motion.div>
      )}

      {/* ── TAB: Movements ── */}
      {tab === 'movements' && (
        <motion.div variants={fadeUp}>
          <Card className="border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-xl rounded-3xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-left text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-subtle)]/50">
                    <th className="px-6 py-4 font-black">Fecha</th>
                    <th className="px-6 py-4 font-black">Ingrediente</th>
                    <th className="px-6 py-4 font-black">Tipo</th>
                    <th className="px-6 py-4 font-black">Cantidad</th>
                    <th className="px-6 py-4 font-black">Stock</th>
                    <th className="px-6 py-4 font-black">Notas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {movements.map(m => {
                    const isIn = m.type === 'IN' || m.type === 'PURCHASE'
                    const color = isIn ? '#10B981' : m.type === 'ORDER' || m.type === 'SALE' ? '#F59E0B' : '#EF4444'
                    return (
                      <tr key={m.id} className="hover:bg-[var(--bg-hover)] transition-colors">
                        <td className="px-6 py-3.5 text-xs text-[var(--text-secondary)] font-bold whitespace-nowrap">{formatDate(m.createdAt)}</td>
                        <td className="px-6 py-3.5 text-sm font-bold text-[var(--text-primary)]">{m.ingredient.name}</td>
                        <td className="px-6 py-3.5">
                          <Badge variant="outline" className="text-[9px] py-0.5 px-2.5 rounded-full font-black uppercase tracking-wider border"
                            style={{ borderColor: `${color}30`, color, backgroundColor: `${color}10` }}>
                            {m.type === 'IN' ? '⬆ Entrada' : m.type === 'PURCHASE' ? '💰 Compra' : m.type === 'ORDER' || m.type === 'SALE' ? '📦 Pedido' : m.type === 'OUT' ? '⬇ Salida' : m.type}
                          </Badge>
                        </td>
                        <td className="px-6 py-3.5 font-bold" style={{ color }}>{isIn ? '+' : '-'}{m.quantity}</td>
                        <td className="px-6 py-3.5 text-xs text-[var(--text-muted)] font-medium">
                          {m.stockBefore} → <span className="font-bold text-[var(--text-primary)]">{m.stockAfter}</span>
                        </td>
                        <td className="px-6 py-3.5 text-xs text-[var(--text-muted)]">
                          {m.order ? `Pedido #${m.order.orderNumber}` : m.notes || '-'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {movements.length === 0 && (
                <div className="py-20 text-center">
                  <History className="h-12 w-12 text-[var(--text-muted)] mx-auto mb-3 opacity-30" />
                  <p className="text-[var(--text-secondary)] font-bold">Sin movimientos aún</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Los movimientos aparecen al ajustar stock o al vender pedidos</p>
                </div>
              )}
            </div>
          </Card>
        </motion.div>
      )}



      {/* ── Dialog: New/Edit Ingredient ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl shadow-2xl p-0 max-w-md overflow-hidden">
          <div className="h-1.5 w-full" style={{ background: 'linear-gradient(90deg, var(--accent), #6aaa32)' }} />
          <div className="p-6">
            <DialogHeader className="pb-4">
              <DialogTitle className="text-[var(--text-primary)] text-xl font-bold flex items-center gap-2">
                <Package className="h-5 w-5 text-[var(--accent)]" />
                {editId ? 'Editar' : 'Nuevo'} Ingrediente
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1">
                  <Label className="h-8 flex items-end pb-1 text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Nombre *</Label>
                  <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                    className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 focus:border-[var(--accent)] transition-all"
                    placeholder="Ej: Queso Mozzarella" />
                </div>
                <div className="space-y-1">
                  <Label className="h-8 flex items-end pb-1 text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Código *</Label>
                  <Input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))}
                    className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 focus:border-[var(--accent)] transition-all uppercase"
                    placeholder="Ej: ING01" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="h-8 flex items-end pb-1 text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Unidad Base *</Label>
                  <Select value={form.unit || 'unidad'} onValueChange={v => setForm(p => ({ ...p, unit: v }))}>
                    <SelectTrigger className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 focus:border-[var(--accent)] transition-all">
                      <SelectValue placeholder="Seleccionar…" />
                    </SelectTrigger>
                    <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-2xl">
                      {['unidad', 'gramos'].map(u => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="h-8 flex items-end pb-1 text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Stock Base *</Label>
                  <Input type="number" value={form.stock} onChange={e => setForm(p => ({ ...p, stock: e.target.value }))}
                    className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 focus:border-[var(--accent)] transition-all" />
                </div>
                <div className="space-y-1">
                  <Label className="h-8 flex items-end pb-1 text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Mínimo Base *</Label>
                  <Input type="number" value={form.minStock} onChange={e => setForm(p => ({ ...p, minStock: e.target.value }))}
                    className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 focus:border-[var(--accent)] transition-all" />
                </div>
                <div className="space-y-1">
                  <Label className="h-8 flex items-end pb-1 text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Costo/Unidad Base ($) *</Label>
                  <CurrencyInput
                    value={form.costPerUnit}
                    onChange={v => setForm(p => ({ ...p, costPerUnit: v }))}
                    placeholder="0"
                    prefixSymbol={true}
                    className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 focus:border-[var(--accent)] transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 border-t border-[var(--border-subtle)]/50 pt-3 mt-1">
                <div className="space-y-1">
                  <Label className="h-8 flex items-end pb-1 text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Unidad Compra (Opcional)</Label>
                  <Select value={form.purchaseUnit || 'NONE'} onValueChange={v => setForm(p => ({ ...p, purchaseUnit: v === 'NONE' ? '' : v }))}>
                    <SelectTrigger className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 focus:border-[var(--accent)] transition-all">
                      <SelectValue placeholder="Ninguna" />
                    </SelectTrigger>
                    <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-2xl">
                      <SelectItem value="NONE">Misma que base</SelectItem>
                      {['unidad', 'gramos'].map(u => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="h-8 flex items-end pb-1 text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Factor Conversión (Opcional)</Label>
                  <Input type="number" value={form.conversionFactor || '1'} onChange={e => setForm(p => ({ ...p, conversionFactor: e.target.value }))}
                    className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 focus:border-[var(--accent)] transition-all"
                    placeholder="Ej: 1000" />
                </div>
                <div className="col-span-2 text-[10px] text-[var(--text-muted)] font-medium leading-relaxed -mt-1">
                  * 1 Unidad de Compra equivale a esta cantidad de unidades base. Ej: 1 Kg = 1000 g, 1 Caja = 12 unidades.
                </div>
              </div>

              <Button className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold h-12 rounded-xl shadow-lg shadow-[var(--accent)]/20 transition-all mt-4" onClick={handleSave}>
                {editId ? 'Actualizar' : 'Crear'} Ingrediente
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Adjust Stock ── */}
      <Dialog open={!!adjustDialog} onOpenChange={() => setAdjustDialog(null)}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl shadow-2xl p-0 max-w-sm overflow-hidden">
          <div className="h-1.5 w-full" style={{ background: adjustType === 'IN' ? 'linear-gradient(90deg, #10B981, #059669)' : 'linear-gradient(90deg, #F59E0B, #D97706)' }} />
          <div className="p-6">
            <DialogHeader className="pb-4">
              <DialogTitle className="text-[var(--text-primary)] text-lg font-bold flex items-center gap-2">
                {adjustType === 'IN' ? <ArrowUp className="h-5 w-5 text-green-500" /> : <ArrowDown className="h-5 w-5 text-orange-500" />}
                Ajustar stock — {adjustDialog?.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Select value={adjustType} onValueChange={v => setAdjustType(v as 'IN' | 'OUT')}>
                <SelectTrigger className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-2xl">
                  <SelectItem value="IN">⬆ Entrada (+)</SelectItem>
                  <SelectItem value="OUT">⬇ Salida (-)</SelectItem>
                </SelectContent>
              </Select>
              <Input type="number" value={adjustQty} onChange={e => setAdjustQty(e.target.value)}
                className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 font-bold focus:border-[var(--accent)] transition-all" />
              <Button className="w-full font-bold h-12 rounded-xl shadow-lg transition-all"
                style={{ background: adjustType === 'IN' ? 'linear-gradient(135deg, #10B981, #059669)' : 'linear-gradient(135deg, #F59E0B, #D97706)', color: '#fff' }}
                onClick={doAdjust}>
                Aplicar Ajuste
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Recipe Configuration ── */}
      <Dialog open={recipeDialog} onOpenChange={setRecipeDialog}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl shadow-2xl p-0 max-w-lg overflow-hidden">
          <div className="h-1.5 w-full" style={{ background: 'linear-gradient(90deg, var(--accent), #3B82F6)' }} />
          <div className="p-6">
            <DialogHeader className="pb-4">
              <DialogTitle className="text-[var(--text-primary)] text-xl font-bold flex items-center gap-2">
                <ChefHat className="h-5 w-5 text-[var(--accent)]" />
                Receta: {selectedItem?.name}
              </DialogTitle>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Define los ingredientes y cantidades necesarias para preparar este plato</p>
            </DialogHeader>

            {/* Real-time Profitability Stats */}
            <div className="grid grid-cols-3 gap-3 rounded-2xl bg-[var(--bg-elevated)] p-4 border border-[var(--border-subtle)] text-center mb-4">
              <div>
                <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Costo Receta</p>
                <p className="text-sm font-black text-[var(--text-secondary)] mt-0.5">{formatCurrency(recipeStats.cost)}</p>
              </div>
              <div>
                <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Precio Venta</p>
                <p className="text-sm font-black text-[var(--text-primary)] mt-0.5">{selectedItem ? formatCurrency(selectedItem.price) : '-'}</p>
              </div>
              <div>
                <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Margen Neto</p>
                <p className={`text-sm font-black mt-0.5 ${recipeStats.margin < 40 ? 'text-amber-500' : 'text-green-500'}`}>{recipeStats.margin.toFixed(0)}%</p>
              </div>
            </div>

            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
              {recipeItems.map((ri, idx) => {
                const ing = ingredients.find(i => i.id === ri.ingredientId)
                return (
                  <div key={idx} className="flex gap-2 items-end animate-fade-in">
                    <div className="flex-1 space-y-1">
                      {idx === 0 && <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Ingrediente</Label>}
                      <Select 
                        value={ri.ingredientId} 
                        onValueChange={v => {
                          const newIng = ingredients.find(i => i.id === v)
                          setRecipeItems(prev => prev.map((r, i) => i === idx ? { 
                            ...r, 
                            ingredientId: v,
                            unit: newIng?.unit || 'unidad'
                          } : r))
                        }}
                      >
                        <SelectTrigger className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-10 text-sm">
                          <SelectValue placeholder="Seleccionar…" />
                        </SelectTrigger>
                        <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-2xl">
                          {ingredients.map(ing => <SelectItem key={ing.id} value={ing.id}>{ing.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-20 space-y-1">
                      {idx === 0 && <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Cantidad</Label>}
                      <Input 
                        type="number" 
                        className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-10 font-bold text-xs" 
                        value={ri.quantity}
                        onChange={e => setRecipeItems(prev => prev.map((r, i) => i === idx ? { ...r, quantity: parseFloat(e.target.value) || 0 } : r))} 
                      />
                    </div>
                    <div className="w-20 space-y-1">
                      {idx === 0 && <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Medida</Label>}
                      <div className="h-10 flex items-center justify-center bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-xl text-xs font-black text-[var(--text-secondary)] uppercase px-3 select-none">
                        {ing?.unit || ri.unit || 'unidad'}
                      </div>
                    </div>
                    <div className="w-16 space-y-1">
                      {idx === 0 && <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">% Merma</Label>}
                      <div className="relative flex items-center">
                        <Input type="number" min="0" max="99" className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-10 font-bold pr-6 text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" value={ri.wastePercentage ?? 0}
                          onChange={e => setRecipeItems(prev => prev.map((r, i) => i === idx ? { ...r, wastePercentage: parseFloat(e.target.value) || 0 } : r))} />
                        <span className="absolute right-2 text-[9px] font-extrabold text-[var(--text-muted)] pointer-events-none">%</span>
                      </div>
                    </div>
                    <Button size="icon" variant="ghost" className="h-10 w-10 rounded-xl text-[var(--destructive)] hover:bg-[var(--destructive)]/10 cursor-pointer shrink-0"
                      onClick={() => setRecipeItems(prev => prev.filter((_, i) => i !== idx))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )
              })}
              <Button variant="outline" className="w-full border-dashed border-[var(--border-default)] rounded-xl h-10 text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)]/40 font-bold text-xs gap-2 mt-1"
                onClick={() => setRecipeItems(prev => [...prev, { ingredientId: ingredients[0]?.id || '', quantity: 1, wastePercentage: 0, unit: ingredients[0]?.unit || 'unidad' }])}>
                <Plus className="h-4 w-4" /> Agregar Ingrediente
              </Button>
              <Button className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold h-12 rounded-xl shadow-lg shadow-[var(--accent)]/20 transition-all mt-4" onClick={saveRecipe}>
                Guardar Receta
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Create / Edit Product (MenuItem) ── */}
      <Dialog open={productDialogOpen} onOpenChange={setProductDialogOpen}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl shadow-2xl p-0 max-w-md overflow-hidden">
          <div className="h-1.5 w-full animate-pulse" style={{ background: 'linear-gradient(90deg, #10B981, #3B82F6)' }} />
          <div className="p-6">
            <DialogHeader className="pb-4">
              <DialogTitle className="text-[var(--text-primary)] text-xl font-bold flex items-center gap-2">
                <UtensilsCrossed className="h-5 w-5 text-green-500" />
                {editProductItem ? 'Editar Plato' : 'Nuevo Plato del Menú'}
              </DialogTitle>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Define los datos comerciales del plato</p>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Nombre del Plato *</Label>
                <Input
                  value={productForm.name}
                  onChange={e => setProductForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Ej: Pizza Súper The Villa Dog Especial"
                  className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 focus:border-green-500 transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Precio de Venta ($) *</Label>
                  <CurrencyInput
                    value={productForm.price}
                    onChange={v => setProductForm(p => ({ ...p, price: v }))}
                    placeholder="0"
                    prefixSymbol={true}
                    className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 font-bold focus:border-green-500 transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Categoría *</Label>
                  <Select
                    value={productForm.categoryId}
                    onValueChange={v => setProductForm(p => ({ ...p, categoryId: v }))}
                  >
                    <SelectTrigger className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 focus:border-green-500 transition-all">
                      <SelectValue placeholder="Seleccionar…" />
                    </SelectTrigger>
                    <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-2xl">
                      {categories.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Descripción</Label>
                <Input
                  value={productForm.description}
                  onChange={e => setProductForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="Ej: Pollo, jamón, maíz tierno y doble queso mozzarella"
                  className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 focus:border-green-500 transition-all"
                />
              </div>

              <Button
                className="w-full bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white font-bold h-12 rounded-xl shadow-lg shadow-green-600/20 transition-all text-sm gap-2"
                onClick={saveProduct}
                disabled={savingProduct || !productForm.name || !productForm.price || !productForm.categoryId}
              >
                {savingProduct ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {savingProduct ? 'Guardando…' : editProductItem ? 'Guardar Cambios' : 'Crear Plato e Ir a Receta'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: New/Edit Supplier ── */}
      <Dialog open={supplierDialogOpen} onOpenChange={setSupplierDialogOpen}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl shadow-2xl p-0 max-w-md overflow-hidden">
          <div className="h-1.5 w-full" style={{ background: 'linear-gradient(90deg, var(--accent), #3b82f6)' }} />
          <div className="p-6">
            <DialogHeader className="pb-4">
              <DialogTitle className="text-[var(--text-primary)] text-xl font-bold flex items-center gap-2">
                <Users className="h-5 w-5 text-[var(--accent)]" />
                {editSupplierId ? 'Editar' : 'Nuevo'} Proveedor
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Nombre del Proveedor *</Label>
                <Input value={supplierForm.name} onChange={e => setSupplierForm(p => ({ ...p, name: e.target.value }))}
                  className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 focus:border-[var(--accent)] transition-all"
                  placeholder="Ej: Distribuidora de Carnes SAS" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">NIT / Identificación</Label>
                <Input value={supplierForm.nit} onChange={e => setSupplierForm(p => ({ ...p, nit: e.target.value }))}
                  className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 focus:border-[var(--accent)] transition-all"
                  placeholder="Ej: 900.123.456-7" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Teléfono de Contacto</Label>
                  <Input value={supplierForm.phone} onChange={e => setSupplierForm(p => ({ ...p, phone: e.target.value }))}
                    className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 focus:border-[var(--accent)] transition-all"
                    placeholder="Ej: 3123456789" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Dirección</Label>
                  <Input value={supplierForm.address} onChange={e => setSupplierForm(p => ({ ...p, address: e.target.value }))}
                    className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 focus:border-[var(--accent)] transition-all"
                    placeholder="Ej: Calle 20 # 15-30" />
                </div>
              </div>
              <Button 
                className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold h-12 rounded-xl shadow-lg shadow-[var(--accent)]/20 transition-all mt-2" 
                onClick={saveSupplier}
                disabled={savingSupplier || !supplierForm.name}
              >
                {savingSupplier ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {editSupplierId ? 'Guardar Cambios' : 'Crear Proveedor'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: New Purchase (Invoice) ── */}
      <Dialog open={purchaseDialogOpen} onOpenChange={setPurchaseDialogOpen}>
        <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-3xl shadow-2xl p-0 max-w-3xl overflow-hidden">
          <div className="h-1.5 w-full" style={{ background: 'linear-gradient(90deg, var(--accent), #10B981)' }} />
          <div className="p-6">
            <DialogHeader className="pb-4">
              <DialogTitle className="text-[var(--text-primary)] text-xl font-bold flex items-center gap-2">
                <ReceiptText className="h-5 w-5 text-[var(--accent)]" />
                Registrar Factura de Compra
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Proveedor *</Label>
                  <Select
                    value={purchaseForm.supplierId}
                    onValueChange={v => setPurchaseForm(p => ({ ...p, supplierId: v }))}
                  >
                    <SelectTrigger className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 focus:border-[var(--accent)] transition-all">
                      <SelectValue placeholder="Seleccionar…" />
                    </SelectTrigger>
                    <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-2xl">
                      {suppliers.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {suppliers.length === 0 && (
                    <p className="text-[10px] text-amber-500 mt-1">Crea un proveedor primero en la pestaña Proveedores</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Nro. de Factura *</Label>
                  <Input value={purchaseForm.invoiceNumber} onChange={e => setPurchaseForm(p => ({ ...p, invoiceNumber: e.target.value }))}
                    className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 focus:border-[var(--accent)] transition-all font-mono"
                    placeholder="Ej: FACT-9823" />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Fecha de Compra *</Label>
                  <Input type="date" value={purchaseForm.purchaseDate} onChange={e => setPurchaseForm(p => ({ ...p, purchaseDate: e.target.value }))}
                    className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl h-11 focus:border-[var(--accent)] transition-all" />
                </div>
              </div>

              {/* Items Dynamic Grid */}
              <div className="space-y-2">
                <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider block">Insumos y Costos *</Label>
                <div className="border border-[var(--border-subtle)]/70 rounded-2xl overflow-hidden max-h-60 overflow-y-auto no-scrollbar">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[var(--bg-subtle)]/50 border-b border-[var(--border-subtle)] text-[var(--text-muted)] text-left">
                        <th className="px-4 py-2 font-bold uppercase">Ingrediente</th>
                        <th className="px-4 py-2 font-bold uppercase w-28">Cantidad</th>
                        <th className="px-4 py-2 font-bold uppercase w-32">Costo Unit. ($)</th>
                        <th className="px-4 py-2 font-bold uppercase w-32 text-right">Subtotal</th>
                        <th className="px-4 py-2 w-12"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)] bg-[var(--bg-panel)]">
                      {purchaseForm.items.map((item, index) => {
                        const subTotal = (parseFloat(item.quantity) || 0) * (parseFloat(item.unitCost) || 0)
                        const ing = ingredients.find(i => i.id === item.ingredientId)
                        return (
                          <tr key={index} className="hover:bg-[var(--bg-hover)]/30">
                            <td className="p-2">
                              <Select
                                value={item.ingredientId}
                                onValueChange={v => handleUpdatePurchaseItem(index, 'ingredientId', v)}
                              >
                                <SelectTrigger className="bg-[var(--bg-elevated)] border-transparent rounded-lg h-9 focus:border-[var(--accent)] text-xs">
                                  <SelectValue placeholder="Seleccionar…" />
                                </SelectTrigger>
                                <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-default)] rounded-xl">
                                  {ingredients.map(ing => (
                                    <SelectItem key={ing.id} value={ing.id}>{ing.name} ({ing.unit})</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="p-2">
                              <div className="relative flex items-center">
                                <Input
                                  type="number"
                                  min="0.01"
                                  step="any"
                                  value={item.quantity}
                                  onChange={e => handleUpdatePurchaseItem(index, 'quantity', e.target.value)}
                                  className="bg-[var(--bg-elevated)] border-transparent rounded-lg h-9 text-xs pr-10 font-bold w-full"
                                />
                                <span className="absolute right-2 text-[9px] font-extrabold text-[var(--text-muted)] uppercase pointer-events-none">
                                  {ing?.purchaseUnit || ing?.unit || ''}
                                </span>
                              </div>
                              {ing?.purchaseUnit && ing.conversionFactor && ing.conversionFactor > 1 && (
                                <div className="text-[9px] text-[var(--text-muted)] font-medium mt-0.5 ml-1 font-mono">
                                  = {((parseFloat(item.quantity) || 0) * ing.conversionFactor).toLocaleString()} {ing.unit}
                                </div>
                              )}
                            </td>
                            <td className="p-2">
                              <Input
                                type="number"
                                min="0"
                                step="any"
                                value={item.unitCost}
                                onChange={e => handleUpdatePurchaseItem(index, 'unitCost', e.target.value)}
                                className="bg-[var(--bg-elevated)] border-transparent rounded-lg h-9 text-xs font-mono font-bold"
                              />
                              {ing?.purchaseUnit && ing.conversionFactor && ing.conversionFactor > 1 && (
                                <div className="text-[9px] text-[var(--text-muted)] font-medium mt-0.5 ml-1 font-mono">
                                  ({formatCurrency((parseFloat(item.unitCost) || 0) / ing.conversionFactor)} / {ing.unit})
                                </div>
                              )}
                            </td>
                            <td className="p-2 text-right font-bold text-[var(--text-secondary)] font-mono">
                              {formatCurrency(subTotal)}
                            </td>
                            <td className="p-2 text-center">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-[var(--destructive)] hover:bg-[var(--destructive)]/10 rounded-lg cursor-pointer"
                                onClick={() => handleRemovePurchaseItem(index)}
                                disabled={purchaseForm.items.length === 1}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl border-[var(--border-default)] hover:bg-[var(--bg-hover)] text-xs font-bold gap-1 mt-1 cursor-pointer"
                  onClick={handleAddPurchaseItem}
                >
                  <Plus className="h-3.5 w-3.5" /> Agregar Fila
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">Notas u Observaciones</Label>
                <Textarea
                  value={purchaseForm.notes}
                  onChange={e => setPurchaseForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Ej: Insumos recibidos a satisfacción. Pago a 30 días."
                  className="bg-[var(--bg-elevated)] border-[var(--border-default)] rounded-xl min-h-[60px] text-xs focus:border-[var(--accent)]"
                />
              </div>

              {/* Total display & Action buttons */}
              <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-4">
                <div>
                  <span className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider block">Total Facturado</span>
                  <span className="text-2xl font-black text-[var(--accent)] tracking-tight font-mono">
                    {formatCurrency(
                      purchaseForm.items.reduce((sum, item) => sum + (parseFloat(item.quantity) || 0) * (parseFloat(item.unitCost) || 0), 0)
                    )}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    className="rounded-xl h-11 border-[var(--border-default)] hover:bg-[var(--bg-hover)] text-xs font-bold"
                    onClick={() => setPurchaseDialogOpen(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold h-11 px-5 rounded-xl text-xs uppercase tracking-wider shadow-lg shadow-[var(--accent)]/15 gap-2"
                    onClick={savePurchase}
                    disabled={savingPurchase || suppliers.length === 0}
                  >
                    {savingPurchase ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Registrar Factura
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
