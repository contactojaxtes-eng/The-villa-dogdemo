import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { Link } from 'react-router-dom'
import {
  UtensilsCrossed, Search, Layers, ChevronDown, ChevronUp, ChefHat, Flame, Sparkles,
  Beef, Salad, IceCream, Pizza, Fish, Soup, CupSoda, CookingPot, PackagePlus, Barcode,
  CheckCircle2, XCircle, ArrowUp, ArrowDown, ExternalLink
} from 'lucide-react'

interface MenuItem {
  id: string
  name: string
  code?: string | null
  description: string | null
  price: number
  image: string | null
  active: boolean
}

interface MenuCategory {
  id: string
  name: string
  description: string | null
  active: boolean
  sortOrder: number
  items: MenuItem[]
}

const fadeUp = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] as const } } }
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } }

const categoryColors = ['#F97316', '#3B82F6', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1']

function getCategoryColor(name: string, index: number) {
  const normalized = name.toLowerCase().trim()
  if (normalized.includes('pizza')) return '#EF4444'
  if (normalized.includes('hamburguesa')) return '#F59E0B'
  if (normalized.includes('perro') || normalized.includes('suizo')) return '#F97316'
  if (normalized.includes('patacon')) return '#8B5CF6'
  if (normalized.includes('picada')) return '#EC4899'
  if (normalized.includes('salchipapa') || normalized.includes('salvajada')) return '#3B82F6'
  if (normalized.includes('bebida') || normalized.includes('jugo') || normalized.includes('gaseosa')) return '#14B8A6'
  if (normalized.includes('asado') || normalized.includes('carne') || normalized.includes('chuzo')) return '#10B981'
  return categoryColors[index % categoryColors.length]
}

function getFoodIcon(name: string, catName = '') {
  const text = `${name} ${catName}`.toLowerCase()
  if (/burger|hamburgues|smash|doble|sencilla|especial/.test(text)) return Beef
  if (/pizza|piza/.test(text)) return Pizza
  if (/pollo|chicken|alita|wing|broaster/.test(text)) return Flame
  if (/bebid|jugo|limonad|gaseosa|refresco|sodas|agua|té|te|shake|malteada|smoothie/.test(text)) return CupSoda
  if (/ensalada|ensalad|cesar|vegetal|vegetarian|verdura/.test(text)) return Salad
  if (/papa|papas|frita|arepa|yuca|tostada|salchipapa|salvajada/.test(text)) return Flame
  if (/patacon|platano/.test(text)) return CookingPot
  if (/asado|carne|chuzo|lomo|bife|costilla|cerdo|res/.test(text)) return Flame
  if (/sopa|caldo|crema|sancocho/.test(text)) return Soup
  if (/postre|helado|torta|brownie|cheesecake|dulce/.test(text)) return IceCream
  if (/pez|pescado|camarón|camaron|mariscos|salmón|salmon/.test(text)) return Fish
  return ChefHat
}

export default function MenuPage() {
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [collapsedCats, setCollapsedCats] = useState<Record<string, boolean>>({})
  const [menuView, setMenuView] = useState<'PRODUCTS' | 'ADDITIONS'>('PRODUCTS')

  const isAdditionName = (name: string) => {
    const lower = name.toLowerCase()
    return lower.includes('adicional') || lower.includes('adicion') || lower.includes('adición') || lower.includes('topping')
  }

  const loadCategories = () => {
    setLoading(true)
    api.get<MenuCategory[]>('/menu/categories?includeInactive=true')
      .then(setCategories)
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadCategories() }, [])

  const viewCategories = useMemo(() => {
    return categories.filter(c => menuView === 'ADDITIONS' ? isAdditionName(c.name) : !isAdditionName(c.name))
  }, [categories, menuView])

  const filteredCategories = useMemo(() => {
    const rawQ = search.trim()
    const normalize = (str: string) => (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    const qNorm = normalize(rawQ)
    const tokens = qNorm.split(/\s+/).filter(Boolean)

    return viewCategories
      .filter(cat => !rawQ ? (categoryFilter === 'ALL' || cat.id === categoryFilter) : true)
      .map(cat => {
        if (tokens.length === 0) return cat
        const catNorm = normalize(cat.name)
        const catMatches = tokens.every(token => catNorm.includes(token))

        const matchingItems = (cat.items || []).filter(item => {
          const nameNorm = normalize(item.name)
          const codeNorm = normalize(item.code || '')
          const descNorm = normalize(item.description || '')
          const itemText = `${nameNorm} ${codeNorm} ${descNorm}`
          return tokens.every(token => itemText.includes(token))
        })

        if (catMatches) return cat
        if (matchingItems.length > 0) return { ...cat, items: matchingItems }
        return null
      })
      .filter(Boolean) as MenuCategory[]
  }, [viewCategories, search, categoryFilter])

  const toggleCategoryCollapse = (catId: string) => {
    setCollapsedCats(prev => ({ ...prev, [catId]: !prev[catId] }))
  }

  const toggleItemActive = async (itemId: string, currentActive: boolean) => {
    try {
      await api.put(`/menu/items/${itemId}`, { active: !currentActive })
      setCategories(prev => prev.map(cat => ({
        ...cat,
        items: cat.items.map(item => item.id === itemId ? { ...item, active: !currentActive } : item)
      })))
    } catch (err: any) {
      alert(err.message || 'Error al cambiar disponibilidad')
    }
  }

  const moveCategory = async (catId: string, direction: 'UP' | 'DOWN') => {
    const idx = viewCategories.findIndex(c => c.id === catId)
    if (idx === -1) return
    const targetIdx = direction === 'UP' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= viewCategories.length) return

    const newCats = [...viewCategories]
    const temp = newCats[idx]
    newCats[idx] = newCats[targetIdx]
    newCats[targetIdx] = temp

    const reorderedIds = newCats.map(c => c.id)
    try {
      await api.post('/menu/categories/reorder', { ids: reorderedIds })
      loadCategories()
    } catch (err: any) {
      console.error(err)
    }
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-40 gap-4">
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }}>
        <div className="h-12 w-12 rounded-full border-[3px] border-[var(--accent)] border-t-transparent shadow-lg shadow-[var(--accent)]/20" />
      </motion.div>
      <p className="text-sm text-[var(--text-muted)] animate-pulse">Cargando la carta del restaurante...</p>
    </div>
  )

  return (
    <motion.div className="space-y-6" initial="hidden" animate="visible" variants={stagger}>
      
      {/* ── Top Bar ── */}
      <motion.div className="flex flex-wrap items-center justify-between gap-4" variants={fadeUp}>
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl shadow-lg shadow-[var(--accent)]/20" style={{ background: 'linear-gradient(135deg, var(--accent), #FBBF24)' }}>
            <UtensilsCrossed className="h-6 w-6 text-[var(--accent-fg)]" />
          </div>
          <div>
            <h2 className="antifont text-4xl tracking-wider text-[var(--text-primary)] leading-none">MENÚ Y CARTA</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Consulta la disponibilidad de platos, precios y reordena la carta.</p>
          </div>
        </div>

        <Link to="/products">
          <Button className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold rounded-xl h-11 px-5 text-xs gap-2 shadow-lg shadow-[var(--accent)]/20">
            <PackagePlus className="h-4.5 w-4.5" /> Administrar Productos / Recetas <ExternalLink className="h-3.5 w-3.5 opacity-70" />
          </Button>
        </Link>
      </motion.div>

      {/* ── Tabs & Search ── */}
      <motion.div className="flex flex-wrap items-center justify-between gap-4" variants={fadeUp}>
        <div className="flex rounded-2xl bg-[var(--bg-panel)] p-1.5 border border-[var(--border-subtle)] shadow-sm">
          <button
            type="button"
            onClick={() => { setMenuView('PRODUCTS'); setCategoryFilter('ALL'); }}
            className={`flex items-center gap-2 px-5 py-2.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${menuView === 'PRODUCTS' ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-md' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
          >
            <UtensilsCrossed className="h-4 w-4" /> Carta de Platos
          </button>
          <button
            type="button"
            onClick={() => { setMenuView('ADDITIONS'); setCategoryFilter('ALL'); }}
            className={`flex items-center gap-2 px-5 py-2.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${menuView === 'ADDITIONS' ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-md' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
          >
            <Sparkles className="h-4 w-4" /> Adicionales & Toppings
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative group min-w-[260px]">
            <Search className="absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)] group-focus-within:text-[var(--accent)] transition-colors" />
            <Input
              className="rounded-xl border-[var(--border-subtle)] bg-[var(--bg-panel)] py-2 pl-10 pr-4 text-xs focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15 transition-all shadow-sm"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar plato o por código..."
            />
          </div>

          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-52 h-9 bg-[var(--bg-panel)] border-[var(--border-subtle)] rounded-xl text-xs font-bold">
              <SelectValue placeholder="Filtrar por categoría" />
            </SelectTrigger>
            <SelectContent className="bg-[var(--bg-panel)] border-[var(--border-default)]">
              <SelectItem value="ALL">Todas las categorías</SelectItem>
              {viewCategories.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </motion.div>

      {/* ── Category Cards List ── */}
      <div className="space-y-6">
        {filteredCategories.map((category, catIdx) => {
          const isCollapsed = !!collapsedCats[category.id]
          const catColor = getCategoryColor(category.name, catIdx)

          return (
            <motion.div key={category.id} variants={fadeUp} className="space-y-3">
              {/* Category Header Bar */}
              <div className="flex items-center justify-between rounded-2xl bg-[var(--bg-panel)] px-5 py-3 border border-[var(--border-subtle)] shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="h-3.5 w-3.5 rounded-full shadow-sm" style={{ backgroundColor: catColor }} />
                  <h3 className="text-base font-extrabold text-[var(--text-primary)] tracking-wide">{category.name}</h3>
                  <Badge variant="outline" className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-secondary)]">
                    {category.items?.length || 0} productos
                  </Badge>
                </div>

                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => moveCategory(category.id, 'UP')} disabled={catIdx === 0} className="h-8 w-8 p-0 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => moveCategory(category.id, 'DOWN')} disabled={catIdx === filteredCategories.length - 1} className="h-8 w-8 p-0 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleCategoryCollapse(category.id)} className="h-8 w-8 p-0 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] ml-1">
                    {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {/* Items Grid */}
              {!isCollapsed && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {category.items.map(item => {
                    const FoodIcon = getFoodIcon(item.name, category.name)
                    return (
                      <Card key={item.id} className={`group relative overflow-hidden rounded-2xl border transition-all ${item.active ? 'bg-[var(--bg-panel)] border-[var(--border-subtle)] hover:border-[var(--accent)]/40 hover:shadow-md' : 'bg-[var(--bg-elevated)]/50 border-red-500/20 opacity-75'}`}>
                        <CardContent className="p-3.5 flex items-start gap-3">
                          {item.image ? (
                            <img src={item.image} alt={item.name} className="h-14 w-14 rounded-xl object-cover border border-[var(--border-subtle)] shrink-0" />
                          ) : (
                            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-muted)]/40 text-[var(--accent)]">
                              <FoodIcon className="h-6 w-6" />
                            </div>
                          )}

                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-1">
                              <h4 className="font-bold text-xs text-[var(--text-primary)] truncate">{item.name}</h4>
                              <span className="font-extrabold text-xs text-[var(--accent)] tabular-nums shrink-0">{formatCurrency(item.price)}</span>
                            </div>

                            {item.code && (
                              <div className="mt-1">
                                <span className="inline-flex items-center gap-1 font-mono text-[10px] font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                                  <Barcode className="h-3 w-3" /> {item.code}
                                </span>
                              </div>
                            )}

                            {item.description && (
                              <p className="text-[11px] text-[var(--text-muted)] mt-1 line-clamp-1">{item.description}</p>
                            )}

                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--border-subtle)]/40">
                              <span className={`text-[10px] font-bold flex items-center gap-1 ${item.active ? 'text-emerald-500' : 'text-red-500'}`}>
                                {item.active ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                                {item.active ? 'Disponible' : 'Agotado'}
                              </span>

                              <Button
                                size="sm"
                                variant={item.active ? "outline" : "default"}
                                onClick={() => toggleItemActive(item.id, item.active)}
                                className={`h-6 text-[10px] font-bold rounded-lg px-2.5 ${item.active ? 'border-red-500/30 text-red-500 hover:bg-red-500/10' : 'bg-[var(--accent)] text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] border-0 cursor-pointer'}`}
                              >
                                {item.active ? 'Marcar Agotado' : 'Habilitar'}
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              )}
            </motion.div>
          )
        })}

        {filteredCategories.length === 0 && (
          <div className="py-20 text-center bg-[var(--bg-panel)] rounded-3xl border border-[var(--border-subtle)]">
            <UtensilsCrossed className="h-12 w-12 text-[var(--text-muted)] mx-auto mb-3 opacity-40" />
            <p className="text-sm font-semibold text-[var(--text-secondary)]">No hay platos para mostrar en este filtro.</p>
          </div>
        )}
      </div>

    </motion.div>
  )
}
