import { RespondToAuthChallengeCommand } from '@aws-sdk/client-cognito-identity-provider';
import { secretHash } from '../domain/auth-crypto.js';
import { cognitoChallengeResponses } from './cognito-identity.client.js';

describe('Cognito challenge responses', () => {
  it('sends USERNAME, NEW_PASSWORD and only the requested user attributes', () => {
    const responses = cognitoChallengeResponses({
      username: 'usuario@empresa.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      responses: {
        NEW_PASSWORD: 'new-secret',
        'userAttributes.email': 'usuario@empresa.com',
      },
    });

    expect(responses).toEqual({
      USERNAME: 'usuario@empresa.com',
      SECRET_HASH: secretHash(
        'usuario@empresa.com',
        'client-id',
        'client-secret',
      ),
      NEW_PASSWORD: 'new-secret',
      'userAttributes.email': 'usuario@empresa.com',
    });
    expect(responses).not.toHaveProperty('email');
    expect(responses).not.toHaveProperty('password');

    const command = new RespondToAuthChallengeCommand({
      ClientId: 'client-id',
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      Session: 'cognito-session',
      ChallengeResponses: responses,
    });
    expect(command.input.ChallengeResponses).toEqual(responses);
    expect(JSON.stringify(command.input.ChallengeResponses)).not.toContain(
      'client-secret',
    );
  });
});
