/**
 * Procesa y optimiza fotos de comprobantes tomadas desde cualquier dispositivo móvil o de escritorio.
 * Incluye múltiples mecanismos de decodificación y fallback a prueba de fallos para garantizar compatibilidad
 * con teléfonos Android (Samsung, Xiaomi, Motorola, etc.), iPhone (iOS Safari) y WebViews.
 */
export async function prepareReceiptPhoto(file: File): Promise<File> {
  if (!file || !file.size) {
    throw new Error('La foto está vacía. Tómala de nuevo.')
  }
  if (file.size > 25 * 1024 * 1024) {
    throw new Error('La foto es demasiado pesada (máx 25 MB).')
  }

  // Intento 1: createImageBitmap (API nativa moderna, GPU-accelerated y no causa OOM en celulares con cámaras de 50MP-108MP)
  try {
    if (typeof createImageBitmap === 'function') {
      let bitmap: ImageBitmap | null = null
      try {
        // En navegadores que soportan resize nativo al decodificar:
        bitmap = await createImageBitmap(file, { resizeWidth: 1600, resizeQuality: 'medium' })
      } catch {
        // Fallback si el navegador no soporta el objeto de opciones:
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

          const blob = await new Promise<Blob | null>(resolve => {
            canvas.toBlob(resolve, 'image/jpeg', 0.85)
          })
          if (blob && blob.size > 0) {
            return new File([blob], `comprobante-${Date.now()}.jpg`, { type: 'image/jpeg' })
          }
        }
      }
    }
  } catch (err) {
    console.warn('createImageBitmap fallback:', err)
  }

  // Intento 2: HTMLImageElement con URL.createObjectURL
  try {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true)
      img.onerror = () => resolve(false)
      img.src = objectUrl
    })

    if (loaded && img.naturalWidth > 0 && img.naturalHeight > 0) {
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        URL.revokeObjectURL(objectUrl)

        const blob = await new Promise<Blob | null>(resolve => {
          canvas.toBlob(resolve, 'image/jpeg', 0.85)
        })
        if (blob && blob.size > 0) {
          return new File([blob], `comprobante-${Date.now()}.jpg`, { type: 'image/jpeg' })
        }
      }
    }
    URL.revokeObjectURL(objectUrl)
  } catch (err) {
    console.warn('HTMLImageElement objectUrl fallback:', err)
  }

  // Intento 3: FileReader readAsDataURL (muchos teléfonos Android con sandbox que rechazan BlobURL funcionan con DataURL)
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })

    const img = new Image()
    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true)
      img.onerror = () => resolve(false)
      img.src = dataUrl
    })

    if (loaded && img.naturalWidth > 0 && img.naturalHeight > 0) {
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

        const blob = await new Promise<Blob | null>(resolve => {
          canvas.toBlob(resolve, 'image/jpeg', 0.85)
        })
        if (blob && blob.size > 0) {
          return new File([blob], `comprobante-${Date.now()}.jpg`, { type: 'image/jpeg' })
        }
      }
    }
  } catch (err) {
    console.warn('FileReader dataUrl fallback:', err)
  }

  // Intento 4: FALLBACK SUPREMO DE SEGURIDAD
  // Si el decodificador o canvas del navegador falló en el celular (por ejemplo baja memoria RAM o formato propietario de cámara),
  // pero el archivo pesa menos de 10 MB: ¡NO BLOQUEAR A LA MESERA!
  // Retornar el archivo original normalizado para que el backend lo reciba y valide sin problemas.
  if (file.size <= 10 * 1024 * 1024) {
    console.info('Usando archivo original como comprobante de transferencia (compatibilidad celular)')
    return file
  }

  throw new Error('La foto tomada es demasiado pesada (más de 10 MB). Toma la foto un poco más cerca del comprobante.')
}
