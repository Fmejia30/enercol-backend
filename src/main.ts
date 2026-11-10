
import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { configureApp } from './shared/http/configure-app.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  configureApp(app, {
    frontendOrigin: configService.getOrThrow<string>('frontendOrigin'),
    nodeEnv: configService.getOrThrow<string>('nodeEnv'),
  });

  const nodeEnv = configService.getOrThrow<string>('nodeEnv');

  if (nodeEnv !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('EnerCol API')
        .setDescription(
          'API del backend de EnerCol. Los resultados de inteligencia artificial quedan sujetos a validación humana.',
        )
        .setVersion('1.0')
        .addBearerAuth({
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Access token emitido por Amazon Cognito',
        })
        .build(),
    );

    SwaggerModule.setup('api/swagger', app, document);
  }

  await app.listen(configService.getOrThrow<number>('port'));
}

bootstrap();
