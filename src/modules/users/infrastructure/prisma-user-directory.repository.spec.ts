import { jest } from '@jest/globals';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { PrismaUserDirectoryRepository } from './prisma-user-directory.repository.js';

describe('PrismaUserDirectoryRepository', () => {
  const profileFind =
    jest.fn<
      (args: { where: { cognitoSub: { in: string[] } } }) => Promise<unknown[]>
    >();
  const profileCreate = jest.fn();
  const invitationFind = jest.fn<
    (args: { where: { email: { in: string[] } } }) => Promise<
      Array<{
        id: string;
        email: string;
        status: string;
        createdAt: Date;
      }>
    >
  >();
  const prisma = {
    userProfile: { findMany: profileFind, create: profileCreate },
    userInvitation: { findMany: invitationFind },
  } as unknown as PrismaService;
  const repository = new PrismaUserDirectoryRepository(prisma);

  beforeEach(() => {
    profileFind.mockReset();
    profileCreate.mockReset();
    invitationFind.mockReset();
  });

  it('does not query or create profiles when there are no accounts', async () => {
    await expect(repository.findProfiles([])).resolves.toEqual([]);
    await expect(repository.findLatestInvitations([])).resolves.toEqual([]);
    expect(profileFind).not.toHaveBeenCalled();
    expect(profileCreate).not.toHaveBeenCalled();
    expect(invitationFind).not.toHaveBeenCalled();
  });

  it('keeps the newest invitation for each email', async () => {
    invitationFind.mockResolvedValue([
      {
        id: 'older',
        email: 'ana@enercol.test',
        status: 'PENDING',
        createdAt: new Date('2026-11-01T00:00:00.000Z'),
      },
      {
        id: 'newer',
        email: 'ana@enercol.test',
        status: 'ACCEPTED',
        createdAt: new Date('2026-11-03T00:00:00.000Z'),
      },
    ]);

    await expect(
      repository.findLatestInvitations(['ana@enercol.test']),
    ).resolves.toEqual([
      {
        email: 'ana@enercol.test',
        status: 'ACCEPTED',
        createdAt: new Date('2026-11-03T00:00:00.000Z'),
      },
    ]);
    expect(profileCreate).not.toHaveBeenCalled();
  });
});
