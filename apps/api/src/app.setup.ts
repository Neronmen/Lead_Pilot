import type { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { Env } from './config/env.schema';
import { readRawBody } from './ingest/raw-body';

/**
 * App-level setup that is not expressed as module providers. Shared by
 * main.ts and the e2e tests, so tests run the same app that ships.
 */
export function configureApp(app: NestExpressApplication, config: ConfigService<Env, true>): void {
  app.disable('x-powered-by');
  const hops = config.get('TRUST_PROXY', { infer: true });
  if (hops > 0) app.set('trust proxy', hops);
  // Reads the httpOnly refresh-token cookie on /auth routes.
  app.use(cookieParser());
  // Ingest needs the exact bytes (signatures), read before any body parser.
  app.use('/v1/ingest', readRawBody());
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }), credentials: true });
  app.enableShutdownHooks();
  if (config.get('API_DOCS', { infer: true }) === 'on') setupSwagger(app);
}

function setupSwagger(app: NestExpressApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('LeadPilot API')
      .setDescription(
        'AI lead qualification and routing. Errors use `{ error: { code, message, details? } }`.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build(),
  );
  // UI at /docs, raw OpenAPI JSON at /docs-json.
  SwaggerModule.setup('docs', app, document);
}
