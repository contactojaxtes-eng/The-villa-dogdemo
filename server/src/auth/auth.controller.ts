import {
  Controller,
  Post,
  Body,
  Get,
  Patch,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangeOwnPasswordDto } from './dto/change-own-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AllowDraftSiteSetup } from './decorators/allow-draft-site-setup.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Iniciar sesión' })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  // Public registration is disabled for security reasons. Users should be created through the admin panel.
  // @Post('register')
  // @ApiOperation({ summary: 'Registrar nuevo usuario' })
  // register(@Body() registerDto: RegisterDto) {
  //   return this.authService.register(registerDto);
  // }

  @Post('refresh')
  @ApiOperation({ summary: 'Refrescar token' })
  refreshToken(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshToken(refreshToken);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @AllowDraftSiteSetup()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener perfil del usuario autenticado' })
  getProfile(@Request() req: any) {
    return this.authService.getProfile(req.user.id, req.user.siteId);
  }

  @Get('sites')
  @UseGuards(JwtAuthGuard)
  @AllowDraftSiteSetup()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Listar sedes disponibles para el usuario autenticado',
  })
  listSites(@Request() req: any) {
    return this.authService.listSites(req.user.id, req.user.siteId);
  }

  @Post('switch-site')
  @UseGuards(JwtAuthGuard)
  @AllowDraftSiteSetup()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cambiar la sede activa y renovar la sesión' })
  switchSite(@Request() req: any, @Body('siteId') siteId: string) {
    return this.authService.switchSite(req.user.id, siteId);
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Actualizar mis datos de perfil (nombre, teléfono, foto)',
  })
  updateProfile(@Request() req: any, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(req.user.id, dto);
  }

  @Patch('profile/password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Paso 1: Solicitar cambio de contraseña (envía OTP al correo registrado)',
  })
  changeOwnPassword(@Request() req: any, @Body() dto: ChangeOwnPasswordDto) {
    return this.authService.requestPasswordChange(
      req.user.id,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Post('profile/confirm-password-change')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Paso 2: Confirmar cambio de contraseña con código OTP',
  })
  confirmPasswordChange(
    @Request() req: any,
    @Body()
    body: { currentPassword: string; newPassword: string; otpCode: string },
  ) {
    return this.authService.confirmPasswordChange(
      req.user.id,
      body.currentPassword,
      body.newPassword,
      body.otpCode,
    );
  }

  @Post('profile/request-email-change')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Solicitar cambio de correo (envía OTP al correo actual o nuevo)',
  })
  requestEmailChange(@Request() req: any, @Body('newEmail') newEmail: string) {
    return this.authService.requestEmailChange(req.user.id, newEmail);
  }

  @Post('profile/verify-current-email-step1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Paso 1: Validar código de desvinculación enviado al correo actual',
  })
  verifyCurrentEmailStep1(
    @Request() req: any,
    @Body() body: { newEmail: string; otpCode: string },
  ) {
    return this.authService.verifyCurrentEmailStep1(
      req.user.id,
      body.newEmail,
      body.otpCode,
    );
  }

  @Post('profile/confirm-new-email-step2')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Paso 2: Confirmar código de activación enviado al nuevo correo',
  })
  confirmNewEmailStep2(
    @Request() req: any,
    @Body() body: { newEmail: string; otpCode: string },
  ) {
    return this.authService.confirmNewEmailStep2(
      req.user.id,
      body.newEmail,
      body.otpCode,
    );
  }

  @Post('forgot-password')
  @ApiOperation({
    summary: 'Solicitar enlace de recuperación de contraseña por correo',
  })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @ApiOperation({
    summary: 'Restablecer contraseña con el token enviado por correo',
  })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @Post('unlock-account')
  @ApiOperation({
    summary:
      'Desbloquear cuenta bloqueada por intentos fallidos con código OTP',
  })
  unlockAccount(@Body() body: { email: string; otpCode: string }) {
    return this.authService.unlockAccount(body.email, body.otpCode);
  }

  @Post('action-auth/request-otp')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Solicitar código OTP al correo para autorizar una acción administrativa crítica',
  })
  requestActionOtp(@Request() req: any, @Body() body: { actionName?: string }) {
    return this.authService.requestActionOtp(
      req.user.id,
      body?.actionName || 'Confirmar Acción Administrativa',
    );
  }

  @Post('action-auth/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Verificar autorización por contraseña o código OTP (Estilo Meta)',
  })
  verifyActionAuth(
    @Request() req: any,
    @Body()
    body: { method: 'PASSWORD' | 'OTP'; password?: string; otpCode?: string },
  ) {
    return this.authService.verifyActionAuth(req.user.id, body);
  }

  @Post('setup-email/request-otp')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Solicitar código de verificación para configurar correo en primer acceso',
  })
  requestSetupEmailOtp(
    @Request() req: any,
    @Body() body: { targetEmail: string },
  ) {
    return this.authService.requestSetupEmailOtp(req.user.id, body.targetEmail);
  }

  @Post('setup-email/verify-otp')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Verificar código OTP y activar correo en primer acceso',
  })
  verifySetupEmailOtp(
    @Request() req: any,
    @Body()
    body: { targetEmail: string; otpCode: string; newPassword?: string },
  ) {
    return this.authService.verifySetupEmailOtp(
      req.user.id,
      body.targetEmail,
      body.otpCode,
      body.newPassword,
    );
  }
}
