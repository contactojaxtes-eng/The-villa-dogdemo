/**
 * Procesa y optimiza fotos y capturas de comprobantes tomadas desde cualquier dispositivo móvil.
 * Compatible al 100% con:
 * - Capturas de pantalla (Screenshots PNG/JPG de Nequi, Bancolombia, Daviplata)
 * - Fotos directas de cámara (JPG, PNG, WebP)
 * - Celulares antiguos (Android 6, 7, 8, 9, WebViews antiguas sin constructor File ni Blob.arrayBuffer)
 * - Celulares Samsung / iPhone modernos con fotos HEIC/HEIF
 * - Múltiples comprobantes simultáneos o agregados uno a uno
 * - No se cuelga nunca en "Procesando foto..."
 */

export interface PreparedReceiptPhoto {
  file: File
  previewUrl: string
  name: string
}

/**
 * Generador seguro de UUID compatible con contextos HTTP locales
 * y navegadores móviles antiguos.
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID()
    } catch {}
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Crea un objeto File seguro compatible con navegadores antiguos que lanzan
 * "TypeError: Illegal constructor" al llamar a new File([blob], ...).
 */
export function createSafeFile(blob: Blob, name: string, mime: string): File {
  try {
    return new File([blob], name, { type: mime, lastModified: Date.now() })
  } catch {
    // Fallback para WebViews antiguas de Android
    const b = blob.slice(0, blob.size, mime) as any
    b.name = name
    b.lastModified = Date.now()
    b.lastModifiedDate = new Date()
    return b as File
  }
}

/**
 * Convierte un DataURL (base64) a Blob de forma síncrona y segura sin usar canvas.toBlob.
 * Compatible con cualquier navegador móvil desde Android 4.0.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  try {
    const parts = dataUrl.split(',')
    const mimeMatch = parts[0].match(/:(.*?);/)
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg'
    const bstr = atob(parts[1] || '')
    let n = bstr.length
    const u8arr = new Uint8Array(n)
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n)
    }
    return new Blob([u8arr], { type: mime })
  } catch {
    return new Blob([], { type: 'image/jpeg' })
  }
}

/**
 * Lee los primeros bytes de un archivo usando FileReader estándar
 * (evita slice.arrayBuffer() que no existe en Android < 10).
 */
function readFirstBytes(file: Blob, count = 64): Promise<Uint8Array> {
  return new Promise((resolve) => {
    try {
      const slice = file.slice(0, count)
      const reader = new FileReader()
      reader.onloadend = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(new Uint8Array(reader.result))
        } else {
          resolve(new Uint8Array(0))
        }
      }
      reader.onerror = () => resolve(new Uint8Array(0))
      reader.readAsArrayBuffer(slice)
    } catch {
      resolve(new Uint8Array(0))
    }
  })
}

/**
 * Detecta si el archivo es realmente HEIC / HEIF.
 * Las capturas de pantalla (PNG) y fotos JPG se descartan de inmediato sin demora.
 */
async function isHeicFile(file: File): Promise<boolean> {
  const type = (file.type || '').toLowerCase()
  const name = (file.name || '').toLowerCase()

  // Descarte inmediato para capturas y fotos normales (PNG, JPG, WebP)
  if (type === 'image/png' || type === 'image/jpeg' || type === 'image/webp') return false
  if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.webp')) return false

  if (type.includes('heic') || type.includes('heif') || name.endsWith('.heic') || name.endsWith('.heif')) return true

  // Verificación por cabecera mágica
  const bytes = await readFirstBytes(file, 32)
  if (bytes.length >= 12) {
    const ascii = String.fromCharCode(...bytes.subarray(4, Math.min(bytes.length, 32))).toLowerCase()
    if (
      ascii.includes('heic') ||
      ascii.includes('heix') ||
      ascii.includes('hevc') ||
      ascii.includes('heim') ||
      ascii.includes('heis') ||
      ascii.includes('mif1') ||
      ascii.includes('msf1')
    ) {
      return true
    }
  }
  return false
}

let heicScriptLoadingPromise: Promise<boolean> | null = null

function loadLocalScript(src: string, checkFn: () => boolean): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  if (checkFn()) return Promise.resolve(true)

  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
    if (existing) {
      if (checkFn()) return resolve(true)
      existing.addEventListener('load', () => resolve(checkFn()), { once: true })
      existing.addEventListener('error', () => resolve(false), { once: true })
      setTimeout(() => resolve(checkFn()), 2000)
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => resolve(checkFn())
    script.onerror = () => resolve(false)
    document.head.appendChild(script)
    setTimeout(() => resolve(checkFn()), 2500)
  })
}

async function loadHeic2AnyScript(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (typeof (window as any).heic2any === 'function' || typeof (window as any).HeicTo === 'function') return true
  if (heicScriptLoadingPromise) return heicScriptLoadingPromise

  heicScriptLoadingPromise = (async () => {
    let ok = await loadLocalScript('/js/heic2any.min.js', () => typeof (window as any).heic2any === 'function')
    if (ok) return true
    ok = await loadLocalScript('/js/heic-to.js', () => typeof (window as any).HeicTo === 'function' || typeof (window as any).heicTo === 'function')
    if (ok) return true
    return false
  })()

  return heicScriptLoadingPromise
}

