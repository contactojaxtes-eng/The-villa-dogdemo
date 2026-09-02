import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as nodemailer from 'nodemailer';
import * as dns from 'dns';

try {
  if (typeof (dns as any).setDefaultResultOrder === 'function') {
    (dns as any).setDefaultResultOrder('ipv4first');
  }
} catch (e) {}

const SMTP_SETTING_KEYS = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from'];

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private apiConfig: { provider: 'brevo' | 'resend' | 'google_script'; key: string; from: string } | null = null;
  private fromAddress: string | undefined;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {}

  async onModuleInit() {
    await this.reloadTransporter();
  }

  async getSmtpConfig() {
    const rows = await this.prisma.appSetting.findMany({ where: { key: { in: SMTP_SETTING_KEYS } } });
    const dbValues: Record<string, string> = {};
    for (const row of rows) dbValues[row.key] = row.value;

    return {
      host: dbValues.smtp_host || this.configService.get<string>('SMTP_HOST') || '',
      port: Number(dbValues.smtp_port || this.configService.get<string>('SMTP_PORT') || 587),
      user: dbValues.smtp_user || this.configService.get<string>('SMTP_USER') || '',
      pass: dbValues.smtp_pass || this.configService.get<string>('SMTP_PASS') || '',
      from: dbValues.smtp_from || this.configService.get<string>('SMTP_FROM') || dbValues.smtp_user || this.configService.get<string>('SMTP_USER') || '',
    };
  }

  async reloadTransporter() {
    const { host, port, user, pass, from } = await this.getSmtpConfig();
    this.fromAddress = from;

    this.transporter = null;
    this.apiConfig = null;

    if (host && user && pass) {
      const cleanPass = pass.replace(/\s+/g, '');
      const cleanUser = user.trim();
      const cleanHost = host.trim();
      const isGmail = cleanHost.includes('gmail');

      if (cleanPass.startsWith('https://script.google.com') || cleanPass.startsWith('AKfycb') || cleanHost.includes('script.google.com')) {
        const scriptUrl = cleanPass.startsWith('http')
          ? cleanPass
          : `https://script.google.com/macros/s/${cleanPass}/exec`;
        this.apiConfig = { provider: 'google_script', key: scriptUrl, from: from || cleanUser };
        this.logger.log(`Servicio de correo oficial de Google configurado usando Google Apps Script Webhook`);
      } else if (cleanPass.startsWith('re_')) {
        this.apiConfig = { provider: 'resend', key: cleanPass, from: from || cleanUser };
        this.logger.log(`Servicio de correo configurado usando Resend HTTP API`);
      } else if (cleanPass.startsWith('xkeysib-')) {
        this.apiConfig = { provider: 'brevo', key: cleanPass, from: from || cleanUser };
        this.logger.log(`Servicio de correo configurado usando Brevo HTTP API`);
      } else if (isGmail) {
        this.transporter = nodemailer.createTransport({
          host: 'smtp.gmail.com',
          port: 465,
          secure: true,
          auth: {
            user: cleanUser,
            pass: cleanPass,
          },
          tls: {
            rejectUnauthorized: false,
          },
          family: 4,
          lookup: (hostname: string, options: any, callback: any) => {
            const cb = typeof options === 'function' ? options : callback;
            return dns.lookup(hostname, { family: 4 }, cb);
          },
          connectionTimeout: 10000,
          socketTimeout: 10000,
          greetingTimeout: 10000,
        } as any);
        this.logger.log(`Servicio de correo Gmail configurado para ${cleanUser}`);
      } else {
        this.transporter = nodemailer.createTransport({
          host: cleanHost,
          port: Number(port) || 587,
          secure: Number(port) === 465,
          auth: {
            user: cleanUser,
            pass: cleanPass,
          },
          tls: {
            rejectUnauthorized: false,
          },
          family: 4,
          lookup: (hostname: string, options: any, callback: any) => {
            const cb = typeof options === 'function' ? options : callback;
            return dns.lookup(hostname, { family: 4 }, cb);
          },
          connectionTimeout: 15000,
          socketTimeout: 15000,
          greetingTimeout: 15000,
        } as any);
        this.logger.log(`Servicio de correo SMTP configurado con ${cleanHost}:${port}`);
      }
    } else {
      this.logger.warn('Servicio de correo no configurado. Las alertas se registrarán en la consola.');
    }
  }

  private async performSendEmail(to: string | string[], subject: string, text: string, html: string) {
    if (this.apiConfig) {
      const toArray = Array.isArray(to) ? to : to.split(',').map(e => e.trim());

      if (this.apiConfig.provider === 'google_script') {
        const response = await fetch(this.apiConfig.key, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: Array.isArray(to) ? to.join(',') : to,
            subject,
            html,
            text,
          }),
          redirect: 'follow',
        });

        if (!response.ok) {
          const errData = await response.text().catch(() => '');
          throw new Error(`Error de Google Script: ${response.status} - ${errData}`);
        }
        return true;
      }

      if (this.apiConfig.provider === 'brevo') {
        const brevoToArray = toArray.map(e => ({ email: e }));
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': this.apiConfig.key,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            sender: { email: this.apiConfig.from, name: 'The Villa Dog Domicilios' },
            to: brevoToArray,
            subject,
            htmlContent: html,
            textContent: text,
          })
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(`Error de Brevo API: ${response.status} - ${JSON.stringify(errData)}`);
        }
        return true;
      }

      if (this.apiConfig.provider === 'resend') {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiConfig.key}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: `The Villa Dog Domicilios <${this.apiConfig.from}>`,
            to: toArray,
            subject,
            html,
            text,
          })
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(`Error de Resend API: ${response.status} - ${JSON.stringify(errData)}`);
        }
        return true;
      }
    } else if (this.transporter) {
      // Usar SMTP tradicional
      let fromHeader = 'notificaciones@thevilladog.local';
      if (this.fromAddress) {
        if (this.fromAddress.includes('<') && this.fromAddress.includes('>')) {
          fromHeader = this.fromAddress;
        } else if (this.fromAddress.includes('@')) {
          fromHeader = `"The Villa Dog" <${this.fromAddress.trim()}>`;
        }
      }

      await this.transporter.sendMail({
        from: fromHeader,
        to,
        subject,
        text,
        html,
      });
      return true;
    }
    
    throw new Error('Servicio de correo no está configurado. Guarda una configuración válida primero.');
  }

  async sendTestEmail(to: string) {
    await this.performSendEmail(
      to,
      '✅ Correo de prueba - The Villa Dog Domicilios',
      'Si recibiste este correo, la configuración del sistema funciona correctamente.',
      `<div style="font-family: Arial, sans-serif; padding: 20px;"><h2 style="color:#F97316;">✅ Correo de prueba</h2><p>Si recibiste este correo, la configuración del sistema The Villa Dog Domicilios funciona correctamente.</p></div>`
    );
    return { message: `Correo de prueba enviado a ${to}` };
  }

  async sendPasswordResetEmail(to: string, name: string, resetLink: string, code?: string) {
    try {
      const subject = '🔑 Recupera tu contraseña - The Villa Dog';
      const text = `Hola ${name},\n\nRecibimos una solicitud para restablecer tu contraseña en el Sistema The Villa Dog.\n${code ? `Código de seguridad: ${code}\n\n` : ''}Enlace directo (válido por 1 hora):\n${resetLink}\n\nSi no solicitaste este cambio, ignora este mensaje.\n\nThe Villa Dog`;
      const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; background-color: #0E0E10; color: #FFFFFF; padding: 30px; border-radius: 16px; max-width: 550px; margin: auto; border: 1px solid rgba(249, 115, 22, 0.2);">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #F97316; font-size: 26px; margin: 0; font-weight: 800; letter-spacing: 1px;">THE VILLA DOG</h1>
            <p style="color: #888; font-size: 11px; margin: 4px 0 0 0; text-transform: uppercase; letter-spacing: 2px;">Sabor Auténtico • Sistema de Gestión</p>
          </div>
          
          <div style="background-color: #18181B; padding: 24px; border-radius: 12px; border: 1px solid #27272A;">
            <h2 style="color: #FFFFFF; font-size: 18px; margin-top: 0; font-weight: 700;">Restablecer Contraseña</h2>
            <p style="color: #D4D4D8; font-size: 14px; line-height: 1.6;">Hola <strong>${name}</strong>,</p>
            <p style="color: #A1A1AA; font-size: 13px; line-height: 1.5;">Recibimos una solicitud para cambiar tu contraseña de acceso a THE VILLA DOG. Este enlace y código son válidos por <strong>1 hora</strong>.</p>
            
            ${code ? `
              <div style="background-color: #27272A; border: 1px dashed #F97316; border-radius: 10px; padding: 16px; text-align: center; margin: 20px 0;">
                <span style="color: #A1A1AA; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 6px;">Tu código de seguridad</span>
                <span style="color: #F97316; font-size: 28px; font-weight: 800; letter-spacing: 6px; font-family: monospace;">${code}</span>
              </div>
            ` : ''}

            <div style="text-align: center; margin: 24px 0 16px 0;">
              <a href="${resetLink}" style="background: linear-gradient(135deg, #F97316, #EA580C); color: #0D0D0D; padding: 13px 32px; border-radius: 10px; text-decoration: none; font-weight: 800; font-size: 14px; display: inline-block; box-shadow: 0 4px 14px rgba(249, 115, 22, 0.4);">Restablecer Contraseña</a>
            </div>
            
            <p style="color: #71717A; font-size: 11px; text-align: center; margin: 0;">Si no solicitaste este cambio, puedes ignorar este correo con tranquilidad.</p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #52525B; font-size: 11px;">
            &copy; ${new Date().getFullYear()} The Villa Dog. Todos los derechos reservados.
          </div>
        </div>
      `;

      if (this.apiConfig || this.transporter) {
        await this.performSendEmail(to, subject, text, html);
        this.logger.log(`Correo de recuperación de contraseña enviado a: ${to}`);
      } else {
        this.logger.log(`[SIMULACIÓN CORREO] Recuperación de contraseña para: ${to} | Enlace: ${resetLink}`);
      }
      return true;
    } catch (err: any) {
      this.logger.error(`Error enviando correo de recuperación a ${to}: ${err.message}`);
      throw err;
    }
  }

  async sendAuthorizeCurrentEmailOtp(to: string, name: string, newEmail: string, otpCode: string) {
    try {
      const subject = '🛡️ Paso 1: Autorizar desvinculación de tu correo actual - THE VILLA DOG';
      const text = `Hola ${name},\n\nRecibimos una solicitud para desvincular este correo actual y reemplazarlo por: ${newEmail}.\n\nTu código de autorización para DESVINCULAR este correo es: ${otpCode}\n(Válido por 5 minutos).\n\nSi no fuiste tú, no compartas este código con nadie.\n\nThe Villa Dog`;
      const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; background-color: #0E0E10; color: #FFFFFF; padding: 30px; border-radius: 16px; max-width: 550px; margin: auto; border: 1px solid rgba(239, 68, 68, 0.3);">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #F97316; font-size: 26px; margin: 0; font-weight: 800; letter-spacing: 1px;">THE VILLA DOG</h1>
            <p style="color: #888; font-size: 11px; margin: 4px 0 0 0; text-transform: uppercase; letter-spacing: 2px;">Sabor Auténtico • Seguridad de Cuenta</p>
          </div>
          
          <div style="background-color: #18181B; padding: 24px; border-radius: 12px; border: 1px solid #27272A;">
            <span style="background-color: rgba(239, 68, 68, 0.15); color: #EF4444; border: 1px solid rgba(239, 68, 68, 0.3); font-size: 10px; font-weight: bold; text-transform: uppercase; padding: 3px 8px; rounded: 6px; letter-spacing: 1px;">Paso 1 de 2 • Desvinculación</span>
            <h2 style="color: #FFFFFF; font-size: 18px; margin-top: 10px; font-weight: 700;">Autorizar Cambio de Correo</h2>
            <p style="color: #D4D4D8; font-size: 14px; line-height: 1.6;">Hola <strong>${name}</strong>,</p>
            <p style="color: #A1A1AA; font-size: 13px; line-height: 1.5;">
              Recibimos una solicitud para <strong>desvincular este correo actual</strong> y cambiarlo por: <strong style="color: #F97316;">${newEmail}</strong>.
            </p>
            
            <div style="background-color: #27272A; border: 1px dashed #EF4444; border-radius: 10px; padding: 16px; text-align: center; margin: 20px 0;">
              <span style="color: #A1A1AA; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 6px;">Código para Autorizar Desvinculación (5 min)</span>
              <span style="color: #F87171; font-size: 32px; font-weight: 800; letter-spacing: 6px; font-family: monospace;">${otpCode}</span>
            </div>

            <p style="color: #EF4444; font-size: 12px; line-height: 1.5; margin: 0;">
              ⚠️ <strong>Si no solicitaste este cambio:</strong> NO compartas este código con nadie. Tu cuenta sigue protegida.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #52525B; font-size: 11px;">
            &copy; ${new Date().getFullYear()} The Villa Dog. Todos los derechos reservados.
          </div>
        </div>
      `;

      if (this.apiConfig || this.transporter) {
        await this.performSendEmail(to, subject, text, html);
        this.logger.log(`Código de desvinculación (Paso 1) enviado a correo actual: ${to}`);
      }
      return true;
    } catch (err: any) {
      this.logger.error(`Error enviando código paso 1 a ${to}: ${err.message}`);
      throw err;
    }
  }

  async sendVerifyNewEmailOtp(to: string, name: string, otpCode: string) {
    try {
      const subject = '✅ Paso 2: Código para activar tu NUEVO correo - THE VILLA DOG';
      const text = `Hola ${name},\n\nTu código para activar este NUEVO correo en tu cuenta de THE VILLA DOG es: ${otpCode}\n(Válido por 5 minutos).\n\nIngrésalo en pantalla para completar la activación.\n\nThe Villa Dog`;
      const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; background-color: #0E0E10; color: #FFFFFF; padding: 30px; border-radius: 16px; max-width: 550px; margin: auto; border: 1px solid rgba(249, 115, 22, 0.3);">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #F97316; font-size: 26px; margin: 0; font-weight: 800; letter-spacing: 1px;">THE VILLA DOG</h1>
            <p style="color: #888; font-size: 11px; margin: 4px 0 0 0; text-transform: uppercase; letter-spacing: 2px;">Sabor Auténtico • Seguridad de Cuenta</p>
          </div>
          
          <div style="background-color: #18181B; padding: 24px; border-radius: 12px; border: 1px solid #27272A;">
            <span style="background-color: rgba(249, 115, 22, 0.15); color: #F97316; border: 1px solid rgba(249, 115, 22, 0.3); font-size: 10px; font-weight: bold; text-transform: uppercase; padding: 3px 8px; rounded: 6px; letter-spacing: 1px;">Paso 2 de 2 • Activación</span>
            <h2 style="color: #FFFFFF; font-size: 18px; margin-top: 10px; font-weight: 700;">Activar Nuevo Correo</h2>
            <p style="color: #D4D4D8; font-size: 14px; line-height: 1.6;">Hola <strong>${name}</strong>,</p>
            <p style="color: #A1A1AA; font-size: 13px; line-height: 1.5;">
              Recibimos tu solicitud para activar este correo como la dirección oficial de tu cuenta en THE VILLA DOG.
            </p>
            
            <div style="background-color: #27272A; border: 1px dashed #F97316; border-radius: 10px; padding: 16px; text-align: center; margin: 20px 0;">
              <span style="color: #A1A1AA; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 6px;">Código de Activación (5 min)</span>
              <span style="color: #F97316; font-size: 32px; font-weight: 800; letter-spacing: 6px; font-family: monospace;">${otpCode}</span>
            </div>

            <p style="color: #A1A1AA; font-size: 12px; line-height: 1.5; margin: 0;">
              Escribe este código en la pantalla de tu perfil para completar la vinculación y dejarlo activo.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #52525B; font-size: 11px;">
            &copy; ${new Date().getFullYear()} The Villa Dog. Todos los derechos reservados.
          </div>
        </div>
      `;

      if (this.apiConfig || this.transporter) {
        await this.performSendEmail(to, subject, text, html);
        this.logger.log(`Código de activación (Paso 2) enviado a nuevo correo: ${to}`);
      }
      return true;
    } catch (err: any) {
      this.logger.error(`Error enviando código paso 2 a ${to}: ${err.message}`);
      throw err;
    }
  }

  async sendChangePasswordOtp(to: string, name: string, otpCode: string) {
    try {
      const subject = '🔐 Código de Confirmación para Cambiar Contraseña - THE VILLA DOG';
      const text = `Hola ${name},\n\nTu código para autorizar el cambio de contraseña en tu cuenta de THE VILLA DOG es: ${otpCode}\n(Válido por 5 minutos).\n\nIngrésalo en la pantalla para confirmar tu nueva contraseña.\n\nSi no fuiste tú, puedes ignorar este mensaje.\n\nThe Villa Dog`;
      const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; background-color: #0E0E10; color: #FFFFFF; padding: 30px; border-radius: 16px; max-width: 550px; margin: auto; border: 1px solid rgba(245, 158, 11, 0.4);">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #F59E0B; font-size: 26px; margin: 0; font-weight: 800; letter-spacing: 1px;">THE VILLA DOG</h1>
            <p style="color: #888; font-size: 11px; margin: 4px 0 0 0; text-transform: uppercase; letter-spacing: 2px;">Sabor Auténtico • Seguridad de Cuenta</p>
          </div>
          
          <div style="background-color: #18181B; padding: 24px; border-radius: 12px; border: 1px solid #27272A;">
            <span style="background-color: rgba(245, 158, 11, 0.15); color: #F59E0B; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 10px; font-weight: bold; text-transform: uppercase; padding: 4px 10px; border-radius: 6px; letter-spacing: 1px; display: inline-block;">
              Autorización de Cambio de Contraseña
            </span>
            <h2 style="color: #FFFFFF; font-size: 18px; margin-top: 14px; font-weight: 700;">Confirmar Nueva Contraseña</h2>
            <p style="color: #D4D4D8; font-size: 14px; line-height: 1.6;">Hola <strong>${name}</strong>,</p>
            <p style="color: #A1A1AA; font-size: 13px; line-height: 1.5;">
              Recibimos una solicitud para cambiar la contraseña de tu cuenta en el sistema de THE VILLA DOG.
            </p>
            
            <div style="background-color: #27272A; border: 1px dashed #F59E0B; border-radius: 10px; padding: 16px; text-align: center; margin: 20px 0;">
              <span style="color: #A1A1AA; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 6px;">Código de Autorización (5 min)</span>
              <span style="color: #FBBF24; font-size: 32px; font-weight: 800; letter-spacing: 6px; font-family: monospace;">${otpCode}</span>
            </div>

            <p style="color: #A1A1AA; font-size: 12px; line-height: 1.5; margin: 0;">
              Ingresa este código en tu perfil para autorizar y guardar tu nueva contraseña.<br/><br/>
              ⚠️ Si no solicitaste este cambio, no te preocupes: tu contraseña actual sigue protegida.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #52525B; font-size: 11px;">
            &copy; ${new Date().getFullYear()} The Villa Dog. Todos los derechos reservados.
          </div>
        </div>
      `;

      if (this.apiConfig || this.transporter) {
        await this.performSendEmail(to, subject, text, html);
        this.logger.log(`Código de cambio de contraseña enviado a: ${to}`);
      }
      return true;
    } catch (err: any) {
      this.logger.error(`Error enviando código de cambio de contraseña a ${to}: ${err.message}`);
      throw err;
    }
  }

  async sendBruteForceLockoutAlert(to: string, name: string, role: string, otpCode: string) {
    try {
      const subject = '🚨 ALERTA DE SEGURIDAD: 3 Intentos Fallidos de Acceso - THE VILLA DOG';
      const text = `Hola ${name},\n\nDetectamos 3 intentos fallidos consecutivos para ingresar a tu cuenta (${role}) en THE VILLA DOG.\n\nTu cuenta ha sido bloqueada preventivamente para proteger tus datos contra posibles ataques de fuerza bruta.\n\nSi fuiste tú y deseas entrar de inmediato sin contraseña, tu código de acceso es: ${otpCode} (Válido por 15 minutos).\n\nSi no fuiste tú, alguien intentó adivinar tu contraseña. Te recomendamos cambiarla al ingresar.\n\nThe Villa Dog`;
      const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; background-color: #0E0E10; color: #FFFFFF; padding: 30px; border-radius: 16px; max-width: 550px; margin: auto; border: 2px solid #EF4444;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #EF4444; font-size: 26px; margin: 0; font-weight: 800; letter-spacing: 1px;">🚨 ALERTA DE SEGURIDAD</h1>
            <p style="color: #888; font-size: 11px; margin: 4px 0 0 0; text-transform: uppercase; letter-spacing: 2px;">The Villa Dog • Protección contra Fuerza Bruta</p>
          </div>
          
          <div style="background-color: #18181B; padding: 24px; border-radius: 12px; border: 1px solid #27272A;">
            <span style="background-color: rgba(239, 68, 68, 0.2); color: #EF4444; border: 1px solid rgba(239, 68, 68, 0.4); font-size: 10px; font-weight: bold; text-transform: uppercase; padding: 4px 10px; border-radius: 6px; letter-spacing: 1px; display: inline-block;">
              Bloqueo Preventivo • 3 Intentos Fallidos
            </span>
            <h2 style="color: #FFFFFF; font-size: 18px; margin-top: 14px; font-weight: 700;">Acceso Sospechoso Detectado</h2>
            <p style="color: #D4D4D8; font-size: 14px; line-height: 1.6;">Hola <strong>${name}</strong>,</p>
            <p style="color: #A1A1AA; font-size: 13px; line-height: 1.6;">
              Detectamos <strong>3 intentos fallidos consecutivos</strong> para ingresar a tu cuenta (<strong style="color: #EF4444;">${role}</strong>). Tu cuenta ha sido <strong>bloqueada preventivamente</strong> para proteger la información del restaurante.
            </p>
            
            <div style="background-color: #27272A; border: 2px dashed #EF4444; border-radius: 12px; padding: 18px; text-align: center; margin: 20px 0;">
              <span style="color: #A1A1AA; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 6px;">Código para Entrar al Instante (15 min)</span>
              <span style="color: #F87171; font-size: 34px; font-weight: 800; letter-spacing: 8px; font-family: monospace;">${otpCode}</span>
            </div>

            <p style="color: #FCA5A5; font-size: 12px; line-height: 1.5; margin: 0; background-color: rgba(239, 68, 68, 0.1); padding: 12px; border-radius: 8px; border-left: 3px solid #EF4444;">
              ⚠️ <strong>¿Fuiste tú?</strong> Ingresa este código de 6 dígitos en la ventana de desbloqueo para entrar de una vez al sistema sin contraseña.<br/><br/>
              ⚠️ <strong>¿No fuiste tú?</strong> Alguien intentó adivinar tu contraseña. Te sugerimos cambiarla apenas ingreses a tu cuenta.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 20px; color: #52525B; font-size: 11px;">
            &copy; ${new Date().getFullYear()} The Villa Dog. Todos los derechos reservados.
          </div>
        </div>
      `;

      if (this.apiConfig || this.transporter) {
        await this.performSendEmail(to, subject, text, html);
        this.logger.log(`Alerta de fuerza bruta enviada a: ${to}`);
      }
      return true;
    } catch (err: any) {
      this.logger.error(`Error enviando alerta de fuerza bruta a ${to}: ${err.message}`);
      throw err;
    }
  }

  async sendPasswordChangedNotice(to: string, name: string) {
    try {
      const subject = 'Tu contraseña fue actualizada - The Villa Dog Domicilios';
      const text = `Hola ${name},\n\nUn administrador restableció la contraseña de tu cuenta en el sistema The Villa Dog Domicilios. Si no esperabas este cambio, contacta a tu Super Admin.\n\nSistema The Villa Dog Domicilios`;
      const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; max-width: 600px;">
          <h2 style="color: #F97316; margin-top: 0;">🔐 Contraseña actualizada</h2>
          <p>Hola ${name},</p>
          <p>Un administrador restableció la contraseña de tu cuenta en el sistema The Villa Dog Domicilios.</p>
          <p>Si no esperabas este cambio, contacta a tu Super Admin de inmediato.</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 12px; color: #777;">Sistema de Gestión The Villa Dog Domicilios</p>
        </div>
      `;

      if (this.apiConfig || this.transporter) {
        await this.performSendEmail(to, subject, text, html);
      } else {
        this.logger.log(`[SIMULACIÓN CORREO] Aviso de cambio de contraseña para: ${to}`);
      }
    } catch (err: any) {
      this.logger.error(`Error al enviar aviso de cambio de contraseña: ${err.message}`, err.stack);
    }
  }

  async sendLowStockAlert(ingredientName: string, currentStock: number, minStock: number, unit: string) {
    try {
      // Obtener correos de administradores activos
      const admins = await this.prisma.user.findMany({
        where: {
          role: { in: ['ADMIN', 'SUPERADMIN'] },
          active: true,
        },
        select: { email: true, name: true },
      });

      const adminEmails = admins.map(a => a.email).filter(Boolean);
      const customAdminEmail = this.configService.get<string>('ADMIN_EMAIL');
      if (customAdminEmail && !adminEmails.includes(customAdminEmail)) {
        adminEmails.push(customAdminEmail);
      }

      if (adminEmails.length === 0) {
        this.logger.warn(`No hay correos de administradores registrados para notificar sobre ${ingredientName}`);
        return;
      }

      const subject = `⚠️ ALERTA DE STOCK BAJO: ${ingredientName.toUpperCase()}`;
      const text = `Hola Administrador,\n\nEl ingrediente "${ingredientName}" se está agotando en el inventario.\n\nStock Actual: ${currentStock} ${unit}\nStock Mínimo: ${minStock} ${unit}\n\nPor favor realiza el reabastecimiento o pedido a proveedores a la brevedad.\n\nSistema The Villa Dog Domicilios`;
      const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px; max-width: 600px;">
          <h2 style="color: #d97706; margin-top: 0;">⚠️ Alerta de Stock Bajo</h2>
          <p>Estimado Administrador,</p>
          <p>El siguiente ingrediente de inventario ha alcanzado su límite de alerta:</p>
          <div style="background-color: #fef3c7; padding: 15px; border-radius: 6px; margin: 15px 0;">
            <p style="margin: 5px 0; font-weight: bold; font-size: 18px; color: #92400e;">${ingredientName}</p>
            <p style="margin: 5px 0;"><strong>Stock Actual:</strong> <span style="color: #dc2626; font-weight: bold;">${currentStock} ${unit}</span></p>
            <p style="margin: 5px 0;"><strong>Stock Mínimo Configurado:</strong> ${minStock} ${unit}</p>
          </div>
          <p>Le sugerimos registrar una nueva compra a proveedores para evitar la suspensión de platos en el menú.</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 12px; color: #777;">Sistema de Gestión The Villa Dog Domicilios</p>
        </div>
      `;

      if (this.apiConfig || this.transporter) {
        await this.performSendEmail(
          adminEmails,
          subject,
          text,
          html
        );
        this.logger.log(`Correo de stock bajo enviado exitosamente a: ${adminEmails.join(', ')}`);
      } else {
        this.logger.log(`[SIMULACIÓN CORREO ALERTA] Para: ${adminEmails.join(', ')} | Asunto: ${subject}`);
      }
    } catch (err: any) {
      this.logger.error(`Error al enviar correo de alerta de stock bajo: ${err.message}`, err.stack);
    }
  }

  async sendActionAuthOtp(to: string, userName: string, actionName: string, otpCode: string) {
    try {
      const subject = `🔐 Código de Confirmación de Seguridad: ${otpCode} - THE VILLA DOG`;
      const text = `Hola ${userName},\n\nSe ha solicitado autorizar la siguiente acción de seguridad:\n"${actionName}"\n\nTu código de verificación de 6 dígitos es:\n${otpCode}\n\nEste código expira en 10 minutos. Si no solicitaste esta acción, cambia tu contraseña inmediatamente.\n\nEquipo The Villa Dog Domicilios`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 25px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #1e293b;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h1 style="color: #0f172a; margin: 0; font-size: 24px; font-weight: 900; letter-spacing: -0.5px;">THE VILLA DOG <span style="color: #10b981;">DOMICILIOS</span></h1>
            <p style="color: #64748b; font-size: 13px; margin-top: 4px;">Confirmación de Seguridad de Acciones Administrativas</p>
          </div>
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
            <p style="margin: 0 0 10px 0; font-size: 15px; font-weight: bold; color: #0f172a;">Hola ${userName},</p>
            <p style="margin: 0 0 15px 0; font-size: 14px; color: #475569; line-height: 1.5;">
              Se ha solicitado confirmar la siguiente acción de administración:
            </p>
            <div style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 10px 14px; border-radius: 6px; margin-bottom: 15px;">
              <span style="color: #065f46; font-weight: bold; font-size: 14px;">🛡️ ${actionName}</span>
            </div>
            <p style="margin: 0 0 10px 0; font-size: 13px; color: #64748b;">Ingresa el siguiente código de 6 dígitos para autorizar el cambio:</p>
            <div style="text-align: center; margin: 20px 0;">
              <span style="display: inline-block; font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #0f172a; background-color: #f1f5f9; padding: 12px 28px; border-radius: 12px; border: 2px dashed #cbd5e1; font-family: monospace;">${otpCode}</span>
            </div>
            <p style="margin: 0; font-size: 12px; color: #94a3b8; text-align: center;">⏱️ Este código es válido por 10 minutos y de un solo uso.</p>
          </div>
          <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
            Si tú no solicitaste este código, te recomendamos revisar la seguridad de tu cuenta de inmediato.
          </p>
        </div>
      `;

      if (this.apiConfig || this.transporter) {
        await this.performSendEmail(to, subject, text, html);
        this.logger.log(`Código de acción enviado exitosamente a: ${to}`);
      } else {
        this.logger.log(`[SIMULACIÓN CORREO OTP ACCIÓN] Para: ${to} | Código: ${otpCode} | Acción: ${actionName}`);
      }
    } catch (err: any) {
      this.logger.error(`Error al enviar OTP de acción a ${to}: ${err.message}`, err.stack);
    }
  }

  async sendSetupEmailVerificationOtp(to: string, userName: string, otpCode: string) {
    try {
      const subject = `📧 Verifica tu Correo Electrónico: ${otpCode} - THE VILLA DOG`;
      const text = `Hola ${userName},\n\nBienvenido a The Villa Dog Domicilios. Para completar la configuración de tu cuenta y proteger tu acceso, ingresa el siguiente código de verificación:\n\n${otpCode}\n\nEste código expira en 15 minutos.\n\nEquipo The Villa Dog Domicilios`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 25px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #1e293b;">
          <div style="text-align: center; margin-bottom: 20px;">
            <h1 style="color: #0f172a; margin: 0; font-size: 24px; font-weight: 900; letter-spacing: -0.5px;">THE VILLA DOG <span style="color: #10b981;">DOMICILIOS</span></h1>
            <p style="color: #64748b; font-size: 13px; margin-top: 4px;">Configuración de Correo de Seguridad en Primer Ingreso</p>
          </div>
          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
            <p style="margin: 0 0 10px 0; font-size: 15px; font-weight: bold; color: #0f172a;">¡Hola ${userName}!</p>
            <p style="margin: 0 0 15px 0; font-size: 14px; color: #475569; line-height: 1.5;">
              Para garantizar la seguridad de tu acceso y permitir la recuperación de tu contraseña, verifica tu correo electrónico ingresando este código:
            </p>
            <div style="text-align: center; margin: 20px 0;">
              <span style="display: inline-block; font-size: 32px; font-weight: 900; letter-spacing: 8px; color: #0f172a; background-color: #f1f5f9; padding: 12px 28px; border-radius: 12px; border: 2px dashed #cbd5e1; font-family: monospace;">${otpCode}</span>
            </div>
            <p style="margin: 0; font-size: 12px; color: #94a3b8; text-align: center;">⏱️ Este código es válido por 15 minutos.</p>
          </div>
          <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
            Sistema de Gestión Integral The Villa Dog Domicilios • Montería, Colombia
          </p>
        </div>
      `;

      if (this.apiConfig || this.transporter) {
        await this.performSendEmail(to, subject, text, html);
        this.logger.log(`Código de verificación de correo enviado exitosamente a: ${to}`);
      } else {
        this.logger.log(`[SIMULACIÓN CORREO VERIFICACIÓN SETUP] Para: ${to} | Código: ${otpCode}`);
      }
    } catch (err: any) {
      this.logger.error(`Error al enviar OTP de setup a ${to}: ${err.message}`, err.stack);
    }
  }
}
