import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import type { UserRole } from '../../identity-access/domain/user-role.js';
import { SessionRejectedError } from '../../identity-access/application/session-authenticator.js';
import {
  TOKEN_VERIFIER,
  type TokenVerifier,
} from '../../identity-access/application/token-verifier.js';
import {
  formatSecurityEvent,
  type SecurityEventName,
} from '../../../shared/observability/security-event.js';
import {
  ACCESS_TOKEN_REFRESH_SKEW_MS,
  ATTEMPT_LIMIT,
  ATTEMPT_WINDOW_MS,
  AUTH_CHALLENGE_TTL_MS,
  MAX_CHALLENGE_PASSWORD_ATTEMPTS,
  randomToken,
  safeEqual,
  SESSION_ACTIVITY_TOUCH_MS,
  sha256Hex,
} from '../domain/auth-crypto.js';
import {
  isSupportedChallenge,
  type ChallengeEnvelope,
  type SupportedChallenge,
} from '../domain/auth-challenge.js';
import {
  AUTH_CLOCK,
  AUTH_REPOSITORY,
  type AuthClock,
  type AuthRepository,
  type ChallengePatch,
  type StoredAuthChallenge,
  type StoredAuthSession,
} from './auth.repository.js';
import {
  COGNITO_IDENTITY,
  type CognitoAuthOutcome,
  type CognitoIdentityGateway,
  type CognitoTokenSet,
} from './cognito-identity.js';
import {
  ID_TOKEN_VERIFIER,
  type IdTokenVerifier,
} from '../infrastructure/cognito-id-token.verifier.js';
import {
  TokenCipher,
  TokenCipherError,
} from '../infrastructure/token-cipher.js';

export class CsrfRejectedError extends Error {
  constructor() {
    super('CSRF rejected');
    this.name = 'CsrfRejectedError';
  }
}

export class RateLimitedError extends Error {
  constructor() {
    super('Rate limited');
    this.name = 'RateLimitedError';
  }
}

export class AuthUnavailableError extends Error {
  constructor() {
    super('Authentication provider unavailable');
    this.name = 'AuthUnavailableError';
  }
}

export class InvalidPasswordError extends Error {
  constructor() {
    super('Password does not meet policy');
    this.name = 'InvalidPasswordError';
  }
}

export class InvalidChallengeRequestError extends Error {
  constructor() {
    super('Challenge request is invalid');
    this.name = 'InvalidChallengeRequestError';
  }
}

export class ChallengeExpiredError extends Error {
  constructor() {
    super('Challenge expired');
    this.name = 'ChallengeExpiredError';
  }
}

export interface ClientContext {
  ip?: string;
  userAgent?: string;
}

export interface AuthenticatedSession {
  kind: 'session';
  sessionId: string;
  csrfToken: string;
  user: SessionUser;
}

export interface PendingChallenge {
  kind: 'challenge';
  challengeId: string;
  challengeName: SupportedChallenge;
  requiredAttributes: string[];
  secretCode?: string;
}

export type AuthContinuation = AuthenticatedSession | PendingChallenge;

export interface SessionUser {
  id: string;
  email: string | null;
  roles: UserRole[];
}

export type SessionView =
  | { authenticated: true; csrfToken: string; user: SessionUser }
  | { authenticated: false };

interface ActiveSession {
  user: AuthenticatedUser;
  email: string | null;
  csrfToken: string;
}

const CHALLENGE_RESPONSE_KEY: Record<
  Exclude<SupportedChallenge, 'MFA_SETUP' | 'NEW_PASSWORD_REQUIRED'>,
  string
> = {
  SMS_MFA: 'SMS_MFA_CODE',
  SOFTWARE_TOKEN_MFA: 'SOFTWARE_TOKEN_MFA_CODE',
  EMAIL_OTP: 'EMAIL_OTP_CODE',
};

