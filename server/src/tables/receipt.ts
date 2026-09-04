import { BadRequestException } from '@nestjs/common';

export async function validateReceipt(file: any) {
  let bytes = file?.buffer;
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new BadRequestException('Adjunta la foto del comprobante');
  if (bytes.length > 25 * 1024 * 1024) throw new BadRequestException('El comprobante debe pesar menos de 25 MB');

  // Marcadores de formato de imagen universales
  const jpeg = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  const heic = bytes.length >= 12 && (
    bytes.toString('ascii', 4, 12).includes('ftypheic') ||
    bytes.toString('ascii', 4, 12).includes('ftypmif1') ||
    bytes.toString('ascii', 4, 12).includes('ftypmsf1') ||
    bytes.toString('ascii', 4, 12).includes('ftypheix') ||
    bytes.toString('ascii', 4, 12).includes('ftyphevc')
  );
  const isImageMime = typeof file?.mimetype === 'string' && file.mimetype.startsWith('image/');

  if (!jpeg && !png && !webp && !heic && !isImageMime) {
    throw new BadRequestException('El comprobante debe ser una imagen válida (JPG, PNG o WebP)');
  }

  // Si es formato HEIC (iPhone o Samsung Galaxy), convertir automáticamente a JPEG estándar para que cualquier navegador lo vea
  if (heic || file?.mimetype === 'image/heic' || file?.mimetype === 'image/heif') {
    try {
      const heicConvert = require('heic-convert');
      const converted = await heicConvert({
        buffer: bytes,
        format: 'JPEG',
        quality: 0.85,
      });
      bytes = Buffer.from(converted);
      return { mime: 'image/jpeg', bytes };
    } catch (err: any) {
      console.warn('[validateReceipt] Conversión HEIC no aplicada en servidor, usando original:', err?.message);
    }
  }

  const mime = jpeg ? 'image/jpeg' : png ? 'image/png' : webp ? 'image/webp' : (file?.mimetype || 'image/jpeg');
  return { mime, bytes };
}

// Never send receipt bytes in table lists or realtime broadcasts. Images load on demand.
export const receiptSummary = {
  id: true, status: true, method: true, amount: true, originalName: true, mimeType: true,
  fileSize: true, rejectionReason: true, purgedAt: true, reviewedAt: true, createdAt: true,
  paymentId: true, orderId: true, tableId: true, cashClosingId: true, submittedById: true,
  reviewedById: true,
} as const;
