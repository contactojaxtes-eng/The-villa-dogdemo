import { BadRequestException } from '@nestjs/common';

export function detectReceiptMime(bytes: Buffer): string | null {
  if (!Buffer.isBuffer(bytes) || !bytes.length) return null;
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
  if (jpeg) return 'image/jpeg';
  if (png) return 'image/png';
  if (webp) return 'image/webp';
  if (heic) return 'image/heic';
  return null;
}

export async function validateReceipt(file: any, maxBytes = 25 * 1024 * 1024) {
  let bytes = file?.buffer;
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new BadRequestException('Adjunta la foto del comprobante');
  if (bytes.length > maxBytes) throw new BadRequestException(`El comprobante debe pesar menos de ${Math.floor(maxBytes / 1024 / 1024)} MB`);

  // El MIME enviado por el navegador no es confiable. Solo aceptamos formatos
  // con una firma binaria reconocida para que un SVG u otro archivo disfrazado
  // nunca llegue a servirse como imagen privada.
  const mime = detectReceiptMime(bytes);
  if (!mime) {
    throw new BadRequestException('El comprobante debe ser una imagen válida (JPG, PNG o WebP)');
  }
  return { mime, bytes };
}

// Never send receipt bytes in table lists or realtime broadcasts. Images load on demand.
export const receiptSummary = {
  id: true, status: true, method: true, amount: true, originalName: true, mimeType: true,
  fileSize: true, rejectionReason: true, purgedAt: true, reviewedAt: true, createdAt: true,
  paymentId: true, orderId: true, tableId: true, cashClosingId: true, submittedById: true,
  reviewedById: true,
} as const;