@Injectable()
export class BffAuthService {
  private readonly logger = new Logger(BffAuthService.name);
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly configService: ConfigService,
    @Inject(AUTH_REPOSITORY)
    private readonly repository: AuthRepository,
    @Inject(COGNITO_IDENTITY)
    private readonly identity: CognitoIdentityGateway,
    @Inject(TOKEN_VERIFIER)
    private readonly accessTokens: TokenVerifier,
    @Inject(ID_TOKEN_VERIFIER)
    private readonly idTokens: IdTokenVerifier,
    private readonly cipher: TokenCipher,
    @Inject(AUTH_CLOCK)
    private readonly clock: AuthClock,
  ) {}

  async login(input: {
    email: string;
    password: string;
    previousSessionId?: string;
    client: ClientContext;
  }): Promise<AuthContinuation> {
    const email = input.email.trim();
    this.consumeAttempt(
      `login:ip:${input.client.ip ?? 'unknown'}`,
      input.client,
    );
    this.consumeAttempt(`login:account:${sha256Hex(email)}`, input.client);
    const outcome = await this.identity.initiatePasswordAuth({
      email,
      password: input.password,
    });
    return this.continueAuthentication(
      outcome,
      input.previousSessionId,
      input.client,
      false,
    );
  }

  async challenge(input: {
    challengeId: string;
    code?: string;
    newPassword?: string;
    attributes?: Record<string, string>;
    previousSessionId?: string;
    client: ClientContext;
  }): Promise<AuthContinuation> {
    this.consumeAttempt(
      `challenge:ip:${input.client.ip ?? 'unknown'}`,
      input.client,
    );
    const decision = await this.repository.withChallengeLock(
      sha256Hex(input.challengeId),
      async (stored, patch) => this.decideChallenge(stored, patch, input),
    );
    return this.settleChallenge(decision, input);
  }

  async logout(input: {
    sessionId?: string;
    csrfToken?: string;
    client: ClientContext;
  }): Promise<void> {
    if (!input.sessionId) {
      return;
    }

    const now = this.clock();
    const outcome = await this.repository.withSessionLock(
      sha256Hex(input.sessionId),
      async (session, persist) => {
        if (!session) {
          return { kind: 'missing' as const };
        }
        if (
          !input.csrfToken ||
          !safeEqual(sha256Hex(input.csrfToken), session.csrfTokenHash)
        ) {
          throw new CsrfRejectedError();
        }
        if (!session.revokedAt) {
          await persist({ revokedAt: now });
        }
        return {
          kind: 'revoked' as const,
          userId: session.userId,
          refreshToken: this.readSecret(session.encryptedRefreshToken),
        };
      },
    );

    if (outcome.kind === 'revoked' && outcome.refreshToken) {
      try {
        await this.identity.revoke(outcome.refreshToken);
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        this.logger.warn(
          /^[A-Za-z]+Exception$/.test(name)
            ? `La revocación remota no se completó: ${name}`
            : 'La revocación remota no se completó',
        );
      }
    }

    if (outcome.kind === 'revoked') {
      this.audit('LOGOUT', 'success', input.client, outcome.userId);
    }
  }

  async readSession(sessionId: string | undefined): Promise<SessionView> {
    if (!sessionId) {
      return { authenticated: false };
    }
    try {
      const active = await this.loadActive(sessionId);
      return {
        authenticated: true,
        csrfToken: active.csrfToken,
        user: {
          id: active.user.userId,
          email: active.email,
          roles: [...active.user.roles],
        },
      };
    } catch (error) {
      if (error instanceof SessionRejectedError) {
        return { authenticated: false };
      }
      throw error;
    }
  }

  async authenticate(sessionId: string): Promise<AuthenticatedUser> {
    const active = await this.loadActive(sessionId);
    return { ...active.user, email: active.email };
  }

  private async answerChallenge(
    name: SupportedChallenge,
    envelope: ChallengeEnvelope,
    input: {
      code?: string;
      newPassword?: string;
      attributes?: Record<string, string>;
      client: ClientContext;
    },
  ): Promise<CognitoAuthOutcome> {
    if (name === 'MFA_SETUP') {
      if (!input.code) {
        this.failChallenge(input.client, 'response');
      }
      const session = await this.identity.verifySoftwareToken({
        session: envelope.session,
        code: input.code,
      });
      if (!session) {
        this.failChallenge(input.client, 'response');
      }
      return this.identity.respondToChallenge({
        challengeName: name,
        session,
        username: envelope.username,
        responses: {},
      });
    }

    if (name === 'NEW_PASSWORD_REQUIRED') {
      this.failChallenge(input.client, 'response');
    }
    if (!input.code) {
      this.failChallenge(input.client, 'response');
    }
    return this.identity.respondToChallenge({
      challengeName: name,
      session: envelope.session,
      username: envelope.username,
      responses: { [CHALLENGE_RESPONSE_KEY[name]]: input.code },
    });
  }

  private async continueAuthentication(
    outcome: CognitoAuthOutcome,
    previousSessionId: string | undefined,
    client: ClientContext,
    fromChallenge: boolean,
  ): Promise<AuthContinuation> {
    if (outcome.kind === 'throttled') {
      this.audit('LOGIN_FAILED', 'failure', client, undefined, 'rate_limited');
      throw new RateLimitedError();
    }
    if (outcome.kind === 'unavailable') {
      this.audit(
        fromChallenge ? 'AUTH_CHALLENGE_FAILED' : 'LOGIN_FAILED',
        'failure',
        client,
        undefined,
        'unavailable',
      );
      throw new AuthUnavailableError();
    }
    if (outcome.kind === 'rejected') {
      this.audit(
        fromChallenge ? 'AUTH_CHALLENGE_FAILED' : 'LOGIN_FAILED',
        'failure',
        client,
        undefined,
        'rejected',
      );
      throw new LoginRejected('rejected');
    }
    if (outcome.kind === 'challenge') {
      return this.storeChallenge(outcome.challenge, client);
    }
    if (outcome.kind !== 'tokens') {
      this.audit(
        fromChallenge ? 'AUTH_CHALLENGE_FAILED' : 'LOGIN_FAILED',
        'failure',
        client,
        undefined,
        'rejected',
      );
      throw new LoginRejected('rejected');
    }

    const session = await this.openSession(
      outcome.tokens,
      previousSessionId,
      client,
    );
    if (fromChallenge) {
      this.audit(
        'AUTH_CHALLENGE_SUCCEEDED',
        'success',
        client,
        session.user.id,
      );
    }
    return session;
  }

  private async storeChallenge(
    challenge: {
      name: SupportedChallenge;
      session: string;
      username: string;
      requiredAttributes: string[];
    },
    client: ClientContext,
  ): Promise<PendingChallenge> {
    let session = challenge.session;
    let secretCode: string | undefined;
    if (challenge.name === 'MFA_SETUP') {
      const associated = await this.identity.associateSoftwareToken(session);
      if (!associated) {
        this.failChallenge(client, 'unsupported');
      }
      session = associated.session;
      secretCode = associated.secretCode;
    }

    const challengeId = randomToken();
    const now = this.clock();
    await this.repository.deleteExpiredChallenges(now);
    await this.repository.saveChallenge({
      challengeIdHash: sha256Hex(challengeId),
      userId: challenge.username.slice(0, 128),
      challengeName: challenge.name,
      encryptedSession: this.cipher.encrypt(
        JSON.stringify({
          session,
          username: challenge.username,
          requiredAttributes: challenge.requiredAttributes,
        } satisfies ChallengeEnvelope),
      ),
      expiresAt: new Date(now.getTime() + AUTH_CHALLENGE_TTL_MS),
    });
    this.audit(
      'AUTH_CHALLENGE_REQUIRED',
      'success',
      client,
      undefined,
      challenge.name,
    );
    return {
      kind: 'challenge',
      challengeId,
      challengeName: challenge.name,
      requiredAttributes: challenge.requiredAttributes,
      ...(secretCode ? { secretCode } : {}),
    };
  }

  private async openSession(
    tokens: CognitoTokenSet,
    previousSessionId: string | undefined,
    client: ClientContext,
  ): Promise<AuthenticatedSession> {
    let user: AuthenticatedUser;
    let email: string | null;
    try {
      user = await this.accessTokens.verify(tokens.accessToken);
      const idToken = await this.idTokens.verify(tokens.idToken);
      if (idToken.sub !== user.userId) {
        throw new LoginRejected('subject');
      }
      email = idToken.email;
    } catch (error) {
      if (error instanceof LoginRejected) {
        this.audit('LOGIN_FAILED', 'failure', client, undefined, error.reason);
        throw error;
      }
      this.audit('LOGIN_FAILED', 'failure', client, undefined, 'token');
      throw new LoginRejected('token');
    }

    const now = this.clock();
    const sessionId = randomToken();
    const csrfToken = randomToken();
    await this.repository.saveSession({
      sessionIdHash: sha256Hex(sessionId),
      userId: user.userId,
      email,
      encryptedAccessToken: this.cipher.encrypt(tokens.accessToken),
      encryptedRefreshToken: this.cipher.encrypt(tokens.refreshToken),
      encryptedCsrfToken: this.cipher.encrypt(csrfToken),
      csrfTokenHash: sha256Hex(csrfToken),
      accessTokenExpiresAt: new Date(now.getTime() + tokens.expiresIn * 1000),
      expiresAt: new Date(now.getTime() + this.absoluteTtlMs()),
      lastActivityAt: now,
    });
    if (previousSessionId) {
      await this.repository
        .revokeSession(sha256Hex(previousSessionId), now)
        .catch(() => undefined);
    }
    this.audit('LOGIN_SUCCEEDED', 'success', client, user.userId);
    return {
      kind: 'session',
      sessionId,
      csrfToken,
      user: { id: user.userId, email, roles: [...user.roles] },
    };
  }

  private async loadActive(sessionId: string): Promise<ActiveSession> {
    const now = this.clock();
    const outcome = await this.repository.withSessionLock(
      sha256Hex(sessionId),
      async (session, persist) => {
        const state = this.sessionState(session, now);
        if (state === 'expired') {
          this.audit('SESSION_EXPIRED', 'failure', {}, session?.userId);
          return { kind: 'invalid' as const };
        }
        if (state !== 'active' || !session) {
          return { kind: 'invalid' as const };
        }

        let accessToken: string;
        let refreshToken: string;
        try {
          accessToken = this.cipher.decrypt(session.encryptedAccessToken);
          refreshToken = this.cipher.decrypt(session.encryptedRefreshToken);
        } catch (error) {
          if (error instanceof TokenCipherError) {
            return { kind: 'invalid' as const };
          }
          throw error;
        }

        let accessTokenExpiresAt = session.accessTokenExpiresAt;
        let rotated = false;
        if (
          accessTokenExpiresAt.getTime() <=
          now.getTime() + ACCESS_TOKEN_REFRESH_SKEW_MS
        ) {
          const renewed = await this.identity.refresh(refreshToken);
          if (renewed.kind === 'unavailable') {
            this.audit(
              'TOKEN_REFRESH_FAILED',
              'failure',
              {},
              session.userId,
              'unavailable',
            );
            return { kind: 'invalid' as const };
          }
          if (renewed.kind !== 'tokens' || !renewed.tokens.refreshToken) {
            await persist({ revokedAt: now });
            this.audit(
              'TOKEN_REFRESH_FAILED',
              'failure',
              {},
              session.userId,
              'rejected',
            );
            return { kind: 'invalid' as const };
          }
          accessToken = renewed.tokens.accessToken;
          refreshToken = renewed.tokens.refreshToken;
          accessTokenExpiresAt = new Date(
            now.getTime() + renewed.tokens.expiresIn * 1000,
          );
          rotated = true;
        }

        let user: AuthenticatedUser;
        try {
          user = await this.accessTokens.verify(accessToken);
        } catch {
          if (rotated) {
            await persist({ revokedAt: now });
            this.audit(
              'TOKEN_REFRESH_FAILED',
              'failure',
              {},
              session.userId,
              'token',
            );
          }
          return { kind: 'invalid' as const };
        }

        const activityIsStale =
          now.getTime() - session.lastActivityAt.getTime() >=
          SESSION_ACTIVITY_TOUCH_MS;
        if (rotated || activityIsStale) {
          await persist({
            encryptedAccessToken: this.cipher.encrypt(accessToken),
            encryptedRefreshToken: this.cipher.encrypt(refreshToken),
            accessTokenExpiresAt,
            lastActivityAt: now,
          });
        }
        if (rotated) {
          this.audit('TOKEN_REFRESH_SUCCEEDED', 'success', {}, user.userId);
        }

        let csrfToken: string;
        try {
          csrfToken = this.cipher.decrypt(session.encryptedCsrfToken);
        } catch (error) {
          if (error instanceof TokenCipherError) {
            return { kind: 'invalid' as const };
          }
          throw error;
        }

        return {
          kind: 'active' as const,
          session: { user, email: session.email, csrfToken },
        };
      },
    );

    if (outcome.kind !== 'active') {
      throw new SessionRejectedError();
    }
    return outcome.session;
  }

  private sessionState(
    session: StoredAuthSession | null,
    now: Date,
  ): 'active' | 'expired' | 'invalid' {
    if (!session || session.revokedAt) {
      return 'invalid';
    }
    if (session.expiresAt <= now) {
      return 'expired';
    }
    if (session.lastActivityAt.getTime() + this.idleTtlMs() <= now.getTime()) {
      return 'expired';
    }
    return 'active';
  }

  private async decideChallenge(
    stored: StoredAuthChallenge | null,
    patch: (patch: ChallengePatch) => Promise<void>,
    input: {
      code?: string;
      newPassword?: string;
      attributes?: Record<string, string>;
      previousSessionId?: string;
      client: ClientContext;
    },
  ): Promise<ChallengeDecision> {
    const now = this.clock();
    if (
      !stored ||
      stored.consumedAt ||
      stored.expiresAt <= now ||
      !isSupportedChallenge(stored.challengeName)
    ) {
      return { kind: 'expired' };
    }
    const envelope = this.readEnvelope(stored.encryptedSession);
    if (!envelope) {
      await patch({ consumedAt: now });
      return { kind: 'expired' };
    }
    if (stored.challengeName !== 'NEW_PASSWORD_REQUIRED') {
      await patch({ consumedAt: now });
      try {
        return {
          kind: 'continue',
          outcome: await this.answerChallenge(
            stored.challengeName,
            envelope,
            input,
          ),
        };
      } catch (error) {
        if (error instanceof LoginRejected) {
          return { kind: 'rejected' };
        }
        throw error;
      }
    }
    return this.decideNewPassword(envelope, patch, input, now);
  }

  private async decideNewPassword(
    envelope: ChallengeEnvelope,
    patch: (patch: ChallengePatch) => Promise<void>,
    input: {
      newPassword?: string;
      attributes?: Record<string, string>;
      client: ClientContext;
    },
    now: Date,
  ): Promise<ChallengeDecision> {
    const attempts = envelope.attempts ?? 0;
    if (attempts >= MAX_CHALLENGE_PASSWORD_ATTEMPTS) {
      await patch({ consumedAt: now });
      return { kind: 'expired' };
    }
    if (!input.newPassword) {
      return { kind: 'invalid_parameter' };
    }
    const responses = newPasswordResponses(
      envelope.requiredAttributes,
      input.newPassword,
      input.attributes,
    );
    if (!responses) {
      return this.keepPasswordAttempt(envelope, patch, attempts, now, {
        kind: 'invalid_parameter',
      });
    }
    const outcome = await this.identity.respondToChallenge({
      challengeName: 'NEW_PASSWORD_REQUIRED',
      session: envelope.session,
      username: envelope.username,
      responses,
    });
    if (
      outcome.kind === 'invalid_password' ||
      outcome.kind === 'invalid_parameter'
    ) {
      return this.keepPasswordAttempt(envelope, patch, attempts, now, {
        kind: outcome.kind,
      });
    }
    if (
      outcome.kind === 'unavailable' ||
      outcome.kind === 'throttled'
    ) {
      return { kind: outcome.kind };
    }
    await patch({ consumedAt: now });
    if (outcome.kind === 'tokens' || outcome.kind === 'challenge') {
      return { kind: 'continue', outcome };
    }
    return { kind: 'expired' };
  }

  private async keepPasswordAttempt(
    envelope: ChallengeEnvelope,
    patch: (patch: ChallengePatch) => Promise<void>,
    attempts: number,
    now: Date,
    decision: ChallengeDecision,
  ): Promise<ChallengeDecision> {
    const nextAttempts = attempts + 1;
    await patch({
      encryptedSession: this.cipher.encrypt(
        JSON.stringify({
          session: envelope.session,
          username: envelope.username,
          requiredAttributes: envelope.requiredAttributes,
          attempts: nextAttempts,
        } satisfies ChallengeEnvelope),
      ),
      ...(nextAttempts >= MAX_CHALLENGE_PASSWORD_ATTEMPTS
        ? { consumedAt: now }
        : {}),
    });
    return decision;
  }

  private async settleChallenge(
    decision: ChallengeDecision,
    input: {
      previousSessionId?: string;
      client: ClientContext;
    },
  ): Promise<AuthContinuation> {
    if (decision.kind === 'continue') {
      return this.continueAuthentication(
        decision.outcome,
        input.previousSessionId,
        input.client,
        true,
      );
    }
    if (decision.kind === 'invalid_password') {
      this.audit(
        'AUTH_CHALLENGE_FAILED',
        'failure',
        input.client,
        undefined,
        'password_policy',
      );
      throw new InvalidPasswordError();
    }
    if (decision.kind === 'invalid_parameter') {
      this.audit(
        'AUTH_CHALLENGE_FAILED',
        'failure',
        input.client,
        undefined,
        'parameter',
      );
      throw new InvalidChallengeRequestError();
    }
    if (decision.kind === 'unavailable') {
      this.audit(
        'AUTH_CHALLENGE_FAILED',
        'failure',
        input.client,
        undefined,
        'unavailable',
      );
      throw new AuthUnavailableError();
    }
    if (decision.kind === 'throttled') {
      this.audit(
        'AUTH_CHALLENGE_FAILED',
        'failure',
        input.client,
        undefined,
        'rate_limited',
      );
      throw new RateLimitedError();
    }
    if (decision.kind === 'rejected') {
      this.audit(
        'AUTH_CHALLENGE_FAILED',
        'failure',
        input.client,
        undefined,
        'rejected',
      );
      throw new LoginRejected('rejected');
    }
    this.audit(
      'AUTH_CHALLENGE_FAILED',
      'failure',
      input.client,
      undefined,
      'expired',
    );
    throw new ChallengeExpiredError();
  }

  private readEnvelope(payload: string): ChallengeEnvelope | null {
    try {
      const parsed = JSON.parse(
        this.cipher.decrypt(payload),
      ) as Partial<ChallengeEnvelope>;
      const attempts = parsed.attempts ?? 0;
      if (
        typeof parsed.session !== 'string' ||
        typeof parsed.username !== 'string' ||
        !Array.isArray(parsed.requiredAttributes) ||
        parsed.requiredAttributes.some(
          (attribute) => typeof attribute !== 'string',
        ) ||
        !Number.isInteger(attempts) ||
        attempts < 0 ||
        attempts > MAX_CHALLENGE_PASSWORD_ATTEMPTS
      ) {
        return null;
      }
      return {
        session: parsed.session,
        username: parsed.username,
        requiredAttributes: parsed.requiredAttributes,
        attempts,
      };
    } catch {
      return null;
    }
  }

  private consumeAttempt(key: string, client: ClientContext): void {
    const now = this.clock().getTime();
    const recent = (this.attempts.get(key) ?? []).filter(
      (at) => now - at < ATTEMPT_WINDOW_MS,
    );
    if (recent.length >= ATTEMPT_LIMIT) {
      this.attempts.set(key, recent);
      this.audit('LOGIN_FAILED', 'failure', client, undefined, 'rate_limited');
      throw new RateLimitedError();
    }
    recent.push(now);
    this.attempts.set(key, recent);
  }

  private readSecret(payload: string): string | undefined {
    try {
      return this.cipher.decrypt(payload);
    } catch {
      return undefined;
    }
  }

  private absoluteTtlMs(): number {
    return (
      this.configService.getOrThrow<number>('sessionAbsoluteTtlSeconds') * 1000
    );
  }

  private idleTtlMs(): number {
    return (
      this.configService.getOrThrow<number>('sessionIdleTtlSeconds') * 1000
    );
  }

  private failChallenge(client: ClientContext, reason: string): never {
    this.audit('AUTH_CHALLENGE_FAILED', 'failure', client, undefined, reason);
    throw new LoginRejected(reason);
  }

  private audit(
    event: SecurityEventName,
    result: 'success' | 'failure',
    client: ClientContext,
    userId?: string,
    reason?: string,
  ): void {
    this.logger.log(
      formatSecurityEvent({
        event,
        result,
        userId,
        ip: client.ip,
        userAgent: client.userAgent,
        reason,
      }),
    );
  }
}

