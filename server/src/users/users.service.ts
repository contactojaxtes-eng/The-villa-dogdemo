import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SocketGateway } from '../socket/socket.gateway';
import * as bcrypt from 'bcryptjs';
import { DEFAULT_SITE_ID } from '../common/multisite.constants';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private socketGateway: SocketGateway,
  ) {}

  private async countMemberships(userId: string): Promise<number> {
    const memberships = (this.prisma as any).userSiteMembership;
    if (!memberships?.count) return 0;
    const count = await memberships.count({ where: { userId } });
    return Number.isFinite(Number(count)) ? Number(count) : 0;
  }

  private hasGlobalIdentityMutation(data: Record<string, unknown>): boolean {
    return [
      'name',
      'email',
      'password',
      'phone',
      'photo',
      'mustVerifyEmail',
      'emailVerified',
    ].some((key) => Object.prototype.hasOwnProperty.call(data || {}, key));
  }

  private async assertSharedAccountIdentityIsSafe(
    userId: string,
    data: Record<string, unknown>,
    allowSharedIdentityMutation = false,
  ): Promise<void> {
    if (allowSharedIdentityMutation || !this.hasGlobalIdentityMutation(data)) return;
    const membershipCount = await this.countMemberships(userId);
    if (membershipCount > 1) {
      throw new ForbiddenException(
        'Esta cuenta pertenece a varias sedes. Su nombre, correo, teléfono y contraseña deben gestionarse desde el alcance global para no afectar otra sede.',
      );
    }
  }

  async assertValidRole(role?: string) {
    if (!role) return 'CASHIER';
    const normalized = String(role).trim().toUpperCase();
    const systemRoles = ['SUPERADMIN', 'ADMIN', 'CASHIER', 'DELIVERY_MANAGER', 'DISPATCHER', 'WAITER', 'KITCHEN', 'DELIVERY_DRIVER'];
    if (systemRoles.includes(normalized)) return normalized;
    const customRole = await this.prisma.customRole.findFirst({
      where: { code: normalized, active: true },
      select: { code: true },
    });
    if (!customRole) throw new BadRequestException(`El rol ${normalized} no existe o está inactivo.`);
    return customRole.code;
  }

  private validateStrongPassword(password: string) {
    if (!password || password.length < 4) {
      throw new BadRequestException('La contraseña debe tener al menos 4 caracteres.');
    }
    return;
    if (!/[A-Z]/.test(password)) {
      throw new BadRequestException('La contraseña debe incluir al menos una letra mayúscula.');
    }
    if (!/[0-9]/.test(password)) {
      throw new BadRequestException('La contraseña debe incluir al menos un número.');
    }
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
      throw new BadRequestException('La contraseña debe incluir al menos un carácter especial (ej: !@#$%*).');
    }
  }

  async findAll(params: { role?: string; active?: boolean }, siteId = DEFAULT_SITE_ID) {
    const where: any = {
      email: { not: { startsWith: 'deleted_' } },
      OR: [
        { role: 'SUPERADMIN' },
        { siteMemberships: { some: { siteId } } },
      ],
    };
    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isOrganizationAdmin: true,
        permissions: true,
        phone: true,
        photo: true,
        active: true,
        mustVerifyEmail: true,
        emailVerified: true,
        createdAt: true,
        siteMemberships: {
          where: { siteId },
          select: { role: true, permissions: true, active: true },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return users
      .map((user) => {
        const membership = user.siteMemberships[0];
        const isSuperadmin = user.role === 'SUPERADMIN';
        return {
          ...user,
          role: isSuperadmin ? user.role : membership?.role || user.role,
          permissions: isSuperadmin ? user.permissions : membership?.permissions ?? user.permissions,
          active: user.active && (isSuperadmin || membership?.active === true),
          siteMemberships: undefined,
        };
      })
      .filter((user) => !params.role || user.role === params.role)
      .filter((user) => params.active === undefined || user.active === params.active);
  }

  async findOne(id: string, siteId = DEFAULT_SITE_ID, includeGlobalSuperadmin = false) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isOrganizationAdmin: true,
        permissions: true,
        phone: true,
        photo: true,
        active: true,
        mustVerifyEmail: true,
        emailVerified: true,
        createdAt: true,
        siteMemberships: {
          where: { siteId },
          select: { role: true, permissions: true, active: true },
          take: 1,
        },
      },
    });
    const membership = user?.siteMemberships[0];
    if (!user || (!membership && !(includeGlobalSuperadmin && user.role === 'SUPERADMIN'))) {
      throw new NotFoundException('Usuario no encontrado en esta sede');
    }
    const isSuperadmin = user.role === 'SUPERADMIN';
    return {
      ...user,
      role: isSuperadmin ? user.role : membership?.role || user.role,
      permissions: isSuperadmin ? user.permissions : membership?.permissions ?? user.permissions,
      active: user.active && (isSuperadmin || membership?.active === true),
      siteMemberships: undefined,
    };
  }

  async getWaiters(siteId = DEFAULT_SITE_ID) {
    return this.prisma.user.findMany({
      where: {
        active: true,
        siteMemberships: {
          some: { siteId, role: 'DELIVERY_MANAGER', active: true },
        },
      },
      select: { id: true, name: true, email: true, phone: true, photo: true, createdAt: true },
      orderBy: { name: 'asc' },
    });
  }

  async create(data: {
    name: string;
    email: string;
    password: string;
    role?: string;
    permissions?: any;
    phone?: string;
    photo?: string;
    mustVerifyEmail?: boolean;
  }, siteId = DEFAULT_SITE_ID) {
    // 1. Extraer nombre y usuario de forma 100% infalible
    const rawInput = (data?.email || (data as any)?.username || (data as any)?.login || data?.name || '').toString().trim().toLowerCase();
    let cleanEmail = rawInput.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '.').replace(/[^a-z0-9._@-]/g, '');
    
    if (!cleanEmail) {
      cleanEmail = `usuario.${Date.now().toString().slice(-4)}`;
    }

    const cleanName = (data?.name || cleanEmail.split('@')[0]).toString().trim() || 'Nuevo Usuario';
    const pwd = (data?.password || '1234').toString().trim();

    if (pwd.length < 4) {
      throw new BadRequestException('La contraseña temporal debe tener al menos 3 caracteres.');
    }

    // 2. Si no tiene arroba, agregar @thevilladog.local para el identificador provisional
    if (!cleanEmail.includes('@')) {
      cleanEmail = `${cleanEmail}@thevilladog.local`;
    }

    const mustVerify = data?.mustVerifyEmail !== undefined ? data.mustVerifyEmail : true;
    const emailVerified = !mustVerify;

    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: cleanEmail, mode: 'insensitive' } },
          { email: { equals: cleanEmail.replace(/@niche\.com$/, ''), mode: 'insensitive' } },
        ]
      },
    });

    if (existing) {
      if (existing.isOrganizationAdmin === true) {
        throw new ConflictException(
          'Esta cuenta pertenece al administrador general y no se puede reactivar desde una sede.',
        );
      }
      if (!existing.active) {
        await this.assertSharedAccountIdentityIsSafe(existing.id, {
          name: cleanName,
          email: cleanEmail,
          password: pwd,
          phone: data.phone,
          photo: data.photo,
          mustVerifyEmail: mustVerify,
          emailVerified,
        });
        // Si el correo pertenece a un usuario inactivo, lo reactivamos con la nueva contraseña y datos
        const hashedPassword = await bcrypt.hash(pwd, 10);
        const reactivated = await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            name: cleanName,
            email: cleanEmail,
            password: hashedPassword,
            role: data.role || 'CASHIER',
            permissions: data.permissions !== undefined ? data.permissions : undefined,
            phone: data.phone,
            photo: data.photo,
            active: true,
            mustVerifyEmail: mustVerify,
            emailVerified,
          },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            permissions: true,
            phone: true,
            photo: true,
            active: true,
            mustVerifyEmail: true,
            emailVerified: true,
            createdAt: true,
          },
        });
        await this.prisma.userSiteMembership.upsert({
          where: { userId_siteId: { userId: existing.id, siteId } },
          create: {
            userId: existing.id,
            siteId,
            role: data.role || 'CASHIER',
            permissions: data.permissions !== undefined ? data.permissions : undefined,
            active: true,
            isDefault: !existing.lastActiveSiteId,
          },
          update: {
            role: data.role || 'CASHIER',
            permissions: data.permissions !== undefined ? data.permissions : undefined,
            active: true,
          },
        });
        this.socketGateway.emitToSite(siteId, 'usersChanged');
        return reactivated;
      }
      throw new ConflictException('Este usuario o correo ya está en uso por otra cuenta en el sistema.');
    }

    const hashedPassword = await bcrypt.hash(pwd, 10);
    const created = await this.prisma.user.create({
      data: {
        name: cleanName,
        email: cleanEmail,
        password: hashedPassword,
        role: data.role || 'CASHIER',
        permissions: data.permissions !== undefined ? data.permissions : undefined,
        phone: data.phone,
        photo: data.photo,
        mustVerifyEmail: mustVerify,
        emailVerified,
        lastActiveSiteId: siteId,
        siteMemberships: {
          create: {
            siteId,
            role: data.role || 'CASHIER',
            permissions: data.permissions !== undefined ? data.permissions : undefined,
            active: true,
            isDefault: true,
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        permissions: true,
        photo: true,
        active: true,
        mustVerifyEmail: true,
        emailVerified: true,
        createdAt: true,
      },
    });
    this.socketGateway.emitToSite(siteId, 'usersChanged');
    return created;
  }

  async update(id: string, data: {
    name?: string;
    email?: string;
    password?: string;
    role?: string;
    permissions?: any;
    phone?: string;
    photo?: string;
    active?: boolean;
    mustVerifyEmail?: boolean;
    emailVerified?: boolean;
  }, siteId = DEFAULT_SITE_ID, allowSharedIdentityMutation = false) {
    const current = await this.findOne(id, siteId, true);
    await this.assertSharedAccountIdentityIsSafe(
      id,
      data as Record<string, unknown>,
      allowSharedIdentityMutation,
    );
    const membershipCount = await this.countMemberships(id);
    // Solo estos campos pueden llegar a `User.update`. Mantener una lista
    // explícita evita que un campo de alcance administrativo enviado desde el
    // navegador (por ejemplo `isOrganizationAdmin`) se convierta en una
    // escalada de privilegios.
    const updateData: any = {};
    for (const key of [
      'name',
      'email',
      'password',
      'phone',
      'photo',
      'mustVerifyEmail',
      'emailVerified',
    ] as const) {
      if ((data as any)[key] !== undefined) updateData[key] = (data as any)[key];
    }
    const membershipData: any = {};
    if (data.role !== undefined) membershipData.role = data.role;
    if (data.permissions !== undefined) membershipData.permissions = data.permissions;
    if (data.active !== undefined) membershipData.active = data.active;
    delete updateData.role;
    delete updateData.permissions;
    delete updateData.active;
    if (data.email) {
      let cleanEmail = data.email.trim().toLowerCase();
      if (!cleanEmail.includes('@')) {
        cleanEmail = `${cleanEmail}@thevilladog.local`;
      }
      const existing = await this.prisma.user.findFirst({
        where: {
          email: { equals: cleanEmail, mode: 'insensitive' },
          id: { not: id },
        },
      });
      if (existing) throw new ConflictException('Este correo electrónico ya está en uso por otra cuenta en el sistema.');
      updateData.email = cleanEmail;
    }
    if (data.password) {
      this.validateStrongPassword(data.password);
      updateData.password = await bcrypt.hash(data.password, 10);
    } else {
      delete updateData.password;
    }
    if (current.role === 'SUPERADMIN') {
      if (data.active !== undefined) updateData.active = data.active;
    } else if (Object.keys(membershipData).length > 0) {
      await this.prisma.userSiteMembership.update({
        where: { userId_siteId: { userId: id, siteId } },
        data: membershipData,
      });
      // Mientras la sede principal conserva compatibilidad con módulos antiguos,
      // su rol base sigue reflejando el rol operativo principal del usuario.
      if (siteId === DEFAULT_SITE_ID && membershipCount <= 1) {
        if (data.role !== undefined) updateData.role = data.role;
        if (data.permissions !== undefined) updateData.permissions = data.permissions;
      }
    }

    await this.prisma.user.update({
      where: { id },
      data: updateData,
    });
    const updated = await this.findOne(id, siteId, true);
    this.socketGateway.emitToSite(siteId, 'usersChanged');
    return updated;
  }

  async remove(id: string, siteId = DEFAULT_SITE_ID) {
    const user = await this.findOne(id, siteId, true);
    if (user.role === 'SUPERADMIN') {
      throw new BadRequestException('El Super Administrador no se puede retirar de una sede');
    }
    if ((user as any).isOrganizationAdmin === true) {
      throw new BadRequestException('El administrador general no se puede retirar desde una sede');
    }

    await this.prisma.userSiteMembership.update({
      where: { userId_siteId: { userId: id, siteId } },
      data: { active: false },
    });
    const remaining = await this.prisma.userSiteMembership.count({
      where: { userId: id, active: true },
    });
    if (remaining === 0) {
      await this.prisma.user.update({ where: { id }, data: { active: false } });
    }
    this.socketGateway.emitToSite(siteId, 'usersChanged');
    return { ...user, active: false, removedFromSite: true };
  }

  async changePassword(
    id: string,
    newPassword: string,
    siteId = DEFAULT_SITE_ID,
    allowSharedIdentityMutation = false,
  ) {
    await this.findOne(id, siteId, true);
    await this.assertSharedAccountIdentityIsSafe(
      id,
      { password: newPassword },
      allowSharedIdentityMutation,
    );
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
    });
    this.socketGateway.emitToSite(siteId, 'usersChanged');
    return { message: 'Contraseña actualizada correctamente' };
  }

  async setOrganizationAdmin(id: string, enabled: boolean) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isOrganizationAdmin: true,
        active: true,
      },
    });
    if (!target) throw new NotFoundException('Usuario no encontrado');
    if (target.role === 'SUPERADMIN' && enabled) {
      throw new BadRequestException(
        'Un Super Admin ya tiene alcance global y no necesita administrador general',
      );
    }
    if (!enabled && target.isOrganizationAdmin) {
      const activeGlobalAdmins = await this.prisma.user.count({
        where: { isOrganizationAdmin: true, active: true },
      });
      if (activeGlobalAdmins <= 1) {
        throw new BadRequestException(
          'Debe existir al menos un administrador general activo',
        );
      }
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: { isOrganizationAdmin: enabled },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isOrganizationAdmin: true,
        active: true,
      },
    });
    if (this.socketGateway?.server) {
      this.socketGateway.server.emit('usersChanged');
    }
    return updated;
  }
}
