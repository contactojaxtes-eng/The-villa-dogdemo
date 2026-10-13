import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SocketGateway } from '../socket/socket.gateway';

@Injectable()
export class RolesService {
  constructor(
    private prisma: PrismaService,
    private socketGateway: SocketGateway,
  ) {}

  async findAll() {
    return this.prisma.customRole.findMany({
      where: { active: true, code: { not: 'SUPERADMIN' } },
      orderBy: [
        { isSystem: 'desc' },
        { createdAt: 'asc' },
      ],
    });
  }

  async findOne(id: string) {
    const role = await this.prisma.customRole.findFirst({
      where: { OR: [{ id }, { code: id }] },
    });
    if (!role) throw new NotFoundException('Rol no encontrado');
    return role;
  }

  async create(data: {
    code: string;
    name: string;
    description?: string;
    color?: string;
    icon?: string;
    permissions: string[];
  }) {
    const cleanCode = (data.code || '').trim().toUpperCase().replace(/\s+/g, '_');
    const cleanName = (data.name || '').trim();

    if (cleanCode === 'SUPERADMIN') {
      throw new ForbiddenException('El rol SUPERADMIN está reservado exclusivamente para los desarrolladores / Super Administrador del sistema.');
    }

    if (!cleanCode || cleanCode.length < 2) {
      throw new BadRequestException('El código del rol debe tener al menos 2 caracteres.');
    }
    if (!cleanName) {
      throw new BadRequestException('El nombre del rol es requerido.');
    }

    const existing = await this.prisma.customRole.findUnique({
      where: { code: cleanCode },
    });
    if (existing) {
      if (!existing.active) {
        // Reactivar
        const reactivated = await this.prisma.customRole.update({
          where: { id: existing.id },
          data: {
            name: cleanName,
            description: data.description || existing.description,
            color: data.color || existing.color,
            icon: data.icon || existing.icon,
            permissions: data.permissions || existing.permissions,
            active: true,
          },
        });
        if (this.socketGateway?.server) {
          this.socketGateway.server.emit('rolesChanged');
        }
        return reactivated;
      }
      throw new ConflictException(`Ya existe un rol con el código "${cleanCode}".`);
    }

    const created = await this.prisma.customRole.create({
      data: {
        code: cleanCode,
        name: cleanName,
        description: data.description || null,
        color: data.color || '#10B981',
        icon: data.icon || 'Shield',
        permissions: data.permissions || [],
        isSystem: false,
        active: true,
      },
    });

    if (this.socketGateway?.server) {
      this.socketGateway.server.emit('rolesChanged');
    }
    return created;
  }

  async update(id: string, data: {
    name?: string;
    description?: string;
    color?: string;
    icon?: string;
    permissions?: string[];
    active?: boolean;
  }) {
    const role = await this.findOne(id);
    if (role.code === 'SUPERADMIN') {
      throw new ForbiddenException('El rol Super Administrador es exclusivo e inmutable.');
    }

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name.trim();
    if (data.description !== undefined) updateData.description = data.description;
    if (data.color !== undefined) updateData.color = data.color;
    if (data.icon !== undefined) updateData.icon = data.icon;
    if (data.permissions !== undefined) updateData.permissions = data.permissions;
    if (data.active !== undefined) updateData.active = data.active;

    const updated = await this.prisma.customRole.update({
      where: { id: role.id },
      data: updateData,
    });

    if (this.socketGateway?.server) {
      this.socketGateway.server.emit('rolesChanged');
    }
    return updated;
  }

  async remove(id: string) {
    const role = await this.findOne(id);
    if (role.code === 'SUPERADMIN') {
      throw new ForbiddenException('El rol Super Administrador es exclusivo e inmutable.');
    }
    if (role.isSystem) {
      throw new BadRequestException('No se pueden eliminar roles protegidos del sistema.');
    }

    // Verificar si hay usuarios con este rol asignado
    const usersWithRole = await this.prisma.user.count({
      where: {
        role: role.code,
        active: true,
        email: { not: { startsWith: 'deleted_' } },
      },
    });

    if (usersWithRole > 0) {
      throw new BadRequestException(
        `No se puede eliminar el rol "${role.name}" porque tiene ${usersWithRole} usuario(s) activo(s) asignado(s). Reasigna los usuarios antes de eliminarlo.`
      );
    }

    // En multisede el rol operativo vive en la membresía. El campo role de
    // User puede no reflejar una sede secundaria, por lo que también debemos
    // impedir la baja cuando exista una membresía activa con este código.
    const memberships = (this.prisma as any).userSiteMembership;
    const membershipsWithRole = memberships?.count
      ? await memberships.count({
          where: {
            role: role.code,
            active: true,
            user: { active: true },
          },
        })
      : 0;
    if (Number(membershipsWithRole) > 0) {
      throw new BadRequestException(
        `No se puede eliminar el rol "${role.name}" porque todavía está asignado en ${membershipsWithRole} membresía(s) activa(s). Reasigna las sedes antes de eliminarlo.`,
      );
    }

    const deactivated = await this.prisma.customRole.update({
      where: { id: role.id },
      data: { active: false },
    });

    if (this.socketGateway?.server) {
      this.socketGateway.server.emit('rolesChanged');
    }
    return deactivated;
  }
}
