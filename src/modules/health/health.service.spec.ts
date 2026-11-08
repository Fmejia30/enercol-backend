import { jest } from '@jest/globals';
import { HealthService } from './health.service.js';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';

describe('HealthService', () => {
  function createService(queryRaw: jest.Mock): HealthService {
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
    return new HealthService(prisma);
  }

  it('reports the database as up when the query succeeds', async () => {
    const service = createService(jest.fn().mockResolvedValue([{ ok: 1 }]));

    await expect(service.check()).resolves.toEqual({
      checks: { database: 'up' },
    });
  });

  it('reports the database as down without exposing the driver error', async () => {
    const service = createService(
      jest.fn().mockRejectedValue(new Error('password authentication failed')),
    );

    await expect(service.check()).resolves.toEqual({
      checks: { database: 'down' },
    });
  });
});
