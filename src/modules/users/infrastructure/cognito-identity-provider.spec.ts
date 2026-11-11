import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { ConfigService } from '@nestjs/config';
import {
  cognitoIdentityProviderClientConfig,
  createCognitoIdentityProviderClient,
} from './cognito-identity-provider.js';

describe('Cognito identity provider client', () => {
  const config = {
    getOrThrow: (key: string) => {
      if (key === 'cognitoRegion') {
        return 'us-east-2';
      }
      throw new Error(key);
    },
  } as ConfigService;

  it('uses the configured region and leaves credentials to the SDK chain', async () => {
    expect(cognitoIdentityProviderClientConfig(config)).toEqual({
      region: 'us-east-2',
    });
    expect(cognitoIdentityProviderClientConfig(config)).not.toHaveProperty(
      'credentials',
    );
    expect(cognitoIdentityProviderClientConfig(config)).not.toHaveProperty(
      'accessKeyId',
    );
    expect(cognitoIdentityProviderClientConfig(config)).not.toHaveProperty(
      'secretAccessKey',
    );

    const client = createCognitoIdentityProviderClient(config);
    expect(client).toBeInstanceOf(CognitoIdentityProviderClient);
    await expect(client.config.region()).resolves.toBe('us-east-2');
    expect(client.config.credentials).toEqual(expect.any(Function));
  });
});
