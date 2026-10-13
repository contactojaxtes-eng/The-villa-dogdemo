import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/**
 * Permite administrar el catálogo de sedes únicamente a una identidad con
 * alcance global. Un ADMIN operativo puede tener permisos completos dentro de
 * una sede, pero no debe crear ni activar otras sedes.
 */
@Injectable()
export class GlobalSiteManagerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest()?.user;
    if (
      user?.globalRole === 'SUPERADMIN' ||
      user?.globalRole === 'ADMIN_GENERAL'
    ) {
      return true;
    }
    throw new ForbiddenException(
      'Solo un administrador general o Super Admin puede administrar sedes',
    );
  }
}
