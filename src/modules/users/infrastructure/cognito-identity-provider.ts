import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { ConfigService } from '@nestjs/config';

export const COGNITO_IDENTITY_PROVIDER_CLIENT = Symbol(
  'COGNITO_IDENTITY_PROVIDER_CLIENT',
);

export function cognitoIdentityProviderClientConfig(configService: ConfigService): {
  region: string;
} {
  return {
    region: configService.getOrThrow<string>('cognitoRegion'),
  };
}

export function createCognitoIdentityProviderClient(
  configService: ConfigService,
): CognitoIdentityProviderClient {
  return new CognitoIdentityProviderClient(
    cognitoIdentityProviderClientConfig(configService),
  );
}
