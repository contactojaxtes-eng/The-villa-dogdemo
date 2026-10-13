import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { SiteAccessService } from './site-access.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { GlobalSiteManagerGuard } from './guards/global-site-manager.guard';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'change-me-the-villa-dog-dev-secret',
      signOptions: { expiresIn: (process.env.JWT_EXPIRATION || '7d') as any },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    SiteAccessService,
    JwtAuthGuard,
    GlobalSiteManagerGuard,
  ],
  exports: [
    AuthService,
    SiteAccessService,
    JwtAuthGuard,
    GlobalSiteManagerGuard,
    JwtModule,
    PassportModule,
  ],
})
export class AuthModule {}
