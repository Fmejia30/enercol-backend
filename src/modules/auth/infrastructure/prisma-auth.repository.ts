import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import type {
  AuthRepository,
  ChallengePatch,
  NewAuthChallenge,
  NewAuthSession,
  SessionPatch,
  StoredAuthChallenge,
  StoredAuthSession,
} from '../application/auth.repository.js';

@Injectable()
export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async deleteExpiredChallenges(now: Date): Promise<void> {
    await this.prisma.authChallenge.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null } }],
      },
    });
  }

  async saveChallenge(challenge: NewAuthChallenge): Promise<void> {
    await this.prisma.authChallenge.create({ data: challenge });
  }

  async consumeChallenge(
    challengeIdHash: string,
    now: Date,
  ): Promise<StoredAuthChallenge | null> {
    const consumed = await this.prisma.authChallenge.updateMany({
      where: { challengeIdHash, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) {
      return null;
    }

    const row = await this.prisma.authChallenge.findUnique({
      where: { challengeIdHash },
    });
    if (!row) {
      return null;
    }
    return {
      challengeName: row.challengeName,
      encryptedSession: row.encryptedSession,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
    };
  }

  async withChallengeLock<T>(
    challengeIdHash: string,
    work: (
      challenge: StoredAuthChallenge | null,
      patch: (patch: ChallengePatch) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM auth_challenge
          WHERE challenge_id_hash = ${challengeIdHash}
          FOR UPDATE
        `;
        const row = await tx.authChallenge.findUnique({
          where: { challengeIdHash },
        });
        const challenge = row
          ? {
              challengeName: row.challengeName,
              encryptedSession: row.encryptedSession,
              expiresAt: row.expiresAt,
              consumedAt: row.consumedAt,
            }
          : null;
        return work(challenge, async (patch) => {
          if (!row) {
            return;
          }
          await tx.authChallenge.update({
            where: { challengeIdHash },
            data: {
              ...(patch.encryptedSession
                ? { encryptedSession: patch.encryptedSession }
                : {}),
              ...(patch.consumedAt ? { consumedAt: patch.consumedAt } : {}),
            },
          });
        });
      },
      { timeout: 15_000, maxWait: 5_000 },
    );
  }

  async saveSession(session: NewAuthSession): Promise<void> {
    await this.prisma.authSession.create({ data: session });
  }

  async revokeSession(sessionIdHash: string, revokedAt: Date): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { sessionIdHash, revokedAt: null },
      data: { revokedAt },
    });
  }

  async withSessionLock<T>(
    sessionIdHash: string,
    work: (
      session: StoredAuthSession | null,
      persist: (patch: SessionPatch) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM auth_session
          WHERE session_id_hash = ${sessionIdHash}
          FOR UPDATE
        `;
        const row = await tx.authSession.findUnique({
          where: { sessionIdHash },
        });
        return work(row ? mapSession(row) : null, async (patch) => {
          if (!row) {
            return;
          }
          await tx.authSession.update({
            where: { sessionIdHash },
            data: patch,
          });
        });
      },
      { timeout: 15_000, maxWait: 5_000 },
    );
  }
}

function mapSession(row: {
  id: string;
  sessionIdHash: string;
  userId: string;
  email: string | null;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  encryptedCsrfToken: string;
  accessTokenExpiresAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
  revokedAt: Date | null;
  csrfTokenHash: string;
  createdAt: Date;
}): StoredAuthSession {
  return {
    id: row.id,
    sessionIdHash: row.sessionIdHash,
    userId: row.userId,
    email: row.email,
    encryptedAccessToken: row.encryptedAccessToken,
    encryptedRefreshToken: row.encryptedRefreshToken,
    encryptedCsrfToken: row.encryptedCsrfToken,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    expiresAt: row.expiresAt,
    lastActivityAt: row.lastActivityAt,
    revokedAt: row.revokedAt,
    csrfTokenHash: row.csrfTokenHash,
    createdAt: row.createdAt,
  };
}
