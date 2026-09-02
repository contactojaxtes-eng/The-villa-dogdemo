import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TablesService } from './tables.service';
import { OrdersService } from '../orders/orders.service';

const integration = process.env.RUN_RELEASE_DB_TESTS === 'true' ? describe : describe.skip;
integration('PostgreSQL: named accounts, kitchen and payments', () => {
  let db: PrismaClient;
  let tables: TablesService;
  let user: any;
  let product: any;
  let register: any;
  const emit = jest.fn();
  const socket: any = new Proxy({ server: { emit, to: () => ({ emit }) } }, { get: (target, key) => target[key] || emit });
  const image = { buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'), originalname: 'receipt.png' };
  const create = (extra: any = {}) => tables.createTableOrder({ tableLabel: `Cliente ${randomUUID()}`, cashRegisterId: register.id, clientMutationId: randomUUID(), items: [{ menuItemId: product.id, quantity: 1 }], ...extra }, user);
  const finishKitchen = async (tableId: string) => {
    const tickets = await db.kitchenTicket.findMany({ where: { tableId, status: { in: ['NEW', 'PREPARING'] } } });
    for (const ticket of tickets) await tables.updateKitchenTicket(ticket.id, 'READY', user);
  };

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL || '');
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.includes('release_test')) throw new Error('Integration tests require an isolated local release_test database');
    db = new PrismaClient();
    user = await db.user.create({ data: { name: 'Release test', email: `test-${randomUUID()}@example.invalid`, password: 'unused', role: 'SUPERADMIN' } });
    register = await db.cashRegister.create({ data: { name: 'Release test register' } });
    await db.cashClosing.create({ data: { userId: user.id, cashRegisterId: register.id, shiftStart: new Date(), isOpen: true } });
    const category = await db.menuCategory.create({ data: { name: 'Release test food' } });
    product = await db.menuItem.create({ data: { name: 'Release test item', price: 3500, categoryId: category.id } });
    const orders = new OrdersService(db as any, socket, {} as any, { getPrinterSettings: async () => ({ autoPrint: false }) } as any);
    tables = new TablesService(db as any, socket, orders);
  });
  afterAll(async () => { await db?.$disconnect(); });

  it('creates accounts by name, keeps same names separate, and replays one concurrent submission', async () => {
    const data = { tableLabel: 'Carlos', clientMutationId: randomUUID() };
    const [first, retry] = await Promise.all([create(data), create(data)]);
    expect(retry.order.id).toBe(first.order.id);
    expect(retry.table.id).toBe(first.table.id);
    expect(first.table.label).toBe('Carlos');
    expect(first.table.orders).toHaveLength(1);
    expect((await create({ tableLabel: 'Carlos' })).table.id).not.toBe(first.table.id);
    expect(await db.payment.count({ where: { orderId: first.order.id } })).toBe(1);
  });

  it('rolls back the account, order and payment if kitchen creation fails', async () => {
    const before = await db.diningTable.count();
    const mutation = randomUUID();
    const spy = jest.spyOn(tables, 'createKitchenTickets').mockRejectedValueOnce(new Error('Kitchen unavailable'));
    await expect(create({ clientMutationId: mutation })).rejects.toThrow('Kitchen unavailable');
    spy.mockRestore();
    expect(await db.diningTable.count()).toBe(before);
    expect(await db.order.findUnique({ where: { clientMutationId: mutation } })).toBeNull();
  });

  it('updates an order and its existing kitchen card together, then blocks edits during payment review', async () => {
    const result = await create();
    const edited = await tables.updateTableOrder(result.order.id, { items: [{ menuItemId: product.id, quantity: 2 }] }, user);
    expect(edited.table.total).toBe(7000);
    const tickets = await db.kitchenTicket.findMany({ where: { orderId: result.order.id }, include: { items: true } });
    expect(tickets).toHaveLength(1);
    expect(tickets[0].items[0].quantity).toBe(2);
    await tables.submitPayment(result.table.id, { method: 'TRANSFER', amount: 7000 }, user, image);
    await expect(tables.updateTableOrder(result.order.id, { items: [{ menuItemId: product.id, quantity: 3 }] }, user)).rejects.toThrow('revisión');
    expect((await tables.findTable(result.table.id)).total).toBe(7000);
  });

  it('settles all orders once and waits for kitchen before closing', async () => {
    const first = await create();
    await create({ tableId: first.table.id });
    const data = { method: 'CASH', amount: 7000, clientMutationId: randomUUID() };
    const [paid, retry] = await Promise.all([tables.submitPayment(first.table.id, data, user), tables.submitPayment(first.table.id, data, user)]);
    expect(paid.table.status).toBe('OPEN');
    expect(paid.table.balance).toBe(0);
    expect(retry.payment.id).toBe(paid.payment.id);
    const payments = await db.payment.findMany({ where: { order: { tableId: first.table.id } } });
    expect(payments.map(p => p.status)).toEqual(['CONFIRMED', 'CONFIRMED']);
    expect(payments.reduce((total, p) => total + p.amount, 0)).toBe(7000);
    await expect(tables.closeTable(first.table.id, user)).rejects.toThrow('cocina');
    await finishKitchen(first.table.id);
    expect((await tables.findTable(first.table.id)).status).toBe('CLOSED');
    expect(await db.kitchenTicket.count({ where: { tableId: first.table.id, status: { in: ['NEW', 'PREPARING', 'READY'] } } })).toBe(0);
  });

  it('rejects missing or invalid receipts and incorrect amounts without recording payment', async () => {
    const { table, order } = await create();
    await expect(tables.submitPayment(table.id, { method: 'TRANSFER', amount: 3500 }, user)).rejects.toThrow('comprobante');
    await expect(tables.submitPayment(table.id, { method: 'TRANSFER', amount: 3500 }, user, { buffer: Buffer.from('<html/>') })).rejects.toThrow('válida');
    await expect(tables.submitPayment(table.id, { method: 'CASH', amount: 1 }, user)).rejects.toThrow('saldo completo');
    expect((await db.payment.findUnique({ where: { orderId: order.id } }))?.status).toBe('PENDING');
  });

  it('stores a single durable receipt, excludes bytes from lists, and reviews the entire settlement once', async () => {
    const first = await create();
    await create({ tableId: first.table.id });
    await finishKitchen(first.table.id);
    const result = await tables.submitPayment(first.table.id, { method: 'TRANSFER', amount: 7000 }, user, image);
    expect(result.table.balance).toBe(7000);
    const proofs = await db.transferProof.findMany({ where: { tableId: first.table.id } });
    expect(proofs).toHaveLength(1);
    expect(proofs[0].fileBase64).toContain('data:image/png;base64,');
    expect(JSON.stringify(result)).not.toContain('fileBase64');
    const list = await tables.listPaymentValidation();
    const item = list.find(p => p.id === result.payment.id);
    expect(item.amount).toBe(7000);
    expect(item.orderCount).toBe(2);
    expect(JSON.stringify(item)).not.toContain('fileBase64');
    const reviews = await Promise.allSettled([
      tables.reviewPayment(result.payment.id, 'CONFIRMED', user),
      tables.reviewPayment(result.payment.id, 'REJECTED', user),
    ]);
    expect(reviews.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const after = await db.payment.findUniqueOrThrow({ where: { id: result.payment.id } });
    const winningAction = reviews[0].status === 'fulfilled' ? 'CONFIRMED' : 'REJECTED';
    expect(after.status).toBe(winningAction);
    expect((await tables.findTable(first.table.id)).status).toBe(winningAction === 'CONFIRMED' ? 'CLOSED' : 'OPEN');
    await tables.reviewPayment(result.payment.id, winningAction, user);
    expect((await db.payment.findUniqueOrThrow({ where: { id: result.payment.id } })).confirmedAt).toEqual(after.confirmedAt);
  });

  it('keeps a rejected receipt history when submitting a replacement', async () => {
    const { table } = await create();
    const first = await tables.submitPayment(table.id, { method: 'TRANSFER', amount: 3500 }, user, image);
    await tables.reviewPayment(first.payment.id, 'REJECTED', user, 'Ilegible');
    await tables.submitPayment(table.id, { method: 'TRANSFER', amount: 3500 }, user, image);
    const proofs = await db.transferProof.findMany({ where: { tableId: table.id }, orderBy: { createdAt: 'asc' } });
    expect(proofs.map(p => p.status)).toEqual(['REJECTED', 'PENDING']);
    await finishKitchen(table.id);
    await tables.reviewPayment(first.payment.id, 'CONFIRMED', user);
    expect((await tables.findTable(table.id)).status).toBe('CLOSED');
    expect((await db.transferProof.findUniqueOrThrow({ where: { id: proofs[0].id } })).status).toBe('REJECTED');
  });
});
