import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SocketGateway } from '../socket/socket.gateway';
import { DEFAULT_SITE_ID } from '../common/multisite.constants';

@Injectable()
export class CustomersService {
  constructor(
    private prisma: PrismaService,
    private socketGateway: SocketGateway,
  ) {}

  async create(
    data: { name: string; phone: string; address?: string },
    siteId = DEFAULT_SITE_ID,
  ) {
    const phoneClean = data.phone.replace(/\D/g, '');
    const existing = await this.prisma.customer.findUnique({
      where: { siteId_phone: { siteId, phone: phoneClean } },
    });
    if (existing) {
      throw new BadRequestException('Ya existe un cliente registrado con este número de teléfono.');
    }

    const created = await this.prisma.customer.create({
      data: {
        name: data.name,
        phone: phoneClean,
        address: data.address || null,
        siteId,
      },
    });
    this.socketGateway.emitToSite(siteId, 'customersChanged');
    return created;
  }

  async findAll(search?: string, siteId = DEFAULT_SITE_ID) {
    const where: any = { siteId, active: true };
    if (search) {
      const cleanSearch = search.trim();
      where.OR = [
        { name: { contains: cleanSearch, mode: 'insensitive' } },
        { phone: { contains: cleanSearch } },
      ];
    }

    const customers = await this.prisma.customer.findMany({
      where,
      include: {
        orders: {
          where: { siteId, paymentMethod: 'CREDIT' },
          select: { total: true },
        },
        payments: {
          where: { siteId },
          select: { amount: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return customers.map(c => {
      const totalCreditOrders = c.orders.reduce((sum, o) => sum + o.total, 0);
      const totalPayments = c.payments.reduce((sum, p) => sum + p.amount, 0);
      const debt = Math.max(0, totalCreditOrders - totalPayments);

      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        address: c.address,
        active: c.active,
        createdAt: c.createdAt,
        totalDebt: debt,
      };
    });
  }

  async findOne(id: string, siteId = DEFAULT_SITE_ID) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, siteId },
      include: {
        orders: {
          where: { siteId },
          orderBy: { createdAt: 'desc' },
          include: { zone: true, items: { include: { menuItem: true } } },
        },
        payments: {
          where: { siteId },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Cliente no encontrado');
    }

    const totalCreditOrders = customer.orders
      .filter(o => o.paymentMethod === 'CREDIT')
      .reduce((sum, o) => sum + o.total, 0);
    const totalPayments = customer.payments.reduce((sum, p) => sum + p.amount, 0);
    const debt = Math.max(0, totalCreditOrders - totalPayments);

    return {
      ...customer,
      totalDebt: debt,
    };
  }

  async update(
    id: string,
    data: { name?: string; phone?: string; address?: string; active?: boolean },
    siteId = DEFAULT_SITE_ID,
  ) {
    const customer = await this.prisma.customer.findFirst({ where: { id, siteId } });
    if (!customer) throw new NotFoundException('Cliente no encontrado');

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.address !== undefined) updateData.address = data.address || null;
    if (data.active !== undefined) updateData.active = data.active;
    if (data.phone !== undefined) {
      const phoneClean = data.phone.replace(/\D/g, '');
      if (phoneClean !== customer.phone) {
        const existing = await this.prisma.customer.findUnique({
          where: { siteId_phone: { siteId, phone: phoneClean } },
        });
        if (existing) throw new BadRequestException('Ya existe otro cliente con este teléfono.');
        updateData.phone = phoneClean;
      }
    }

    const updated = await this.prisma.customer.update({
      where: { id },
      data: updateData,
    });
    this.socketGateway.emitToSite(siteId, 'customersChanged');
    return updated;
  }

  async addPayment(
    customerId: string,
    data: { amount: number; method: string; reference?: string; notes?: string },
    userId: string,
    siteId = DEFAULT_SITE_ID,
  ) {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, siteId } });
    if (!customer) throw new NotFoundException('Cliente no encontrado');

    if (data.amount <= 0) {
      throw new BadRequestException('El monto del abono debe ser mayor a cero.');
    }

    // Validar caja abierta
    const activeClosing = await this.prisma.cashClosing.findFirst({
      where: { siteId, userId, isOpen: true },
    });
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.role === 'CASHIER' && !activeClosing) {
      throw new BadRequestException('Debes tener una caja abierta para registrar abonos de clientes.');
    }

    const payment = await this.prisma.customerPayment.create({
      data: {
        siteId,
        customerId,
        amount: data.amount,
        method: data.method,
        reference: data.reference || null,
        notes: data.notes || null,
        cashRegisterId: activeClosing?.cashRegisterId || null,
        confirmedById: userId,
      },
    });
    this.socketGateway.emitToSite(siteId, 'customersChanged');
    return payment;
  }

  async remove(id: string, siteId = DEFAULT_SITE_ID) {
    const customer = await this.prisma.customer.findFirst({ where: { id, siteId } });
    if (!customer) throw new NotFoundException('Cliente no encontrado');
    const removed = await this.prisma.customer.update({
      where: { id },
      data: { active: false },
    });
    this.socketGateway.emitToSite(siteId, 'customersChanged');
    return removed;
  }
}
