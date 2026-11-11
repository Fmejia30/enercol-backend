import { jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { TOKEN_VERIFIER } from '../src/modules/identity-access/application/token-verifier.js';
import type { TokenVerifier } from '../src/modules/identity-access/application/token-verifier.js';
import type { AuthenticatedUser } from '../src/modules/identity-access/domain/authenticated-user.js';
import { UserRole } from '../src/modules/identity-access/domain/user-role.js';
import { ACCESS_DENIED_MESSAGE } from '../src/modules/identity-access/presentation/roles.guard.js';
import { COGNITO_USER_ADMIN } from '../src/modules/users/application/cognito-user-admin.js';
import type {
  CognitoManagedUser,
  CognitoUserAdmin,
} from '../src/modules/users/application/cognito-user-admin.js';
import { CognitoAdminError } from '../src/modules/users/domain/cognito-admin-error.js';
import { FUNCTIONAL_COGNITO_GROUPS } from '../src/modules/users/domain/functional-cognito-group.js';
import type { FunctionalCognitoGroup } from '../src/modules/users/domain/functional-cognito-group.js';
import { configureApp } from '../src/shared/http/configure-app.js';

describe('User administration (e2e)', () => {
  const users = new Map<string, AuthenticatedUser>([
    [
      'specialist-token',
      { userId: 'specialist-1', roles: [UserRole.SPECIALIST] },
    ],
    ['admin-token', { userId: 'admin-1', roles: [UserRole.ADMINISTRATOR] }],
  ]);
  const tokenVerifier: TokenVerifier = {
    verify: jest.fn<TokenVerifier['verify']>(async (token: string) => {
      const user = users.get(token);
      if (!user) {
        throw new Error('invalid signature');
      }
      return user;
    }),
  };
  const accounts = new Map<string, CognitoManagedUser>();
  const membership = new Map<string, Set<FunctionalCognitoGroup>>();
  const foreignGroups = new Map<string, Set<string>>();
  const profiles = new Map<
    string,
    {
      cognitoSub: string;
      firstName: string;
      lastName: string;
      phoneNumber: string;
    }
  >();
  const invitations = [
    {
      id: 'invite-1',
      email: 'ana@enercol.test',
      status: 'PENDING',
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
    },
  ];
  const audits: unknown[] = [];
  const profileCreate = jest.fn<(args: { data: ProfileRow }) => Promise<ProfileRow>>();
  const profileUpdate =
    jest.fn<
      (args: {
        where: { cognitoSub: string };
        data: Partial<ProfileRow>;
      }) => Promise<ProfileRow>
    >();
  const profileDelete = jest.fn();
  const invitationUpdate = jest.fn();
  const auditCreate = jest.fn<(args: { data: unknown }) => Promise<unknown>>();
  const getUserBySub = jest.fn<CognitoUserAdmin['getUserBySub']>();
  const listGroups = jest.fn<CognitoUserAdmin['listGroups']>();
  const addToGroup = jest.fn<CognitoUserAdmin['addToGroup']>();
  const removeFromGroup = jest.fn<CognitoUserAdmin['removeFromGroup']>();
  const disableUser = jest.fn<CognitoUserAdmin['disableUser']>();
  const enableUser = jest.fn<CognitoUserAdmin['enableUser']>();
  const signOutUser = jest.fn<CognitoUserAdmin['signOutUser']>();
  const tx = {
    userProfile: {
      create: profileCreate,
      update: profileUpdate,
      delete: profileDelete,
    },
    userInvitation: { update: invitationUpdate, delete: jest.fn() },
    auditLog: { create: auditCreate },
  };
  const cognito = {
    getUserBySub,
    listGroups,
    addToGroup,
    removeFromGroup,
    disableUser,
    enableUser,
    signOutUser,
    createUser: jest.fn(),
    getUserByUsername: jest.fn(),
    findUsersByEmail: jest.fn(),
    resendInvitation: jest.fn(),
    listUsers: jest.fn(),
  } as CognitoUserAdmin;

  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(tokenVerifier)
      .overrideProvider(COGNITO_USER_ADMIN)
      .useValue(cognito)
      .overrideProvider(PrismaService)
      .useValue({
        $disconnect: jest.fn(),
        $queryRaw: jest.fn(),
        $transaction: jest.fn(async (work: (client: typeof tx) => Promise<void>) =>
          work(tx),
        ),
        userProfile: {
          findMany: jest.fn(
            async (args: { where: { cognitoSub: { in: string[] } } }) =>
              args.where.cognitoSub.in.flatMap((id) => {
                const profile = profiles.get(id);
                return profile ? [profile] : [];
              }),
          ),
          create: profileCreate,
          update: profileUpdate,
          delete: profileDelete,
        },
        userInvitation: {
          findMany: jest.fn(async () => invitations),
          update: invitationUpdate,
          delete: jest.fn(),
          create: jest.fn(),
        },
        auditLog: { create: auditCreate },
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    accounts.clear();
    membership.clear();
    foreignGroups.clear();
    profiles.clear();
    audits.length = 0;
    profileCreate.mockReset().mockImplementation(async ({ data }) => {
      profiles.set(data.cognitoSub, { ...data });
      return data;
    });
    profileUpdate.mockReset().mockImplementation(async ({ where, data }) => {
      const current = profiles.get(where.cognitoSub);
      if (!current) {
        throw new Error('missing profile');
      }
      Object.assign(current, data);
      return current;
    });
    profileDelete.mockReset();
    invitationUpdate.mockReset();
    auditCreate.mockReset().mockImplementation(async ({ data }) => {
      audits.push(data);
      return data;
    });
    getUserBySub.mockReset().mockImplementation(async (sub: string) => {
      const user = accounts.get(sub);
      if (!user) {
        throw new CognitoAdminError('user_not_found');
      }
      return user;
    });
    listGroups.mockReset().mockImplementation(async (username: string) => {
      const current = membership.get(username) ?? new Set();
      return FUNCTIONAL_COGNITO_GROUPS.filter((group) => current.has(group));
    });
    addToGroup.mockReset().mockImplementation(async (username, group) => {
      const current = membership.get(username) ?? new Set();
      current.add(group as FunctionalCognitoGroup);
      membership.set(username, current);
    });
    removeFromGroup.mockReset().mockImplementation(async (username, group) => {
      membership.get(username)?.delete(group as FunctionalCognitoGroup);
    });
    disableUser.mockReset().mockImplementation(async (username: string) => {
      const user = [...accounts.values()].find(
        (account) => account.username === username,
      );
      if (user) {
        user.enabled = false;
      }
    });
    enableUser.mockReset().mockImplementation(async (username: string) => {
      const user = [...accounts.values()].find(
        (account) => account.username === username,
      );
      if (user) {
        user.enabled = true;
      }
    });
    signOutUser.mockReset().mockResolvedValue(undefined);
  });

  it('updates an existing profile for an administrator', async () => {
    const ana = seed('Fernando');
    profiles.set(ana.sub, {
      cognitoSub: ana.sub,
      firstName: 'Fernando',
      lastName: 'Mejía',
      phoneNumber: '+573000000000',
    });

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/users/${ana.sub}`)
      .set('Authorization', 'Bearer admin-token')
      .send({ firstName: 'Ana María' })
      .expect(200);

    expect(response.body).toMatchObject({
      id: ana.sub,
      email: ana.email,
      firstName: 'Ana María',
      lastName: 'Mejía',
      roles: [UserRole.SPECIALIST],
    });
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'users.profile.updated',
        actorSub: 'admin-1',
        targetSub: ana.sub,
      }),
    ]);
    expect(invitationUpdate).not.toHaveBeenCalled();
  });

  it('creates a profile, changes roles, and preserves unrelated groups', async () => {
    const ana = seed('Fernando');
    foreignGroups.set(ana.username, new Set(['OTRO_GRUPO']));

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/users/${ana.sub}`)
      .set('Authorization', 'Bearer admin-token')
      .send({
        firstName: 'Fernando',
        lastName: 'Mejía',
        phoneNumber: '+573000000000',
        roles: [UserRole.VALIDATOR, UserRole.ADMINISTRATOR],
      })
      .expect(200);

    expect(response.body).toMatchObject({
      firstName: 'Fernando',
      profileCompleted: true,
      roles: [UserRole.VALIDATOR, UserRole.ADMINISTRATOR],
      groups: ['ESPECIALISTA_VALIDADOR', 'ADMINISTRADOR'],
    });
    expect(removeFromGroup.mock.calls.map(([, group]) => group)).toEqual([
      'ESPECIALISTA_TECNICO',
    ]);
    expect(foreignGroups.get(ana.username)).toEqual(new Set(['OTRO_GRUPO']));
    expect(audits.map((audit) => (audit as { action: string }).action)).toEqual([
      'users.profile.updated',
      'users.roles.updated',
    ]);
  });

  it('rejects callers without users:manage, invalid bodies, and missing users', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/users/ana-sub')
      .send({ firstName: 'Fernando' })
      .expect(401);
    const denied = await request(app.getHttpServer())
      .patch('/api/v1/users/ana-sub')
      .set('Authorization', 'Bearer specialist-token')
      .send({ firstName: 'Fernando' })
      .expect(403);
    expect(denied.body.message).toBe(ACCESS_DENIED_MESSAGE);

    await request(app.getHttpServer())
      .patch('/api/v1/users/ana-sub')
      .set('Authorization', 'Bearer admin-token')
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/v1/users/ana-sub')
      .set('Authorization', 'Bearer admin-token')
      .send({ email: 'ana@enercol.test', firstName: 'Fernando' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/v1/users/ana-sub')
      .set('Authorization', 'Bearer admin-token')
      .send({ roles: ['AUDITOR'] })
      .expect(400);

    const missing = await request(app.getHttpServer())
      .patch('/api/v1/users/missing-sub')
      .set('Authorization', 'Bearer admin-token')
      .send({ roles: [UserRole.SPECIALIST] })
      .expect(404);
    expect(missing.body.message).toBe(
      'No existe un usuario con ese identificador',
    );
    expect(profileCreate).not.toHaveBeenCalled();
  });

  it('disables and enables an account without deleting the profile or invitation', async () => {
    const ana = seed('Fernando');
    ana.enabled = true;
    profiles.set(ana.sub, {
      cognitoSub: ana.sub,
      firstName: 'Fernando',
      lastName: 'Mejía',
      phoneNumber: '+573000000000',
    });

    const disabled = await request(app.getHttpServer())
      .patch(`/api/v1/users/${ana.sub}/status`)
      .set('Authorization', 'Bearer admin-token')
      .send({ enabled: false })
      .expect(200);
    expect(disabled.body.enabled).toBe(false);
    expect(signOutUser).toHaveBeenCalledWith(ana.username);
    expect(profileDelete).not.toHaveBeenCalled();
    expect(invitationUpdate).not.toHaveBeenCalled();

    const enabled = await request(app.getHttpServer())
      .patch(`/api/v1/users/${ana.sub}/status`)
      .set('Authorization', 'Bearer admin-token')
      .send({ enabled: true })
      .expect(200);
    expect(enabled.body.enabled).toBe(true);
    expect(audits.map((audit) => (audit as { action: string }).action)).toEqual([
      'users.disabled',
      'users.enabled',
    ]);
  });

  it('rejects self-disable and hides a partial group failure', async () => {
    const own = await request(app.getHttpServer())
      .patch('/api/v1/users/admin-1/status')
      .set('Authorization', 'Bearer admin-token')
      .send({ enabled: false })
      .expect(403);
    expect(own.body.message).toBe('No puede deshabilitar su propia cuenta');
    expect(disableUser).not.toHaveBeenCalled();

    const ana = seed('Fernando');
    membership.set(ana.username, new Set());
    addToGroup.mockReset().mockImplementation(async () => {
      if (addToGroup.mock.calls.length === 1) {
        return undefined;
      }
      throw new Error('temporary password Secret123');
    });
    const failed = await request(app.getHttpServer())
      .patch(`/api/v1/users/${ana.sub}`)
      .set('Authorization', 'Bearer admin-token')
      .send({ roles: [UserRole.VALIDATOR, UserRole.ADMINISTRATOR] })
      .expect(503);
    expect(JSON.stringify(failed.body)).not.toContain('Secret123');
    expect(failed.body.message).toBe('Internal server error');
  });

  function seed(name: string): CognitoManagedUser {
    const user: CognitoManagedUser = {
      sub: `${name}-sub`,
      username: `${name}@enercol.test`,
      email: `${name}@enercol.test`,
      enabled: true,
      status: 'CONFIRMED',
      accountStatus: 'CONFIRMED',
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
      lastModifiedAt: new Date('2026-11-02T00:00:00.000Z'),
    };
    accounts.set(user.sub, user);
    membership.set(user.username, new Set(['ESPECIALISTA_TECNICO']));
    return user;
  }
});

interface ProfileRow {
  cognitoSub: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
}
