import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrdersService } from '../src/orders/orders.service';
import { PaymentsService } from '../src/payments/payments.service';
import { InventoryService } from '../src/inventory/inventory.service';
import { ExpensesService } from '../src/expenses/expenses.service';
import { MenuService } from '../src/menu/menu.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SocketGateway } from '../src/socket/socket.gateway';
import { WhatsappService } from '../src/whatsapp/whatsapp.service';
import { PrintService } from '../src/print/print.service';
import { MailService } from '../src/mail/mail.service';
import { CacheService } from '../src/cache/cache.service';

describe('Security & Logic Audit Tests', () => {
  let ordersService: OrdersService;
  let paymentsService: PaymentsService;
  let inventoryService: InventoryService;
  let expensesService: ExpensesService;
  let menuService: MenuService;

  // Mocked dependencies
  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
    },
    menuItem: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    menuCategory: {
      findUnique: jest.fn(),
    },
    order: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    orderItem: {
      deleteMany: jest.fn(),
    },
    payment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    cashClosing: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    ingredient: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    stockMovement: {
      create: jest.fn(),
    },
    expense: {
      create: jest.fn(),
    },
    purchase: {
      create: jest.fn(),
    },
    purchaseItem: {
      create: jest.fn(),
    },
    deliveryZone: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(mockPrisma)),
  };

  const mockSocket = {
    emitNewOrder: jest.fn(),
    emitOrderStatusChange: jest.fn(),
    server: {
      emit: jest.fn(),
    },
  };

  const mockWhatsapp = {
    sendMessage: jest.fn(),
  };

  const mockPrint = {
    getPrinterSettings: jest.fn().mockResolvedValue({ printers: [] }),
    formatCocinaTicketText: jest.fn(),
    buildEscPos: jest.fn(),
    printCancellation: jest.fn(),
  };

  const mockMail = {
    sendLowStockAlert: jest.fn(),
  };

  const mockCache = {
    getOrSet: jest.fn((_key: string, factory: () => unknown) => factory()),
    invalidateByPrefix: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        PaymentsService,
        InventoryService,
        ExpensesService,
        MenuService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SocketGateway, useValue: mockSocket },
        { provide: WhatsappService, useValue: mockWhatsapp },
        { provide: PrintService, useValue: mockPrint },
        { provide: MailService, useValue: mockMail },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();

    ordersService = module.get<OrdersService>(OrdersService);
    paymentsService = module.get<PaymentsService>(PaymentsService);
    inventoryService = module.get<InventoryService>(InventoryService);
    expensesService = module.get<ExpensesService>(ExpensesService);
    menuService = module.get<MenuService>(MenuService);
  });

  describe('1. Orders - Negative/Zero Quantity Validation', () => {
    it('should throw BadRequestException if order creation has item.quantity <= 0', async () => {
      // Mock active closing (cash register open)
      mockPrisma.cashClosing.findFirst.mockResolvedValue({ id: 'closing-1', isOpen: true });

      const orderData = {
        customerName: 'Jose Test',
        customerPhone: '3001234567',
        customerAddress: 'Calle 1',
        items: [
          { menuItemId: 'item-1', quantity: -2, notes: 'Negative qty' },
        ],
        waiterId: 'waiter-1',
        userId: 'cashier-1',
        userRole: 'CASHIER',
      };

      await expect(ordersService.create(orderData)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if order update has item.quantity <= 0', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({ id: 'order-1', status: 'PENDING' });

      const updateData = {
        customerName: 'Jose Test',
        customerPhone: '3001234567',
        customerAddress: 'Calle 1',
        items: [
          { menuItemId: 'item-1', quantity: 0, notes: 'Zero qty' },
        ],
      };

      await expect(ordersService.update('order-1', updateData)).rejects.toThrow(BadRequestException);
    });
  });

  describe('2. Payments - Cashier Cash Closing Validations', () => {
    it('should throw BadRequestException when CASHIER role tries to confirm payment with closed cash register', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'cashier-1', role: 'CASHIER' });
      mockPrisma.cashClosing.findFirst.mockResolvedValue(null); // No active closing

      await expect(paymentsService.confirmPayment('payment-1', 'cashier-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when CASHIER role tries to reject payment with closed cash register', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'cashier-1', role: 'CASHIER' });
      mockPrisma.cashClosing.findFirst.mockResolvedValue(null); // No active closing

      await expect(paymentsService.rejectPayment('payment-1', 'cashier-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when CASHIER role tries to pay credit order with closed cash register', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({ id: 'order-1', paymentMethod: 'CREDIT', total: 5000 });
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'cashier-1', role: 'CASHIER' });
      mockPrisma.cashClosing.findFirst.mockResolvedValue(null); // No active closing

      await expect(
        paymentsService.payCreditOrder('order-1', { method: 'CASH' }, 'cashier-1')
      ).rejects.toThrow(BadRequestException);
    });

    it('should ALLOW ADMIN/SUPERADMIN role to confirm/reject/pay credit even with no active cash closing', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'admin-1', role: 'ADMIN' });
      mockPrisma.payment.findUnique.mockResolvedValue({ id: 'payment-1', orderId: 'order-1' });
      mockPrisma.payment.update.mockResolvedValue({ id: 'payment-1', status: 'CONFIRMED' });
      mockPrisma.order.update.mockResolvedValue({ id: 'order-1', paymentStatus: 'CONFIRMED' });

      const res = await paymentsService.confirmPayment('payment-1', 'admin-1');
      expect(res.status).toBe('CONFIRMED');
      expect(mockPrisma.cashClosing.findFirst).toHaveBeenCalledWith({
        where: { userId: 'admin-1', isOpen: true },
      });
    });
  });

  describe('3. Inventory - Negative Adjustments & Stock Movement Bounds', () => {
    it('should throw BadRequestException for negative adjustment quantity', async () => {
      await expect(
        inventoryService.adjustStock('ing-1', -10, 'IN', 'Refill', 'user-1')
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for zero quantity IN/OUT adjustments', async () => {
      await expect(
        inventoryService.adjustStock('ing-1', 0, 'OUT', 'Usage', 'user-1')
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('4. Expenses - Negative Amount & Quantity Validations', () => {
    it('should throw BadRequestException if expense amount <= 0', async () => {
      const expenseData = {
        description: 'Mock Negative Expense',
        amount: -5000,
        categoryId: 'cat-1',
        userId: 'user-1',
      };

      await expect(expensesService.create(expenseData)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if linked ingredient quantity <= 0', async () => {
      const expenseData = {
        description: 'Mock Expense with Qty 0',
        amount: 2000,
        categoryId: 'cat-1',
        userId: 'user-1',
        ingredientId: 'ing-1',
        quantity: 0,
      };

      await expect(expensesService.create(expenseData)).rejects.toThrow(BadRequestException);
    });
  });

  describe('5. Menu - Negative Price Validation', () => {
    it('should throw BadRequestException if menu item price is negative on creation', async () => {
      const itemData = {
        name: 'Negative Burger',
        price: -15000,
        categoryId: 'cat-1',
      };

      await expect(menuService.createItem(itemData)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if menu item price is negative on update', async () => {
      mockPrisma.menuItem.findUnique.mockResolvedValue({ id: 'item-1', name: 'Standard Burger', price: 10000 });

      await expect(
        menuService.updateItem('item-1', { price: -5000 })
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('6. Purchases - Negative/Zero Quantities & Costs', () => {
    it('should throw BadRequestException if purchase items array is empty', async () => {
      const purchaseData = {
        supplierId: 'sup-1',
        invoiceNumber: 'INV-001',
        items: [],
      };

      await expect(inventoryService.createPurchase(purchaseData, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if purchase item quantity <= 0', async () => {
      const purchaseData = {
        supplierId: 'sup-1',
        invoiceNumber: 'INV-001',
        items: [
          { ingredientId: 'ing-1', quantity: 0, unitCost: 100 },
        ],
      };

      await expect(inventoryService.createPurchase(purchaseData, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if purchase item unitCost < 0', async () => {
      const purchaseData = {
        supplierId: 'sup-1',
        invoiceNumber: 'INV-001',
        items: [
          { ingredientId: 'ing-1', quantity: 10, unitCost: -5 },
        ],
      };

      await expect(inventoryService.createPurchase(purchaseData, 'user-1')).rejects.toThrow(BadRequestException);
    });
  });
});
