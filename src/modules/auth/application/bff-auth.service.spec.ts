import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../../identity-access/domain/user-role.js';
import { SessionRejectedError } from '../../identity-access/application/session-authenticator.js';
import type { TokenVerifier } from '../../identity-access/application/token-verifier.js';
import {
  BffAuthService,
  CsrfRejectedError,
  LoginRejected,
  RateLimitedError,
} from './bff-auth.service.js';
import type {
  AuthRepository,
  NewAuthChallenge,
  NewAuthSession,
  SessionPatch,
  StoredAuthChallenge,
  StoredAuthSession,
} from './auth.repository.js';
import type {
  CognitoAuthOutcome,
  CognitoIdentityGateway,
} from './cognito-identity.js';
import type { IdTokenVerifier } from '../infrastructure/cognito-id-token.verifier.js';
import { TokenCipher } from '../infrastructure/token-cipher.js';
import { secretHash, sha256Hex } from '../domain/auth-crypto.js';
import { createHmac } from 'node:crypto';

const NOW = new Date('2026-11-08T12:00:00.000Z');
const KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
const CLIENT = { ip: '127.0.0.1', userAgent: 'jest' };

describe('secretHash', () => {
  it('is the base64 HMAC-SHA256 of username plus client id', () => {
    expect(secretHash('user@example.com', 'client-id', 'secret')).toBe(
      createHmac('sha256', 'secret')
        .update('user@example.comclient-id')
        .digest('base64'),
    );
  });
});

