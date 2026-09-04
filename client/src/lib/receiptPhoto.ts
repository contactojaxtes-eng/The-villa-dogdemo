/**
 * Procesa y optimiza fotos de comprobantes tomadas desde cualquier dispositivo móvil o de escritorio.
 * Genera tanto un File comprimido para el backend como un DataURL infalible para previsualización inmediata.
 */
export interface PreparedReceiptPhoto {
  file: File
  previewUrl: string
  name: string
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error || new Error('Error al leer el archivo de imagen'))
    reader.readAsDataURL(file)
  })
}

export async function prepareReceiptPhoto(file: File): Promise<PreparedReceiptPhoto> {
  if (!file || !file.size) {
    throw new Error('La foto está vacía. Tómala de nuevo.')
  }
  if (file.size > 25 * 1024 * 1024) {
    throw new Error('La foto es demasiado pesada (máx 25 MB).')
  }

  // 1. Extraer inmediatamente los bytes del archivo a memoria como DataURL.
  // Esto evita que en teléfonos Android Chrome/WebView se cierre el stream temporal de la cámara.
  let rawDataUrl = ''
  try {
    rawDataUrl = await readFileAsDataUrl(file)
  } catch (readErr) {
    console.warn('FileReader readAsDataURL failed, using objectUrl fallback:', readErr)
  }

  const baseFileName = file.name || `comprobante-${Date.now()}.jpg`

  // 2. Intentar decodificar y optimizar la imagen con HTMLImageElement y Canvas
  if (rawDataUrl) {
    try {
      const img = new Image()
      const loaded = await new Promise<boolean>((resolve) => {
        img.onload = () => resolve(true)
        img.onerror = () => resolve(false)
        img.src = rawDataUrl
      })

      if (loaded && img.naturalWidth > 0 && img.naturalHeight > 0) {
        const maxDim = 1600
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

          const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.85)

          const blob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob(resolve, 'image/jpeg', 0.85)
          })

          if (blob && blob.size > 0) {
            const optimizedFile = new File([blob], baseFileName.replace(/\.[^/.]+$/, '') + '.jpg', { type: 'image/jpeg' })
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
  }

  // 3. Fallback createImageBitmap si FileReader no obtuvo la imagen o falló el Image element
  try {
    if (typeof createImageBitmap === 'function') {
      let bitmap: ImageBitmap | null = null
      try {
        bitmap = await createImageBitmap(file, { resizeWidth: 1600, resizeQuality: 'medium' })
      } catch {
        bitmap = await createImageBitmap(file)
      }

      if (bitmap && bitmap.width > 0 && bitmap.height > 0) {
        const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(bitmap.width * scale))
        canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
          bitmap.close?.()

          const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.85)
          const blob = await new Promise<Blob | null>((resolve) => {
            canvas.toBlob(resolve, 'image/jpeg', 0.85)
          })

          if (blob && blob.size > 0) {
            const optimizedFile = new File([blob], baseFileName.replace(/\.[^/.]+$/, '') + '.jpg', { type: 'image/jpeg' })
            return {
              file: optimizedFile,
              previewUrl: optimizedDataUrl,
              name: optimizedFile.name,
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('createImageBitmap fallback:', err)
  }

  // 4. FALLBACK SUPREMO DE SEGURIDAD (Garantiza que la mesera nunca se quede bloqueada)
  if (file.size <= 10 * 1024 * 1024) {
    console.info('Usando archivo original con dataURL preview para compatibilidad total')
    return {
      file,
      previewUrl: rawDataUrl || URL.createObjectURL(file),
      name: file.name || 'comprobante.jpg',
    }
  }

  throw new Error('La foto tomada es demasiado pesada (más de 10 MB). Toma la foto un poco más cerca del comprobante.')
}
