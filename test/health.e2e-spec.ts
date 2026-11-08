import { jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { configureApp } from '../src/shared/http/configure-app.js';

describe('Health (e2e)', () => {
  async function createApp(databaseUp: boolean): Promise<INestApplication> {
    const queryRaw = databaseUp
      ? jest.fn().mockResolvedValue([{ ok: 1 }])
      : jest.fn().mockRejectedValue(new Error('connection refused'));

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $queryRaw: queryRaw,
        $disconnect: jest.fn(),
      })
      .compile();

    const app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    return app;
  }

  it('GET /api/v1/health returns 200 when PostgreSQL responds', async () => {
    const app = await createApp(true);

    try {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        service: 'enercol-backend',
        checks: { database: 'up' },
      });
      expect(response.body.timestamp).toEqual(expect.any(String));
    } finally {
      await app.close();
    }
  });

  it('GET /api/v1/health returns 503 when PostgreSQL does not respond', async () => {
    const app = await createApp(false);

    try {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(503);

      expect(response.body).toMatchObject({
        status: 'error',
        service: 'enercol-backend',
        checks: { database: 'down' },
      });
    } finally {
      await app.close();
    }
  });

  it('returns the shared error envelope for an unknown route', async () => {
    const app = await createApp(true);

    try {
      const response = await request(app.getHttpServer())
        .get('/api/v1/missing')
        .expect(404);

      expect(response.body).toMatchObject({
        statusCode: 404,
        error: 'Not Found',
        path: '/api/v1/missing',
      });
      expect(response.body.timestamp).toEqual(expect.any(String));
      expect(response.body.stack).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
