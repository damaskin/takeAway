import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app/app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }), {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  const globalPrefix = process.env['API_GLOBAL_PREFIX'] ?? 'api';
  app.setGlobalPrefix(globalPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.register(import('@fastify/helmet'), { contentSecurityPolicy: false });
  await app.register(import('@fastify/compress'));
  app.enableCors({ origin: true, credentials: true });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('takeAway API')
    .setDescription('Pre-order first coffee & food takeaway platform API')
    .setVersion('0.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${globalPrefix}/docs`, app, document);

  const host = process.env['API_HOST'] ?? '0.0.0.0';
  const port = Number(process.env['API_PORT'] ?? process.env['PORT'] ?? 3000);
  await app.listen(port, host);

  const logger = app.get(Logger);
  logger.log(`🚀 takeAway API running on http://${host}:${port}/${globalPrefix}`);
  logger.log(`📖 Swagger available at http://${host}:${port}/${globalPrefix}/docs`);
}

void bootstrap();