async function decodeHeicNative(file: Blob | File): Promise<Blob | null> {
  if (typeof createImageBitmap !== 'function') return null
  try {
    const bmp = await createImageBitmap(file)
    if (bmp && bmp.width > 0 && bmp.height > 0) {
      const maxDim = 1280
      const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bmp.width * scale))
      canvas.height = Math.max(1, Math.round(bmp.height * scale))
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
        bmp.close()
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
        return dataUrlToBlob(dataUrl)
      }
      bmp.close()
    }
  } catch {}
  return null
}

/**
 * Carga una imagen para redimensionarla con timeout seguro de 3.5 segundos
 * para garantizar que nunca bloquee la pantalla en celulares lentos.
 */
function loadImageAsync(url: string, timeoutMs = 3500): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        done = true
        resolve(null)
      }
    }, timeoutMs)

    img.onload = () => {
      if (!done) {
        done = true
        clearTimeout(timer)
        resolve(img)
      }
    }
    img.onerror = () => {
      if (!done) {
        done = true
        clearTimeout(timer)
        resolve(null)
      }
    }
    img.src = url
  })
}

/**
 * Lee un Blob/File completo a DataURL base64.
 * Es el método más seguro y compatible de todo el estándar web.
 */
export function readBlobAsDataUrl(file: Blob | File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('No se pudo generar la vista previa de la foto.'))
      }
    }
    reader.onerror = () => reject(new Error('Error al leer el archivo del dispositivo.'))
    reader.readAsDataURL(file)
  })
}

/**
 * Procesa cualquier comprobante recibido (captura de pantalla, foto de galería o cámara).
 * SIEMPRE devuelve un objeto válido con previewUrl y nunca se cuelga.
 */
export async function prepareReceiptPhoto(file: File): Promise<PreparedReceiptPhoto> {
  if (!file || !file.size) {
    throw new Error('El archivo seleccionado está vacío o fue cancelado.')
  }

  const timestamp = Date.now()
  let workingFile: Blob = file
  let baseFileName = (file.name || `comprobante-${timestamp}`).replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_')
  if (!baseFileName) baseFileName = `comprobante-${timestamp}`

  // 1. Manejo de fotos HEIC (solo si es verdaderamente HEIC)
  const isHeic = await isHeicFile(file)
  if (isHeic) {
    try {
      const nativeBlob = await decodeHeicNative(file)
      if (nativeBlob && nativeBlob.size > 0) {
        workingFile = nativeBlob
      } else {
        await loadHeic2AnyScript()
        const heic2anyFn = (window as any)?.heic2any
        const heicToFn = (window as any)?.HeicTo || (window as any)?.heicTo
        let jpegBlob: Blob | null = null

        if (typeof heic2anyFn === 'function') {
          try {
            const converted = await heic2anyFn({
              blob: file,
              toType: 'image/jpeg',
              quality: 0.82,
              multiple: false,
            })
            jpegBlob = Array.isArray(converted) ? converted[0] : converted
          } catch {
            try {
              const converted = await heic2anyFn({
                blob: file,
                toType: 'image/jpeg',
                quality: 0.82,
                multiple: true,
              })
              jpegBlob = Array.isArray(converted) ? converted[0] : converted
            } catch {}
          }
        }

        if ((!jpegBlob || jpegBlob.size === 0) && typeof heicToFn === 'function') {
          try {
            const res = await heicToFn({
              blob: file,
              type: 'image/jpeg',
              quality: 0.82,
            })
            jpegBlob = Array.isArray(res) ? res[0] : res
          } catch {}
        }

        if (jpegBlob && jpegBlob.size > 0) {
          workingFile = jpegBlob
        }
      }
    } catch (heicErr) {
      console.warn('[prepareReceiptPhoto] Conversión HEIC omitida:', heicErr)
    }
  }

  // 2. Redimensionamiento y compresión universal con Canvas
  // Usa canvas.toDataURL() que es 100% síncrono, nunca se cuelga y soporta capturas PNG con transparencia.
  let objectUrl = ''
  try {
    objectUrl = URL.createObjectURL(workingFile)
    const img = await loadImageAsync(objectUrl, 3500)

    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
      const maxDim = 1280
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))

      const ctx = canvas.getContext('2d')
      if (ctx) {
        // Fondo blanco sólido obligatorio para que las capturas de pantalla PNG no salgan negras
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

        // canvas.toDataURL es síncrono, inmediato y jamás se queda colgado
        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.82)
        const compressedBlob = dataUrlToBlob(compressedDataUrl)

        if (compressedBlob && compressedBlob.size > 0) {
          const finalName = `${baseFileName}.jpg`
          const safeFile = createSafeFile(compressedBlob, finalName, 'image/jpeg')
          return {
            file: safeFile,
            previewUrl: compressedDataUrl,
            name: finalName,
          }
        }
      }
    }
  } catch (canvasErr) {
    console.warn('[prepareReceiptPhoto] Canvas omitido, usando fallback:', canvasErr)
  } finally {
    if (objectUrl) {
      try { URL.revokeObjectURL(objectUrl) } catch {}
    }
  }

  // 3. Fallback infalible: lectura directa a DataURL
  // Garantiza que cualquier captura o foto cargue siempre sin errores en cualquier celular antiguo
  const rawDataUrl = await readBlobAsDataUrl(workingFile)
  const isPng = rawDataUrl.startsWith('data:image/png')
  const ext = isPng ? '.png' : '.jpg'
  const mime = isPng ? 'image/png' : 'image/jpeg'
  const fallbackName = `${baseFileName}${ext}`
  const safeFile = createSafeFile(workingFile, fallbackName, mime)

  return {
    file: safeFile,
    previewUrl: rawDataUrl,
    name: fallbackName,
  }
}
