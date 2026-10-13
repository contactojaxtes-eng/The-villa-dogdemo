/**
 * useUsbPrinter — WebUSB silent thermal printing
 *
 * Impresión silenciosa por USB desde el navegador (Chrome/Edge).
 * No requiere instalación, no abre ventanas, funciona en Vercel.
 *
 * Flujo:
 *  1. connectUsb()  → abre el selector de dispositivo (solo la primera vez)
 *  2. printUsb(buf) → envía el buffer ESC/POS directamente a la impresora
 *
 * Compatible: Chrome 61+, Edge 79+, Opera 48+
 * NO compatible: Firefox, Safari
 */

import { DEFAULT_SITE_ID } from './multisite'

export interface UsbPrinterState {
  supported: boolean
  connected: boolean
  deviceName: string | null
  connecting: boolean
  printing: boolean
  error: string | null
}

interface UsbDeviceBinding {
  vendorId: number | null
  productId: number | null
  serialNumber: string | null
  productName: string | null
  manufacturerName: string | null
}

const USB_BINDINGS_STORAGE_KEY = 'the_villa_dog_usb_bindings_v1'

// Dynamic devices for USB printers (persist during the browser session). The
// key includes the site so changing sites can never reuse a device from another
// restaurant by accident.
const usbDevices: Record<string, any> = {}
let activeUsbSiteScope = DEFAULT_SITE_ID
let activeUsbOperational = false
let usbContextVersion = 0

function normalizeSiteScope(siteId?: string | null) {
  const value = String(siteId || '').trim()
  return value || DEFAULT_SITE_ID
}

function scopedTargetKey(target: string, siteId = activeUsbSiteScope) {
  return `${normalizeSiteScope(siteId)}:${String(target || '').trim()}`
}

