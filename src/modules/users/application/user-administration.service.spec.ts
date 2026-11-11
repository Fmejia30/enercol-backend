import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import { UserRole } from '../../identity-access/domain/user-role.js';
import { CognitoAdminError } from '../domain/cognito-admin-error.js';
import type { FunctionalCognitoGroup } from '../domain/functional-cognito-group.js';
import {
  USER_DISABLED_AUDIT_ACTION,
  USER_ENABLED_AUDIT_ACTION,
  USER_PROFILE_UPDATED_AUDIT_ACTION,
  USER_ROLES_COMPENSATION_ACTION,
  USER_ROLES_UPDATED_AUDIT_ACTION,
  UserAdministrationFailedError,
  UserAdministrationForbiddenError,
  UserAdministrationNotFoundError,
  UserAdministrationQueryError,
} from '../domain/user-administration.js';
import type {
  CognitoManagedUser,
  CognitoUserAdmin,
} from './cognito-user-admin.js';
import { UserAdministrationService } from './user-administration.service.js';
import type {
  UserAdministrationChange,
  UserAdministrationRepository,
} from './user-administration.repository.js';
import type { DirectoryUserDetail } from './user-directory.service.js';
import { UserDirectoryService } from './user-directory.service.js';
import type {
  DirectoryProfile,
  UserDirectoryRepository,
} from './user-directory.repository.js';

const ACTOR_SUB = 'admin-sub';
const TARGET_SUB = 'target-sub';
const EMAIL = 'ana@enercol.test';

