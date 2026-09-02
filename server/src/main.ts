import 'dotenv/config';
import { isAllowedOrigin, validateProductionEnvironment } from './common/environment';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, RequestMethod } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { PrismaService } from './prisma/prisma.service';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : undefined,
  });
  app.enableShutdownHooks();

  app.setGlobalPrefix('api', {
    exclude: [
      { path: '', method: RequestMethod.GET },
    ],
  });

  app.useGlobalFilters(new AllExceptionsFilter(app.get(PrismaService)));

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        // Camera previews and authenticated receipt downloads use local object URLs.
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      },
    },
  }));
  
  const instance = app.getHttpAdapter().getInstance();
  if (typeof instance.set === 'function') {
    instance.set('trust proxy', 1);
  }

  // Middleware para enrutar cualquier variante de URL del puente local a /api/imprimir/cola
  instance.use((req: any, res: any, next: any) => {
    const rawUrl = req.url || '';
    if (rawUrl.startsWith('/imprimir/cola') || rawUrl.startsWith('/cola-impresion') || rawUrl.startsWith('/api/cola-impresion')) {
      req.url = '/api/imprimir/cola' + (rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?')) : '');
    }
    next();
  });

  app.use(
    rateLimit({
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 1000, // limit each IP to 1000 requests per windowMs
      validate: { xForwardedForHeader: false },
      message: 'Demasiadas peticiones desde esta IP, por favor intenta de nuevo en un minuto',
    }),
  );

  app.enableCors({
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }));

  if (process.env.NODE_ENV !== 'production') {
  const config = new DocumentBuilder()
    .setTitle('The Villa Dog Domicilios API')
    .setDescription('Sistema de Gestión de Domicilios - The Villa Dog')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Auth', 'Autenticación y registro')
    .addTag('Users', 'Gestión de usuarios')
    .addTag('Menu', 'Menú y categorías')
    .addTag('Orders', 'Pedidos y domicilios')
    .addTag('Delivery Zones', 'Zonas de entrega')
    .addTag('Payments', 'Pagos y cierres de caja')
    .addTag('Expenses', 'Control de gastos')
    .addTag('Ranking', 'Ranking de meseros')
    .addTag('Reports', 'Reportes y estadísticas')
    .addTag('Notifications', 'Notificaciones')
    .addTag('SuperAdmin', 'Panel técnico exclusivo del Super Admin')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'The Villa Dog API Docs',
    customCss: '.swagger-ui .topbar { background-color: #F97316 }',
  });

  }

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`THE VILLA DOG API running on http://0.0.0.0:${port}`);
  console.log(`Swagger docs: http://0.0.0.0:${port}/docs`);
}
bootstrap();
