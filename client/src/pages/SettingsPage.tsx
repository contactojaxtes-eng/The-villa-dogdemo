import { useState, useEffect } from 'react'
import { io } from 'socket.io-client'
import { PageHeader } from '@/components/ui/PageHeader'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { brand } from '@/lib/brand'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { PrinterSettings, DualPrinterSettings, openCashDrawer } from '@/lib/printer'
import { Store, Palette, Moon, Sun, CheckCircle2, MessageCircle, Printer, Wifi, AlertTriangle, Key, Terminal, Headphones, Usb, Upload, FileText, Trash2, Edit2, UserCircle, Globe, Link2, Copy, ExternalLink, Clock, QrCode } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { motion } from 'framer-motion'
import { connectUsbPrinter, disconnectUsbPrinter, getUsbDevice, printUsb, buildEscPosBuffer, autoReconnectUsbDevices } from '@/lib/useUsbPrinter'
import { alerts } from '@/lib/alerts'
import { SecurityActionConfirmModal } from '@/components/auth/SecurityActionConfirmModal'

const settingsKey = 'niche-restaurant-settings'

type RestaurantSettings = {
  name: string
  address: string
  phone: string
  hours: string
  instagram: string
  nit: string
}

const defaultSettings: RestaurantSettings = {
  name: 'THE VILLA DOG',
  address: 'Montería, Córdoba',
  phone: brand.contact.phones.join(' / '),
  hours: 'Lunes a Domingo 11:00 AM - 10:00 PM',
  instagram: brand.contact.instagram,
  nit: '901928696',
}

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } }
} as const

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 22 } }
} as const

