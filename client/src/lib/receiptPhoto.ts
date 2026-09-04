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
 * Lee de forma segura los bytes del archivo a memoria (ArrayBuffer) y genera un DataURL
 * normalizado con MIME type de imagen garantizado (image/jpeg, image/png, image/webp).
 * Esto evita que Android Chrome produzca 'data:;base64' o 'data:application/octet-stream',
 * los cuales rompen las etiquetas <img> en teléfonos móviles.
 */
async function readFileAsNormalizedDataUrl(file: File): Promise<{ dataUrl: string; mime: string; bytes: Uint8Array }> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)

  if (!bytes.length) {
    throw new Error('La foto tomada está vacía. Intenta tomarla de nuevo.')
  }

  // Detectar formato por magic bytes reales
  let mime = 'image/jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    mime = 'image/png'
  } else if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    mime = 'image/webp'
  } else {
    // Por defecto forzar JPEG para máxima compatibilidad con todos los navegadores
    mime = 'image/jpeg'
  }

  // Conversión a Base64 por chunks seguros (evita stack overflow en archivos grandes)
  let binary = ''
  const len = bytes.byteLength
  const chunkSize = 8192
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)) as any)
  }
  const base64 = btoa(binary)
  const dataUrl = `data:${mime};base64,${base64}`

  return { dataUrl, mime, bytes }
}

export async function prepareReceiptPhoto(file: File): Promise<PreparedReceiptPhoto> {
  if (!file || !file.size) {
    throw new Error('La foto está vacía. Tómala de nuevo.')
  }
  if (file.size > 25 * 1024 * 1024) {
    throw new Error('La foto es demasiado pesada (máx 25 MB).')
  }

  // 1. Extraer inmediatamente los bytes del archivo a memoria
  const { dataUrl, mime, bytes } = await readFileAsNormalizedDataUrl(file)
  const baseFileName = (file.name || `comprobante-${Date.now()}`).replace(/\.[^/.]+$/, '') + '.jpg'

  // 2. Intentar redimensionar y optimizar con Canvas a max 1200px (muy ligero y rápido en celulares)
  try {
    const memoryBlob = new Blob([bytes], { type: mime })
    const objectUrl = URL.createObjectURL(memoryBlob)
    const img = new Image()
    img.crossOrigin = 'anonymous'

    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true)
      img.onerror = () => resolve(false)
      img.src = objectUrl
    })

    if (loaded && img.naturalWidth > 0 && img.naturalHeight > 0) {
      const maxDim = 1200
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        URL.revokeObjectURL(objectUrl)

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
    URL.revokeObjectURL(objectUrl)
  } catch (canvasErr) {
    console.warn('Canvas optimization fallback:', canvasErr)
  }

  // 3. Fallback de seguridad garantizado: usar los bytes normalizados en memoria
  const fallbackFile = new File([bytes], baseFileName, { type: mime })
  return {
    file: fallbackFile,
    previewUrl: dataUrl,
    name: baseFileName,
  }
}
