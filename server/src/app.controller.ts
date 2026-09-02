import { Controller, Get, Post, UseGuards, Body } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PrismaService } from './prisma/prisma.service';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard, Roles } from './auth/guards/roles.guard';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private prisma: PrismaService) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check' })
  getHello() {
    return {
      name: 'The Villa Dog Domicilios API',
      version: '1.0.0',
      status: 'running',
      docs: '/docs',
    };
  }

  @Get('public/login-stats')
  @ApiOperation({ summary: 'Obtener estadísticas públicas para la pantalla de login' })
  async getLoginStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 1. Pedidos Hoy
    const orders = await this.prisma.order.findMany({
      where: {
        createdAt: { gte: today, lt: tomorrow },
      },
      select: {
        status: true,
      },
    });

    const activeOrders = orders.filter(o => o.status !== 'CANCELLED');
    const totalOrdersCount = activeOrders.length;

    // 2. Entrega Promedio (average delivery time of today's delivered orders)
    const deliveredToday = await this.prisma.order.findMany({
      where: {
        status: 'DELIVERED',
        createdAt: { gte: today, lt: tomorrow },
      },
      select: {
        createdAt: true,
        updatedAt: true,
      },
    });

    let avgDeliveryTime = 0;
    if (deliveredToday.length > 0) {
      avgDeliveryTime = Math.round(
        deliveredToday.reduce((sum, o) => sum + (o.updatedAt.getTime() - o.createdAt.getTime()), 0) /
        deliveredToday.length /
        60000
      );
    } else {
      // Fallback: average of last 30 days
      const startOf30DaysAgo = new Date();
      startOf30DaysAgo.setDate(startOf30DaysAgo.getDate() - 30);
      const deliveredPast = await this.prisma.order.findMany({
        where: {
          status: 'DELIVERED',
          createdAt: { gte: startOf30DaysAgo },
        },
        select: {
          createdAt: true,
          updatedAt: true,
        },
      });
      if (deliveredPast.length > 0) {
        avgDeliveryTime = Math.round(
          deliveredPast.reduce((sum, o) => sum + (o.updatedAt.getTime() - o.createdAt.getTime()), 0) /
          deliveredPast.length /
          60000
        );
      } else {
        avgDeliveryTime = 22; // default mock fallback
      }
    }

    // 3. Operadores en línea
    const activeOperators = await this.prisma.user.findMany({
      where: {
        active: true,
        role: { in: ['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER'] },
      },
      select: {
        name: true,
        role: true,
      },
      orderBy: { name: 'asc' },
    });

    const roleColors: Record<string, string> = {
      SUPERADMIN: '#F59E0B',
      ADMIN: '#3B82F6',
      CASHIER: '#10B981',
      DELIVERY_MANAGER: '#8B5CF6',
    };

    const getInitials = (n: string) =>
      n
        .split(' ')
        .map(w => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);

    const operatorsList = activeOperators.map(u => ({
      name: u.name,
      role: u.role,
      initials: getInitials(u.name),
      color: roleColors[u.role] || '#999',
    }));

    // 4. Moto en ruta (Ruta Activa)
    const orderInRoute = await this.prisma.order.findFirst({
      where: { status: 'IN_ROUTE' },
      include: {
        assignee: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    let activeRoute: any = null;

    if (orderInRoute) {
      const riderName = orderInRoute.assignee ? orderInRoute.assignee.name : 'Domiciliario';
      const riderFirstName = riderName.split(' ')[0];
      const elapsedMs = Date.now() - new Date(orderInRoute.updatedAt).getTime();
      const elapsedMin = Math.floor(elapsedMs / 60000);
      const totalEstimatedMin = 20; // Assume 20 min avg route
      const remainingMin = Math.max(1, totalEstimatedMin - elapsedMin);

      activeRoute = {
        riderName: `Moto (${riderFirstName})`,
        address: orderInRoute.customerAddress,
        status: 'En ruta',
        remainingTime: `${remainingMin} min rest.`,
        isActive: true,
      };
    } else {
      const orderReady = await this.prisma.order.findFirst({
        where: { status: 'READY' },
        include: {
          assignee: { select: { name: true } },
        },
        orderBy: { updatedAt: 'desc' },
      });

      if (orderReady) {
        const riderName = orderReady.assignee ? orderReady.assignee.name : 'Por asignar';
        const riderFirstName = riderName.split(' ')[0];
        activeRoute = {
          riderName: orderReady.assignee ? `Moto (${riderFirstName})` : 'Moto (Sin asignar)',
          address: orderReady.customerAddress,
          status: 'Listo para despacho',
          remainingTime: 'En espera',
          isActive: false,
        };
      } else {
        const lastDelivered = await this.prisma.order.findFirst({
          where: { status: 'DELIVERED' },
          include: {
            assignee: { select: { name: true } },
          },
          orderBy: { updatedAt: 'desc' },
        });

        if (lastDelivered) {
          const riderName = lastDelivered.assignee ? lastDelivered.assignee.name : 'Domiciliario';
          const riderFirstName = riderName.split(' ')[0];
          const elapsedMs = Date.now() - new Date(lastDelivered.updatedAt).getTime();
          const elapsedMin = Math.floor(elapsedMs / 60000);
          const timeAgoText = elapsedMin < 60 ? `Hace ${elapsedMin} min` : `Hace ${Math.floor(elapsedMin / 60)}h`;

          activeRoute = {
            riderName: `Moto (${riderFirstName})`,
            address: lastDelivered.customerAddress,
            status: 'Entregado',
            remainingTime: timeAgoText,
            isActive: false,
          };
        } else {
          const firstRider = await this.prisma.user.findFirst({
            where: { role: 'DELIVERY_MANAGER', active: true },
            select: { name: true },
          });
          const riderName = firstRider ? firstRider.name.split(' ')[0] : 'Carlos';
          activeRoute = {
            riderName: `Moto (${riderName})`,
            address: 'Montería, Local',
            status: 'Disponible',
            remainingTime: 'En espera',
            isActive: false,
          };
        }
      }
    }

    return {
      pedidosHoy: totalOrdersCount,
      entregaPromedio: avgDeliveryTime,
      operadores: operatorsList,
      activeRoute,
    };
  }

  @Get('imprimir/cola')
  @Get('cola-impresion')
  @Get('api/imprimir/cola')
  @Get('api/cola-impresion')
  @ApiOperation({ summary: 'Consultar cola de impresión' })
  async getPrintQueue() {
    const jobs = await this.prisma.printJob.findMany({
      where: { impreso: false },
      orderBy: { id: 'asc' },
    });

    let customPrinters: any[] = [];
    try {
      const row = await this.prisma.appSetting.findUnique({ where: { key: 'custom_prep_printers' } });
      if (row?.value) customPrinters = JSON.parse(row.value);
    } catch {}

    const cocinaIp = customPrinters.find(p => p.name?.toLowerCase().includes('cocina') && p.ip)?.ip || '192.168.1.150';
    const pizzasIp = customPrinters.find(p => p.name?.toLowerCase().includes('pizza') && p.ip)?.ip || '192.168.1.140';

    return jobs.map(j => {
      let resolvedIp = (j.impresoraIp || '').trim();
      if (!/^\d+\.\d+\.\d+\.\d+/.test(resolvedIp) && !resolvedIp.startsWith('USB:')) {
        if (resolvedIp.toLowerCase().includes('pizza') || j.tipo?.toLowerCase().includes('pizza')) {
          resolvedIp = pizzasIp;
        } else {
          resolvedIp = cocinaIp;
        }
      }
      return {
        id: j.id,
        impresora_ip: resolvedIp,
        impresoraIp: resolvedIp,
        ip: resolvedIp,
        printer_ip: resolvedIp,
        payload: j.payload,
        data: j.payload,
        tipo: j.tipo,
      };
    });
  }

  @Post('imprimir/cola')
  @Post('cola-impresion')
  @Post('api/imprimir/cola')
  @Post('api/cola-impresion')
  @ApiOperation({ summary: 'Confirmar impresión y limpiar cola' })
  async confirmPrint(@Body() body: { ids: number[] }) {
    if (body && Array.isArray(body.ids) && body.ids.length > 0) {
      await this.prisma.printJob.deleteMany({
        where: { id: { in: body.ids } },
      });
    }
    return { ok: true };
  }


  @ApiTags('System')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN', 'ADMIN')
  @Post('system/clean')
  @ApiOperation({ summary: 'Limpiar transacciones de la base de datos' })
  async cleanSystem() {
    // 1. WhatsApp messages & sessions
    await this.prisma.whatsAppMessage.deleteMany({});
    await this.prisma.whatsAppSession.deleteMany({});

    // 2. Notifications
    await this.prisma.notification.deleteMany({});

    // 3. Shifts
    await this.prisma.shift.deleteMany({});

    // 4. Waiter metrics & badges
    await this.prisma.waiterBadge.deleteMany({});
    await this.prisma.waiterMetric.deleteMany({});

    // 5. Expenses
    await this.prisma.expense.deleteMany({});

    // 6. Cash closings
    await this.prisma.cashClosing.deleteMany({});

    // 7. Stock movements
    await this.prisma.stockMovement.deleteMany({});

    // 8. Payments
    await this.prisma.payment.deleteMany({});

    // 9. Orders & Order items
    await this.prisma.orderItem.deleteMany({});
    await this.prisma.order.deleteMany({});

    // 10. Restore standard stock
    const defaultStocks: Record<string, number> = {
      'Queso Mozzarella': 10000,
      'Jamón': 5000,
      'Pollo Pechuga': 5000,
      'Salami': 3000,
      'Pepperoni': 2000,
      'Tocineta Ahumada': 2000,
      'Chorizo de Ternera': 100,
      'Salchicha Long': 150,
      'Salchicha Suiza Premium': 50,
      'Salchicha Ranchera': 60,
      'Butifarra': 80,
      'Carne Hamburguesa 100g': 80,
      'Lomo de Res': 5000,
      'Cerdo Magro': 5000,
      'Papa (francesa)': 20000,
      'Papa (vapor)': 15000,
      'Plátano (patacón)': 100,
      'Maíz Tierno': 3000,
      'Piña': 2000,
      'Champiñones': 1500,
      'Queso Costeño': 5000,
      'Masa de Pizza': 100,
      'Pan Hamburguesa': 80,
      'Pan Perro': 100,
      'Empaque Domicilio': 200,
      'Salsa The Villa Dog': 5000,
      'Cervecero': 80,
    };

    for (const [name, stock] of Object.entries(defaultStocks)) {
      await this.prisma.ingredient.updateMany({
        where: { name },
        data: { stock },
      });
    }

    return { message: 'Sistema limpiado correctamente. Todo en 0.' };
  }
}
