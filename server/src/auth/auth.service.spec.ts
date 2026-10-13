import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  DEFAULT_ORGANIZATION_ID,
  DEFAULT_SITE_ID,
} from '../common/multisite.constants';

describe('AuthService multisite foundation', () => {
  let authService: AuthService;
  let prisma: any;
  let jwtService: any;
  let mailService: any;
  let auditService: any;
  let siteAccess: any;

  const principalSite = {
    id: DEFAULT_SITE_ID,
    code: 'principal',
    name: 'Sede Principal',
    timezone: 'America/Bogota',
    organizationId: DEFAULT_ORGANIZATION_ID,
    organizationName: 'The Villa Dog',
    role: 'CASHIER',
    permissions: ['cash.view'],
    isDefault: true,
    active: true,
    preparationMode: false,
  };

  const branchSite = {
    id: 'site-branch-2',
    code: 'norte',
    name: 'Sede Norte',
    timezone: 'America/Bogota',
    organizationId: DEFAULT_ORGANIZATION_ID,
    organizationName: 'The Villa Dog',
    role: 'CASHIER',
    permissions: ['cash.view'],
    isDefault: false,
    active: true,
    preparationMode: false,
  };

  const draftSite = {
    ...branchSite,
    id: 'site-draft-1',
    code: 'draft-1',
    name: 'Sede en preparación',
    active: false,
    preparationMode: true,
  };

  const mockUser = {
    id: 'user-123',
    email: 'test@thevilladog.com',
    role: 'CASHIER',
    permissions: ['cash.view'],
    active: true,
    lastActiveSiteId: DEFAULT_SITE_ID,
  };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    jwtService = {
      sign: jest.fn((payload, options) => {
        const type = payload.type || 'access';
        return `signed-${type}-${payload.siteId}-${payload.sub}`;
      }),
      verify: jest.fn(),
    };
    mailService = { sendMail: jest.fn() };
    auditService = { log: jest.fn() };
    siteAccess = {
      resolveActiveSite: jest.fn(),
      rememberActiveSite: jest.fn(),
      listAvailableSites: jest.fn(),
    };

    authService = new AuthService(
      prisma,
      jwtService,
      mailService,
      auditService,
      siteAccess,
    );
  });

  describe('6. Refresh conserva la sede autorizada', () => {
    it('generates a new session preserving the signed siteId from the refresh token', async () => {
      jwtService.verify.mockReturnValue({
        sub: mockUser.id,
        email: mockUser.email,
        siteId: branchSite.id,
        organizationId: DEFAULT_ORGANIZATION_ID,
        type: 'refresh',
      });
      prisma.user.findUnique.mockResolvedValue(mockUser);
      siteAccess.resolveActiveSite.mockResolvedValue({
        activeSite: branchSite,
        sites: [principalSite, branchSite],
      });

      const result = await authService.refreshToken('valid-refresh-token');

      expect(jwtService.verify).toHaveBeenCalledWith('valid-refresh-token');
      expect(siteAccess.resolveActiveSite).toHaveBeenCalledWith(
        mockUser,
        branchSite.id,
      );
      expect(result.accessToken).toBe(
        `signed-access-${branchSite.id}-${mockUser.id}`,
      );
      expect(result.refreshToken).toBe(
        `signed-refresh-${branchSite.id}-${mockUser.id}`,
      );
    });

    it('preserves an explicitly selected draft for a SUPERADMIN refresh', async () => {
      const superadmin = {
        ...mockUser,
        id: 'super-1',
        email: 'super@thevilladog.com',
        role: 'SUPERADMIN',
        permissions: ['*'],
      };
      jwtService.verify.mockReturnValue({
        sub: superadmin.id,
        email: superadmin.email,
        siteId: draftSite.id,
        type: 'refresh',
      });
      prisma.user.findUnique.mockResolvedValue(superadmin);
      siteAccess.resolveActiveSite.mockResolvedValue({
        activeSite: { ...draftSite, role: 'SUPERADMIN', permissions: ['*'] },
        sites: [principalSite, draftSite],
      });

      await authService.refreshToken('draft-refresh-token');

      expect(siteAccess.resolveActiveSite).toHaveBeenCalledWith(
        superadmin,
        draftSite.id,
      );
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          siteId: draftSite.id,
          siteActive: false,
          preparationMode: true,
        }),
        expect.any(Object),
      );
      expect(siteAccess.rememberActiveSite).not.toHaveBeenCalled();
    });
  });

  describe('7 & 8. Switch devuelve tokens nuevos y actualiza lastActiveSiteId después de validar', () => {
    it('returns new tokens and updates lastActiveSiteId ONLY after validation succeeds', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      siteAccess.resolveActiveSite.mockResolvedValue({
        activeSite: branchSite,
        sites: [principalSite, branchSite],
      });
      siteAccess.rememberActiveSite.mockResolvedValue({ id: mockUser.id });

      const result = await authService.switchSite(mockUser.id, branchSite.id);

      expect(siteAccess.resolveActiveSite).toHaveBeenCalledWith(
        mockUser,
        branchSite.id,
      );
      expect(siteAccess.rememberActiveSite).toHaveBeenCalledWith(
        mockUser.id,
        branchSite.id,
      );
      expect(result.accessToken).toBe(
        `signed-access-${branchSite.id}-${mockUser.id}`,
      );
      expect(result.refreshToken).toBe(
        `signed-refresh-${branchSite.id}-${mockUser.id}`,
      );
      expect(result.activeSite.id).toBe(branchSite.id);
    });

    it('issues a preparation session without persisting the draft as lastActiveSiteId', async () => {
      const superadmin = {
        ...mockUser,
        id: 'super-1',
        email: 'super@thevilladog.com',
        role: 'SUPERADMIN',
        permissions: ['*'],
      };
      prisma.user.findUnique.mockResolvedValue(superadmin);
      siteAccess.resolveActiveSite.mockResolvedValue({
        activeSite: { ...draftSite, role: 'SUPERADMIN', permissions: ['*'] },
        sites: [principalSite, draftSite],
      });

      const result = await authService.switchSite(superadmin.id, draftSite.id);

      expect(siteAccess.rememberActiveSite).not.toHaveBeenCalled();
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          siteId: draftSite.id,
          siteActive: false,
          preparationMode: true,
        }),
        expect.any(Object),
      );
      expect(result.user.activeSite).toEqual(
        expect.objectContaining({
          id: draftSite.id,
          active: false,
          preparationMode: true,
        }),
      );
      expect(result.user.sites).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: draftSite.id,
            active: false,
            preparationMode: true,
          }),
        ]),
      );
    });
  });

  describe('Selección implícita de sede', () => {
    it('does not pass a stored site as an explicit draft selection during login', async () => {
      const superadmin = {
        ...mockUser,
        role: 'SUPERADMIN',
        password: 'hash',
        failedLoginAttempts: 0,
        lockoutUntil: null,
        mustVerifyEmail: false,
        emailVerified: true,
        lastActiveSiteId: draftSite.id,
      };
      prisma.user.findUnique.mockResolvedValue(superadmin);
      siteAccess.resolveActiveSite.mockResolvedValue({
        activeSite: { ...principalSite, role: 'SUPERADMIN' },
        sites: [principalSite, draftSite],
      });
      const compareSpy = jest
        .spyOn(require('bcryptjs'), 'compare')
        .mockResolvedValue(true);

      await authService.login({
        email: superadmin.email,
        password: 'valid-password',
      });

      compareSpy.mockRestore();

      expect(siteAccess.resolveActiveSite).toHaveBeenCalledWith(
        superadmin,
        undefined,
      );
    });
  });

  describe('9. Un usuario normal no puede cambiar a una sede sin membresía', () => {
    it('rejects switchSite and does NOT update lastActiveSiteId when site is not authorized', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      siteAccess.resolveActiveSite.mockRejectedValue(
        new ForbiddenException('No tienes acceso a la sede seleccionada'),
      );

      await expect(
        authService.switchSite(mockUser.id, 'unauthorized-site'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(siteAccess.rememberActiveSite).not.toHaveBeenCalled();
    });
  });

  describe('12. Access token y refresh token no pueden intercambiarse', () => {
    it('rejects an access token sent to refreshToken endpoint', async () => {
      jwtService.verify.mockReturnValue({
        sub: mockUser.id,
        email: mockUser.email,
        siteId: DEFAULT_SITE_ID,
        // Missing type: 'refresh'
      });

      await expect(
        authService.refreshToken('access-token-as-refresh'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('13. Impersonación no concede acceso a una sede ajena', () => {
    it('fails to impersonate if the target user does not have membership in the requested site', async () => {
      const superadmin = {
        id: 'super-1',
        name: 'Super Admin',
        role: 'SUPERADMIN',
      };
      const targetUser = {
        id: 'target-1',
        name: 'Target',
        email: 'target@test.com',
        role: 'CASHIER',
        active: true,
      };

      prisma.user.findUnique.mockResolvedValue(targetUser);
      siteAccess.resolveActiveSite.mockRejectedValue(
        new ForbiddenException('No tienes acceso a la sede seleccionada'),
      );

      await expect(
        authService.impersonate(
          superadmin,
          targetUser.id,
          'unauthorized-site-for-target',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('successfully impersonates target into their authorized site with impersonatedBy metadata', async () => {
      const superadmin = {
        id: 'super-1',
        name: 'Super Admin',
        role: 'SUPERADMIN',
      };
      const targetUser = {
        id: 'target-1',
        name: 'Target',
        email: 'target@test.com',
        role: 'CASHIER',
        active: true,
        lastActiveSiteId: DEFAULT_SITE_ID,
      };

      prisma.user.findUnique.mockResolvedValue(targetUser);
      siteAccess.resolveActiveSite.mockResolvedValue({
        activeSite: principalSite,
        sites: [principalSite],
      });

      const result = await authService.impersonate(superadmin, targetUser.id);

      expect(result.activeSite.id).toBe(DEFAULT_SITE_ID);
      expect(result.accessToken).toBeDefined();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: superadmin.id,
          action: 'IMPERSONATE_START',
        }),
      );
    });
  });
});
