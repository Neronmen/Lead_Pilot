import type { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Env } from './config/env.schema';

/**
 * App-level setup that is not expressed as module providers. Shared by
 * main.ts and the e2e tests, so tests run the same app that ships.
 */
export function configureApp(app: NestExpressApplication, config: ConfigService<Env, true>): void {
  app.disable('x-powered-by');
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }), credentials: true });
  app.enableShutdownHooks();
  setupSwagger(app);
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
      .build(),
  );
  // UI at /docs, raw OpenAPI JSON at /docs-json.
  SwaggerModule.setup('docs', app, document);
}
