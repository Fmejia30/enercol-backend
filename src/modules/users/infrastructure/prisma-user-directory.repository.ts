import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  DIRECTORY_INVITATION_STATUSES,
  type DirectoryInvitation,
  type DirectoryInvitationStatus,
  type DirectoryProfile,
  type UserDirectoryRepository,
} from '../application/user-directory.repository.js';

@Injectable()
export class PrismaUserDirectoryRepository implements UserDirectoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findProfiles(
    cognitoSubs: readonly string[],
  ): Promise<DirectoryProfile[]> {
    if (cognitoSubs.length === 0) {
      return [];
    }
    const rows = await this.prisma.userProfile.findMany({
      where: { cognitoSub: { in: [...cognitoSubs] } },
      select: {
        cognitoSub: true,
        firstName: true,
        lastName: true,
        phoneNumber: true,
      },
    });
    return rows;
  }

  async findLatestInvitations(
    emails: readonly string[],
  ): Promise<DirectoryInvitation[]> {
    if (emails.length === 0) {
      return [];
    }
    const rows = await this.prisma.userInvitation.findMany({
      where: { email: { in: [...emails] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        email: true,
        status: true,
        createdAt: true,
      },
    });
    const latest = new Map<string, DirectoryInvitation & { id: string }>();
    for (const row of rows) {
      if (!isInvitationStatus(row.status)) {
        continue;
      }
      const current = latest.get(row.email);
      if (current && !isNewerInvitation(row, current)) {
        continue;
      }
      latest.set(row.email, {
        id: row.id,
        email: row.email,
        status: row.status,
        createdAt: row.createdAt,
      });
    }
    return [...latest.values()].map((invitation) => ({
      email: invitation.email,
      status: invitation.status,
      createdAt: invitation.createdAt,
    }));
  }
}

function isInvitationStatus(value: string): value is DirectoryInvitationStatus {
  return (DIRECTORY_INVITATION_STATUSES as readonly string[]).includes(value);
}

function isNewerInvitation(
  candidate: { id: string; createdAt: Date },
  current: { id: string; createdAt: Date },
): boolean {
  const createdAt = candidate.createdAt.getTime() - current.createdAt.getTime();
  return createdAt > 0 || (createdAt === 0 && candidate.id > current.id);
}
