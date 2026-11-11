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
import type { CognitoUserAdmin } from '../src/modules/users/application/cognito-user-admin.js';
import { configureApp } from '../src/shared/http/configure-app.js';

describe('Own profile (e2e)', () => {
  const users = new Map<string, AuthenticatedUser>([
    [
      'specialist-token',
      {
        userId: 'specialist-1',
        email: 'ana@enercol.test',
        roles: [UserRole.SPECIALIST],
      },
    ],
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
  const profiles = new Map<
    string,
    {
      cognitoSub: string;
      firstName: string;
      lastName: string;
      phoneNumber: string;
    }
  >();
  const audits: Array<{ action: string; actorSub: string; targetSub: string }> =
    [];
  const profileCreate = jest.fn<(args: { data: ProfileRow }) => Promise<ProfileRow>>();
  const profileUpdate =
    jest.fn<
      (args: {
        where: { cognitoSub: string };
        data: Partial<ProfileRow>;
      }) => Promise<ProfileRow>
    >();
  const invitationUpdate = jest.fn();
  const getUserBySub = jest.fn();
  const addToGroup = jest.fn();
  const tx = {
    userProfile: { create: profileCreate, update: profileUpdate },
    auditLog: {
      create: jest.fn(async (args: { data: (typeof audits)[number] }) => {
        audits.push(args.data);
        return args.data;
      }),
    },
    userInvitation: { update: invitationUpdate },
  };
  const cognito = {
    getUserBySub,
    addToGroup,
    removeFromGroup: jest.fn(),
    disableUser: jest.fn(),
    enableUser: jest.fn(),
    signOutUser: jest.fn(),
    createUser: jest.fn(),
    getUserByUsername: jest.fn(),
    findUsersByEmail: jest.fn(),
    listGroups: jest.fn(),
    listUsers: jest.fn(),
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
        $transaction: jest.fn(
          async (work: (client: typeof tx) => Promise<void>) => work(tx),
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
        },
        userInvitation: {
          findMany: jest.fn(async () => []),
          update: invitationUpdate,
        },
        auditLog: tx.auditLog,
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
    invitationUpdate.mockReset();
    getUserBySub.mockReset();
    addToGroup.mockReset();
    tx.auditLog.create.mockClear();
  });

  it('reads an existing profile and an empty one without writing', async () => {
    profiles.set('specialist-1', {
      cognitoSub: 'specialist-1',
      firstName: 'Fernando',
      lastName: 'Mejía',
      phoneNumber: '+573000000000',
    });

    const existing = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer specialist-token')
      .expect(200);
    expect(existing.body).toEqual({
      id: 'specialist-1',
      email: 'ana@enercol.test',
      roles: [UserRole.SPECIALIST],
      firstName: 'Fernando',
      lastName: 'Mejía',
      phoneNumber: '+573000000000',
      profileCompleted: true,
    });

    profiles.clear();
    const missing = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer specialist-token')
      .expect(200);
    expect(missing.body).toMatchObject({
      id: 'specialist-1',
      profileCompleted: false,
      firstName: null,
      lastName: null,
      phoneNumber: null,
    });
    expect(profileCreate).not.toHaveBeenCalled();
    expect(getUserBySub).not.toHaveBeenCalled();
  });

  it('updates the caller profile and records the self-service audit', async () => {
    profiles.set('specialist-1', {
      cognitoSub: 'specialist-1',
      firstName: 'Fernando',
      lastName: 'Mejía',
      phoneNumber: '+573000000000',
    });

    const response = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', 'Bearer specialist-token')
      .send({ phoneNumber: '+573111111111' })
      .expect(200);

    expect(response.body).toMatchObject({
      id: 'specialist-1',
      phoneNumber: '+573111111111',
      firstName: 'Fernando',
      profileCompleted: true,
    });
    expect(profileUpdate).toHaveBeenCalledWith({
      where: { cognitoSub: 'specialist-1' },
      data: { phoneNumber: '+573111111111' },
    });
    expect(audits).toEqual([
      expect.objectContaining({
        action: 'users.profile.self_updated',
        actorSub: 'specialist-1',
        targetSub: 'specialist-1',
      }),
    ]);
    expect(addToGroup).not.toHaveBeenCalled();
    expect(invitationUpdate).not.toHaveBeenCalled();
  });

  it('creates a complete profile and rejects incomplete, empty, and foreign changes', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .send({ firstName: 'Fernando' })
      .expect(401);

    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', 'Bearer specialist-token')
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', 'Bearer specialist-token')
      .send({ firstName: 'Fernando' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', 'Bearer specialist-token')
      .send({ email: 'other@enercol.test', firstName: 'Fernando', lastName: 'Mejía', phoneNumber: '+573000000000' })
      .expect(400);

    const denied = await request(app.getHttpServer())
      .patch('/api/v1/users/other-user')
      .set('Authorization', 'Bearer specialist-token')
      .send({ firstName: 'Fernando' })
      .expect(403);
    expect(denied.body.message).toBe(ACCESS_DENIED_MESSAGE);

    const created = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', 'Bearer specialist-token')
      .send({
        firstName: 'Fernando',
        lastName: 'Mejía',
        phoneNumber: '+573000000000',
      })
      .expect(200);
    expect(created.body).toMatchObject({
      id: 'specialist-1',
      profileCompleted: true,
      firstName: 'Fernando',
    });
    expect(profileCreate).toHaveBeenCalledWith({
      data: {
        cognitoSub: 'specialist-1',
        firstName: 'Fernando',
        lastName: 'Mejía',
        phoneNumber: '+573000000000',
      },
    });
  });
});

interface ProfileRow {
  cognitoSub: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
}
