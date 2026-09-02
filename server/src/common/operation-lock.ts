import { Prisma } from '@prisma/client';

// Serialize the short accounting mutations across app instances, not just one Node process.
// Never hold this lock while sending messages, printing or waiting on external services.
export async function lockOperation(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(884812)`;
}

export const operationTransaction = { maxWait: 10000, timeout: 15000 };
