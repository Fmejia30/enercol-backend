import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { TOKEN_VERIFIER } from './application/token-verifier.js';
import { ACCESS_TOKEN_VERIFIER } from './infrastructure/access-token-verifier.js';
import { CognitoTokenVerifier } from './infrastructure/cognito-token.verifier.js';
import { IdentityController } from './presentation/identity.controller.js';
import { JwtAuthGuard } from './presentation/jwt-auth.guard.js';
import { RolesGuard } from './presentation/roles.guard.js';

@Module({
  controllers: [IdentityController],
  providers: [
    {
      provide: ACCESS_TOKEN_VERIFIER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        CognitoJwtVerifier.create({
          userPoolId: configService.getOrThrow<string>('cognitoUserPoolId'),
          clientId: configService.getOrThrow<string>('cognitoClientId'),
          tokenUse: 'access',
          includeRawJwtInErrors: false,
        }),
    },
    {
      provide: TOKEN_VERIFIER,
      useClass: CognitoTokenVerifier,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  exports: [TOKEN_VERIFIER],
})
export class IdentityAccessModule {}
