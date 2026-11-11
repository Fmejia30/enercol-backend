import { Logger } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import { UserRole } from '../../identity-access/domain/user-role.js';
import { CognitoAdminError } from '../domain/cognito-admin-error.js';
import {
  INVITATION_TTL_MS,
  USER_INVITE_AUDIT_ACTION,
} from '../domain/invitation-request.js';
import {
  InvitationFailedError,
  InvitationForbiddenError,
  InvalidInvitationError,
  UserAlreadyExistsError,
} from '../domain/invitation-failure.js';
import type {
  CognitoManagedUser,
  CognitoUserAdmin,
} from './cognito-user-admin.js';
import { InviteUserService } from './invite-user.service.js';
import type {
  NewUserInvitation,
  StoredUserInvitation,
  UserInvitationRepository,
} from './user-invitation.repository.js';

const ADMIN_SUB = 'admin-sub';
const TARGET_SUB = 'target-sub';
const EMAIL = 'ana@enercol.test';
const NOW = new Date('2026-11-11T00:00:00.000Z');

describe('InviteUserService', () => {
  const errorLog = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
  const findUsersByEmail = jest.fn<CognitoUserAdmin['findUsersByEmail']>();
  const createUser = jest.fn<CognitoUserAdmin['createUser']>();
  const addToGroup = jest.fn<CognitoUserAdmin['addToGroup']>();
  const disableUser = jest.fn<CognitoUserAdmin['disableUser']>();
  const save = jest.fn<UserInvitationRepository['save']>();
  const recordIntervention =
    jest.fn<UserInvitationRepository['recordIntervention']>();
  const cognito = {
    findUsersByEmail,
    createUser,
    addToGroup,
    disableUser,
    getUserByUsername: jest.fn(),
    getUserBySub: jest.fn(),
    listGroups: jest.fn(),
    removeFromGroup: jest.fn(),
    enableUser: jest.fn(),
    resendInvitation: jest.fn(),
    listUsers: jest.fn(),
  } as CognitoUserAdmin;
  const invitations: UserInvitationRepository = { save, recordIntervention };
  const service = new InviteUserService(cognito, invitations, () => NOW);

  beforeEach(() => {
    findUsersByEmail.mockReset().mockResolvedValue([]);
    createUser.mockReset().mockResolvedValue(managedUser());
    addToGroup.mockReset().mockResolvedValue(undefined);
    disableUser.mockReset().mockResolvedValue(undefined);
    save
      .mockReset()
      .mockImplementation(async (invitation) => stored(invitation));
    recordIntervention.mockReset().mockResolvedValue(undefined);
    errorLog.mockClear();
  });

  afterAll(() => {
    errorLog.mockRestore();
  });

  it('creates the account, assigns the group and stores a pending invitation', async () => {
    const invited = await service.execute(administrator(), {
      email: '  Ana@Enercol.TEST ',
      roles: [UserRole.SPECIALIST],
    });

    expect(findUsersByEmail).toHaveBeenCalledWith(EMAIL);
    expect(createUser).toHaveBeenCalledWith(EMAIL);
    expect(addToGroup).toHaveBeenCalledTimes(1);
    expect(addToGroup).toHaveBeenCalledWith(EMAIL, 'ESPECIALISTA_TECNICO');
    expect(save).toHaveBeenCalledWith({
      email: EMAIL,
      cognitoSub: TARGET_SUB,
      roles: [UserRole.SPECIALIST],
      expiresAt: new Date(NOW.getTime() + INVITATION_TTL_MS),
      createdBy: ADMIN_SUB,
    });
    expect(invited).toMatchObject({
      id: 'invitation-1',
      email: EMAIL,
      roles: [UserRole.SPECIALIST],
      status: 'PENDING',
    });
    expect(disableUser).not.toHaveBeenCalled();
    expect(recordIntervention).not.toHaveBeenCalled();
  });

  it('assigns every requested functional group in stable order', async () => {
    await service.execute(administrator(), {
      email: EMAIL,
      roles: [UserRole.ADMINISTRATOR, UserRole.SPECIALIST, UserRole.SPECIALIST],
    });

    expect(addToGroup.mock.calls).toEqual([
      [EMAIL, 'ESPECIALISTA_TECNICO'],
      [EMAIL, 'ADMINISTRADOR'],
    ]);
    expect(save.mock.calls[0]?.[0].roles).toEqual([
      UserRole.SPECIALIST,
      UserRole.ADMINISTRATOR,
    ]);
  });

  it('rejects an unknown role before calling Cognito', async () => {
    await expect(
      service.execute(administrator(), {
        email: EMAIL,
        roles: ['AUDITOR'],
      }),
    ).rejects.toBeInstanceOf(InvalidInvitationError);

    expect(findUsersByEmail).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects an empty role list and a duplicate Cognito email', async () => {
    await expect(
      service.execute(administrator(), { email: EMAIL, roles: [] }),
    ).rejects.toBeInstanceOf(InvalidInvitationError);

    findUsersByEmail.mockResolvedValue([managedUser()]);
    await expect(
      service.execute(administrator(), {
        email: EMAIL,
        roles: [UserRole.VALIDATOR],
      }),
    ).rejects.toBeInstanceOf(UserAlreadyExistsError);
    expect(createUser).not.toHaveBeenCalled();

    findUsersByEmail.mockResolvedValue([]);
    createUser.mockRejectedValue(new CognitoAdminError('user_already_exists'));
    await expect(
      service.execute(administrator(), {
        email: EMAIL,
        roles: [UserRole.VALIDATOR],
      }),
    ).rejects.toBeInstanceOf(UserAlreadyExistsError);
    expect(disableUser).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('does not persist anything when Cognito cannot create the user', async () => {
    createUser.mockRejectedValue(new CognitoAdminError('unavailable'));

    await expect(
      service.execute(administrator(), {
        email: EMAIL,
        roles: [UserRole.SPECIALIST],
      }),
    ).rejects.toBeInstanceOf(InvitationFailedError);

    expect(addToGroup).not.toHaveBeenCalled();
    expect(disableUser).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('disables the new account when a group assignment fails', async () => {
    addToGroup
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('temporary password Secret123'));

    await expect(
      service.execute(administrator(), {
        email: EMAIL,
        roles: [UserRole.SPECIALIST, UserRole.VALIDATOR],
      }),
    ).rejects.toMatchObject({
      name: 'InvitationFailedError',
      message: 'User invitation failed',
    });

    expect(disableUser).toHaveBeenCalledWith(EMAIL);
    expect(save).not.toHaveBeenCalled();
    expect(recordIntervention).not.toHaveBeenCalled();
    expect(loggedText()).not.toContain('Secret123');
  });

  it('records intervention when compensation cannot disable the account', async () => {
    addToGroup.mockRejectedValue(new CognitoAdminError('group_not_found'));
    disableUser.mockRejectedValue(new Error('temporary password Secret123'));

    await expect(
      service.execute(administrator(), {
        email: EMAIL,
        roles: [UserRole.VALIDATOR],
      }),
    ).rejects.toBeInstanceOf(InvitationFailedError);

    expect(save).not.toHaveBeenCalled();
    expect(recordIntervention).toHaveBeenCalledWith({
      actorSub: ADMIN_SUB,
      targetSub: TARGET_SUB,
    });
    expect(loggedText()).toContain('administrative intervention required');
    expect(loggedText()).not.toContain('Secret123');
  });

  it('keeps the original failure when the intervention record cannot be saved', async () => {
    addToGroup.mockRejectedValue(new CognitoAdminError('unavailable'));
    disableUser.mockRejectedValue(new CognitoAdminError('unavailable'));
    recordIntervention.mockRejectedValue(new Error('database unavailable'));

    await expect(
      service.execute(administrator(), {
        email: EMAIL,
        roles: [UserRole.VALIDATOR],
      }),
    ).rejects.toBeInstanceOf(InvitationFailedError);

    expect(save).not.toHaveBeenCalled();
    expect(loggedText()).not.toContain('database unavailable');
  });

  it('rejects an actor without the administrator role that grants users:manage', async () => {
    await expect(
      service.execute(actor([UserRole.SPECIALIST, UserRole.VALIDATOR]), {
        email: EMAIL,
        roles: [UserRole.ADMINISTRATOR],
      }),
    ).rejects.toBeInstanceOf(InvitationForbiddenError);

    expect(findUsersByEmail).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('stores the administrator sub as the audit actor', async () => {
    await service.execute(administrator(), {
      email: EMAIL,
      roles: [UserRole.ADMINISTRATOR],
    });

    expect(save.mock.calls[0]?.[0]).toMatchObject({
      createdBy: ADMIN_SUB,
      cognitoSub: TARGET_SUB,
      roles: [UserRole.ADMINISTRATOR],
    });
    expect(USER_INVITE_AUDIT_ACTION).toBe('users.invite');
  });
});

function administrator(): AuthenticatedUser {
  return actor([UserRole.ADMINISTRATOR]);
}

function actor(roles: UserRole[]): AuthenticatedUser {
  return { userId: ADMIN_SUB, roles };
}

function managedUser(): CognitoManagedUser {
  return {
    sub: TARGET_SUB,
    username: EMAIL,
    email: EMAIL,
    enabled: true,
    status: 'FORCE_CHANGE_PASSWORD',
    accountStatus: 'FORCE_CHANGE_PASSWORD',
    createdAt: null,
    lastModifiedAt: null,
  };
}

function stored(invitation: NewUserInvitation): StoredUserInvitation {
  return {
    id: 'invitation-1',
    email: invitation.email,
    roles: invitation.roles,
    status: 'PENDING',
    expiresAt: invitation.expiresAt,
  };
}

function loggedText(): string {
  return Logger.prototype.error.mock.calls.flat().join(' ');
}
