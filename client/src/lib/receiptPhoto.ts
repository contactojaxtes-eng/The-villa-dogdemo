/**
 * Procesa y optimiza fotos de comprobantes tomadas desde cualquier dispositivo móvil o de escritorio.
 * Genera tanto un File comprimido para el backend como un DataURL infalible para previsualización inmediata.
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
 * Detecta de forma infalible el MIME type real a partir de los bytes iniciales del archivo.
 * Crucial para archivos seleccionados de galería en Android o descargas donde file.type viene vacío.
 */
async function detectImageMime(file: File): Promise<string> {
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
function readBlobAsDataUrl(file: File, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        let res = reader.result
        // Asegurar que siempre comience con un MIME type de imagen válido
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

export async function prepareReceiptPhoto(file: File): Promise<PreparedReceiptPhoto> {
  if (!file || !file.size) {
    throw new Error('La foto está vacía o el archivo fue cancelado. Selecciónala de nuevo.')
  }
  if (file.size > 25 * 1024 * 1024) {
    throw new Error('La foto es demasiado pesada (máx 25 MB).')
  }

  // 1. Detectar MIME type real y nombre base
  const detectedMime = await detectImageMime(file)
  const ext = detectedMime === 'image/png' ? '.png' : detectedMime === 'image/webp' ? '.webp' : '.jpg'
  const baseFileName = (file.name || `comprobante-${Date.now()}`).replace(/\.[^/.]+$/, '') + ext

  // 2. Generar DataURL nativo garantizado
  const rawDataUrl = await readBlobAsDataUrl(file, detectedMime)

  // 3. Optimización con Canvas a máx 1280px para que pese ~150KB (rápido y liviano en celulares y servidor)
  try {
    const img = new Image()
    // IMPORTANTE: NO poner img.crossOrigin en DataURLs locales porque WebKit/Chrome bloquea la carga

    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true)
      img.onerror = () => resolve(false)
      img.src = rawDataUrl
    })

    if (loaded && img.naturalWidth > 0 && img.naturalHeight > 0) {
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

        const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.8)
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, 'image/jpeg', 0.8)
        })

        if (blob && blob.size > 0) {
          const optimizedFile = new File([blob], baseFileName.replace(/\.[^/.]+$/, '.jpg'), { type: 'image/jpeg' })
          return {
            file: optimizedFile,
            previewUrl: optimizedDataUrl,
            name: optimizedFile.name,
          }
        }
      }
    }
  } catch (canvasErr) {
    console.warn('Canvas optimization fallback:', canvasErr)
  }

  // 4. Fallback infalible: usar el archivo normalizado y el DataURL generado
  const normalizedFile = new File([file], baseFileName, { type: detectedMime })

  return {
    file: normalizedFile,
    previewUrl: rawDataUrl,
    name: baseFileName,
  }
}


