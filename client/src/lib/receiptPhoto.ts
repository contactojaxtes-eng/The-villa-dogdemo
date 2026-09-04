/**
 * Procesa y optimiza fotos de comprobantes tomadas desde cualquier dispositivo móvil o de escritorio.
 * Soporta de forma nativa e infalible:
 * - Fotos de cámara directa (JPG, PNG, WebP)
 * - Fotos seleccionadas de galería de Samsung / Android / iPhone (incluyendo HEIC / HEIF)
 * - Archivos grandes (redimensionados con Canvas a máx 1280px para que pesen ~120KB)
 * - Previsualización limpia y fluida que nunca muestra icono de foto rota
 */

export interface PreparedReceiptPhoto {
  file: File
  previewUrl: string
  name: string
}

/**
 * Generador seguro de UUID compatible con contextos HTTP no seguros (IPs locales en celulares)
 * y navegadores móviles antiguos que no soportan crypto.randomUUID().
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
 * Detecta si el archivo es HEIC / HEIF (formato por defecto en Samsung Galaxy y iPhones).
 */
async function isHeicFile(file: File): Promise<boolean> {
  const type = (file.type || '').toLowerCase()
  if (type.includes('heic') || type.includes('heif')) return true
  const name = (file.name || '').toLowerCase()
  if (name.endsWith('.heic') || name.endsWith('.heif')) return true
  try {
    const slice = file.slice(0, 64)
    const buffer = await slice.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    if (bytes.length >= 12) {
      const ascii = String.fromCharCode(...bytes.subarray(4, Math.min(bytes.length, 64))).toLowerCase()
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
  } catch {}
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
      setTimeout(() => resolve(checkFn()), 3000)
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => resolve(checkFn())
    script.onerror = () => resolve(false)
    document.head.appendChild(script)
    setTimeout(() => resolve(checkFn()), 4000)
  })
}

async function loadHeic2AnyScript(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (typeof (window as any).heic2any === 'function' || typeof (window as any).HeicTo === 'function') return true
  if (heicScriptLoadingPromise) return heicScriptLoadingPromise

  heicScriptLoadingPromise = (async () => {
    // 1. Intentar primero heic2any local
    let ok = await loadLocalScript('/js/heic2any.min.js', () => typeof (window as any).heic2any === 'function')
    if (ok) return true

    // 2. Intentar heic-to local (WASM libde265 autónomo de alta velocidad)
    ok = await loadLocalScript('/js/heic-to.js', () => typeof (window as any).HeicTo === 'function' || typeof (window as any).heicTo === 'function')
    if (ok) return true

    // 3. Fallback a CDN por si acaso
    ok = await loadLocalScript('https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js', () => typeof (window as any).heic2any === 'function')
    return ok
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
        return new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.82))
      }
      bmp.close()
    }
  } catch {}
  return null
}

/**
 * Detecta el MIME type real a partir de los bytes iniciales del archivo.
 */
async function detectImageMime(file: File | Blob): Promise<string> {
  try {
    const slice = file.slice(0, 32)
    const buffer = await slice.arrayBuffer()
    const bytes = new Uint8Array(buffer)

    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
    if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) return 'image/webp'
  } catch {}

  if (file.type && file.type.startsWith('image/')) return file.type
  return 'image/jpeg'
}

/**
 * Convierte un Blob o File a un DataURL estándar (data:image/...;base64,...)
 * usando la API nativa FileReader del navegador.
 */
function readBlobAsDataUrl(file: Blob | File, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        let res = reader.result
        if (!res.startsWith('data:image/') || res.startsWith('data:;base64') || res.startsWith('data:application/octet-stream')) {
          const parts = res.split(',')
          const b64 = parts[1] || ''
          res = `data:${mime};base64,${b64}`
        }
        resolve(res)
      } else {
        reject(new Error('No se pudo generar la vista previa de la foto.'))
      }
    }
    reader.onerror = () => reject(new Error('Error al leer el archivo del dispositivo.'))
    reader.readAsDataURL(file)
  })
}

/**
 * Carga una imagen usando URL.createObjectURL para bajo consumo de memoria.
 */