describe('BffAuthService', () => {
  const cipher = new TokenCipher({
    getOrThrow: () => KEY,
  } as unknown as ConfigService);

  function setup() {
    const repository = new MemoryAuthRepository();
    const identity: CognitoIdentityGateway = {
      initiatePasswordAuth: jest
        .fn<CognitoIdentityGateway['initiatePasswordAuth']>()
        .mockResolvedValue(tokens()),
      respondToChallenge: jest
        .fn<CognitoIdentityGateway['respondToChallenge']>()
        .mockResolvedValue(tokens()),
      associateSoftwareToken: jest
        .fn<CognitoIdentityGateway['associateSoftwareToken']>()
        .mockResolvedValue({
          secretCode: 'totp-secret',
          session: 'setup-session',
        }),
      verifySoftwareToken: jest
        .fn<CognitoIdentityGateway['verifySoftwareToken']>()
        .mockResolvedValue('verified-session'),
      refresh: jest.fn<CognitoIdentityGateway['refresh']>().mockResolvedValue({
        kind: 'tokens',
        tokens: {
          accessToken: 'renewed-access',
          refreshToken: 'rotated-refresh',
          expiresIn: 3600,
        },
      }),
      revoke: jest
        .fn<CognitoIdentityGateway['revoke']>()
        .mockResolvedValue(undefined),
    };
    const accessTokens: TokenVerifier = {
      verify: jest.fn<TokenVerifier['verify']>().mockResolvedValue({
        userId: 'user-1',
        roles: [UserRole.SPECIALIST],
      }),
    };
    const idTokens: IdTokenVerifier = {
      verify: async () => ({
        sub: 'user-1',
        email: 'usuario@empresa.com',
      }),
    };
    const service = new BffAuthService(
      config(),
      repository,
      identity,
      accessTokens,
      idTokens,
      cipher,
      () => NOW,
    );
    return { service, repository, identity, accessTokens };
  }

  it('stores a hashed session and never returns Cognito tokens', async () => {
    const { service, repository } = setup();

    const result = await service.login({
      email: ' usuario@empresa.com ',
      password: 'secret-password',
      client: CLIENT,
    });

    expect(result.kind).toBe('session');
    if (result.kind !== 'session') return;
    expect(result.user).toEqual({
      id: 'user-1',
      email: 'usuario@empresa.com',
      roles: [UserRole.SPECIALIST],
    });
    expect(JSON.stringify(result)).not.toContain('access-token');
    expect(JSON.stringify(result)).not.toContain('refresh-token');
    const stored = [...repository.sessions.values()][0];
    expect(stored?.sessionIdHash).toBe(sha256Hex(result.sessionId));
    expect(stored?.sessionIdHash).not.toBe(result.sessionId);
    expect(cipher.decrypt(stored?.encryptedAccessToken ?? '')).toBe(
      'access-token',
    );
    expect(stored?.encryptedAccessToken).not.toContain('access-token');
  });

  it('uses the same rejection for a wrong password and does not create a session', async () => {
    const { service, repository, identity } = setup();
    identity.initiatePasswordAuth = jest
      .fn<CognitoIdentityGateway['initiatePasswordAuth']>()
      .mockResolvedValue({ kind: 'rejected' });

    await expect(
      service.login({
        email: 'usuario@empresa.com',
        password: 'wrong',
        client: CLIENT,
      }),
    ).rejects.toBeInstanceOf(LoginRejected);
    expect(repository.sessions.size).toBe(0);
  });

  it('keeps the Cognito session server-side and answers only the stored challenge', async () => {
    const { service, repository, identity } = setup();
    identity.initiatePasswordAuth = jest
      .fn<CognitoIdentityGateway['initiatePasswordAuth']>()
      .mockResolvedValue({
        kind: 'challenge',
        challenge: {
          name: 'NEW_PASSWORD_REQUIRED',
          session: 'cognito-session',
          username: 'usuario@empresa.com',
          requiredAttributes: ['name'],
        },
      });

    const pending = await service.login({
      email: 'usuario@empresa.com',
      password: 'temporary',
      client: CLIENT,
    });
    expect(pending.kind).toBe('challenge');
    if (pending.kind !== 'challenge') return;
    expect(JSON.stringify(pending)).not.toContain('cognito-session');
    const stored = [...repository.challenges.values()][0];
    expect(cipher.decrypt(stored?.encryptedSession ?? '')).toContain(
      'cognito-session',
    );

    const completed = await service.challenge({
      challengeId: pending.challengeId,
      newPassword: 'new-secret',
      attributes: { name: 'Ada', email: 'other@example.com' },
      client: CLIENT,
    });
    expect(completed.kind).toBe('session');
    expect(identity.respondToChallenge).toHaveBeenCalledWith({
      challengeName: 'NEW_PASSWORD_REQUIRED',
      session: 'cognito-session',
      username: 'usuario@empresa.com',
      responses: { NEW_PASSWORD: 'new-secret', name: 'Ada' },
    });

    await expect(
      service.challenge({
        challengeId: pending.challengeId,
        newPassword: 'another',
        attributes: { name: 'Ada' },
        client: CLIENT,
      }),
    ).rejects.toBeInstanceOf(LoginRejected);
  });

  it('revokes the local session when Cognito revocation fails', async () => {
    const { service, repository, identity } = setup();
    const result = await service.login({
      email: 'usuario@empresa.com',
      password: 'secret-password',
      client: CLIENT,
    });
    if (result.kind !== 'session') throw new Error('expected session');
    identity.revoke = jest
      .fn<CognitoIdentityGateway['revoke']>()
      .mockRejectedValue(new Error('NotAuthorizedException'));

    await service.logout({
      sessionId: result.sessionId,
      csrfToken: result.csrfToken,
      client: CLIENT,
    });

    expect(
      repository.sessions.get(sha256Hex(result.sessionId))?.revokedAt,
    ).toEqual(NOW);
    await expect(service.authenticate(result.sessionId)).rejects.toBeInstanceOf(
      SessionRejectedError,
    );
  });

  it('rejects logout when the CSRF token does not match', async () => {
    const { service, identity } = setup();
    const result = await service.login({
      email: 'usuario@empresa.com',
      password: 'secret-password',
      client: CLIENT,
    });
    if (result.kind !== 'session') throw new Error('expected session');

    await expect(
      service.logout({
        sessionId: result.sessionId,
        csrfToken: 'wrong',
        client: CLIENT,
      }),
    ).rejects.toBeInstanceOf(CsrfRejectedError);
    expect(identity.revoke).not.toHaveBeenCalled();
  });

  it('rotates tokens inside the session lock and revokes the session if Cognito rejects the refresh token', async () => {
    const { service, repository, identity, accessTokens } = setup();
    const result = await service.login({
      email: 'usuario@empresa.com',
      password: 'secret-password',
      client: CLIENT,
    });
    if (result.kind !== 'session') throw new Error('expected session');
    const stored = repository.sessions.get(sha256Hex(result.sessionId));
    if (!stored) throw new Error('missing session');
    stored.accessTokenExpiresAt = new Date(NOW.getTime() - 1000);

    await service.authenticate(result.sessionId);
    expect(cipher.decrypt(stored.encryptedAccessToken)).toBe('renewed-access');
    expect(cipher.decrypt(stored.encryptedRefreshToken)).toBe(
      'rotated-refresh',
    );

    stored.accessTokenExpiresAt = new Date(NOW.getTime() - 1000);
    identity.refresh = jest
      .fn<CognitoIdentityGateway['refresh']>()
      .mockResolvedValue({
        kind: 'rejected',
      });
    await expect(service.authenticate(result.sessionId)).rejects.toBeInstanceOf(
      SessionRejectedError,
    );
    expect(stored.revokedAt).toEqual(NOW);
    expect(accessTokens.verify).toHaveBeenCalled();
  });

  it('refreshes within five minutes and keeps the same session and absolute expiry', async () => {
    const { service, repository, identity } = setup();
    const result = await service.login({
      email: 'usuario@empresa.com',
      password: 'secret-password',
      client: CLIENT,
    });
    if (result.kind !== 'session') throw new Error('expected session');
    const stored = repository.sessions.get(sha256Hex(result.sessionId));
    if (!stored) throw new Error('missing session');
    const sessionHash = stored.sessionIdHash;
    const absoluteExpiry = stored.expiresAt;
    stored.accessTokenExpiresAt = new Date(NOW.getTime() + 5 * 60 * 1000);

    await expect(service.authenticate(result.sessionId)).resolves.toMatchObject(
      { userId: 'user-1' },
    );
    expect(identity.refresh).toHaveBeenCalledTimes(1);
    expect(stored.sessionIdHash).toBe(sessionHash);
    expect(stored.expiresAt).toEqual(absoluteExpiry);
    expect(stored.revokedAt).toBeNull();
    expect(cipher.decrypt(stored.encryptedRefreshToken)).toBe(
      'rotated-refresh',
    );

    identity.refresh.mockClear();
    stored.accessTokenExpiresAt = new Date(NOW.getTime() + 5 * 60 * 1000 + 1);
    await service.authenticate(result.sessionId);
    expect(identity.refresh).not.toHaveBeenCalled();
  });

  it('lets a second request reuse the rotated tokens instead of refreshing again', async () => {
    const { service, repository, identity } = setup();
    const result = await service.login({
      email: 'usuario@empresa.com',
      password: 'secret-password',
      client: CLIENT,
    });
    if (result.kind !== 'session') throw new Error('expected session');
    const stored = repository.sessions.get(sha256Hex(result.sessionId));
    if (!stored) throw new Error('missing session');
    stored.accessTokenExpiresAt = new Date(NOW.getTime() + 60_000);

    let releaseRefresh: () => void = () => undefined;
    const refreshStarted = new Promise<void>((resolve) => {
      identity.refresh = jest
        .fn<CognitoIdentityGateway['refresh']>()
        .mockImplementation(async () => {
          resolve();
          await new Promise<void>((release) => {
            releaseRefresh = release;
          });
          return {
            kind: 'tokens',
            tokens: {
              accessToken: 'renewed-access',
              refreshToken: 'rotated-refresh',
              expiresIn: 3600,
            },
          };
        });
    });

    const first = service.authenticate(result.sessionId);
    await refreshStarted;
    const second = service.authenticate(result.sessionId);
    releaseRefresh();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { userId: 'user-1', roles: [UserRole.SPECIALIST] },
      { userId: 'user-1', roles: [UserRole.SPECIALIST] },
    ]);
    expect(identity.refresh).toHaveBeenCalledTimes(1);
    expect(stored.sessionIdHash).toBe(sha256Hex(result.sessionId));
  });

  it('keeps the session when Cognito is unavailable during refresh', async () => {
    const { service, repository, identity } = setup();
    const result = await service.login({
      email: 'usuario@empresa.com',
      password: 'secret-password',
      client: CLIENT,
    });
    if (result.kind !== 'session') throw new Error('expected session');
    const stored = repository.sessions.get(sha256Hex(result.sessionId));
    if (!stored) throw new Error('missing session');
    stored.accessTokenExpiresAt = new Date(NOW.getTime() - 1000);
    identity.refresh = jest
      .fn<CognitoIdentityGateway['refresh']>()
      .mockResolvedValue({
        kind: 'unavailable',
      });

    await expect(service.readSession(result.sessionId)).resolves.toEqual({
      authenticated: false,
    });
    expect(stored.revokedAt).toBeNull();
  });

  it('does not extend an absolutely expired session by refreshing tokens', async () => {
    const { service, repository, identity } = setup();
    const result = await service.login({
      email: 'usuario@empresa.com',
      password: 'secret-password',
      client: CLIENT,
    });
    if (result.kind !== 'session') throw new Error('expected session');
    const stored = repository.sessions.get(sha256Hex(result.sessionId));
    if (!stored) throw new Error('missing session');
    stored.expiresAt = new Date(NOW.getTime() - 1000);

    await expect(service.readSession(result.sessionId)).resolves.toEqual({
      authenticated: false,
    });
    expect(identity.refresh).not.toHaveBeenCalled();
  });

  it('limits repeated login attempts for the same address', async () => {
    const { service } = setup();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await service.login({
        email: `user-${attempt}@empresa.com`,
        password: 'secret-password',
        client: CLIENT,
      });
    }
    await expect(
      service.login({
        email: 'otro@empresa.com',
        password: 'secret-password',
        client: CLIENT,
      }),
    ).rejects.toBeInstanceOf(RateLimitedError);
  });
});

