import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ALLOW_DRAFT_SITE_SETUP_KEY } from '../decorators/allow-draft-site-setup.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  handleRequest<TUser = any>(
    err: any,
    user: any,
    info: any,
    context: ExecutionContext,
    status?: any,
  ): TUser {
    const authenticatedUser = super.handleRequest<TUser>(
      err,
      user,
      info,
      context,
      status,
    ) as any;
    const isPreparationMode =
      authenticatedUser?.preparationMode === true ||
      authenticatedUser?.siteActive === false ||
      authenticatedUser?.site?.active === false ||
      authenticatedUser?.site?.preparationMode === true;

    if (!isPreparationMode) return authenticatedUser;

    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_DRAFT_SITE_SETUP_KEY,
      [context.getHandler(), context.getClass()],
    );
    const isGlobalSiteManager =
      authenticatedUser?.globalRole === 'SUPERADMIN' ||
      authenticatedUser?.globalRole === 'ADMIN_GENERAL';

    if (!allowed || !isGlobalSiteManager) {
      throw new ForbiddenException(
        'La sede está en modo preparación y esta operación no está disponible',
      );
    }

    return authenticatedUser;
  }
}
