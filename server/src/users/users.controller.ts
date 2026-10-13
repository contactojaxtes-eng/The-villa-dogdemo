import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards, Request, ForbiddenException, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, Permissions } from '../auth/guards/permissions.guard';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { SYSTEM_MODULES_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from '../auth/permissions.constant';
import { AllowDraftSiteSetup } from '../auth/decorators/allow-draft-site-setup.decorator';

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

  private assertScopeIsNotBeingChanged(body: any) {
    if (body && Object.prototype.hasOwnProperty.call(body, 'isOrganizationAdmin')) {
      throw new BadRequestException(
        'El alcance de administrador general solo lo puede gestionar el SuperAdmin',
      );
    }
  }

  private assertCanManageGlobalAccount(target: any, actor: any) {
    const isSuperadmin = actor?.globalRole === 'SUPERADMIN' || actor?.role === 'SUPERADMIN';
    if (target?.isOrganizationAdmin === true && !isSuperadmin) {
      throw new ForbiddenException(
        'El administrador general solo puede ser gestionado por el SuperAdmin',
      );
    }
  }

  @Get()
  @AllowDraftSiteSetup()
  @Permissions('users.view')
  @ApiOperation({ summary: 'Listar todos los usuarios' })
  async findAll(@Request() req: any, @Query('role') role?: string, @Query('active') active?: string) {
    const users = await this.usersService.findAll(
      { role, active: active === 'true' ? true : active === 'false' ? false : undefined },
      req.user.siteId,
    );
    const isSuperadmin = req.user.globalRole === 'SUPERADMIN' || req.user.role === 'SUPERADMIN';
    if (!isSuperadmin) {
      return users.filter(
        (user) => user.role !== 'SUPERADMIN' && user.isOrganizationAdmin !== true,
      );
    }
    return users;
  }

  @Get('permissions-catalog')
  @AllowDraftSiteSetup()
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
  getWaiters(@Request() req: any) {
    return this.usersService.getWaiters(req.user.siteId);
  }

  @Patch(':id/organization-admin')
  @AllowDraftSiteSetup()
  @Permissions('users.manage')
  @ApiOperation({ summary: 'Asignar o retirar el alcance de administrador general' })
  async setOrganizationAdmin(
    @Param('id') id: string,
    @Body() body: { enabled: boolean },
    @Request() req: any,
  ) {
    const isSuperadmin =
      req.user?.role === 'SUPERADMIN' || req.user?.globalRole === 'SUPERADMIN';
    if (!isSuperadmin) {
      throw new ForbiddenException(
        'Solo el SuperAdmin puede cambiar el alcance de administrador general',
      );
    }
    if (typeof body?.enabled !== 'boolean') {
      throw new BadRequestException('El campo enabled debe ser booleano');
    }
    const updated = await this.usersService.setOrganizationAdmin(
      id,
      body.enabled,
    );
    this.auditService.log({
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.role,
      action: body.enabled
        ? 'USER_ORGANIZATION_ADMIN_ENABLE'
        : 'USER_ORGANIZATION_ADMIN_DISABLE',
      targetType: 'User',
      targetId: id,
      metadata: { enabled: body.enabled },
    });
    return updated;
  }

  @Get(':id')
  @Permissions('users.view')
  @ApiOperation({ summary: 'Obtener usuario por ID' })
  async findOne(@Param('id') id: string, @Request() req: any) {
    const user = await this.usersService.findOne(id, req.user.siteId, req.user.role === 'SUPERADMIN');
    this.assertCanManageGlobalAccount(user, req.user);
    if (user.role === 'SUPERADMIN' && req.user.role !== 'SUPERADMIN') {
      throw new ForbiddenException('No tienes permiso para ver este usuario');
    }
    return user;
  }

  @Post()
  @AllowDraftSiteSetup()
  @Permissions('users.manage')
  @ApiOperation({ summary: 'Crear usuario' })
  async create(@Body() body: any, @Request() req: any) {
    this.assertScopeIsNotBeingChanged(body);
    body.role = await this.usersService.assertValidRole(body.role);
    if (req.user?.preparationMode === true && body.role === 'SUPERADMIN') {
      throw new ForbiddenException(
        'No se pueden crear Super Administradores desde una sede en preparación',
      );
    }
    if (body.role === 'SUPERADMIN' && req.user.role !== 'SUPERADMIN') {
      throw new ForbiddenException('No se pueden crear más Super Admins');
    }
    const created = await this.usersService.create(body, req.user.siteId);
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
    this.assertScopeIsNotBeingChanged(body);
    const existing = await this.usersService.findOne(id, req.user.siteId, req.user.role === 'SUPERADMIN');
    this.assertCanManageGlobalAccount(existing, req.user);
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
    const canManageSharedIdentity =
      req.user?.role === 'SUPERADMIN' ||
      req.user?.globalRole === 'SUPERADMIN' ||
      req.user?.globalRole === 'ADMIN_GENERAL';
    const updated = canManageSharedIdentity
      ? await this.usersService.update(id, body, req.user.siteId, true)
      : await this.usersService.update(id, body, req.user.siteId);
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
    const existing = await this.usersService.findOne(id, req.user.siteId, req.user.role === 'SUPERADMIN');
    this.assertCanManageGlobalAccount(existing, req.user);
    if (existing.role === 'SUPERADMIN' && req.user.role !== 'SUPERADMIN') {
      throw new ForbiddenException('No tienes permiso para cambiar la contraseña de un Super Admin');
    }
    const canManageSharedIdentity =
      req.user?.role === 'SUPERADMIN' ||
      req.user?.globalRole === 'SUPERADMIN' ||
      req.user?.globalRole === 'ADMIN_GENERAL';
    const result = canManageSharedIdentity
      ? await this.usersService.changePassword(id, body.password, req.user.siteId, true)
      : await this.usersService.changePassword(id, body.password, req.user.siteId);
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
    const existing = await this.usersService.findOne(id, req.user.siteId, req.user.role === 'SUPERADMIN');
    this.assertCanManageGlobalAccount(existing, req.user);
    if (existing.role === 'SUPERADMIN' && req.user.role !== 'SUPERADMIN') {
      throw new ForbiddenException('No tienes permiso para eliminar a un Super Admin');
    }
    const result = await this.usersService.remove(id, req.user.siteId);
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
