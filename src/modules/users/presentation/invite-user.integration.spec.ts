import { type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { TOKEN_VERIFIER } from '../../identity-access/application/token-verifier.js';
import type { TokenVerifier } from '../../identity-access/application/token-verifier.js';
import type { AuthenticatedUser } from '../../identity-access/domain/authenticated-user.js';
import { UserRole } from '../../identity-access/domain/user-role.js';
import { JwtAuthGuard } from '../../identity-access/presentation/jwt-auth.guard.js';
import { ACCESS_DENIED_MESSAGE } from '../../identity-access/presentation/roles.guard.js';
import { RolesGuard } from '../../identity-access/presentation/roles.guard.js';
import { configureApp } from '../../../shared/http/configure-app.js';
import { InviteUserService } from '../application/invite-user.service.js';
import { UserAdministrationService } from '../application/user-administration.service.js';
import { USER_ADMINISTRATION_REPOSITORY } from '../application/user-administration.repository.js';
import { UserDirectoryService } from '../application/user-directory.service.js';
import { UserListCursorCodec } from '../application/user-list-cursor.js';
import { USER_DIRECTORY_REPOSITORY } from '../application/user-directory.repository.js';
import {
  INVITATION_CLOCK,
  USER_INVITATION_REPOSITORY,
} from '../application/user-invitation.repository.js';
import type {
  CognitoManagedUser,
  CognitoUserAdmin,
} from '../application/cognito-user-admin.js';
import { COGNITO_USER_ADMIN } from '../application/cognito-user-admin.js';
import { USER_INVITE_AUDIT_ACTION } from '../domain/invitation-request.js';
import { PrismaUserAdministrationRepository } from '../infrastructure/prisma-user-administration.repository.js';
import { PrismaUserDirectoryRepository } from '../infrastructure/prisma-user-directory.repository.js';
import { PrismaUserInvitationRepository } from '../infrastructure/prisma-user-invitation.repository.js';
import { UsersController } from './users.controller.js';

const ADMIN_SUB = 'admin-sub';
const TARGET_SUB = 'target-sub';
const EMAIL = 'ana@enercol.test';
const NOW = new Date('2026-11-11T00:00:00.000Z');
const EXPIRES_AT = '2026-11-18T00:00:00.000Z';
const INVITATION_ID = 'invitation-1';

describe('POST /api/v1/users', () => {
  const users = new Map<string, AuthenticatedUser>([
    [
      'specialist-token',
      { userId: 'specialist-1', roles: [UserRole.SPECIALIST] },
    ],
    ['validator-token', { userId: 'validator-1', roles: [UserRole.VALIDATOR] }],
    ['admin-token', { userId: ADMIN_SUB, roles: [UserRole.ADMINISTRATOR] }],
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
  const findUsersByEmail = jest.fn<CognitoUserAdmin['findUsersByEmail']>();
  const createUser = jest.fn<CognitoUserAdmin['createUser']>();
  const addToGroup = jest.fn<CognitoUserAdmin['addToGroup']>();
  const disableUser = jest.fn<CognitoUserAdmin['disableUser']>();
  const invitationCreate =
    jest.fn<
      (args: {
        data: Record<string, unknown>;
      }) => Promise<Record<string, unknown>>
    >();
  const auditCreate =
    jest.fn<
      (args: {
        data: Record<string, unknown>;
      }) => Promise<Record<string, unknown>>
    >();
  const profileCreate =
    jest.fn<
      (args: {
        data: Record<string, unknown>;
      }) => Promise<Record<string, unknown>>
    >();
  const prisma = {
    userInvitation: { create: invitationCreate },
    auditLog: { create: auditCreate },
    userProfile: { create: profileCreate },
    $transaction: jest.fn(
      async (
        work: (tx: {
          userInvitation: { create: typeof invitationCreate };
          auditLog: { create: typeof auditCreate };
        }) => Promise<unknown>,
      ) => work(prisma),
    ),
  };
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

  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        InviteUserService,
        UserAdministrationService,
        UserDirectoryService,
        UserListCursorCodec,
        {
          provide: USER_DIRECTORY_REPOSITORY,
          useClass: PrismaUserDirectoryRepository,
        },
        {
          provide: USER_ADMINISTRATION_REPOSITORY,
          useClass: PrismaUserAdministrationRepository,
        },
        {
          provide: USER_INVITATION_REPOSITORY,
          useClass: PrismaUserInvitationRepository,
        },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'cursor-test-key' } as ConfigService,
        },
        { provide: INVITATION_CLOCK, useValue: () => NOW },
        { provide: COGNITO_USER_ADMIN, useValue: cognito },
        { provide: PrismaService, useValue: prisma },
        { provide: TOKEN_VERIFIER, useValue: tokenVerifier },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    findUsersByEmail.mockReset().mockResolvedValue([]);
    createUser.mockReset().mockResolvedValue(managedUser());
    addToGroup.mockReset().mockResolvedValue(undefined);
    disableUser.mockReset().mockResolvedValue(undefined);
    invitationCreate.mockReset().mockImplementation(async ({ data }) => ({
      id: INVITATION_ID,
      acceptedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
      ...data,
    }));
    auditCreate.mockReset().mockResolvedValue({ id: 'audit-1' });
    profileCreate.mockReset();
    prisma.$transaction.mockClear();
  });

  it('returns the pending invitation without a user profile', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', 'Bearer admin-token')
      .send({
        email: '  Ana@Enercol.TEST ',
        roles: [UserRole.ADMINISTRATOR, UserRole.SPECIALIST],
      })
      .expect(201);

    expect(response.body).toEqual({
      id: INVITATION_ID,
      email: EMAIL,
      roles: [UserRole.SPECIALIST, UserRole.ADMINISTRATOR],
      status: 'PENDING',
      expiresAt: EXPIRES_AT,
    });
    expect(createUser).toHaveBeenCalledWith(EMAIL);
    expect(addToGroup.mock.calls).toEqual([
      [EMAIL, 'ESPECIALISTA_TECNICO'],
      [EMAIL, 'ADMINISTRADOR'],
    ]);
    expect(invitationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: EMAIL,
        cognitoSub: TARGET_SUB,
        status: 'PENDING',
        createdBy: ADMIN_SUB,
      }),
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        actorSub: ADMIN_SUB,
        action: USER_INVITE_AUDIT_ACTION,
        targetSub: TARGET_SUB,
        metadata: {
          email: EMAIL,
          roles: [UserRole.SPECIALIST, UserRole.ADMINISTRATOR],
        },
      },
    });
    expect(profileCreate).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body)).not.toContain('password');
  });

  it('rejects callers without users:manage before creating a user', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/users')
      .send({ email: EMAIL, roles: [UserRole.ADMINISTRATOR] })
      .expect(401);

    for (const token of ['specialist-token', 'validator-token']) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: EMAIL, roles: [UserRole.ADMINISTRATOR] })
        .expect(403);
      expect(response.body).toMatchObject({ message: ACCESS_DENIED_MESSAGE });
    }

    expect(createUser).not.toHaveBeenCalled();
    expect(invitationCreate).not.toHaveBeenCalled();
    expect(profileCreate).not.toHaveBeenCalled();
  });

  it('rejects invalid fields and client-supplied internal identifiers', async () => {
    const server = app.getHttpServer();
    const cases = [
      {},
      { email: 'no-es-correo', roles: [UserRole.SPECIALIST] },
      { email: EMAIL, roles: [] },
      { email: EMAIL, roles: ['AUDITOR'] },
      { email: EMAIL, roles: [UserRole.SPECIALIST, UserRole.SPECIALIST] },
      {
        email: EMAIL,
        roles: [UserRole.SPECIALIST],
        cognitoSub: TARGET_SUB,
        createdBy: 'otro-admin',
        status: 'ACCEPTED',
      },
    ];

    for (const body of cases) {
      await request(server)
        .post('/api/v1/users')
        .set('Authorization', 'Bearer admin-token')
        .send(body)
        .expect(400);
    }

    expect(createUser).not.toHaveBeenCalled();
    expect(profileCreate).not.toHaveBeenCalled();
  });

  it('returns 409 when Cognito already has the email and stores nothing', async () => {
    findUsersByEmail.mockResolvedValue([managedUser()]);

    const response = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', 'Bearer admin-token')
      .send({ email: EMAIL, roles: [UserRole.VALIDATOR] })
      .expect(409);

    expect(response.body.message).toBe('Ya existe un usuario con ese correo');
    expect(createUser).not.toHaveBeenCalled();
    expect(invitationCreate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(profileCreate).not.toHaveBeenCalled();
  });

  it('disables the account when group assignment fails and hides the cause', async () => {
    addToGroup.mockRejectedValue(new Error('temporary password Secret123'));

    const response = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', 'Bearer admin-token')
      .send({ email: EMAIL, roles: [UserRole.VALIDATOR] })
      .expect(503);

    expect(response.body.message).toBe('Internal server error');
    expect(JSON.stringify(response.body)).not.toContain('Secret123');
    expect(disableUser).toHaveBeenCalledWith(EMAIL);
    expect(invitationCreate).not.toHaveBeenCalled();
    expect(profileCreate).not.toHaveBeenCalled();
  });

  it('disables the account when the invitation cannot be stored', async () => {
    invitationCreate.mockRejectedValue(new Error('database unavailable'));

    await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', 'Bearer admin-token')
      .send({ email: EMAIL, roles: [UserRole.SPECIALIST] })
      .expect(503);

    expect(auditCreate).not.toHaveBeenCalled();
    expect(disableUser).toHaveBeenCalledWith(EMAIL);
    expect(profileCreate).not.toHaveBeenCalled();
  });

  it('disables the account when the audit record cannot be stored', async () => {
    auditCreate.mockRejectedValue(new Error('audit unavailable'));

    const response = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', 'Bearer admin-token')
      .send({ email: EMAIL, roles: [UserRole.SPECIALIST] })
      .expect(503);

    expect(response.body.message).toBe('Internal server error');
    expect(JSON.stringify(response.body)).not.toContain('audit unavailable');
    expect(disableUser).toHaveBeenCalledWith(EMAIL);
    expect(profileCreate).not.toHaveBeenCalled();
  });
});

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
