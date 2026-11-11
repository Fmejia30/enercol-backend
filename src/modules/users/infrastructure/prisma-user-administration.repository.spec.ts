import { jest } from '@jest/globals';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { UserRole } from '../../identity-access/domain/user-role.js';
import type { UserAdministrationChange } from '../application/user-administration.repository.js';
import {
  USER_PROFILE_UPDATED_AUDIT_ACTION,
  USER_ROLES_COMPENSATION_ACTION,
  USER_ROLES_UPDATED_AUDIT_ACTION,
} from '../domain/user-administration.js';
import { PrismaUserAdministrationRepository } from './prisma-user-administration.repository.js';

describe('PrismaUserAdministrationRepository', () => {
  const profileCreate = jest.fn<(args: unknown) => Promise<unknown>>();
  const profileUpdate = jest.fn<(args: unknown) => Promise<unknown>>();
  const profileDelete = jest.fn<(args: unknown) => Promise<unknown>>();
  const invitationUpdate = jest.fn<(args: unknown) => Promise<unknown>>();
  const auditCreate = jest.fn<(args: unknown) => Promise<unknown>>();
  const transaction = jest.fn<
    (work: (tx: unknown) => Promise<void>) => Promise<void>
  >(async (work) => {
    await work(tx);
  });
  const tx = {
    userProfile: {
      create: profileCreate,
      update: profileUpdate,
      delete: profileDelete,
    },
    userInvitation: { update: invitationUpdate },
    auditLog: { create: auditCreate },
  };
  const prisma = {
    $transaction: transaction,
    auditLog: { create: auditCreate },
    userInvitation: { update: invitationUpdate },
  } as unknown as PrismaService;
  const repository = new PrismaUserAdministrationRepository(prisma);

  beforeEach(() => {
    profileCreate.mockReset().mockResolvedValue({});
    profileUpdate.mockReset().mockResolvedValue({});
    profileDelete.mockReset().mockResolvedValue({});
    invitationUpdate.mockReset().mockResolvedValue({});
    auditCreate.mockReset().mockResolvedValue({});
    transaction.mockClear();
  });

  it('creates the profile and both audits in one transaction', async () => {
    await repository.saveChanges(change());

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(profileCreate).toHaveBeenCalledWith({
      data: {
        cognitoSub: 'target-sub',
        firstName: 'Fernando',
        lastName: 'Mejía',
        phoneNumber: '+573000000000',
      },
    });
    expect(profileUpdate).not.toHaveBeenCalled();
    expect(profileDelete).not.toHaveBeenCalled();
    expect(invitationUpdate).not.toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalledTimes(2);
    expect(auditCreate.mock.calls.map((call) => call[0])).toEqual([
      {
        data: expect.objectContaining({
          action: USER_PROFILE_UPDATED_AUDIT_ACTION,
          actorSub: 'admin-sub',
          targetSub: 'target-sub',
        }),
      },
      {
        data: expect.objectContaining({
          action: USER_ROLES_UPDATED_AUDIT_ACTION,
        }),
      },
    ]);
  });

  it('updates only the provided profile fields', async () => {
    await repository.saveChanges({
      ...change(),
      profile: { mode: 'update', phoneNumber: '+573111111111' },
      audits: [change().audits[0]],
    });

    expect(profileCreate).not.toHaveBeenCalled();
    expect(profileUpdate).toHaveBeenCalledWith({
      where: { cognitoSub: 'target-sub' },
      data: { phoneNumber: '+573111111111' },
    });
  });

  it('records a failed group restore without invitation changes', async () => {
    await repository.recordIntervention({
      actorSub: 'admin-sub',
      targetSub: 'target-sub',
      added: ['ESPECIALISTA_VALIDADOR'],
      removed: [],
    });

    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        actorSub: 'admin-sub',
        action: USER_ROLES_COMPENSATION_ACTION,
        targetSub: 'target-sub',
        metadata: {
          compensation: 'group_restore_failed',
          added: ['ESPECIALISTA_VALIDADOR'],
          removed: [],
        },
      },
    });
    expect(invitationUpdate).not.toHaveBeenCalled();
    expect(profileDelete).not.toHaveBeenCalled();
  });
});

function change(): UserAdministrationChange {
  return {
    targetSub: 'target-sub',
    profile: {
      mode: 'create',
      firstName: 'Fernando',
      lastName: 'Mejía',
      phoneNumber: '+573000000000',
    },
    audits: [
      {
        action: USER_PROFILE_UPDATED_AUDIT_ACTION,
        actorSub: 'admin-sub',
        targetSub: 'target-sub',
        metadata: {
          before: null,
          after: {
            firstName: 'Fernando',
            lastName: 'Mejía',
            phoneNumber: '+573000000000',
          },
        },
      },
      {
        action: USER_ROLES_UPDATED_AUDIT_ACTION,
        actorSub: 'admin-sub',
        targetSub: 'target-sub',
        metadata: {
          before: [UserRole.SPECIALIST],
          after: [UserRole.VALIDATOR],
        },
      },
    ],
  };
}
