import { jest } from '@jest/globals';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { TOKEN_VERIFIER } from '../src/modules/identity-access/application/token-verifier.js';
import type { TokenVerifier } from '../src/modules/identity-access/application/token-verifier.js';
import type { AuthenticatedUser } from '../src/modules/identity-access/domain/authenticated-user.js';
import { UserRole } from '../src/modules/identity-access/domain/user-role.js';
import { ACCESS_DENIED_MESSAGE } from '../src/modules/identity-access/presentation/roles.guard.js';
import { AUTHENTICATION_FAILED_MESSAGE } from '../src/modules/identity-access/presentation/jwt-auth.guard.js';
import { AUTHENTICATION_REQUIRED_MESSAGE } from '../src/modules/identity-access/presentation/current-user.decorator.js';
import {
  Authenticated,
  Roles,
} from '../src/modules/identity-access/presentation/roles.decorator.js';
import { configureApp } from '../src/shared/http/configure-app.js';

@Controller('authorization-probe')
class AuthorizationProbeController {
  @Get('validator')
  @Roles(UserRole.VALIDATOR)
  validatorOnly(): { ok: true } {
    return { ok: true };
  }

  @Get('specialist')
  @Roles(UserRole.SPECIALIST)
  specialistOnly(): { ok: true } {
    return { ok: true };
  }

  @Get('unmarked')
  unmarked(): { ok: true } {
    return { ok: true };
  }

  @Get('authenticated')
  @Authenticated()
  authenticated(): { ok: true } {
    return { ok: true };
  }
}

describe('Identity access (e2e)', () => {
  const users = new Map<string, AuthenticatedUser>([
    [
      'specialist-token',
      { userId: 'specialist-1', roles: [UserRole.SPECIALIST] },
    ],
    ['validator-token', { userId: 'validator-1', roles: [UserRole.VALIDATOR] }],
    [
      'both-token',
      {
        userId: 'both-1',
        roles: [UserRole.SPECIALIST, UserRole.VALIDATOR],
      },
    ],
    ['empty-roles-token', { userId: 'empty-1', roles: [] }],
  ]);

  const tokenVerifier: TokenVerifier = {
    verify: jest.fn<TokenVerifier['verify']>(async (token: string) => {
      if (token === 'provider-down') {
        throw new Error('connect ECONNREFUSED cognito-idp');
      }
      const user = users.get(token);
      if (!user) {
        throw new Error(`invalid signature for ${token}`);
      }
      return user;
    }),
  };

  async function createApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [AuthorizationProbeController],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $queryRaw: jest.fn().mockResolvedValue([{ ok: 1 }]),
        $disconnect: jest.fn(),
      })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(tokenVerifier)
      .compile();

    const app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    return app;
  }

  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps the health checks public', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
  });

  it('rejects anonymous and invalid tokens with 401 and without verifier details', async () => {
    const anonymous = await request(app.getHttpServer())
      .get('/api/v1/identity/me')
      .set('x-role', UserRole.VALIDATOR)
      .expect(401);
    expect(anonymous.body).toMatchObject({
      statusCode: 401,
      message: AUTHENTICATION_REQUIRED_MESSAGE,
    });

    const invalid = await request(app.getHttpServer())
      .get('/api/v1/identity/me')
      .set('Authorization', 'Bearer not-a-cognito-token')
      .expect(401);
    expect(invalid.body.message).toBe(AUTHENTICATION_FAILED_MESSAGE);
    expect(JSON.stringify(invalid.body)).not.toContain('not-a-cognito-token');

    const unavailable = await request(app.getHttpServer())
      .get('/api/v1/identity/me')
      .set('Authorization', 'Bearer provider-down')
      .expect(401);
    expect(JSON.stringify(unavailable.body)).not.toContain('ECONNREFUSED');
  });

  it('returns the authenticated context and denies a role the token does not have', async () => {
    const me = await request(app.getHttpServer())
      .get('/api/v1/identity/me')
      .set('Authorization', 'Bearer both-token')
      .expect(200);
    expect(me.body).toEqual({
      userId: 'both-1',
      roles: [UserRole.SPECIALIST, UserRole.VALIDATOR],
    });

    const denied = await request(app.getHttpServer())
      .get('/api/v1/authorization-probe/validator')
      .set('Authorization', 'Bearer specialist-token')
      .set('x-role', UserRole.VALIDATOR)
      .expect(403);
    expect(denied.body).toMatchObject({
      statusCode: 403,
      message: ACCESS_DENIED_MESSAGE,
    });

    await request(app.getHttpServer())
      .get('/api/v1/authorization-probe/specialist')
      .set('Authorization', 'Bearer validator-token')
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/authorization-probe/validator')
      .set('Authorization', 'Bearer both-token')
      .expect(200);

    const identity = await request(app.getHttpServer())
      .get('/api/v1/identity/me')
      .set('Authorization', 'Bearer empty-roles-token')
      .expect(200);
    expect(identity.body).toEqual({ userId: 'empty-1', roles: [] });

    await request(app.getHttpServer())
      .get('/api/v1/authorization-probe/specialist')
      .set('Authorization', 'Bearer empty-roles-token')
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/authorization-probe/validator')
      .set('Authorization', 'Bearer empty-roles-token')
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/authorization-probe/specialist')
      .set('Authorization', 'Bearer specialist-token')
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/authorization-probe/validator')
      .set('Authorization', 'Bearer validator-token')
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/authorization-probe/specialist')
      .set('Authorization', 'Bearer both-token')
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/authorization-probe/unmarked')
      .set('Authorization', 'Bearer specialist-token')
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/authorization-probe/unmarked')
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/authorization-probe/authenticated')
      .set('Authorization', 'Bearer empty-roles-token')
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/authorization-probe/authenticated')
      .expect(401);
  });
});
