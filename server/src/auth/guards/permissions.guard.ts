import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DEFAULT_ROLE_PERMISSIONS } from '../permissions.constant';

export const PERMISSIONS_KEY = 'required_permissions';

/** The user may continue when they have at least one of the listed permissions. */
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('No autenticado');
    if (user.role === 'SUPERADMIN' || user.globalRole === 'SUPERADMIN')
      return true;

    let permissions = user.permissions;
    if (typeof permissions === 'string') {
      try {
        permissions = JSON.parse(permissions);
      } catch {
        permissions = null;
      }
    }

    // Si tiene un array de permisos explícitos en su membresía o usuario, esos rigen exclusivamente.
    // Un ADMIN con permisos restringidos por membresía NO hereda wildcard total automáticamente.
    let effective: string[];
    if (Array.isArray(permissions)) {
      effective = permissions;
    } else {
      const roleDefaults = DEFAULT_ROLE_PERMISSIONS[user.role] || [];
      effective = roleDefaults;
    }

    if (
      effective.includes('*') ||
      required.some((permission) => effective.includes(permission))
    ) {
      return true;
    }

    throw new ForbiddenException(
      'No tienes permiso para realizar esta acción.',
    );
  }
}