type ChallengeDecision =
  | { kind: 'continue'; outcome: CognitoAuthOutcome }
  | { kind: 'invalid_password' }
  | { kind: 'invalid_parameter' }
  | { kind: 'expired' }
  | { kind: 'unavailable' }
  | { kind: 'throttled' }
  | { kind: 'rejected' };

function newPasswordResponses(
  required: readonly string[],
  newPassword: string,
  provided: Record<string, string> | undefined,
): Record<string, string> | null {
  const responses: Record<string, string> = { NEW_PASSWORD: newPassword };
  for (const name of required) {
    const key = cognitoUserAttributeKey(name);
    if (!key) {
      return null;
    }
    const bare = key.slice('userAttributes.'.length);
    const value = attributeValue(
      bare,
      provided?.[name] ?? provided?.[key] ?? provided?.[bare],
    );
    if (!value) {
      return null;
    }
    responses[key] = value;
  }
  return responses;
}

function cognitoUserAttributeKey(name: string): string | null {
  const bare = name.startsWith('userAttributes.')
    ? name.slice('userAttributes.'.length)
    : name;
  if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(bare)) {
    return null;
  }
  return `userAttributes.${bare}`;
}

function attributeValue(name: string, value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (
    trimmed.length < 1 ||
    trimmed.length > 2048 ||
    /[\u0000-\u001f\u007f]/.test(trimmed)
  ) {
    return null;
  }
  if (name === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return null;
  }
  if (name === 'phone_number' && !/^\+[1-9]\d{6,14}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

class LoginRejected extends Error {
  constructor(readonly reason: string) {
    super('Login rejected');
    this.name = 'LoginRejected';
  }
}

export { LoginRejected };
