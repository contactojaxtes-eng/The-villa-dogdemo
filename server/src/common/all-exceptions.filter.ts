import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private prisma: PrismaService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? (exception as HttpException).getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const responseBody = isHttpException
      ? (exception as HttpException).getResponse()
      : { statusCode: status, message: 'Internal server error' };

    // Registro best-effort: nunca debe afectar la respuesta al cliente
    this.recordErrorLog(exception, status, request).catch(() => {});

    response.status(status).json(responseBody);
  }

  private async recordErrorLog(exception: unknown, status: number, request: any) {
    try {
      // Solo registramos errores inesperados o del servidor; los 4xx de validación normales no ensucian el log
      if (status < 500) return;
      const message = exception instanceof Error ? exception.message : String(exception);
      const stack = exception instanceof Error ? exception.stack : undefined;
      await this.prisma.errorLog.create({
        data: {
          message: message?.slice(0, 2000) || 'Error desconocido',
          stack: stack?.slice(0, 5000),
          path: request?.url,
          method: request?.method,
          statusCode: status,
          userId: request?.user?.id,
        },
      });
    } catch (err: any) {
      this.logger.error(`No se pudo registrar ErrorLog: ${err.message}`);
    }
  }
}
