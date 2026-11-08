import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter.js';
import { corsOrigin } from './origin-policy.js';

export function configureApp(
  app: INestApplication,
  options?: { frontendOrigin?: string; nodeEnv?: string },
): void {
  if (options?.frontendOrigin) {
    app.enableCors({
      origin: corsOrigin(options.nodeEnv, options.frontendOrigin),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    });
  }

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
}
