import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SocketGateway } from '../socket/socket.gateway';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private socketGateway: SocketGateway,
  ) {}

  private validateStrongPassword(password: string) {
    if (!password || password.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres.');
    }
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

  async findAll(params: { role?: string; active?: boolean }) {
    const where: any = {
      email: { not: { startsWith: 'deleted_' } },
    };
    if (params.role) where.role = params.role;
    if (params.active !== undefined) where.active = params.active;
    return this.prisma.user.findMany({
      where,
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
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
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
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  async getWaiters() {
    return this.prisma.user.findMany({
      where: { role: 'DELIVERY_MANAGER', active: true },
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
  }) {
    // 1. Extraer nombre y usuario de forma 100% infalible
    const rawInput = (data?.email || (data as any)?.username || (data as any)?.login || data?.name || '').toString().trim().toLowerCase();
    let cleanEmail = rawInput.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '.').replace(/[^a-z0-9._@-]/g, '');
    
    if (!cleanEmail) {
      cleanEmail = `usuario.${Date.now().toString().slice(-4)}`;
    }

    const cleanName = (data?.name || cleanEmail.split('@')[0]).toString().trim() || 'Nuevo Usuario';
    const pwd = (data?.password || '1234').toString().trim();

    if (pwd.length < 3) {
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
      if (!existing.active) {
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
        this.socketGateway.server.emit('usersChanged');
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
    this.socketGateway.server.emit('usersChanged');
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
  }) {
    await this.findOne(id);
    const updateData: any = { ...data };
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
    const updated = await this.prisma.user.update({
      where: { id },
      data: updateData,
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
    this.socketGateway.server.emit('usersChanged');
    return updated;
  }

  async remove(id: string) {
    const user = await this.findOne(id);

    // Desvincular todas las relaciones opcionales del usuario
    try {
      await this.prisma.cashRegister.updateMany({
        where: { managerId: id },
        data: { managerId: null },
      });
      await this.prisma.whatsAppSession.updateMany({
        where: { assignedToId: id },
        data: { assignedToId: null },
      });
      await this.prisma.passwordResetToken.deleteMany({ where: { userId: id } });
      await this.prisma.notification.deleteMany({ where: { userId: id } });
      await this.prisma.waiterMetric.deleteMany({ where: { userId: id } });
      await this.prisma.waiterBadge.deleteMany({ where: { userId: id } });
      await this.prisma.shift.deleteMany({ where: { userId: id } });

      const deleted = await this.prisma.user.delete({ where: { id } });
      this.socketGateway.server.emit('usersChanged');
      return deleted;
    } catch (error) {
      // Si la BD restringe el borrado físico por histórico estricto, liberamos el email y marcamos inactivo
      const freedEmail = `deleted_${Date.now()}_${user.email}`;
      const deactivated = await this.prisma.user.update({
        where: { id },
        data: {
          email: freedEmail,
          active: false,
        },
        select: { id: true, name: true, email: true, role: true, phone: true, photo: true, active: true, createdAt: true },
      });
      this.socketGateway.server.emit('usersChanged');
      return deactivated;
    }
  }

  async changePassword(id: string, newPassword: string) {
    await this.findOne(id);
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
    });
    this.socketGateway.server.emit('usersChanged');
    return { message: 'Contraseña actualizada correctamente' };
  }
}
