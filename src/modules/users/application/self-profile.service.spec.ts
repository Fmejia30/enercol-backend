import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import { UserRole } from '../../identity-access/domain/user-role.js';
import { USER_PROFILE_SELF_UPDATED_AUDIT_ACTION } from '../domain/user-administration.js';
import { UserAdministrationQueryError } from '../domain/user-administration.js';
import { SelfProfileService } from './self-profile.service.js';
import type {
  UserAdministrationChange,
  UserAdministrationRepository,
} from './user-administration.repository.js';
import type {
  DirectoryProfile,
  UserDirectoryRepository,
} from './user-directory.repository.js';

const SUB = 'specialist-1';
const EMAIL = 'ana@enercol.test';

describe('SelfProfileService', () => {
  const errorLog = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
  const findProfiles = jest.fn<UserDirectoryRepository['findProfiles']>();
  const saveChanges = jest.fn<UserAdministrationRepository['saveChanges']>();
  const service = new SelfProfileService(
    { findProfiles, findLatestInvitations: jest.fn() },
    { saveChanges, recordIntervention: jest.fn() },
  );

  beforeEach(() => {
    errorLog.mockClear();
    findProfiles.mockReset().mockResolvedValue([profile()]);
    saveChanges.mockReset().mockResolvedValue(undefined);
  });

  it('returns the existing profile with the identity email and roles', async () => {
    await expect(service.get(actor())).resolves.toEqual({
      id: SUB,
      email: EMAIL,
      roles: [UserRole.SPECIALIST],
      firstName: 'Fernando',
      lastName: 'Mejía',
      phoneNumber: '+573000000000',
      profileCompleted: true,
    });
    expect(saveChanges).not.toHaveBeenCalled();
  });

  it('returns an empty profile without creating a row', async () => {
    findProfiles.mockResolvedValue([]);

    await expect(service.get(actor())).resolves.toEqual({
      id: SUB,
      email: EMAIL,
      roles: [UserRole.SPECIALIST],
      firstName: null,
      lastName: null,
      phoneNumber: null,
      profileCompleted: false,
    });
    expect(saveChanges).not.toHaveBeenCalled();
  });

  it('updates only the provided fields of the authenticated user', async () => {
    await service.update(actor(), {
      firstName: '  Ana María  ',
      cognitoSub: 'other-user',
      email: 'other@enercol.test',
      roles: [UserRole.ADMINISTRATOR],
    } as never);

    expect(saved().targetSub).toBe(SUB);
    expect(saved().profile).toEqual({
      mode: 'update',
      firstName: 'Ana María',
      lastName: undefined,
      phoneNumber: undefined,
    });
    expect(saved().audits).toEqual([
      {
        action: USER_PROFILE_SELF_UPDATED_AUDIT_ACTION,
        actorSub: SUB,
        targetSub: SUB,
        metadata: {
          changedFields: ['firstName'],
          before: { firstName: 'Fernando' },
          after: { firstName: 'Ana María' },
        },
      },
    ]);
  });

  it('creates the profile when the three required fields arrive together', async () => {
    findProfiles.mockResolvedValue([]);

    await service.update(actor(), {
      firstName: 'Fernando',
      lastName: 'Mejía',
      phoneNumber: '+573000000000',
    });

    expect(saved().profile).toEqual({
      mode: 'create',
      firstName: 'Fernando',
      lastName: 'Mejía',
      phoneNumber: '+573000000000',
    });
    expect(saved().audits[0]).toMatchObject({
      actorSub: SUB,
      targetSub: SUB,
      metadata: {
        changedFields: ['firstName', 'lastName', 'phoneNumber'],
        before: null,
      },
    });
  });

  it('rejects an incomplete profile creation', async () => {
    findProfiles.mockResolvedValue([]);

    await expect(
      service.update(actor(), { firstName: 'Fernando' }),
    ).rejects.toEqual(
      expect.objectContaining({ reason: 'profile_incomplete' }),
    );
    expect(saveChanges).not.toHaveBeenCalled();
  });

  it('rejects an empty change before reading another account', async () => {
    await expect(service.update(actor(), {})).rejects.toBeInstanceOf(
      UserAdministrationQueryError,
    );
    expect(findProfiles).not.toHaveBeenCalled();
    expect(saveChanges).not.toHaveBeenCalled();
  });

  function saved(): UserAdministrationChange {
    const change = saveChanges.mock.calls[0]?.[0];
    if (!change) {
      throw new Error('Missing profile change');
    }
    return change;
  }
});

function actor(): AuthenticatedUser {
  return {
    userId: SUB,
    email: EMAIL,
    roles: [UserRole.SPECIALIST, UserRole.SPECIALIST],
  };
}

function profile(): DirectoryProfile {
  return {
    cognitoSub: SUB,
    firstName: 'Fernando',
    lastName: 'Mejía',
    phoneNumber: '+573000000000',
  };
}
