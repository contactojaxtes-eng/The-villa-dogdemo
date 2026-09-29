import React, { useEffect, useMemo, useState, useRef, Fragment } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { io } from '@/lib/socket'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CurrencyInput } from '@/components/ui/CurrencyInput'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { cn, formatCurrency } from '@/lib/utils'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { toast } from 'sonner'
import { alerts } from '@/lib/alerts'
import {
  Plus, Edit, Trash2, UtensilsCrossed, FolderPlus, Search, Tags, ImageIcon, Bike,
  X, Loader2, Layers, ChefHat, Sparkles, Save, PackagePlus, Barcode, Scale,
  TrendingUp, DollarSign, Box, Percent, Layers2, PlusCircle, AlertCircle,
  ChevronLeft, ChevronRight, Clock
} from 'lucide-react'

interface MenuItem {
  id: string
  name: string
  code?: string | null
  description: string | null
  price: number
  image: string | null
  active: boolean
  availableForDelivery?: boolean
  categoryId: string
  type?: string
  comboItems?: { itemId: string; quantity: number }[] | null
  recipe?: { id: string; items: any[] } | null
  prepTime?: number
}

interface MenuCategory {
  id: string
  name: string
  description: string | null
  active: boolean
  sortOrder: number
  items: MenuItem[]
}

const fadeUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } } }
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }

export const parseTargetCategories = (description: string | null | undefined): { targetCategoryIds: string[]; cleanDesc: string; hasExplicitSetting: boolean; isAdditionFlag: boolean } => {
  if (!description) return { targetCategoryIds: [], cleanDesc: '', hasExplicitSetting: false, isAdditionFlag: false }
  const isAdditionFlag = description.includes('[IS_ADDITION]') || description.includes('[TARGETS:')
  const clean = description.replace(/\[IS_ADDITION\]\s*/g, '').trim()
  const match = clean.match(/^\[TARGETS:([^\]]*)\]\s*(.*)$/s)
  if (match) {
    const idsStr = match[1].trim()
    if (idsStr === 'NONE') {
      return { targetCategoryIds: [], cleanDesc: match[2] || '', hasExplicitSetting: true, isAdditionFlag: true }
    }
    const targetCategoryIds = idsStr ? idsStr.split(',').map(s => s.trim()).filter(Boolean) : []
    return { targetCategoryIds, cleanDesc: match[2] || '', hasExplicitSetting: true, isAdditionFlag: true }
  }
  return { targetCategoryIds: [], cleanDesc: clean, hasExplicitSetting: false, isAdditionFlag }
}

export const isPizzaAdditionCategory = (catName: string) => {
  const norm = (catName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  return norm.includes('adiciones e ingredientes') || norm.includes('bordes rellenos') || norm.includes('adicionales para pizza')
}

export const encodeTargetCategories = (description: string, targetCategoryIds: string[], isAddition: boolean = true): string => {
  const clean = description.replace(/\[IS_ADDITION\]\s*/g, '').replace(/^\[TARGETS:[^\]]*\]\s*/s, '').trim()
  const prefix = isAddition ? '[IS_ADDITION] ' : ''
  if (targetCategoryIds.length === 0) return `${prefix}[TARGETS:NONE] ${clean}`.trim()
  return `${prefix}[TARGETS:${targetCategoryIds.join(',')}] ${clean}`.trim()
}

