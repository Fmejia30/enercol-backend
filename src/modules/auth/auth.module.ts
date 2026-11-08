import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/database/prisma.module.js';
import { SESSION_AUTHENTICATOR } from '../identity-access/application/session-authenticator.js';
import { IdentityAccessModule } from '../identity-access/identity-access.module.js';
import { AUTH_CLOCK, AUTH_REPOSITORY } from './application/auth.repository.js';
import { BffAuthService } from './application/bff-auth.service.js';
import { COGNITO_IDENTITY } from './application/cognito-identity.js';
import { BffSessionAuthenticator } from './infrastructure/bff-session-authenticator.js';
import { CognitoIdTokenVerifier } from './infrastructure/cognito-id-token.verifier.js';
import { ID_TOKEN_VERIFIER } from './infrastructure/cognito-id-token.verifier.js';
import { CognitoIdentityClient } from './infrastructure/cognito-identity.client.js';
import { PrismaAuthRepository } from './infrastructure/prisma-auth.repository.js';
import { TokenCipher } from './infrastructure/token-cipher.js';
import { AuthController } from './presentation/auth.controller.js';
import { AuthCookies } from './presentation/auth-cookies.js';

@Global()
@Module({
  imports: [IdentityAccessModule, PrismaModule],
  controllers: [AuthController],
  providers: [
    TokenCipher,
    AuthCookies,
    BffAuthService,
    {
      provide: AUTH_CLOCK,
      useValue: () => new Date(),
    },
    {
      provide: AUTH_REPOSITORY,
      useClass: PrismaAuthRepository,
    },
    {
      provide: COGNITO_IDENTITY,
      useClass: CognitoIdentityClient,
    },
    {
      provide: ID_TOKEN_VERIFIER,
      useClass: CognitoIdTokenVerifier,
    },
    {
      provide: SESSION_AUTHENTICATOR,
      useClass: BffSessionAuthenticator,
    },
  ],
  exports: [SESSION_AUTHENTICATOR],
})
export class AuthModule {}
