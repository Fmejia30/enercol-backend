export interface NewAuthChallenge {
  challengeIdHash: string;
  userId: string | null;
  challengeName: string;
  encryptedSession: string;
  expiresAt: Date;
}

export interface StoredAuthChallenge {
  challengeName: string;
  encryptedSession: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface NewAuthSession {
  sessionIdHash: string;
  userId: string;
  email: string | null;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  encryptedCsrfToken: string;
  accessTokenExpiresAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
  csrfTokenHash: string;
}

export interface StoredAuthSession extends NewAuthSession {
  id: string;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface ChallengePatch {
  encryptedSession?: string;
  consumedAt?: Date;
}

export interface SessionPatch {
  encryptedAccessToken?: string;
  encryptedRefreshToken?: string;
  accessTokenExpiresAt?: Date;
  lastActivityAt?: Date;
  revokedAt?: Date | null;
}

export interface AuthRepository {
  deleteExpiredChallenges(now: Date): Promise<void>;
  saveChallenge(challenge: NewAuthChallenge): Promise<void>;
  consumeChallenge(
    challengeIdHash: string,
    now: Date,
  ): Promise<StoredAuthChallenge | null>;
  withChallengeLock<T>(
    challengeIdHash: string,
    work: (
      challenge: StoredAuthChallenge | null,
      patch: (patch: ChallengePatch) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T>;
  saveSession(session: NewAuthSession): Promise<void>;
  revokeSession(sessionIdHash: string, revokedAt: Date): Promise<void>;
  withSessionLock<T>(
    sessionIdHash: string,
    work: (
      session: StoredAuthSession | null,
      persist: (patch: SessionPatch) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T>;
}

export const AUTH_REPOSITORY = Symbol('AUTH_REPOSITORY');
export const AUTH_CLOCK = Symbol('AUTH_CLOCK');
export type AuthClock = () => Date;