describe('UserAdministrationService', () => {
  const errorLog = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
  const getUserBySub = jest.fn<CognitoUserAdmin['getUserBySub']>();
  const listGroups = jest.fn<CognitoUserAdmin['listGroups']>();
  const addToGroup = jest.fn<CognitoUserAdmin['addToGroup']>();
  const removeFromGroup = jest.fn<CognitoUserAdmin['removeFromGroup']>();
  const disableUser = jest.fn<CognitoUserAdmin['disableUser']>();
  const enableUser = jest.fn<CognitoUserAdmin['enableUser']>();
  const signOutUser = jest.fn<CognitoUserAdmin['signOutUser']>();
  const resendInvitation = jest.fn<CognitoUserAdmin['resendInvitation']>();
  const findProfiles = jest.fn<UserDirectoryRepository['findProfiles']>();
  const saveChanges = jest.fn<UserAdministrationRepository['saveChanges']>();
  const recordIntervention =
    jest.fn<UserAdministrationRepository['recordIntervention']>();
  const getBySub = jest.fn<(id: string) => Promise<DirectoryUserDetail>>();
  const cognito = {
    getUserBySub,
    listGroups,
    addToGroup,
    removeFromGroup,
    disableUser,
    enableUser,
    signOutUser,
    resendInvitation,
    createUser: jest.fn(),
    getUserByUsername: jest.fn(),
    findUsersByEmail: jest.fn(),
    listUsers: jest.fn(),
  } as CognitoUserAdmin;
  const service = new UserAdministrationService(
    cognito,
    { findProfiles, findLatestInvitations: jest.fn() },
    { saveChanges, recordIntervention },
    { getBySub } as unknown as UserDirectoryService,
  );

  beforeEach(() => {
    errorLog.mockClear();
    getUserBySub.mockReset().mockResolvedValue(managedUser());
    listGroups.mockReset().mockResolvedValue(['ESPECIALISTA_TECNICO']);
    addToGroup.mockReset().mockResolvedValue(undefined);
    removeFromGroup.mockReset().mockResolvedValue(undefined);
    disableUser.mockReset().mockResolvedValue(undefined);
    enableUser.mockReset().mockResolvedValue(undefined);
    signOutUser.mockReset().mockResolvedValue(undefined);
    resendInvitation.mockReset().mockResolvedValue(undefined);
    findProfiles.mockReset().mockResolvedValue([existingProfile()]);
    saveChanges.mockReset().mockResolvedValue(undefined);
    recordIntervention.mockReset().mockResolvedValue(undefined);
    getBySub.mockReset().mockResolvedValue(detail());
  });

  it('updates an existing profile and records the previous values', async () => {
    const result = await service.update(actor(), TARGET_SUB, {
      firstName: '  Ana María  ',
    });

    expect(result.id).toBe(TARGET_SUB);
    expect(saveChanges).toHaveBeenCalledWith({
      targetSub: TARGET_SUB,
      profile: {
        mode: 'update',
        firstName: 'Ana María',
        lastName: undefined,
        phoneNumber: undefined,
      },
      audits: [
        {
          action: USER_PROFILE_UPDATED_AUDIT_ACTION,
          actorSub: ACTOR_SUB,
          targetSub: TARGET_SUB,
          metadata: {
            before: {
              firstName: 'Fernando',
              lastName: 'Mejía',
              phoneNumber: '+573000000000',
            },
            after: {
              firstName: 'Ana María',
              lastName: 'Mejía',
              phoneNumber: '+573000000000',
            },
          },
        },
      ],
    });
    expect(addToGroup).not.toHaveBeenCalled();
    expect(removeFromGroup).not.toHaveBeenCalled();
    expect(resendInvitation).not.toHaveBeenCalled();
  });

  it('creates the profile by cognito sub when it does not exist', async () => {
    findProfiles.mockResolvedValue([]);

    await service.update(actor(), TARGET_SUB, {
      firstName: 'Fernando',
      lastName: 'Mejía',
      phoneNumber: '+573000000000',
      actorSub: 'intruder',
      email: 'other@enercol.test',
    } as never);

    const change = savedChange();
    expect(change.profile).toEqual({
      mode: 'create',
      firstName: 'Fernando',
      lastName: 'Mejía',
      phoneNumber: '+573000000000',
    });
    expect(change.profile).not.toHaveProperty('email');
    expect(change.audits[0]).toMatchObject({
      action: USER_PROFILE_UPDATED_AUDIT_ACTION,
      actorSub: ACTOR_SUB,
      targetSub: TARGET_SUB,
      metadata: { before: null },
    });
  });

  it('rejects a partial profile when the row does not exist yet', async () => {
    findProfiles.mockResolvedValue([]);

    await expect(
      service.update(actor(), TARGET_SUB, { firstName: 'Fernando' }),
    ).rejects.toEqual(
      expect.objectContaining({ reason: 'profile_incomplete' }),
    );
    expect(saveChanges).not.toHaveBeenCalled();
    expect(addToGroup).not.toHaveBeenCalled();
  });

  it('adds only the missing functional groups', async () => {
    await service.update(actor(), TARGET_SUB, {
      roles: [UserRole.SPECIALIST, UserRole.ADMINISTRATOR],
    });

    expect(addToGroup).toHaveBeenCalledTimes(1);
    expect(addToGroup).toHaveBeenCalledWith(EMAIL, 'ADMINISTRADOR');
    expect(removeFromGroup).not.toHaveBeenCalled();
    expect(savedChange().profile).toBeNull();
    expect(savedChange().audits[0]).toMatchObject({
      action: USER_ROLES_UPDATED_AUDIT_ACTION,
      actorSub: ACTOR_SUB,
      metadata: {
        before: [UserRole.SPECIALIST],
        after: [UserRole.SPECIALIST, UserRole.ADMINISTRATOR],
      },
    });
  });

  it('replaces one or several roles and removes groups that no longer apply', async () => {
    listGroups.mockResolvedValue([
      'ESPECIALISTA_TECNICO',
      'ESPECIALISTA_VALIDADOR',
    ]);

    await service.update(actor(), TARGET_SUB, {
      roles: [UserRole.VALIDATOR, UserRole.ADMINISTRATOR],
    });

    expect(addToGroup.mock.calls.map(([, group]) => group)).toEqual([
      'ADMINISTRADOR',
    ]);
    expect(removeFromGroup.mock.calls.map(([, group]) => group)).toEqual([
      'ESPECIALISTA_TECNICO',
    ]);
  });

  it('leaves groups outside the EnerCol set unchanged', async () => {
    listGroups.mockResolvedValue([
      'ESPECIALISTA_TECNICO',
      'OTRO_GRUPO',
    ] as FunctionalCognitoGroup[]);

    await service.update(actor(), TARGET_SUB, {
      roles: [UserRole.VALIDATOR],
    });

    const changed = [...addToGroup.mock.calls, ...removeFromGroup.mock.calls]
      .map(([, group]) => group)
      .sort();
    expect(changed).toEqual(['ESPECIALISTA_TECNICO', 'ESPECIALISTA_VALIDADOR']);
    expect(changed).not.toContain('OTRO_GRUPO');
  });

  it('rejects roles outside the three functional roles before calling Cognito', async () => {
    await expect(
      service.update(actor(), TARGET_SUB, { roles: ['AUDITOR'] }),
    ).rejects.toBeInstanceOf(UserAdministrationQueryError);
    expect(getUserBySub).not.toHaveBeenCalled();
    expect(saveChanges).not.toHaveBeenCalled();
  });

  it('reports a missing account without writing a profile or audit', async () => {
    getUserBySub.mockRejectedValue(new CognitoAdminError('user_not_found'));

    await expect(
      service.update(actor(), TARGET_SUB, { firstName: 'Fernando' }),
    ).rejects.toBeInstanceOf(UserAdministrationNotFoundError);
    expect(saveChanges).not.toHaveBeenCalled();
  });

  it('records both profile and role changes from the same request', async () => {
    await service.update(actor(), TARGET_SUB, {
      lastName: 'Rojas',
      roles: [UserRole.VALIDATOR],
    });

    expect(savedChange().audits.map((audit) => audit.action)).toEqual([
      USER_PROFILE_UPDATED_AUDIT_ACTION,
      USER_ROLES_UPDATED_AUDIT_ACTION,
    ]);
    expect(savedChange().audits.every((audit) => audit.actorSub === ACTOR_SUB))
      .toBe(true);
  });

  it('restores groups when a later assignment fails and skips the success audit', async () => {
    listGroups.mockResolvedValue([]);
    addToGroup
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new CognitoAdminError('unavailable'));

    await expect(
      service.update(actor(), TARGET_SUB, {
        roles: [UserRole.VALIDATOR, UserRole.ADMINISTRATOR],
      }),
    ).rejects.toBeInstanceOf(UserAdministrationFailedError);

    expect(addToGroup.mock.calls.map(([, group]) => group)).toEqual([
      'ESPECIALISTA_VALIDADOR',
      'ADMINISTRADOR',
    ]);
    expect(removeFromGroup).toHaveBeenCalledTimes(1);
    expect(removeFromGroup).toHaveBeenCalledWith(
      EMAIL,
      'ESPECIALISTA_VALIDADOR',
    );
    expect(saveChanges).not.toHaveBeenCalled();
    expect(recordIntervention).not.toHaveBeenCalled();
    expect(loggedText()).toContain('User administration failed (unavailable)');
    expect(loggedText()).not.toContain('Secret123');
  });

  it('records intervention when group compensation also fails', async () => {
    listGroups.mockResolvedValue([]);
    addToGroup
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('temporary password Secret123'));
    removeFromGroup.mockRejectedValue(new Error('temporary password Secret123'));

    await expect(
      service.update(actor(), TARGET_SUB, {
        roles: [UserRole.SPECIALIST, UserRole.VALIDATOR],
      }),
    ).rejects.toBeInstanceOf(UserAdministrationFailedError);

    expect(recordIntervention).toHaveBeenCalledWith({
      actorSub: ACTOR_SUB,
      targetSub: TARGET_SUB,
      added: ['ESPECIALISTA_TECNICO'],
      removed: [],
    });
    expect(saveChanges).not.toHaveBeenCalled();
    expect(loggedText()).not.toContain('Secret123');
    expect(USER_ROLES_COMPENSATION_ACTION).toBe('users.roles.compensation_failed');
  });

  it('rolls the group change back when the local audit transaction fails', async () => {
    saveChanges.mockRejectedValue(new Error('database password Secret123'));

    await expect(
      service.update(actor(), TARGET_SUB, {
        roles: [UserRole.VALIDATOR],
      }),
    ).rejects.toBeInstanceOf(UserAdministrationFailedError);

    expect(addToGroup).toHaveBeenCalledWith(EMAIL, 'ESPECIALISTA_VALIDADOR');
    expect(removeFromGroup.mock.calls.map(([, group]) => group)).toEqual([
      'ESPECIALISTA_TECNICO',
      'ESPECIALISTA_VALIDADOR',
    ]);
    expect(loggedText()).not.toContain('Secret123');
  });

  it('disables the account, revokes Cognito refresh tokens, and audits the change', async () => {
    await service.setStatus(actor(), TARGET_SUB, false);

    expect(disableUser).toHaveBeenCalledWith(EMAIL);
    expect(signOutUser).toHaveBeenCalledWith(EMAIL);
    expect(enableUser).not.toHaveBeenCalled();
    expect(savedChange()).toMatchObject({
      profile: null,
      audits: [
        {
          action: USER_DISABLED_AUDIT_ACTION,
          actorSub: ACTOR_SUB,
          targetSub: TARGET_SUB,
          metadata: { enabled: false, cognitoGlobalSignOut: 'completed' },
        },
      ],
    });
    expect(resendInvitation).not.toHaveBeenCalled();
  });

  it('keeps the account disabled when Cognito cannot revoke refresh tokens', async () => {
    signOutUser.mockRejectedValue(new Error('refresh token Secret123'));

    await service.setStatus(actor(), TARGET_SUB, false);

    expect(disableUser).toHaveBeenCalledWith(EMAIL);
    expect(enableUser).not.toHaveBeenCalled();
    expect(savedChange().audits[0]?.metadata).toEqual({
      enabled: false,
      cognitoGlobalSignOut: 'failed',
    });
    expect(loggedText()).not.toContain('Secret123');
  });

  it('enables the account without a global sign-out', async () => {
    await service.setStatus(actor(), TARGET_SUB, true);

    expect(enableUser).toHaveBeenCalledWith(EMAIL);
    expect(disableUser).not.toHaveBeenCalled();
    expect(signOutUser).not.toHaveBeenCalled();
    expect(savedChange().audits[0]).toMatchObject({
      action: USER_ENABLED_AUDIT_ACTION,
      metadata: { enabled: true, cognitoGlobalSignOut: 'not_requested' },
    });
  });

  it('rejects an administrator disabling their own account', async () => {
    await expect(
      service.setStatus(actor(), ACTOR_SUB, false),
    ).rejects.toBeInstanceOf(UserAdministrationForbiddenError);
    expect(getUserBySub).not.toHaveBeenCalled();
    expect(disableUser).not.toHaveBeenCalled();
    expect(signOutUser).not.toHaveBeenCalled();
    expect(saveChanges).not.toHaveBeenCalled();
  });

  function savedChange(): UserAdministrationChange {
    const change = saveChanges.mock.calls[0]?.[0];
    if (!change) {
      throw new Error('Missing administration change');
    }
    return change;
  }

  function loggedText(): string {
    return errorLog.mock.calls.map(([message]) => String(message)).join('\n');
  }
});

function actor(): AuthenticatedUser {
  return { userId: ACTOR_SUB, roles: [UserRole.ADMINISTRATOR] };
}

function managedUser(): CognitoManagedUser {
  return {
    sub: TARGET_SUB,
    username: EMAIL,
    email: EMAIL,
    enabled: true,
    status: 'CONFIRMED',
    accountStatus: 'CONFIRMED',
    createdAt: null,
    lastModifiedAt: null,
  };
}

function existingProfile(): DirectoryProfile {
  return {
    cognitoSub: TARGET_SUB,
    firstName: 'Fernando',
    lastName: 'Mejía',
    phoneNumber: '+573000000000',
  };
}

function detail(): DirectoryUserDetail {
  return {
    id: TARGET_SUB,
    email: EMAIL,
    firstName: 'Fernando',
    lastName: 'Mejía',
    phoneNumber: '+573000000000',
    roles: [UserRole.SPECIALIST],
    accountStatus: 'CONFIRMED',
    enabled: true,
    profileCompleted: true,
    invitationStatus: null,
    createdAt: null,
    lastModifiedAt: null,
    groups: ['ESPECIALISTA_TECNICO'],
  };
}
