// Must stay first — see the file for why the ordering is load-bearing.
import { sentryEnabled } from './instrument';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app/app.module';
import { corsOriginCheck } from './app/common/http/cors-origins';
import { resolveTrustProxy } from './app/common/http/trust-proxy';
import { SentryExceptionFilter } from './app/common/observability/sentry-exception.filter';

async function bootstrap(): Promise<void> {
  // Exactly the proxy hops we run (our nginx), not every address in
  // X-Forwarded-For — see common/http/trust-proxy.ts.
  const adapter = new FastifyAdapter({ trustProxy: resolveTrustProxy(process.env['TRUST_PROXY']) });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
    // Keeps the exact bytes of JSON bodies on `request.rawBody`. The Stripe
    // webhook signature is computed over those bytes; re-serialising the
    // parsed body never matches, so verification could not succeed.
    rawBody: true,
  });

  app.useLogger(app.get(Logger));

  const globalPrefix = process.env['API_GLOBAL_PREFIX'] ?? 'api';
  app.setGlobalPrefix(globalPrefix);

  // The adapter has to be handed in explicitly. BaseExceptionFilter only gets
  // one through DI, and a filter built with `new` here never goes through the
  // container — so it would reach for `applicationRef.isHeadersSent` on
  // `undefined` and turn *every* error response, a plain 404 included, into a
  // 500 reading "Cannot read properties of undefined (reading 'isHeadersSent')".
  app.useGlobalFilters(new SentryExceptionFilter(app.getHttpAdapter()));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Image uploads (logos, product and store photos) are multipart; Fastify
  // needs its own parser — Express's FileInterceptor never sees the file.
  // Per-route limits live in the UploadedImage decorator.
  await app.register(import('@fastify/multipart'), { limits: { files: 1, fields: 10 } });

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
  // call this API in a signed-in browser's name. CORS_ALLOWED_ORIGINS names
  // the sites; unset, it is the production sites (plus localhost outside
  // production) — never "whoever asks". See common/http/cors-origins.ts.
  app.enableCors({ origin: corsOriginCheck(), credentials: true });
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