function tokens(): CognitoAuthOutcome {
  return {
    kind: 'tokens',
    tokens: {
      accessToken: 'access-token',
      idToken: 'id-token',
      refreshToken: 'refresh-token',
      expiresIn: 3600,
    },
  };
}

function config(): ConfigService {
  return {
    getOrThrow: (key: string) =>
      ({
        sessionAbsoluteTtlSeconds: 28_800,
        sessionIdleTtlSeconds: 1_800,
      })[key],
  } as unknown as ConfigService;
}

class MemoryAuthRepository implements AuthRepository {
  readonly challenges = new Map<
    string,
    NewAuthChallenge & { consumedAt: Date | null }
  >();
  readonly sessions = new Map<string, StoredAuthSession>();
  private readonly locks = new Map<string, Promise<void>>();

  async deleteExpiredChallenges(now: Date): Promise<void> {
    for (const [hash, challenge] of this.challenges) {
      if (challenge.expiresAt < now) this.challenges.delete(hash);
    }
  }

  async saveChallenge(challenge: NewAuthChallenge): Promise<void> {
    this.challenges.set(challenge.challengeIdHash, {
      ...challenge,
      consumedAt: null,
    });
  }

  async consumeChallenge(
    challengeIdHash: string,
    now: Date,
  ): Promise<StoredAuthChallenge | null> {
    const challenge = this.challenges.get(challengeIdHash);
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= now) {
      return null;
    }
    challenge.consumedAt = now;
    return challenge;
  }

  async saveSession(session: NewAuthSession): Promise<void> {
    this.sessions.set(session.sessionIdHash, {
      ...session,
      id: 'session-row',
      revokedAt: null,
      createdAt: NOW,
    });
  }

  async revokeSession(sessionIdHash: string, revokedAt: Date): Promise<void> {
    const session = this.sessions.get(sessionIdHash);
    if (session && !session.revokedAt) session.revokedAt = revokedAt;
  }

  async withSessionLock<T>(
    sessionIdHash: string,
    work: (
      session: StoredAuthSession | null,
      persist: (patch: SessionPatch) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> {
    const previous = this.locks.get(sessionIdHash) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(
      sessionIdHash,
      previous.then(() => current),
    );
    await previous;
    try {
      const session = this.sessions.get(sessionIdHash) ?? null;
      return await work(session, async (patch) => {
        if (session) Object.assign(session, patch);
      });
    } finally {
      release();
    }
  }
}