function loadImageAsync(url: string, timeoutMs = 6000): Promise<HTMLImageElement | null> {
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

export async function prepareReceiptPhoto(file: File): Promise<PreparedReceiptPhoto> {
  if (!file || !file.size) {
    throw new Error('La foto está vacía o el archivo fue cancelado. Selecciónala de nuevo.')
  }
  if (file.size > 25 * 1024 * 1024) {
    throw new Error('La foto es demasiado pesada (máx 25 MB).')
  }

  let workingFile: File = file
  let baseFileName = (file.name || `comprobante-${Date.now()}`).replace(/\.[^/.]+$/, '')

  // 1. Detección y conversión automática de fotos HEIC (Samsung Galaxy / Apple)
  const isHeic = await isHeicFile(file)
  if (isHeic) {
    try {
      // Paso 1: Decodificación nativa súper rápida si el navegador la soporta
      const nativeBlob = await decodeHeicNative(file)
      if (nativeBlob && nativeBlob.size > 0) {
        baseFileName = baseFileName.replace(/\.(heic|heif)$/i, '')
        workingFile = new File([nativeBlob], `${baseFileName}.jpg`, { type: 'image/jpeg' })
      } else {
        // Paso 2: Usar convertidores locales de la propia app (heic2any y heic-to)
        await loadHeic2AnyScript()
        const heic2anyFn = (window as any)?.heic2any
        const heicToObj = (window as any)?.heicTo
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

        // Paso 3: Respaldo con HeicTo si heic2any no produjo blob
        const heicToFn = (window as any)?.HeicTo || (window as any)?.heicTo
        if ((!jpegBlob || jpegBlob.size === 0) && typeof heicToFn === 'function') {
          try {
            const res = await heicToFn({
              blob: file,
              type: 'image/jpeg',
              quality: 0.82,
            })
            jpegBlob = Array.isArray(res) ? res[0] : res
          } catch (heicToErr) {
            console.warn('[prepareReceiptPhoto] HeicTo error:', heicToErr)
          }
        }

        if (jpegBlob && jpegBlob.size > 0) {
          baseFileName = baseFileName.replace(/\.(heic|heif)$/i, '')
          workingFile = new File([jpegBlob], `${baseFileName}.jpg`, { type: 'image/jpeg' })
        }
      }
    } catch (heicErr) {
      console.warn('[prepareReceiptPhoto] Conversión HEIC omitida:', heicErr)
    }
  }

  const detectedMime = await detectImageMime(workingFile)
  const ext = detectedMime === 'image/png' ? '.png' : detectedMime === 'image/webp' ? '.webp' : '.jpg'
  const finalName = `${baseFileName}${ext}`

  // 2. Intentar optimizar con Canvas a máx 1280px usando ObjectURL nativo (ultrarrápido y liviano)
  let objectUrl = ''
  try {
    objectUrl = URL.createObjectURL(workingFile)
    const img = await loadImageAsync(objectUrl, 6000)

    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
      const maxDim = 1280
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))

      const ctx = canvas.getContext('2d', { alpha: false })
      if (ctx) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, 'image/jpeg', 0.82)
        })

        if (blob && blob.size > 0) {
          const optimizedFile = new File([blob], `${baseFileName}.jpg`, { type: 'image/jpeg' })
          const optimizedDataUrl = await readBlobAsDataUrl(optimizedFile, 'image/jpeg')
          return {
            file: optimizedFile,
            previewUrl: optimizedDataUrl,
            name: optimizedFile.name,
          }
        }
      }
    }
  } catch (canvasErr) {
    console.warn('[prepareReceiptPhoto] Optimización canvas omitida:', canvasErr)
  } finally {
    if (objectUrl) {
      try { URL.revokeObjectURL(objectUrl) } catch {}
    }
  }

  // 3. Fallback: generar DataURL seguro o ObjectURL garantizado
  try {
    const rawDataUrl = await readBlobAsDataUrl(workingFile, detectedMime)
    const normalizedFile = new File([workingFile], finalName, { type: detectedMime })
    return {
      file: normalizedFile,
      previewUrl: rawDataUrl,
      name: finalName,
    }
  } catch {
    const fallbackUrl = URL.createObjectURL(workingFile)
    const normalizedFile = new File([workingFile], finalName, { type: detectedMime })
    return {
      file: normalizedFile,
      previewUrl: fallbackUrl,
      name: finalName,
    }
  }
}
