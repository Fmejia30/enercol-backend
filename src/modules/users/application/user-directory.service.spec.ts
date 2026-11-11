import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import type { FunctionalCognitoGroup } from '../domain/functional-cognito-group.js';
import { CognitoAdminError } from '../domain/cognito-admin-error.js';
import {
  UserDirectoryFailedError,
  UserDirectoryNotFoundError,
  UserDirectoryQueryError,
} from '../domain/user-directory-error.js';
import type {
  CognitoManagedUser,
  CognitoUserAdmin,
  CognitoUserPage,
  CognitoUserStatus,
  ListCognitoUsersInput,
} from './cognito-user-admin.js';
import type {
  DirectoryInvitation,
  DirectoryProfile,
  UserDirectoryRepository,
} from './user-directory.repository.js';
import { UserDirectoryService } from './user-directory.service.js';
import { UserListCursorCodec } from './user-list-cursor.js';
import { UserRole } from '../../identity-access/domain/user-role.js';

const CREATED = new Date('2026-11-01T00:00:00.000Z');
const MODIFIED = new Date('2026-11-02T00:00:00.000Z');

describe('UserDirectoryService', () => {
  const listUsers = jest.fn<CognitoUserAdmin['listUsers']>();
  const getUserBySub = jest.fn<CognitoUserAdmin['getUserBySub']>();
  const findProfiles = jest.fn<UserDirectoryRepository['findProfiles']>();
  const findLatestInvitations =
    jest.fn<UserDirectoryRepository['findLatestInvitations']>();
  const groups = new Map<string, FunctionalCognitoGroup[]>();
  const profiles = new Map<string, DirectoryProfile>();
  const invitations = new Map<string, DirectoryInvitation>();
  const pages = new Map<string, CognitoUserPage>();
  const cognito = {
    listUsers,
    listGroups: jest.fn<CognitoUserAdmin['listGroups']>(async (username) => {
      return groups.get(username) ?? [];
    }),
    getUserBySub,
    createUser: jest.fn(),
    getUserByUsername: jest.fn(),
    findUsersByEmail: jest.fn(),
    addToGroup: jest.fn(),
    removeFromGroup: jest.fn(),
    disableUser: jest.fn(),
    enableUser: jest.fn(),
    resendInvitation: jest.fn(),
  } as CognitoUserAdmin;
  const directory: UserDirectoryRepository = {
    findProfiles,
    findLatestInvitations,
  };
  const service = new UserDirectoryService(
    cognito,
    directory,
    new UserListCursorCodec({
      getOrThrow: () => 'cursor-test-key',
    } as ConfigService),
  );

  beforeEach(() => {
    groups.clear();
    profiles.clear();
    invitations.clear();
    pages.clear();
    listUsers.mockReset().mockImplementation(async (input = {}) => {
      const page = pages.get(input.paginationToken ?? '');
      if (!page) {
        throw new Error(`missing page ${input.paginationToken ?? ''}`);
      }
      return page;
    });
    getUserBySub.mockReset();
    jest.mocked(cognito.listGroups).mockClear();
    jest.mocked(cognito.createUser).mockClear();
    findProfiles
      .mockReset()
      .mockImplementation(async (subs) =>
        [...profiles.values()].filter((profile) =>
          subs.includes(profile.cognitoSub),
        ),
      );
    findLatestInvitations
      .mockReset()
      .mockImplementation(async (emails) =>
        [...invitations.values()].filter((invitation) =>
          emails.includes(invitation.email),
        ),
      );
  });

  it('lists accounts with profile, roles and the latest invitation', async () => {
    const ana = account('Fernando', { email: 'ana@enercol.test' });
    groups.set(ana.username, ['ESPECIALISTA_TECNICO', 'ADMINISTRADOR']);
    profiles.set(ana.sub, profile(ana.sub));
    invitations.set(ana.email ?? '', invitation(ana.email ?? '', 'ACCEPTED'));
    pages.set('', { users: [ana], paginationToken: null });

    const page = await service.list({ pageSize: 20 });

    expect(page.nextToken).toBeNull();
    expect(page.users).toEqual([
      {
        id: ana.sub,
        email: 'ana@enercol.test',
        firstName: 'Fernando',
        lastName: 'Mejía',
        phoneNumber: '+573000000000',
        roles: [UserRole.SPECIALIST, UserRole.ADMINISTRATOR],
        accountStatus: 'CONFIRMED',
        enabled: true,
        profileCompleted: true,
        invitationStatus: 'ACCEPTED',
        createdAt: CREATED.toISOString(),
        lastModifiedAt: MODIFIED.toISOString(),
      },
    ]);
    expect(listUsers).toHaveBeenCalledWith({
      limit: 60,
      paginationToken: undefined,
      emailPrefix: undefined,
      accountStatus: undefined,
    });
    expect(cognito.createUser).not.toHaveBeenCalled();
  });

  it('continues from the signed token without repeating the previous account', async () => {
    const first = account('first');
    const second = account('second');
    groups.set(first.username, ['ESPECIALISTA_TECNICO']);
    groups.set(second.username, ['ESPECIALISTA_TECNICO']);
    pages.set('', { users: [first, second], paginationToken: 'cognito-2' });
    pages.set('cognito-2', { users: [], paginationToken: null });

    const listed = await service.list({ pageSize: 1 });
    const next = await service.list({
      pageSize: 1,
      nextToken: listed.nextToken ?? '',
    });

    expect(listed.users.map((user) => user.id)).toEqual([first.sub]);
    expect(next.users.map((user) => user.id)).toEqual([second.sub]);
    expect(listUsers.mock.calls[1]?.[0]).toMatchObject({
      paginationToken: undefined,
    });
  });

  it('searches by email prefix through Cognito and ignores other addresses', async () => {
    const ana = account('Fernando', { email: 'ana@enercol.test' });
    const luis = account('luis', { email: 'luis@enercol.test' });
    groups.set(ana.username, ['ESPECIALISTA_TECNICO']);
    pages.set('', { users: [ana, luis], paginationToken: null });

    const page = await service.list({ search: '  ANA@ ' });

    expect(page.users.map((user) => user.email)).toEqual(['ana@enercol.test']);
    expect(listUsers.mock.calls[0]?.[0]).toMatchObject({
      emailPrefix: 'ana@',
      accountStatus: undefined,
    });
  });

  it('filters by Cognito account status before loading groups', async () => {
    const confirmed = account('confirmed', { status: 'CONFIRMED' });
    const invited = account('invited', { status: 'FORCE_CHANGE_PASSWORD' });
    groups.set(confirmed.username, ['ESPECIALISTA_VALIDADOR']);
    pages.set('', { users: [invited, confirmed], paginationToken: null });

    const page = await service.list({ accountStatus: 'CONFIRMED' });

    expect(page.users.map((user) => user.id)).toEqual([confirmed.sub]);
    expect(listUsers.mock.calls[0]?.[0]).toMatchObject({
      accountStatus: 'CONFIRMED',
    });
    expect(cognito.listGroups).toHaveBeenCalledTimes(1);
    expect(cognito.listGroups).toHaveBeenCalledWith(confirmed.username);
  });

  it.each(['FORCE_CHANGE_PASSWORD', 'UNCONFIRMED'] as const)(
    'keeps only accounts whose account status is %s',
    async (accountStatus) => {
      const match = account('match', { status: accountStatus });
      const other = account('other', {
        status: accountStatus === 'UNCONFIRMED' ? 'CONFIRMED' : 'UNCONFIRMED',
      });
      groups.set(match.username, ['ESPECIALISTA_TECNICO']);
      groups.set(other.username, ['ESPECIALISTA_TECNICO']);
      pages.set('', { users: [other, match], paginationToken: null });

      const page = await service.list({ accountStatus });

      expect(page.users.map((user) => user.id)).toEqual([match.sub]);
      expect(page.users[0]?.accountStatus).toBe(accountStatus);
      expect(listUsers.mock.calls[0]?.[0]).toMatchObject({
        emailPrefix: undefined,
        accountStatus,
      });
      expect(cognito.listGroups).not.toHaveBeenCalledWith(other.username);
    },
  );

  it('applies status in the backend when search already uses the Cognito filter', async () => {
    const match = account('match', {
      email: 'ana@enercol.test',
      status: 'CONFIRMED',
    });
    const pending = account('pending', {
      email: 'ana.pending@enercol.test',
      status: 'FORCE_CHANGE_PASSWORD',
    });
    const other = account('other', {
      email: 'luis@enercol.test',
      status: 'CONFIRMED',
    });
    groups.set(match.username, ['ESPECIALISTA_TECNICO']);
    groups.set(pending.username, ['ESPECIALISTA_TECNICO']);
    groups.set(other.username, ['ESPECIALISTA_TECNICO']);
    pages.set('', { users: [pending, other, match], paginationToken: null });

    const page = await service.list({
      search: 'ana',
      accountStatus: 'CONFIRMED',
    });

    expect(page.users.map((user) => user.email)).toEqual(['ana@enercol.test']);
    expect(listUsers.mock.calls[0]?.[0]).toMatchObject({
      emailPrefix: 'ana',
      accountStatus: undefined,
    });
  });

  it('applies the role after the account status filter', async () => {
    const match = account('match', { status: 'CONFIRMED' });
    const otherRole = account('administrator', { status: 'CONFIRMED' });
    const otherStatus = account('pending', { status: 'UNCONFIRMED' });
    groups.set(match.username, ['ESPECIALISTA_TECNICO']);
    groups.set(otherRole.username, ['ADMINISTRADOR']);
    groups.set(otherStatus.username, ['ESPECIALISTA_TECNICO']);
    pages.set('', {
      users: [otherStatus, otherRole, match],
      paginationToken: null,
    });

    const page = await service.list({
      accountStatus: 'CONFIRMED',
      role: UserRole.SPECIALIST,
    });

    expect(page.users.map((user) => user.id)).toEqual([match.sub]);
    expect(listUsers.mock.calls[0]?.[0]).toMatchObject({
      emailPrefix: undefined,
      accountStatus: 'CONFIRMED',
    });
    expect(cognito.listGroups).not.toHaveBeenCalledWith(otherStatus.username);
  });

  it('filters by the current Cognito role and ignores invitation history', async () => {
    const specialist = account('specialist');
    groups.set(specialist.username, ['ESPECIALISTA_TECNICO']);
    invitations.set(
      specialist.email ?? '',
      invitation(specialist.email ?? '', 'PENDING'),
    );
    const validator = account('validator');
    groups.set(validator.username, ['ESPECIALISTA_VALIDADOR']);
    pages.set('', { users: [validator, specialist], paginationToken: null });

    const page = await service.list({ role: UserRole.SPECIALIST });

    expect(page.users.map((user) => user.id)).toEqual([specialist.sub]);
    expect(page.users[0]?.roles).toEqual([UserRole.SPECIALIST]);
    expect(listUsers.mock.calls[0]?.[0]).toMatchObject({
      emailPrefix: undefined,
      accountStatus: undefined,
    });
  });

  it('combines search, status and role while sending only the email filter to Cognito', async () => {
    const match = account('match', {
      email: 'ana@enercol.test',
      status: 'CONFIRMED',
    });
    const wrongStatus = account('status', {
      email: 'ana.status@enercol.test',
      status: 'FORCE_CHANGE_PASSWORD',
    });
    const wrongRole = account('role', {
      email: 'ana.role@enercol.test',
      status: 'CONFIRMED',
    });
    groups.set(match.username, ['ESPECIALISTA_TECNICO']);
    groups.set(wrongRole.username, ['ADMINISTRADOR']);
    pages.set('', {
      users: [wrongStatus, wrongRole, match],
      paginationToken: null,
    });

    const page = await service.list({
      search: 'ana',
      accountStatus: 'CONFIRMED',
      role: UserRole.SPECIALIST,
    });

    expect(page.users.map((user) => user.id)).toEqual([match.sub]);
    expect(listUsers.mock.calls[0]?.[0]).toMatchObject({
      emailPrefix: 'ana',
      accountStatus: undefined,
    });
    expect(cognito.listGroups).not.toHaveBeenCalledWith(wrongStatus.username);
  });

  it('returns null profile fields when the account has no profile', async () => {
    const ana = account('Fernando', { email: null });
    groups.set(ana.username, []);
    pages.set('', { users: [ana], paginationToken: null });

    const page = await service.list({});

    expect(page.users[0]).toMatchObject({
      firstName: null,
      lastName: null,
      phoneNumber: null,
      profileCompleted: false,
      invitationStatus: null,
      email: null,
    });
    expect(findLatestInvitations).toHaveBeenCalledWith([]);
  });

  it('returns null invitation status when the email has no invitations', async () => {
    const ana = account('Fernando');
    groups.set(ana.username, ['ESPECIALISTA_TECNICO']);
    pages.set('', { users: [ana], paginationToken: null });

    const page = await service.list({});

    expect(page.users[0]?.invitationStatus).toBeNull();
  });

  it('returns one account with its current groups', async () => {
    const ana = account('Fernando');
    groups.set(ana.username, ['ESPECIALISTA_VALIDADOR']);
    profiles.set(ana.sub, profile(ana.sub));
    invitations.set(ana.email ?? '', invitation(ana.email ?? '', 'PENDING'));
    getUserBySub.mockResolvedValue(ana);

    await expect(service.getBySub(ana.sub)).resolves.toMatchObject({
      id: ana.sub,
      groups: ['ESPECIALISTA_VALIDADOR'],
      roles: [UserRole.VALIDATOR],
      profileCompleted: true,
      invitationStatus: 'PENDING',
      createdAt: CREATED.toISOString(),
    });
  });

  it('reports a missing account without calling PostgreSQL', async () => {
    getUserBySub.mockRejectedValue(new CognitoAdminError('user_not_found'));

    await expect(service.getBySub('missing-sub')).rejects.toBeInstanceOf(
      UserDirectoryNotFoundError,
    );
    expect(findProfiles).not.toHaveBeenCalled();
  });

  it('hides Cognito and PostgreSQL failures', async () => {
    pages.set('', { users: [account('Fernando')], paginationToken: null });
    listUsers.mockRejectedValue(new Error('temporary password Secret123'));

    await expect(service.list({})).rejects.toMatchObject({
      name: 'UserDirectoryFailedError',
      message: 'User directory is unavailable',
    });

    listUsers.mockImplementation(async () => ({
      users: [account('Fernando')],
      paginationToken: null,
    }));
    groups.set('ana@enercol.test', ['ESPECIALISTA_TECNICO']);
    findProfiles.mockRejectedValue(new Error('password authentication failed'));

    await expect(service.list({})).rejects.toBeInstanceOf(
      UserDirectoryFailedError,
    );
    expect(findProfiles.mock.calls.length).toBeGreaterThan(0);
  });

  it('fills a filtered page across Cognito pages without skipping or repeating', async () => {
    const validator = account('validator');
    const first = account('first');
    const second = account('second');
    const third = account('third');
    groups.set(validator.username, ['ESPECIALISTA_VALIDADOR']);
    groups.set(first.username, ['ESPECIALISTA_TECNICO']);
    groups.set(second.username, ['ESPECIALISTA_TECNICO']);
    groups.set(third.username, ['ESPECIALISTA_TECNICO']);
    pages.set('', {
      users: [validator, first, second],
      paginationToken: 'cognito-2',
    });
    pages.set('cognito-2', { users: [third], paginationToken: null });

    const listed = await service.list({
      pageSize: 2,
      role: UserRole.SPECIALIST,
    });
    const next = await service.list({
      pageSize: 2,
      role: UserRole.SPECIALIST,
      nextToken: listed.nextToken ?? '',
    });

    expect(listed.users.map((user) => user.id)).toEqual([
      first.sub,
      second.sub,
    ]);
    expect(next.users.map((user) => user.id)).toEqual([third.sub]);
    expect(next.nextToken).toBeNull();
    const requests = listUsers.mock.calls.map(
      (call) => (call[0] as ListCognitoUsersInput).paginationToken ?? '',
    );
    expect(requests).toEqual(['', 'cognito-2']);
  });

  it('keeps the account status while paging and does not repeat or skip matches', async () => {
    const pending = account('pending', { status: 'FORCE_CHANGE_PASSWORD' });
    const first = account('first', { status: 'CONFIRMED' });
    const second = account('second', { status: 'CONFIRMED' });
    const unconfirmed = account('unconfirmed', { status: 'UNCONFIRMED' });
    const third = account('third', { status: 'CONFIRMED' });
    for (const user of [pending, first, second, unconfirmed, third]) {
      groups.set(user.username, ['ESPECIALISTA_TECNICO']);
    }
    pages.set('', {
      users: [pending, unconfirmed],
      paginationToken: 'cognito-2',
    });
    pages.set('cognito-2', {
      users: [first, second, third],
      paginationToken: null,
    });

    const listed = await service.list({
      pageSize: 2,
      accountStatus: 'CONFIRMED',
    });
    const next = await service.list({
      pageSize: 2,
      accountStatus: 'CONFIRMED',
      nextToken: listed.nextToken ?? '',
    });
    const ids = [...listed.users, ...next.users].map((user) => user.id);

    expect(listed.users.map((user) => user.id)).toEqual([first.sub, second.sub]);
    expect(next.users.map((user) => user.id)).toEqual([third.sub]);
    expect(next.nextToken).toBeNull();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([first.sub, second.sub, third.sub]);
    expect(
      listUsers.mock.calls.map((call) => call[0]?.accountStatus),
    ).toEqual(['CONFIRMED', 'CONFIRMED', 'CONFIRMED']);
    await expect(
      service.list({
        pageSize: 2,
        accountStatus: 'UNCONFIRMED',
        nextToken: listed.nextToken ?? '',
      }),
    ).rejects.toBeInstanceOf(UserDirectoryQueryError);
  });

  it('rejects a continuation token issued for another filter', async () => {
    const ana = account('ana', { email: 'ana@enercol.test' });
    groups.set(ana.username, ['ESPECIALISTA_TECNICO']);
    const second = account('second', { email: 'ana.second@enercol.test' });
    groups.set(second.username, ['ESPECIALISTA_TECNICO']);
    pages.set('', { users: [ana, second], paginationToken: null });
    const listed = await service.list({ pageSize: 1, search: 'ana@' });

    await expect(
      service.list({
        pageSize: 1,
        search: 'luis@',
        nextToken: listed.nextToken ?? '',
      }),
    ).rejects.toBeInstanceOf(UserDirectoryQueryError);
    await expect(service.list({ search: 'ana"' })).rejects.toBeInstanceOf(
      UserDirectoryQueryError,
    );
  });
});

function account(
  name: string,
  input: { email?: string | null; status?: CognitoUserStatus | null } = {},
): CognitoManagedUser {
  const email =
    input.email === undefined ? `${name}@enercol.test` : input.email;
  const accountStatus = input.status === undefined ? 'CONFIRMED' : input.status;
  return {
    sub: `${name}-sub`,
    username: email ?? name,
    email,
    enabled: true,
    status: accountStatus ?? 'UNKNOWN',
    accountStatus,
    createdAt: CREATED,
    lastModifiedAt: MODIFIED,
  };
}

function profile(cognitoSub: string): DirectoryProfile {
  return {
    cognitoSub,
    firstName: 'Fernando',
    lastName: 'Mejía',
    phoneNumber: '+573000000000',
  };
}

function invitation(
  email: string,
  status: DirectoryInvitation['status'],
): DirectoryInvitation {
  return { email, status, createdAt: CREATED };
}
