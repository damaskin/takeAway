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

  await app.register(import('@fastify/helmet'), {
    contentSecurityPolicy: false,
    // Swagger UI iframes the API docs page; COEP blocks its own subresources.
    crossOriginEmbedderPolicy: false,
  });
  const { default: fastifyCompress } = await import('@fastify/compress');
  await app.register(fastifyCompress);
  app.enableCors({ origin: true, credentials: true });

  // A previous dev build served swagger-ui-init.js with Content-Length: 0 and
  // browsers cached that broken response under the same ETag/Last-Modified.
  // Strip conditional headers + tell browsers never to cache Swagger assets
  // so a fresh build is always re-downloaded in full.
  const swaggerPrefix = `/${globalPrefix}/docs`;
  const fastify = app.getHttpAdapter().getInstance() as unknown as {
    addHook: (
      name: 'onRequest' | 'onSend',
      fn: (
        req: { url?: string; headers: Record<string, string | undefined> },
        reply: {
          header(name: string, value: string): unknown;
        },
        payloadOrDone?: unknown,
        done?: unknown,
      ) => void,
    ) => void;
  };
  fastify.addHook('onRequest', (req, _reply, done) => {
    if (req.url && req.url.startsWith(swaggerPrefix)) {
      // Drop conditional-cache headers so @fastify/static cannot return a 304
      // that points the browser back at a bad cached body.
      delete req.headers['if-none-match'];
      delete req.headers['if-modified-since'];
    }
    (done as () => void)();
  });
  fastify.addHook('onSend', (req, reply, _payload, done) => {
    if (req.url && req.url.startsWith(swaggerPrefix)) {
      reply.header('cache-control', 'no-store, must-revalidate');
      reply.header('pragma', 'no-cache');
      reply.header('expires', '0');
    }
    (done as () => void)();
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('takeAway API')
    .setDescription('Pre-order first coffee & food takeaway platform API')
    .setVersion('0.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${globalPrefix}/docs`, app, document, {
    // Keep the token between reloads so `/api/loyalty/me` etc. are one click.
    swaggerOptions: { persistAuthorization: true },
  });

  const host = process.env['API_HOST'] ?? '0.0.0.0';
  const port = Number(process.env['API_PORT'] ?? process.env['PORT'] ?? 3000);
  await app.listen(port, host);

  const logger = app.get(Logger);
  logger.log(`🚀 takeAway API running on http://${host}:${port}/${globalPrefix}`);
  logger.log(`📖 Swagger available at http://${host}:${port}/${globalPrefix}/docs`);
}

void bootstrap();
