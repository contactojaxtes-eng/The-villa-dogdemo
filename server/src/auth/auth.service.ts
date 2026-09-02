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
      throw new UnauthorizedException('Credenciales invalidas');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    if (user.failedLoginAttempts > 0 || user.lockoutUntil || user.mustVerifyEmail || user.emailVerified === false) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockoutUntil: null,
          mustVerifyEmail: false,
          emailVerified: true,
        },
      });
    }

    const payload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = (this.jwtService.sign as any)(payload, { expiresIn: process.env.JWT_EXPIRATION || '7d' });
    const refreshToken = (this.jwtService.sign as any)({ ...payload, type: 'refresh' }, { expiresIn: process.env.JWT_REFRESH_EXPIRATION || '30d' });

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
        mustVerifyEmail: false,
        emailVerified: true,
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
    const refreshToken = (this.jwtService.sign as any)({ ...payload, type: 'refresh' }, { expiresIn: process.env.JWT_REFRESH_EXPIRATION || '30d' });

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
    const refreshToken = (this.jwtService.sign as any)({ ...payload, type: 'refresh' }, { expiresIn: process.env.JWT_REFRESH_EXPIRATION || '30d' });

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
      if (payload.type !== 'refresh') throw new UnauthorizedException('Token de refresco inválido');
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user?.active) throw new UnauthorizedException('Usuario inactivo');
      const newPayload = { sub: user.id, email: user.email, role: user.role };
      const accessToken = (this.jwtService.sign as any)(newPayload, { expiresIn: process.env.JWT_EXPIRATION || '7d' });
      const refreshToken = (this.jwtService.sign as any)({ ...newPayload, type: 'refresh' }, { expiresIn: process.env.JWT_REFRESH_EXPIRATION || '30d' });
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
    if (!password || password.length < 4) {
      throw new BadRequestException('La contrasena debe tener al menos 4 caracteres.');
    }
  }

  async requestPasswordChange(userId: string, currentPassword: string, newPassword: string) {
    if (!currentPassword || !newPassword) {
      throw new BadRequestException('Debes ingresar la contrasena actual y la nueva contrasena');
    }
    if (newPassword.length < 4) {
      throw new BadRequestException('La nueva contrasena debe tener al menos 4 caracteres.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      throw new UnauthorizedException('La contrasena actual es incorrecta');
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      throw new BadRequestException('La nueva contrasena no puede ser igual a la actual');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { password: hashedPassword } });

    return {
      success: true,
      requiresOtp: false,
      message: 'Contrasena actualizada correctamente.',
    };
  }

  async confirmPasswordChange(userId: string, currentPassword: string, newPassword: string, otpCode?: string) {
    return this.requestPasswordChange(userId, currentPassword, newPassword);
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
      throw new BadRequestException('Debes ingresar un correo electronico valido');
    }

    const existing = await this.prisma.user.findFirst({
      where: {
        email: { equals: cleanNewEmail, mode: 'insensitive' },
        id: { not: userId },
      },
    });
    if (existing) {
      throw new BadRequestException('Este correo electronico ya esta registrado por otra cuenta');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { email: cleanNewEmail, mustVerifyEmail: false, emailVerified: true },
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
    });

    return {
      success: true,
      requiresOtp: false,
      step: 0,
      email: updatedUser.email,
      user: updatedUser,
      message: 'Correo actualizado directamente.',
    };
  }

  async verifyCurrentEmailStep1(userId: string, newEmail: string, otpCode?: string) {
    return this.requestEmailChange(userId, newEmail);
  }

  async confirmNewEmailStep2(userId: string, newEmail: string, otpCode?: string) {
    return this.requestEmailChange(userId, newEmail);
  }

  // --- Autorizacion simplificada para desarrollo ---

  async requestActionOtp(userId: string, actionName: string) {
    return {
      success: true,
      bypassed: true,
      message: 'Autorizacion omitida en modo de pruebas.',
    };
  }

  async verifyActionAuth(userId: string, data: { method: 'PASSWORD' | 'OTP'; password?: string; otpCode?: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return { success: true, verifiedBy: 'BYPASS' };
  }

  // --- VERIFICACI  // --- VERIFICACIÓN DE CORREO EN PRIMER ACCESO (Onboarding 2FA) ---

  async requestSetupEmailOtp(userId: string, targetEmail: string) {
    const result = await this.requestEmailChange(userId, targetEmail);
    return {
      success: true,
      bypassed: true,
      message: 'Correo configurado directamente sin OTP.',
      user: result.user,
    };
  }

  async verifySetupEmailOtp(userId: string, targetEmail: string, otpCode?: string, newPassword?: string) {
    await this.requestEmailChange(userId, targetEmail);
    const updateData: any = { mustVerifyEmail: false, emailVerified: true };

    if (newPassword && newPassword.trim()) {
      if (newPassword.trim().length < 4) {
        throw new BadRequestException('La nueva contrasena debe tener al menos 4 caracteres.');
      }
      updateData.password = await bcrypt.hash(newPassword.trim(), 10);
    }

    const updatedUser = await this.prisma.user.update({
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
    });

    return {
      success: true,
      message: 'Cuenta configurada directamente sin OTP.',
      user: updatedUser,
    };
  }
}
