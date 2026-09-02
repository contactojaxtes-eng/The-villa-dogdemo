import { BadRequestException } from '@nestjs/common';

export function validateReceipt(file: any) {
  const bytes = file?.buffer;
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new BadRequestException('Adjunta la foto del comprobante');
  if (bytes.length > 5 * 1024 * 1024) throw new BadRequestException('El comprobante debe pesar menos de 5 MB');
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!jpeg && !png && !webp) throw new BadRequestException('El comprobante debe ser una imagen JPG, PNG o WebP válida');
  return { mime: jpeg ? 'image/jpeg' : png ? 'image/png' : 'image/webp', bytes };
}

// Never send receipt bytes in table lists or realtime broadcasts. Images load on demand.
export const receiptSummary = {
  id: true, status: true, method: true, amount: true, originalName: true, mimeType: true,
  fileSize: true, rejectionReason: true, purgedAt: true, reviewedAt: true, createdAt: true,
  paymentId: true, orderId: true, tableId: true, cashClosingId: true, submittedById: true,
  reviewedById: true,
} as const;
