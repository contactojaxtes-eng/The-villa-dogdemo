/** Decode camera files before accepting them and upload a bounded, metadata-free JPEG. */
export async function prepareReceiptPhoto(file: File): Promise<File> {
  if (!file.size) throw new Error('La foto está vacía. Tómala de nuevo.')
  if (file.size > 20 * 1024 * 1024) throw new Error('Selecciona una foto de menos de 20 MB.')
  if (file.type && !file.type.startsWith('image/')) throw new Error('Selecciona una imagen JPG, PNG o WebP.')
  const source = URL.createObjectURL(file)
  const img = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('No pudimos abrir esa imagen. Toma otra foto o selecciona un JPG o PNG.'))
      img.src = source
    })
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('No pudimos leer la foto.')
    const scale = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No se pudo preparar la foto en este dispositivo.')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      result => result ? resolve(result) : reject(new Error('No se pudo preparar la foto. Intenta de nuevo.')),
      'image/jpeg', 0.82,
    ))
    if (blob.size > 5 * 1024 * 1024) throw new Error('La foto sigue siendo muy grande. Tómala más cerca del comprobante.')
    return new File([blob], `comprobante-${Date.now()}.jpg`, { type: 'image/jpeg' })
  } finally {
    img.src = ''
    URL.revokeObjectURL(source)
  }
}
