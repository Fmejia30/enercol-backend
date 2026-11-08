import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

export interface IdTokenClaims {
  sub: string;
  nonce?: string;
  email: string | null;
}

export interface IdTokenVerifier {
  verify(token: string): Promise<IdTokenClaims>;
}

export const ID_TOKEN_VERIFIER = Symbol('ID_TOKEN_VERIFIER');

@Injectable()
export class CognitoIdTokenVerifier implements IdTokenVerifier {
  private readonly verifier: ReturnType<typeof CognitoJwtVerifier.create>;

  constructor(configService: ConfigService) {
    this.verifier = CognitoJwtVerifier.create({
      userPoolId: configService.getOrThrow<string>('cognitoUserPoolId'),
      clientId: configService.getOrThrow<string>('cognitoClientId'),
      tokenUse: 'id',
      includeRawJwtInErrors: false,
    });
  }

  async verify(token: string): Promise<IdTokenClaims> {
    const payload = await this.verifier.verify(token);
    if (payload.token_use !== 'id' || payload.sub.trim().length === 0) {
      throw new Error('ID token claims are insufficient');
    }

    const nonce = typeof payload.nonce === 'string' ? payload.nonce : undefined;
    const email =
      typeof payload.email === 'string' && payload.email.length <= 320
        ? payload.email
        : null;
    return { sub: payload.sub, nonce, email };
  }
}
