import { Injectable, UnauthorizedException, ConflictException, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private mailService: MailService,
    private auditService: AuditService,
  ) {}

  async login(loginDto: LoginDto) {
    const rawEmail = loginDto.email ? loginDto.email.trim().toLowerCase() : '';
    let user = await this.prisma.user.findUnique({
      where: { email: rawEmail },
    });

    if (!user && !rawEmail.includes('@')) {
      user = await this.prisma.user.findUnique({
        where: { email: `${rawEmail}@thevilladog.local` },
      });
    }

    if (!user || !user.active) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // 1. Si el bloqueo anterior ya expiró, limpiar contador para dar los 3 intentos completos
    if (user.lockoutUntil && new Date(user.lockoutUntil) <= new Date()) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockoutUntil: null },
      });
    }

    // 2. Verificar si la cuenta está actualmente bloqueada
    if (user.lockoutUntil && new Date(user.lockoutUntil) > new Date()) {
      const remainingSeconds = Math.ceil((new Date(user.lockoutUntil).getTime() - Date.now()) / 1000);
      const remainingMinutes = Math.ceil(remainingSeconds / 60);
      throw new UnauthorizedException({
        error: 'ACCOUNT_LOCKED',
        message: `🚨 Cuenta bloqueada preventivamente por 3 intentos fallidos. Revisa tu correo (${user.email}) para entrar al instante con el código de seguridad o espera ${remainingMinutes} minuto(s).`,
        email: user.email,
        lockoutUntil: user.lockoutUntil,
      });
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      const currentFails = user.failedLoginAttempts || 0;
      const failedAttempts = currentFails + 1;

      if (failedAttempts >= 3) {
        // Bloqueo progresivo: 15 minutos en el 1er strike, 30 min en el siguiente, 60 min máximo
        const lockoutMinutes = currentFails >= 5 ? 60 : currentFails >= 3 ? 30 : 15;
        const lockoutUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000);
        const unlockOtp = Math.floor(100000 + Math.random() * 900000).toString();
        const tokenHash = crypto.createHash('sha256').update(`UNLOCK_ACCOUNT:${unlockOtp}`).digest('hex');

        // Invalidar tokens previos de desbloqueo
        await this.prisma.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        });

        await this.prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash,
            expiresAt: lockoutUntil,
          },
        });

        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: failedAttempts,
            lockoutUntil,
          },
        });

        // Enviar alerta a Gmail con código directo
        if (user.email && user.email.includes('@')) {
          await this.mailService.sendBruteForceLockoutAlert(user.email, user.name, user.role, unlockOtp).catch(() => {});
        }

        // Registrar en auditoría
        await this.auditService.log({
          actorName: user.name,
          actorRole: user.role,
          action: 'BRUTE_FORCE_LOCKOUT',
          targetType: 'User',
          targetId: user.id,
          metadata: { email: user.email, attempts: failedAttempts, lockoutMinutes },
        }).catch(() => {});

        throw new UnauthorizedException({
          error: 'ACCOUNT_LOCKED',
          message: `🚨 Has superado los 3 intentos permitidos. Tu cuenta ha sido bloqueada preventivamente por ${lockoutMinutes} minutos. Enviamos un código de seguridad a tu correo (${user.email}) para entrar al instante.`,
          email: user.email,
          lockoutUntil,
        });
      } else {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedLoginAttempts: failedAttempts },
        });

        const remaining = 3 - failedAttempts;
        throw new UnauthorizedException({
          error: 'INVALID_CREDENTIALS',
          message: `Contraseña incorrecta. Intento ${failedAttempts} de 3. Al 3er intento fallido tu cuenta se bloqueará por seguridad.`,
          failedAttempts,
          remainingAttempts: remaining,
        });
      }
    }

    // Si la contraseña es válida: reiniciar contador de fallos a 0
    if (user.failedLoginAttempts > 0 || user.lockoutUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockoutUntil: null },
      });
    }

    // 3. Vigencia de 48 Horas estrictamente para cuentas provisionales pendientes de verificación inicial
    if (user.mustVerifyEmail === true) {
      const creationDate = new Date(user.updatedAt || user.createdAt).getTime();
      const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
      if (Date.now() - creationDate > FORTY_EIGHT_HOURS_MS) {
        throw new UnauthorizedException(
          '⏳ Tu clave provisional ha caducado porque han pasado más de 48 horas desde su creación. Por favor solicita al Administrador que te asigne una nueva clave provisional para ingresar.'
        );
      }
    }

    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = (this.jwtService.sign as any)(payload, { expiresIn: process.env.JWT_EXPIRATION || '7d' });
    const refreshToken = (this.jwtService.sign as any)(payload, { expiresIn: process.env.JWT_REFRESH_EXPIRATION || '30d' });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
        phone: user.phone,
        photo: user.photo,
        mustVerifyEmail: user.mustVerifyEmail,
        emailVerified: user.emailVerified,
      },
    };
  }

  async unlockAccount(email: string, otpCode: string) {
    const cleanEmail = email ? email.trim().toLowerCase() : '';
    const cleanOtp = otpCode ? otpCode.trim() : '';

    if (!cleanEmail || !cleanOtp) {
      throw new BadRequestException('Debes ingresar el correo y el código de seguridad de 6 dígitos');
    }

    let user = await this.prisma.user.findUnique({
      where: { email: cleanEmail },
    });

    if (!user && !cleanEmail.includes('@')) {
      user = await this.prisma.user.findUnique({
        where: { email: `${cleanEmail}@thevilladog.local` },
      });
    }

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const tokenHash = crypto.createHash('sha256').update(`UNLOCK_ACCOUNT:${cleanOtp}`).digest('hex');
    const token = await this.prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        tokenHash,
        usedAt: null,
        expiresAt: { gte: new Date() },
      },
    });

    if (!token) {
      throw new BadRequestException('El código de desbloqueo es incorrecto o ya expiró');
    }

    // Marcar token como usado y resetear bloqueo
    await this.prisma.passwordResetToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    });

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockoutUntil: null,
      },
    });

    // Generar sesión JWT directamente para ingresar al instante sin necesidad de contraseña
    const payload = { sub: updatedUser.id, email: updatedUser.email, role: updatedUser.role };
    const accessToken = (this.jwtService.sign as any)(payload, { expiresIn: process.env.JWT_EXPIRATION || '7d' });
    const refreshToken = (this.jwtService.sign as any)(payload, { expiresIn: process.env.JWT_REFRESH_EXPIRATION || '30d' });

    return {
      success: true,
      message: '¡Código verificado con éxito! Ingresando al sistema...',
      accessToken,
      refreshToken,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        permissions: updatedUser.permissions,
        phone: updatedUser.phone,
        photo: updatedUser.photo,
      },
    };
  }

  async register(registerDto: RegisterDto) {
    const cleanEmail = registerDto.email ? registerDto.email.trim().toLowerCase() : '';
    if (!cleanEmail) throw new BadRequestException('El correo electrónico es requerido');

    const existingUser = await this.prisma.user.findFirst({
      where: { email: { equals: cleanEmail, mode: 'insensitive' } },
    });

    if (existingUser) {
      throw new ConflictException('Este correo electrónico ya está registrado por otra cuenta en el sistema.');
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        name: registerDto.name,
        email: cleanEmail,
        password: hashedPassword,
        phone: registerDto.phone,
        role: registerDto.role || 'CASHIER',
      },
    });

    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = (this.jwtService.sign as any)(payload, { expiresIn: process.env.JWT_EXPIRATION || '7d' });
    const refreshToken = (this.jwtService.sign as any)(payload, { expiresIn: process.env.JWT_REFRESH_EXPIRATION || '30d' });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        photo: user.photo,
      },
    };
  }

  async refreshToken(token: string) {
    try {
      const payload = this.jwtService.verify(token);
      const newPayload = { sub: payload.sub, email: payload.email, role: payload.role };
      const accessToken = (this.jwtService.sign as any)(newPayload, { expiresIn: process.env.JWT_EXPIRATION || '7d' });
      const refreshToken = (this.jwtService.sign as any)(newPayload, { expiresIn: process.env.JWT_REFRESH_EXPIRATION || '30d' });
      return { accessToken, refreshToken };
    } catch {
      throw new UnauthorizedException('Token de refresco inválido');
    }
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
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
    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    try {
      // El correo electrónico NUNCA se cambia directamente aquí;
      // Exige estrictamente el flujo de verificación OTP (requestEmailChange / confirmEmailChange)
      return await this.prisma.user.update({
        where: { id: userId },
        data: { name: dto.name, phone: dto.phone, photo: dto.photo },
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
    } catch (e: any) {
      throw e;
    }
  }

  validateStrongPassword(password: string) {
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

  async requestPasswordChange(userId: string, currentPassword: string, newPassword: string) {
    if (!currentPassword || !newPassword) {
      throw new BadRequestException('Debes ingresar la contraseña actual y la nueva contraseña');
    }

    this.validateStrongPassword(newPassword);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      throw new UnauthorizedException('La contraseña actual es incorrecta');
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      throw new BadRequestException('La nueva contraseña no puede ser igual a la actual');
    }

    const hasRealEmail = !!(user.email && user.email.includes('@') && !user.email.toLowerCase().endsWith('@thevilladog.local'));

    if (!hasRealEmail) {
      // Si la cuenta aún tiene correo provisional (@thevilladog.local o sin correo),
      // actualiza directamente validando su contraseña actual
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      await this.prisma.user.update({ where: { id: userId }, data: { password: hashedPassword } });

      return {
        success: true,
        requiresOtp: false,
        message: '¡Contraseña actualizada exitosamente!',
      };
    }

    // Generar OTP de 6 dígitos con vigencia de 5 minutos
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const tokenHash = crypto.createHash('sha256').update(`CHANGE_PASSWORD:${userId}:${otpCode}`).digest('hex');

    // Invalidar tokens previos de cambio de clave
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutos
      },
    });

    // Enviar código por correo
    await this.mailService.sendChangePasswordOtp(user.email, user.name, otpCode);

    return {
      success: true,
      requiresOtp: true,
      sentTo: user.email,
      message: `Enviamos un código de seguridad de 6 dígitos a tu correo (${user.email}) para confirmar el cambio.`,
    };
  }

  async confirmPasswordChange(userId: string, currentPassword: string, newPassword: string, otpCode: string) {
    const cleanOtp = otpCode ? otpCode.trim() : '';
    if (!cleanOtp || cleanOtp.length !== 6) {
      throw new BadRequestException('Debes ingresar el código de confirmación de 6 dígitos');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      throw new UnauthorizedException('La contraseña actual es incorrecta');
    }

    const tokenHash = crypto.createHash('sha256').update(`CHANGE_PASSWORD:${userId}:${cleanOtp}`).digest('hex');
    const token = await this.prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        tokenHash,
        usedAt: null,
        expiresAt: { gte: new Date() },
      },
    });

    if (!token) {
      throw new BadRequestException('El código de confirmación es incorrecto o ya expiró (Vence en 5 minutos)');
    }

    // Marcar token como usado
    await this.prisma.passwordResetToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { password: hashedPassword } });

    // Notificar por correo
    if (user.email && user.email.includes('@')) {
      await this.mailService.sendPasswordChangedNotice(user.email, user.name).catch(() => {});
    }

    return { success: true, message: '¡Contraseña actualizada correctamente!' };
  }

  async changeOwnPassword(userId: string, currentPassword: string, newPassword: string) {
    return this.requestPasswordChange(userId, currentPassword, newPassword);
  }

  async forgotPassword(email: string) {
    const cleanInput = email ? email.trim().toLowerCase() : '';
    if (!cleanInput) {
      throw new BadRequestException('Debes ingresar tu usuario o correo electrónico');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: cleanInput },
          { email: { equals: cleanInput, mode: 'insensitive' } },
          { email: `${cleanInput}@thevilladog.local` },
        ]
      }
    });

    if (!user || !user.active) {
      throw new NotFoundException('No encontramos ninguna cuenta con ese usuario o correo electrónico.');
    }

    const isRealEmail = user.email && user.email.includes('@') && !user.email.toLowerCase().endsWith('@thevilladog.local');
    if (!isRealEmail) {
      throw new BadRequestException('Esta cuenta aún no tiene un correo personal vinculado. Por favor contacta al Super Administrador para restablecer tu acceso o vincular tu correo.');
    }

    // Invalidar tokens previos no usados
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    // Generar código OTP de 6 dígitos
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash('sha256').update(otpCode).digest('hex');
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    // Guardar tokens tanto para el enlace como para el código numérico de 6 dígitos
    await this.prisma.passwordResetToken.createMany({
      data: [
        { userId: user.id, tokenHash: otpHash, expiresAt },
        { userId: user.id, tokenHash: tokenHash, expiresAt },
      ],
    });

    const resetLink = `${process.env.CLIENT_URL || 'http://localhost:5173'}/reset-password?token=${rawToken}`;
    await this.mailService.sendPasswordResetEmail(user.email, user.name, resetLink, otpCode);

    return { 
      message: `Enlace y código de recuperación enviados a ${user.email}`,
      email: user.email,
      otpSent: true 
    };
  }

  async resetPassword(tokenOrCode: string, newPassword: string) {
    const cleanInput = tokenOrCode ? tokenOrCode.trim() : '';
    if (!cleanInput) {
      throw new BadRequestException('El código o token de recuperación es requerido');
    }

    if (newPassword.length < 6) {
      throw new BadRequestException('La nueva contraseña debe tener al menos 6 caracteres');
    }

    // Buscar token por hash
    const inputHash = crypto.createHash('sha256').update(cleanInput).digest('hex');
    const resetToken = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: inputHash } });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      throw new BadRequestException('El código de 6 dígitos o enlace de recuperación es inválido o ya expiró.');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: resetToken.userId }, data: { password: hashedPassword } }),
      // Invalidar todos los tokens activos de este usuario
      this.prisma.passwordResetToken.updateMany({
        where: { userId: resetToken.userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    return { message: 'Contraseña restablecida correctamente. Ya puedes iniciar sesión con tu nueva contraseña.' };
  }

  async impersonate(superadmin: { id: string; name: string; role: string }, targetUserId: string) {
    if (superadmin.role !== 'SUPERADMIN') {
      throw new ForbiddenException('Solo un Super Admin puede iniciar una sesión de soporte');
    }

    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target || !target.active) {
      throw new NotFoundException('Usuario no encontrado o inactivo');
    }
    if (target.role === 'SUPERADMIN') {
      throw new ForbiddenException('No se puede iniciar sesión de soporte sobre otro Super Admin');
    }

    const payload = { sub: target.id, email: target.email, role: target.role, impersonatedBy: superadmin.id };
    const accessToken = (this.jwtService.sign as any)(payload, { expiresIn: '1h' });

    this.auditService.log({
      actorId: superadmin.id,
      actorName: superadmin.name,
      actorRole: superadmin.role,
      action: 'IMPERSONATE_START',
      targetType: 'User',
      targetId: target.id,
      metadata: { targetEmail: target.email, targetRole: target.role },
    });

    return {
      accessToken,
      user: {
        id: target.id,
        name: target.name,
        email: target.email,
        role: target.role,
        permissions: target.permissions,
        phone: target.phone,
        photo: target.photo,
      },
    };
  }

  async requestEmailChange(userId: string, newEmail: string) {
    const cleanNewEmail = newEmail ? newEmail.trim().toLowerCase() : '';
    if (!cleanNewEmail || !cleanNewEmail.includes('@')) {
      throw new BadRequestException('Debes ingresar un correo electrónico válido');
    }

    // Verificar que el correo no esté ocupado por otra persona
    const existing = await this.prisma.user.findFirst({
      where: {
        email: cleanNewEmail,
        id: { not: userId },
      },
    });

    if (existing) {
      throw new BadRequestException('Este correo electrónico ya está registrado por otra cuenta');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    // Si ya es exactamente el mismo correo, no hacer nada
    if (user.email && user.email.toLowerCase() === cleanNewEmail) {
      return { requiresOtp: false, message: 'El correo no ha cambiado', email: user.email };
    }

    // Invalidar tokens previos
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const hasCurrentRealEmail = !!(user.email && user.email.includes('@') && !user.email.toLowerCase().endsWith('@thevilladog.local'));

    if (hasCurrentRealEmail) {
      // Paso 1: Enviar código al correo actual para autorizar la desvinculación
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const tokenHash = crypto.createHash('sha256').update(`EMAIL_STEP1_AUTH:${otpCode}:${cleanNewEmail}`).digest('hex');
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutos

      await this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });

      await this.mailService.sendAuthorizeCurrentEmailOtp(user.email, user.name, cleanNewEmail, otpCode);

      return {
        step: 1,
        requiresOtp: true,
        sentTo: user.email,
        currentEmail: user.email,
        newEmail: cleanNewEmail,
        message: `Paso 1 de 2: Se envió un código de autorización de 6 dígitos a tu correo ACTUAL (${user.email}). Válido por 5 minutos.`,
      };
    } else {
      // Vinculación inicial: Enviar código directamente al nuevo correo para verificarlo
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const tokenHash = crypto.createHash('sha256').update(`EMAIL_STEP2_VERIFY:${otpCode}:${cleanNewEmail}`).digest('hex');
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutos

      await this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });

      await this.mailService.sendVerifyNewEmailOtp(cleanNewEmail, user.name, otpCode);

      return {
        step: 2,
        requiresOtp: true,
        sentTo: cleanNewEmail,
        newEmail: cleanNewEmail,
        message: `Se envió un código de 6 dígitos a tu correo (${cleanNewEmail}). Ingrésalo para verificarlo y activarlo. Válido por 5 minutos.`,
      };
    }
  }

  async verifyCurrentEmailStep1(userId: string, newEmail: string, otpCode: string) {
    const cleanNewEmail = newEmail ? newEmail.trim().toLowerCase() : '';
    const cleanOtp = otpCode ? otpCode.trim() : '';

    if (!cleanNewEmail || !cleanOtp) {
      throw new BadRequestException('El correo y el código de seguridad son obligatorios');
    }

    const tokenHash = crypto.createHash('sha256').update(`EMAIL_STEP1_AUTH:${cleanOtp}:${cleanNewEmail}`).digest('hex');
    const token = await this.prisma.passwordResetToken.findFirst({
      where: {
        userId,
        tokenHash,
        usedAt: null,
        expiresAt: { gte: new Date() },
      },
    });

    if (!token) {
      throw new BadRequestException('El código de autorización del correo actual es incorrecto o ya expiró (Vence en 5 minutos)');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    // Marcar token del Paso 1 como usado
    await this.prisma.passwordResetToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    });

    // Paso 2: Generar y enviar código de activación al NUEVO correo
    const otpCode2 = Math.floor(100000 + Math.random() * 900000).toString();
    const tokenHash2 = crypto.createHash('sha256').update(`EMAIL_STEP2_VERIFY:${otpCode2}:${cleanNewEmail}`).digest('hex');
    const expiresAt2 = new Date(Date.now() + 5 * 60 * 1000); // 5 minutos

    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: tokenHash2, expiresAt: expiresAt2 },
    });

    await this.mailService.sendVerifyNewEmailOtp(cleanNewEmail, user.name, otpCode2);

    return {
      success: true,
      step: 2,
      sentTo: cleanNewEmail,
      newEmail: cleanNewEmail,
      message: `Paso 1 completado. Ahora enviamos un código de 6 dígitos a tu NUEVO correo (${cleanNewEmail}) para activarlo.`,
    };
  }

  async confirmNewEmailStep2(userId: string, newEmail: string, otpCode: string) {
    const cleanNewEmail = newEmail ? newEmail.trim().toLowerCase() : '';
    const cleanOtp = otpCode ? otpCode.trim() : '';

    if (!cleanNewEmail || !cleanOtp) {
      throw new BadRequestException('El nuevo correo y el código de seguridad son obligatorios');
    }

    const tokenHash = crypto.createHash('sha256').update(`EMAIL_STEP2_VERIFY:${cleanOtp}:${cleanNewEmail}`).digest('hex');
    const token = await this.prisma.passwordResetToken.findFirst({
      where: {
        userId,
        tokenHash,
        usedAt: null,
        expiresAt: { gte: new Date() },
      },
    });

    if (!token) {
      throw new BadRequestException('El código del nuevo correo es incorrecto o ya expiró (Vence en 5 minutos)');
    }

    // Asegurar que el nuevo correo no haya sido tomado por otra cuenta mientras se verificaba
    const existingOther = await this.prisma.user.findFirst({
      where: {
        email: { equals: cleanNewEmail, mode: 'insensitive' },
        id: { not: userId },
      },
    });

    if (existingOther) {
      throw new ConflictException('Este correo electrónico ya está en uso por otra cuenta en el sistema.');
    }

    // Marcar token como usado y actualizar correo oficialmente en la base de datos
    const [updatedUser] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { email: cleanNewEmail },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return {
      success: true,
      message: '¡Nuevo correo verificado y activado exitosamente! El correo anterior fue desvinculado.',
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
      },
    };
  }

  // --- SEGURIDAD DUAL PARA ACCIONES CRÍTICAS (Estilo Meta) ---

  async requestActionOtp(userId: string, actionName: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const cleanEmail = (user.email || '').trim().toLowerCase();
    const hasValidExternalEmail = cleanEmail.includes('@') && !cleanEmail.endsWith('@thevilladog.local');

    let recipientEmail = cleanEmail;
    let isMasterFallback = false;

    // Si el usuario actual no tiene correo verificado aún (ej: la cuenta 'admin'):
    // Enviamos el código OTP directamente al SuperAdmin (softwaresjja@gmail.com)
    if (!hasValidExternalEmail) {
      const superAdmin = await this.prisma.user.findFirst({
        where: { role: 'SUPERADMIN', active: true, email: { contains: '@' } },
      });
      if (superAdmin && superAdmin.email && !superAdmin.email.endsWith('@thevilladog.local')) {
        recipientEmail = superAdmin.email.trim().toLowerCase();
        isMasterFallback = true;
      } else {
        throw new BadRequestException('No hay un correo de seguridad configurado para recibir códigos. Por favor autoriza con tu contraseña.');
      }
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const tokenHash = crypto.createHash('sha256').update(`ACTION_AUTH:${userId}:${otp}`).digest('hex');

    // Invalidar tokens previos de action auth para este usuario
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutos
      },
    });

    await this.mailService.sendActionAuthOtp(
      recipientEmail,
      isMasterFallback ? `${user.name} (Acción crítica solicitada desde cuenta ${user.role})` : user.name,
      actionName || 'Confirmar Acción Administrativa',
      otp
    );

    const maskedEmail = recipientEmail.replace(/(.{2})(.*)(@.*)/, '$1***$3');
    return {
      success: true,
      message: isMasterFallback
        ? `🔐 Por seguridad preventiva, el código de autorización fue enviado al correo del Super Administrador (${maskedEmail}).`
        : `Código de confirmación de 6 dígitos enviado a tu correo (${maskedEmail}).`,
    };
  }

  async verifyActionAuth(userId: string, data: { method: 'PASSWORD' | 'OTP'; password?: string; otpCode?: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const cleanEmail = (user.email || '').trim().toLowerCase();
    const hasValidExternalEmail = cleanEmail.includes('@') && !cleanEmail.endsWith('@thevilladog.local');

    if (data.method === 'PASSWORD') {
      if (!hasValidExternalEmail) {
        throw new BadRequestException('Esta cuenta requiere autorización obligatoria mediante código OTP enviado al Super Administrador.');
      }
      if (!data.password) {
        throw new BadRequestException('Debes ingresar tu contraseña actual para autorizar la acción.');
      }
      const isMatch = await bcrypt.compare(data.password, user.password);
      if (!isMatch) {
        throw new UnauthorizedException('La contraseña ingresada es incorrecta.');
      }
      return { success: true, verifiedBy: 'PASSWORD' };
    }

    if (data.method === 'OTP') {
      const cleanOtp = (data.otpCode || '').trim();
      if (!cleanOtp) {
        throw new BadRequestException('Debes ingresar el código de 6 dígitos enviado a tu correo.');
      }

      const tokenHash = crypto.createHash('sha256').update(`ACTION_AUTH:${userId}:${cleanOtp}`).digest('hex');
      const token = await this.prisma.passwordResetToken.findFirst({
        where: {
          userId: user.id,
          tokenHash,
          usedAt: null,
          expiresAt: { gte: new Date() },
        },
      });

      if (!token) {
        throw new UnauthorizedException('El código de verificación es incorrecto o ya expiró.');
      }

      await this.prisma.passwordResetToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      });

      return { success: true, verifiedBy: 'OTP' };
    }

    throw new BadRequestException('Método de verificación no soportado.');
  }

  // --- VERIFICACIÓN DE CORREO EN PRIMER ACCESO (Onboarding 2FA) ---

  async requestSetupEmailOtp(userId: string, targetEmail: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const cleanEmail = (targetEmail || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@') || cleanEmail.endsWith('@thevilladog.local')) {
      throw new BadRequestException('Debes ingresar un correo electrónico real y válido (ej: tu_nombre@gmail.com).');
    }

    // Asegurar unicidad estricta en el sistema
    const existing = await this.prisma.user.findFirst({
      where: {
        email: { equals: cleanEmail, mode: 'insensitive' },
        id: { not: userId },
      },
    });
    if (existing) {
      throw new ConflictException('Este correo electrónico ya está registrado en otra cuenta del sistema.');
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const tokenHash = crypto.createHash('sha256').update(`SETUP_EMAIL:${userId}:${cleanEmail}:${otp}`).digest('hex');

    // Invalidar anteriores tokens de setup
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }).catch(() => {});

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutos
      },
    });

    await this.mailService.sendSetupEmailVerificationOtp(cleanEmail, user.name, otp);

    return {
      success: true,
      message: `Código de verificación enviado exitosamente a ${cleanEmail}`,
    };
  }

  async verifySetupEmailOtp(userId: string, targetEmail: string, otpCode: string, newPassword?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const cleanEmail = (targetEmail || '').trim().toLowerCase();
    const cleanOtp = (otpCode || '').trim();

    if (!cleanEmail || !cleanOtp) {
      throw new BadRequestException('Debes ingresar el correo y el código de 6 dígitos.');
    }

    const tokenHash = crypto.createHash('sha256').update(`SETUP_EMAIL:${userId}:${cleanEmail}:${cleanOtp}`).digest('hex');
    const token = await this.prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        tokenHash,
        usedAt: null,
        expiresAt: { gte: new Date() },
      },
    });

    if (!token) {
      throw new BadRequestException('El código de verificación es incorrecto o ya expiró (Vence en 15 minutos).');
    }

    // Re-validar unicidad
    const existing = await this.prisma.user.findFirst({
      where: {
        email: { equals: cleanEmail, mode: 'insensitive' },
        id: { not: userId },
      },
    });
    if (existing) {
      throw new ConflictException('Este correo electrónico ya está registrado en otra cuenta.');
    }

    const updateData: any = {
      email: cleanEmail,
      mustVerifyEmail: false,
      emailVerified: true,
    };

    if (newPassword && newPassword.trim()) {
      this.validateStrongPassword(newPassword.trim());
      updateData.password = await bcrypt.hash(newPassword.trim(), 10);
    }

    const [updatedUser] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
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
        },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      }),
    ]);

    await this.auditService.log({
      actorName: updatedUser.name,
      actorRole: updatedUser.role,
      action: 'SETUP_EMAIL_VERIFIED',
      targetType: 'User',
      targetId: updatedUser.id,
      metadata: { newEmail: cleanEmail },
    }).catch(() => {});

    return {
      success: true,
      message: '¡Correo verificado y cuenta configurada exitosamente!',
      user: updatedUser,
    };
  }
}