function loadSettings(): RestaurantSettings {
  try {
    const stored = localStorage.getItem(settingsKey)
    return stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings
  } catch {
    return defaultSettings
  }
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('restaurant');
  const { user, hasRole, hasPermission } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [settings, setSettings] = useState(loadSettings)
  const [saved, setSaved] = useState(false)

  const [uploadingMenu, setUploadingMenu] = useState(false)

  const [digitalMenuUrl, setDigitalMenuUrl] = useState('')
  const [savingDigitalMenu, setSavingDigitalMenu] = useState(false)
  const [digitalMenuSaved, setDigitalMenuSaved] = useState(false)
  const [digitalMenuCopied, setDigitalMenuCopied] = useState(false)

  // Security action confirmation modal state (style Meta/2FA)
  const [showSecurityModal, setShowSecurityModal] = useState(false)
  const [pendingSecurityAction, setPendingSecurityAction] = useState<{
    actionName: string
    onExecute: () => void | Promise<void>
  } | null>(null)

  const triggerSecurityAction = (actionName: string, onExecute: () => void | Promise<void>) => {
    setPendingSecurityAction({ actionName, onExecute })
    setShowSecurityModal(true)
  }

  useEffect(() => {
    api.get<any>('/whatsapp/settings').then(s => {
      if (s && s.digitalMenuUrl) setDigitalMenuUrl(s.digitalMenuUrl)
    }).catch(() => {})
  }, [])


  const defaultBarSettings: PrinterSettings = { mode: 'network', ip: '', port: 9100, paper: '80', name: 'Bar / Bebidas' }
  const [printer, setPrinter] = useState<DualPrinterSettings>({
    caja: { mode: 'browser', ip: '', port: 9100, paper: '80', name: 'Caja' },
    cocina: { mode: 'network', ip: '', port: 9100, paper: '80', name: 'Cocina', id: 'cocina', categories: [] },
    bar: { mode: 'network', ip: '', port: 9100, paper: '80', name: 'Bar / Bebidas', id: 'bar', categories: [] },
    printers: [],
    autoPrint: true,
    mode: 'browser', ip: '', port: 9100, paper: '80', name: 'Comanda'
  })
  const [printerSaved, setPrinterSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [openingDrawer, setOpeningDrawer] = useState(false)
  const [uploadingPaymentQr, setUploadingPaymentQr] = useState(false)
  const [waSettings, setWaSettings] = useState<{
    phoneId: string
    token: string
    businessPhone: string
    chatbotEnabled: boolean
    configured: boolean
    menuFileName?: string | null
    menuFileMime?: string | null
    paymentQrName?: string | null
    paymentQrMime?: string | null
    geminiApiKey?: string
    geminiRequestsToday?: number
    businessHoursEnabled?: boolean
    outOfServiceEnabled?: boolean
    outOfServiceMessage?: string
    menuFileCaption?: string
    paymentQrCaption?: string
  }>({
    phoneId: '',
    token: '',
    businessPhone: '',
    chatbotEnabled: true,
    configured: false,
    menuFileName: null,
    menuFileMime: null,
    menuFileCaption: '',
    paymentQrName: null,
    paymentQrMime: null,
    paymentQrCaption: '',
    geminiApiKey: '',
    geminiRequestsToday: 0,
  })
  const [categoriesList, setCategoriesList] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [usbDeviceNames, setUsbDeviceNames] = useState<Record<string, string>>({})
  const [isUsbConnecting, setIsUsbConnecting] = useState(false)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isClearingQueue, setIsClearingQueue] = useState(false)
  const [formPrinter, setFormPrinter] = useState<PrinterSettings>({
    id: '',
    name: '',
    mode: 'network',
    ip: '',
    port: 9100,
    paper: '80',
    categories: []
  })

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      try {
        const pr = await api.get<DualPrinterSettings>('/print/settings').catch(() => null)
        if (pr) {
          setPrinter(pr)
          if ((pr as any).restaurant) {
            setSettings((pr as any).restaurant)
          }
        }
        const cats = await api.get<{ id: string; name: string }[]>('/menu/categories?includeInactive=true')
          .catch(() => api.get<{ id: string; name: string }[]>('/public-menu/categories'))
          .catch(() => [])
        if (cats && Array.isArray(cats)) setCategoriesList(cats)

        // Detectar targets configurados en modo USB para reconectarlos automáticamente
        const usbTargets: string[] = []
        if (pr) {
          if (pr.caja?.mode === 'usb') {
            usbTargets.push('caja')
          }
          if (pr.printers) {
            for (const p of pr.printers) {
              if (p.id && p.mode === 'usb') {
                usbTargets.push(p.id)
              }
            }
          }
        }

        // Ejecutar reconexión silenciosa
        const reconnectedMap = await autoReconnectUsbDevices(usbTargets)

        const usbMap: Record<string, string> = { ...reconnectedMap }
        const devCaja = getUsbDevice('caja')
        if (devCaja) {
          usbMap['caja'] = devCaja.productName || devCaja.manufacturerName || 'Impresora USB'
        }
        if (pr && pr.printers) {
          for (const p of pr.printers) {
            if (p.id) {
              const dev = getUsbDevice(p.id)
              if (dev) {
                usbMap[p.id] = dev.productName || dev.manufacturerName || 'Impresora USB'
              }
            }
          }
        }
        setUsbDeviceNames(usbMap)

        if (user && (['ADMIN', 'SUPERADMIN'].includes(user.role) || hasPermission('settings.view') || hasPermission('settings.manage'))) {
          const wa = await api.get<any>('/whatsapp/settings').catch(() => null)
          if (wa) setWaSettings(wa)
        }


        
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    init()

    const socketUrl = import.meta.env.VITE_API_URL || window.location.origin
    const socket = io(`${socketUrl}/the-villa-dog`, { transports: ['websocket', 'polling'] })
    const handleUpdate = (updated: DualPrinterSettings) => {
      if (updated) {
        setPrinter(updated)
        if ((updated as any).restaurant) {
          setSettings((updated as any).restaurant)
        }
      }
    }
    socket.on('printerSettingsUpdated', handleUpdate)
    socket.on('settingsUpdated', handleUpdate)
    return () => {
      socket.disconnect()
    }
  }, [user])

  const saveRestaurant = () => {
    triggerSecurityAction('Guardar Datos del Restaurante y Horarios', async () => {
      localStorage.setItem(settingsKey, JSON.stringify(settings))
      try {
        await api.put('/print/settings', { ...printer, restaurant: settings })
        await api.put('/whatsapp/settings', {
          businessHoursEnabled: waSettings.businessHoursEnabled,
          outOfServiceEnabled: waSettings.outOfServiceEnabled,
          outOfServiceMessage: waSettings.outOfServiceMessage,
          restaurantHours: settings.hours,
          menuFileCaption: waSettings.menuFileCaption,
          paymentQrCaption: waSettings.paymentQrCaption,
        })
        setSaved(true)
        alerts.success('Configuración Guardada', 'Los datos del restaurante y horarios han sido actualizados.')
        setTimeout(() => setSaved(false), 2500)
      } catch (err: any) {
        alerts.error('Error al guardar', err.message || 'No se pudo guardar la configuración')
      }
    })
  }

  const savePrinter = () => {
    triggerSecurityAction('Guardar Configuración General de Impresoras', async () => {
      try {
        await api.put('/print/settings', printer)
        setPrinterSaved(true)
        alerts.success('Configuración Guardada', 'La configuración de impresoras ha sido guardada exitosamente.')
        setTimeout(() => setPrinterSaved(false), 2500)
      } catch (err: any) {
        alerts.error('Error al guardar', err.message || 'No se pudo guardar las impresoras')
      }
    })
  }

  const handleOpenAddDialog = () => {
    setFormPrinter({
      id: `printer_${Date.now()}`,
      name: '',
      mode: 'network',
      ip: '',
      port: 9100,
      paper: '80',
      categories: [],
      type: 'estacion'
    } as any)
    setIsDialogOpen(true)
  }

  const handleOpenEditDialog = (p: PrinterSettings) => {
    const rawCats = p.categories || []
    const cleanCatIds = Array.from(new Set(
      rawCats.map(catRef => {
        const found = categoriesList.find(c => c.id === catRef || c.name === catRef)
        return found ? found.id : catRef
      })
    ))
    setFormPrinter({ ...p, categories: cleanCatIds })
    setIsDialogOpen(true)
  }

  const handleSaveFormPrinter = () => {
    if (!formPrinter.name.trim()) {
      alerts.warning('Nombre Requerido', 'Por favor ingresa un nombre para la impresora.')
      return
    }
    
    let nextSettings: DualPrinterSettings
    if (formPrinter.id === 'caja') {
      nextSettings = { ...printer, caja: formPrinter }
    } else {
      let updatedPrinters: PrinterSettings[]
      const exists = printer.printers?.some(x => x.id === formPrinter.id)
      if (exists) {
        updatedPrinters = (printer.printers || []).map(x => x.id === formPrinter.id ? formPrinter : x)
      } else {
        updatedPrinters = [...(printer.printers || []), formPrinter]
      }
      nextSettings = { ...printer, printers: updatedPrinters }
    }

    const isCaja = formPrinter.id === 'caja' || (formPrinter as any).type === 'caja'
    const isNew = !isCaja && !printer.printers?.some(x => x.id === formPrinter.id)
    const actionDesc = isCaja
      ? 'Guardar Cambios en Impresora Caja'
      : isNew
      ? `Crear Nueva Estación de Impresión "${formPrinter.name}"`
      : `Modificar Estación de Impresión "${formPrinter.name}"`

    triggerSecurityAction(actionDesc, async () => {
      setPrinter(nextSettings)
      try {
        await api.put('/print/settings', nextSettings)
        setPrinterSaved(true)
        alerts.success('Impresora Guardada', `La impresora "${formPrinter.name}" fue guardada correctamente.`)
        setTimeout(() => setPrinterSaved(false), 2500)
      } catch (err: any) {
        alerts.error('Error al guardar', err.message || 'No se pudo guardar la impresora')
      }
    })
  }

  const handleDeletePrinter = (id: string) => {
    const printerToDelete = printer.printers?.find(x => x.id === id)
    const displayName = printerToDelete ? printerToDelete.name : 'esta impresora'
    
    triggerSecurityAction(`Eliminar Estación de Impresión "${displayName}"`, async () => {
      const updatedPrinters = (printer.printers || []).filter(x => x.id !== id)
      const nextSettings = { ...printer, printers: updatedPrinters }
      setPrinter(nextSettings)
      try {
        await api.put('/print/settings', nextSettings)
        alerts.success('Impresora Eliminada', `La estación "${displayName}" fue eliminada.`)
        setPrinterSaved(true)
        setTimeout(() => setPrinterSaved(false), 2500)
      } catch (err: any) {
        alerts.error('Error al eliminar', err.message || 'No se pudo eliminar la impresora')
      }
    })
  }

  const handleClearQueue = (target?: string) => {
    const actionDesc = target ? `Limpiar Cola de Impresión de "${target}"` : 'Limpiar TODA la Cola de Impresión'
    triggerSecurityAction(actionDesc, async () => {
      setIsClearingQueue(true)
      try {
        const url = target ? `/print/queue/${target}` : '/print/queue'
        const res = await api.delete<{ ok: boolean; deleted?: number; message?: string }>(url)
        alerts.success('Cola Limpiada', res.message || 'Cola de impresión limpiada con éxito.')
      } catch (err: any) {
        alerts.error('Error al limpiar cola', err.message || 'No se pudo limpiar la cola')
      } finally {
        setIsClearingQueue(false)
      }
    })
  }

  const handleConnectUsb = async (target: string) => {
    setIsUsbConnecting(true)
    const res = await connectUsbPrinter(target)
    setIsUsbConnecting(false)
    if (res.ok && res.name) {
      setUsbDeviceNames(prev => {
        const next: Record<string, string> = { ...prev }
        if (res.name) {
          next[target] = res.name
        }
        return next
      })
      if (target === 'caja') {
        setPrinter(p => {
          const next = { ...p, caja: { ...p.caja, mode: 'usb' as const } }
          api.put('/print/settings', next)
          return next
        })
      } else {
        setPrinter(p => {
          const nextPrinters = (p.printers || []).map(x => x.id === target ? { ...x, mode: 'usb' as const } : x)
          const next = { ...p, printers: nextPrinters }
          api.put('/print/settings', next)
          return next
        })
      }
    } else if (res.error) {
      await alerts.error('Error USB', res.error)
    }
  }

  const handleDisconnectUsb = async (target: string) => {
    await disconnectUsbPrinter(target)
    setUsbDeviceNames(prev => {
      const next: Record<string, string> = { ...prev }
      delete next[target]
      return next
    })
    if (target === 'caja') {
      setPrinter(p => {
        const next = { ...p, caja: { ...p.caja, mode: 'browser' as const } }
        api.put('/print/settings', next)
        return next
      })
    } else {
      setPrinter(p => {
        const nextPrinters = (p.printers || []).map(x => x.id === target ? { ...x, mode: 'browser' as const } : x)
        const next = { ...p, printers: nextPrinters }
        api.put('/print/settings', next)
        return next
      })
    }
  }

  const handleTogglePrinterActive = (printerId: string) => {
    const isCaja = printerId === 'caja'
    const targetPrinter = isCaja ? printer.caja : (printer.printers || []).find(p => p.id === printerId || p.name.toLowerCase() === printerId.toLowerCase())
    const willEnable = targetPrinter?.enabled === false
    const actionDesc = willEnable ? `Reactivar Impresora "${targetPrinter?.name || printerId}"` : `Desactivar Impresora "${targetPrinter?.name || printerId}"`

    triggerSecurityAction(actionDesc, async () => {
      setPrinter(prev => {
        let updatedPrinters: PrinterSettings[] = []
        if (printerId === 'caja') {
          const cajaEnabled = prev.caja?.enabled !== false
          const nextCaja = { ...prev.caja, enabled: !cajaEnabled }
          const nextSettings = { ...prev, caja: nextCaja }
          api.put('/print/settings', nextSettings).catch(console.error)
          return nextSettings
        } else {
          updatedPrinters = (prev.printers || []).map(p => {
            if (p.id === printerId || p.name.toLowerCase() === printerId.toLowerCase()) {
              const isCurrentlyEnabled = p.enabled !== false
              return { ...p, enabled: !isCurrentlyEnabled }
            }
            return p
          })
          const nextSettings = { ...prev, printers: updatedPrinters }
          api.put('/print/settings', nextSettings).catch(console.error)
          return nextSettings
        }
      })
      alerts.success('Estado Actualizado', `La impresora "${targetPrinter?.name || printerId}" ha sido ${willEnable ? 'reactivada' : 'desactivada'}.`)
    })
  }

  const testPrinter = async (target: string) => {
    setTesting(true)
    try {
      await api.put('/print/settings', printer)
      const printerConfig = target === 'caja'
        ? printer.caja
        : (printer.printers || []).find(p => p.id === target) || { mode: 'network', ip: '', port: 9100, paper: '80', name: 'Prueba' }

      if (printerConfig.mode === 'usb') {
        const device = getUsbDevice(target)
        if (!device) {
          await alerts.error('Impresora USB', 'Conecta primero la impresora USB haciendo clic en Vincular.')
          setTesting(false)
          return
        }
        const text = `TEST DE IMPRESION - THE VILLA DOG (${printerConfig.name.toUpperCase()})\nFuncionando correctamente via USB.\nFecha: ${new Date().toLocaleString()}\n`
        const buffer = buildEscPosBuffer(text, printerConfig.paper as any)
        const result = await printUsb(buffer, target)
        if (result.ok) {
          await alerts.success('Prueba Exitosa', 'Prueba enviada a la impresora USB silenciosamente.')
        } else {
          await alerts.error('Error USB', 'Error de impresión USB: ' + result.error)
        }
      } else {
        const r = await api.post<{ ok: boolean; error?: string; message?: string }>(`/print/test?target=${target}`)
        if (r.ok) {
          if (printerConfig.mode === 'local_bridge') {
            await alerts.success(
              'Prueba Encolada (Puente Local)',
              `La comanda de prueba para "${printerConfig.name}" fue enviada a the-villa-dog-printer-bridge.exe y saldrá en ${printerConfig.ip || 'la impresora'} en unos segundos.`
            )
          } else {
            await alerts.success('Prueba Enviada', r.message || 'Enviado a la impresora')
          }
        } else {
          await alerts.error('Error de Impresión', r.error || 'No se pudo imprimir. Revisa IP y que el servidor esté en la misma red.')
        }
      }
    } catch (e: any) {
      await alerts.error('Error', e.message)
    } finally {
      setTesting(false)
    }
  }

  const handleOpenDrawer = async () => {
    setOpeningDrawer(true)
    try {
      const res = await openCashDrawer()
      if (res.ok) {
        await alerts.success('Cajón Monedero', 'Comando de apertura enviado al cajón monedero.')
      } else {
        await alerts.error('Cajón Monedero', 'Error al abrir el cajón monedero: ' + (res.error || 'Desconocido'))
      }
    } catch (e: any) {
      await alerts.error('Error', 'Error: ' + e.message)
    } finally {
      setOpeningDrawer(false)
    }
  }

  const handleUploadMenu = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingMenu(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.post<{ ok: boolean; name: string; mimeType: string }>('/whatsapp/settings/menu-file', fd)
      if (res.ok) {
        setWaSettings(p => ({
          ...p,
          menuFileName: res.name,
          menuFileMime: res.mimeType
        }))
        alert('Menú subido correctamente.')
      } else {
        alert('Error al subir menú.')
      }
    } catch (err: any) {
      alert(err.message || 'Error al subir menú.')
    } finally {
      setUploadingMenu(false)
    }
  }



  const handleDeleteMenu = async () => {
    if (!confirm('¿Estás seguro de eliminar el menú subido? Se volverá al comportamiento por defecto (solo enlace).')) return
    try {
      await api.delete('/whatsapp/settings/menu-file')
      setWaSettings(p => ({
        ...p,
        menuFileName: null,
        menuFileMime: null
      }))
      alert('Menú eliminado.')
    } catch (err: any) {
      alert(err.message || 'Error al eliminar menú.')
    }
  }

  const handleUploadPaymentQr = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingPaymentQr(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.post<{ ok: boolean; name: string; mimeType: string }>('/whatsapp/settings/payment-qr-file', fd)
      if (res.ok) {
        setWaSettings(p => ({
          ...p,
          paymentQrName: res.name,
          paymentQrMime: res.mimeType
        }))
        alert('Código QR de pago subido correctamente.')
      } else {
        alert('Error al subir el código QR de pago.')
      }
    } catch (err: any) {
      alert(err.message || 'Error al subir el código QR de pago.')
    } finally {
      setUploadingPaymentQr(false)
    }
  }

  const handleDeletePaymentQr = async () => {
    if (!confirm('¿Estás seguro de eliminar el código QR de pago subido?')) return
    try {
      await api.delete('/whatsapp/settings/payment-qr-file')
      setWaSettings(p => ({
        ...p,
        paymentQrName: null,
        paymentQrMime: null
      }))
      alert('Código QR de pago eliminado.')
    } catch (err: any) {
      alert(err.message || 'Error al eliminar código QR de pago.')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-[var(--text-secondary)]">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}>
          <div className="h-10 w-10 rounded-full border-2 border-[var(--accent)] border-t-transparent" />
        </motion.div>
        <span className="ml-3 font-medium">Cargando configuraciones...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader title="CONFIGURACIÓN" description="Configuración del restaurante, impresoras de ticket POS, WhatsApp y apariencia general." />

      
      {/* TABS HEADER */}
      <div className="flex flex-wrap gap-2 mb-6 border-b border-[var(--border-subtle)]/40 pb-4">
        <Button 
          variant={activeTab === 'restaurant' ? 'default' : 'outline'}
          className={activeTab === 'restaurant' ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold' : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'}
          onClick={() => setActiveTab('restaurant')}
        >
          <Store className="w-4 h-4 mr-2" /> Restaurante
        </Button>
        <Button 
          variant={activeTab === 'printers' ? 'default' : 'outline'}
          className={activeTab === 'printers' ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold' : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'}
          onClick={() => setActiveTab('printers')}
        >
          <Printer className="w-4 h-4 mr-2" /> Impresoras POS
        </Button>
        <Button 
          variant={activeTab === 'theme' ? 'default' : 'outline'}
          className={activeTab === 'theme' ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold' : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'}
          onClick={() => setActiveTab('theme')}
        >
          <Palette className="w-4 h-4 mr-2" /> Apariencia
        </Button>



        {(hasRole('SUPERADMIN', 'ADMIN') || hasPermission('settings.view') || hasPermission('settings.manage')) && (
          <Button 
            variant={activeTab === 'digital-menu' ? 'default' : 'outline'}
            className={activeTab === 'digital-menu' ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold' : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'}
            onClick={() => setActiveTab('digital-menu')}
          >
            <Globe className="w-4 h-4 mr-2" /> Menu Digital
          </Button>
        )}

      </div>

      <motion.div
        key={activeTab}
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="grid gap-6 lg:grid-cols-2"
      >

        {/* Restaurant Card */}
        {activeTab === 'restaurant' && (
          <motion.div variants={itemVariants}>
            <Card className="niche-card-premium border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl overflow-hidden h-full flex flex-col">
              <CardHeader className="pb-3 border-b border-[var(--border-subtle)]/40">
                <CardTitle className="text-base font-extrabold text-[var(--text-primary)] tracking-wide uppercase flex items-center gap-2">
                  <Store className="h-5 w-5 text-[var(--accent)]" /> Datos del Restaurante
                </CardTitle>
                <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">Información de contacto que aparece impreso en las comandas.</CardDescription>
              </CardHeader>
              <CardContent className="pt-5 space-y-4 flex-1 flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Nombre Comercial</Label>
                    <Input className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] focus:ring-2 focus:ring-[var(--accent)]/20 text-[var(--text-primary)] font-bold text-sm" value={settings.name} onChange={e => setSettings(p => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">NIT del Restaurante</Label>
                    <Input className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] focus:ring-2 focus:ring-[var(--accent)]/20 text-[var(--text-primary)] font-bold text-sm" value={settings.nit || ''} onChange={e => setSettings(p => ({ ...p, nit: e.target.value }))} placeholder="Ej: 901928696" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Dirección Física</Label>
                    <Input className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] focus:ring-2 focus:ring-[var(--accent)]/20 text-[var(--text-primary)]" value={settings.address} onChange={e => setSettings(p => ({ ...p, address: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Teléfono de Contacto</Label>
                    <Input className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] focus:ring-2 focus:ring-[var(--accent)]/20 text-[var(--text-primary)]" value={settings.phone} onChange={e => setSettings(p => ({ ...p, phone: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Horario de Atención</Label>
                    <Input className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] focus:ring-2 focus:ring-[var(--accent)]/20 text-[var(--text-primary)]" value={settings.hours} onChange={e => setSettings(p => ({ ...p, hours: e.target.value }))} placeholder="Ej: 12:00 PM - 11:00 PM" />
                  </div>

                  {/* Configuración de Horarios y Fuera de Servicio para Bot de WhatsApp */}
                  <div className="space-y-3 pt-3 border-t border-[var(--border-subtle)]/40 mt-3">
                    <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-[var(--accent)]" /> Control de Horario y Servicio (Bot WhatsApp / IA)
                    </Label>

                    {/* Switch: Validar Horario */}
                    <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]/60">
                      <div className="space-y-0.5 min-w-0 pr-2">
                        <p className="text-xs font-bold text-[var(--text-primary)]">Validar Horario de Atención en Bot</p>
                        <p className="text-[10px] text-[var(--text-secondary)]">Si está activo, el Bot de WhatsApp responderá que está fuera de horario cuando escriban en horas no laborales. (Desactivado = Responde 24/7 para pruebas).</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={!!waSettings.businessHoursEnabled}
                          onChange={e => setWaSettings(prev => ({ ...prev, businessHoursEnabled: e.target.checked }))}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-[var(--bg-subtle)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--accent)] border border-[var(--border-subtle)]"></div>
                      </label>
                    </div>

                    {/* Switch: Fuera de Servicio Manual */}
                    <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)]/60">
                      <div className="space-y-0.5 min-w-0 pr-2">
                        <p className="text-xs font-bold text-[var(--text-primary)]">Restaurante Fuera de Servicio / Cerrado</p>
                        <p className="text-[10px] text-[var(--text-secondary)]">Actívalo si el restaurante cierra por mantenimiento o imprevistos.</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={!!waSettings.outOfServiceEnabled}
                          onChange={e => setWaSettings(prev => ({ ...prev, outOfServiceEnabled: e.target.checked }))}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-[var(--bg-subtle)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--accent)] border border-[var(--border-subtle)]"></div>
                      </label>
                    </div>

                    {/* Mensaje Personalizado */}
                    <div className="space-y-1.5 pt-1">
                      <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                        Mensaje Personalizado Fuera de Horario / Servicio (Opcional)
                      </Label>
                      <textarea
                        rows={2}
                        className="w-full rounded-xl bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] p-3 outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                        placeholder="Ej: Estamos cerrados por mantenimiento. Abrimos mañana a las 12:00 PM."
                        value={waSettings.outOfServiceMessage || ''}
                        onChange={e => setWaSettings(prev => ({ ...prev, outOfServiceMessage: e.target.value }))}
                      />
                      <p className="text-[9px] text-[var(--text-muted)]">Si lo dejas en blanco, el Bot responderá con un mensaje por defecto indicando el horario de atención.</p>
                    </div>
                  </div>
                </div>


                  {/* Uploader de Carta / Menú PDF / Imagen */}
                  <div className="border-t border-[var(--border-subtle)]/40 pt-4 mt-6 space-y-3">
                    <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-[var(--accent)]" /> Subir Carta / Menú de Precios
                    </Label>
                    <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
                      Sube el archivo PDF o imagen de la carta de tu restaurante. Al subirlo, podrás enviárselo directamente a los clientes en WhatsApp con un solo clic usando el botón "Enviar Carta".
                    </p>

                    {waSettings.menuFileName ? (
                      <div className="flex items-center justify-between bg-[var(--bg-elevated)] p-3 rounded-xl border border-[var(--border-subtle)]/60">
                        <div className="flex items-center gap-2 truncate">
                          <FileText className="h-5 w-5 text-[var(--accent)] shrink-0" />
                          <div className="truncate">
                            <p className="text-xs font-bold text-[var(--text-primary)] truncate">{waSettings.menuFileName}</p>
                            <p className="text-[9px] text-[var(--text-secondary)] uppercase">{waSettings.menuFileMime}</p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-500/10 rounded-lg"
                          onClick={handleDeleteMenu}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <label className="flex flex-col items-center justify-center border-2 border-dashed border-[var(--border-subtle)] hover:border-[var(--accent)]/50 bg-[var(--bg-elevated)]/30 hover:bg-[var(--bg-elevated)]/60 rounded-xl p-5 cursor-pointer transition-all text-center">
                        <Upload className="h-6 w-6 text-[var(--text-secondary)] mb-2" />
                        <span className="text-xs font-bold text-[var(--text-primary)]">
                          {uploadingMenu ? 'Subiendo archivo...' : 'Selecciona un archivo PDF o Imagen'}
                        </span>
                        <span className="text-[9px] text-[var(--text-secondary)] mt-1">Soporta PDF, PNG, JPG (máx 15MB)</span>
                        <input
                          type="file"
                          accept="application/pdf,image/*"
                          className="hidden"
                          onChange={handleUploadMenu}
                          disabled={uploadingMenu}
                        />
                      </label>
                    )}

                    <div className="space-y-1.5 pt-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
                          <MessageCircle className="h-3 w-3 text-[var(--accent)]" /> Mensaje acompañante de la Carta (Opcional)
                        </Label>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[10px] text-[var(--accent)] font-bold hover:bg-[var(--accent)]/10 rounded-lg"
                          onClick={async () => {
                            try {
                              await api.put('/whatsapp/settings', { menuFileCaption: waSettings.menuFileCaption || '' })
                              alert('Mensaje de la carta guardado correctamente.')
                            } catch (e: any) {
                              alert('Error al guardar mensaje: ' + e.message)
                            }
                          }}
                        >
                          Guardar Mensaje
                        </Button>
                      </div>
                      <textarea
                        className="w-full text-xs rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-2.5 min-h-[70px] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                        placeholder="Escribe el mensaje que se enviará en WhatsApp junto con la Carta (Ej: 🍽️ ¡Hola! Aquí tienes nuestra carta y menú de precios...)"
                        value={waSettings.menuFileCaption || ''}
                        onChange={e => setWaSettings(prev => ({ ...prev, menuFileCaption: e.target.value }))}
                        onBlur={async e => {
                          try {
                            await api.put('/whatsapp/settings', { menuFileCaption: e.target.value })
                          } catch (err) {}
                        }}
                      />
                      <p className="text-[9px] text-[var(--text-muted)]">Este texto se enviará automáticamente pegado como pie de foto/descripción del archivo al presionar "Enviar Carta".</p>
                    </div>
                  </div>

                  {/* Uploader de Código QR de Pago */}
                  <div className="border-t border-[var(--border-subtle)]/40 pt-4 mt-6 space-y-3">
                    <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
                      <QrCode className="h-3.5 w-3.5 text-indigo-500" /> Subir Código QR de Pago (Nequi / Bancolombia / Daviplata)
                    </Label>
                    <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
                      Sube la imagen del código QR de pago de tu restaurante. Al subirlo, podrás enviárselo directamente a los clientes en WhatsApp con un solo clic usando el botón "Enviar QR".
                    </p>

                    {waSettings.paymentQrName ? (
                      <div className="flex items-center justify-between bg-[var(--bg-elevated)] p-3 rounded-xl border border-[var(--border-subtle)]/60">
                        <div className="flex items-center gap-2 truncate">
                          <QrCode className="h-5 w-5 text-indigo-500 shrink-0" />
                          <div className="truncate">
                            <p className="text-xs font-bold text-[var(--text-primary)] truncate">{waSettings.paymentQrName}</p>
                            <p className="text-[9px] text-[var(--text-secondary)] uppercase">{waSettings.paymentQrMime}</p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-500/10 rounded-lg"
                          onClick={handleDeletePaymentQr}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <label className="flex flex-col items-center justify-center border-2 border-dashed border-[var(--border-subtle)] hover:border-indigo-500/50 bg-[var(--bg-elevated)]/30 hover:bg-[var(--bg-elevated)]/60 rounded-xl p-5 cursor-pointer transition-all text-center">
                        <Upload className="h-6 w-6 text-[var(--text-secondary)] mb-2" />
                        <span className="text-xs font-bold text-[var(--text-primary)]">
                          {uploadingPaymentQr ? 'Subiendo QR...' : 'Selecciona una imagen del Código QR'}
                        </span>
                        <span className="text-[9px] text-[var(--text-secondary)] mt-1">Soporta PNG, JPG, WebP (máx 10MB)</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleUploadPaymentQr}
                          disabled={uploadingPaymentQr}
                        />
                      </label>
                    )}

                    <div className="space-y-1.5 pt-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
                          <MessageCircle className="h-3 w-3 text-indigo-500" /> Mensaje acompañante del Código QR (Opcional)
                        </Label>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[10px] text-indigo-500 font-bold hover:bg-indigo-500/10 rounded-lg"
                          onClick={async () => {
                            try {
                              await api.put('/whatsapp/settings', { paymentQrCaption: waSettings.paymentQrCaption || '' })
                              alert('Mensaje del QR guardado correctamente.')
                            } catch (e: any) {
                              alert('Error al guardar mensaje: ' + e.message)
                            }
                          }}
                        >
                          Guardar Mensaje
                        </Button>
                      </div>
                      <textarea
                        className="w-full text-xs rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-2.5 min-h-[70px] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        placeholder="Escribe el mensaje que se enviará en WhatsApp junto con la imagen del QR (Ej: 📲 Escanea o descarga este código QR para transferir a nuestras cuentas...)"
                        value={waSettings.paymentQrCaption || ''}
                        onChange={e => setWaSettings(prev => ({ ...prev, paymentQrCaption: e.target.value }))}
                        onBlur={async e => {
                          try {
                            await api.put('/whatsapp/settings', { paymentQrCaption: e.target.value })
                          } catch (err) {}
                        }}
                      />
                      <p className="text-[9px] text-[var(--text-muted)]">Este texto se enviará automáticamente pegado como pie de foto de la imagen del QR al presionar "Enviar QR".</p>
                    </div>
                  </div>

                <Button
                  className="w-full h-11 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold shadow-lg shadow-[var(--accent)]/15 rounded-xl text-xs uppercase tracking-wider mt-6"
                  onClick={saveRestaurant}
                >
                  {saved ? (
                    <>
                      <CheckCircle2 className="mr-2 h-4 w-4 animate-bounce" /> Guardado Correctamente
                    </>
                  ) : (
                    'Guardar Configuración'
                  )}
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {activeTab === 'printers' && (
        <>
{/* POS Printer Card */}
        <motion.div variants={itemVariants} className="lg:col-span-2">
          <Card className="niche-card-premium border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl overflow-hidden">
            <CardHeader className="pb-3 border-b border-[var(--border-subtle)]/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="text-base font-extrabold text-[var(--text-primary)] tracking-wide uppercase flex items-center gap-2">
                  <Printer className="h-5 w-5 text-[var(--accent)]" /> Impresoras POS de Comandas y Facturas
                </CardTitle>
                <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">Configura la impresora de caja y añade estaciones de cocina o preparación ilimitadas.</CardDescription>
              </div>
              <div className="flex gap-2 shrink-0 self-start sm:self-auto">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 border-red-500/20 text-red-500 hover:bg-red-500/10 text-[10px] font-bold uppercase rounded-xl px-3 flex items-center gap-1.5"
                  onClick={() => handleClearQueue()}
                  disabled={isClearingQueue}
                >
                  🗑️ Limpiar Cola
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 border-[var(--border-default)] hover:bg-[var(--bg-hover)] text-[10px] font-bold uppercase text-[var(--text-primary)] rounded-xl px-3 flex items-center gap-1.5"
                  onClick={handleOpenAddDialog}
                >
                  ➕ Agregar Impresora
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-5 space-y-6 flex-1 flex flex-col justify-between">
              <div className="space-y-6">
                {/* General Setting: AutoPrint */}
                <label className="flex cursor-pointer items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors">
                  <div className="space-y-0.5">
                    <p className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wide">Imprimir Automáticamente</p>
                    <p className="text-[10px] text-[var(--text-secondary)] font-medium">Generar comandas y facturas de forma automática al recibir un pedido.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={printer.autoPrint !== false}
                    onChange={e => {
                      const val = e.target.checked
                      const actionDesc = val ? 'Activar Impresión Automática de Pedidos' : 'DESACTIVAR Impresión Automática de Pedidos'
                      triggerSecurityAction(actionDesc, async () => {
                        setPrinter(p => {
                          const next = { ...p, autoPrint: val }
                          api.put('/print/settings', next).catch(console.error)
                          return next
                        })
                        alerts.success('Impresión Automática', `La impresión automática ha sido ${val ? 'activada' : 'desactivada'}.`)
                      })
                    }}
                    className="h-5 w-5 accent-[var(--accent)] rounded cursor-pointer shrink-0 ml-4"
                  />
                </label>

                {/* Grid for dynamic printers */}
                <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">

                  {/* PRINTER 1: CAJA (FIXED) */}
                  {(() => {
                    const p = printer.caja
                    if (!p) return null
                    const modeLabels = {
                      browser: 'Navegador (PDF)',
                      usb: 'WebUSB Directo',
                      network: 'Red / IP',
                      local_bridge: 'Puente Local (the-villa-dog-printer-bridge.exe)'
                    }
                    return (
                      <div className="space-y-3 border border-[var(--border-subtle)]/60 rounded-2xl p-4 bg-[var(--bg-elevated)]/20 relative flex flex-col justify-between">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)]/40 gap-2">
                            <p className="text-xs font-extrabold text-[var(--accent)] uppercase tracking-wider truncate max-w-[140px]">
                              1. {p.name || 'Caja (Facturación)'}
                            </p>
                            <Badge variant="outline" className="text-[9px] uppercase font-bold py-0 bg-[var(--bg-panel)]">Caja</Badge>
                          </div>

                          <div className="space-y-1 text-xs">
                            <div className="flex justify-between">
                              <span className="text-[10px] text-[var(--text-secondary)] uppercase font-semibold">Modo:</span>
                              <span className="font-bold text-[var(--text-primary)]">{modeLabels[p.mode] || p.mode}</span>
                            </div>
                            {(p.mode === 'network' || p.mode === 'local_bridge') && (
                              <div className="flex justify-between">
                                <span className="text-[10px] text-[var(--text-secondary)] uppercase font-semibold">Dirección/IP:</span>
                                <span className="font-mono text-[var(--text-primary)] truncate max-w-[120px]">{p.ip || 'No asignada'}</span>
                              </div>
                            )}
                            {p.mode === 'usb' && (
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] text-[var(--text-secondary)] uppercase font-semibold">USB:</span>
                                <span className="font-mono text-[var(--text-primary)] max-w-[120px] truncate">
                                  {usbDeviceNames['caja'] ? (
                                    <span className="text-emerald-500 font-bold">VINCULADO: {usbDeviceNames['caja']}</span>
                                  ) : (
                                    <span className="text-amber-500 font-bold">DESCONECTADO</span>
                                  )}
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span className="text-[10px] text-[var(--text-secondary)] uppercase font-semibold">Papel:</span>
                              <span className="font-bold text-[var(--text-primary)]">{p.paper} mm</span>
                            </div>
                            <div className="pt-1.5 border-t border-[var(--border-subtle)]/20">
                              <span className="text-[10px] text-[var(--text-secondary)] uppercase font-semibold block mb-1">Categorías Impresas:</span>
                              <Badge variant="outline" className="text-[8px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 py-0 px-1 font-bold">TODAS (FACTURA COMPLETA)</Badge>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2 pt-3 border-t border-[var(--border-subtle)]/40">
                          <Button 
                            variant="outline" 
                            className="w-full h-8 border-[var(--border-default)] hover:bg-[var(--bg-hover)] text-[10px] font-bold uppercase rounded-lg"
                            onClick={() => handleOpenEditDialog({ ...p, id: 'caja' })}
                          >
                            <Edit2 className="h-3 w-3 mr-1" /> Editar
                          </Button>
                          <Button 
                            variant="outline" 
                            className="w-full border-[var(--border-default)] hover:bg-[var(--bg-hover)] text-[9px] font-extrabold uppercase rounded-lg h-7 mt-1"
                            onClick={() => testPrinter('caja')} 
                            disabled={testing}
                          >
                            {testing ? 'Probando...' : 'Probar Impresora'}
                          </Button>
                          <Button 
                            variant="outline" 
                            className="w-full border-amber-500/20 text-amber-500 hover:bg-amber-500/10 text-[9px] font-extrabold uppercase rounded-lg h-7 mt-1"
                            onClick={handleOpenDrawer} 
                            disabled={openingDrawer}
                          >
                            {openingDrawer ? 'Abriendo...' : '🗝️ Probar Monedero'}
                          </Button>
                          {p.mode === 'local_bridge' && (
                            <Button 
                              variant="outline" 
                              className="w-full border-red-500/20 text-red-500 hover:bg-red-500/10 text-[9px] font-extrabold uppercase rounded-lg h-7 mt-1"
                              onClick={() => handleClearQueue('caja')} 
                              disabled={isClearingQueue}
                            >
                              🗑️ Limpiar Cola de Caja
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })()}

                  {/* DYNAMIC PREPARATION PRINTERS */}
                  {(printer.printers || []).map((p, idx) => {
                    const modeLabels = {
                      browser: 'Navegador (PDF)',
                      usb: 'WebUSB Directo',
                      network: 'Red / IP',
                      local_bridge: 'Puente Local (the-villa-dog-printer-bridge.exe)'
                    }
                    return (
                      <div key={p.id} className="space-y-3 border border-[var(--border-subtle)]/60 rounded-2xl p-4 bg-[var(--bg-elevated)]/20 relative flex flex-col justify-between">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)]/40 gap-2">
                            <p className="text-xs font-extrabold text-[var(--accent)] uppercase tracking-wider truncate max-w-[120px]">
                              {idx + 2}. {p.name || ((p as any).type === 'caja' ? 'Caja' : 'Estación')}
                            </p>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleTogglePrinterActive(p.id!)}
                                className={cn(
                                  "text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full border transition-all cursor-pointer flex items-center gap-1",
                                  p.enabled !== false 
                                    ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/25" 
                                    : "bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25"
                                )}
                                title={p.enabled !== false ? "Haz clic para desactivar esta impresora" : "Haz clic para activar esta impresora"}
                              >
                                <span className={cn("w-1.5 h-1.5 rounded-full", p.enabled !== false ? "bg-emerald-500 animate-pulse" : "bg-red-500")} />
                                {p.enabled !== false ? "ACTIVADA" : "DESACTIVADA"}
                              </button>
                            </div>
                          </div>

                          <div className="space-y-1 text-xs">
                            <div className="flex justify-between">
                              <span className="text-[10px] text-[var(--text-secondary)] uppercase font-semibold">Modo:</span>
                              <span className="font-bold text-[var(--text-primary)]">{modeLabels[p.mode] || p.mode}</span>
                            </div>
                            {(p.mode === 'network' || p.mode === 'local_bridge') && (
                              <div className="flex justify-between">
                                <span className="text-[10px] text-[var(--text-secondary)] uppercase font-semibold">Dirección/IP:</span>
                                <span className="font-mono text-[var(--text-primary)] truncate max-w-[120px]">{p.ip || 'No asignada'}</span>
                              </div>
                            )}
                            {p.mode === 'usb' && (
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] text-[var(--text-secondary)] uppercase font-semibold">USB:</span>
                                <span className="font-mono text-[var(--text-primary)] max-w-[120px] truncate">
                                  {usbDeviceNames[p.id!] ? (
                                    <span className="text-emerald-500 font-bold">VINCULADO: {usbDeviceNames[p.id!]}</span>
                                  ) : (
                                    <span className="text-amber-500 font-bold">DESCONECTADO</span>
                                  )}
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span className="text-[10px] text-[var(--text-secondary)] uppercase font-semibold">Papel:</span>
                              <span className="font-bold text-[var(--text-primary)]">{p.paper} mm</span>
                            </div>
                            <div className="pt-1.5 border-t border-[var(--border-subtle)]/20">
                              <span className="text-[10px] text-[var(--text-secondary)] uppercase font-semibold block mb-1">Categorías Impresas:</span>
                              <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
                                {(p as any).type === 'caja' ? (
                                  <Badge variant="outline" className="text-[8px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 py-0 px-1 font-bold">TODAS (FACTURA COMPLETA)</Badge>
                                ) : !p.categories || p.categories.length === 0 ? (
                                  <Badge variant="outline" className="text-[8px] bg-amber-500/10 text-amber-500 border border-amber-500/20 py-0 px-1 font-bold">TODAS (RESTO)</Badge>
                                ) : (
                                  p.categories.map(catId => {
                                    const cat = categoriesList.find(c => String(c.id).trim() === String(catId).trim() || String(c.name).toLowerCase().trim() === String(catId).toLowerCase().trim())
                                    return (
                                      <Badge key={catId} variant="outline" className="text-[8px] bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 py-0 px-1.5 font-bold rounded">
                                        {cat ? cat.name : catId}
                                      </Badge>
                                    )
                                  })
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2 pt-3 border-t border-[var(--border-subtle)]/40">
                          <div className="grid grid-cols-2 gap-2">
                            <Button 
                              variant="outline" 
                              className="h-8 border-[var(--border-default)] hover:bg-[var(--bg-hover)] text-[10px] font-bold uppercase rounded-lg"
                              onClick={() => handleOpenEditDialog(p)}
                            >
                              <Edit2 className="h-3 w-3 mr-1" /> Editar
                            </Button>
                            <Button 
                              variant="outline" 
                              className="h-8 border-red-500/20 text-red-500 hover:bg-red-500/10 text-[10px] font-bold uppercase rounded-lg"
                              onClick={() => handleDeletePrinter(p.id!)}
                            >
                              <Trash2 className="h-3 w-3 mr-1" /> Eliminar
                            </Button>
                          </div>
                          <Button 
                            variant="outline" 
                            className="w-full border-[var(--border-default)] hover:bg-[var(--bg-hover)] text-[9px] font-extrabold uppercase rounded-lg h-7 mt-1"
                            onClick={() => testPrinter(p.id!)} 
                            disabled={testing}
                          >
                            {testing ? 'Probando...' : 'Probar Impresora'}
                          </Button>
                          {p.mode === 'local_bridge' && (
                            <Button 
                              variant="outline" 
                              className="w-full border-red-500/20 text-red-500 hover:bg-red-500/10 text-[9px] font-extrabold uppercase rounded-lg h-7 mt-1"
                              onClick={() => handleClearQueue(p.id!)} 
                              disabled={isClearingQueue}
                            >
                              🗑️ Limpiar Cola de {p.name || 'Impresora'}
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}

                </div>

                {/* Descarga de Agente de Impresión Local (the-villa-dog-printer-bridge.exe) */}
                <div className="bg-[var(--bg-elevated)]/40 border border-[var(--border-subtle)]/60 rounded-2xl p-4 mt-6 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-[var(--accent)]/10 text-[var(--accent)] rounded-lg shrink-0">
                      <Terminal className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-xs font-extrabold text-[var(--text-primary)] uppercase tracking-wider">Puente de Impresión Local (the-villa-dog-printer-bridge.exe)</h4>
                      <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
                        Si vas a utilizar impresoras térmicas en modo <strong>Puente Local (the-villa-dog-printer-bridge.exe)</strong>, descarga el agente de impresión y colócalo en una carpeta en tu computador junto al instalador invisible.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <a 
                      href="/the-villa-dog.exe" 
                      download="the-villa-dog-printer-bridge.exe"
                      className="flex-1 flex items-center justify-center gap-1.5 font-bold text-[var(--accent-fg)] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[10px] p-2.5 rounded-xl shadow-sm font-sans uppercase tracking-wider text-center transition-colors"
                    >
                      📥 Descargar the-villa-dog-printer-bridge.exe
                    </a>
                    <a 
                      href="/instalar_silencioso.bat" 
                      download="instalar_silencioso.bat"
                      className="flex-1 flex items-center justify-center gap-1.5 text-[10px] text-[var(--text-primary)] bg-[var(--bg-elevated)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] p-2.5 rounded-xl font-bold uppercase tracking-wider text-center transition-colors"
                    >
                      ⚙️ Descargar Instalador Invisible (En Segundo Plano)
                    </a>
                  </div>
                  <p className="text-[9px] text-[var(--text-secondary)] text-center italic mt-1">
                    Nota: Coloca ambos archivos en la misma carpeta en Windows y ejecuta "instalar_silencioso.bat" para iniciar el servicio en segundo plano de forma automática al iniciar Windows.
                  </p>
                </div>

                {/* Dialog para Agregar / Editar Impresora de Preparación */}
                <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                  <DialogContent className="border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl max-w-md p-6 shadow-2xl text-[var(--text-primary)] max-h-[85vh] flex flex-col overflow-hidden">
                    <DialogHeader className="shrink-0 pb-2 border-b border-[var(--border-subtle)]/40">
                      <DialogTitle className="text-lg font-bold tracking-tight uppercase text-[var(--text-primary)]">
                        {formPrinter.id === 'caja' ? 'Editar Impresora de Caja' : printer.printers?.some(x => x.id === formPrinter.id) ? 'Editar Impresora' : 'Agregar Impresora'}
                      </DialogTitle>
                    </DialogHeader>
                    
                    <div className="space-y-4 py-3 flex-1 overflow-y-auto pr-1">

                      {/* Estado Habilitada / Desactivada */}
                      <label className="flex items-center gap-3 cursor-pointer bg-[var(--bg-elevated)] p-3 rounded-xl border border-[var(--border-subtle)]/60 hover:bg-[var(--bg-hover)] transition-colors">
                        <input
                          type="checkbox"
                          checked={formPrinter.enabled !== false}
                          onChange={e => setFormPrinter(p => ({ ...p, enabled: e.target.checked }))}
                          className="h-4.5 w-4.5 accent-[var(--accent)] rounded cursor-pointer shrink-0 ml-1"
                        />
                        <div className="space-y-0.5">
                          <span className="text-xs font-extrabold text-[var(--text-primary)] block">Estación Habilitada / Activa</span>
                          <span className="text-[10px] text-[var(--text-secondary)] block">
                            Si desactivas esta estación, sus productos se imprimirán automáticamente en la comanda general de Cocina.
                          </span>
                        </div>
                      </label>

                      {/* Tipo de Impresora */}
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Tipo de Impresora</Label>
                        <select
                          className="w-full h-10 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] focus:ring-1 focus:ring-[var(--accent)] text-[var(--text-primary)] text-xs px-3 outline-none cursor-pointer"
                          value={formPrinter.id === 'caja' ? 'caja' : ((formPrinter as any).type || 'estacion')}
                          onChange={e => setFormPrinter(p => ({ ...p, type: e.target.value } as any))}
                          disabled={formPrinter.id === 'caja'}
                        >
                          <option value="estacion">🍳 Estación (Comanda de Cocina)</option>
                          <option value="caja">🧾 Caja (Factura Completa)</option>
                        </select>
                        <p className="text-[9px] text-[var(--text-secondary)] leading-relaxed mt-0.5">
                          {formPrinter.id === 'caja'
                            ? '📄 Esta es la impresora principal del sistema y siempre imprimirá la factura de venta (Caja).'
                            : (formPrinter as any).type === 'caja'
                              ? '📄 Imprimirá la factura completa con precios, totales y datos del cliente.'
                              : '🍽️ Imprimirá la comanda de preparación filtrada por las categorías seleccionadas.'}
                        </p>
                      </div>
                      
                      {/* Nombre */}
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Nombre de la Impresora</Label>
                        <Input
                          className="h-10 rounded-lg bg-[var(--bg-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] text-xs px-3 focus:ring-1 focus:ring-[var(--accent)]"
                          value={formPrinter.name}
                          onChange={e => setFormPrinter(p => ({ ...p, name: e.target.value }))}
                          placeholder="Ej: Cocina, Pizzas, Bar, Caja 2..."
                        />
                      </div>

                      {/* Modo de Impresión */}
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Modo de Impresión</Label>
                        <select
                          className="w-full h-10 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] focus:ring-1 focus:ring-[var(--accent)] text-[var(--text-primary)] text-xs px-3 outline-none cursor-pointer"
                          value={formPrinter.mode}
                          onChange={e => setFormPrinter(p => ({ ...p, mode: e.target.value as any, ip: '' }))}
                        >
                          <option value="browser">Navegador (Diálogo / PDF)</option>
                          <option value="usb">USB Silenciosa (WebUSB Directo)</option>
                          <option value="network">Red / IP (Puerto 9100)</option>
                          <option value="local_bridge">Puente Local (Cola de Impresión)</option>
                        </select>
                      </div>

                      {/* Configuración de conexión según el Modo */}
                      {formPrinter.mode === 'usb' && (
                        <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)]/60 rounded-xl p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">WebUSB</span>
                            {usbDeviceNames[formPrinter.id!] ? (
                              <Badge className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-2 py-0.5 rounded text-[9px] font-bold">VINCULADO</Badge>
                            ) : (
                              <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2 py-0.5 rounded text-[9px] font-bold">DESCONECTADO</Badge>
                            )}
                          </div>
                          {usbDeviceNames[formPrinter.id!] ? (
                            <div className="space-y-1.5">
                              <p className="text-[10px] text-[var(--text-primary)] font-mono truncate bg-[var(--bg-panel)] p-1.5 rounded border border-[var(--border-subtle)]/50">{usbDeviceNames[formPrinter.id!]}</p>
                              <Button size="sm" variant="destructive" className="w-full h-8 text-[10px] uppercase font-bold" onClick={() => handleDisconnectUsb(formPrinter.id!)}>Desvincular USB</Button>
                            </div>
                          ) : (
                            <Button size="sm" className="w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] h-8 text-[10px] uppercase font-bold" onClick={() => handleConnectUsb(formPrinter.id!)} disabled={isUsbConnecting}>
                              {isUsbConnecting ? 'Conectando...' : 'Vincular Impresora USB'}
                            </Button>
                          )}
                        </div>
                      )}

                      {formPrinter.mode === 'local_bridge' && (
                        <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed bg-[var(--bg-elevated)] p-2.5 rounded-lg border border-[var(--border-subtle)]/30">
                          ℹ️ La comanda se encolará en el puente de impresión local configurado en la PC de esta estación.
                        </p>
                      )}

                      {(formPrinter.mode === 'network' || formPrinter.mode === 'local_bridge') && (
                        <div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)]/60 rounded-xl p-3 space-y-1.5">
                          <Label className="text-[9px] font-bold text-[var(--text-secondary)] uppercase">
                            {formPrinter.mode === 'local_bridge' ? 'IP o ID USB (Ej: USB:ImpresoraEstacion)' : 'IP de la Impresora'}
                          </Label>
                          <Input
                            className="h-9 rounded bg-[var(--bg-panel)] border-[var(--border-subtle)] text-[var(--text-primary)] text-xs px-2.5"
                            value={formPrinter.ip || ''}
                            onChange={e => setFormPrinter(p => ({ ...p, ip: e.target.value, port: 9100 }))}
                            placeholder={formPrinter.mode === 'local_bridge' ? "USB:ImpresoraEstacion" : "192.168.1.14"}
                          />
                        </div>
                      )}

                      {/* Papel */}
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Papel</Label>
                        <select
                          className="w-full h-10 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-subtle)] focus:ring-1 focus:ring-[var(--accent)] text-[var(--text-primary)] text-xs px-3 outline-none cursor-pointer"
                          value={formPrinter.paper || '80'}
                          onChange={e => setFormPrinter(p => ({ ...p, paper: e.target.value as any }))}
                        >
                          <option value="58">58 mm (Angosto)</option>
                          <option value="80">80 mm (Estándar)</option>
                        </select>
                      </div>

                      {/* Categorías Impresas - Visible para Estaciones (comanda), oculto para tipo Caja */}
                      {(formPrinter.id === 'caja' || (formPrinter as any).type === 'caja') ? (
                        <div className="pt-2 border-t border-[var(--border-subtle)]/40 text-xs">
                          <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Categorías Impresas</Label>
                          <p className="text-[10px] text-emerald-500 font-bold bg-emerald-500/10 p-2.5 rounded-lg border border-emerald-500/20 mt-1">
                            ✓ Esta impresora imprime la factura completa con todos los productos, precios y totales.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]/40">
                          <div className="flex items-center justify-between">
                            <Label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Categorías Impresas</Label>
                            {(() => {
                              const selCount = categoriesList.filter(c => (formPrinter.categories || []).includes(c.id) || (formPrinter.categories || []).includes(c.name)).length
                              return selCount === 0 ? (
                                <Badge variant="outline" className="text-[8px] uppercase bg-amber-500/10 text-amber-500 font-bold py-0">Todas (Resto)</Badge>
                              ) : (
                                <Badge variant="outline" className="text-[8px] uppercase bg-emerald-500/10 text-emerald-500 font-bold py-0">{selCount} selec.</Badge>
                              )
                            })()}
                          </div>
                          <p className="text-[9px] text-[var(--text-secondary)] leading-relaxed bg-[var(--bg-elevated)] p-2 rounded-lg border border-[var(--border-subtle)]/30">
                            ℹ️ Selecciona las categorías que imprimirá esta estación. Si no seleccionas ninguna, imprimirá <strong>todo lo que NO esté asignado</strong> a otras impresoras.
                          </p>
                          <div className="max-h-36 overflow-y-auto space-y-1 bg-[var(--bg-elevated)] p-2 rounded-lg border border-[var(--border-subtle)]/60 text-xs">
                            {categoriesList.length === 0 ? (
                              <p className="text-[10px] text-[var(--text-secondary)] italic">Sin categorías cargadas</p>
                            ) : (
                              categoriesList.map(cat => {
                                const checked = (formPrinter.categories || []).includes(cat.id) || (formPrinter.categories || []).includes(cat.name)
                                return (
                                  <label key={cat.id} className="flex items-center gap-2 cursor-pointer hover:bg-[var(--bg-hover)] p-1.5 rounded transition-colors select-none">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={e => {
                                        const curr = formPrinter.categories || []
                                        const nextCats = e.target.checked
                                          ? Array.from(new Set([...curr, cat.id]))
                                          : curr.filter(id => id !== cat.id && id !== cat.name)
                                        setFormPrinter(p => ({ ...p, categories: nextCats }))
                                      }}
                                      className="h-4 w-4 accent-[var(--accent)] rounded cursor-pointer shrink-0"
                                    />
                                    <span className="text-[11px] text-[var(--text-primary)] font-medium truncate">{cat.name}</span>
                                  </label>
                                )
                              })
                            )}
                          </div>
                        </div>
                      )}

                    </div>
                    <DialogFooter className="flex gap-2 border-t border-[var(--border-subtle)]/40 pt-3 shrink-0 bg-[var(--bg-panel)] z-10">
                      <Button variant="outline" className="h-10 rounded-lg text-xs uppercase font-bold flex-1" onClick={() => setIsDialogOpen(false)}>
                        Cancelar
                      </Button>
                      <Button className="h-10 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] rounded-lg text-xs uppercase font-bold flex-1" onClick={handleSaveFormPrinter}>
                        {formPrinter.id === 'caja' ? 'Guardar Cambios Caja' : (formPrinter as any).type === 'caja' ? 'Guardar Impresora Caja' : 'Guardar Estación'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="flex gap-2 mt-6">
                <Button
                  className="flex-1 h-11 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold shadow-lg shadow-[var(--accent)]/15 rounded-xl text-xs uppercase tracking-wider"
                  onClick={savePrinter}
                >
                  {printerSaved ? (
                    <>
                      <CheckCircle2 className="mr-2 h-4 w-4 animate-bounce" /> Configuración Guardada Correctamente
                    </>
                  ) : (
                    'Guardar Configuración General'
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        </>
      )}

      {activeTab === 'theme' && (
<>
{/* Theme Settings Card */}
        <motion.div variants={itemVariants}>
          <Card className="niche-card-premium border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl overflow-hidden h-full flex flex-col">
            <CardHeader className="pb-3 border-b border-[var(--border-subtle)]/40">
              <CardTitle className="text-base font-extrabold text-[var(--text-primary)] tracking-wide uppercase flex items-center gap-2">
                <Palette className="h-5 w-5 text-[var(--accent)]" /> Apariencia del Sistema
              </CardTitle>
              <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">Configura el tema gráfico para mayor comodidad visual.</CardDescription>
            </CardHeader>
            <CardContent className="pt-5 space-y-4 flex-1 flex flex-col justify-between">
              <div className="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)]/60 px-4 py-3">
                <div className="flex items-center gap-3">
                  {theme === 'dark' ? (
                    <Moon className="h-5 w-5 text-[var(--accent)]" />
                  ) : (
                    <Sun className="h-5 w-5 text-[var(--accent)]" />
                  )}
                  <div className="space-y-0.5">
                    <p className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wide">Esquema Actual</p>
                    <p className="text-[10px] text-[var(--text-secondary)] font-medium">Modo {theme === 'dark' ? 'Oscuro' : 'Claro'}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] rounded-xl h-10 px-4 text-xs font-bold uppercase tracking-wider text-[var(--text-primary)]"
                  onClick={toggleTheme}
                >
                  Cambiar Tema
                </Button>
              </div>

              <div className="pt-4 border-t border-[var(--border-subtle)]/40 text-[10px] text-[var(--text-secondary)] font-semibold uppercase tracking-wider">
                Sesión: <span className="text-[var(--text-primary)]">{user?.name}</span> ({user?.email})

              </div>
            </CardContent>
          </Card>
        </motion.div>
      </>
      )}

      {activeTab === 'digital-menu' && (hasRole('SUPERADMIN', 'ADMIN') || hasPermission('settings.view') || hasPermission('settings.manage')) && (
        <motion.div variants={itemVariants} className="lg:col-span-2">
          <Card className="niche-card-premium border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-2xl overflow-hidden">
            <CardHeader className="pb-3 border-b border-[var(--border-subtle)]/40">
              <CardTitle className="text-base font-extrabold text-[var(--text-primary)] tracking-wide uppercase flex items-center gap-2">
                <Globe className="h-5 w-5 text-[var(--accent)]" /> Menu Digital
              </CardTitle>
              <CardDescription className="text-xs text-[var(--text-secondary)] font-medium">Configura el enlace de tu menu digital publico para compartirlo con tus clientes por WhatsApp.</CardDescription>
            </CardHeader>
            <CardContent className="p-5 space-y-5">
              <div className="space-y-2">
                <Label className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">URL del Menu Digital</Label>
                <div className="flex gap-2">
                  <Input 
                    className="h-11 rounded-xl bg-[var(--bg-elevated)] border-[var(--border-subtle)] focus:ring-2 focus:ring-[var(--accent)]/20 text-[var(--text-primary)] flex-1" 
                    value={digitalMenuUrl} 
                    onChange={e => setDigitalMenuUrl(e.target.value)}
                    placeholder="Ej: http://localhost:5173/menu"
                  />
                  {digitalMenuUrl && (
                    <Button variant="outline" className="h-11 border-[var(--border-subtle)]" onClick={() => {
                      navigator.clipboard.writeText(digitalMenuUrl)
                      setDigitalMenuCopied(true)
                      setTimeout(() => setDigitalMenuCopied(false), 2000)
                    }}>
                      {digitalMenuCopied ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  )}
                  {digitalMenuUrl && (
                    <Button variant="outline" className="h-11 border-[var(--border-subtle)]" onClick={() => window.open(digitalMenuUrl, '_blank')}>
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  )}
                </div>
                <p className="text-[10px] text-[var(--text-secondary)]">
                  Este enlace se enviara automaticamente a los clientes cuando pidan ver el menu por WhatsApp (opcion 1 del bot). Si lo dejas vacio, solo se les envia el PDF.
                </p>
              </div>

              <Button
                className="w-full h-11 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-fg)] font-bold shadow-lg shadow-[var(--accent)]/15 rounded-xl text-xs uppercase tracking-wider"
                disabled={savingDigitalMenu}
                onClick={async () => {
                  setSavingDigitalMenu(true)
                  try {
                    let urlToSave = digitalMenuUrl.trim()
                    if (urlToSave && !urlToSave.startsWith('http://') && !urlToSave.startsWith('https://')) {
                      urlToSave = `https://${urlToSave}`
                    }
                    await api.put('/whatsapp/settings', { digital_menu_url: urlToSave })
                    setDigitalMenuUrl(urlToSave)
                    setDigitalMenuSaved(true)
                    setTimeout(() => setDigitalMenuSaved(false), 3000)
                  } catch (err) {
                    alert('Error al guardar el enlace')
                  } finally {
                    setSavingDigitalMenu(false)
                  }
                }}
              >
                {savingDigitalMenu ? 'Guardando...' : digitalMenuSaved ? 'Guardado!' : 'Guardar Enlace del Menu Digital'}
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Security Action Confirmation Modal (Dual Password / OTP via SuperAdmin) */}
      <SecurityActionConfirmModal
        open={showSecurityModal}
        actionName={pendingSecurityAction?.actionName || 'Confirmar Acción Crítica'}
        title="Confirmación de Seguridad Crítica"
        description="Esta acción afectará la operación y configuración de impresión del restaurante."
        onClose={() => {
          setShowSecurityModal(false)
          setPendingSecurityAction(null)
        }}
        onSuccess={async () => {
          const action = pendingSecurityAction
          setShowSecurityModal(false)
          setPendingSecurityAction(null)
          if (action?.onExecute) {
            await action.onExecute()
          }
        }}
      />
      </motion.div>
    </div>
  )
}