function readUsbBindings(): Record<string, UsbDeviceBinding> {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(USB_BINDINGS_STORAGE_KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeUsbBindings(bindings: Record<string, UsbDeviceBinding>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(USB_BINDINGS_STORAGE_KEY, JSON.stringify(bindings))
  } catch {
    // La impresión sigue funcionando durante la sesión aunque el navegador
    // tenga el almacenamiento local bloqueado.
  }
}

function bindingFromDevice(device: any): UsbDeviceBinding {
  return {
    vendorId: Number.isFinite(device?.vendorId) ? Number(device.vendorId) : null,
    productId: Number.isFinite(device?.productId) ? Number(device.productId) : null,
    serialNumber: device?.serialNumber ? String(device.serialNumber) : null,
    productName: device?.productName ? String(device.productName) : null,
    manufacturerName: device?.manufacturerName ? String(device.manufacturerName) : null,
  }
}

function deviceMatchesBinding(device: any, binding: UsbDeviceBinding) {
  if (binding.vendorId !== null && Number(device?.vendorId) !== binding.vendorId) return false
  if (binding.productId !== null && Number(device?.productId) !== binding.productId) return false
  if (binding.serialNumber) return String(device?.serialNumber || '') === binding.serialNumber
  if (binding.productName && device?.productName) {
    return String(device.productName) === binding.productName
  }
  return true
}

function rememberDeviceBinding(target: string, device: any, siteId = activeUsbSiteScope) {
  const bindings = readUsbBindings()
  bindings[scopedTargetKey(target, siteId)] = bindingFromDevice(device)
  writeUsbBindings(bindings)
}

function forgetDeviceBinding(target: string, siteId = activeUsbSiteScope) {
  const bindings = readUsbBindings()
  delete bindings[scopedTargetKey(target, siteId)]
  writeUsbBindings(bindings)
}

function captureUsbContext() {
  return {
    siteId: activeUsbSiteScope,
    operational: activeUsbOperational,
    version: usbContextVersion,
  }
}

function isUsbContextCurrent(context: ReturnType<typeof captureUsbContext>) {
  return (
    context.version === usbContextVersion &&
    context.siteId === activeUsbSiteScope &&
    context.operational === activeUsbOperational
  )
}

/** Selects the active site and whether it may perform operational USB work. */
export function setUsbPrinterSiteScope(siteId?: string | null, operational = true) {
  const nextSiteId = normalizeSiteScope(siteId)
  if (nextSiteId !== activeUsbSiteScope || operational !== activeUsbOperational) {
    activeUsbSiteScope = nextSiteId
    activeUsbOperational = operational
    usbContextVersion += 1
  }
}

/** Disables USB only when the component being cleaned up still owns the scope. */
export function disableUsbPrinterSiteScope(siteId?: string | null) {
  const expectedSiteId = normalizeSiteScope(siteId)
  if (expectedSiteId !== activeUsbSiteScope || !activeUsbOperational) return
  activeUsbOperational = false
  usbContextVersion += 1
}

export function isWebUsbSupported(): boolean {
  return typeof navigator !== 'undefined' && 'usb' in navigator
}

export async function connectUsbPrinter(target: string): Promise<{ ok: boolean; name?: string; error?: string }> {
  const context = captureUsbContext()
  if (!context.operational) {
    return { ok: false, error: 'La impresión USB no está disponible mientras la sede está en preparación.' }
  }
  if (!isWebUsbSupported()) {
    return { ok: false, error: 'WebUSB no soportado en este navegador. Usa Chrome o Edge.' }
  }

  try {
    // Abrir selector de dispositivo
    const device = await (navigator as any).usb.requestDevice({
      filters: [], // Aceptar cualquier dispositivo USB
    })

    if (!device) return { ok: false, error: 'No se seleccionó ningún dispositivo' }

    if (!device.opened) {
      await device.open()
    }

    // Seleccionar la configuración y la interfaz de la impresora
    if (device.configuration === null) {
      await device.selectConfiguration(1)
    }

    // Encontrar la interfaz de impresora (clase 7 o primera con endpoint OUT)
    let ifaceNum = 0
    const config = device.configuration || device.configurations?.[0]
    if (config?.interfaces) {
      const printerInterface = config.interfaces.find(
        (iface: any) => iface.alternates?.[0]?.interfaceClass === 7
      )
      if (printerInterface) {
        ifaceNum = printerInterface.interfaceNumber
      } else {
        for (const iface of config.interfaces) {
          const outEp = iface.alternates?.[0]?.endpoints?.find((ep: any) => ep.direction === 'out')
          if (outEp) {
            ifaceNum = iface.interfaceNumber
            break
          }
        }
      }
    }

    try {
      await device.claimInterface(ifaceNum)
    } catch {
      try {
        await device.claimInterface(0)
      } catch {}
    }

    if (!isUsbContextCurrent(context)) {
      return { ok: false, error: 'La sede cambió durante la conexión. Vuelve a seleccionar la impresora.' }
    }

    usbDevices[scopedTargetKey(target, context.siteId)] = device
    rememberDeviceBinding(target, device, context.siteId)

    const name = device.productName || device.manufacturerName || 'Impresora USB'
    return { ok: true, name }
  } catch (err: any) {
    delete usbDevices[scopedTargetKey(target, context.siteId)]
    if (err.name === 'NotFoundError') {
      return { ok: false, error: 'No se seleccionó ningún dispositivo' }
    }
    return { ok: false, error: err.message || 'Error conectando impresora USB' }
  }
}

export async function disconnectUsbPrinter(target: string): Promise<void> {
  const context = captureUsbContext()
  if (!context.operational) return
  const key = scopedTargetKey(target, context.siteId)
  const device = usbDevices[key]
  if (device) {
    delete usbDevices[key]
    const stillUsed = Object.values(usbDevices).some(candidate => candidate === device)
    if (!stillUsed) {
      try {
        await device.close()
      } catch { /* ignorar */ }
    }
  }
  forgetDeviceBinding(target, context.siteId)
}

export function getUsbDevice(target: string): any {
  if (!activeUsbOperational) return null
  const siteId = activeUsbSiteScope
  const key = scopedTargetKey(target, siteId)
  if (usbDevices[key] && usbDevices[key].opened) {
    return usbDevices[key]
  }

  // Compatibilidad con la sede principal: antes de multisede se reutilizaba la
  // única impresora abierta para cualquier target. Las sedes adicionales exigen
  // una vinculación explícita y nunca usan este fallback.
  if (siteId === DEFAULT_SITE_ID) {
    const prefix = `${siteId}:`
    const available = Object.entries(usbDevices).find(
      ([deviceKey, device]: [string, any]) => deviceKey.startsWith(prefix) && device?.opened,
    )?.[1]
    if (available) return available
  }

  return usbDevices[key] || null
}

/**
 * Intenta reconectar automáticamente impresoras USB previamente autorizadas.
 * Usa navigator.usb.getDevices() que devuelve dispositivos que el usuario ya aprobó.
 * NO abre el selector — es completamente silencioso.
 * 
 * @param targets - Array de target IDs para reconectar (ej: ['caja', 'printer_123'])
 * @returns Mapa de target → nombre del dispositivo reconectado
 */
export async function autoReconnectUsbDevices(targets: string[] = ['caja', 'cocina', 'bar']): Promise<Record<string, string>> {
  const reconnected: Record<string, string> = {}
  const context = captureUsbContext()

  if (!context.operational) return reconnected
  if (!isWebUsbSupported()) return reconnected

  try {
    // getDevices() devuelve SOLO dispositivos previamente autorizados por el usuario
    const devices = await (navigator as any).usb.getDevices()
    if (!devices || devices.length === 0) return reconnected
    if (!isUsbContextCurrent(context)) return reconnected

    const bindings = readUsbBindings()

    for (const target of targets) {
      if (!isUsbContextCurrent(context)) return reconnected
      const key = scopedTargetKey(target, context.siteId)
      // Si ya está conectado, solo verificar que sigue vivo
      if (usbDevices[key]) {
        try {
          if (usbDevices[key].opened) {
            reconnected[target] = usbDevices[key].productName || usbDevices[key].manufacturerName || 'Impresora USB'
            continue
          }
        } catch { /* dispositivo muerto, intentar reconectar */ }
      }

      const savedBinding = bindings[key]
      // La sede principal conserva el auto-enlace histórico. Una sede nueva solo
      // puede reconectar un dispositivo que el usuario vinculó allí antes.
      const matches = savedBinding
        ? devices.filter((device: any) => deviceMatchesBinding(device, savedBinding))
        : []
      const candidates = context.siteId === DEFAULT_SITE_ID
        ? [...matches, ...devices.filter((device: any) => !matches.includes(device))]
        : savedBinding?.serialNumber
          ? matches
          : []

      for (const device of candidates) {
        try {
          if (!device.opened) {
            await device.open()
          }

          if (device.configuration === null) {
            await device.selectConfiguration(1)
          }

          let ifaceNum = 0
          const config = device.configuration || device.configurations?.[0]
          if (config?.interfaces) {
            const printerInterface = config.interfaces.find(
              (iface: any) => iface.alternates?.[0]?.interfaceClass === 7
            )
            if (printerInterface) {
              ifaceNum = printerInterface.interfaceNumber
            } else {
              for (const iface of config.interfaces) {
                const outEp = iface.alternates?.[0]?.endpoints?.find((ep: any) => ep.direction === 'out')
                if (outEp) {
                  ifaceNum = iface.interfaceNumber
                  break
                }
              }
            }
          }

          try {
            await device.claimInterface(ifaceNum)
          } catch {
            try {
              await device.claimInterface(0)
            } catch {}
          }

          if (!isUsbContextCurrent(context)) return reconnected
          usbDevices[key] = device
          rememberDeviceBinding(target, device, context.siteId)
          const name = device.productName || device.manufacturerName || 'Impresora USB'
          reconnected[target] = name
          console.log(`[WebUSB] ✓ Reconectado automáticamente: ${target} → ${name}`)
          break
        } catch (err: any) {
          console.warn(`[WebUSB] No se pudo reconectar ${target}:`, err.message)
        }
      }
    }
  } catch (err: any) {
    console.warn('[WebUSB] Error en auto-reconexión:', err.message)
  }

  return reconnected
}

export async function printUsb(data: Uint8Array, target: string): Promise<{ ok: boolean; error?: string }> {
  const context = captureUsbContext()
  if (!context.operational) {
    return { ok: false, error: 'La impresión USB no está disponible mientras la sede está en preparación.' }
  }
  let device = getUsbDevice(target)
  if (!device || !device.opened) {
    await autoReconnectUsbDevices([target, 'caja', 'cocina', 'bar'])
    if (!isUsbContextCurrent(context)) {
      return { ok: false, error: 'La sede cambió antes de imprimir. Intenta nuevamente.' }
    }
    device = getUsbDevice(target)
  }

  if (!device) {
    return { ok: false, error: `Impresora USB (${target}) no conectada. Ve a Configuración y conecta la impresora.` }
  }

  try {
    if (!isUsbContextCurrent(context)) {
      return { ok: false, error: 'La sede cambió antes de imprimir. Intenta nuevamente.' }
    }
    if (!device.opened) {
      await device.open()
    }
    if (device.configuration === null) {
      await device.selectConfiguration(1)
    }

    let targetInterfaceNumber = 0
    let endpointNumber = 1

    const config = device.configuration || device.configurations?.[0]
    if (config?.interfaces) {
      const printerIface = config.interfaces.find(
        (iface: any) => iface.alternates?.[0]?.interfaceClass === 7
      )

      if (printerIface) {
        targetInterfaceNumber = printerIface.interfaceNumber
        const outEp = printerIface.alternates?.[0]?.endpoints?.find(
          (ep: any) => ep.direction === 'out'
        )
        if (outEp) endpointNumber = outEp.endpointNumber
      } else {
        for (const iface of config.interfaces) {
          for (const alt of iface.alternates || []) {
            const outEp = alt.endpoints?.find((ep: any) => ep.direction === 'out')
            if (outEp) {
              targetInterfaceNumber = iface.interfaceNumber
              endpointNumber = outEp.endpointNumber
              break
            }
          }
        }
      }
    }

    // SIEMPRE asegurar claimInterface antes de transferOut
    try {
      await device.claimInterface(targetInterfaceNumber)
    } catch {
      // Ya reclamada por la sesión actual
    }

    if (!isUsbContextCurrent(context)) {
      return { ok: false, error: 'La sede cambió antes de imprimir. Intenta nuevamente.' }
    }
    await device.transferOut(endpointNumber, data)
    return { ok: true }
  } catch (err: any) {
    // Reintento con interfaz 0 en caso de que la impresora use endpoints genéricos
    try {
      if (!isUsbContextCurrent(context)) {
        return { ok: false, error: 'La sede cambió antes de imprimir. Intenta nuevamente.' }
      }
      if (!device.opened) await device.open()
      if (device.configuration === null) await device.selectConfiguration(1)
      try { await device.claimInterface(0) } catch {}
      if (!isUsbContextCurrent(context)) {
        return { ok: false, error: 'La sede cambió antes de imprimir. Intenta nuevamente.' }
      }
      await device.transferOut(1, data)
      return { ok: true }
    } catch (retryErr: any) {
      if (err.name === 'NotFoundError' || err.name === 'InvalidStateError') {
        delete usbDevices[scopedTargetKey(target, context.siteId)]
      }
      return { ok: false, error: err.message || 'Error enviando datos a la impresora' }
    }
  }
}

/**
 * Convierte texto plano con comandos ESC/POS básicos a un Uint8Array
 * para enviar directamente por WebUSB.
 */
export function buildEscPosBuffer(text: string, paper: '58' | '80' = '80'): Uint8Array {
  const width = paper === '58' ? 32 : 48
  const ESC = 0x1b
  const GS = 0x1d

  // Sanitizar tildes y caracteres diacríticos para evitar símbolos extraños en impresoras térmicas
  const sanitizedText = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/g, 'n')
    .replace(/Ñ/g, 'N')
    .replace(/¿/g, '?')
    .replace(/¡/g, '!')

  const bytes: number[] = []

  // Inicializar impresora
  bytes.push(ESC, 0x40)

  // Seleccionar tabla de caracteres WPC1252 (Latin-1 / Windows-1252)
  bytes.push(ESC, 0x74, 16)

  const lines = sanitizedText.split('\n')
  for (const line of lines) {
    let cleanLine = line
    let isBig = false
    let isHeight = false
    let isBold = false
    let isCenter = false

    if (cleanLine.includes('[BIG]')) {
      isBig = true
      cleanLine = cleanLine.replace(/\[\/?BIG\]/g, '')
    }
    if (cleanLine.includes('[HEIGHT]')) {
      isHeight = true
      cleanLine = cleanLine.replace(/\[\/?HEIGHT\]/g, '')
    }
    if (cleanLine.includes('[BOLD]')) {
      isBold = true
      cleanLine = cleanLine.replace(/\[\/?BOLD\]/g, '')
    }
    if (cleanLine.includes('[CENTER]')) {
      isCenter = true
      cleanLine = cleanLine.replace(/\[\/?CENTER\]/g, '')
    }

    // Alinear texto
    if (isCenter) {
      bytes.push(ESC, 0x61, 1) // Centrado
    } else {
      bytes.push(ESC, 0x61, 0) // Izquierda
    }

    // Configurar modo de fuente
    let modeByte = 0
    if (isBold) modeByte |= 0x08
    if (isBig) modeByte |= 0x30 // Double-height + Double-width
    else if (isHeight) modeByte |= 0x10 // Double-height solamente (ancho normal)
    bytes.push(ESC, 0x21, modeByte)

    // Ajustar el ancho máximo de la línea según el modo
    const lineMaxLen = isBig ? Math.floor(width / 2) : width

    // Envolver líneas largas respetando palabras completas
    const words = cleanLine.split(' ')
    const wrappedChunks: string[] = []
    let currentChunk = ''

    for (const word of words) {
      if ((currentChunk ? currentChunk + ' ' + word : word).length <= lineMaxLen) {
        currentChunk = currentChunk ? currentChunk + ' ' + word : word
      } else {
        if (currentChunk) wrappedChunks.push(currentChunk)
        if (word.length > lineMaxLen) {
          let rest = word
          while (rest.length > lineMaxLen) {
            wrappedChunks.push(rest.slice(0, lineMaxLen))
            rest = rest.slice(lineMaxLen)
          }
          currentChunk = rest
        } else {
          currentChunk = word
        }
      }
    }
    if (currentChunk) wrappedChunks.push(currentChunk)

    for (const chunk of wrappedChunks) {
      for (let i = 0; i < chunk.length; i++) {
        const code = chunk.charCodeAt(i)
        bytes.push(code > 255 ? 0x3f : code)
      }
      bytes.push(0x0a) // Line feed
    }
  }

  // Restaurar modo normal
  bytes.push(ESC, 0x21, 0)
  bytes.push(ESC, 0x61, 0)

  // 7 líneas en blanco al final (para que el papel salga del corte)
  bytes.push(0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a)

  // Corte de papel (si la impresora lo soporta)
  bytes.push(GS, 0x56, 0x00)

  // Pitidos potentes para alerta en cocina y despacho:
  // 1. ESC B 3 6 (3 pitidos de 600ms para volumen fuerte y duración)
  bytes.push(ESC, 0x42, 3, 6)
  // 2. ESC 0x1E (chicharra de alta potencia Xprinter / POS-80)
  bytes.push(ESC, 0x1e)
  // 3. Pulsos de 24V en pines 2 y 5 del puerto RJ11 (activa alarmas/chicharras externas de cocina)
  bytes.push(ESC, 0x70, 0, 80, 80)
  bytes.push(ESC, 0x70, 1, 80, 80)
  // 4. Caracteres BEL
  bytes.push(0x07, 0x07, 0x07, 0x07, 0x07)

  return new Uint8Array(bytes)
}
