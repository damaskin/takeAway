// Must stay first — see the file for why the ordering is load-bearing.
import { sentryEnabled } from './instrument';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app/app.module';
import { SentryExceptionFilter } from './app/common/observability/sentry-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }), {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  const globalPrefix = process.env['API_GLOBAL_PREFIX'] ?? 'api';
  app.setGlobalPrefix(globalPrefix);

  app.useGlobalFilters(new SentryExceptionFilter());

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
  const swaggerPrefix = `/${globalPrefix}/docs`;
  const { default: fastifyCompress } = await import('@fastify/compress');
  // Two dev-only bugs bite here otherwise:
  //   1. Chrome negotiates `zstd` but @fastify/compress pipes an empty body
  //      back for zstd-encoded static files from swagger-ui-dist (observed
  //      content-length: 0 on swagger-ui-init.js). Dropping zstd from the
  //      negotiated encodings forces br/gzip which serialize correctly.
  //   2. Compressing inside /api/docs is risky because the swagger-ui-init
  //      file is written on the fly by @nestjs/swagger and the combination
  //      occasionally emits a 0-length body. The filter below skips
  //      compression entirely for that prefix so the browser always gets
  //      the full uncompressed payload.
  await app.register(fastifyCompress, {
    encodings: ['br', 'gzip', 'deflate'],
    customTypes: /^(text|application)\/.*/,
  });
  // Reflecting any origin with credentials means a page on any domain can
  // call this API in a signed-in browser's name. Prod runs on a known set
  // of hosts, so name them; an unset list stays permissive for local
  // development, where the SPAs sit on four different ports.
  const allowedOrigins = (process.env['CORS_ALLOWED_ORIGINS'] ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (allowedOrigins.length > 0) {
    app.enableCors({ origin: allowedOrigins, credentials: true });
  } else {
    if (process.env['NODE_ENV'] === 'production') {
      // Loud, because this is the one place a misconfiguration is both
      // invisible and exploitable.
      // eslint-disable-next-line no-console
      console.warn('CORS_ALLOWED_ORIGINS is not set — the API will reflect any origin. Set it before going live.');
    }
    app.enableCors({ origin: true, credentials: true });
  }
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
      // Force the downstream compress plugin into no-op mode for Swagger:
      // we've seen zstd-encoded swagger-ui-init.js arrive with content-length: 0
      // in Chrome. With accept-encoding gone the plugin passes the body through.
      delete req.headers['accept-encoding'];
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

  // Swagger describes every endpoint, its DTOs and its auth requirements.
  // That is a map for anyone probing the API, so production has to opt in
  // rather than opt out.
  const docsEnabled = process.env['NODE_ENV'] !== 'production' || process.env['SWAGGER_ENABLED'] === 'true';

  const swaggerConfig = new DocumentBuilder()
    .setTitle('takeAway API')
    .setDescription('Pre-order first coffee & food takeaway platform API')
    .setVersion('0.0.0')
    .addBearerAuth()
    .build();
  if (docsEnabled) {
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(`${globalPrefix}/docs`, app, document, {
      // Keep the token between reloads so `/api/loyalty/me` etc. are one click.
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const host = process.env['API_HOST'] ?? '0.0.0.0';
  const port = Number(process.env['API_PORT'] ?? process.env['PORT'] ?? 3000);
  await app.listen(port, host);

  const logger = app.get(Logger);
  logger.log(`🚀 takeAway API running on http://${host}:${port}/${globalPrefix}`);
  logger.log(
    docsEnabled
      ? `📖 Swagger available at http://${host}:${port}/${globalPrefix}/docs`
      : '📖 Swagger is off in production (set SWAGGER_ENABLED=true to expose it)',
  );
  logger.log(sentryEnabled ? '🛰  Sentry error reporting is on' : '🛰  Sentry is off (no SENTRY_DSN)');
}

void bootstrap();
