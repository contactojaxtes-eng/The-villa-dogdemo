import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards, Request, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, Permissions } from '../auth/guards/permissions.guard';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { SYSTEM_MODULES_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from '../auth/permissions.constant';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(
    private usersService: UsersService,
    private auditService: AuditService,
    private mailService: MailService,
  ) {}

  @Get()
  @Permissions('users.view')
  @ApiOperation({ summary: 'Listar todos los usuarios' })
  async findAll(@Request() req: any, @Query('role') role?: string, @Query('active') active?: string) {
    const users = await this.usersService.findAll({ role, active: active === 'true' ? true : active === 'false' ? false : undefined });
    if (req.user.role !== 'SUPERADMIN') {
      return users.filter(u => u.role !== 'SUPERADMIN');
    }
    return users;
  }

  @Get('permissions-catalog')
  @Permissions('users.view')
  @ApiOperation({ summary: 'Obtener catálogo de módulos y permisos del sistema' })
  getPermissionsCatalog() {
    return {
      modules: SYSTEM_MODULES_PERMISSIONS,
      defaultRolePermissions: DEFAULT_ROLE_PERMISSIONS,
    };
  }

  @Get('waiters')
  @Permissions('orders.create')
  @ApiOperation({ summary: 'Listar meseros activos' })
  getWaiters() {
    return this.usersService.getWaiters();
  }

  @Get(':id')
  @Permissions('users.view')
  @ApiOperation({ summary: 'Obtener usuario por ID' })
  async findOne(@Param('id') id: string, @Request() req: any) {
    const user = await this.usersService.findOne(id);
    if (user.role === 'SUPERADMIN' && req.user.role !== 'SUPERADMIN') {
      throw new ForbiddenException('No tienes permiso para ver este usuario');
    }
    return user;
  }

  @Post()
  @Permissions('users.manage')
  @ApiOperation({ summary: 'Crear usuario' })
  async create(@Body() body: any, @Request() req: any) {
    if (body.role === 'SUPERADMIN' && req.user.role !== 'SUPERADMIN') {
      throw new ForbiddenException('No se pueden crear más Super Admins');
    }
    body.role = await this.usersService.assertValidRole(body.role);
    const created = await this.usersService.create(body);
    this.auditService.log({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'USER_CREATE',
      targetType: 'User',
      targetId: created.id,
      metadata: { email: created.email, role: created.role },
    });
    return created;
  }

  @Put(':id')
  @Permissions('users.manage')
  @ApiOperation({ summary: 'Actualizar usuario' })
  async update(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    const existing = await this.usersService.findOne(id);
    if (existing.role === 'SUPERADMIN' && req.user.role !== 'SUPERADMIN') {
      throw new ForbiddenException('No tienes permiso para modificar a un Super Admin');
    }
    if (body.role === 'SUPERADMIN' && req.user.role !== 'SUPERADMIN') {
      throw new ForbiddenException('El rol Super Admin no se puede asignar');
    }
    if (existing.role === 'SUPERADMIN') {
      delete body.role;
    } else if (body.role) {
      body.role = await this.usersService.assertValidRole(body.role);
    }
    const updated = await this.usersService.update(id, body);
    this.auditService.log({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'USER_UPDATE',
      targetType: 'User',
      targetId: id,
      metadata: { fields: Object.keys(body) },
    });
    return updated;
  }

  @Patch(':id/password')
  @Permissions('users.manage')
  @ApiOperation({ summary: 'Cambiar contraseña de un usuario' })
  async changePassword(@Param('id') id: string, @Body() body: { password: string }, @Request() req: any) {
    if (!body.password || body.password.length < 3) {
      throw new BadRequestException('La contraseña debe tener al menos 3 caracteres');
    }
    const existing = await this.usersService.findOne(id);
    if (existing.role === 'SUPERADMIN' && req.user.role !== 'SUPERADMIN') {
      throw new ForbiddenException('No tienes permiso para cambiar la contraseña de un Super Admin');
    }
    const result = await this.usersService.changePassword(id, body.password);
    this.auditService.log({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'USER_PASSWORD_RESET',
      targetType: 'User',
      targetId: id,
      metadata: { targetEmail: existing.email },
    });
    if (existing.email) {
      this.mailService.sendPasswordChangedNotice(existing.email, existing.name).catch(() => {});
    }
    return result;
  }

  @Delete(':id')
  @Permissions('users.delete')
  @ApiOperation({ summary: 'Eliminar usuario permanentemente' })
  async remove(@Param('id') id: string, @Request() req: any) {
    if (id === req.user.id) {
      throw new ForbiddenException('No puedes eliminar tu propia cuenta.');
    }
    const existing = await this.usersService.findOne(id);
    if (existing.role === 'SUPERADMIN' && req.user.role !== 'SUPERADMIN') {
      throw new ForbiddenException('No tienes permiso para eliminar a un Super Admin');
    }
    const result = await this.usersService.remove(id);
    this.auditService.log({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: 'USER_DEACTIVATE',
      targetType: 'User',
      targetId: id,
      metadata: { targetEmail: existing.email },
    });
    return result;
  }
}
