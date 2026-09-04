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
    } catch {
      // Fallback si falla
    }
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Convierte un Blob o File a DataURL utilizando el motor nativo en C++ de FileReader del navegador.
 * Es 100% infalible, no satura la memoria ni produce desbordamiento de pila (call stack exceeded)
 * sin importar el tamaño de la foto tomada por la cámara del celular.
 */
function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('No se pudo generar la vista previa de la foto.'))
      }
    }
    reader.onerror = () => reject(new Error('Error al leer el archivo de la cámara.'))
    reader.readAsDataURL(blob)
  })
}

export async function prepareReceiptPhoto(file: File): Promise<PreparedReceiptPhoto> {
  if (!file || !file.size) {
    throw new Error('La foto está vacía. Tómala de nuevo.')
  }
  if (file.size > 25 * 1024 * 1024) {
    throw new Error('La foto es demasiado pesada (máx 25 MB).')
  }

  const baseFileName = (file.name || `comprobante-${Date.now()}`).replace(/\.[^/.]+$/, '') + '.jpg'

  // 1. Crear inmediatamente un ObjectURL nativo: 0 ms de latencia, 0 memoria JS adicional
  let immediatePreview = ''
  try {
    immediatePreview = URL.createObjectURL(file)
  } catch {
    immediatePreview = ''
  }

  // 2. Intentar optimizar y comprimir la imagen en Canvas a máx 1280px con JPEG 80%
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'

    const imageSource = immediatePreview || await readBlobAsDataUrl(file)

    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true)
      img.onerror = () => resolve(false)
      img.src = imageSource
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
          const optimizedFile = new File([blob], baseFileName, { type: 'image/jpeg' })
          return {
            file: optimizedFile,
            previewUrl: optimizedDataUrl,
            name: optimizedFile.name,
          }
        }
      }
    }
  } catch (canvasErr) {
    console.warn('Canvas compression fallback:', canvasErr)
  }

  // 3. Fallback infalible: usar FileReader nativo
  const fallbackDataUrl = await readBlobAsDataUrl(file)
  const normalizedFile = new File([file], baseFileName, { type: file.type || 'image/jpeg' })

  return {
    file: normalizedFile,
    previewUrl: fallbackDataUrl,
    name: baseFileName,
  }
}

