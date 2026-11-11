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
  CognitoUserPage,
} from '../src/modules/users/application/cognito-user-admin.js';
import type { FunctionalCognitoGroup } from '../src/modules/users/domain/functional-cognito-group.js';
import { CognitoAdminError } from '../src/modules/users/domain/cognito-admin-error.js';
import { configureApp } from '../src/shared/http/configure-app.js';

const CREATED = new Date('2026-11-01T00:00:00.000Z');
const MODIFIED = new Date('2026-11-02T00:00:00.000Z');

describe('User directory (e2e)', () => {
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
  const pages = new Map<string, CognitoUserPage>();
  const groups = new Map<string, FunctionalCognitoGroup[]>();
  const listUsers = jest.fn<CognitoUserAdmin['listUsers']>();
  const listGroups = jest.fn<CognitoUserAdmin['listGroups']>();
  const getUserBySub = jest.fn<CognitoUserAdmin['getUserBySub']>();
  const profileFind =
    jest.fn<
      (args: { where: { cognitoSub: { in: string[] } } }) => Promise<unknown[]>
    >();
  const invitationFind =
    jest.fn<
      (args: { where: { email: { in: string[] } } }) => Promise<unknown[]>
    >();
  const profileCreate = jest.fn();
  const cognito = {
    listUsers,
    listGroups,
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
        userProfile: { findMany: profileFind, create: profileCreate },
        userInvitation: { findMany: invitationFind, create: jest.fn() },
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
    pages.clear();
    groups.clear();
    listUsers.mockReset().mockImplementation(async (input = {}) => {
      return (
        pages.get(input.paginationToken ?? '') ?? {
          users: [],
          paginationToken: null,
        }
      );
    });
    listGroups.mockReset().mockImplementation(async (username: string) => {
      return groups.get(username) ?? [];
    });
    getUserBySub.mockReset();
    profileFind.mockReset().mockResolvedValue([]);
    invitationFind.mockReset().mockResolvedValue([]);
    profileCreate.mockReset();
  });

  it('lists and reads an account for an administrator', async () => {
    const ana = account('Fernando');
    groups.set(ana.username, ['ESPECIALISTA_TECNICO']);
    pages.set('', { users: [ana], paginationToken: null });
    profileFind.mockResolvedValue([
      {
        cognitoSub: ana.sub,
        firstName: 'Fernando',
        lastName: 'Mejía',
        phoneNumber: '+573000000000',
      },
    ]);
    invitationFind.mockResolvedValue([
      {
        id: 'old',
        email: ana.email,
        status: 'PENDING',
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
      {
        id: 'new',
        email: ana.email,
        status: 'ACCEPTED',
        createdAt: new Date('2026-11-01T00:00:00.000Z'),
      },
    ]);
    getUserBySub.mockResolvedValue(ana);

    const listed = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', 'Bearer admin-token')
      .expect(200);
    expect(listed.body.users).toEqual([
      expect.objectContaining({
        id: ana.sub,
        email: ana.email,
        firstName: 'Fernando',
        profileCompleted: true,
        invitationStatus: 'ACCEPTED',
        roles: [UserRole.SPECIALIST],
        accountStatus: 'CONFIRMED',
      }),
    ]);
    expect(profileCreate).not.toHaveBeenCalled();

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/users/${ana.sub}`)
      .set('Authorization', 'Bearer admin-token')
      .expect(200);
    expect(detail.body.groups).toEqual(['ESPECIALISTA_TECNICO']);
  });

  it('rejects callers without users:manage and a missing account', async () => {
    await request(app.getHttpServer()).get('/api/v1/users').expect(401);
    const denied = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', 'Bearer specialist-token')
      .expect(403);
    expect(denied.body.message).toBe(ACCESS_DENIED_MESSAGE);

    getUserBySub.mockRejectedValue(new CognitoAdminError('user_not_found'));
    await request(app.getHttpServer())
      .get('/api/v1/users/missing-sub')
      .set('Authorization', 'Bearer admin-token')
      .expect(404);
    expect(listUsers).not.toHaveBeenCalled();
  });

  it('rejects invalid filters and hides provider failures', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/users')
      .query({ role: 'AUDITOR', pageSize: 101, status: 'NOPE' })
      .set('Authorization', 'Bearer admin-token')
      .expect(400);

    listUsers.mockRejectedValue(new Error('temporary password Secret123'));
    const failed = await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', 'Bearer admin-token')
      .expect(503);
    expect(JSON.stringify(failed.body)).not.toContain('Secret123');
  });

  it('continues a filtered page with the opaque token', async () => {
    const administrator = account('administrator');
    const first = account('first');
    const second = account('second');
    groups.set(administrator.username, ['ADMINISTRADOR']);
    groups.set(first.username, ['ESPECIALISTA_TECNICO']);
    groups.set(second.username, ['ESPECIALISTA_TECNICO']);
    pages.set('', {
      users: [administrator, first, second],
      paginationToken: null,
    });

    const listed = await request(app.getHttpServer())
      .get('/api/v1/users')
      .query({
        role: UserRole.SPECIALIST,
        status: 'CONFIRMED',
        pageSize: 1,
      })
      .set('Authorization', 'Bearer admin-token')
      .expect(200);
    const continued = await request(app.getHttpServer())
      .get('/api/v1/users')
      .query({
        role: UserRole.SPECIALIST,
        status: 'CONFIRMED',
        pageSize: 1,
        nextToken: listed.body.nextToken,
      })
      .set('Authorization', 'Bearer admin-token')
      .expect(200);

    expect(listed.body.users.map((user: { id: string }) => user.id)).toEqual([
      first.sub,
    ]);
    expect(continued.body.users.map((user: { id: string }) => user.id)).toEqual(
      [second.sub],
    );
    expect(listUsers.mock.calls[0]?.[0]).toMatchObject({
      accountStatus: 'CONFIRMED',
    });
  });
});

function account(name: string): CognitoManagedUser {
  return {
    sub: `${name}-sub`,
    username: `${name}@enercol.test`,
    email: `${name}@enercol.test`,
    enabled: true,
    status: 'CONFIRMED',
    accountStatus: 'CONFIRMED',
    createdAt: CREATED,
    lastModifiedAt: MODIFIED,
  };
}
