import { ForbiddenException } from '@nestjs/common';
import { AuthController } from '../auth.controller';
import { ALLOW_DRAFT_SITE_SETUP_KEY } from '../decorators/allow-draft-site-setup.decorator';
import { PrintController } from '../../print/print.controller';
import { CashRegistersController } from '../../cash-registers/cash-registers.controller';
import { KitchenController } from '../../tables/kitchen.controller';
import { UsersController } from '../../users/users.controller';
import { WhatsappController } from '../../whatsapp/whatsapp.controller';
import { ZonesController } from '../../zones/zones.controller';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard draft site isolation', () => {
  const context = {
    getHandler: jest.fn().mockReturnValue({}),
    getClass: jest.fn().mockReturnValue({}),
  } as any;

  const activeUser = {
    id: 'user-1',
    role: 'CASHIER',
    globalRole: null,
    siteActive: true,
    preparationMode: false,
    site: { active: true, preparationMode: false },
  };

  const draftSuperadmin = {
    id: 'super-1',
    role: 'SUPERADMIN',
    globalRole: 'SUPERADMIN',
    siteActive: false,
    preparationMode: true,
    site: { active: false, preparationMode: true },
  };

  it('preserves the existing behavior for active sites', () => {
    const reflector: any = { getAllAndOverride: jest.fn() };
    const guard = new JwtAuthGuard(reflector);

    expect(guard.handleRequest(null, activeUser, null, context)).toBe(
      activeUser,
    );
    expect(reflector.getAllAndOverride).not.toHaveBeenCalled();
  });

  it('allows a global SUPERADMIN on an explicitly enabled setup endpoint', () => {
    const reflector: any = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    };
    const guard = new JwtAuthGuard(reflector);

    expect(guard.handleRequest(null, draftSuperadmin, null, context)).toBe(
      draftSuperadmin,
    );
  });

  it('blocks an inactive site on endpoints without the setup decorator', () => {
    const reflector: any = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    };
    const guard = new JwtAuthGuard(reflector);

    expect(() =>
      guard.handleRequest(null, draftSuperadmin, null, context),
    ).toThrow(ForbiddenException);
  });

  it('does not let a regular role use the setup decorator', () => {
    const reflector: any = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    };
    const guard = new JwtAuthGuard(reflector);
    const spoofedUser = {
      ...draftSuperadmin,
      role: 'ADMIN',
      globalRole: null,
    };

    expect(() => guard.handleRequest(null, spoofedUser, null, context)).toThrow(
      ForbiddenException,
    );
  });

  it('enables preparation mode only on the three minimal authenticated auth endpoints', () => {
    const prototype = AuthController.prototype;

    expect(
      Reflect.getMetadata(ALLOW_DRAFT_SITE_SETUP_KEY, prototype.getProfile),
    ).toBe(true);
    expect(
      Reflect.getMetadata(ALLOW_DRAFT_SITE_SETUP_KEY, prototype.listSites),
    ).toBe(true);
    expect(
      Reflect.getMetadata(ALLOW_DRAFT_SITE_SETUP_KEY, prototype.switchSite),
    ).toBe(true);
    expect(
      Reflect.getMetadata(ALLOW_DRAFT_SITE_SETUP_KEY, prototype.updateProfile),
    ).toBeUndefined();
  });

  it('allows the print bridge setup and printer test while a site is in preparation', () => {
    const prototype = PrintController.prototype;

    expect(
      Reflect.getMetadata(ALLOW_DRAFT_SITE_SETUP_KEY, prototype.getBridgeToken),
    ).toBe(true);
    expect(
      Reflect.getMetadata(ALLOW_DRAFT_SITE_SETUP_KEY, prototype.testPrint),
    ).toBe(true);
  });

  it('exposes only configuration methods while a site is in preparation', () => {
    const allowed = [
      CashRegistersController.prototype.findAll,
      CashRegistersController.prototype.create,
      CashRegistersController.prototype.update,
      CashRegistersController.prototype.remove,
      KitchenController.prototype.stations,
      KitchenController.prototype.saveStation,
      KitchenController.prototype.deleteStation,
      KitchenController.prototype.getKitchenSettings,
      KitchenController.prototype.updateKitchenSettings,
      UsersController.prototype.findAll,
      UsersController.prototype.getPermissionsCatalog,
      UsersController.prototype.create,
      WhatsappController.prototype.getSettings,
      WhatsappController.prototype.updateSettings,
      WhatsappController.prototype.regenerateMenuText,
      WhatsappController.prototype.uploadPaymentQrFile,
      WhatsappController.prototype.deletePaymentQrFile,
      WhatsappController.prototype.testMeta,
      ZonesController.prototype.findAll,
      ZonesController.prototype.getGroups,
      ZonesController.prototype.create,
      ZonesController.prototype.update,
      ZonesController.prototype.remove,
      PrintController.prototype.getSettings,
      PrintController.prototype.saveSettings,
      PrintController.prototype.getBridgeToken,
      PrintController.prototype.testPrint,
      PrintController.prototype.clearPrintQueue,
      PrintController.prototype.clearPrintQueueByTarget,
    ];
    const blocked = [
      CashRegistersController.prototype.getSummary,
      KitchenController.prototype.tickets,
      KitchenController.prototype.updateTicket,
      KitchenController.prototype.getCookStatuses,
      KitchenController.prototype.updateCookStatus,
      KitchenController.prototype.getDeliveryCookStatuses,
      KitchenController.prototype.updateDeliveryCookStatus,
      UsersController.prototype.update,
      WhatsappController.prototype.getSessions,
      WhatsappController.prototype.sendMessage,
      PrintController.prototype.printOrder,
      PrintController.prototype.openDrawer,
      ZonesController.prototype.findAllWithOrders,
      ZonesController.prototype.clearAll,
    ];

    for (const method of allowed) {
      expect(Reflect.getMetadata(ALLOW_DRAFT_SITE_SETUP_KEY, method)).toBe(
        true,
      );
    }
    for (const method of blocked) {
      expect(
        Reflect.getMetadata(ALLOW_DRAFT_SITE_SETUP_KEY, method),
      ).toBeUndefined();
    }
  });
});