export default function ProductsPage() {
  const [activeTab, setActiveTab] = useState<'PRODUCTS' | 'ADDITIONS' | 'CATEGORIES'>('PRODUCTS')
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [ingredients, setIngredients] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [catSearch, setCatSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [showFinancialDetails, setShowFinancialDetails] = useState(false)

  // --- Category Dialog State ---
  const [catDialogOpen, setCatDialogOpen] = useState(false)
  const [editCatId, setEditCatId] = useState<string | null>(null)
  const [catName, setCatName] = useState('')
  const [catDesc, setCatDesc] = useState('')
  const [catTargetCategoryIds, setCatTargetCategoryIds] = useState<string[]>([])
  const [catSaving, setCatSaving] = useState(false)

  // --- Product Dialog State ---
  const [productDialogOpen, setProductDialogOpen] = useState(false)
  const [editProductId, setEditProductId] = useState<string | null>(null)
  const [prodName, setProdName] = useState('')
  const [prodCode, setProdCode] = useState('')
  const [prodType, setProdType] = useState<'NORMAL' | 'COMBO' | 'ADICION'>('NORMAL')
  const [prodPrice, setProdPrice] = useState('')
  const [prodDesc, setProdDesc] = useState('')
  const [prodCatId, setProdCatId] = useState('')
  const [prodImage, setProdImage] = useState<string | null>(null)
  const [prodPrepTime, setProdPrepTime] = useState('10')
  const [prodSaving, setProdSaving] = useState(false)
  const [prodAvailableForDelivery, setProdAvailableForDelivery] = useState(true)
  
  // Combo items sub-state
  const [comboItemsList, setComboItemsList] = useState<{ itemId: string; quantity: string }[]>([])

  // Recipe sub-state inside Product modal
  const [recipeItems, setRecipeItems] = useState<{ ingredientId: string; quantity: string; wastePercentage: string; unit?: string }[]>([
    { ingredientId: '', quantity: '1', wastePercentage: '0', unit: 'unidad' }
  ])
  const [dialogTab, setDialogTab] = useState<'DETAILS' | 'RECIPE' | 'COMBO'>('DETAILS')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const categoriesRef = useRef<HTMLDivElement>(null)

  const scrollCategories = (direction: 'left' | 'right') => {
    if (categoriesRef.current) {
      const scrollAmount = 240
      categoriesRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      })
    }
  }

  const loadData = (silent = false) => {
    if (!silent) setLoading(true)
    api.get<MenuCategory[]>('/menu/categories?includeInactive=true')
      .then(cats => {
        setCategories(cats)
      })
      .catch(console.error)
      .finally(() => {
        if (!silent) setLoading(false)
      })
  }

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, {
      transports: ['websocket', 'polling'],
    })

    socket.on('menuUpdated', () => {
      loadData(true)
    })

    return () => {
      socket.disconnect()
    }
  }, [])

  const filteredCategories = useMemo(() => {
    if (!catSearch.trim()) return categories
    const norm = catSearch.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    return categories.filter(c =>
      (c.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(norm) ||
      (c.description || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(norm)
    )
  }, [categories, catSearch])

  const [isCatAddition, setIsCatAddition] = useState(false)

  const isAdditionCategory = (catName: string, catDesc?: string | null) => {
    const normName = (catName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    const normDesc = (catDesc || '').toLowerCase().trim()
    if (normDesc.includes('[is_addition]') || normDesc.includes('[targets:')) return true
    return normName.includes('adiciones e ingredientes') || 
           normName.includes('bordes rellenos') || 
           normName.includes('adicionales para tu plato') ||
           normName.includes('adicionales para pizza') ||
           normName.startsWith('adicion') ||
           normName.startsWith('topping') ||
           normName === 'adicionales' ||
           normName === 'adiciones'
  }

  // Flattened items list for Products view
  const allProducts = useMemo(() => {
    return categories.flatMap(c => (c.items || []).map(i => ({ 
      ...i, 
      categoryName: c.name,
      categoryDesc: c.description
    })))
  }, [categories])

  const additionProducts = useMemo(() => {
    return allProducts.filter(p => p.type === 'ADICION' || isAdditionCategory(p.categoryName, (p as any).categoryDesc))
  }, [allProducts])

  const mainProducts = useMemo(() => {
    return allProducts.filter(p => p.type !== 'ADICION' && !isAdditionCategory(p.categoryName, (p as any).categoryDesc))
  }, [allProducts])

  const tabCategories = useMemo(() => {
    if (activeTab === 'PRODUCTS') {
      return filteredCategories.filter(c => !isAdditionCategory(c.name, c.description))
    } else if (activeTab === 'ADDITIONS') {
      return filteredCategories.filter(c => isAdditionCategory(c.name, c.description))
    }
    return filteredCategories
  }, [filteredCategories, activeTab])

  const availableCategoriesForProduct = useMemo(() => {
    if (prodType === 'ADICION') {
      const addCats = categories.filter(c => isAdditionCategory(c.name, c.description))
      return addCats.length > 0 ? addCats : categories
    }
    const mainCats = categories.filter(c => !isAdditionCategory(c.name, c.description))
    return mainCats.length > 0 ? mainCats : categories
  }, [categories, prodType])

  const filteredProducts = useMemo(() => {
    const rawQ = search.trim()
    const normalize = (str: string) => (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    const qNorm = normalize(rawQ)
    const tokens = qNorm.split(/\s+/).filter(Boolean)

    let baseList = allProducts
    if (activeTab === 'PRODUCTS') {
      baseList = mainProducts
    } else if (activeTab === 'ADDITIONS') {
      baseList = additionProducts
    }

    return baseList.filter(p => {
      // Si el usuario escribe una búsqueda global, no restringir rígidamente por la categoría lateral para no esconder resultados
      const matchCat = !rawQ ? (categoryFilter === 'ALL' || p.categoryId === categoryFilter) : true
      if (!matchCat) return false
      if (tokens.length === 0) return true

      const nameNorm = normalize(p.name)
      const codeNorm = normalize(p.code || '')
      const descNorm = normalize(p.description || '')
      const catNorm = normalize(p.categoryName || '')
      const fullText = `${nameNorm} ${codeNorm} ${descNorm} ${catNorm}`

      return tokens.every(token => fullText.includes(token))
    })
  }, [allProducts, mainProducts, additionProducts, activeTab, search, categoryFilter])

  const groupedProducts = useMemo(() => {
    const groups: { [categoryId: string]: { categoryName: string; products: MenuItem[] } } = {}
    
    categories.forEach(cat => {
      groups[cat.id] = {
        categoryName: cat.name,
        products: []
      }
    })

    const uncategorizedKey = 'uncategorized'
    groups[uncategorizedKey] = {
      categoryName: 'Sin Categoría',
      products: []
    }

    filteredProducts.forEach(product => {
      const key = product.categoryId && groups[product.categoryId] ? product.categoryId : uncategorizedKey
      groups[key].products.push(product)
    })

    return Object.keys(groups)
      .map(key => ({ id: key, ...groups[key] }))
      .filter(g => g.products.length > 0)
  }, [filteredProducts, categories])

  const catalogProducts = activeTab === 'ADDITIONS' ? additionProducts : mainProducts
  const activeCatalogProducts = catalogProducts.filter(product => product.active).length

  // --- Category Actions ---
  const openNewCategory = () => {
    setEditCatId(null)
    setCatName('')
    setCatDesc('')
    setCatTargetCategoryIds([])
    const isAdd = activeTab === 'ADDITIONS'
    setIsCatAddition(isAdd)
    if (isAdd) {
      const mainCats = categories.filter(c => !isAdditionCategory(c.name, c.description))
      setCatTargetCategoryIds(mainCats.map(c => c.id))
    }
    setCatDialogOpen(true)
  }

  const openEditCategory = (cat: MenuCategory) => {
    setEditCatId(cat.id)
    setCatName(cat.name)
    const { targetCategoryIds, cleanDesc } = parseTargetCategories(cat.description)
    const isAdd = isAdditionCategory(cat.name, cat.description)
    setIsCatAddition(isAdd)
    setCatDesc(cleanDesc)

    const mainCats = categories.filter(c => !isAdditionCategory(c.name, c.description))
    const isPizza = isPizzaAdditionCategory(cat.name)

    if (targetCategoryIds.length > 0) {
      setCatTargetCategoryIds(targetCategoryIds)
    } else {
      if (isPizza) {
        const pizzaCats = mainCats.filter(c => c.name.toLowerCase().includes('pizza')).map(c => c.id)
        setCatTargetCategoryIds(pizzaCats.length > 0 ? pizzaCats : mainCats.map(c => c.id))
      } else {
        setCatTargetCategoryIds(mainCats.map(c => c.id))
      }
    }
    setCatDialogOpen(true)
  }

  const saveCategory = async () => {
    if (!catName.trim()) return
    setCatSaving(true)
    try {
      const fullDesc = isCatAddition 
        ? encodeTargetCategories(catDesc.trim(), catTargetCategoryIds, true)
        : catDesc.trim().replace(/\[IS_ADDITION\]\s*/g, '').replace(/^\[TARGETS:[^\]]*\]\s*/s, '')
      if (editCatId) {
        await api.put(`/menu/categories/${editCatId}`, { name: catName.trim(), description: fullDesc })
      } else {
        await api.post('/menu/categories', { name: catName.trim(), description: fullDesc })
      }
      setCatDialogOpen(false)
      if (isCatAddition) {
        setActiveTab('ADDITIONS')
      } else if (activeTab === 'ADDITIONS' && !isCatAddition) {
        setActiveTab('PRODUCTS')
      }
      loadData()
    } catch (err: any) {
      alerts.error('Error al guardar', err.message || 'Error guardando categoría')
    } finally {
      setCatSaving(false)
    }
  }

  const deleteCategory = async (id: string) => {
    const ok = await alerts.confirm(
      '¿Eliminar Categoría?',
      '¿Estás seguro de que deseas eliminar permanentemente esta categoría del menú?',
      'Sí, eliminar',
      'Cancelar'
    )
    if (!ok) return
    try {
      const res: any = await api.delete(`/menu/categories/${id}?force=true`)
      alerts.success('Categoría eliminada', res?.data?.message || 'La categoría ha sido eliminada del menú.')
      loadData()
    } catch (err: any) {
      alerts.error('Error al eliminar', err.response?.data?.message || err.message || 'Error eliminando categoría')
    }
  }

  const moveCategory = async (catId: string, direction: 'UP' | 'DOWN') => {
    const idx = categories.findIndex(c => c.id === catId)
    if (idx === -1) return
    const targetIdx = direction === 'UP' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= categories.length) return

    const newCats = [...categories]
    const temp = newCats[idx]
    newCats[idx] = newCats[targetIdx]
    newCats[targetIdx] = temp

    const reorderedIds = newCats.map(c => c.id)
    try {
      await api.post('/menu/categories/reorder', { ids: reorderedIds })
      loadData()
    } catch (err: any) {
      console.error(err)
      alerts.error('Error', 'No se pudo reordenar la categoría')
    }
  }

  const toggleItemActive = async (itemId: string, currentActive: boolean) => {
    try {
      await api.put(`/menu/items/${itemId}`, { active: !currentActive })
      loadData()
      alerts.success('Estado actualizado', `El producto ahora está ${!currentActive ? 'activo' : 'inactivo'}`)
    } catch (err: any) {
      alerts.error('Error', err.message || 'Error al cambiar disponibilidad')
    }
  }

  // --- Product Actions ---
  const resetProductForm = () => {
    setEditProductId(null)
    setProdName('')
    const allCodes = allProducts.map(p => parseInt(p.code || '')).filter(n => !isNaN(n))
    const maxCode = allCodes.length > 0 ? Math.max(...allCodes) : 0
    const nextCode = maxCode > 0 ? String(maxCode + 1) : String(allProducts.length + 1)
    setProdCode(nextCode)
    setProdType('NORMAL')
    setProdPrice('')
    setProdDesc('')
    setProdCatId(categories[0]?.id || '')
    setProdImage(null)
    setProdPrepTime('10')
    setProdAvailableForDelivery(true)
    setDialogTab('DETAILS')
    setComboItemsList([])
    setRecipeItems([{ ingredientId: '', quantity: '1', wastePercentage: '0', unit: 'unidad' }])
  }

  const openNewProduct = () => {
    resetProductForm()
    if (activeTab === 'ADDITIONS') {
      const firstAddCat = categories.find(c => isAdditionCategory(c.name, c.description))
      if (firstAddCat) setProdCatId(firstAddCat.id)
      setProdType('ADICION')
    } else if (categoryFilter !== 'ALL') {
      const selectedCat = categories.find(c => c.id === categoryFilter)
      if (selectedCat) {
        setProdCatId(selectedCat.id)
        if (isAdditionCategory(selectedCat.name, selectedCat.description)) setProdType('ADICION')
      }
    } else {
      const firstMainCat = categories.find(c => !isAdditionCategory(c.name, c.description))
      if (firstMainCat) setProdCatId(firstMainCat.id)
    }
    setProductDialogOpen(true)
  }

  const openEditProduct = (item: MenuItem) => {
    setEditProductId(item.id)
    setProdName(item.name)
    setProdCode(item.code || '')
    const cat = categories.find(c => c.id === item.categoryId)
    const isCatAddition = cat ? isAdditionCategory(cat.name, cat.description) : false
    setProdType((item.type as any) === 'ADICION' || isCatAddition ? 'ADICION' : ((item.type as any) || 'NORMAL'))
    setProdPrice(String(item.price))
    setProdDesc(item.description || '')
    setProdCatId(item.categoryId)
    setProdImage(item.image || null)
    setProdPrepTime(String((item as any).prepTime ?? 10))
    setProdAvailableForDelivery(item.availableForDelivery !== false)
    setDialogTab('DETAILS')

    if (item.comboItems && Array.isArray(item.comboItems)) {
      setComboItemsList(item.comboItems.map(ci => ({ itemId: ci.itemId, quantity: String(ci.quantity) })))
    } else {
      setComboItemsList([])
    }

    if (item.recipe?.items?.length) {
      setRecipeItems(item.recipe.items.map((ri: any) => ({
        ingredientId: ri.ingredientId || ri.ingredient?.id || '',
        quantity: String(ri.quantity),
        wastePercentage: String(ri.wastePercentage || 0),
        unit: ri.unit || ri.ingredient?.unit || 'unidad'
      })))
    } else {
      setRecipeItems([{ ingredientId: '', quantity: '1', wastePercentage: '0', unit: 'unidad' }])
    }
    setProductDialogOpen(true)
  }

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { alert('La imagen no debe superar 2MB'); return }
    const reader = new FileReader()
    reader.onload = (ev) => setProdImage(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  const saveProduct = async () => {
    if (!prodName.trim()) {
      alert('El nombre del producto es obligatorio.')
      return
    }
    if (!prodCode.trim()) {
      alert('El código del producto es obligatorio.')
      return
    }
    let finalPrice = parseFloat(prodPrice)
    if (prodType === 'COMBO' && (!prodPrice || isNaN(finalPrice))) {
      finalPrice = comboSuggestedRegularPrice
    }

    if (isNaN(finalPrice) || finalPrice < 0) {
      alert('El precio de venta debe ser un número válido.')
      return
    }

    if (!prodCatId) {
      alert('La categoría es obligatoria.')
      return
    }

    setProdSaving(true)
    try {
      const validComboItems = prodType === 'COMBO'
        ? comboItemsList.filter(c => c.itemId).map(c => ({ itemId: c.itemId, quantity: parseFloat(c.quantity) || 1 }))
        : null

      const payload: any = {
        name: prodName.trim(),
        code: prodCode.trim().toUpperCase(),
        price: finalPrice,
        description: prodDesc.trim(),
        categoryId: prodCatId,
        type: prodType,
        comboItems: validComboItems,
        prepTime: parseInt(prodPrepTime) || 10,
        availableForDelivery: prodAvailableForDelivery
      }
      if (prodImage !== undefined) payload.image = prodImage

      let saved: any
      if (editProductId) {
        saved = await api.put(`/menu/items/${editProductId}`, payload)
      } else {
        saved = await api.post('/menu/items', payload)
      }
 
      setProductDialogOpen(false)
      resetProductForm()
      loadData()
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'Error guardando producto'
      alerts.error('Error al guardar', msg)
    } finally {
      setProdSaving(false)
    }
  }


  const toggleDeliveryAvailability = async (product: MenuItem) => {
    const nextValue = !(product.availableForDelivery !== false)
    try {
      await api.put(`/menu/items/${product.id}`, { availableForDelivery: nextValue })
      setCategories(current => current.map(cat => ({
        ...cat,
        items: cat.items.map(it => it.id === product.id ? { ...it, availableForDelivery: nextValue } : it)
      })))
      alerts.success(
        nextValue ? 'Habilitado para domicilio' : 'Configurado como solo salón',
        nextValue
          ? `"${product.name}" ahora aparecerá en la carta de WhatsApp y domicilios.`
          : `"${product.name}" se removió de la carta de WhatsApp y domicilios.`
      )
    } catch (err: any) {
      alerts.error('Error al actualizar disponibilidad', err?.message || 'No se pudo guardar el cambio.')
    }
  }

  const deleteProduct = async (id: string) => {
    const ok = await alerts.confirm(
      '¿Eliminar Producto?',
      '¿Estás seguro de que deseas eliminar permanentemente este producto del menú?',
      'Sí, eliminar',
      'Cancelar'
    )
    if (!ok) return
    try {
      const res: any = await api.delete(`/menu/items/${id}?force=true`)
      alerts.success('Producto eliminado', res?.data?.message || 'El producto ha sido eliminado correctamente.')
      loadData()
    } catch (err: any) {
      alerts.error('Error al eliminar', err.response?.data?.message || err.message || 'Error eliminando producto')
    }
  }

  // --- Real-Time Profit & Cost Calculations ---
  const calculateItemRecipeCost = (prod: MenuItem | undefined): number => {
    if (!prod) return 0
    if (prod.type === 'COMBO') {
      let comboItems = prod.comboItems
      if (typeof comboItems === 'string') {
        try {
          comboItems = JSON.parse(comboItems)
        } catch {
          comboItems = []
        }
      }
      if (Array.isArray(comboItems) && comboItems.length) {
        return comboItems.reduce((acc, ci: any) => {
          const subProd = allProducts.find(p => p.id === ci.itemId)
          const qty = parseFloat(ci.quantity) || 0
          return acc + (calculateItemRecipeCost(subProd) * qty)
        }, 0)
      }
      return 0
    }
    if (!prod.recipe?.items?.length) return 0
    return prod.recipe.items.reduce((acc: number, ri: any) => {
      const cost = ri.ingredient?.costPerUnit ?? 
                   ingredients.find(i => i.id === (ri.ingredientId || ri.ingredient?.id))?.costPerUnit ?? 
                   0
      return acc + (cost * (ri.quantity || 0))
    }, 0)
  }

  const currentModalCost = useMemo(() => {
    if (prodType === 'COMBO') {
      return comboItemsList.reduce((acc, ci) => {
        const p = allProducts.find(item => item.id === ci.itemId)
        const qty = parseFloat(ci.quantity) || 0
        return acc + (calculateItemRecipeCost(p) * qty)
      }, 0)
    } else {
      return recipeItems.reduce((acc, ri) => {
        if (!ri.ingredientId) return acc
        const ing = ingredients.find(i => i.id === ri.ingredientId)
        const cost = ing?.costPerUnit || 0
        const qty = parseFloat(ri.quantity) || 0
        return acc + (cost * qty)
      }, 0)
    }
  }, [prodType, comboItemsList, recipeItems, ingredients, allProducts])

  const comboSuggestedRegularPrice = useMemo(() => {
    if (prodType !== 'COMBO') return 0
    return comboItemsList.reduce((acc, ci) => {
      const p = allProducts.find(item => item.id === ci.itemId)
      const qty = parseFloat(ci.quantity) || 0
      return acc + ((p?.price || 0) * qty)
    }, 0)
  }, [prodType, comboItemsList, allProducts])

  const currentPriceNum = parseFloat(prodPrice) || (prodType === 'COMBO' ? comboSuggestedRegularPrice : 0)
  const currentProfit = currentPriceNum - currentModalCost
  const currentMargin = currentPriceNum > 0 ? (currentProfit / currentPriceNum) * 100 : 0

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-40 gap-4">
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}>
        <div className="h-12 w-12 rounded-full border-[3px] border-[var(--accent)] border-t-transparent shadow-lg shadow-[var(--accent)]/20" />
      </motion.div>
      <p className="text-sm text-[var(--text-muted)] animate-pulse">Cargando catálogo de productos...</p>
    </div>
  )

  return (
    <motion.div className="space-y-7" initial="hidden" animate="visible" variants={stagger}>
      
      <motion.header className="flex flex-col gap-4 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm sm:p-5 xl:flex-row xl:items-center xl:justify-between" variants={fadeUp}>
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)] ring-1 ring-[var(--accent)]/20">
            <PackagePlus className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--accent)]">Catálogo y operación</p>
            <h1 className="truncate text-2xl font-black text-[var(--text-primary)] sm:text-3xl">Productos y menú</h1>
            <p className="mt-1 text-xs text-[var(--text-secondary)] sm:text-sm">Administra platos, combos, adiciones, precios, recetas y categorías.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-center">
            <p className="text-[9px] font-black uppercase tracking-wide text-[var(--text-muted)]">Productos</p>
            <p className="text-lg font-black leading-none text-[var(--text-primary)]">{mainProducts.length}</p>
          </div>
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-1.5 text-center">
            <p className="text-[9px] font-black uppercase tracking-wide text-[var(--text-muted)]">Categorías</p>
            <p className="text-lg font-black leading-none text-[var(--text-primary)]">{categories.length}</p>
          </div>
          <Button onClick={openNewCategory} variant="outline" className="h-10 rounded-xl border-[var(--border-default)] px-3 text-xs font-bold hover:bg-[var(--bg-hover)]">
            <FolderPlus className="mr-1.5 h-4 w-4" /> Categoría
          </Button>
          <Button onClick={openNewProduct} className="h-10 rounded-xl bg-[var(--accent)] px-4 text-xs font-black text-[var(--accent-fg)] shadow-sm hover:bg-[var(--accent-hover)]">
            <Plus className="mr-1.5 h-4 w-4" /> Nuevo producto
          </Button>
        </div>
      </motion.header>

      <motion.section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-1.5 shadow-sm" variants={fadeUp}>
        <div className="flex w-full flex-wrap gap-1">
          <button
            type="button"
            onClick={() => { setActiveTab('PRODUCTS'); setCategoryFilter('ALL'); }}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition ${activeTab === 'PRODUCTS' ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'}`}
          >
            <UtensilsCrossed className="h-4 w-4" /> Productos ({mainProducts.length})
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab('ADDITIONS'); setCategoryFilter('ALL'); }}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition ${activeTab === 'ADDITIONS' ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'}`}
          >
            <PlusCircle className="h-4 w-4" /> Adiciones ({additionProducts.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('CATEGORIES')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition ${activeTab === 'CATEGORIES' ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'}`}
          >
            <Layers className="h-4 w-4" /> Categorías ({categories.length})
          </button>
        </div>
      </motion.section>

      {/* ── PRODUCTS TAB CONTENT ── */}
      {(activeTab === 'PRODUCTS' || activeTab === 'ADDITIONS') && (
        <motion.div variants={fadeUp} className="space-y-4">
          <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <label className="relative block w-full lg:max-w-xl">
                <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-[var(--text-muted)]">Buscar en el catálogo</span>
                <Search className="absolute bottom-3 left-3 h-4 w-4 text-[var(--text-muted)]" />
                <Input
                  className="h-10 w-full rounded-xl border-[var(--border-subtle)] bg-[var(--bg-elevated)] pl-9 pr-9 text-xs focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Nombre, código, descripción o categoría..."
                />
                {search && <button type="button" onClick={() => setSearch('')} className="absolute bottom-2 right-2 rounded-md p-1 text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" aria-label="Limpiar búsqueda"><X className="h-4 w-4" /></button>}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs font-bold text-[var(--text-secondary)]">{activeCatalogProducts}/{catalogProducts.length} disponibles</span>
                <button type="button" onClick={() => setShowFinancialDetails(current => !current)} className={`inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-black transition ${showFinancialDetails ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]' : 'border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}>
                  <DollarSign className="h-4 w-4" /> {showFinancialDetails ? 'Ocultar costos' : 'Ver costos y utilidad'}
                </button>
              </div>
            </div>

            <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
              <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-[var(--text-muted)]">Filtrar categoría</p>
              <div className="flex gap-2 overflow-x-auto pb-1 custom-horizontal-scrollbar">
                <button
                  type="button"
                  onClick={() => setCategoryFilter('ALL')}
                  className={`shrink-0 rounded-xl px-3 py-2 text-xs font-black transition ${categoryFilter === 'ALL' ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm' : 'border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}
                >
                  Todas <span className="ml-1 opacity-75">{catalogProducts.length}</span>
                </button>
                {tabCategories.map(category => {
                  const count = catalogProducts.filter(product => product.categoryId === category.id).length
                  const isActive = categoryFilter === category.id
                  return (
                    <button key={category.id} type="button" onClick={() => setCategoryFilter(category.id)} className={`shrink-0 rounded-xl px-3 py-2 text-xs font-bold transition ${isActive ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm' : 'border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'}`}>
                      {category.name} <span className="ml-1 opacity-75">{count}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          <div className="w-full min-w-0">
            <style>{`
              .custom-horizontal-scrollbar::-webkit-scrollbar { height: 8px !important; }
              .custom-horizontal-scrollbar::-webkit-scrollbar-track { background: transparent !important; }
              .custom-horizontal-scrollbar::-webkit-scrollbar-thumb { background: var(--border-default) !important; border-radius: 9999px !important; }
              .custom-horizontal-scrollbar::-webkit-scrollbar-thumb:hover { background: var(--border-subtle) !important; }
              
              .custom-vertical-scrollbar::-webkit-scrollbar { width: 8px !important; }
              .custom-vertical-scrollbar::-webkit-scrollbar-track { background: transparent !important; }
              .custom-vertical-scrollbar::-webkit-scrollbar-thumb { background: var(--border-default) !important; border-radius: 9999px !important; }
              .custom-vertical-scrollbar::-webkit-scrollbar-thumb:hover { background: var(--border-subtle) !important; }
            `}</style>
            
            <Card className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-sm">
              <div className="max-h-[calc(100vh-320px)] min-h-[360px] w-full overflow-auto custom-horizontal-scrollbar custom-vertical-scrollbar">
              <table className="w-full min-w-[620px] table-fixed text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] text-[11px] font-black uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-subtle)]/50">
                    <th className={`px-4 py-3 font-black ${showFinancialDetails ? 'w-[32%]' : 'w-[62%]'}`}>Producto</th>
                    <th className="w-[15%] px-3.5 py-3 text-right font-black">Precio</th>
                    {showFinancialDetails && <th className="w-[15%] px-3.5 py-3 text-right font-black">Costo</th>}
                    {showFinancialDetails && <th className="w-[15%] px-3.5 py-3 text-right font-black">Utilidad</th>}
                    <th className="w-[13%] px-3.5 py-3 text-center font-black">Estado</th>
                    <th className="w-[10%] px-3.5 py-3 text-center font-black">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  <AnimatePresence>
                    {groupedProducts.map(group => (
                      <Fragment key={group.id}>
                        {/* Section Header Row */}
                        <tr className="bg-[var(--bg-subtle)]/50 border-y border-[var(--border-subtle)]">
                          <td colSpan={showFinancialDetails ? 6 : 4} className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
                              <span className="font-extrabold text-[11px] uppercase tracking-wider text-[var(--accent)]">
                                {group.categoryName}
                              </span>
                              <span className="text-[9px] text-[var(--text-muted)] font-bold">
                                ({group.products.length} {group.products.length === 1 ? 'producto' : 'productos'})
                              </span>
                            </div>
                          </td>
                        </tr>

                        {/* Products in this category */}
                        {group.products.map(product => {
                          const recipeCost = calculateItemRecipeCost(product)
                          const basePrice = product.price / 1.08
                          const profit = basePrice - recipeCost
                          const marginPct = basePrice > 0 ? (profit / basePrice) * 100 : 0
                          const isCombo = product.type === 'COMBO'
                          const isAdicion = product.type === 'ADICION'

                          return (
                            <motion.tr
                              key={product.id}
                              layout
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className="hover:bg-[var(--bg-hover)] transition-colors group"
                            >
                              {/* Column 1: Name */}
                              <td className="min-w-0 px-4 py-3">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  {product.image ? (
                                    <img src={product.image} alt={product.name} className="h-9 w-9 rounded-xl object-cover border border-[var(--border-subtle)] shrink-0 shadow-sm" />
                                  ) : (
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-muted)]/50 border border-[var(--accent)]/20 text-[var(--accent)] shadow-sm">
                                      {isCombo ? <Box className="h-4 w-4" /> : isAdicion ? <PlusCircle className="h-4 w-4" /> : <UtensilsCrossed className="h-4 w-4" />}
                                    </div>
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                      <span className="font-extrabold text-xs text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors truncate block">
                                        {product.name}
                                      </span>
                                      {isCombo && (
                                        <span className="text-[8px] font-black uppercase tracking-wider text-purple-600 dark:text-purple-400 bg-purple-500/10 px-1.5 py-0.2 rounded-full shrink-0">
                                          Combo
                                        </span>
                                      )}
                                      {isAdicion && (
                                        <span className="text-[8px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-400 bg-blue-500/10 px-1.5 py-0.2 rounded-full shrink-0">
                                          Adición
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                                      {product.code && (
                                        <span className="font-mono text-[9px] font-bold text-amber-500 bg-amber-500/10 px-1 py-0.2 rounded-md shrink-0">
                                          {product.code}
                                        </span>
                                      )}
                                      <span className="text-[9px] font-bold text-blue-500 bg-blue-500/10 px-1 py-0.2 rounded-md shrink-0 flex items-center gap-0.5" title="Tiempo de preparación">
                                        <Clock className="h-2.5 w-2.5" /> {product.prepTime || 10} min
                                      </span>
                                      {product.availableForDelivery === false && (
                                        <span className="text-[9px] font-black uppercase tracking-wider text-rose-600 dark:text-rose-400 bg-rose-500/10 px-1.5 py-0.2 rounded-md shrink-0 flex items-center gap-0.5" title="Exclusivo salón - No se incluye en carta de WhatsApp ni domicilios">
                                          Solo Salón
                                        </span>
                                      )}
                                      {product.description && (
                                        <span className="text-[10px] text-[var(--text-muted)] truncate block" title={product.description}>
                                          {product.description}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              {/* Column 2: Price */}
                              <td className="px-3.5 py-3 text-right font-black text-xs text-[var(--accent)] tabular-nums">
                                {formatCurrency(product.price)}
                              </td>

                              {showFinancialDetails && (
                                <td className="px-3.5 py-3 text-right font-black text-xs text-[var(--text-secondary)] tabular-nums">
                                  {formatCurrency(recipeCost)}
                                </td>
                              )}

                              {showFinancialDetails && (
                                <td className="px-3.5 py-3 text-right">
                                  <div className={`text-xs font-black ${profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                    {formatCurrency(profit)}
                                  </div>
                                  <div className="text-[10px] font-extrabold text-[var(--text-muted)]">{marginPct.toFixed(0)}% margen</div>
                                </td>
                              )}

                              {/* Column 6: Status */}
                              <td className="px-3.5 py-3 text-center">
                                <button 
                                  onClick={() => toggleItemActive(product.id, product.active)}
                                  className={`text-[9px] font-black tracking-wider uppercase px-2 py-0.5 rounded-md border cursor-pointer transition-all hover:scale-105 active:scale-95 ${
                                  product.active 
                                    ? 'border-emerald-500/20 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 hover:bg-emerald-500/10' 
                                    : 'border-neutral-500/20 text-neutral-500 bg-neutral-500/5 hover:bg-neutral-500/10'
                                }`}>
                                  {product.active ? 'Activo' : 'Agotado'}
                                </button>
                              </td>

                              {/* Column 7: Actions */}
                              <td className="px-3.5 py-3 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => void toggleDeliveryAvailability(product)}
                                    className={cn(
                                      "h-7 w-7 p-0 rounded-lg cursor-pointer transition-colors",
                                      product.availableForDelivery !== false
                                        ? "text-emerald-600 hover:bg-emerald-500/15"
                                        : "text-amber-600 hover:bg-amber-500/15 bg-amber-500/10"
                                    )}
                                    title={
                                      product.availableForDelivery !== false
                                        ? "Habilitado en domicilios (clic para marcar como solo salón)"
                                        : "Solo salón / No domicilio (clic para habilitar en domicilios)"
                                    }
                                  >
                                    <Bike className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => openEditProduct(product)} className="h-7 w-7 p-0 rounded-lg text-[var(--accent)] hover:bg-[var(--accent-muted)] cursor-pointer">
                                    <Edit className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => deleteProduct(product.id)} className="h-7 w-7 p-0 rounded-lg text-[var(--destructive)] hover:bg-[var(--destructive)]/10 cursor-pointer">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </td>
                            </motion.tr>
                          )
                        })}
                      </Fragment>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>

              {filteredProducts.length === 0 && (
                <div className="py-16 text-center">
                  <PackagePlus className="h-12 w-12 text-[var(--text-muted)] mx-auto mb-3 opacity-40" />
                  <p className="text-sm font-semibold text-[var(--text-secondary)]">No se encontraron productos.</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Intenta cambiar de categoría o agregar uno nuevo.</p>
                </div>
              )}
            </div>
          </Card>
          </div>
        </motion.div>
      )}

      {/* ── CATEGORIES TAB CONTENT ── */}
      {activeTab === 'CATEGORIES' && (
        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-4 shadow-sm sm:flex-row sm:items-end sm:justify-between">
            <label className="relative block w-full sm:max-w-md">
              <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wide text-[var(--text-muted)]">Buscar categoría</span>
              <Search className="absolute bottom-3 left-3 h-4 w-4 text-[var(--text-muted)]" />
              <Input
                className="h-10 w-full rounded-xl border-[var(--border-subtle)] bg-[var(--bg-elevated)] pl-9 pr-4 text-xs focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15"
                value={catSearch}
                onChange={e => setCatSearch(e.target.value)}
                placeholder="Nombre o descripción de la categoría..."
              />
            </label>
            <span className="w-fit rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs font-bold text-[var(--text-secondary)]">
              Mostrando {filteredCategories.length} de {categories.length} categorías
            </span>
          </section>

          <motion.div variants={fadeUp} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredCategories.map(category => {
              const { cleanDesc } = parseTargetCategories(category.description)
              const isAdd = isAdditionCategory(category.name, category.description)
              return (
                <Card key={category.id} className="overflow-hidden rounded-2xl border-[var(--border-subtle)] bg-[var(--bg-panel)] shadow-sm transition hover:border-[var(--border-default)]">
                  <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 p-4 pb-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-base font-extrabold text-[var(--text-primary)]">{category.name}</CardTitle>
                        {isAdd && (
                          <span className="rounded-full border border-[var(--accent)]/20 bg-[var(--accent)]/10 px-2 py-0.5 text-[10px] font-extrabold text-[var(--accent)]">
                            Adición
                          </span>
                        )}
                      </div>
                      <CardDescription className="mt-1 line-clamp-2 text-xs text-[var(--text-muted)]">{cleanDesc || 'Sin descripción'}</CardDescription>
                    </div>
                    <Badge className="shrink-0 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-0.5 text-xs font-bold text-[var(--text-secondary)]">
                      {category.items?.length || 0} ítems
                    </Badge>
                  </CardHeader>
              <CardContent className="mt-1 flex justify-between gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/50 p-3">
                <div className="flex gap-1 items-center">
                  <Button size="sm" variant="ghost" onClick={() => moveCategory(category.id, 'UP')} className="h-8 w-8 rounded-lg p-0 text-[var(--text-muted)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)]">
                    <ChevronLeft className="h-4 w-4 rotate-90" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => moveCategory(category.id, 'DOWN')} className="h-8 w-8 rounded-lg p-0 text-[var(--text-muted)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)]">
                    <ChevronRight className="h-4 w-4 rotate-90" />
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => openEditCategory(category)} className="h-8 gap-1.5 rounded-lg px-3 text-xs font-bold text-[var(--text-primary)] hover:bg-[var(--bg-panel)]">
                    <Edit className="h-3 w-3" /> Editar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteCategory(category.id)} className="h-8 gap-1.5 rounded-lg px-3 text-xs font-bold text-[var(--destructive)] hover:bg-[var(--destructive)]/10">
                    <Trash2 className="h-3 w-3" /> Eliminar
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
        </motion.div>
        </div>
      )}

      {/* ── PRODUCT CREATION / EDITING DIALOG ── */}
      <Dialog open={productDialogOpen} onOpenChange={setProductDialogOpen}>
        <DialogContent className="max-w-4xl bg-[var(--bg-panel)] border-[var(--border-default)] rounded-3xl p-4 sm:p-5 shadow-2xl h-[520px] max-h-[88vh] flex flex-col overflow-hidden">
          {/* Unified Header with Title and Tabs in one single row */}
          <div className="flex-shrink-0 border-b border-[var(--border-subtle)]/60 pb-2.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-[var(--accent-muted)] text-[var(--accent)] shrink-0">
                <PackagePlus className="h-4.5 w-4.5" />
              </div>
              <h3 className="text-base font-black text-[var(--text-primary)] tracking-tight">
                {editProductId ? 'Editar Producto' : 'Nuevo Producto / Combo'}
              </h3>
            </div>

            <div className="mr-8 flex gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 shrink-0">
              <button
                type="button"
                onClick={() => setDialogTab('DETAILS')}
                className={`py-1 px-3 text-xs font-extrabold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${dialogTab === 'DETAILS' ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
              >
                <Tags className="h-3.5 w-3.5" /> Datos
              </button>

              {prodType === 'COMBO' ? (
                <button
                  type="button"
                  onClick={() => setDialogTab('COMBO')}
                  className={`py-1 px-3 text-xs font-extrabold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${dialogTab === 'COMBO' ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >
                  <Box className="h-3.5 w-3.5" /> Ítems ({comboItemsList.filter(c => c.itemId).length})
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setDialogTab('RECIPE')}
                  className={`py-1 px-3 text-xs font-extrabold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${dialogTab === 'RECIPE' ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >
                  <ChefHat className="h-3.5 w-3.5" /> Receta ({recipeItems.filter(r => r.ingredientId).length})
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto pr-1 space-y-3 custom-scrollbar h-full">
            {dialogTab === 'DETAILS' ? (
              <div className="py-1">
                {/* Compact 2-Column Grid Layout */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  
                  {/* LEFT COLUMN: Main classification & commercial pricing */}
                  <div className="space-y-2.5 bg-[var(--bg-elevated)]/30 p-3.5 rounded-2xl border border-[var(--border-subtle)]">
                    <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--accent)] flex items-center gap-1">
                      <Barcode className="h-3.5 w-3.5" /> Clasificación Comercial
                    </h4>

                    <div>
                      <Label className="text-[11px] font-bold text-[var(--text-secondary)]">Tipo de Producto *</Label>
                      <Select value={prodType} onValueChange={(v: any) => {
                        setProdType(v)
                        if (v === 'ADICION') {
                          const addCats = categories.filter(c => isAdditionCategory(c.name, c.description))
                          if (addCats.length > 0 && !addCats.some(c => c.id === prodCatId)) {
                            setProdCatId(addCats[0].id)
                          }
                        } else {
                          const mainCats = categories.filter(c => !isAdditionCategory(c.name, c.description))
                          if (mainCats.length > 0 && !mainCats.some(c => c.id === prodCatId)) {
                            setProdCatId(mainCats[0].id)
                          }
                        }
                      }}>
                        <SelectTrigger className="mt-1 bg-[var(--bg-panel)] border-[var(--border-subtle)] rounded-xl text-xs font-bold text-[var(--accent)] h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-default)]">
                          <SelectItem value="NORMAL">Producto</SelectItem>
                          <SelectItem value="COMBO">Combo</SelectItem>
                          <SelectItem value="ADICION">Adición</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-[11px] font-bold text-[var(--text-secondary)]">Nombre del Producto *</Label>
                      <Input
                        value={prodName}
                        onChange={e => setProdName(e.target.value)}
                        placeholder="Ej. Pizza Personal Especial"
                        className="mt-1 bg-[var(--bg-panel)] border-[var(--border-subtle)] rounded-xl text-xs font-bold h-9 focus:border-[var(--accent)]"
                      />
                    </div>

                    <div>
                      <Label className="text-[11px] font-bold text-[var(--text-secondary)]">Código Único *</Label>
                      <Input
                        value={prodCode}
                        onChange={e => setProdCode(e.target.value.toUpperCase())}
                        placeholder="Ej. PZ01"
                        className="mt-1 bg-[var(--bg-panel)] border-[var(--border-subtle)] focus:border-[var(--accent)] rounded-xl text-xs font-mono tracking-wider uppercase font-extrabold h-9"
                      />
                    </div>

                    {prodType !== 'COMBO' && (
                      <div>
                        <Label className="text-[11px] font-bold text-[var(--text-secondary)] flex items-center justify-between">
                          <span>Precio de Venta ($ COP) *</span>
                          {prodPrice && !isNaN(parseFloat(prodPrice)) && (
                            <span className="text-[10px] font-extrabold text-[var(--accent)]">
                              {formatCurrency(parseFloat(prodPrice))}
                            </span>
                          )}
                        </Label>
                        <CurrencyInput
                          value={prodPrice}
                          onChange={v => setProdPrice(v)}
                          placeholder="20.000"
                          prefixSymbol={true}
                          className="mt-1 bg-[var(--bg-panel)] border-[var(--border-subtle)] rounded-xl text-xs font-black text-[var(--accent)] h-9"
                        />
                      </div>
                    )}
                  </div>

                  {/* RIGHT COLUMN: Category, Description & Image */}
                  <div className="space-y-2.5 bg-[var(--bg-elevated)]/30 p-3.5 rounded-2xl border border-[var(--border-subtle)]">
                    <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--accent)] flex items-center gap-1">
                      <Layers className="h-3.5 w-3.5" /> Ubicación y Presentación
                    </h4>

                    <div>
                      <Label className="text-[11px] font-bold text-[var(--text-secondary)]">Categoría del Menú *</Label>
                      <Select value={prodCatId} onValueChange={setProdCatId}>
                        <SelectTrigger className="mt-1 bg-[var(--bg-panel)] border-[var(--border-subtle)] rounded-xl text-xs font-bold h-9">
                          <SelectValue placeholder="Seleccionar categoría" />
                        </SelectTrigger>
                        <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-default)]">
                          {availableCategoriesForProduct.map(c => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-[11px] font-bold text-[var(--text-secondary)]">Descripción del Producto</Label>
                      <Input
                        value={prodDesc}
                        onChange={e => setProdDesc(e.target.value)}
                        placeholder="Ingredientes principales o preparación..."
                        className="mt-1 bg-[var(--bg-panel)] border-[var(--border-subtle)] rounded-xl text-xs h-9"
                      />
                    </div>

                    <div>
                      <Label className="text-[11px] font-bold text-[var(--text-secondary)]">Tiempo de Preparación (Minutos) *</Label>
                      <Input
                        type="number"
                        min="0"
                        value={prodPrepTime}
                        onChange={e => setProdPrepTime(e.target.value)}
                        placeholder="10"
                        className="mt-1 bg-[var(--bg-panel)] border-[var(--border-subtle)] rounded-xl text-xs h-9 font-bold focus:border-[var(--accent)]"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)]">
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Bike className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
                            <Label className="text-xs font-bold text-[var(--text-primary)] cursor-pointer" onClick={() => setProdAvailableForDelivery(v => !v)}>
                              Disponible para Domicilio
                            </Label>
                          </div>
                          <p className="text-[9px] text-[var(--text-muted)] leading-tight">
                            Incluir en carta de WhatsApp y domicilios. Desmárcalo si es de vidrio o solo salón.
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={prodAvailableForDelivery}
                          onClick={() => setProdAvailableForDelivery(v => !v)}
                          className={cn(
                            'h-6 px-2.5 rounded-lg text-[10px] font-black transition shrink-0 border cursor-pointer',
                            prodAvailableForDelivery
                              ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : 'border-slate-400/30 bg-slate-500/10 text-[var(--text-secondary)]'
                          )}
                        >
                          {prodAvailableForDelivery ? 'Sí (Domicilio)' : 'No (Solo Salón)'}
                        </button>
                      </div>
                    </div>

                    <div>
                      <Label className="text-[11px] font-bold text-[var(--text-secondary)]">Imagen de Presentación</Label>
                      <div className="flex items-center gap-3 mt-1 p-2 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)]">
                        {prodImage ? (
                          <div className="relative shrink-0">
                            <img src={prodImage} alt="Preview" className="h-11 w-11 rounded-lg object-cover border border-[var(--border-subtle)] shadow-sm" />
                            <button type="button" onClick={() => setProdImage(null)} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 shadow hover:scale-110 transition-transform">
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="h-11 w-11 rounded-lg bg-[var(--bg-elevated)] border border-dashed border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-muted)] shrink-0">
                            <ImageIcon className="h-4 w-4" />
                          </div>
                        )}
                        <div className="flex-1 space-y-0.5">
                          <input type="file" ref={fileInputRef} onChange={handleImageChange} accept="image/*" className="hidden" />
                          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} className="rounded-lg text-[11px] font-bold border-[var(--border-subtle)] h-7 px-2.5">
                            {prodImage ? 'Cambiar Foto' : 'Subir Foto'}
                          </Button>
                          <p className="text-[9px] text-[var(--text-muted)] leading-none">Formatos JPG, PNG, WEBP. Max 2MB</p>
                        </div>
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            ) : dialogTab === 'COMBO' ? (
              <div className="space-y-3 py-1">
                <div className="bg-[var(--bg-elevated)]/40 p-3.5 rounded-2xl border border-[var(--border-subtle)] space-y-3">
                  {/* Top Bar: Combo Sale Price & Add Product Button */}
                  <div className="flex flex-wrap items-center justify-between gap-3 p-2.5 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)]">
                    <div className="flex items-center gap-2 flex-1 min-w-[240px]">
                      <Label className="text-xs font-black text-[var(--accent)] shrink-0">Precio Venta Combo ($)</Label>
                      <CurrencyInput
                        value={prodPrice}
                        onChange={v => setProdPrice(v)}
                        placeholder={`Auto: ${formatCurrency(comboSuggestedRegularPrice || 0)}`}
                        prefixSymbol={true}
                        className="h-8.5 w-40 bg-[var(--bg-elevated)] border-[var(--accent)] rounded-lg text-xs font-black text-[var(--accent)]"
                      />
                      {comboSuggestedRegularPrice > 0 && Number(prodPrice) !== comboSuggestedRegularPrice && (
                        <button
                          type="button"
                          onClick={() => setProdPrice(String(comboSuggestedRegularPrice))}
                          className="text-[10px] text-[var(--accent)] underline font-bold hover:opacity-80 shrink-0"
                          title="Restablecer al precio suma de la carta"
                        >
                          Usar suma carta ({formatCurrency(comboSuggestedRegularPrice)})
                        </button>
                      )}
                    </div>

                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setComboItemsList([...comboItemsList, { itemId: '', quantity: '1' }])}
                      className="bg-[var(--accent)] text-[var(--accent-fg)] rounded-lg text-xs font-extrabold h-8.5 px-3 gap-1.5 shadow-sm cursor-pointer shrink-0"
                    >
                      <Plus className="h-3.5 w-3.5" /> Agregar Producto
                    </Button>
                  </div>

                  {comboItemsList.length === 0 ? (
                    <div className="py-12 text-center text-xs text-[var(--text-muted)] border border-dashed border-[var(--border-subtle)] rounded-xl">
                      No has agregado ningún producto al combo todavía. Haz clic en <strong>"+ Agregar Producto"</strong> arriba.
                    </div>
                  ) : (
                    /* Vista Amplia de Ítems sin corte de buscador */
                    <div className="space-y-2.5 max-h-[320px] overflow-y-auto pr-1.5 pb-40 custom-scrollbar">
                      {comboItemsList.map((item, idx) => {
                        const selectedProd = allProducts.find(p => p.id === item.itemId)
                        const qty = Number(item.quantity) || 0
                        const rowTotal = selectedProd ? selectedProd.price * qty : 0

                        return (
                          <div key={idx} className="flex items-center gap-2.5 bg-[var(--bg-panel)] p-2.5 rounded-xl border border-[var(--border-subtle)] shadow-sm relative z-[15]">
                            <div className="flex-1 min-w-[220px]">
                              <SearchableSelect
                                options={allProducts
                                  .filter(p => p.id !== editProductId && p.type !== 'COMBO')
                                  .map(p => ({
                                    id: p.id,
                                    name: p.name,
                                    price: p.price,
                                    code: p.code
                                  }))}
                                value={item.itemId}
                                onChange={(v: string) => {
                                  const newList = [...comboItemsList]
                                  newList[idx].itemId = v
                                  setComboItemsList(newList)
                                }}
                                placeholder="Escribe para buscar plato o bebida..."
                              />
                              {selectedProd && (
                                <div className="text-[10px] text-[var(--text-muted)] mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                                  <span className="font-semibold text-[var(--accent)]">
                                    Costo Receta: {formatCurrency(calculateItemRecipeCost(selectedProd))}
                                  </span>
                                  <span>•</span>
                                  <span>Receta: {selectedProd.recipe ? 'Configurada' : 'Sin Receta'}</span>
                                  {selectedProd.recipe?.items?.length ? (
                                    <>
                                      <span>•</span>
                                      <span>Ingredientes: {selectedProd.recipe.items.length}</span>
                                    </>
                                  ) : null}
                                </div>
                              )}
                            </div>

                            <div className="w-22 shrink-0">
                              <div className="relative">
                                <Input
                                  type="number"
                                  placeholder="Cant"
                                  value={item.quantity}
                                  onChange={e => {
                                    const newList = [...comboItemsList]
                                    newList[idx].quantity = e.target.value
                                    setComboItemsList(newList)
                                  }}
                                  className="h-9 bg-[var(--bg-elevated)] border-[var(--border-subtle)] rounded-lg text-xs font-bold text-center pr-5"
                                />
                                <span className="absolute right-1.5 top-2.5 text-[9px] text-[var(--text-muted)] font-bold">ud</span>
                              </div>
                            </div>

                            <div className="w-24 text-right px-1 shrink-0">
                              <span className="text-[9px] text-[var(--text-muted)] block leading-none">Subtotal:</span>
                              <span className="text-xs font-black text-[var(--text-primary)]">{formatCurrency(rowTotal)}</span>
                            </div>

                            <button
                              type="button"
                              onClick={() => setComboItemsList(comboItemsList.filter((_, i) => i !== idx))}
                              className="text-[var(--destructive)] p-1.5 hover:bg-red-500/10 rounded-lg transition-colors shrink-0 cursor-pointer"
                              title="Eliminar del combo"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3 py-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-[var(--text-secondary)] font-medium">Vincula ingredientes para que se descuenten del inventario con cada venta.</p>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setRecipeItems([...recipeItems, { ingredientId: '', quantity: '1', wastePercentage: '0', unit: 'unidad' }])}
                    className="bg-[var(--accent)] text-[var(--accent-fg)] rounded-xl text-xs font-bold h-8 px-3 gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" /> Agregar Ingrediente
                  </Button>
                </div>

                <div className="space-y-2.5">
                  {recipeItems.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-[var(--bg-elevated)] p-2.5 rounded-2xl border border-[var(--border-subtle)]">
                      <div className="flex-1 min-w-[200px]">
                        <SearchableSelect
                          options={ingredients.map((i: any) => ({
                            id: i.id,
                            name: `${i.name} (${i.unit})`,
                            code: i.code
                          }))}
                          value={item.ingredientId}
                          onChange={(v: string) => {
                            const newItems = [...recipeItems]
                            const ing = ingredients.find(i => i.id === v)
                            newItems[idx].ingredientId = v
                            if (ing) newItems[idx].unit = ing.unit || 'unidad'
                            setRecipeItems(newItems)
                          }}
                          placeholder="Buscar ingrediente..."
                        />
                      </div>

                      <div className="w-24">
                        <Input
                          type="number"
                          placeholder="Cant"
                          value={item.quantity}
                          onChange={e => {
                            const newItems = [...recipeItems]
                            newItems[idx].quantity = e.target.value
                            setRecipeItems(newItems)
                          }}
                          className="h-9 bg-[var(--bg-panel)] border-[var(--border-subtle)] rounded-xl text-xs font-bold text-center"
                        />
                      </div>

                      <div className="h-9 w-20 flex items-center justify-center bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-xl text-xs font-black text-[var(--text-secondary)] uppercase px-2 shrink-0 select-none">
                        {ingredients.find(i => i.id === item.ingredientId)?.unit || item.unit || 'unidad'}
                      </div>

                      <button
                        type="button"
                        onClick={() => setRecipeItems(recipeItems.filter((_, i) => i !== idx))}
                        className="text-[var(--destructive)] p-1.5 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Compact Integrated Footer */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-[var(--border-subtle)]/60 mt-2 flex-shrink-0">
            <div className="flex items-center gap-2 flex-wrap">
              {dialogTab !== 'DETAILS' && (
                <Button type="button" variant="outline" onClick={() => setDialogTab('DETAILS')} className="rounded-xl text-xs font-bold border-[var(--border-subtle)] h-9 px-3 gap-1.5">
                  ← Volver a Datos
                </Button>
              )}

              {/* Ultra-compact financial summary pill directly in footer for all product types */}
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[10px] font-bold">
                <span className="text-[var(--text-muted)]">Insumos: <strong className="text-[var(--text-primary)]">{formatCurrency(currentModalCost)}</strong></span>
                <span className="text-[var(--border-subtle)]">|</span>
                <span className="text-[var(--text-muted)]">Margen: <strong className={currentProfit >= 0 ? 'text-emerald-500' : 'text-red-500'}>{formatCurrency(currentProfit)} ({currentMargin.toFixed(0)}%)</strong></span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {dialogTab === 'DETAILS' && (
                prodType === 'COMBO' ? (
                  <Button type="button" variant="outline" onClick={() => setDialogTab('COMBO')} className="border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-muted)] rounded-xl text-xs font-extrabold px-3.5 h-9 gap-1 cursor-pointer">
                    <Box className="h-3.5 w-3.5" /> Configurar combo
                  </Button>
                ) : (
                  <Button type="button" variant="outline" onClick={() => setDialogTab('RECIPE')} className="border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-muted)] rounded-xl text-xs font-extrabold px-3.5 h-9 gap-1 cursor-pointer">
                    <ChefHat className="h-3.5 w-3.5" /> Receta e insumos
                  </Button>
                )
              )}

              <Button type="button" onClick={saveProduct} disabled={prodSaving} className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] rounded-xl text-xs font-extrabold px-4.5 h-9 gap-1.5 shadow-md shadow-[var(--accent)]/20 cursor-pointer">
                {prodSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {editProductId ? 'Guardar Cambios' : (prodType === 'COMBO' ? 'Guardar Combo' : 'Crear Producto')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── CATEGORY CREATION / EDITING DIALOG ── */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent className="max-w-md bg-[var(--bg-panel)] border-[var(--border-default)] rounded-3xl p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-[var(--text-primary)] flex items-center gap-2">
              <FolderPlus className="h-5 w-5 text-[var(--accent)]" />
              {editCatId ? 'Editar Categoría' : 'Nueva Categoría'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Toggle para marcar si es categoría de adiciones (ARRRIBA) */}
            <div>
              <label className="flex items-center gap-2.5 cursor-pointer p-3 rounded-2xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] hover:border-[var(--accent)]/50 transition-all select-none">
                <input
                  type="checkbox"
                  checked={isCatAddition}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setIsCatAddition(checked)
                    if (checked && catTargetCategoryIds.length === 0) {
                      const mainCats = categories.filter(c => !isAdditionCategory(c.name, c.description))
                      setCatTargetCategoryIds(mainCats.map(c => c.id))
                    }
                  }}
                  className="rounded text-[var(--accent)] accent-[var(--accent)] h-4 w-4 shrink-0"
                />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="text-xs font-extrabold text-[var(--text-primary)]">Categoría de adiciones</span>
                  <span className="text-[10px] text-[var(--text-muted)]">Permite asociar y mostrar esta adición a las categorías que elijas al tomar pedidos</span>
                </div>
              </label>
            </div>

            <div>
              <Label className="text-xs font-bold text-[var(--text-secondary)]">Nombre de Categoría *</Label>
              <Input
                value={catName}
                onChange={e => setCatName(e.target.value)}
                placeholder="Ej. Hamburguesas, Bebidas..."
                className="mt-1.5 bg-[var(--bg-elevated)] border-[var(--border-subtle)] rounded-xl text-xs font-bold"
              />
            </div>
            <div>
              <Label className="text-xs font-bold text-[var(--text-secondary)]">Descripción</Label>
              <Input
                value={catDesc}
                onChange={e => setCatDesc(e.target.value)}
                placeholder="Descripción opcional"
                className="mt-1.5 bg-[var(--bg-elevated)] border-[var(--border-subtle)] rounded-xl text-xs"
              />
            </div>

            {/* Target Dish Categories Selector for Addition Categories */}
            {(isCatAddition || isAdditionCategory(catName, catDesc)) && (
              <div className="pt-2 border-t border-[var(--border-subtle)] space-y-2 animate-in fade-in duration-200">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-extrabold text-[var(--accent)] flex items-center gap-1">
                    Platos vinculados
                  </Label>
                  <button
                    type="button"
                    onClick={() => {
                      const mainCats = categories.filter(c => !isAdditionCategory(c.name, c.description)).map(c => c.id)
                      if (catTargetCategoryIds.length === mainCats.length) {
                        setCatTargetCategoryIds([])
                      } else {
                        setCatTargetCategoryIds(mainCats)
                      }
                    }}
                    className="text-[10px] font-bold text-[var(--accent)] hover:underline cursor-pointer"
                  >
                    {catTargetCategoryIds.length === categories.filter(c => !isAdditionCategory(c.name, c.description)).length ? 'Desmarcar todo' : 'Marcar todas'}
                  </button>
                </div>
                <p className="text-[10px] text-[var(--text-muted)]">
                  Marca las categorías de platos del menú que mostrarán esta adición al presionar + Adición en el pedido:
                </p>
                <div className="max-h-44 overflow-y-auto border border-[var(--border-subtle)] rounded-2xl p-2.5 bg-[var(--bg-elevated)]/50 space-y-1.5 custom-vertical-scrollbar">
                  {categories.filter(c => !isAdditionCategory(c.name, c.description)).map(c => {
                    const isChecked = catTargetCategoryIds.includes(c.id)
                    return (
                      <label key={c.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-[var(--bg-panel)] cursor-pointer text-xs font-bold text-[var(--text-primary)] transition-colors border border-transparent hover:border-[var(--border-subtle)]">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setCatTargetCategoryIds([...catTargetCategoryIds, c.id])
                            } else {
                              setCatTargetCategoryIds(catTargetCategoryIds.filter(id => id !== c.id))
                            }
                          }}
                          className="rounded text-[var(--accent)] accent-[var(--accent)] h-4 w-4 shrink-0"
                        />
                        <span>{c.name}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--border-subtle)] mt-2">
            <Button type="button" variant="ghost" onClick={() => setCatDialogOpen(false)} className="rounded-xl text-xs font-bold">
              Cancelar
            </Button>
            <Button type="button" onClick={saveCategory} disabled={catSaving} className="bg-[var(--accent)] text-[var(--accent-fg)] rounded-xl text-xs font-bold px-5 h-10 gap-2">
              {catSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editCatId ? 'Guardar' : 'Crear'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </motion.div>
  )
}
